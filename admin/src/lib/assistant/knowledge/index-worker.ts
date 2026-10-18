import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { AssistantError, fail, fingerprint, type EmbeddingGateway } from '../contracts';
import { embeddingGateway, EMBEDDING_PROFILE } from '../infrastructure/embedding-gateway';
import { activeProfile, content, knowledgeManager, type KnowledgeActor } from './service';
import { chunkDocument, type Chunk } from './chunk-gateway';
import { chineseTerms } from './chinese-lexical';

export type KnowledgeLease = { actor: KnowledgeActor; jobId: string; token: string };
async function target(tx: PostgresTransaction, lease: KnowledgeLease) {
  const settings = await knowledgeManager(tx,lease.actor,true);
  const job = await one(tx,sql`select * from app.assistant_jobs where enterprise_id=${lease.actor.enterpriseId} and id=${lease.jobId}
    and kind='knowledge_index' and status='running' and lease_token=${lease.token} and lease_expires_at>now() for update`);
  if (!job) fail('context_changed');
  const profile = await activeProfile(tx,lease.actor.enterpriseId,settings);
  const v = await one(tx,sql`select v.*,d.source_type from app.assistant_knowledge_versions v join app.assistant_knowledge_documents d
    on d.enterprise_id=v.enterprise_id and d.id=v.document_id where v.enterprise_id=${lease.actor.enterpriseId} and v.id=${String(job.knowledge_version_id)}
    and d.status<>'retired' and v.published_at is null and v.index_status='indexing' for update of v,d`);
  if (!v || v.content_hash!==job.content_hash || Number(v.edit_version)!==Number(job.knowledge_edit_version) || String(profile.id)!==String(job.index_profile_id)
    || String(v.index_profile_id)!==String(profile.id)) fail('context_changed');
  return {job,v};
}
async function stop(tx: PostgresTransaction, job: Row, status: string, code: string) {
  await tx.execute(sql`update app.assistant_jobs set status=${status},last_error=${code},lease_token=null,lease_expires_at=null,updated_at=now(),version=version+1
    where enterprise_id=${String(job.enterprise_id)} and id=${String(job.id)}`);
  await tx.execute(sql`update app.assistant_knowledge_versions set index_status='failed',updated_at=now() where enterprise_id=${String(job.enterprise_id)}
    and id=${String(job.knowledge_version_id)} and edit_version=${Number(job.knowledge_edit_version)} and content_hash=${String(job.content_hash)} and index_status='indexing' and published_at is null`);
  await tx.execute(sql`update app.assistant_knowledge_attempts set status='unknown',error_code='provider_outcome_unknown',completed_at=now()
    where enterprise_id=${String(job.enterprise_id)} and job_id=${String(job.id)} and status='started'`);
}
export async function claimKnowledgeJob(): Promise<KnowledgeLease|null> {
  const candidates = await withPlatformTransaction(tx=>rows(tx,sql`select enterprise_id,id from app.assistant_jobs where kind='knowledge_index'
    and ((status='queued' and available_at<=now()) or (status='running' and lease_expires_at<=now())) order by available_at,id limit 50`));
  for (const c of candidates) {
    const lease = await withTenantTransaction(String(c.enterprise_id),async tx=>{
      if (!await one(tx,sql`select id from app.assistant_enterprise_settings where enterprise_id=${String(c.enterprise_id)} for update skip locked`)) return null;
      const job = await one(tx,sql`select * from app.assistant_jobs where enterprise_id=${String(c.enterprise_id)} and id=${String(c.id)} and kind='knowledge_index'
        and ((status='queued' and available_at<=now()) or (status='running' and lease_expires_at<=now())) for update skip locked`);
      if (!job) return null;
      if (job.provider_started_at) { await stop(tx,job,'indeterminate','provider_outcome_unknown'); return null; }
      if (Number(job.attempts)>=3) { await stop(tx,job,'failed','retry_exhausted'); return null; }
      const l = {actor:{enterpriseId:String(c.enterprise_id),adminId:String(job.requested_by)},jobId:String(c.id),token:randomUUID()};
      await tx.execute(sql`update app.assistant_jobs set status='running',attempts=attempts+1,lease_token=${l.token},lease_expires_at=now()+interval '150 seconds',heartbeat_at=now(),updated_at=now()
        where enterprise_id=${l.actor.enterpriseId} and id=${l.jobId}`);
      try { await target(tx,l); } catch(e) { if (!(e instanceof AssistantError)) throw e; await stop(tx,job,'failed',e.code); return null; }
      return l;
    });
    if (lease) return lease;
  }
  return null;
}
type Dependencies = { chunk: (text: string)=>Promise<Chunk[]>; embedding: EmbeddingGateway };
/** Persist each dispatch before I/O. A crashed/ambiguous attempt is never automatically replayed. */
export async function runKnowledgeJob(lease: KnowledgeLease, deps?: Dependencies) {
  const eid=lease.actor.enterpriseId;
  async function call<T>(operation: string, ordinal: number, fn: ()=>Promise<T>, tokens: (result:T)=>number|null): Promise<T> {
    const attempt = await withTenantTransaction(eid,async tx=>{
      await target(tx,lease);
      await tx.execute(sql`update app.assistant_jobs set provider_started_at=coalesce(provider_started_at,now()),lease_expires_at=now()+interval '150 seconds',heartbeat_at=now() where enterprise_id=${eid} and id=${lease.jobId}`);
      return (await one(tx,sql`insert into app.assistant_knowledge_attempts(enterprise_id,job_id,lease_token,operation,batch_ordinal,profile_key,model_revision,status)
        values(${eid},${lease.jobId},${lease.token},${operation},${ordinal},${EMBEDDING_PROFILE.id},${EMBEDDING_PROFILE.revision},'started') returning id`))!;
    });
    const result = await fn();
    await withTenantTransaction(eid,tx=>tx.execute(sql`update app.assistant_knowledge_attempts set status='succeeded',input_tokens=${tokens(result)},completed_at=now()
      where enterprise_id=${eid} and id=${String(attempt.id)} and status='started'`));
    return result;
  }
  try {
    const started=Date.now();
    const {v} = await withTenantTransaction(eid,tx=>target(tx,lease));
    const c=content(String(v.source_type),v);
    if (c.hash!==v.content_hash) fail('context_changed');
    const gateway=deps?.embedding ?? embeddingGateway();
    const chunks=await call('chunk',0,()=> (deps?.chunk ?? chunkDocument)(c.rendered),()=>null);
    const vectors:number[][]=[];
    for (let i=0;i<chunks.length;i+=8) {
      if (Date.now()-started>110000) fail('index_deadline_exceeded',503);
      const result=await call('embed',i/8,()=>gateway.embed(chunks.slice(i,i+8).map(x=>x.text),'document'),r=>r.usage?.inputTokens ?? null);
      vectors.push(...result.vectors);
    }
    await withTenantTransaction(eid,async tx=>{
      const {job}=await target(tx,lease);
      await tx.execute(sql`delete from app.assistant_knowledge_chunks where enterprise_id=${eid} and document_version_id=${String(job.knowledge_version_id)}`);
      for (let i=0;i<chunks.length;i++) {
        const chunk=chunks[i];
        await tx.execute(sql`insert into app.assistant_knowledge_chunks(enterprise_id,document_version_id,index_profile_id,ordinal,text,text_hash,content_hash,locator,terms,embedding)
          values(${eid},${String(job.knowledge_version_id)},${String(job.index_profile_id)},${i},${chunk.text},${fingerprint(chunk.text)},${String(job.content_hash)},
          ${JSON.stringify({start:chunk.start,end:chunk.end,tokens:chunk.tokens,unit:'unicode_code_point'})}::jsonb,
          ARRAY(select jsonb_array_elements_text(${JSON.stringify(chineseTerms(chunk.text))}::jsonb)),${JSON.stringify(vectors[i])}::vector)`);
      }
      await tx.execute(sql`update app.assistant_knowledge_versions set index_status='ready',indexed_hash=content_hash,chunk_count=${chunks.length},updated_at=now()
        where enterprise_id=${eid} and id=${String(job.knowledge_version_id)}`);
      await tx.execute(sql`update app.assistant_jobs set status='succeeded',lease_token=null,lease_expires_at=null,last_error=null,updated_at=now(),version=version+1 where enterprise_id=${eid} and id=${lease.jobId}`);
    });
  } catch(e) {
    await withTenantTransaction(eid,async tx=>{
      await tx.execute(sql`select id from app.assistant_enterprise_settings where enterprise_id=${eid} for update`);
      const job=await one(tx,sql`select * from app.assistant_jobs where enterprise_id=${eid} and id=${lease.jobId} and status='running' and lease_token=${lease.token} for update`);
      if (!job) {
        await tx.execute(sql`update app.assistant_knowledge_attempts set status='unknown',error_code='provider_outcome_unknown',completed_at=now()
          where enterprise_id=${eid} and job_id=${lease.jobId} and lease_token=${lease.token} and status='started'`);
        return;
      }
      const pending=await one(tx,sql`select id from app.assistant_knowledge_attempts where enterprise_id=${eid} and job_id=${lease.jobId} and status='started' limit 1`);
      await stop(tx,job,pending?'indeterminate':'failed',pending?'provider_outcome_unknown':e instanceof AssistantError?e.code:'index_failed');
    });
  }
}
export async function processKnowledgeJob() {
  const lease=await claimKnowledgeJob();
  if (lease) await runKnowledgeJob(lease);
  return Boolean(lease);
}
