import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one } from '@/db/repositories/assistant-repository';
import { AssistantError, fail } from '../contracts';
import { BailianKnowledgeError, BailianKnowledgeProvider, bailianKnowledgeConfig } from './bailian-provider';
import { findManagedDocument } from './managed-index';
import type { ManagedKnowledgeProvider } from './managed-provider';

/** The local publication fence takes effect in the same transaction as
 * withdrawal. This worker removes only provider objects created by our jobs. */
export async function processManagedKnowledgeCleanup(provider?: ManagedKnowledgeProvider) {
  let workspaceId: string;
  try { workspaceId = provider?.workspaceId ?? bailianKnowledgeConfig().workspaceId; }
  catch (error) {
    if (error instanceof AssistantError && error.code === 'bailian_knowledge_not_configured') return false;
    throw error;
  }
  const next = await withPlatformTransaction(tx=>one(tx,sql`select i.enterprise_id,i.job_id
    from app.assistant_managed_knowledge_imports i join app.assistant_knowledge_versions v on v.enterprise_id=i.enterprise_id and v.id=i.version_id
    join app.assistant_knowledge_documents d on d.enterprise_id=v.enterprise_id and d.id=v.document_id
    join app.assistant_jobs j on j.enterprise_id=i.enterprise_id and j.id=i.job_id
    where i.workspace_id=${workspaceId} and i.file_id is not null and i.removed_at is null and i.cleanup_after<=now()
    and j.status not in ('queued','running') and (i.revoked_at is not null or d.status='retired'
      or v.edit_version<>i.edit_version or v.content_hash<>i.content_hash
      or (v.published_at is not null and v.effective_to<=now()) or (d.scope='project' and d.project_id is null))
    order by i.cleanup_after,i.job_id limit 1`));
  if (!next) return false;
  const eid = String(next.enterprise_id), jobId = String(next.job_id);
  const claimed = await withTenantTransaction(eid, tx=>one(tx,sql`update app.assistant_managed_knowledge_imports i
    set revoked_at=coalesce(i.revoked_at,now()),cleanup_attempts=i.cleanup_attempts+1,cleanup_after=now()+interval '10 minutes'
    from app.assistant_managed_knowledge_libraries l,app.assistant_jobs j,app.assistant_knowledge_versions v,app.assistant_knowledge_documents d
    where i.enterprise_id=${eid} and i.job_id=${jobId} and i.workspace_id=${workspaceId} and i.file_id is not null
    and i.removed_at is null and i.cleanup_after<=now() and l.enterprise_id=i.enterprise_id and l.workspace_id=i.workspace_id
    and j.enterprise_id=i.enterprise_id and j.id=i.job_id and j.status not in ('queued','running')
    and v.enterprise_id=i.enterprise_id and v.id=i.version_id and d.enterprise_id=v.enterprise_id and d.id=v.document_id
    and (i.revoked_at is not null or d.status='retired' or v.edit_version<>i.edit_version or v.content_hash<>i.content_hash
      or (v.published_at is not null and v.effective_to<=now()) or (d.scope='project' and d.project_id is null))
    and not exists(select 1 from app.assistant_knowledge_attempts a where a.enterprise_id=i.enterprise_id and a.job_id=i.job_id
      and a.status='started' and a.started_at>now()-interval '150 seconds')
    returning i.*,l.index_id`));
  if (!claimed) return false;
  const client = provider ?? new BailianKnowledgeProvider(), fileId = String(claimed.file_id), tag = String(claimed.version_tag);
  let requestId: string | null = null, code: string | null = null;
  try {
    if (claimed.index_id) {
      const indexId = String(claimed.index_id);
      const doc = await findManagedDocument(client,indexId,fileId,tag);
      if (doc) {
        const removed = await client.deleteDocument(indexId,doc.id);
        requestId = removed.requestId;
        if (!removed.value && await findManagedDocument(client,indexId,fileId,tag)) fail('bailian_knowledge_removal_pending',503);
      }
    }
    const removed = await client.deleteFile(fileId);
    requestId = removed.requestId ?? requestId;
  } catch (error) {
    if (error instanceof BailianKnowledgeError) {
      // An already removed file is a successful idempotent retry.
      if (error.operation !== 'deleteFile' || !['FileNotFound','FileNotExist','DataCenter.FileNotFound'].includes(error.providerCode))
        code = error.providerCode;
      requestId = error.requestId ?? requestId;
    } else code = error instanceof AssistantError ? error.code : 'bailian_knowledge_removal_failed';
  }
  await withTenantTransaction(eid,tx=>tx.execute(sql`update app.assistant_managed_knowledge_imports
    set removed_at=case when ${code}::text is null then now() else removed_at end,cleanup_error=${code},cleanup_request_id=${requestId}
    where enterprise_id=${eid} and job_id=${jobId} and cleanup_attempts=${Number(claimed.cleanup_attempts)}`));
  return true;
}
