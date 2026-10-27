import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {loadEnvConfig} from '@next/env';
import {sql} from 'drizzle-orm';
import {withPlatformTransaction,withTenantTransaction} from '@/db/transaction';
import {one,rows} from '@/db/repositories/assistant-repository';
import {closePostgresPool} from '@/lib/postgresql';
import {ModelTaskService,type ModelTaskPorts} from '@/lib/assistant/agent/model-tasks';
import {getPlatformLlmOverrideRuntime} from '@/lib/platform-llm-config';
import {bailianOfflineTransport} from '@/lib/ai/providers/bailian-offline';
import {reviewBudget} from './assistant-review-budget';
import {bindBailianReviewTestRuntime} from './bailian-review-test-runtime';
import {lockAssistantAcceptance} from './assistant-acceptance-safety.mjs';

const root=path.resolve(process.cwd(),'..'),directory=path.join(root,'tmp/xiaok-p0-live-20261027');
const output=path.join(directory,'recovery-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');
const firstFile=path.resolve(root,process.argv[2]||''),searchFile=path.resolve(root,process.argv[3]||'');
const hash=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
const first=JSON.parse(fs.readFileSync(firstFile,'utf8')),search=JSON.parse(fs.readFileSync(searchFile,'utf8'));
assert.equal(first.noDrift,true);assert.equal(search.noDrift,true);
const report={scope:'Original native-search page recovery and original async Batch retrieval, zero new inference',
  startedAt:new Date().toISOString(),providerInferenceCalls:0,metadataRequests:[] as Array<Record<string,unknown>>,
  inputs:{first:{file:firstFile,hash:hash(fs.readFileSync(firstFile))},search:{file:searchFile,hash:hash(fs.readFileSync(searchFile))}},
  sourceBefore:{} as Record<string,string>,sourceAfter:{} as Record<string,string>,noDrift:false,
  checks:[] as Array<{name:string;passed:boolean;detail:unknown}>,runtime:null as unknown,restored:false,
  budgetBefore:reviewBudget(root).usedMicros,budgetAfter:0,passed:false,error:null as string|null};
const save=()=>fs.writeFileSync(output,JSON.stringify(report,null,2));
function sourceBinding(){
  const files=['admin/scripts/assistant-p0-recovery.ts','admin/scripts/assistant-model-capabilities.ts','admin/scripts/assistant-partial-evidence.ts',
    'admin/scripts/assistant-review-budget.ts','admin/scripts/bailian-review-test-runtime.ts','admin/scripts/assistant-acceptance-safety.mjs',
    'admin/src/lib/assistant/agent/model-tasks.ts','admin/src/lib/assistant/agent/web.ts','admin/src/lib/assistant/knowledge/manager.ts',
    'admin/src/lib/ai/providers/bailian-offline.ts','admin/src/lib/ai/providers/bailian-capabilities.ts','admin/src/lib/ai/providers/agent-chat.ts',
    'admin/src/lib/ai/providers/http.ts','admin/src/lib/ai/providers/model-observation.ts','admin/src/db/transaction.ts',
    'admin/src/db/repositories/ai-creation-repository.ts','admin/src/db/assistant-model-task-schema.ts','admin/package-lock.json','admin/tsconfig.json',
    'admin/src/db/__tests__/assistant-model-tasks.test.ts','admin/scripts/__tests__/assistant-native-search-stream.test.ts',
    'tmp/xiaok-vector/connection.private.json','tmp/xiaok-intelligent-consult/.env.qwen37','tmp/xiaok-intelligent-consult/openwebui-qwen37-cost.mjs',
    'admin/node_modules/@langchain/core/dist/utils/event_source_parse.js','admin/.env','admin/.env.local'];
  return Object.fromEntries(files.filter(f=>fs.existsSync(path.join(root,f))).map(f=>[f,hash(fs.readFileSync(path.join(root,f)))]));
}
async function main(){
  loadEnvConfig(process.cwd(),true);process.env.DATABASE_URL=JSON.parse(fs.readFileSync(path.join(root,'tmp/xiaok-vector/connection.private.json'),'utf8').replace(/^\uFEFF/,'')).DATABASE_URL;
  process.env.LANGCHAIN_TRACING_V2='false';process.env.LANGSMITH_TRACING='false';process.env.ASSISTANT_WEB_DNS='alidns';
  report.sourceBefore=sourceBinding();save();const originalFetch=globalThis.fetch;
  let unlock:(()=>Promise<void>)|undefined,restore:(()=>Promise<unknown>)|undefined;
  const managers:Array<{id:string;status:string}>=[];
  try{
    unlock=await lockAssistantAcceptance(process.env.DATABASE_URL!);
    const bound=await bindBailianReviewTestRuntime(root,output);restore=bound.restore;report.runtime=bound.receipt;
    const runtime=(await getPlatformLlmOverrideRuntime('chat'))!;
    const ports:ModelTaskPorts={runtime:async()=>runtime,transport:bailianOfflineTransport,approve:async()=>{throw Error('Recovery authorizes no new inference');},partialVerified:async()=>false};
    globalThis.fetch=async(resource,init)=>{
      const url=new URL(typeof resource==='string'||resource instanceof URL?String(resource):resource.url);
      assert.equal(url.hostname,'dashscope.aliyuncs.com');assert.equal(init?.method||'GET','GET','No inference/upload/submission during recovery');
      assert.match(url.pathname,/\/(?:batches\/[^/]+|files\/[^/]+\/content)$/);
      const response=await originalFetch(resource,init),raw=await response.clone().text();
      const file=path.join(directory,path.basename(output,'.json')+'-metadata-'+report.metadataRequests.length+'.json');
      fs.writeFileSync(file,JSON.stringify({url:url.href,status:response.status,body:response.ok?raw:undefined,responseHash:hash(raw)},null,2));
      report.metadataRequests.push({url:url.href,status:response.status,file});save();return response;
    };
    const activate=async(record:typeof first)=>{
      const actor={enterpriseId:String(record.fixture.enterpriseId),adminId:String(record.fixture.adminId)};
      await withPlatformTransaction(async tx=>{
        const manager=await one(tx,sql`select a.status,e.code from app.admin_users a join app.enterprises e on e.id=a.enterprise_id where a.id=${actor.adminId} and a.enterprise_id=${actor.enterpriseId}`);
        assert.equal(manager?.code,record.runId,'Only the original labelled fixture may recover');
        managers.push({id:actor.adminId,status:String(manager!.status)});await tx.execute(sql`update app.admin_users set status='active' where id=${actor.adminId}`);
      });return new ModelTaskService(actor,ports);
    };
    const searchService=await activate(search),taskId=String(search.tasks.search);
    const attempts=()=>withTenantTransaction(search.fixture.enterpriseId,tx=>rows(tx,sql`select id,status,metadata from app.ai_provider_attempts where enterprise_id=${String(search.fixture.enterpriseId)} and metadata->'modelTask'->>'taskId'=${taskId} order by id`));
    const before=await attempts();
    const result=await searchService.retrySearchRead(taskId);
    assert.equal(result.status,'ready');assert.ok(result.pages.length);assert.deepEqual(await searchService.search(taskId),result);
    assert.deepEqual(await attempts(),before,'Page recovery must preserve the original model attempts and usage');
    report.checks.push({name:'original-search-read-recovery-and-persisted-reentry',passed:true,detail:{taskId,status:result.status,pages:result.pages.map(p=>({url:p.url,hash:p.hash,textBytes:p.textBytes,title:p.title})),failures:result.failures,attemptIds:before.map(a=>String(a.id))}});save();
    const batchService=await activate(first),batchId=String(first.tasks.batch),batch=await batchService.syncBatch(batchId);
    const terminal=batch.state==='completed'&&batch.items.every(i=>i.state==='succeeded');
    report.checks.push({name:'original-batch-results-and-reentry',passed:terminal,detail:{taskId:batchId,state:batch.state,remoteStatus:batch.remote_status,remoteId:batch.remote_batch_id,items:batch.items}});save();
    if(terminal){
      assert.deepEqual((await batchService.syncBatch(batchId)).items,batch.items);
      const ledger=JSON.parse(fs.readFileSync(firstFile,'utf8'));
      fs.writeFileSync(path.join(directory,path.basename(output,'.json')+'-original-ledger-before-resolution.json'),JSON.stringify(ledger,null,2));
      for(const item of batch.items){const call=ledger.calls.find((c:{taskId?:string;customId?:string})=>c.taskId===batchId&&c.customId===item.custom_id);assert.ok(call);
        const usage=(item.result as {usage?:{inputTokens:number;outputTokens:number}})?.usage;assert.ok(usage);
        call.status='succeeded';call.usage={total_tokens:usage.inputTokens+usage.outputTokens};call.resolutionEvidence=output;
      }
      ledger.accountingResolution={at:new Date().toISOString(),evidence:output,originalReportHash:hash(fs.readFileSync(firstFile)),note:'Original failed/pending checks remain; observed original-item usage only'};
      fs.writeFileSync(firstFile,JSON.stringify(ledger,null,2));
    }
  }catch(error){report.error=error instanceof Error?error.message:'Recovery failed';}
  finally{
    globalThis.fetch=originalFetch;
    for(const manager of managers.reverse())try{await withPlatformTransaction(tx=>tx.execute(sql`update app.admin_users set status=${manager.status} where id=${manager.id}`));}catch(error){report.error??=String(error);}
    try{await restore?.();report.restored=!!restore;}catch(error){report.error??=String(error);}
    report.sourceAfter=sourceBinding();report.noDrift=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);
    report.budgetAfter=reviewBudget(root).usedMicros;report.passed=!report.error&&report.noDrift&&report.checks.length===2&&report.checks.every(c=>c.passed);save();
    try{await closePostgresPool();}finally{await unlock?.();}console.log(JSON.stringify({output,passed:report.passed,checks:report.checks.map(c=>({name:c.name,passed:c.passed})),budgetMicros:report.budgetAfter,error:report.error,noDrift:report.noDrift}));
    if(!report.passed)process.exitCode=1;
  }
}
void main();
