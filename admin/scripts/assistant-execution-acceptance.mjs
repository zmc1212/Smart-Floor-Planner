import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import nextEnv from '@next/env';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';

const admin=path.resolve(import.meta.dirname,'..'),root=path.dirname(admin),agentPreflight=process.argv.includes('--agent-preflight'),agentUnits=process.argv.includes('--agent-units');
const transactions=process.argv.includes('--transactions')||agentPreflight;
for(const arg of process.argv.slice(2))if(!['--transactions','--wait-for-lock','--agent-preflight','--agent-units'].includes(arg))throw Error('Unknown acceptance argument');
if(agentUnits&&transactions)throw Error('Offline units and database modes must be separate');
const output=path.resolve(process.env.XIAOK_ACCEPTANCE_OUTPUT||path.join(root,'tmp/xiaok-execution-fence',agentPreflight?'agent-preflight':transactions?'transactions':agentUnits?'agent-units':'offline'));
fs.mkdirSync(output,{recursive:true});
if(transactions){
  nextEnv.loadEnvConfig(process.env.XIAOK_ACCEPTANCE_ENV_ROOT||admin,true);
  const file=process.env.XIAOK_ACCEPTANCE_CONNECTION_FILE;
  if(!file)throw Error('Explicit approved isolated connection file is required');
  process.env.DATABASE_URL=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')).DATABASE_URL;
}
const release=transactions?await lockAssistantAcceptance(undefined,{waitForLock:process.argv.includes('--wait-for-lock')}):async()=>{};
const files=agentPreflight?['src/db/__tests__/assistant-provider-preflight.test.ts']:transactions?['src/db/__tests__/assistant-execution-fence.test.ts','src/db/__tests__/assistant-provider-preflight.test.ts']:[
  'src/lib/assistant/__tests__/execution-config.test.ts','src/lib/assistant/__tests__/admin-client.test.ts','src/lib/assistant/__tests__/knowledge-evaluation-batch.test.ts','src/lib/assistant/__tests__/knowledge-batch-execution-adapter.test.ts'];
if(agentUnits)files.push(...['answer-continuity','knowledge-fact-boundaries','synthesis','agent-memory','agent-runtime'].map(name=>'src/lib/assistant/__tests__/'+name+'.test.ts'));
const sources=[...files,'src/lib/assistant/core/conversation.ts','src/lib/assistant/core/operation-receipts.ts',
  'src/lib/assistant/core/evaluation-execution.ts','src/lib/assistant/core/execution-config.ts','src/lib/assistant/infrastructure/job-queue.ts',
  'src/lib/assistant/infrastructure/model-gateway.ts','src/lib/ai/postgres-workflow-chat.ts','src/lib/ai/workflow-text-runtime.ts',
  'src/lib/assistant/knowledge/operations.ts','src/lib/assistant/knowledge/evaluation-batch.ts','src/lib/assistant/knowledge/batch-execution-adapter.ts','src/lib/assistant/knowledge/retrieval.ts'];
sources.push(...['agent/worker.ts','agent/context.ts','agent/synthesis.ts','agent/synthesis-projection.ts','agent/synthesis-attribution.ts','agent/answer-continuity.ts'].map(name=>'src/lib/assistant/'+name));
const manifest=()=>sources.map(file=>({file,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(admin,file))).digest('hex')}));
const start=manifest(),status={started:new Date().toISOString(),mode:transactions?'isolated transactions/processes, mocked provider HTTP':'offline contracts only',files,sourceManifest:start,
  realModels:0,realEmbeddings:0,fixtureWrites:transactions,canonicalLock:transactions};
let child;
try{
  child=spawn(process.execPath,['--import','tsx','--test','--test-reporter=tap','--test-concurrency=1',...files],{cwd:admin,windowsHide:true,
    env:{...process.env,ASSISTANT_EXECUTION_LOCKED:transactions?'1':'0',ASSISTANT_EXECUTION_EVIDENCE:output},stdio:['ignore','pipe','pipe']});
  status.childPid=child.pid;fs.writeFileSync(path.join(output,'status.json'),JSON.stringify(status,null,2));
  child.stdout.on('data',bytes=>fs.appendFileSync(path.join(output,'test.log'),bytes));child.stderr.on('data',bytes=>fs.appendFileSync(path.join(output,'test.log'),bytes));
  status.exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code));});
  if(status.exitCode!==0)process.exitCode=1;
}catch(error){status.error=error.message;process.exitCode=1;}
finally{
  if(child?.exitCode===null)child.kill();
  await release();status.finished=new Date().toISOString();status.lockReleased=true;status.changedDuringRun=JSON.stringify(start)!==JSON.stringify(manifest());
  const log=fs.existsSync(path.join(output,'test.log'))?fs.readFileSync(path.join(output,'test.log'),'utf8'):'';
  status.counts=Object.fromEntries(['tests','pass','fail','skipped','cancelled'].map(key=>[key,Number(log.match(new RegExp('^# '+key+' (\\d+)','m'))?.[1]??0)]));
  if(status.changedDuringRun)process.exitCode=1;
  fs.writeFileSync(path.join(output,'status.json'),JSON.stringify(status,null,2));console.log(JSON.stringify({mode:status.mode,exitCode:status.exitCode,counts:status.counts,lockReleased:status.lockReleased,changedDuringRun:status.changedDuringRun}));
}
