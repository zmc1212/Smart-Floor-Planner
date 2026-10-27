import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID,createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one,rows } from '@/db/repositories/assistant-repository';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';
import { closePostgresPool } from '@/lib/postgresql';
import { ModelTaskService,type ModelTaskPorts } from '@/lib/assistant/agent/model-tasks';
import { bailianBinding, bailianSearchBinding } from '@/lib/ai/providers/bailian-capabilities';
import type { BatchRemote,BailianOfflineTransport } from '@/lib/ai/providers/bailian-offline';
import type { AiProviderRuntimeConfig } from '@/lib/ai/provider-types';
import { fingerprint } from '@/lib/assistant/contracts';
import { lockAssistantAcceptance } from '../../../scripts/assistant-acceptance-safety.mjs';

const root=path.resolve(process.cwd(),'..'),evidence=path.join(root,'tmp/xiaok-p0-20261027');
const connection=JSON.parse(fs.readFileSync(path.join(root,'tmp/xiaok-vector/connection.private.json'),'utf8').replace(/^\uFEFF/,''));
const url=new URL(connection.DATABASE_URL);assert.equal(url.port,'55432');assert.equal(url.pathname,'/xiaok_embedding_eval');
process.env.DATABASE_URL=connection.DATABASE_URL;process.env.LANGCHAIN_TRACING_V2='false';process.env.LANGSMITH_TRACING='false';
const binding=bailianBinding('https://dashscope.aliyuncs.com/compatible-mode','qwen3.8-flash',false)!;
const prefix='synthetic-p0-'+randomUUID(),tenants:string[]=[],admins:string[]=[],tasks:string[]=[];
let providerId='',unlock:(()=>Promise<void>)|undefined,network=0;
const originalFetch=globalThis.fetch;
const sourceFiles=['admin/src/lib/assistant/agent/model-tasks.ts','admin/src/lib/assistant/agent/draft-continuation.ts','admin/src/lib/assistant/agent/tool-protocol.ts',
  'admin/src/lib/assistant/agent/runtime.ts','admin/src/lib/assistant/contracts/model.ts','admin/src/lib/ai/providers/bailian-capabilities.ts',
  'admin/src/lib/ai/providers/bailian-offline.ts','admin/src/lib/ai/providers/agent-chat.ts','admin/src/lib/ai/providers/model-observation.ts',
  'admin/src/lib/ai/postgres-workflow-chat.ts','admin/src/db/repositories/assistant-cleanup.ts','admin/src/db/repositories/ai-creation-repository.ts',
  'admin/src/db/transaction.ts','admin/src/db/schema.ts','admin/src/db/assistant-model-task-schema.ts','admin/drizzle/0096_assistant_model_tasks.sql',
  'admin/scripts/assistant-model-capabilities.ts','admin/src/db/__tests__/assistant-model-tasks.test.ts','admin/package-lock.json','admin/tsconfig.json',
  'admin/src/lib/assistant/knowledge/manager.ts','admin/src/lib/platform-llm-config.ts','admin/src/lib/postgresql.ts','admin/src/lib/ai/provider-types.ts'];
const bind=()=>Object.fromEntries(sourceFiles.map(f=>[f,createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex')]));
const beforeHashes=bind(),checks:Array<{name:string;status:string}>=[];
const syntheticItems={synthetic:true as const,items:[{customId:'first',text:'合成评估：厨房通道有什么准备事项？',maxTokens:128},{customId:'second',text:'合成评估：收纳如何按生活习惯安排？',maxTokens:128},{customId:'third',text:'合成评估：卫生间铺砖前先核对什么？',maxTokens:128}]};
const payload=(text='这是合成回答。')=>({id:'synthetic-response',choices:[{message:{content:text},finish_reason:'stop'}],usage:{prompt_tokens:80,completion_tokens:12,prompt_tokens_details:{cached_tokens:0}}});
function fixture(options:{unknownSubmit?:boolean;unknownUpload?:boolean;approval?:boolean;partial?:boolean}={}) {
  const calls:string[]=[],contents=new Map<string,string>();let remote:BatchRemote|undefined;
  let savedInput='';
  const transport:BailianOfflineTransport={
    async upload(jsonl){calls.push('upload');savedInput=jsonl;contents.set('file-input',jsonl);if(options.unknownUpload)throw Error('synthetic_upload_unknown');return 'file-input';},
    async submit(fileId,metadata){calls.push('submit');remote={id:'batch-'+randomUUID(),input_file_id:fileId,status:'in_progress',output_file_id:null,error_file_id:null,metadata};if(options.unknownSubmit)throw Error('synthetic_submit_unknown');return remote;},
    async retrieve(batchId){calls.push('retrieve');assert.equal(batchId,remote?.id);return structuredClone(remote!);},
    async cancel(batchId){calls.push('cancel');assert.equal(batchId,remote?.id);remote!.status='cancelled';return structuredClone(remote!);},
    async content(fileId){calls.push('content');assert.ok(contents.has(fileId));return contents.get(fileId)!;},
    async search(query){calls.push('search');assert.doesNotMatch(query.query,/客户姓名|手机号/);return {payload:{...payload(),search_info:{search_results:[{title:'合成公开原文',url:'https://example.com/standard',snippet:'这个摘要不能作为证据'}]}},requestId:'synthetic-search'};},
    async continueDraft(body){calls.push('partial');assert.equal(body.messages[1].partial,true);return {text:'先把常用物品分类。',toolCalls:[],finishReason:'stop',providerRequestId:'synthetic-partial',usage:{inputTokens:60,outputTokens:10}};},
  };
  const runtime:AiProviderRuntimeConfig={id:providerId,key:prefix,name:'Synthetic P0',adapterType:'openai_compatible',baseUrl:binding.baseUrl,apiKey:'synthetic-not-a-key',timeoutMs:1000,
    capabilities:['chat'],adapterConfig:{providerPreset:'dashscope'},modelMappings:{'chat.general':binding.model}};
  const ports:ModelTaskPorts={runtime:async()=>runtime,transport:()=>transport,approve:async()=>{calls.push('approve');if(options.approval===false)throw Error('additional_model_calls_not_authorized');return {id:'synthetic-approval'};},partialVerified:async()=>!!options.partial};
  const service=(actor=0)=>new ModelTaskService({enterpriseId:tenants[actor?1:0],adminId:admins[actor]},ports);
  return {calls,ports,service,contents,input:()=>savedInput,remote:()=>remote!};
}
async function prepare(f:ReturnType<typeof fixture>,items=syntheticItems) {const task=await f.service().prepareBatch(randomUUID(),items,binding);tasks.push(String(task.id));return String(task.id);}
before(async()=>{
  unlock=await lockAssistantAcceptance(connection.DATABASE_URL);globalThis.fetch=async()=>{network++;throw Error('external_network_forbidden_in_P0_acceptance');};
  await withPlatformTransaction(async tx=>{
    for(let i=0;i<2;i++){
      const enterprise=(await one(tx,sql`insert into app.enterprises(name,code,status) values(${prefix+i},${prefix+i},'active') returning id`))!;
      tenants.push(String(enterprise.id));
      await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days)
        values(${tenants[i]},true,100,1000000,100000000,90)`);
      const admin=(await one(tx,sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,menu_permissions,must_change_password)
        values(${tenants[i]},${prefix+i},'synthetic-test-only','enterprise_admin','active',ARRAY['assistant-knowledge'],false) returning id`))!;admins.push(String(admin.id));
    }
    providerId=String((await one(tx,sql`insert into app.ai_provider_configs(key,name,adapter_type,base_url,api_key_encrypted,api_key_masked,enabled,capabilities,adapter_config)
      values(${prefix},'Synthetic P0 disabled provider','openai_compatible',${binding.baseUrl},'synthetic-test-only','synthetic',false,ARRAY['chat'],'{"providerPreset":"dashscope"}'::jsonb) returning id`))!.id);
  });
});
after(async()=>{
  const afterHashes=bind();const noDrift=JSON.stringify(afterHashes)===JSON.stringify(beforeHashes);
  try {
    await withPlatformTransaction(async tx=>{for(const tenant of tenants){await deleteAssistantData(tx,BigInt(tenant));await tx.execute(sql`delete from app.admin_users where enterprise_id=${tenant}`);await tx.execute(sql`delete from app.enterprises where id=${tenant}`);}if(providerId)await tx.execute(sql`delete from app.ai_provider_configs where id=${providerId}`);});
    assert.equal(network,0);assert.ok(noDrift,'Source changed during P0 acceptance');
  }finally{
    fs.writeFileSync(path.join(evidence,`service-evidence-${process.env.ASSISTANT_P0_EVIDENCE_LABEL||Date.now()}.json`),JSON.stringify({version:1,kind:'real-isolated-database-mocked-native-transport',checks,
      sourceBefore:beforeHashes,sourceAfter:afterHashes,noDrift,externalNetworkCalls:network,actualProviderCalls:0,syntheticAttemptAudits:true,fixtureIds:{enterprises:tenants,admins,tasks},cleanup:'completed'},null,2));
    globalThis.fetch=originalFetch;await closePostgresPool();await unlock?.();
  }
});
test('P0 real writes: original key, persisted reentry, immutable bindings, owner inheritance and forced tenant RLS',async()=>{
  const f=fixture(),op=randomUUID(),first=await f.service().prepareBatch(op,syntheticItems,binding);tasks.push(String(first.id));
  assert.equal(String((await f.service().prepareBatch(op,syntheticItems,binding)).id),String(first.id));
  await assert.rejects(f.service().prepareBatch(op,{...syntheticItems,items:[{...syntheticItems.items[0],text:'另一份合成输入'}]},binding),/key_conflict/);
  assert.equal((await f.service().read(String(first.id))).items.length,3);
  await assert.rejects(f.service(1).read(String(first.id)),/not_found/);
  const hidden=await withTenantTransaction(tenants[1],tx=>rows(tx,sql`select * from app.assistant_model_tasks where id=${String(first.id)}`));assert.equal(hidden.length,0);
  await assert.rejects(withTenantTransaction(tenants[0],tx=>tx.execute(sql`update app.assistant_model_tasks set request='{}'::jsonb where id=${String(first.id)}`)),
    (error:unknown)=>error instanceof Error && /immutable model task binding/.test(String(error.cause)));
  for(const role of ['admin','super_admin','enterprise_admin']){await withPlatformTransaction(tx=>tx.execute(sql`update app.admin_users set role=${role} where id=${admins[0]}`));assert.equal((await f.service().read(String(first.id))).items.length,3);}
  checks.push({name:'idempotency-reentry-immutable-role-RLS',status:'passed'});
});
test('P0 Batch asynchronous lifecycle: unordered success/error/missing rows, duplicate retrieval, full audit and reservations',async()=>{
  const f=fixture(),taskId=await prepare(f);await f.service().submitBatch(taskId);
  assert.equal(f.calls.filter(c=>c==='submit').length,1);assert.match(f.input(),/custom_id/);assert.doesNotMatch(f.input(),/tool_calls|propose_requirement|record_need/);
  const second=await f.service().submitBatch(taskId);assert.equal(second.state,'running');assert.equal(f.calls.filter(c=>c==='submit').length,1);
  f.remote().status='completed';f.remote().output_file_id='file-output';f.remote().error_file_id='file-error';
  f.contents.set('file-output',JSON.stringify({custom_id:'second',response:{status_code:200,body:payload()}})+'\n');
  f.contents.set('file-error',JSON.stringify({custom_id:'first',error:{code:'invalid_request'}})+'\n');
  const result=await f.service().syncBatch(taskId);assert.deepEqual(result.items.map(i=>i.state),['failed','succeeded','unknown']);
  assert.equal(result.state,'completed');assert.ok(Number(result.reserved_tokens)>0);await f.service().syncBatch(taskId);
  const attempts=await withTenantTransaction(tenants[0],tx=>rows(tx,sql`select status,metadata,actual_cost from app.ai_provider_attempts where metadata#>>'{modelTask,taskId}'=${taskId} order by id`));
  assert.equal(attempts.length,3);assert.deepEqual(attempts.map(a=>a.status),['failed','succeeded','unknown']);
  assert.equal((attempts[1].metadata as {usage:{cachedInputTokens:number}}).usage.cachedInputTokens,0);
  assert.equal((attempts[1].actual_cost as {measurementKind:string}).measurementKind,'unavailable');
  f.contents.set('file-output',JSON.stringify({custom_id:'second',response:{status_code:200,body:payload('变化的结果')}}));
  await assert.rejects(f.service().syncBatch(taskId),/batch_result_changed/);
  checks.push({name:'batch-unordered-partial-duplicate-accounting',status:'passed'});
});
test('P0 Batch lost submission response survives restart and cannot resubmit; exact remote identity recovers',async()=>{
  const f=fixture({unknownSubmit:true}),taskId=await prepare(f);await assert.rejects(f.service().submitBatch(taskId),/submit_unknown/);
  const unknown=await f.service().read(taskId);assert.equal(unknown.state,'indeterminate');assert.equal(unknown.remote_batch_id,null);assert.ok(unknown.items.every(i=>i.attempt_id));
  await assert.rejects(f.service().submitBatch(taskId),/outcome_unresolved/);assert.equal(f.calls.filter(c=>c==='submit').length,1);
  await f.service().syncBatch(taskId,f.remote().id);assert.equal((await f.service().read(taskId)).remote_batch_id,f.remote().id);
  f.remote().metadata.sfp_hash='wrong';await assert.rejects(f.service().syncBatch(taskId),/identity_mismatch/);
  checks.push({name:'batch-unknown-no-resubmit-identity-recovery',status:'passed'});
});
test('P0 upload unknown cannot be retried; exact uploaded JSONL recovers without another upload or inference',async()=>{
  const f=fixture({unknownUpload:true}),taskId=await prepare(f);await assert.rejects(f.service().submitBatch(taskId),/upload_unknown/);
  await assert.rejects(f.service().submitBatch(taskId),/outcome_unresolved/);
  f.contents.set('wrong-file','different');await assert.rejects(f.service().recoverUpload(taskId,'wrong-file'),/identity_mismatch/);
  await f.service().recoverUpload(taskId,'file-input');await f.service().submitBatch(taskId);
  assert.equal(f.calls.filter(c=>c==='upload').length,1);assert.equal(f.calls.filter(c=>c==='submit').length,1);
  checks.push({name:'upload-unknown-content-bound-recovery',status:'passed'});
});
test('P0 cancellation preserves completed/unknown item accounting and never reports a lost submission cancelled',async()=>{
  const f=fixture(),taskId=await prepare(f);await f.service().submitBatch(taskId);const result=await f.service().cancel(taskId);
  assert.equal(result.state,'cancelled');assert.ok(result.items.every(i=>i.state==='unknown'));assert.ok(Number(result.reserved_cost_micros)>0);
  const local=await prepare(f);await f.service().cancel(local);assert.equal((await f.service().read(local)).state,'cancelled');
  const unknown=fixture({unknownSubmit:true}),pending=await prepare(unknown);await assert.rejects(unknown.service().submitBatch(pending));await assert.rejects(unknown.service().cancel(pending),/outcome_unresolved/);
  checks.push({name:'batch-cancel-partial-unknown-holds',status:'passed'});
});
test('P0 current no-call authorization fence prevents upload/submission and leaves durable reservations intact',async()=>{
  const f=fixture({approval:false}),taskId=await prepare(f);await assert.rejects(f.service().submitBatch(taskId),/not_authorized/);
  assert.deepEqual(f.calls,['approve']);const task=await f.service().read(taskId);assert.equal(task.state,'prepared');assert.ok(task.items.every(i=>i.attempt_id===null));
  checks.push({name:'zero-model-authorization-fence',status:'passed'});
});
test('P0 concurrent submission has one durable winner and one actual native submission',async()=>{
  const f=fixture(),taskId=await prepare(f),results=await Promise.allSettled([f.service().submitBatch(taskId),f.service().submitBatch(taskId)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.calls.filter(c=>c==='submit').length,1);assert.equal(f.calls.filter(c=>c==='upload').length,1);
  checks.push({name:'concurrent-submit-CAS',status:'passed'});
});
test('P0 native public search reuses original-page Evidence, reenters without replay and checks active owner',async()=>{
  const f=fixture(),task=await f.service().prepareSearch(randomUUID(),{query:'合成瓷砖执行标准',domains:[]},bailianSearchBinding(binding)),taskId=String(task.id);tasks.push(taskId);
  const snapshot=await f.service().search(taskId,async url=>({url,type:'text/plain',body:'这是合成测试的实际正文，保存公开网址、hash和读取时间，搜索摘要不能替代这段正文，也不能证明项目现场情况。'}));
  assert.equal(snapshot.status,'ready');assert.equal(snapshot.pages.length,1);assert.ok(snapshot.pages[0].hash);assert.doesNotMatch(snapshot.pages[0].text,/摘要不能作为证据/);
  assert.deepEqual(await f.service().search(taskId),snapshot);assert.equal(f.calls.filter(c=>c==='search').length,1);
  await withPlatformTransaction(tx=>tx.execute(sql`update app.admin_users set status='disabled' where id=${admins[0]}`));
  try{await assert.rejects(f.service().read(taskId),/forbidden/);}finally{await withPlatformTransaction(tx=>tx.execute(sql`update app.admin_users set status='active' where id=${admins[0]}`));}
  checks.push({name:'native-search-real-evidence-reentry-permission',status:'passed'});
});
test('P0 approved draft checks stale version, epoch and revoke; protocol conflict prevents real dispatch',async()=>{
  const f=fixture(),epoch=await withTenantTransaction(tenants[0],async tx=>Number((await one(tx,sql`select knowledge_epoch from app.assistant_enterprise_settings where enterprise_id=${tenants[0]}`))!.knowledge_epoch));
  const prefix='收纳建议草稿：',draft={prefix,version:2,prefixHash:fingerprint(prefix),expiresAt:new Date(Date.now()+60000).toISOString(),enterpriseId:tenants[0],ownerId:admins[0],knowledgeEpoch:epoch,consentVersion:1,status:'approved' as const};
  const taskId=String((await f.service().prepareDraft(randomUUID(),draft,binding)).id);tasks.push(taskId);
  await assert.rejects(f.service().continueDraft(taskId,3,1),/stale/);await assert.rejects(f.service().continueDraft(taskId,2,1),/protocol_unverified/);assert.equal(f.calls.length,0);
  const verified=fixture({partial:true}),continued=await verified.service().continueDraft(taskId,2,1) as {text:string};assert.equal(continued.text,prefix+'先把常用物品分类。');
  assert.deepEqual(await verified.service().continueDraft(taskId,2,1),continued);assert.equal(verified.calls.filter(c=>c==='partial').length,1);
  await verified.service().revoke(taskId);await assert.rejects(verified.service().continueDraft(taskId,2,1),/revoked/);
  checks.push({name:'partial-binding-stale-revoke-conflict-reentry',status:'passed'});
});

test('P0 unreadable original pages recover from saved candidates without another model attempt',async()=>{
  const f=fixture(),task=await f.service().prepareSearch(randomUUID(),{query:'合成公开标准',domains:[]},bailianSearchBinding(binding)),taskId=String(task.id);tasks.push(taskId);
  const failed=await f.service().search(taskId,async()=>{throw Error('synthetic DNS outage');});
  assert.equal(failed.status,'unavailable');const before=await f.service().read(taskId);
  assert.deepEqual(await f.service().search(taskId),failed);
  const recovered=await f.service().retrySearchRead(taskId,async url=>({url,type:'text/plain',body:'合成原文正文：这段文字实际来自只读页回调，保留原搜索URL、读取时间与hash。搜索模型没有重新执行，也没有新增业务写入。'}));
  assert.equal(recovered.status,'ready');assert.equal(recovered.pages.length,1);
  assert.deepEqual(await f.service().search(taskId),recovered);assert.deepEqual(await f.service().retrySearchRead(taskId),recovered);
  const after=await f.service().read(taskId);assert.equal(after.items[0].attempt_id,before.items[0].attempt_id);
  assert.equal(after.items[0].response_hash,before.items[0].response_hash);
  assert.deepEqual(after.items[0].result,before.items[0].result);
  assert.equal((after.result as {readHistory:unknown[]}).readHistory.length,1);
  assert.equal(f.calls.filter(c=>c==='search').length,1);assert.equal(f.calls.filter(c=>c==='approve').length,1);
  await f.service().revoke(taskId);await assert.rejects(f.service().retrySearchRead(taskId),/revoked/);
  checks.push({name:'saved-public-page-read-recovery-no-provider-replay',status:'passed'});
});
