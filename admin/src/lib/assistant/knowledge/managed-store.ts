import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { fail, fingerprint } from '../contracts';
import { bailianKnowledgeConfig } from './bailian-provider';

export type ManagedLibrary = Row & { workspace_id: string; index_name: string; index_id: string | null; index_profile_id: string; provision_job_id: string | null };
export async function managedLibrary(tx: PostgresTransaction, enterpriseId: string) {
  return one<ManagedLibrary>(tx, sql`select * from app.assistant_managed_knowledge_libraries where enterprise_id=${enterpriseId}`);
}

export async function managedProfile(tx: PostgresTransaction, enterpriseId: string, settings: Row, initialize: boolean) {
  const { workspaceId, model } = bailianKnowledgeConfig();
  const config = { provider: 'bailian', workspaceId, model, chunking: 'reviewed-file-and-bailian-v1' };
  const key = 'bailian:' + workspaceId + ':' + model;
  let library = await managedLibrary(tx, enterpriseId);
  if (!library && initialize) {
    const profile = (await one(tx, sql`insert into app.assistant_knowledge_index_profiles(enterprise_id,profile_key,configuration)
      values(${enterpriseId},${key},${JSON.stringify(config)}::jsonb)
      on conflict (enterprise_id,profile_key) do update set profile_key=excluded.profile_key returning *`))!;
    const name = 'xk-' + randomUUID().replaceAll('-', '').slice(0, 17);
    library = (await one<ManagedLibrary>(tx, sql`insert into app.assistant_managed_knowledge_libraries
      (enterprise_id,index_profile_id,workspace_id,index_name) values(${enterpriseId},${String(profile.id)},${workspaceId},${name})
      on conflict (enterprise_id) do update set enterprise_id=excluded.enterprise_id returning *`))!;
  }
  if (!library || library.workspace_id !== workspaceId) fail('retrieval_unavailable', 503);
  const profile = await one(tx, sql`select * from app.assistant_knowledge_index_profiles
    where enterprise_id=${enterpriseId} and id=${library.index_profile_id} and status='active'`);
  if (!profile || profile.profile_key !== key || fingerprint(profile.configuration) !== fingerprint(config)) fail('retrieval_unavailable', 503);
  if (!settings.active_index_profile_id && initialize) {
    await tx.execute(sql`update app.assistant_enterprise_settings set active_index_profile_id=${String(profile.id)}
      where enterprise_id=${enterpriseId} and active_index_profile_id is null`);
    settings.active_index_profile_id = profile.id;
  }
  return profile;
}

export const managedVersionReady = sql`exists (
  select 1 from app.assistant_managed_knowledge_imports mi
  join app.assistant_managed_knowledge_libraries ml on ml.enterprise_id=mi.enterprise_id and ml.workspace_id=mi.workspace_id
  where mi.enterprise_id=v.enterprise_id and mi.version_id=v.id and mi.edit_version=v.edit_version and mi.content_hash=v.content_hash
    and mi.ready and mi.revoked_at is null and ml.index_id is not null and ml.index_profile_id=v.index_profile_id
)`;

/** Includes legacy profiles during transition so references can still be reopened. */
export const sourceIndexReady = sql`exists (
  select 1 from app.assistant_knowledge_index_profiles sp
  where sp.enterprise_id=v.enterprise_id and sp.id=v.index_profile_id and sp.status='active'
    and (case when sp.configuration->>'provider'='bailian' then ${managedVersionReady}
      else v.index_profile_id=s.active_index_profile_id end)
)`;

export async function revokeManagedImports(tx: PostgresTransaction, enterpriseId: string, documentId: string, exceptVersionId?: string) {
  await tx.execute(sql`update app.assistant_managed_knowledge_imports mi set revoked_at=now(),cleanup_after=now()
    from app.assistant_knowledge_versions v where mi.enterprise_id=${enterpriseId} and mi.enterprise_id=v.enterprise_id
    and mi.version_id=v.id and v.document_id=${documentId} and mi.revoked_at is null
    ${exceptVersionId ? sql`and v.published_at is not null and v.id<>${exceptVersionId}` : sql``}`);
}
