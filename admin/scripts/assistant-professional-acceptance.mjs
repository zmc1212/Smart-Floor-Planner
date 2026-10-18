import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import nextEnv from '@next/env';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';
const root=path.resolve(import.meta.dirname,'..');process.chdir(root);nextEnv.loadEnvConfig(root,true);
const config=JSON.parse(fs.readFileSync('../tmp/xiaok-vector/connection.private.json','utf8').replace(/^\uFEFF/,''));process.env.DATABASE_URL=config.DATABASE_URL;
const release=await lockAssistantAcceptance();
try {
  const output=path.resolve('../tmp/xiaok-kb1');fs.mkdirSync(output,{recursive:true});
  const regression=process.argv.includes('--regression'),synthesis=process.argv.includes('--synthesis-regression'),unit=process.argv.includes('--unit'),name=regression?'knowledge-regression':synthesis?'synthesis-regression':unit?'unit':'service';
  const files=synthesis?['src/lib/assistant/__tests__/synthesis.test.ts','src/db/__tests__/assistant-synthesis.test.ts']:regression?['src/db/__tests__/assistant-knowledge.test.ts','src/db/__tests__/assistant-answers.test.ts','src/db/__tests__/assistant-platform-access.test.ts']:
    unit?['src/lib/assistant/__tests__/professional-knowledge.test.ts','src/lib/assistant/__tests__/synthesis.test.ts','src/lib/assistant/__tests__/chinese-query.test.ts']:
      ['src/lib/assistant/__tests__/professional-knowledge.test.ts','src/db/__tests__/assistant-professional-knowledge.test.ts'];
  const child=spawn(process.execPath,['--import','tsx','--test','--test-reporter=tap','--test-concurrency=1','--test-timeout=180000',...files],{cwd:root,env:process.env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let log='';const filename=path.join(output,name+'.log');fs.writeFileSync(filename,'');const write=c=>{log+=c;fs.appendFileSync(filename,c);};child.stdout.on('data',write);child.stderr.on('data',write);
  process.exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code??1));});
  fs.writeFileSync(path.join(output,name+'-status.json'),JSON.stringify({exitCode:process.exitCode,finished:new Date().toISOString(),model:'deterministic injected model; real isolated database; real embedding except explicitly injected service-unit index fixtures'}));
  console.log(log.split('\n').filter(s=>/^(# (tests|pass|fail|skip)|not ok|ok \d|  error:|  message:)/.test(s)).join('\n'));
}finally{await release();}
