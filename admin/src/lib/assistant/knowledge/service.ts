import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { idempotent } from '../core/conversation';
import { fail, fingerprint, id, type ActorContext } from '../contracts';
import { EMBEDDING_PROFILE } from '../infrastructure/embedding-gateway';
import { authorizeKnowledgeManager } from './manager';
import { prepareReferenceCase, referenceContent } from './reference-case';
import { createContentEntry, contentChannel } from './content-entry';
import { professionalKnowledge, professionalText } from './professional';
import { fileContent, uploadedFile } from './source-file';
import { storeOriginal, queueFileParse, reviewFile } from './file-service';
import type { SourceFile } from '../contracts/source-file';

export type KnowledgeActor = { enterpriseId: string; adminId: string };
export function text(value: unknown, max: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.includes('\0') || value.length > max || (!allowEmpty && !value.trim())) fail('invalid_message', 422);
  return value.trim();
}
export function expected(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) fail('invalid_message', 422);
  return Number(value);
}
export function content(source: string, input: Row) {
  if (source === 'file') {
    const file = input.source_file as SourceFile | null;
    if (!file?.parsed || !file.review || input.professional != null) fail('knowledge_file_review_required');
    const c = fileContent(file);
    return { ...c, faq: [], reference: null, professional: null };
  }
  const body = text(input.body ?? '', 16000, true);
  if (source === 'reference_case') {
    if (Array.isArray(input.faq) && input.faq.length) fail('invalid_reference_case', 422);
    const c = referenceContent(body, input.referenceCase ?? input.reference_case);
    return { body, faq: [], rendered: c.rendered, hash: c.hash, reference: c.reference, professional: null };
  }
  if (input.referenceCase != null || input.reference_case != null) fail('invalid_reference_case', 422);
  const faq = input.faq ?? [];
  if (!Array.isArray(faq) || faq.length > 100) fail('invalid_message', 422);
  const items = faq.map(item => {
    if (!item || typeof item !== 'object' || Object.keys(item).some(k => !['question','answer'].includes(k))) fail('invalid_message', 422);
    return { question: text(item.question, 500), answer: text(item.answer, 4000) };
  });
  if ((source === 'manual_text' && (!body || items.length)) || (source === 'faq' && (body || !items.length))) fail('invalid_message', 422);
  const professional = professionalKnowledge(input.professional);
  const original = source === 'faq' ? items.map(f => `问：${f.question}\n答：${f.answer}`).join('\n\n') : body;
  const rendered = professional ? professionalText(professional)+'\n\n'+original : original;
  if (rendered.length > 16000 || Buffer.byteLength(rendered) > 48000) fail('invalid_message', 422);
  return { body, faq: items, rendered, hash: fingerprint({ source, body, faq: items, ...(professional ? {professional} : {}) }), reference: null, professional };
}
function validity(input: Row) {
  const date = (v: unknown): string => {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v) || !Number.isFinite(Date.parse(v))) fail('invalid_message', 422);
    return new Date(v).toISOString();
  };
  const from = input.effectiveFrom === undefined ? null : date(input.effectiveFrom);
  const to = input.effectiveTo == null ? null : date(input.effectiveTo);
  if (from && to && from >= to) fail('invalid_message', 422);
  return { from, to };
}
/** Re-read bound staff and enterprise for every operation, including worker completion. */
export async function knowledgeManager(tx: PostgresTransaction, actor: KnowledgeActor, enabled = false) {
  await authorizeKnowledgeManager(tx,actor.enterpriseId,actor.adminId);
  await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id) values(${actor.enterpriseId}) on conflict(enterprise_id) do nothing`);
  const settings = (await one(tx, sql`select * from app.assistant_enterprise_settings where enterprise_id=${actor.enterpriseId} for update`))!;
  if (enabled && !settings.enabled) fail('assistant_disabled', 403);
  return settings;
}
export async function activeProfile(tx: PostgresTransaction, enterpriseId: string, settings: Row, initialize = false) {
  if (!settings.active_index_profile_id && initialize) {
    const profile = (await one(tx, sql`insert into app.assistant_knowledge_index_profiles(enterprise_id,profile_key,configuration)
      values(${enterpriseId},${EMBEDDING_PROFILE.id},${JSON.stringify(EMBEDDING_PROFILE)}::jsonb)
      on conflict(enterprise_id,profile_key) do update set profile_key=excluded.profile_key returning *`))!;
    await tx.execute(sql`update app.assistant_enterprise_settings set active_index_profile_id=${String(profile.id)} where enterprise_id=${enterpriseId}`);
    settings.active_index_profile_id = profile.id;
  }
  const profile = await one(tx, sql`select * from app.assistant_knowledge_index_profiles where enterprise_id=${enterpriseId} and id=${settings.active_index_profile_id ?? null} and status='active'`);
  if (!profile || fingerprint(profile.configuration) !== fingerprint(EMBEDDING_PROFILE)) fail('retrieval_unavailable', 503);
  return profile;
}
export async function knowledgeEvent(tx: PostgresTransaction, actor: KnowledgeActor, documentId: string, type: string, documentVersion: number) {
  const settings = (await one(tx, sql`update app.assistant_enterprise_settings set knowledge_epoch=knowledge_epoch+1,version=version+1,updated_at=now()
    where enterprise_id=${actor.enterpriseId} returning knowledge_epoch`))!;
  const event = (await one(tx, sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
    values(${actor.enterpriseId},${type},'knowledge_document',${documentId},${documentVersion},${JSON.stringify({kind:'admin',adminId:actor.adminId})}::jsonb,
    ${randomUUID()},${JSON.stringify({knowledgeEpoch: settings.knowledge_epoch})}::jsonb) returning id`))!;
  await tx.execute(sql`insert into app.domain_event_deliveries(enterprise_id,event_id,consumer_key) values(${actor.enterpriseId},${String(event.id)},'assistant.knowledge.visibility.v1')`);
}
export class KnowledgeService {
  constructor(readonly actor: KnowledgeActor) {}
  async execute(action: string, input: Row = {}, requestKey?: string): Promise<Row> {
    const a = this.actor;
    return withTenantTransaction(a.enterpriseId, async tx => {
      const settings = await knowledgeManager(tx, a, ['index','publish','createFile','replaceFile','parse'].includes(action));
      if (input.referenceCase != null) input = { ...input, referenceCase: await prepareReferenceCase(input.referenceCase) };
      const read = ['list','detail','job'].includes(action);
      const run = async (): Promise<Row> => {
        if (action === 'list') {
          const limit = input.limit === undefined ? 20 : expected(input.limit);
          if (limit > 100) fail('invalid_message',422);
          return { items: await rows(tx, sql`select * from app.assistant_knowledge_documents where enterprise_id=${a.enterpriseId}
            ${input.beforeId ? sql`and id<${id(input.beforeId)}` : sql``} order by id desc limit ${limit}`) };
        }
        if (action === 'job') {
          const job = await one(tx, sql`select id,knowledge_version_id,index_profile_id,status,attempts,last_error,created_at,updated_at from app.assistant_jobs
            where enterprise_id=${a.enterpriseId} and id=${id(input.jobId)} and kind in ('knowledge_index','knowledge_parse')`);
          if (!job) fail('assistant_resource_not_found',404);
          return job;
        }
        if (action === 'createFile') {
          const audience = input.audience ?? 'staff_internal';
          if (!['customer_public','staff_internal'].includes(String(audience))) fail('invalid_message',422);
          const d = (await one(tx,sql`insert into app.assistant_knowledge_documents(enterprise_id,title,category,source_type,audience,created_by,updated_by)
            values(${a.enterpriseId},${text(input.title,200)},${text(input.category ?? '',100,true)},'file',${String(audience)},${a.adminId},${a.adminId}) returning *`))!;
          const file = await storeOriginal(tx,a,String(d.id),input), c = fileContent(file);
          const v = (await one(tx,sql`insert into app.assistant_knowledge_versions(enterprise_id,document_id,version_number,source_asset_id,source_file,content_hash,created_by)
            values(${a.enterpriseId},${String(d.id)},1,${file.assetId},${JSON.stringify(file)}::jsonb,${c.hash},${a.adminId}) returning *`))!;
          return {document:d,draft:v,...await queueFileParse(tx,a,v)};
        }
        if (action === 'create') {
          const source = input.sourceType;
          if (!['faq','manual_text','reference_case'].includes(String(source)) || !['customer_public','staff_internal'].includes(String(input.audience))) fail('invalid_message',422);
          if (source==='reference_case' && input.professional != null) fail('invalid_professional_knowledge',422);
          const c = content(String(source),{...input,professional:professionalKnowledge(input.professional,{adminId:a.adminId,reviewedAt:new Date().toISOString()})}), dates = validity(input);
          const d = (await one(tx, sql`insert into app.assistant_knowledge_documents(enterprise_id,title,category,source_type,audience,created_by,updated_by)
            values(${a.enterpriseId},${text(input.title,200)},${text(input.category ?? '',100,true)},${String(source)},${String(input.audience)},${a.adminId},${a.adminId}) returning *`))!;
          const v = (await one(tx, sql`insert into app.assistant_knowledge_versions(enterprise_id,document_id,version_number,body,faq,reference_case,professional,content_hash,effective_from,effective_to,created_by)
            values(${a.enterpriseId},${String(d.id)},1,${c.body},${JSON.stringify(c.faq)}::jsonb,${c.reference ? JSON.stringify(c.reference) : null}::jsonb,${c.professional ? JSON.stringify(c.professional) : null}::jsonb,${c.hash},coalesce(${dates.from}::timestamptz,now()),${dates.to}::timestamptz,${a.adminId}) returning *`))!;
          return { document: d, draft: v };
        }
        const d = await one(tx, sql`select * from app.assistant_knowledge_documents where enterprise_id=${a.enterpriseId} and id=${id(input.documentId)} for update`);
        if (!d) fail('assistant_resource_not_found',404);
        const did = String(d.id);
        if (action === 'detail') return { document: d, versions: await rows(tx, sql`select v.*,
          (select jsonb_build_object('id',j.id::text,'status',j.status,'last_error',j.last_error,'attempts',j.attempts) from app.assistant_jobs j
            where j.enterprise_id=v.enterprise_id and j.knowledge_version_id=v.id and j.kind='knowledge_parse' order by j.id desc limit 1) as parse_job
          from app.assistant_knowledge_versions v where v.enterprise_id=${a.enterpriseId} and v.document_id=${did} order by v.version_number desc`) };
        if (action === 'share') {
          if (expected(input.expectedVersion)!==Number(d.version) || d.status!=='active' || d.audience!=='customer_public' || d.source_type!=='reference_case') fail('reference_unavailable');
          const version=await one(tx,sql`select * from app.assistant_knowledge_versions where enterprise_id=${a.enterpriseId} and id=${String(d.published_version_id)}
            and published_at is not null and index_status='ready' and indexed_hash=content_hash and effective_from<=now() and (effective_to is null or effective_to>now())`);
          if (!version) fail('reference_unavailable');
          content('reference_case',version);
          await contentChannel(tx,a.enterpriseId,input.entryCode);
          return createContentEntry(a.enterpriseId,d,version,input.entryCode as string|undefined);
        }
        if (['metadata','newVersion','retire','publish'].includes(action) && expected(input.expectedVersion) !== Number(d.version)) fail('version_conflict');
        if (action === 'metadata') {
          const audience = input.audience ?? d.audience;
          if (!['customer_public','staff_internal'].includes(String(audience))) fail('invalid_message',422);
          const result = (await one(tx, sql`update app.assistant_knowledge_documents set title=${text(input.title ?? d.title,200)},category=${text(input.category ?? d.category,100,true)},
            audience=${String(audience)},updated_by=${a.adminId},version=version+1,updated_at=now() where enterprise_id=${a.enterpriseId} and id=${did} returning *`))!;
          await knowledgeEvent(tx,a,did,'assistant.knowledge.visibility.v1',Number(result.version)); return result;
        }
        if (action === 'retire') {
          const result = (await one(tx, sql`update app.assistant_knowledge_documents set status='retired',version=version+1,updated_at=now(),updated_by=${a.adminId}
            where enterprise_id=${a.enterpriseId} and id=${did} returning *`))!;
          await tx.execute(sql`update app.assistant_jobs set status='cancelled',lease_token=null,lease_expires_at=null,last_error='context_changed',updated_at=now()
            where enterprise_id=${a.enterpriseId} and knowledge_version_id in (select id from app.assistant_knowledge_versions where enterprise_id=${a.enterpriseId} and document_id=${did}) and status in ('queued','running')`);
          await knowledgeEvent(tx,a,did,'assistant.knowledge.retired.v1',Number(result.version));return result;
        }
        const v = await one(tx, sql`select * from app.assistant_knowledge_versions where enterprise_id=${a.enterpriseId} and document_id=${did} and id=${id(action==='newVersion'?input.fromVersionId:input.versionId)} for update`);
        if (!v) fail('assistant_resource_not_found',404);
        if (action === 'newVersion') {
          const next = (await one(tx, sql`select max(version_number)+1 as n from app.assistant_knowledge_versions where enterprise_id=${a.enterpriseId} and document_id=${did}`))!;
          await tx.execute(sql`update app.assistant_knowledge_documents set version=version+1,updated_by=${a.adminId},updated_at=now() where enterprise_id=${a.enterpriseId} and id=${did}`);
          return (await one(tx, sql`insert into app.assistant_knowledge_versions(enterprise_id,document_id,version_number,body,faq,reference_case,professional,source_asset_id,source_file,content_hash,effective_from,effective_to,created_by)
            values(${a.enterpriseId},${did},${Number(next.n)},${String(v.body)},${JSON.stringify(v.faq)}::jsonb,${v.reference_case ? JSON.stringify(v.reference_case) : null}::jsonb,${v.professional ? JSON.stringify(v.professional) : null}::jsonb,${v.source_asset_id ?? null},${v.source_file ? JSON.stringify(v.source_file) : null}::jsonb,${String(v.content_hash)},${v.effective_from as Date},${v.effective_to as Date|null},${a.adminId}) returning *`))!;
        }
        if (expected(input.expectedEditVersion) !== Number(v.edit_version)) fail('version_conflict');
        if (['replaceFile','reviewFile','parse','cancelParse'].includes(action)) {
          if (d.source_type!=='file' || v.published_at || d.status==='retired') fail('version_conflict');
          if (action==='parse') {
            if ((v.source_file as SourceFile).parsed) fail('version_conflict');
            const old=await one(tx,sql`select * from app.assistant_jobs where enterprise_id=${a.enterpriseId} and knowledge_version_id=${String(v.id)} and kind='knowledge_parse' order by id desc limit 1 for update`);
            if (old && ['failed','cancelled'].includes(String(old.status)) && Number(old.knowledge_edit_version)===Number(v.edit_version) && Number(old.attempts)<3) {
              await tx.execute(sql`update app.assistant_jobs set status='queued',last_error=null,available_at=now(),updated_at=now() where enterprise_id=${a.enterpriseId} and id=${String(old.id)}`);
              return {jobId:String(old.id),status:'queued'};
            }
            return queueFileParse(tx,a,v);
          }
          if (action==='replaceFile' && uploadedFile(input).hash===(v.source_file as SourceFile).hash) {
            const job=await one(tx,sql`select id,status,last_error from app.assistant_jobs where enterprise_id=${a.enterpriseId} and knowledge_version_id=${String(v.id)} and kind='knowledge_parse' order by id desc limit 1`);
            return {draft:v,jobId:job?String(job.id):null,status:job?.status ?? 'succeeded'};
          }
          await tx.execute(sql`update app.assistant_jobs set status='cancelled',lease_token=null,lease_expires_at=null,last_error='context_changed',updated_at=now()
            where enterprise_id=${a.enterpriseId} and knowledge_version_id=${String(v.id)} and status in ('queued','running')`);
          if (action==='reviewFile') return reviewFile(tx,a,v,input);
          if (action==='cancelParse') return {versionId:String(v.id),status:'cancelled'};
          const file=await storeOriginal(tx,a,did,input),c=fileContent(file);
          const updated=(await one(tx,sql`update app.assistant_knowledge_versions set source_asset_id=${file.assetId},source_file=${JSON.stringify(file)}::jsonb,body='',faq='[]',content_hash=${c.hash},edit_version=edit_version+1,
            index_status='pending',indexed_hash=null,chunk_count=0,updated_at=now() where enterprise_id=${a.enterpriseId} and id=${String(v.id)} returning *`))!;
          return {draft:updated,...await queueFileParse(tx,a,updated)};
        }
        if (action === 'edit') {
          if (v.published_at) fail('version_conflict');
          if (d.source_type==='file' && (input.body!==undefined || input.faq!==undefined || input.professional!=null)) fail('invalid_message',422);
          if (d.source_type==='reference_case' && input.professional != null) fail('invalid_professional_knowledge',422);
          const c = content(String(d.source_type),{source_file:v.source_file,body:input.body ?? v.body,faq:input.faq ?? v.faq,referenceCase:input.referenceCase ?? v.reference_case,
            professional:professionalKnowledge(input.professional===undefined?v.professional:input.professional,{adminId:a.adminId,reviewedAt:new Date().toISOString()})});
          const dates = validity({effectiveFrom: input.effectiveFrom ?? new Date(String(v.effective_from)).toISOString(), effectiveTo: input.effectiveTo === undefined ? (v.effective_to ? new Date(String(v.effective_to)).toISOString() : null) : input.effectiveTo});
          await tx.execute(sql`update app.assistant_jobs set status='cancelled',lease_token=null,lease_expires_at=null,last_error='context_changed',updated_at=now()
            where enterprise_id=${a.enterpriseId} and knowledge_version_id=${String(v.id)} and status in ('queued','running')`);
          return (await one(tx, sql`update app.assistant_knowledge_versions set body=${c.body},faq=${JSON.stringify(c.faq)}::jsonb,reference_case=${c.reference ? JSON.stringify(c.reference) : null}::jsonb,professional=${c.professional ? JSON.stringify(c.professional) : null}::jsonb,content_hash=${c.hash},edit_version=edit_version+1,
            index_status='pending',indexed_hash=null,chunk_count=0,effective_from=${dates.from}::timestamptz,effective_to=${dates.to}::timestamptz,updated_at=now()
            where enterprise_id=${a.enterpriseId} and id=${String(v.id)} returning *`))!;
        }
        const profile = await activeProfile(tx,a.enterpriseId,settings,true);
        if (action === 'index') {
          if (v.published_at || d.status==='retired') fail('version_conflict');
          content(String(d.source_type),v);
          const dedupe = `knowledge:${v.id}:${v.edit_version}:${v.content_hash}:${profile.id}`;
          const old = await one(tx,sql`select id,status from app.assistant_jobs where enterprise_id=${a.enterpriseId} and dedupe_key=${dedupe}`);
          if (old) return {jobId:String(old.id),status:old.status};
          const pending = (await one(tx,sql`select count(*) n from app.assistant_jobs where enterprise_id=${a.enterpriseId} and kind in ('knowledge_index','knowledge_parse') and status in ('queued','running')`))!;
          if (Number(pending.n)>=10) fail('assistant_quota_exceeded',429);
          const job = (await one(tx, sql`insert into app.assistant_jobs(enterprise_id,kind,knowledge_version_id,index_profile_id,content_hash,knowledge_edit_version,requested_by,dedupe_key)
            values(${a.enterpriseId},'knowledge_index',${String(v.id)},${String(profile.id)},${String(v.content_hash)},${Number(v.edit_version)},${a.adminId},${dedupe}) returning id,status`))!;
          await tx.execute(sql`update app.assistant_knowledge_versions set index_status='indexing',index_profile_id=${String(profile.id)},indexed_hash=null,updated_at=now()
            where enterprise_id=${a.enterpriseId} and id=${String(v.id)}`);
          return {jobId:String(job.id),status:job.status};
        }
        if (action === 'publish') {
          // A future replacement must not hide the still-effective published version.
          if (d.published_version_id && new Date(String(v.effective_from)).getTime()>Date.now()) fail('knowledge_not_ready');
          const ready = await one(tx,sql`select id from app.assistant_knowledge_versions where enterprise_id=${a.enterpriseId} and id=${String(v.id)}
            and index_status='ready' and indexed_hash=content_hash and index_profile_id=${String(profile.id)} and chunk_count>0
            and (effective_to is null or effective_to>now())`);
          if (!ready || content(String(d.source_type),v).hash!==v.content_hash) fail('knowledge_not_ready');
          const count = (await one(tx,sql`select count(*) n from app.assistant_knowledge_chunks where enterprise_id=${a.enterpriseId} and document_version_id=${String(v.id)}
            and index_profile_id=${String(profile.id)} and content_hash=${String(v.content_hash)}`))!;
          if (Number(count.n)!==Number(v.chunk_count)) fail('knowledge_not_ready');
          if (!v.published_at) await tx.execute(sql`update app.assistant_knowledge_versions set published_at=now(),published_by=${a.adminId} where enterprise_id=${a.enterpriseId} and id=${String(v.id)}`);
          const result = (await one(tx,sql`update app.assistant_knowledge_documents set published_version_id=${String(v.id)},status='active',version=version+1,updated_at=now(),updated_by=${a.adminId}
            where enterprise_id=${a.enterpriseId} and id=${did} returning *`))!;
          await knowledgeEvent(tx,a,did,'assistant.knowledge.published.v1',Number(result.version));return result;
        }
        return fail('assistant_resource_not_found',404);
      };
      if (read) return run();
      const actor: ActorContext = {enterpriseId:a.enterpriseId,principal:{kind:'admin',adminId:a.adminId},contextVersion:1,capabilities:[]};
      return idempotent(tx,actor,'knowledge:'+action,requestKey ?? '',input,run);
    });
  }
}
