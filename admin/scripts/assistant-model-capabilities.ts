import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { loadEnvConfig } from '@next/env';
import pg from 'pg';
import { ModelTaskService, type ModelTaskPorts } from '@/lib/assistant/agent/model-tasks';
import { bailianBinding, bailianCapabilities, bailianSearchBinding } from '@/lib/ai/providers/bailian-capabilities';
import { bailianOfflineTransport } from '@/lib/ai/providers/bailian-offline';
import { getPlatformLlmOverrideRuntime } from '@/lib/platform-llm-config';
import { closePostgresPool } from '@/lib/postgresql';
import { fingerprint } from '@/lib/assistant/contracts';
import { reviewBudget, type RetainedReviewHold } from './assistant-review-budget';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';

const root=path.resolve(process.cwd(),'..');
function isolatedConnection() {
  const config=JSON.parse(fs.readFileSync(path.join(root,'tmp/xiaok-vector/connection.private.json'),'utf8').replace(/^\uFEFF/,''));
  for(const name of ['DATABASE_URL','EMBEDDING_EVAL_OWNER_URL']) {
    const url=new URL(config[name]);if(!['localhost','127.0.0.1'].includes(url.hostname)||url.port!=='55432'||url.pathname!=='/xiaok_embedding_eval')throw Error('P0 requires the existing isolated database');
  }
  return config as {DATABASE_URL:string;EMBEDDING_EVAL_OWNER_URL:string};
}
/** Exact targeted development migration, recorded in the existing Drizzle
 * journal. Never applies other pending migrations or touches the main DB. */
export async function migrateP0Isolated() {
  const config=isolatedConnection(),client=new pg.Client({connectionString:config.EMBEDDING_EVAL_OWNER_URL});await client.connect();
  try {
    const journal=JSON.parse(fs.readFileSync(path.join(root,'admin/drizzle/meta/_journal.json'),'utf8'));
    const entry=journal.entries.find((e:{tag:string})=>e.tag==='0096_assistant_model_tasks');
    const source=fs.readFileSync(path.join(root,'admin/drizzle/'+entry.tag+'.sql'),'utf8'),hash=createHash('sha256').update(source).digest('hex');
    const existing=await client.query('select hash from app.__drizzle_migrations where created_at=$1',[entry.when]);
    if(existing.rows.length){if(existing.rows[0].hash!==hash)throw Error('P0 migration hash mismatch');return {applied:false,hash};}
    const present=await client.query("select to_regclass('app.assistant_model_tasks') present");if(present.rows[0].present)throw Error('Unrecorded model task schema requires inspection');
    await client.query('begin');try {
      await client.query(source);
      await client.query('insert into app.__drizzle_migrations(hash,created_at) values($1,$2)',[hash,entry.when]);
      await client.query('commit');return {applied:true,hash};
    }catch(error){await client.query('rollback');throw error;}
  }finally{await client.end();}
}

/** Additional live inference is opt-in only with a new explicit authorization
 * record. Current development does not create one. The same original ledger,
 * historical unknown holds, call count and CNY100 cap remain authoritative. */
function livePorts(authorizationFile?:string):ModelTaskPorts {
  return {
    async runtime(){const runtime=await getPlatformLlmOverrideRuntime('chat');if(!runtime)throw Error('No configured runtime');return runtime;},
    transport:bailianOfflineTransport,
    async approve(task,itemCount) {
      if(!authorizationFile)throw Error('additional_model_calls_not_authorized');
      const approval=JSON.parse(fs.readFileSync(path.resolve(authorizationFile),'utf8')) as {
        id:string;humanAuthorization:'explicit-additional-model-calls';bindingHash:string;expiresAt:string;
        approvedAdditionalCalls:number;cumulativeMicros:number;retainedHolds:RetainedReviewHold[];
      };
      if(approval.humanAuthorization!=='explicit-additional-model-calls'||fingerprint(task.binding)!==approval.bindingHash
        || !/^[a-zA-Z0-9._:-]{1,128}$/.test(approval.id)||!Number.isFinite(Date.parse(approval.expiresAt))||Date.parse(approval.expiresAt)<=Date.now()
        ||!Number.isSafeInteger(approval.approvedAdditionalCalls)||approval.approvedAdditionalCalls<itemCount
        ||approval.cumulativeMicros!==100_000_000)throw Error('Invalid additional model-call authorization');
      const file=path.join(root,'tmp/agent-contract',`trial-p0-model-task-${task.id}.json`);
      if(fs.existsSync(file)) {
        const saved=JSON.parse(fs.readFileSync(file,'utf8'));if(saved.authorizationId!==approval.id||saved.requestHash!==task.request_hash)throw Error('Original P0 reservation mismatch');
        return {id:approval.id};
      }
      const consumed=fs.readdirSync(path.dirname(file)).filter(f=>/^trial-p0-model-task-.*\.json$/.test(f))
        .reduce((n,f)=>{const value=JSON.parse(fs.readFileSync(path.join(path.dirname(file),f),'utf8'));return n+(value.authorizationId===approval.id?value.calls.length:0);},0);
      if(consumed+itemCount>approval.approvedAdditionalCalls)throw Error('Additional call count exhausted');
      reviewBudget(root).assertReservation(0,Number(task.reserved_tokens),approval.retainedHolds);
      // Persist every item before even uploading the file. A crash retains the
      // original full reservations and never makes the request look free.
      const items=(task as {items:Array<Record<string,unknown>>}).items;
      fs.writeFileSync(file,JSON.stringify({version:1,authorizationId:approval.id,requestHash:task.request_hash,taskId:String(task.id),
        binding:task.binding,calls:items.map(item=>({id:`p0-${task.id}-${item.custom_id}`,runId:`model-task:${task.id}`,status:'reserved',reservedTokens:Number(item.reserved_tokens)}))},null,2),{flag:'wx'});
      return {id:approval.id};
    },
    // Qwen3.8 model/API documentation still conflict. No environment flag can
    // label that protocol verified; the default service preserves the fence.
    partialVerified:async()=>false,
  };
}
async function exportTaskLedger(service:ModelTaskService,taskId:string) {
  const file=path.join(root,'tmp/agent-contract',`trial-p0-model-task-${taskId}.json`);if(!fs.existsSync(file))return;
  const original=JSON.parse(fs.readFileSync(file,'utf8')),task=await service.read(taskId);
  original.calls=task.items.map(item=>{const result=item.result as {usage?:{inputTokens:number;outputTokens:number}}|null;
    return {id:`p0-${taskId}-${item.custom_id}`,runId:`model-task:${taskId}`,status:item.state==='succeeded'?'succeeded':String(item.state),reservedTokens:Number(item.reserved_tokens),
      ...(result?.usage?{usage:{total_tokens:result.usage.inputTokens+result.usage.outputTokens}}:{})};});
  original.state=task.state;original.remoteBatchId=task.remote_batch_id;fs.writeFileSync(file,JSON.stringify(original,null,2));
}
async function main() {
  loadEnvConfig(process.cwd(),true);const command=process.argv[2]||'inspect';
  const binding=bailianBinding('https://dashscope.aliyuncs.com/compatible-mode','qwen3.8-flash',false)!;
  if(command==='inspect'){console.log(JSON.stringify(bailianCapabilities(binding),null,2));return;}
  const config=isolatedConnection();process.env.DATABASE_URL=config.DATABASE_URL;
  process.env.LANGCHAIN_TRACING_V2='false';process.env.LANGSMITH_TRACING='false';
  const unlock=await lockAssistantAcceptance(config.DATABASE_URL);
  try {
    if(command==='migrate-isolated'){console.log(JSON.stringify(await migrateP0Isolated()));return;}
    const enterpriseId=process.env.ASSISTANT_P0_ENTERPRISE_ID,adminId=process.env.ASSISTANT_P0_ADMIN_ID;
    if(!enterpriseId||!adminId)throw Error('Explicit synthetic enterprise/admin IDs are required');
    const flag=process.argv.indexOf('--authorization'),authorizationFile=flag<0?undefined:process.argv[flag+1];
    const service=new ModelTaskService({enterpriseId,adminId},livePorts(authorizationFile));
    let taskId=process.argv[3];
    try {
      let result:unknown;
      if(['prepare-batch','prepare-search','prepare-draft'].includes(command)){
        const data=JSON.parse(fs.readFileSync(path.resolve(taskId),'utf8'));
        result=command==='prepare-batch'?await service.prepareBatch(data.operationKey,data,binding)
          :command==='prepare-search'?await service.prepareSearch(data.operationKey,data.query,bailianSearchBinding(binding))
          :await service.prepareDraft(data.operationKey,data.draft,binding);taskId=String((result as {id:unknown}).id);
      }else if(command==='read')result=await service.read(taskId);
      else if(command==='submit')result=await service.submitBatch(taskId);
      else if(command==='sync')result=await service.syncBatch(taskId,process.argv[4]?.startsWith('--')?undefined:process.argv[4]);
      else if(command==='cancel')result=await service.cancel(taskId);
      else if(command==='recover-upload')result=await service.recoverUpload(taskId,process.argv[4]);
      else if(command==='search')result=await service.search(taskId);
      else if(command==='continue-draft')result=await service.continueDraft(taskId,Number(process.argv[4]),Number(process.argv[5]));
      else if(command==='revoke')await service.revoke(taskId);
      else throw Error('Unknown P0 capability command');
      const task=await service.read(taskId);console.log(JSON.stringify({taskId,state:task.state,remoteStatus:task.remote_status,
        itemStates:task.items.map(i=>({customId:i.custom_id,state:i.state})),reservedTokens:task.reserved_tokens,actualCost:null,
        ...(command==='search'?{searchStatus:(result as {status:string}).status}:{})}));
    }finally{if(/^[1-9]\d*$/.test(taskId||''))await exportTaskLedger(service,taskId);}
  }finally{await closePostgresPool();await unlock();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(error=>{
  console.error(error instanceof Error?error.message:'P0 capability operation failed');process.exitCode=1;
});
