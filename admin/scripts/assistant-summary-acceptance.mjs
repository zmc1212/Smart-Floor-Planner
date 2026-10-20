import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import nextEnv from '@next/env';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';

const root=path.resolve(import.meta.dirname,'..');process.chdir(root);nextEnv.loadEnvConfig(root,true);
const unit=process.argv.includes('--unit'),regression=process.argv.includes('--regression'),mode=unit?'unit':regression?'regression':'service',output=path.resolve(process.argv.includes('--directed')?'../tmp/xiaok-history-directed':'../tmp/xiaok-summary-v69');
const files=unit?['src/lib/assistant/__tests__/history-summary.test.ts','src/lib/assistant/__tests__/context-budget.test.ts','src/lib/assistant/__tests__/agent-runtime.test.ts']
  :regression?['src/db/__tests__/assistant-agent.test.ts']:['src/db/__tests__/assistant-history.test.ts'];
if(!unit)process.env.DATABASE_URL=JSON.parse(fs.readFileSync('../tmp/xiaok-vector/connection.private.json','utf8').replace(/^\uFEFF/,'')).DATABASE_URL;
const release=unit?async()=>{}:await lockAssistantAcceptance(undefined,{waitForLock:process.argv.includes('--wait-for-lock')});
fs.mkdirSync(output,{recursive:true});
try{
  const runId=randomUUID();process.env.ASSISTANT_TEST_RUN_ID=runId;
  const watched=['context','context-budget','history','summary','worker','media-context','synthesis','synthesis-sources','runtime','model-policy','citation-catalog','memory','memory-sources','memory-store'].map(f=>'src/lib/assistant/agent/'+f+'.ts');
  const hashes=()=>[...watched,...files].map(file=>({file,sha256:createHash('sha256').update(fs.readFileSync(file)).digest('hex')}));
  const sources=hashes();
  fs.writeFileSync(path.join(output,mode+'-start.json'),JSON.stringify({runId,prefix:regression?null:'synthetic-history-'+runId,pid:process.pid,started:new Date().toISOString(),sources},null,2));
  const logFile=path.join(output,mode+'.log');fs.writeFileSync(logFile,'');
  const child=spawn(process.execPath,['--import','tsx','--test','--test-concurrency=1',...(process.argv.includes('--catalog-only')?['--test-name-pattern=directed summary']:process.argv.includes('--directed-only')?['--test-name-pattern=current-question digest|directed summary|directed digest|directed recall|directed current-need']:[]),...files],{cwd:root,env:process.env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let log='';const collect=b=>{log+=b;fs.appendFileSync(logFile,b);};child.stdout.on('data',collect);child.stderr.on('data',collect);
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
  console.log(log.split('\n').filter(l=>/^(# (tests|pass|fail|skipped)|[✔✖ℹ]|not ok)|error:|Error:/.test(l)).join('\n'));
  const status={code,mode,files,sources,changedDuringRun:hashes().filter((s,i)=>s.sha256!==sources[i].sha256).map(s=>s.file),finished:new Date().toISOString(),counts:Object.fromEntries([...log.matchAll(/^[#ℹ] (tests|pass|fail|skipped) (\d+)/gm)].map(m=>[m[1],Number(m[2])]))};
  fs.writeFileSync(path.join(output,mode+'-status.json'),JSON.stringify(status,null,2));console.log(JSON.stringify(status));
  process.exitCode=code||!status.counts.tests||status.changedDuringRun.length?1:0;
}finally{await release();}
