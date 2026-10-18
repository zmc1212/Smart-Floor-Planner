import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import type { KnowledgeActor } from './service';
import { fail } from '../contracts';
import type { SourceFile } from '../contracts/source-file';
import { uploadedFile, fileContent } from './source-file';
import { withTenantTransaction } from '@/db/transaction';
import { authorizeKnowledgeManager } from './manager';
import { id } from '../contracts';

export function readOriginal(actor: KnowledgeActor, documentId: string, versionId: string) {
  return withTenantTransaction(actor.enterpriseId,async tx=>{
    await authorizeKnowledgeManager(tx,actor.enterpriseId,actor.adminId);
    const file=await one(tx,sql`select a.name,a.format,a.data,a.source_hash from app.assistant_knowledge_assets a
      join app.assistant_knowledge_versions v on v.enterprise_id=a.enterprise_id and v.document_id=a.document_id and v.source_asset_id=a.id
      join app.assistant_knowledge_documents d on d.enterprise_id=v.enterprise_id and d.id=v.document_id
      where a.enterprise_id=${actor.enterpriseId} and d.id=${id(documentId)} and v.id=${id(versionId)} and d.status<>'retired'`);
    if(!file) fail('assistant_resource_not_found',404);
    return file;
  });
}

export async function storeOriginal(tx: PostgresTransaction, actor: KnowledgeActor, documentId: string, input: Row): Promise<SourceFile> {
  const f = uploadedFile(input), old = await one(tx, sql`select id,name,format from app.assistant_knowledge_assets
    where enterprise_id=${actor.enterpriseId} and document_id=${documentId} and source_hash=${f.hash}`);
  if (old) return { version: 1, assetId: String(old.id), hash: f.hash, name: String(old.name), format: old.format as 'docx' | 'pdf', parsed: null, review: null };
  const quota = (await one(tx, sql`select count(*) n,coalesce(sum(octet_length(data)),0) bytes from app.assistant_knowledge_assets where enterprise_id=${actor.enterpriseId}`))!;
  if (Number(quota.n) >= 100 || Number(quota.bytes) + f.data.length > 100 * 1024 * 1024) fail('knowledge_file_storage_limit', 429);
  const asset = (await one(tx, sql`insert into app.assistant_knowledge_assets(enterprise_id,document_id,name,format,source_hash,usage_rights,data,uploaded_by)
    values(${actor.enterpriseId},${documentId},${f.name},${f.format},${f.hash},${f.authorization},${f.data},${actor.adminId}) returning id`))!;
  return { version: 1, assetId: String(asset.id), hash: f.hash, name: f.name, format: f.format as 'docx' | 'pdf', parsed: null, review: null };
}
export async function queueFileParse(tx: PostgresTransaction, actor: KnowledgeActor, v: Row) {
  const dedupe = `parse:${v.id}:${v.edit_version}:${v.content_hash}`;
  const old = await one(tx, sql`select id,status,last_error from app.assistant_jobs where enterprise_id=${actor.enterpriseId} and dedupe_key=${dedupe} for update`);
  if (old) return { jobId: String(old.id), status: old.status, last_error: old.last_error };
  const pending = (await one(tx, sql`select count(*) n from app.assistant_jobs where enterprise_id=${actor.enterpriseId} and kind in ('knowledge_parse','knowledge_index') and status in ('queued','running')`))!;
  if (Number(pending.n) >= 10) fail('assistant_quota_exceeded', 429);
  const job = (await one(tx, sql`insert into app.assistant_jobs(enterprise_id,kind,knowledge_version_id,content_hash,knowledge_edit_version,requested_by,dedupe_key)
    values(${actor.enterpriseId},'knowledge_parse',${String(v.id)},${String(v.content_hash)},${Number(v.edit_version)},${actor.adminId},${dedupe}) returning id,status`))!;
  return { jobId: String(job.id), status: job.status };
}
export async function reviewFile(tx: PostgresTransaction, actor: KnowledgeActor, v: Row, input: Row) {
  const original = v.source_file as SourceFile;
  if (!original.parsed || input.acknowledgeWarnings !== true || !Array.isArray(input.excludedBlockIds)
    || new Set(input.excludedBlockIds).size !== input.excludedBlockIds.length || input.excludedBlockIds.some(x => typeof x !== 'string' || !original.parsed!.blocks.some(b => b.id === x))) fail('knowledge_file_review_required', 422);
  const file: SourceFile = { ...original, review: { adminId: actor.adminId, at: new Date().toISOString(), excluded: [...input.excludedBlockIds] as string[] } };
  if (!file.parsed!.blocks.some(b => !file.review!.excluded.includes(b.id) && b.kind !== 'heading')) fail('knowledge_file_review_required', 422);
  const c = fileContent(file);
  return (await one(tx, sql`update app.assistant_knowledge_versions set source_file=${JSON.stringify(file)}::jsonb,body=${c.body},content_hash=${c.hash},edit_version=edit_version+1,
    index_status='pending',indexed_hash=null,chunk_count=0,updated_at=now() where enterprise_id=${actor.enterpriseId} and id=${String(v.id)} returning *`))!;
}
