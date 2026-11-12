import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { fail, fingerprint } from '../contracts';
import type { SourceFile } from '../contracts/source-file';
import { BailianKnowledgeProvider, MANAGED_PAGE_SIZE } from './bailian-provider';
import { managedLibrary } from './managed-store';
import type { ManagedKnowledgeProvider, ManagedReceipt, ManagedSlice } from './managed-provider';
import { approvedTextPassages, bindManagedSlices } from './managed-slices';
import { reviewedFilePassages } from './source-file';
import { chineseTerms } from './chinese-lexical';
import type { KnowledgeLease } from './index-worker';

type IndexOperation = 'managed_upload' | 'managed_create' | 'managed_import';
type Mutation = <T>(operation: IndexOperation, execute: () => Promise<ManagedReceipt<T>>,
  persist: (tx: PostgresTransaction, value: T) => Promise<void>) => Promise<T>;
type IndexTarget = (tx: PostgresTransaction) => Promise<{ job: Row; v: Row; profile: Row | null }>;
const maxImportAgeMs = 30 * 60_000;

export async function findManagedDocument(provider: ManagedKnowledgeProvider, indexId: string, fileId: string, tag: string) {
  for (let page = 1; page <= 20; page++) {
    const { value } = await provider.listDocuments(indexId, page);
    const matches = value.documents.filter(row => row.id === fileId || (row.tags.includes(tag) && row.id.startsWith(fileId + '_')));
    if (matches.length > 1) fail('bailian_knowledge_document_ambiguous', 503);
    if (matches[0]) return matches[0];
    if (page * MANAGED_PAGE_SIZE >= value.total) return null;
  }
  fail('bailian_knowledge_document_limit', 503);
}

export async function runManagedIndex(lease: KnowledgeLease, target: IndexTarget, mutate: Mutation, rendered: string,
  provider: ManagedKnowledgeProvider = new BailianKnowledgeProvider()) {
  const eid = lease.actor.enterpriseId, jobId = lease.jobId;
  const admitted = await withTenantTransaction(eid, async tx => {
    const { job, v, profile } = await target(tx);
    const library = await managedLibrary(tx, eid);
    if (!library || library.workspace_id !== provider.workspaceId || (profile?.configuration as Row)?.model !== provider.model
      || library.index_profile_id !== String(profile?.id)) fail('context_changed');
    const binding = (await one(tx, sql`insert into app.assistant_managed_knowledge_imports
      (enterprise_id,job_id,version_id,edit_version,content_hash,workspace_id,version_tag)
      values(${eid},${jobId},${String(v.id)},${Number(v.edit_version)},${String(v.content_hash)},${library.workspace_id},${'xk-' + randomUUID()})
      on conflict (enterprise_id,job_id) do update set job_id=excluded.job_id returning *`))!;
    if (binding.revoked_at || binding.edit_version !== v.edit_version || binding.content_hash !== v.content_hash) fail('context_changed');
    if (Date.now() - new Date(String(binding.created_at)).getTime() > maxImportAgeMs) fail('bailian_knowledge_index_timeout', 503);
    return { library, job, v, binding };
  });
  const { library, v, binding } = admitted;
  const file = v.source_type === 'file' ? v.source_file as SourceFile : undefined;
  const passages = file ? reviewedFilePassages(file) : approvedTextPassages(rendered);
  const tag = String(binding.version_tag);

  async function pending() {
    await withTenantTransaction(eid, async tx => {
      await target(tx);
      await tx.execute(sql`update app.assistant_jobs set status='queued',available_at=now()+interval '4 seconds',
        attempts=greatest(attempts-1,0),lease_token=null,lease_expires_at=null,updated_at=now()
        where enterprise_id=${eid} and id=${jobId}`);
    });
  }

  let fileId = binding.file_id ? String(binding.file_id) : null;
  if (!fileId) {
    const original = file && !file.review!.excluded.length ? await withTenantTransaction(eid, async tx => {
      await target(tx);
      const asset = await one(tx, sql`select data,source_hash from app.assistant_knowledge_assets
        where enterprise_id=${eid} and id=${file.assetId} and document_id=${String(v.document_id)}`);
      if (!asset || asset.source_hash !== file.hash || !Buffer.isBuffer(asset.data)
        || createHash('sha256').update(new Uint8Array(asset.data)).digest('hex') !== file.hash) fail('context_changed');
      return asset.data;
    }) : null;
    fileId = await mutate('managed_upload', () => provider.upload({
      name: tag + '.' + (file && original ? file.format : 'txt'), data: original ?? Buffer.from(rendered), tag,
    }), async (tx, value) => {
      await tx.execute(sql`update app.assistant_managed_knowledge_imports set file_id=${value}
        where enterprise_id=${eid} and job_id=${jobId}`);
    });
  }
  const parsed = await provider.fileStatus(fileId);
  if (parsed.value === 'pending') return pending();
  if (parsed.value !== 'ready') fail('bailian_knowledge_parse_failed', 422);

  let indexId = library.index_id;
  let ingestionId = binding.ingestion_id ? String(binding.ingestion_id) : null;
  const importedFile = fileId;
  if (!indexId) {
    const provision = await withTenantTransaction(eid, async tx => {
      await target(tx);
      return one(tx, sql`update app.assistant_managed_knowledge_libraries set provision_job_id=${jobId}
        where enterprise_id=${eid} and index_id is null and (provision_job_id is null or provision_job_id=${jobId} or (
          exists(select 1 from app.assistant_jobs old where old.enterprise_id=${eid} and old.id=provision_job_id and old.status in ('cancelled','failed'))
          and not exists(select 1 from app.assistant_knowledge_attempts a where a.enterprise_id=${eid} and a.job_id=provision_job_id
            and a.operation='managed_create' and a.status in ('started','unknown','succeeded'))
        )) returning index_name`);
    });
    if (!provision) return pending();
    indexId = await mutate('managed_create', () => provider.createIndex(library.index_name, importedFile), async (tx, value) => {
      await tx.execute(sql`update app.assistant_managed_knowledge_libraries set index_id=${value},provision_job_id=null
        where enterprise_id=${eid} and provision_job_id=${jobId} and index_id is null`);
      await tx.execute(sql`update app.assistant_managed_knowledge_imports set created_index=true
        where enterprise_id=${eid} and job_id=${jobId}`);
    });
  } else if (!binding.created_index && !ingestionId) {
    const destination = indexId;
    ingestionId = await mutate('managed_import', () => provider.importDocument(destination, importedFile), async (tx, value) => {
      await tx.execute(sql`update app.assistant_managed_knowledge_imports set ingestion_id=${value}
        where enterprise_id=${eid} and job_id=${jobId}`);
    });
  }
  if (ingestionId) {
    const ingestion = await provider.importStatus(indexId, ingestionId);
    if (ingestion.value === 'pending') return pending();
    if (ingestion.value !== 'ready') fail('bailian_knowledge_index_failed', 503);
  }
  const document = await findManagedDocument(provider, indexId, fileId, tag);
  if (!document || ['PENDING','RUNNING','PROCESSING','INIT'].includes(document.status)) return pending();
  if (document.status !== 'FINISH') fail('bailian_knowledge_index_failed', 503);

  const slices: ManagedSlice[] = [];
  let requestId: string | null = null;
  for (let page = 1; page <= 3; page++) {
    const response = await provider.listSlices(indexId, document.id, page);
    requestId = response.requestId;
    if (response.value.total > 3 * MANAGED_PAGE_SIZE) fail('knowledge_file_block_limit', 422);
    slices.push(...response.value.slices);
    if (page * MANAGED_PAGE_SIZE >= response.value.total) break;
  }
  const chunks = bindManagedSlices(passages, slices, { indexId, workspaceId: library.workspace_id, documentId: document.id });
  const coveredPassages = new Set(chunks.map(chunk => chunk.start));
  if (!chunks.length || passages.some(p => p.original.trim() && p.file?.kind !== 'heading' && !coveredPassages.has(p.start)))
    fail('bailian_knowledge_source_unverified', 422);
  if (chunks.length > 512) fail('knowledge_file_block_limit', 422);
  await withTenantTransaction(eid, async tx => {
    const { job } = await target(tx);
    const updated = await one(tx, sql`update app.assistant_managed_knowledge_imports
      set index_document_id=${document.id},ready=true,indexed_request_id=${requestId}
      where enterprise_id=${eid} and job_id=${jobId} and revoked_at is null returning job_id`);
    if (!updated) fail('context_changed');
    await tx.execute(sql`delete from app.assistant_knowledge_chunks where enterprise_id=${eid} and document_version_id=${String(v.id)}`);
    for (const [ordinal, chunk] of chunks.entries()) {
      const locator = { start:chunk.start, end:chunk.end, unit:'unicode_code_point', managed:chunk.slice,
        ...(chunk.file ? {file:chunk.file} : {}) };
      await tx.execute(sql`insert into app.assistant_knowledge_chunks
        (enterprise_id,document_version_id,index_profile_id,ordinal,text,text_hash,content_hash,locator,terms)
        values(${eid},${String(v.id)},${String(job.index_profile_id)},${ordinal},${chunk.text},${fingerprint(chunk.text)},${String(v.content_hash)},
        ${JSON.stringify(locator)}::jsonb,ARRAY(select jsonb_array_elements_text(${JSON.stringify(chineseTerms(chunk.text))}::jsonb)))`);
    }
    await tx.execute(sql`update app.assistant_knowledge_versions set index_status='ready',indexed_hash=content_hash,
      chunk_count=${chunks.length},updated_at=now() where enterprise_id=${eid} and id=${String(v.id)}`);
    await tx.execute(sql`update app.assistant_jobs set status='succeeded',lease_token=null,lease_expires_at=null,last_error=null,updated_at=now(),
      version=version+1 where enterprise_id=${eid} and id=${jobId}`);
  });
}
