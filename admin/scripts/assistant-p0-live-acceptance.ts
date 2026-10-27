import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { AiCreationRepository } from '@/db/repositories/ai-creation-repository';
import { closePostgresPool } from '@/lib/postgresql';
import { getPlatformLlmOverrideRuntime } from '@/lib/platform-llm-config';
import { AiProviderError, type AiProviderRuntimeConfig } from '@/lib/ai/provider-types';
import { agentChatBody, executeAgentChat, parseAgentUsage } from '@/lib/ai/providers/agent-chat';
import { bailianBinding, bailianSearchBinding } from '@/lib/ai/providers/bailian-capabilities';
import { bailianOfflineTransport } from '@/lib/ai/providers/bailian-offline';
import { ModelTaskService, type ModelTaskPorts } from '@/lib/assistant/agent/model-tasks';
import { partialBody, joinDraft } from '@/lib/assistant/agent/draft-continuation';
import { fingerprint } from '@/lib/assistant/contracts';
import { toolSchemaIssue } from '@/lib/assistant/agent/tool-protocol';
import type { ModelMessage, ModelTool, ModelTurnInput, ModelTurnOutput } from '@/lib/assistant/contracts/model';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';
import { bindBailianReviewTestRuntime } from './bailian-review-test-runtime';
import { reviewBudget, type RetainedReviewHold } from './assistant-review-budget';

const root = path.resolve(process.cwd(), '..');
const runId = 'p0-native-' + new Date().toISOString().replace(/[:.]/g, '-');
const directory = path.join(root, 'tmp/xiaok-p0-live-20261027', runId);
const ledgerFile = path.join(root, 'tmp/agent-contract', 'trial-' + runId + '.json');
const binding = bailianBinding('https://dashscope.aliyuncs.com/compatible-mode', 'qwen3.8-flash', false)!;
const repairFlag=process.argv.indexOf('--repair-search');
const resumeFlag=process.argv.indexOf('--resume-batch');
const priorFile=repairFlag>=0?process.argv[repairFlag+1]:resumeFlag>=0?process.argv[resumeFlag+1]:undefined;
const prior=priorFile?JSON.parse(fs.readFileSync(path.resolve(root,priorFile),'utf8')):null;
type Call = { id:string; runId:string; status:string; reservedTokens:number; usage?:{total_tokens:number}; attemptId?:string; taskId?:string; customId?:string };
const report = { version:1, runId, scope:'P0 fixed native protocols, not D1 user acceptance',
  authorization:{authorizedBy:'direct-human-user', instruction:'允许追加必要的模型调用，使用百炼 qwen3.8-flash 补齐 P0 实模验收，累计预算不超过100元，完成后继续 D1。', cumulativeCapMicros:100_000_000, operationalCallCap:16, fixedPlannedCalls:14},
  binding, startedAt:new Date().toISOString(), calls:[] as Call[], checks:[] as Array<{name:string;passed:boolean;detail:unknown}>,
  requests:[] as Array<Record<string,unknown>>, fixture:{} as Record<string,string>, tasks:{} as Record<string,string>,
  sourceBefore:{} as Record<string,string>, sourceAfter:{} as Record<string,string>, noDrift:false,
  runtimeReceipt:null as unknown, budgetBefore:0, budgetAfter:0, restored:false, error:null as string|null, passed:false };
if(prior){
  assert.equal(prior.noDrift,true);assert.equal(fingerprint(prior.binding),fingerprint(binding));
  assert.equal(prior.authorization.authorizedBy,'direct-human-user');
  Object.assign(report,{scope:repairFlag>=0?'P0 native-search endpoint mechanism repair':'P0 original Batch result retrieval only',
    priorEvidence:{file:priorFile,hash:sha(fs.readFileSync(path.resolve(root,priorFile!))),originalChecks:prior.checks},
  });
  report.authorization.fixedPlannedCalls=repairFlag>=0?1:0;
}
let runtime:AiProviderRuntimeConfig, service:ModelTaskService, activeCase='', wire=0;
const originalFetch=globalThis.fetch;
const save=()=>fs.writeFileSync(ledgerFile,JSON.stringify(report,null,2));
function sha(value:Buffer|string){return createHash('sha256').update(value).digest('hex');}
function sources() {
  const files:string[]=[];
  const walk=(dir:string)=>{for(const entry of fs.readdirSync(path.join(root,dir),{withFileTypes:true})) {
    const file=dir+'/'+entry.name;if(entry.isDirectory())walk(file);else if(/\.(ts|mjs|json)$/.test(file))files.push(file);
  }};
  for(const dir of ['admin/src/lib/assistant','admin/src/lib/ai/providers','admin/src/db/repositories'])walk(dir);
  files.push('admin/scripts/assistant-p0-live-acceptance.ts','admin/scripts/assistant-model-capabilities.ts','admin/scripts/assistant-review-budget.ts',
    'admin/scripts/assistant-partial-evidence.ts','admin/scripts/__tests__/assistant-partial-evidence.test.ts','admin/scripts/__tests__/assistant-native-search-stream.test.ts',
    'admin/scripts/bailian-review-test-runtime.ts','admin/scripts/assistant-acceptance-safety.mjs','admin/src/lib/platform-llm-config.ts',
    'admin/src/lib/ai/postgres-workflow-chat.ts','admin/package-lock.json','admin/tsconfig.json','tmp/xiaok-vector/connection.private.json',
    'tmp/xiaok-intelligent-consult/.env.qwen37','tmp/xiaok-intelligent-consult/openwebui-qwen37-cost.mjs');
  return Object.fromEntries(files.sort().map(file=>[file,sha(fs.readFileSync(path.join(root,file)))]));
}
function holds():RetainedReviewHold[] {
  return ['tmp/anythingllm-pilot','tmp/agent-comparison','tmp/agent-diagnosis','tmp/agent-contract'].flatMap(dir=>
    fs.readdirSync(path.join(root,dir)).filter(f=>/^trial-.*\.json$/.test(f)).flatMap(f=>
      (JSON.parse(fs.readFileSync(path.join(root,dir,f),'utf8')).calls||[]).filter((c:Call)=>c.status!=='succeeded')
        .map((c:Call)=>({id:c.id,runId:c.runId,reservedTokens:c.reservedTokens}))));
}
function allocate(caseId:string,tokens=60_000,taskId?:string,customId?:string) {
  assert.ok(report.calls.length<16,'Fixed P0 call cap');
  if(prior){
    const repairs=fs.readdirSync(path.join(root,'tmp/agent-contract')).filter(f=>/^trial-p0-native-.*\.json$/.test(f))
      .map(f=>JSON.parse(fs.readFileSync(path.join(root,'tmp/agent-contract',f),'utf8')))
      .filter(r=>r.priorEvidence?.file===priorFile);
    assert.ok(prior.calls.length+repairs.reduce((n,r)=>n+r.calls.length,0)<16,'Original P0 batch plus all repairs cannot exceed16 items');
    assert.ok(!repairs.some(r=>r.checks.some((c:{name:string;passed:boolean})=>c.name==='native-search-and-original-read'&&c.passed)),'Successful original search evidence must be reused');
    assert.ok(!repairs.some(r=>r.calls.some((c:Call)=>c.status==='succeeded')),'A successful search response requires saved-page recovery, not another search-model call');
  }
  assert.ok(!report.calls.some(c=>c.status==='unknown'&&(!c.taskId||['search','draft'].includes(c.customId||''))),'New ambiguous synchronous request blocks further inference');
  // Historical and this fixed batch's already-reserved async items are retained.
  reviewBudget(root).assertReservation(0,tokens,holds());
  const call:Call={id:runId+':'+caseId,runId:taskId?'model-task:'+taskId:runId,status:'reserved',reservedTokens:tokens,taskId,customId};
  assert.ok(!report.calls.some(c=>c.id===call.id),'No replay');report.calls.push(call);save();return call;
}
async function check(name:string,fn:()=>Promise<unknown>) {
  activeCase=name;
  try {const detail=await fn();report.checks.push({name,passed:true,detail:detail??null});}
  catch(error) {report.checks.push({name,passed:false,detail:error instanceof Error?error.message:'Failed'});}
  if(service)await exportTasks();
  save();console.log(JSON.stringify({check:name,...report.checks.at(-1),calls:report.calls.length,budgetMicros:reviewBudget(root).usedMicros}));
}
async function probe(caseId:string,request:ModelTurnInput|ReturnType<typeof partialBody>) {
  const call=allocate(caseId);activeCase=caseId;
  const requestBody='messages' in request&&'tools' in request?agentChatBody(request as ModelTurnInput,runtime.baseUrl):request;
  const attempt=await withTenantTransaction(report.fixture.enterpriseId,tx=>new AiCreationRepository(tx).createProviderAttempt({
    enterpriseId:BigInt(report.fixture.enterpriseId),providerConfigId:BigInt(runtime.id),providerKey:runtime.key,
    adapterType:runtime.adapterType,capability:'chat',logicalModelKey:'chat.general',remoteModel:binding.model,status:'unknown',accepted:true,
    requestFingerprint:fingerprint(requestBody),estimatedCost:{measurementKind:'reserved',micros:String(call.reservedTokens*5)},
    metadata:{acceptanceId:runId,caseId,synthetic:true,reservedTokens:call.reservedTokens}}));
  call.attemptId=String(attempt.id);call.status='unknown';save();
  try {
    const result='tools' in request?await executeAgentChat(runtime,request as ModelTurnInput)
      :await bailianOfflineTransport(runtime,binding).continueDraft(request as ReturnType<typeof partialBody>);
    if(result.usage){call.usage={total_tokens:result.usage.inputTokens+result.usage.outputTokens};call.status='succeeded';}
    await withTenantTransaction(report.fixture.enterpriseId,tx=>new AiCreationRepository(tx).updateProviderAttempt(attempt.id,{
      status:result.usage?'succeeded':'unknown',accepted:true,
      actualCost:{measurementKind:'unavailable'},metadata:{acceptanceId:runId,caseId,synthetic:true,usage:result.usage,
        observation:result.observation,providerRequestId:result.providerRequestId,reservedTokens:call.reservedTokens,responseHash:fingerprint(result)}}));
    save();return result;
  }catch(error) {
    const rejected=error instanceof AiProviderError&&Number(error.status)>=400&&Number(error.status)<500&&error.status!==408;
    const last=report.requests.at(-1);
    const captured=last?.caseId===caseId?JSON.parse(fs.readFileSync(String(last.file),'utf8')):null;
    const observed=captured?.status===200?parseAgentUsage(captured.response?.usage):null;
    if(observed)call.usage={total_tokens:observed.inputTokens+observed.outputTokens};
    call.status=observed?'succeeded':rejected?'failed':'unknown';
    await withTenantTransaction(report.fixture.enterpriseId,tx=>new AiCreationRepository(tx).updateProviderAttempt(attempt.id,{
      status:observed?'succeeded':rejected?'failed':'unknown',accepted:!rejected,errorCode:error instanceof AiProviderError?error.code:'P0_PROTOCOL_PARSE_OR_UNKNOWN',
      errorMessage:'Original protocol request retained; no automatic retry',metadata:{acceptanceId:runId,caseId,synthetic:true,reservedTokens:call.reservedTokens}}));
    save();throw error;
  }
}
async function exportTasks() {
  for(const taskId of Object.values(report.tasks)) {
    const task=await service.read(taskId);
    for(const item of task.items) {
      const call=report.calls.find(c=>c.taskId===taskId&&c.customId===item.custom_id);if(!call)continue;
      call.attemptId=item.attempt_id?String(item.attempt_id):undefined;
      const attempt=item.attempt_id?await withTenantTransaction(report.fixture.enterpriseId,tx=>one(tx,sql`select status,metadata from app.ai_provider_attempts where id=${String(item.attempt_id)}`)):null;
      const usage=(attempt?.metadata as {usage?:ModelTurnOutput['usage']}|undefined)?.usage;
      if(usage){call.usage={total_tokens:usage.inputTokens+usage.outputTokens};call.status=attempt?.status==='succeeded'?'succeeded':String(attempt?.status);}
      else call.status=item.state==='failed'?'failed':item.state==='succeeded'?'succeeded':'unknown';
    }
  }
  save();
}
function installWireCapture() {
  globalThis.fetch=async(input,init)=>{
    const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
    if(url.hostname!=='dashscope.aliyuncs.com')return originalFetch(input,init);
    const sequence=++wire,body=typeof init?.body==='string'?JSON.parse(init.body):init?.body instanceof FormData?{multipart:true,purpose:init.body.get('purpose')}:null;
    if(body?.model)assert.equal(body.model,binding.model);
    const file=path.join(directory,String(sequence).padStart(3,'0')+'-wire.json');
    const record:Record<string,unknown>={sequence,caseId:activeCase,url:url.href,method:init?.method||'GET',body,startedAt:new Date().toISOString()};
    const start=Date.now();fs.writeFileSync(file,JSON.stringify(record,null,2));
    try {
      const response=await originalFetch(input,init);const raw=await response.clone().text();
      Object.assign(record,{status:response.status,latencyMs:Date.now()-start,responseHash:sha(raw),responseBytes:Buffer.byteLength(raw),requestId:response.headers.get('x-request-id')});
      // No authorization headers or error body is persisted. Successful synthetic
      // output and JSONL are retained verbatim, including original first drafts.
      if(response.ok){try{record.response=JSON.parse(raw);}catch{record.responseText=raw;}}
      else {try{const e=JSON.parse(raw);record.errorCode=e.error?.code||e.code;record.errorMessage=String(e.error?.message||e.message||'').replaceAll(runtime.apiKey,'[REDACTED]');}catch{/* hashes retain unknown body */}}
      fs.writeFileSync(file,JSON.stringify(record,null,2));report.requests.push({sequence,caseId:activeCase,url:url.href,status:response.status,file});save();return response;
    }catch(error){Object.assign(record,{transportError:true,latencyMs:Date.now()-start});fs.writeFileSync(file,JSON.stringify(record,null,2));throw error;}
  };
}
async function protocols() {
  const longSystem='你是装修咨询助手。测试资料均为合成资料。工具只读，不能保存、确认或承诺项目事项。用简体中文简短解释。'+
    Array.from({length:110},(_,i)=>`参考资料${i+1}：核对房间用途、基层状况、通行安全和材料说明；预算未定可以先了解准备事项，不推断现场事实。`).join('\n');
  const lookup:ModelTool={name:'read_preparation_reference',description:'读取合成的装修准备资料，按本轮话题选择房间。只读，不保存需求。',parameters:{type:'object',properties:{room:{type:'string',enum:['kitchen','bathroom']}},required:['room'],additionalProperties:false}};
  const first:ModelMessage[]=[{role:'system',content:[{type:'text',text:longSystem}]}];
  for(const [index,text] of ['厨房地砖有点滑，预算还没想好，换砖前要留意什么？','刚才说错了，是老人用的卫生间，施工前先看哪些地方？'].entries()) {
    await check('function-roundtrip-'+(index+1),async()=>{
      first.push({role:'user',content:[{type:'text',text}]});
      const out=await probe('function-'+index+'-call',{model:binding.model,messages:first,tools:[lookup],maxTokens:512,enableThinking:false,requireTool:true});
      assert.equal(out.toolCalls.length,1);const call=out.toolCalls[0];assert.equal(call.name,lookup.name);assert.equal(await toolSchemaIssue(lookup,call.arguments),null);
      const args=JSON.parse(call.arguments);assert.equal(args.room,index?'bathroom':'kitchen');
      first.push({role:'assistant',content:out.text,toolCalls:out.toolCalls});
      first.push({role:'tool',callId:call.id,content:JSON.stringify({sourceId:'synthetic-room-'+args.room,room:args.room,readOnly:true,text:'核对基层和平整度、湿区防滑和排水，以及门口高差；现场情况需要测量后判断。'})});
      const final=await probe('function-'+index+'-return',{model:binding.model,messages:first,tools:[],maxTokens:512,enableThinking:false});
      assert.equal(final.toolCalls.length,0);assert.ok(final.text.trim());assert.doesNotMatch(final.text,/已(?:保存|确认|提交)/);
      first.push({role:'assistant',content:final.text,toolCalls:[]});return {requestId:final.providerRequestId,cache:[out.observation?.cache,final.observation?.cache]};
    });
  }
  const finalTool:ModelTool={name:'final_response',description:'JSON装修咨询答复',parameters:{type:'object',properties:{reply:{type:'string'},sourceIds:{type:'array',items:{type:'string'},uniqueItems:true}},required:['reply','sourceIds'],additionalProperties:false}};
  for(const mode of ['json_object','json_schema'] as const)await check(mode,async()=>{
    const result=await probe(mode,{model:binding.model,enableThinking:false,maxTokens:512,requireTool:true,outputMode:mode,tools:[finalTool],messages:[
      {role:'system',content:[{type:'text',text:'用JSON回答，严格使用reply和sourceIds字段。没有已读资料时sourceIds为空；不作业务完成承诺。'}]},
      {role:'user',content:[{type:'text',text:'老房量房前我能做什么准备？'}]}]});
    assert.deepEqual(result.observation?.format,{mode,jsonValid:true,schemaValid:true});return {format:result.observation?.format,requestId:result.providerRequestId};
  });
  for(let i=0;i<2;i++)await check('explicit-cache-'+(i+1),async()=>{
    const result=await probe('explicit-cache-'+i,{model:binding.model,enableThinking:false,maxTokens:256,cacheControl:'ephemeral_system',tools:[],messages:[
      {role:'system',content:[{type:'text',text:longSystem}]},{role:'user',content:[{type:'text',text:i?'卫生间量房前准备哪些资料？':'厨房量房前准备哪些资料？'}]}]});
    assert.ok(result.usage);return {cache:result.observation?.cache,latencyMs:result.observation?.latencyMs,requestId:result.providerRequestId};
  });
  await searchCheck();
  let partialProof=false;
  const prefix='给业主的一句量房提醒：现场测量前，先';
  await check('partial-protocol-discriminator',async()=>{
    const result=await probe('partial-protocol',partialBody(binding,prefix));
    assert.equal(result.toolCalls.length,0);assert.ok(result.usage);const text=joinDraft(prefix,result.text);partialProof=true;
    const evidence={protocol:'bailian-partial-live-v1',binding,sourceHashes:report.sourceBefore,prefix,request:partialBody(binding,prefix),result,
      requestHash:fingerprint(partialBody(binding,prefix)),responseHash:fingerprint(result),wireFile:report.requests.at(-1)?.file};
    fs.writeFileSync(path.join(directory,'partial-evidence.json'),JSON.stringify(evidence,null,2));return {requestId:result.providerRequestId,text};
  });
  await check('partial-persisted-task-and-reentry',async()=>{
    assert.ok(partialProof,'Exact protocol probe must pass first');
    const epoch=await withTenantTransaction(report.fixture.enterpriseId,async tx=>Number((await one(tx,sql`select knowledge_epoch from app.assistant_enterprise_settings where enterprise_id=${report.fixture.enterpriseId}`))!.knowledge_epoch));
    const draft={prefix,version:1,prefixHash:fingerprint(prefix),expiresAt:new Date(Date.now()+3600000).toISOString(),enterpriseId:report.fixture.enterpriseId,ownerId:report.fixture.adminId,knowledgeEpoch:epoch,consentVersion:1,status:'approved' as const};
    const ports={...service.ports,partialVerified:async()=>partialProof};const verified=new ModelTaskService(service.actor,ports);
    const task=await verified.prepareDraft(randomUUID(),draft,binding);report.tasks.draft=String(task.id);save();
    const result=await verified.continueDraft(String(task.id),1,1);await exportTasks();assert.deepEqual(await verified.continueDraft(String(task.id),1,1),result);
    return {taskId:String(task.id),result};
  });
}
async function searchCheck() {
  await check('native-search-and-original-read',async()=>{
    const task=await service.prepareSearch(randomUUID(),{query:'GB/T 4100 陶瓷砖 国家标准 标准状态',domains:['openstd.samr.gov.cn']},bailianSearchBinding(binding));
    report.tasks.search=String(task.id);save();const result=await service.search(String(task.id));await exportTasks();
    assert.equal(result.status,'ready');assert.ok(result.pages.length);assert.ok(result.pages.every(p=>p.hash&&p.text.length>=40));
    assert.deepEqual(await service.search(String(task.id)),result);return {taskId:String(task.id),status:result.status,pages:result.pages.map(p=>({url:p.url,hash:p.hash,textBytes:p.textBytes})),failures:result.failures};
  });
}
async function resumeOriginalBatch() {
  assert.ok(prior?.tasks.batch,'Original remote Batch identity is required');
  const actor={enterpriseId:String(prior.fixture.enterpriseId),adminId:String(prior.fixture.adminId)};
  const originalState=await withPlatformTransaction(async tx=>{
    const manager=await one(tx,sql`select a.status,e.code from app.admin_users a join app.enterprises e on e.id=a.enterprise_id where a.id=${actor.adminId} and a.enterprise_id=${actor.enterpriseId}`);
    assert.equal(manager?.code,prior.runId,'Only the original labelled synthetic fixture may resume');
    await tx.execute(sql`update app.admin_users set status='active' where id=${actor.adminId}`);return String(manager!.status);
  });
  const resumed=new ModelTaskService(actor,{...service.ports,approve:async()=>{throw Error('Batch resume never authorizes inference');}});
  try{
    await check('original-batch-result-recovery',async()=>{
      let task=await resumed.syncBatch(prior.tasks.batch);
      for(let i=0;i<20&&!['completed','failed','expired','cancelled'].includes(String(task.remote_status));i++) {
        console.log(JSON.stringify({originalBatch:prior.tasks.batch,status:task.remote_status,poll:i}));
        await new Promise(r=>setTimeout(r,30000));task=await resumed.syncBatch(prior.tasks.batch);
      }
      assert.equal(task.state,'completed');assert.ok(task.items.every(i=>i.state==='succeeded'));
      assert.deepEqual((await resumed.syncBatch(prior.tasks.batch)).items,task.items);
      const originalPath=path.resolve(root,priorFile!),saved=JSON.parse(fs.readFileSync(originalPath,'utf8'));
      fs.writeFileSync(path.join(directory,'original-ledger-before-resolution.json'),JSON.stringify(saved,null,2));
      for(const item of task.items){
        const call=saved.calls.find((c:Call)=>c.taskId===String(task.id)&&c.customId===item.custom_id);assert.ok(call);
        const usage=(item.result as {usage?:ModelTurnOutput['usage']}|null)?.usage;
        assert.ok(usage);call.status='succeeded';call.usage={total_tokens:usage.inputTokens+usage.outputTokens};
        call.resolutionEvidence=ledgerFile;
      }
      saved.accountingResolution={at:new Date().toISOString(),evidence:ledgerFile,originalReportHash:sha(fs.readFileSync(originalPath)),note:'Original checks/failures remain unchanged; only observed item usage resolves original holds'};
      fs.writeFileSync(originalPath,JSON.stringify(saved,null,2));
      return {taskId:String(task.id),remoteId:task.remote_batch_id,state:task.state,items:task.items};
    });
  }finally{await withPlatformTransaction(tx=>tx.execute(sql`update app.admin_users set status=${originalState} where id=${actor.adminId}`));}
}
async function main() {
  assert.ok(process.argv.includes('--live'),'Explicit live switch required');fs.mkdirSync(directory,{recursive:true});
  loadEnvConfig(process.cwd(),true);process.env.LANGCHAIN_TRACING_V2='false';process.env.LANGSMITH_TRACING='false';
  const config=JSON.parse(fs.readFileSync(path.join(root,'tmp/xiaok-vector/connection.private.json'),'utf8').replace(/^\uFEFF/,''));process.env.DATABASE_URL=config.DATABASE_URL;
  report.sourceBefore=sources();report.budgetBefore=reviewBudget(root).usedMicros;save();
  let unlock:(()=>Promise<void>)|undefined,restore:(()=>Promise<unknown>)|undefined;
  try {
    if(!prior){
      const existing=fs.readdirSync(path.join(root,'tmp/agent-contract')).filter(f=>/^trial-p0-native-.*\.json$/.test(f))
        .map(f=>JSON.parse(fs.readFileSync(path.join(root,'tmp/agent-contract',f),'utf8')));
      assert.ok(!existing.some(r=>r.authorization?.instruction===report.authorization.instruction&&r.calls.length),
        'Fixed P0 native batch already dispatched; reuse evidence or explicitly recover its named failure');
    }
    unlock=await lockAssistantAcceptance(config.DATABASE_URL);
    const bound=await bindBailianReviewTestRuntime(root,ledgerFile);restore=bound.restore;report.runtimeReceipt=bound.receipt;
    runtime=(await getPlatformLlmOverrideRuntime('chat'))!;assert.equal(runtime.modelMappings['chat.general'],binding.model);assert.equal(fingerprint(bailianBinding(runtime.baseUrl,binding.model,false)),fingerprint(binding));
    await withPlatformTransaction(async tx=>{
      const enterprise=(await one(tx,sql`insert into app.enterprises(name,code,status) values(${runId},${runId},'active') returning id`))!;
      report.fixture.enterpriseId=String(enterprise.id);
      await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days) values(${String(enterprise.id)},true,100,4000000,100000000,90)`);
      const admin=(await one(tx,sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,menu_permissions,must_change_password) values(${String(enterprise.id)},${runId},'synthetic-test-only','enterprise_admin','active',ARRAY['assistant-knowledge'],false) returning id`))!;
      report.fixture.adminId=String(admin.id);
    });
    const ports:ModelTaskPorts={runtime:async()=>runtime,transport:bailianOfflineTransport,approve:async(task:Row,count:number)=>{
      assert.equal((task.items as Row[]).length,count);for(const item of task.items as Row[])allocate('task-'+task.id+'-'+item.custom_id,task.kind==='public_search'?1_050_000:60_000,String(task.id),String(item.custom_id));
      return {id:runId};
    },partialVerified:async()=>false};
    service=new ModelTaskService({enterpriseId:report.fixture.enterpriseId,adminId:report.fixture.adminId},ports);save();installWireCapture();
    if(prior){
      if(repairFlag>=0)await searchCheck();
      await resumeOriginalBatch();return;
    }
    await check('batch-submit-and-persist',async()=>{
      const task=await service.prepareBatch(randomUUID(),{synthetic:true,items:[{customId:'kitchen',text:'厨房量房前要准备什么？请简短回答。',maxTokens:256},{customId:'bathroom',text:'卫生间量房前要准备什么？请简短回答。',maxTokens:256}]},binding);
      report.tasks.batch=String(task.id);save();const submitted=await service.submitBatch(String(task.id));
      assert.ok(submitted.remote_batch_id);assert.equal((await service.submitBatch(String(task.id))).remote_batch_id,submitted.remote_batch_id);
      return {taskId:String(task.id),remoteId:submitted.remote_batch_id,status:submitted.remote_status};
    });
    await check('batch-actual-cancel',async()=>{
      const task=await service.prepareBatch(randomUUID(),{synthetic:true,items:[{customId:'cancel',text:'装修量房前准备哪些资料？请简短回答。',maxTokens:128}]},binding);
      report.tasks.cancel=String(task.id);save();await service.submitBatch(String(task.id));const cancelled=await service.cancel(String(task.id));await exportTasks();
      assert.ok(['cancelling','cancelled','completed'].includes(String(cancelled.remote_status)));
      return {taskId:String(task.id),status:cancelled.remote_status,state:cancelled.state};
    });
    await protocols();
    await check('batch-download-and-reentry',async()=>{
      assert.ok(report.tasks.batch);let task=await service.read(report.tasks.batch);
      for(let i=0;i<40&&!['completed','failed','expired','cancelled'].includes(String(task.remote_status));i++) {
        task=await service.syncBatch(report.tasks.batch);await exportTasks();
        console.log(JSON.stringify({batch:report.tasks.batch,status:task.remote_status,poll:i}));
        if(!['completed','failed','expired','cancelled'].includes(String(task.remote_status)))await new Promise(r=>setTimeout(r,15000));
      }
      assert.equal(task.state,'completed');assert.ok(task.items.every(i=>i.state==='succeeded'));
      const again=await service.syncBatch(report.tasks.batch);assert.deepEqual(again.items,task.items);await exportTasks();
      return {taskId:report.tasks.batch,remoteId:task.remote_batch_id,status:task.remote_status,items:task.items.map(i=>({customId:i.custom_id,state:i.state,attemptId:String(i.attempt_id)}))};
    });
    if(report.tasks.cancel)await check('cancel-terminal-readback',async()=>{
      const task=await service.syncBatch(report.tasks.cancel);await exportTasks();assert.ok(['cancelled','completed'].includes(String(task.remote_status)));return {state:task.state,status:task.remote_status,items:task.items};
    });
  }catch(error){report.error=error instanceof Error?error.message:'P0 acceptance failed';}
  finally {
    globalThis.fetch=originalFetch;
    try{if(service)await exportTasks();}catch(error){report.error??=String(error);}
    try{if(report.fixture.enterpriseId)await withPlatformTransaction(async tx=>{await tx.execute(sql`update app.assistant_enterprise_settings set enabled=false where enterprise_id=${report.fixture.enterpriseId}`);await tx.execute(sql`update app.admin_users set status='disabled' where id=${report.fixture.adminId}`);});}catch(error){report.error??=String(error);}
    try{await restore?.();report.restored=!!restore;}catch(error){report.error??=String(error);}
    report.sourceAfter=sources();report.noDrift=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);report.budgetAfter=reviewBudget(root).usedMicros;
    report.passed=!report.error&&report.noDrift&&report.checks.every(c=>c.passed);save();
    await closePostgresPool();await unlock?.();console.log(JSON.stringify({ledgerFile,directory,passed:report.passed,calls:report.calls.length,checks:report.checks.map(c=>({name:c.name,passed:c.passed})),noDrift:report.noDrift,budgetAfter:report.budgetAfter,error:report.error}));
    if(!report.passed)process.exitCode=1;
  }
}
void main();
