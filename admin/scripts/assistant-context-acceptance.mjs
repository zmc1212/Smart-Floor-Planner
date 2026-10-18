import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import nextEnv from '@next/env';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';

const root=path.resolve(import.meta.dirname,'..');process.chdir(root);nextEnv.loadEnvConfig(root,true);
const output=path.resolve('../tmp/xiaok-kb3');fs.mkdirSync(output,{recursive:true});
const mode=['unit','regression','synthesis','repair','version','mini','lint'].find(m=>process.argv.includes('--'+m))||'service';
const db=['service','regression','synthesis','repair','version'].includes(mode);let release=async()=>{};
if(db){const config=JSON.parse(fs.readFileSync('../tmp/xiaok-vector/connection.private.json','utf8').replace(/^\uFEFF/,''));process.env.DATABASE_URL=config.DATABASE_URL;release=await lockAssistantAcceptance();}
try{
 const files={unit:['src/lib/assistant/__tests__/context-selection.test.ts','src/lib/assistant/__tests__/synthesis.test.ts','src/lib/assistant/__tests__/source-file.test.ts'],
  repair:['src/db/__tests__/assistant-synthesis.test.ts'],version:['src/db/__tests__/assistant-knowledge.test.ts'],
  service:['src/db/__tests__/assistant-professional-knowledge.test.ts','src/db/__tests__/assistant-synthesis.test.ts'],
  synthesis:['src/db/__tests__/assistant-materials.test.ts','src/db/__tests__/assistant-agent.test.ts'],
  regression:['src/db/__tests__/assistant-knowledge.test.ts','src/db/__tests__/assistant-answers.test.ts','src/db/__tests__/assistant-source-file.test.ts','src/db/__tests__/assistant-platform-access.test.ts']};
 const args=mode==='lint'?['node_modules/eslint/bin/eslint.js','.']:mode==='mini'?['--test',...fs.readdirSync('../miniprogram/test').filter(f=>f.startsWith('assistant-')&&f.endsWith('.test.js')).map(f=>'../miniprogram/test/'+f)]:
  ['--import','tsx','--test','--test-reporter=tap','--test-concurrency=1','--test-timeout=180000',...(mode==='repair'?['--test-name-pattern=KB3 citation repair']:mode==='version'?['--test-name-pattern=audience, effective time']:[]),...files[mode]];
 const file=path.join(output,mode+'.log');fs.writeFileSync(file,'');let log='';
 const child=spawn(process.execPath,args,{cwd:root,env:process.env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 const write=c=>{log+=c;fs.appendFileSync(file,c);};child.stdout.on('data',write);child.stderr.on('data',write);
 const exitCode=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>resolve(code??1));});
 fs.writeFileSync(path.join(output,mode+'-status.json'),JSON.stringify({exitCode,finished:new Date().toISOString(),model:db?'deterministic injected model; real isolated database and embedding':'not a real-model evaluation'}));
 console.log(log.split('\n').filter(s=>/^(# (tests|pass|fail|skip)|not ok|  error:|  message:)/.test(s)).slice(-60).join('\n')||`${mode}: exit ${exitCode}`);process.exitCode=exitCode;
}finally{await release();}
