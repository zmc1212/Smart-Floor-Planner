import { sql } from 'drizzle-orm';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { AiCreationRepository } from '@/db/repositories/ai-creation-repository';
import { getPlatformLlmOverrideRuntime } from '@/lib/platform-llm-config';
import { authorizeKnowledgeManager } from '../knowledge/manager';
import { AiProviderError, type AiProviderRuntimeConfig } from '@/lib/ai/provider-types';
import { bailianBinding, bailianSearchBinding, normalizeBailianTaskBinding, type BailianBinding, type BailianSearchBinding, type BailianTaskBinding } from '@/lib/ai/providers/bailian-capabilities';
import { bailianOfflineTransport, bailianPublicSearch, nativeSearchUsage, definitiveCapabilityRejection, type BailianOfflineTransport, type BatchRemote } from '@/lib/ai/providers/bailian-offline';
import { parseAgentChat } from '@/lib/ai/providers/agent-chat';
import { cacheObservation } from '@/lib/ai/providers/model-observation';
import { fail, fingerprint, id, key } from '../contracts';
import { joinDraft, partialBody, validateDraft, type ApprovedDraft } from './draft-continuation';
import { parseWebQuery, searchWeb, type WebQuery, type WebSearchSnapshot } from './web';

export type OfflineItem = { customId: string; text: string; maxTokens: number };
type TaskKind = 'offline_batch' | 'public_search' | 'draft_continuation';
type Approval = { id: string };
export type ModelTaskPorts = {
  runtime(): Promise<AiProviderRuntimeConfig>;
  transport(runtime: AiProviderRuntimeConfig, binding: BailianTaskBinding): BailianOfflineTransport;
  /** The caller must use the existing campaign ledger, counting every item and
   * historical unknown hold. No default approval exists in this service. */
  approve(task: Row, itemCount: number): Promise<Approval>;
  partialVerified?(binding: BailianBinding): Promise<boolean>;
};
const defaultPorts: ModelTaskPorts = {
  async runtime() { const runtime = await getPlatformLlmOverrideRuntime('chat'); if (!runtime) fail('model_runtime_unavailable',503); return runtime; },
  transport: bailianOfflineTransport,
  async approve() { return fail('additional_model_calls_not_authorized',403); },
};
const terminal = new Set(['completed','failed','expired','cancelled']);

/** Native provider jobs use the existing tenant transactions and provider
 * attempt repository. Their remote asynchronous work is resumed by explicit
 * sync; no real-time loop or additional Agent/knowledge orchestration is added. */
export class ModelTaskService {
  constructor(readonly actor: { enterpriseId: string; adminId: string }, readonly ports: ModelTaskPorts = defaultPorts) {}
  private async authorize(tx: PostgresTransaction) {
    const url = new URL(process.env.DATABASE_URL || 'http://invalid');
    if (process.env.NODE_ENV === 'production' || !['localhost','127.0.0.1'].includes(url.hostname)
      || url.port !== '55432' || url.pathname !== '/xiaok_embedding_eval') fail('model_tasks_isolated_development_only',403);
    // Reuse the existing current-manager guard, including selected-enterprise
    // platform administrators, active identity and the existing menu boundary.
    await authorizeKnowledgeManager(tx,this.actor.enterpriseId,this.actor.adminId);
  }
  private scoped<T>(fn: (tx: PostgresTransaction) => Promise<T>) {
    const url = new URL(process.env.DATABASE_URL || 'http://invalid');
    if (process.env.NODE_ENV === 'production' || !['localhost','127.0.0.1'].includes(url.hostname)
      || url.port !== '55432' || url.pathname !== '/xiaok_embedding_eval') fail('model_tasks_isolated_development_only',403);
    return withTenantTransaction(this.actor.enterpriseId,async tx => { await this.authorize(tx); return fn(tx); });
  }
  private async owned(tx: PostgresTransaction, taskId: string, lock = false) {
    const task = await one(tx,sql`select * from app.assistant_model_tasks where enterprise_id=${this.actor.enterpriseId}
      and created_by=${this.actor.adminId} and id=${id(taskId)} ${lock ? sql`for update` : sql``}`);
    if (!task) fail('model_task_not_found',404); return task;
  }
  async read(taskId: string): Promise<Row & {items:Row[]}> { return this.scoped(async tx => {
    const task = await this.owned(tx,taskId);
    if(task.revoked_at)fail('model_task_revoked',409);
    const items = await rows(tx,sql`select custom_id,state,attempt_id,response_hash,result,reserved_tokens,reserved_cost_micros
      from app.assistant_model_task_items where enterprise_id=${this.actor.enterpriseId} and task_id=${taskId} order by id`);
    return { ...task, items } as Row & {items:Row[]};
  }); }
  private async prepare(kind: TaskKind, operationKey: string, request: Record<string,unknown>, binding: BailianTaskBinding, items: Array<{customId:string;request:Record<string,unknown>;tokens:number}>) {
    const actual = normalizeBailianTaskBinding(binding);
    if (!actual || fingerprint(actual) !== fingerprint(binding) || !items.length || items.length>20) fail('invalid_model_task',422);
    const tokens = items.reduce((n,item)=>n+item.tokens,0), cost = tokens*5; // Existing campaign's conservative ceiling, not a tariff/bill.
    const hash = fingerprint({kind,request,binding,items});
    return this.scoped(async tx => {
      const saved = await one(tx,sql`select * from app.assistant_model_tasks where enterprise_id=${this.actor.enterpriseId}
        and created_by=${this.actor.adminId} and operation_key=${key(operationKey)} for update`);
      if (saved) { if (saved.request_hash !== hash) fail('model_task_key_conflict',409); return saved; }
      const task = (await one(tx,sql`insert into app.assistant_model_tasks(enterprise_id,created_by,operation_key,kind,binding,request,request_hash,reserved_tokens,reserved_cost_micros)
        values(${this.actor.enterpriseId},${this.actor.adminId},${operationKey},${kind},${JSON.stringify(binding)}::jsonb,${JSON.stringify(request)}::jsonb,${hash},${tokens},${cost}) returning *`))!;
      for (const item of items) await tx.execute(sql`insert into app.assistant_model_task_items(enterprise_id,task_id,custom_id,request,reserved_tokens,reserved_cost_micros)
        values(${this.actor.enterpriseId},${String(task.id)},${item.customId},${JSON.stringify(item.request)}::jsonb,${item.tokens},${item.tokens*5})`);
      return task;
    });
  }
  prepareBatch(operationKey: string, input: { synthetic: true; items: OfflineItem[] }, binding: BailianBinding) {
    if (input.synthetic !== true || !Array.isArray(input.items) || !input.items.length || input.items.length>20
      || new Set(input.items.map(i=>i.customId)).size !== input.items.length || binding.region !== 'cn-beijing') fail('invalid_offline_batch',422);
    const items = input.items.map(item=>{
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(item.customId) || typeof item.text !== 'string' || !item.text.trim()
        || Buffer.byteLength(item.text)>12000 || !Number.isSafeInteger(item.maxTokens) || item.maxTokens<1 || item.maxTokens>2048) fail('invalid_offline_batch',422);
      const request={ model:binding.model, messages:[{role:'user',content:item.text}], max_tokens:item.maxTokens, enable_thinking:false };
      return {customId:item.customId,request,tokens:Buffer.byteLength(item.text)+1024+item.maxTokens};
    });
    if (binding.thinking) fail('offline_batch_thinking_not_authorized',403);
    return this.prepare('offline_batch',operationKey,{synthetic:true},binding,items);
  }
  prepareSearch(operationKey: string, query: WebQuery, binding: BailianSearchBinding) {
    if(binding.api!=='dashscope-generation')fail('bailian_search_api_mismatch',422);
    return this.prepare('public_search',operationKey,{query:parseWebQuery(query)},binding,
      [{customId:'search',request:{query:parseWebQuery(query)},tokens:4096}]);
  }
  prepareDraft(operationKey: string, draft: ApprovedDraft, binding: BailianBinding) {
    validateDraft(draft,{enterpriseId:this.actor.enterpriseId,ownerId:this.actor.adminId,version:draft.version,
      knowledgeEpoch:draft.knowledgeEpoch,consentVersion:draft.consentVersion});
    partialBody(binding,draft.prefix);
    return this.prepare('draft_continuation',operationKey,{draft},binding,[{customId:'draft',request:{prefixHash:draft.prefixHash},tokens:Buffer.byteLength(draft.prefix)+2048}]);
  }
  private async bound(task: Row) {
    const binding=task.binding as BailianTaskBinding, runtime=await this.ports.runtime();
    const chat=bailianBinding(runtime.baseUrl,runtime.modelMappings['chat.general'] || '',binding.thinking);
    const actual=task.kind==='public_search'&&chat?bailianSearchBinding(chat):chat;
    if (!actual || fingerprint(actual)!==fingerprint(binding)) fail('model_task_configuration_changed',409);
    return {runtime,transport:this.ports.transport(runtime,binding)};
  }
  private async transition(taskId:string, expected: number, from:string[], state:string, extra: {fileId?:string;authorizationId?:string}={}) {
    return this.scoped(async tx=>{
      const task=await this.owned(tx,taskId,true);
      if (task.revoked_at || Number(task.version)!==expected || !from.includes(String(task.state))) fail('model_task_state_conflict',409);
      return (await one(tx,sql`update app.assistant_model_tasks set state=${state},
        input_file_id=coalesce(${extra.fileId??null},input_file_id),authorization_id=coalesce(${extra.authorizationId??null},authorization_id),
        version=version+1,updated_at=now() where enterprise_id=${this.actor.enterpriseId} and id=${taskId} returning *`))!;
    });
  }
  private async failedDispatch(taskId:string,version:number,error:unknown) {
    await withTenantTransaction(this.actor.enterpriseId,async tx=>{
      const task=await this.owned(tx,taskId,true); if(Number(task.version)!==version)return;
      const definitive=definitiveCapabilityRejection(error);
      await tx.execute(sql`update app.assistant_model_tasks set state=${definitive?'failed':'indeterminate'},last_error=${definitive?'provider_rejected':'provider_outcome_unknown'},version=version+1,updated_at=now()
        where enterprise_id=${this.actor.enterpriseId} and id=${taskId}`);
      if(definitive) {
        const items=await rows(tx,sql`select attempt_id from app.assistant_model_task_items where enterprise_id=${this.actor.enterpriseId} and task_id=${taskId} and attempt_id is not null`);
        for(const item of items)await new AiCreationRepository(tx).updateProviderAttempt(BigInt(String(item.attempt_id)),{
          status:'failed',accepted:false,errorCode:error instanceof AiProviderError?error.code:'PROVIDER_REJECTED',
          errorMessage:'Native capability request rejected; reservations retained',
        });
        await tx.execute(sql`update app.assistant_model_task_items set state='failed' where enterprise_id=${this.actor.enterpriseId} and task_id=${taskId} and response_hash is null`);
      }
      // Reserved tokens/costs are retained, including explicit rejection. Actual
      // invoice reconciliation is separate from transport disposition.
    });
  }
  private async attempts(task:Row,runtime:AiProviderRuntimeConfig) {
    return this.scoped(async tx=>{
      const current=await this.owned(tx,String(task.id),true);
      if(current.revoked_at || current.state!=='submitting' || Number(current.version)!==Number(task.version))fail('model_task_state_conflict',409);
      const items=await rows(tx,sql`select * from app.assistant_model_task_items where enterprise_id=${this.actor.enterpriseId} and task_id=${String(task.id)} order by id`);
      for(const item of items) {
        if(item.attempt_id)fail('model_task_already_dispatched',409);
        const attempt=await new AiCreationRepository(tx).createProviderAttempt({enterpriseId:BigInt(this.actor.enterpriseId),providerConfigId:BigInt(runtime.id),
          providerKey:runtime.key,adapterType:runtime.adapterType,capability:'chat',logicalModelKey:'chat.general',remoteModel:'qwen3.8-flash',
          status:'unknown',accepted:true,requestFingerprint:fingerprint(item.request),estimatedCost:{measurementKind:'reserved',micros:String(item.reserved_cost_micros)},
          metadata:{modelTask:{taskId:String(task.id),customId:item.custom_id,requestHash:task.request_hash,synthetic:true},reservedTokens:String(item.reserved_tokens)}});
        await tx.execute(sql`update app.assistant_model_task_items set attempt_id=${String(attempt.id)},state='submitted' where enterprise_id=${this.actor.enterpriseId} and id=${String(item.id)}`);
      }
      return items;
    });
  }
  private async batchInput(taskId:string) {
    return this.scoped(async tx=>(await rows(tx,sql`select custom_id,request from app.assistant_model_task_items where enterprise_id=${this.actor.enterpriseId} and task_id=${taskId} order by id`))
      .map(item=>JSON.stringify({custom_id:item.custom_id,method:'POST',url:'/v1/chat/completions',body:item.request})).join('\n')+'\n');
  }
  async submitBatch(taskId:string) {
    let task=await this.read(taskId);if(task.kind!=='offline_batch')fail('invalid_model_task',422);
    if(task.remote_batch_id)return task; // Reentry never creates another batch.
    if(!['prepared','uploaded'].includes(String(task.state)))fail('model_task_outcome_unresolved',409);
    const bound=await this.bound(task), approval=await this.ports.approve(task,task.items.length);
    if(task.state==='prepared') {
      const jsonl=await this.batchInput(taskId);
      task=await this.transition(taskId,Number(task.version),['prepared'],'uploading',{authorizationId:key(approval.id)}) as typeof task;
      try {
        const fileId=await bound.transport.upload(jsonl);
        task=await this.transition(taskId,Number(task.version),['uploading'],'uploaded',{fileId}) as typeof task;
      }catch(error){await this.failedDispatch(taskId,Number(task.version),error);throw error;}
    }
    task=await this.transition(taskId,Number(task.version),['uploaded'],'submitting',{authorizationId:key(approval.id)}) as typeof task;
    try {
      await this.attempts(task,bound.runtime);
      const remote=await bound.transport.submit(String(task.input_file_id),{sfp_task:taskId,sfp_hash:String(task.request_hash)});
      await this.applyRemote(task,remote);return this.read(taskId);
    }catch(error){await this.failedDispatch(taskId,Number(task.version),error);throw error;}
  }
  private async applyRemote(task:Row,remote:BatchRemote) {
    if(remote.input_file_id!==task.input_file_id || remote.metadata.sfp_task!==String(task.id)
      || remote.metadata.sfp_hash!==task.request_hash || task.remote_batch_id && remote.id!==task.remote_batch_id)fail('batch_identity_mismatch',409);
    return withTenantTransaction(this.actor.enterpriseId,async tx=>{
      const current=await this.owned(tx,String(task.id),true);
      if(current.remote_batch_id && current.remote_batch_id!==remote.id)fail('batch_identity_mismatch',409);
      if(terminal.has(String(current.remote_status)) && current.remote_status!==remote.status)fail('batch_status_regression',409);
      await tx.execute(sql`update app.assistant_model_tasks set remote_batch_id=${remote.id},remote_status=${remote.status},
        state=case when state in ('completed','cancelled','failed') then state else ${remote.status==='cancelling'?'cancelling':'running'} end,
        version=version+1,updated_at=now() where enterprise_id=${this.actor.enterpriseId} and id=${String(task.id)}`);
    });
  }
  /** Explicit remote ID recovery verifies immutable metadata and original file.
   * Unknown submission is never retried, including on process restart. */
  async syncBatch(taskId:string,recoveredBatchId?:string) {
    const task=await this.read(taskId);if(task.kind!=='offline_batch')fail('invalid_model_task',422);
    const remoteId=task.remote_batch_id || recoveredBatchId;if(!remoteId)fail('model_task_outcome_unresolved',409);
    const {transport}=await this.bound(task), remote=await transport.retrieve(String(remoteId));
    await this.applyRemote(task,remote);
    if(terminal.has(remote.status)) {
      const output=remote.output_file_id?await transport.content(remote.output_file_id):'';
      const errors=remote.error_file_id?await transport.content(remote.error_file_id):'';
      await this.collect(taskId,remote.status,output,errors);
    }
    return this.read(taskId);
  }
  private async collect(taskId:string,status:string,output:string,errors:string) {
    if(Buffer.byteLength(output)+Buffer.byteLength(errors)>4_000_000)fail('batch_content_too_large',502);
    const lines=[...output.split('\n'),...errors.split('\n')].filter(s=>s.trim());
    if(lines.length>20)fail('invalid_batch_results',502);
    const records=new Map<string,Record<string,unknown>>();
    for(const line of lines) {const value=JSON.parse(line) as Record<string,unknown>;
      if(typeof value.custom_id!=='string'||records.has(value.custom_id))fail('invalid_batch_results',502);records.set(value.custom_id,value);}
    await this.scoped(async tx=>{
      const task=await this.owned(tx,taskId,true);
      const items=await rows(tx,sql`select * from app.assistant_model_task_items where enterprise_id=${this.actor.enterpriseId} and task_id=${taskId} order by id`);
      if([...records.keys()].some(customId=>!items.some(item=>item.custom_id===customId)))fail('invalid_batch_results',502);
      for(const item of items) {
        const raw=records.get(String(item.custom_id));if(!raw) {
          await tx.execute(sql`update app.assistant_model_task_items set state='unknown' where enterprise_id=${this.actor.enterpriseId} and id=${String(item.id)} and response_hash is null`);continue;
        }
        const hash=fingerprint(raw);if(item.response_hash){if(item.response_hash!==hash)fail('batch_result_changed',409);continue;}
        const response=raw.response as {status_code?:number;body?:Record<string,unknown>}|undefined;
        let state='failed',usage:ReturnType<typeof parseAgentChat>['usage']=null,answer:string|null=null;
        if(response && Number(response.status_code)>=200 && Number(response.status_code)<300 && response.body) {
          const parsed=parseAgentChat(response.body);if(parsed.toolCalls.length)fail('offline_batch_side_effect_forbidden',502);
          state='succeeded';usage=parsed.usage;answer=parsed.text;
        } else if(!raw.error && !response)fail('invalid_batch_results',502);
        const result={state,usage,text:answer,error:state==='failed'?'provider_item_failed':null,cache:cacheObservation(usage)};
        await tx.execute(sql`update app.assistant_model_task_items set state=${state},response_hash=${hash},result=${JSON.stringify(result)}::jsonb
          where enterprise_id=${this.actor.enterpriseId} and id=${String(item.id)}`);
        if(item.attempt_id)await new AiCreationRepository(tx).updateProviderAttempt(BigInt(String(item.attempt_id)),{
          status:state==='succeeded'?'succeeded':'failed',accepted:state==='succeeded',actualCost:{measurementKind:'unavailable'},
          metadata:{modelTask:{taskId,customId:item.custom_id,requestHash:task.request_hash,synthetic:true},responseHash:hash,usage,
            reservedTokens:String(item.reserved_tokens),cache:cacheObservation(usage)}});
      }
      await tx.execute(sql`update app.assistant_model_tasks set state=${status==='cancelled'?'cancelled':status==='failed'?'failed':'completed'},version=version+1,updated_at=now()
        where enterprise_id=${this.actor.enterpriseId} and id=${taskId}`);
    });
  }
  async cancel(taskId:string) {
    const task=await this.read(taskId);
    if(['completed','failed','cancelled'].includes(String(task.state)))return task;
    if(!task.remote_batch_id) {
      if(!['prepared','uploaded'].includes(String(task.state)))fail('model_task_outcome_unresolved',409);
      await this.transition(taskId,Number(task.version),[String(task.state)],'cancelled');
      await this.scoped(async tx=>tx.execute(sql`update app.assistant_model_task_items set state='cancelled' where enterprise_id=${this.actor.enterpriseId} and task_id=${taskId} and attempt_id is null`));
      return this.read(taskId);
    }
    const {transport}=await this.bound(task),next=await this.transition(taskId,Number(task.version),[String(task.state)],'cancelling');
    try {await this.applyRemote(next,await transport.cancel(String(task.remote_batch_id)));}
    catch(error){await this.failedDispatch(taskId,Number(next.version),error);throw error;}
    return this.syncBatch(taskId);
  }
  async recoverUpload(taskId:string,fileId:string) {
    const task=await this.read(taskId);
    if(task.state!=='indeterminate'||task.input_file_id||task.items.some(i=>i.attempt_id))fail('model_task_state_conflict',409);
    const {transport}=await this.bound(task),original=await this.batchInput(taskId);
    if(await transport.content(fileId)!==original)fail('batch_identity_mismatch',409);
    await this.transition(taskId,Number(task.version),['indeterminate'],'uploaded',{fileId});return this.read(taskId);
  }
  async search(taskId:string,read?:Parameters<typeof searchWeb>[2]):Promise<WebSearchSnapshot> {
    const task=await this.read(taskId);if(task.kind!=='public_search')fail('invalid_model_task',422);
    if(task.state==='completed' && task.result)return task.result as WebSearchSnapshot;
    const {runtime,transport}=await this.bound(task),approval=await this.ports.approve(task,1);
    const next=await this.transition(taskId,Number(task.version),['prepared'],'submitting',{authorizationId:key(approval.id)});
    await this.attempts(next,runtime);
    try {
      const query=(task.request as {query:WebQuery}).query;
      const response=await transport.search(query),usage=nativeSearchUsage(response.payload);
      await this.recordSingleUsage(next,usage);
      const result=await searchWeb(query,bailianPublicSearch(async()=>response.payload),read);
      await this.finishSingle(next,{...result},usage);return result;
    }catch(error){await this.failedDispatch(taskId,Number(next.version),error);throw error;}
  }
  async continueDraft(taskId:string,expectedVersion:number,consentVersion:number) {
    const task=await this.read(taskId);if(task.kind!=='draft_continuation'||task.revoked_at)fail('invalid_model_task',422);
    const draft=(task.request as {draft:ApprovedDraft}).draft;
    const epoch=await this.scoped(async tx=>Number((await one(tx,sql`select knowledge_epoch from app.assistant_enterprise_settings where enterprise_id=${this.actor.enterpriseId}`))?.knowledge_epoch));
    validateDraft(draft,{enterpriseId:this.actor.enterpriseId,ownerId:this.actor.adminId,version:expectedVersion,knowledgeEpoch:epoch,consentVersion});
    if(!await this.ports.partialVerified?.(task.binding as BailianBinding))fail('partial_protocol_unverified',409);
    if(task.state==='completed')return task.result;
    // A verified transport is supplied only after the exact binding receives
    // protocol evidence. Default and present Qwen3.8 bindings stay fenced.
    const {runtime,transport}=await this.bound(task),approval=await this.ports.approve(task,1);
    const next=await this.transition(taskId,Number(task.version),['prepared'],'submitting',{authorizationId:key(approval.id)});
    await this.attempts(next,runtime);
    try {
      const parsed=await transport.continueDraft(partialBody(task.binding as BailianBinding,draft.prefix));
      await this.recordSingleUsage(next,parsed.usage);
      if(parsed.toolCalls.length)fail('offline_batch_side_effect_forbidden',502);
      // Revalidate after the provider call; revocation cannot expose a result.
      const current=await this.read(taskId);if(current.revoked_at)fail('draft_continuation_stale',409);
      const currentEpoch=await this.scoped(async tx=>Number((await one(tx,sql`select knowledge_epoch from app.assistant_enterprise_settings where enterprise_id=${this.actor.enterpriseId}`))?.knowledge_epoch));
      validateDraft(draft,{enterpriseId:this.actor.enterpriseId,ownerId:this.actor.adminId,version:expectedVersion,knowledgeEpoch:currentEpoch,consentVersion});
      const result={text:joinDraft(draft.prefix,parsed.text),prefixHash:draft.prefixHash,draftVersion:draft.version};
      await this.finishSingle(next,result,parsed.usage);return result;
    }catch(error){await this.failedDispatch(taskId,Number(next.version),error);throw error;}
  }
  /** Accounting survives a permission/source revocation after dispatch. This
   * trusted internal write resolves only this task's original attempt link. */
  private async recordSingleUsage(task:Row,usage:ReturnType<typeof parseAgentChat>['usage']) {
    await withTenantTransaction(this.actor.enterpriseId,async tx=>{
      const item=await one(tx,sql`select * from app.assistant_model_task_items where enterprise_id=${this.actor.enterpriseId} and task_id=${String(task.id)}`);
      if(!item?.attempt_id)fail('model_task_attempt_missing',409);
      await new AiCreationRepository(tx).updateProviderAttempt(BigInt(String(item.attempt_id)),{status:'succeeded',accepted:true,actualCost:{measurementKind:'unavailable'},
        metadata:{modelTask:{taskId:String(task.id),customId:item.custom_id,synthetic:true},usage,cache:cacheObservation(usage),reservedTokens:String(item.reserved_tokens)}});
    });
  }
  private async finishSingle(task:Row,result:Record<string,unknown>,usage:ReturnType<typeof parseAgentChat>['usage']) {
    await this.scoped(async tx=>{
      const current=await this.owned(tx,String(task.id),true);if(current.revoked_at)fail('model_task_revoked',409);
      const item=(await one(tx,sql`select * from app.assistant_model_task_items where enterprise_id=${this.actor.enterpriseId} and task_id=${String(task.id)}`))!;
      const hash=fingerprint({result,usage});
      await new AiCreationRepository(tx).updateProviderAttempt(BigInt(String(item.attempt_id)),{status:'succeeded',accepted:true,
        actualCost:{measurementKind:'unavailable'},metadata:{modelTask:{taskId:String(task.id),customId:item.custom_id,synthetic:true},usage,cache:cacheObservation(usage),responseHash:hash,reservedTokens:String(item.reserved_tokens)}});
      await tx.execute(sql`update app.assistant_model_task_items set state='succeeded',result=${JSON.stringify({usage,cache:cacheObservation(usage)})}::jsonb,response_hash=${hash}
        where enterprise_id=${this.actor.enterpriseId} and id=${String(item.id)}`);
      await tx.execute(sql`update app.assistant_model_tasks set state='completed',result=${JSON.stringify(result)}::jsonb,version=version+1,updated_at=now()
        where enterprise_id=${this.actor.enterpriseId} and id=${String(task.id)}`);
    });
  }
  async revoke(taskId:string) {return this.scoped(async tx=>{await this.owned(tx,taskId,true);
    await tx.execute(sql`update app.assistant_model_tasks set revoked_at=coalesce(revoked_at,now()),version=version+1,updated_at=now() where enterprise_id=${this.actor.enterpriseId} and id=${taskId}`);
  });}
}
