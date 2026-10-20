import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import nextEnv from '@next/env';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';
const root=path.resolve(import.meta.dirname,'..');process.chdir(root);nextEnv.loadEnvConfig(root,true);
const timeFormats=process.argv.includes('--time-formats'),dateFormats=process.argv.includes('--date-formats'),numberFormats=process.argv.includes('--number-formats'),spreadsheet=process.argv.includes('--xlsx')||numberFormats||dateFormats||timeFormats,projection=process.argv.includes('--projection');
const evidence=process.argv.find(a=>a.startsWith('--evidence='))?.slice('--evidence='.length);
if(evidence&&!/^xiaok-[a-z0-9-]{1,80}$/.test(evidence))throw Error('Invalid XiaoK evidence directory name');
const output=path.resolve('../tmp',evidence||(timeFormats?'xiaok-kb2-time-formats':dateFormats?'xiaok-kb2-date-formats':numberFormats?'xiaok-kb2-number-formats':spreadsheet?'xiaok-kb2-xlsx':'xiaok-kb2'));fs.mkdirSync(output,{recursive:true});
const mode=process.argv.includes('--types')?'types':process.argv.includes('--lint')?'lint':process.argv.includes('--unit')?'unit':process.argv.includes('--regression')?'regression':process.argv.includes('--synthesis')?'synthesis':process.argv.includes('--mini')?'mini':'service';
const logMode=mode==='synthesis'&&projection?'projection-selection':mode;
const db=['service','regression','synthesis'].includes(mode);
let release=async()=>{};
if(db){const config=JSON.parse(fs.readFileSync('../tmp/xiaok-vector/connection.private.json','utf8').replace(/^\uFEFF/,''));process.env.DATABASE_URL=config.DATABASE_URL;release=await lockAssistantAcceptance(process.env.DATABASE_URL,{waitForLock:process.argv.includes('--wait-for-lock')});}
try{
 const files=mode==='synthesis'?(projection?['src/db/__tests__/assistant-synthesis.test.ts']:['src/lib/assistant/__tests__/synthesis.test.ts','src/db/__tests__/assistant-synthesis.test.ts']):mode==='regression'?['src/db/__tests__/assistant-knowledge.test.ts','src/db/__tests__/assistant-answers.test.ts','src/db/__tests__/assistant-professional-knowledge.test.ts','src/db/__tests__/assistant-platform-access.test.ts']:
  mode==='unit'?['src/lib/assistant/__tests__/source-file.test.ts','src/lib/assistant/__tests__/spreadsheet-source.test.ts',...(projection?['src/lib/assistant/__tests__/synthesis.test.ts','src/lib/assistant/__tests__/context-budget.test.ts','src/lib/assistant/__tests__/model-policy.test.ts','src/lib/assistant/__tests__/synthesis-source-selection.test.ts','src/lib/assistant/__tests__/citation-catalog.test.ts']:[])]:
   spreadsheet?['src/db/__tests__/assistant-source-file.test.ts','src/db/__tests__/assistant-spreadsheet-source.test.ts']:['src/db/__tests__/assistant-source-file.test.ts'];
 const miniFiles=fs.readdirSync('../miniprogram/test').filter(f=>f.startsWith('assistant-')&&f.endsWith('.test.js')).map(f=>'../miniprogram/test/'+f);
 const watched=[...fs.readdirSync('src/lib/assistant/agent').filter(f=>f.endsWith('.ts')).map(f=>'src/lib/assistant/agent/'+f),
  ...new Set(mode==='mini'?miniFiles:files),'scripts/assistant-source-file-acceptance.mjs'].sort();
 const hashes=()=>Object.fromEntries(watched.map(file=>[file,createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
 const sources=hashes(),started=new Date().toISOString();
 fs.writeFileSync(path.join(output,logMode+'-start.json'),JSON.stringify({started,mode,sources},null,2));
 const args=mode==='types'?['node_modules/typescript/bin/tsc','--noEmit','--pretty','false']:mode==='lint'?['node_modules/eslint/bin/eslint.js','.']:mode==='mini'?['--test',...miniFiles]:
  ['--import','tsx','--test','--test-reporter=tap','--test-concurrency=1','--test-timeout=180000',...(mode==='synthesis'&&projection?['--test-name-pattern=KB3 (projected legacy selection|legacy full-source citation selection|catalog citation first draft)']:[]),...files];
 const file=path.join(output,logMode+'.log');fs.writeFileSync(file,'');let log='';
 const child=spawn(process.execPath,args,{cwd:root,env:process.env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 const write=c=>{log+=c;fs.appendFileSync(file,c);};child.stdout.on('data',write);child.stderr.on('data',write);
 const exitCode=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>resolve(code??1));});
 const sourcesAfter=hashes(),changedDuringRun=watched.filter(file=>sources[file]!==sourcesAfter[file]);
 const acceptedExitCode=exitCode||Number(changedDuringRun.length>0);
 fs.writeFileSync(path.join(output,logMode+'-status.json'),JSON.stringify({exitCode:acceptedExitCode,testExitCode:exitCode,started,finished:new Date().toISOString(),sources,sourcesAfter,changedDuringRun,
  model:db?'deterministic injected model; real isolated database and embedding':'not a real-model evaluation'}));
 console.log(log.split('\n').filter(s=>/^(# (tests|pass|fail|skip)|not ok|ok \d|  error:|  message:)|source-file|file-service|assistant-file|knowledge-editor/.test(s)).slice(-80).join('\n')||`${logMode}: exit ${acceptedExitCode}`);
 if(changedDuringRun.length)console.error('Acceptance invalidated by source drift: '+changedDuringRun.join(', '));process.exitCode=acceptedExitCode;
}finally{await release();}
