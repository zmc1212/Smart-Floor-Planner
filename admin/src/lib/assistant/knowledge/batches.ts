import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { getPlatformLlmOverrideRuntime } from '@/lib/platform-llm-config';
import { listProviderRuntimes } from '@/lib/ai/provider-registry';
import { AssistantError, fail, id, type ActorContext } from '../contracts';
import { cancelRuns, idempotent } from '../core/conversation';
import { agentPromptVersion } from '../agent/context';
import { knowledgeManager, expected, text, type KnowledgeActor } from './service';
import { knowledgeProviderMode } from './bailian-provider';
import { managedLibrary } from './managed-store';

type Dependencies = {
  allocate: (tx: PostgresTransaction, c: Row, settings: Row) => Promise<string>;
  dispatch: (evaluationId: string, tx: PostgresTransaction) => Promise<unknown>;
  current: (tx: PostgresTransaction, evaluation: Row, settings: Row) => Promise<boolean>;
};
const json = (v: unknown) => JSON.stringify(v);
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,value])=>[k,canonical(value)]));
  return v;
}
const hash = (v: unknown) => createHash('sha256').update(json(canonical(v))).digest('hex');
const terminal = ['succeeded','failed','cancelled','indeterminate'];
const postgresIds=(ids:string[])=>sql`array[${sql.join(ids.map(value=>sql`${value}::bigint`),sql`, `)}]::bigint[]`;
async function modelConfiguration() {
  const override = await getPlatformLlmOverrideRuntime();
  const runtimes = override ? [override] : await listProviderRuntimes('chat', 'chat.general');
  return { protocol: 'knowledge-preview-selector-v1', configuredAgentPrompt: agentPromptVersion,
    disableThinking: process.env.ASSISTANT_TEXT_DISABLE_THINKING === '1',
    models: runtimes.filter(r => process.env.ASSISTANT_TEXT_MODEL?.trim() || r.modelMappings['chat.general']).map(r => ({
      id: String(r.id), key: r.key, adapter: r.adapterType, endpointHash: hash(r.baseUrl),
      model: process.env.ASSISTANT_TEXT_MODEL?.trim() || r.modelMappings['chat.general'],
    })) };
}
/** Durable grouping only. Dispatch and cancellation use the original evaluation/run protocol. */
export class KnowledgeBatches {
  constructor(readonly manager: KnowledgeActor, readonly actor: ActorContext, private deps: Dependencies) {}
  private tx<T>(work: (tx: PostgresTransaction, settings: Row) => Promise<T>, enabled = false) {
    return withTenantTransaction(this.manager.enterpriseId, async tx => work(tx, await knowledgeManager(tx, this.manager, enabled)));
  }
  private async batch(tx: PostgresTransaction, batchId: string, lock = false) {
    const b = await one(tx, sql`select * from app.assistant_knowledge_batches where enterprise_id=${this.manager.enterpriseId}
      and id=${id(batchId)} and created_by=${this.manager.adminId} ${lock ? sql`for update` : sql``}`);
    if (!b) fail('assistant_resource_not_found',404); return b;
  }
  private items(tx: PostgresTransaction, batchId: unknown) {
    return rows(tx, sql`select i.ordinal,i.state,e.*,r.status run_status,r.error_code run_error,
      r.completed_at,q.status reservation_status from app.assistant_knowledge_batch_items i
      join app.assistant_knowledge_evaluations e on e.enterprise_id=i.enterprise_id and e.id=i.evaluation_id
      left join app.assistant_runs r on r.enterprise_id=e.enterprise_id and r.id=e.run_id
      left join app.assistant_quota_reservations q on q.enterprise_id=r.enterprise_id and q.run_id=r.id
      where i.enterprise_id=${this.manager.enterpriseId} and i.batch_id=${String(batchId)} order by i.ordinal`);
  }
  private async configuration(tx: PostgresTransaction, s: Row) {
    const library = knowledgeProviderMode() === 'bailian' ? await managedLibrary(tx, this.manager.enterpriseId) : null;
    const p = await one(tx, sql`select id,configuration from app.assistant_knowledge_index_profiles
      where enterprise_id=${this.manager.enterpriseId} and id=${library?.index_profile_id ?? s.active_index_profile_id ?? null} and status='active'`);
    if (!p) fail('knowledge_not_ready');
    return { indexProfileId: String(p.id), profileHash: hash(p.configuration), agentConfigurationHash: hash(s.agent_config ?? null), ...await modelConfiguration() };
  }
  private async current(tx: PostgresTransaction, b: Row, s: Row, items: Row[]) {
    if (Number(b.knowledge_epoch) !== Number(s.knowledge_epoch)) return false;
    try{
      const { indexProfileId, ...configuration } = await this.configuration(tx,s);
      if (String(b.index_profile_id) !== indexProfileId || hash(b.configuration) !== hash(configuration)) return false;
    }
    catch(error){if(error instanceof AssistantError&&error.code==='knowledge_not_ready')return false;throw error;}
    for (const e of items) if (!await this.deps.current(tx,e,s)) return false;
    const models = (b.configuration as Awaited<ReturnType<KnowledgeBatches['configuration']>>).models;
    const runIds=items.filter(e=>e.run_id).map(e=>String(e.run_id));
    const attempts = runIds.length ? await rows(tx, sql`select a.provider_config_id::text,a.remote_model from app.ai_provider_attempts a
      where a.enterprise_id=${this.manager.enterpriseId} and a.assistant_run_id=any(${postgresIds(runIds)})`) : [];
    return attempts.every(a => models.some(m => m.id === String(a.provider_config_id) && m.model === a.remote_model));
  }
  async create(input: Row, requestKey: string) {
    const created=await this.tx(async (tx,s) => idempotent(tx,this.actor,'knowledge-batch:create',requestKey,input,async () => {
      if (!Array.isArray(input.cases) || !input.cases.length || input.cases.length > 20) fail('invalid_message',422);
      const targets = input.cases.map(value => {
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !['id','expectedVersion'].includes(k))) fail('invalid_message',422);
        const v = value as Row; return { id: id(v.id), version: expected(v.expectedVersion) };
      });
      if (new Set(targets.map(t=>t.id)).size !== targets.length) fail('invalid_message',422);
      const concurrency = input.concurrency === undefined ? 1 : expected(input.concurrency);
      if (concurrency > 3) fail('invalid_message',422);
      const n = await one(tx,sql`select count(*)::int n from app.assistant_knowledge_evaluations where enterprise_id=${this.manager.enterpriseId}`);
      if (Number(n!.n)+targets.length > 2000) fail('knowledge_evaluation_limit',422);
      const { indexProfileId, ...configuration } = await this.configuration(tx,s);
      const batch = await one(tx,sql`insert into app.assistant_knowledge_batches(enterprise_id,created_by,title,concurrency,configuration,knowledge_epoch,index_profile_id)
        values(${this.manager.enterpriseId},${this.manager.adminId},${text(input.title,120)},${concurrency},${json(configuration)}::jsonb,
        ${Number(s.knowledge_epoch)},${indexProfileId}) returning id`);
      // Stable lock order also prevents two overlapping batches from deadlocking on cases.
      const cases = new Map<string,Row>();
      for (const t of [...targets].sort((a,b)=>BigInt(a.id)<BigInt(b.id)?-1:1)) {
        const c = await one(tx,sql`select * from app.assistant_knowledge_cases where enterprise_id=${this.manager.enterpriseId} and id=${t.id} for update`);
        if (!c) fail('assistant_resource_not_found',404); if (Number(c.version)!==t.version) fail('version_conflict'); cases.set(t.id,c);
      }
      for (const [i,t] of targets.entries()) {
        const evaluationId = await this.deps.allocate(tx,cases.get(t.id)!,s);
        await tx.execute(sql`insert into app.assistant_knowledge_batch_items(enterprise_id,batch_id,ordinal,evaluation_id)
          values(${this.manager.enterpriseId},${String(batch!.id)},${i+1},${evaluationId})`);
      }
      return { batchId: String(batch!.id) };
    }),true);
    return {batchId:String(created.batchId)};
  }
  async list() { return this.tx(async tx => ({ items: await rows(tx,sql`select b.id::text,b.title,b.state,b.version,b.created_at
    from app.assistant_knowledge_batches b where b.enterprise_id=${this.manager.enterpriseId} and b.created_by=${this.manager.adminId} order by b.id desc limit 20`) })); }
  async read(batchId: string) {
    return this.tx(async (tx,s) => {
      const b = await this.batch(tx,batchId), items = await this.items(tx,batchId);
      if (!await this.current(tx,b,s,items)) return { id: batchId, available: false, state: b.state, version: b.version, reason: 'source_or_configuration_changed' };
      const projected = items.map(e=>({ evaluationId: String(e.id), caseId: String(e.case_id), revision: e.case_revision, ordinal: e.ordinal,
        title: (e.snapshot as Row).title, runId: e.run_id ? String(e.run_id) : null,
        status: e.run_status ? String(e.run_status) : e.state==='cancelled' ? 'cancelled' : 'pending', errorCode: e.run_error ?? null,
        awaitingReconciliation: e.reservation_status==='reconciling' }));
      const runIds=items.filter(e=>e.run_id).map(e=>String(e.run_id));
      const usage = await one(tx,sql`select count(*)::int records,sum(u.input_tokens)::text known_input_tokens,sum(u.output_tokens)::text known_output_tokens,
        sum(u.cost_micros)::text known_cost_micros,count(*) filter(where u.input_tokens is null or u.output_tokens is null)::int unknown_token_records,
        count(*) filter(where u.cost_micros is null)::int unknown_cost_records
        from app.assistant_usage_records u where u.enterprise_id=${this.manager.enterpriseId} and u.run_id=any(${postgresIds(runIds)})`);
      return { id: batchId, available: true, title: b.title, version: b.version,
        state: b.state==='active' && projected.every(i=>terminal.includes(i.status)) ? 'completed' : b.state,
        concurrency: b.concurrency, configuration: b.configuration, knowledgeEpoch: b.knowledge_epoch,
        items: projected, usage, costMicros: null, errorCode: b.last_error ?? null };
    });
  }
  /** The batch lock spans only local DB dispatch, never a provider call. Original keys recover lost receipts. */
  async advance(batchId: string) {
    return this.tx(async (tx,s) => {
      const b = await this.batch(tx,batchId,true); if (b.state!=='active') return;
      const items = await this.items(tx,batchId);
      if (!await this.current(tx,b,s,items)) {
        for (const e of items) if(e.run_id)await cancelRuns(tx,this.actor,String(e.conversation_id),String(e.run_id));
        await this.block(tx,batchId,'context_changed'); return;
      }
      let active = items.filter(e=>e.run_status && !terminal.includes(String(e.run_status))).length;
      for (const e of items.filter(e=>!e.run_id && e.state!=='cancelled')) {
        if (active >= Number(b.concurrency)) break;
        await tx.execute(sql`savepoint knowledge_batch_dispatch`);
        try {
          await this.deps.dispatch(String(e.id),tx);
          await tx.execute(sql`update app.assistant_knowledge_batch_items set state='submitted' where enterprise_id=${this.manager.enterpriseId} and evaluation_id=${String(e.id)}`);
          await tx.execute(sql`release savepoint knowledge_batch_dispatch`);
          active++;
        } catch (error) {
          await tx.execute(sql`rollback to savepoint knowledge_batch_dispatch`);
          await tx.execute(sql`release savepoint knowledge_batch_dispatch`);
          // No provider can see an uncommitted job. Roll back partial local
          // dispatch, retain this evaluation's keys, then require explicit resume.
          if (error instanceof AssistantError) await this.block(tx,batchId,error.code);
          else await this.block(tx,batchId,'dispatch_unavailable');
          break;
        }
      }
      await tx.execute(sql`update app.assistant_knowledge_batches set updated_at=now() where enterprise_id=${this.manager.enterpriseId} and id=${batchId}`);
    },true);
  }
  private block(tx: PostgresTransaction,batchId:string,code:string) {
    return tx.execute(sql`update app.assistant_knowledge_batches set state='blocked',last_error=${code},version=version+1,updated_at=now()
      where enterprise_id=${this.manager.enterpriseId} and id=${batchId} and state='active'`);
  }
  async command(batchId: string, action: 'cancel'|'resume', input: Row, requestKey: string) {
    return this.tx(async(tx,s)=>idempotent(tx,this.actor,'knowledge-batch:'+action+':'+batchId,requestKey,input,async()=>{
      const b=await this.batch(tx,batchId,true); if(Number(b.version)!==expected(input.expectedVersion))fail('version_conflict');
      if(action==='resume') {
        if(b.state!=='blocked'||!await this.current(tx,b,s,await this.items(tx,batchId)))fail('context_changed');
        await tx.execute(sql`update app.assistant_knowledge_batches set state='active',last_error=null,version=version+1,updated_at=now() where enterprise_id=${this.manager.enterpriseId} and id=${batchId}`);
      } else {
        for(const e of await this.items(tx,batchId))if(e.run_id)await cancelRuns(tx,this.actor,String(e.conversation_id),String(e.run_id));
        await tx.execute(sql`update app.assistant_knowledge_batch_items set state='cancelled' where enterprise_id=${this.manager.enterpriseId} and batch_id=${batchId} and state='pending'`);
        await tx.execute(sql`update app.assistant_knowledge_batches set state='cancelled',version=version+1,updated_at=now() where enterprise_id=${this.manager.enterpriseId} and id=${batchId}`);
      }
      return {batchId};
    }),action==='resume');
  }
  async evaluationState(evaluationId:string) {
    return this.tx(async(tx,s)=>{
      if(!(await one(tx,sql`select to_regclass('app.assistant_knowledge_batch_items') is not null as ready`))!.ready)return {available:true,state:null};
      const item=await one(tx,sql`select batch_id::text,state from app.assistant_knowledge_batch_items where enterprise_id=${this.manager.enterpriseId} and evaluation_id=${id(evaluationId)}`);
      if(!item)return {available:true,state:null};
      const b=await this.batch(tx,String(item.batch_id));
      return {available:await this.current(tx,b,s,await this.items(tx,b.id)),state:item.state};
    });
  }
  async resumeEvaluation<T>(evaluationId:string,dispatch:(tx?:PostgresTransaction)=>Promise<T>):Promise<T> {
    const linked=await this.tx(async tx=>{
      if(!(await one(tx,sql`select to_regclass('app.assistant_knowledge_batch_items') is not null as ready`))!.ready)return null;
      return one(tx,sql`select batch_id::text from app.assistant_knowledge_batch_items where enterprise_id=${this.manager.enterpriseId} and evaluation_id=${id(evaluationId)}`);
    });
    if(!linked)return dispatch(); // Keep the original unbatched crash/recovery boundaries.
    return this.tx(async(tx,s)=>{
      const item=await one(tx,sql`select batch_id::text from app.assistant_knowledge_batch_items where enterprise_id=${this.manager.enterpriseId} and evaluation_id=${id(evaluationId)}`);
      if(item) {
        const b=await this.batch(tx,String(item.batch_id),true);
        // Single-item recovery must also respect batch cancellation and its concurrency cap.
        if(b.state!=='active'||!await this.current(tx,b,s,await this.items(tx,b.id)))fail('context_changed');
        const items=await this.items(tx,b.id),e=items.find(e=>String(e.id)===evaluationId)!;
        if(!e.run_id&&items.filter(e=>e.run_status&&!terminal.includes(String(e.run_status))).length>=Number(b.concurrency))fail('context_changed');
      }
      const result=await dispatch(tx);
      if(item)await tx.execute(sql`update app.assistant_knowledge_batch_items set state='submitted' where enterprise_id=${this.manager.enterpriseId} and evaluation_id=${evaluationId}`);
      return result;
    },true);
  }
}
