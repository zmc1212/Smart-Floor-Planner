import { spawn } from 'node:child_process';
import { mkdir,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nextEnv from '@next/env';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
process.chdir(root);nextEnv.loadEnvConfig(root);
// Explicit opt-in because this gate makes real text-provider calls with synthetic fixtures.
if(process.env.ASSISTANT_LIVE_TEXT!=='1')throw new Error('Set ASSISTANT_LIVE_TEXT=1 for complete backend acceptance; skipped live tests cannot pass this gate.');
const release = await lockAssistantAcceptance();
try {
const commands=['test:assistant','test:assistant:knowledge','test:assistant:answers','test:assistant:usage','test:assistant:quality'];
const results=[];
for(const command of commands) {
  const started=Date.now();
  // npm's JS entry avoids Windows .cmd spawning and shell interpolation.
  const exitCode=await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[process.env.npm_execpath,'run',command],{cwd:root,stdio:'inherit',env:process.env});
    child.once('error',reject);child.once('exit',code=>resolve(code ?? 1));
  });
  results.push({command,exitCode,durationMs:Date.now()-started});
  if(exitCode!==0)break;
}
const folder=path.resolve(root,'../tmp/xiaok-vector');await mkdir(folder,{recursive:true});
await writeFile(path.join(folder,'phase1c-acceptance.json'),JSON.stringify({schemaVersion:1,createdAt:new Date().toISOString(),
  scope:'isolated synthetic backend; real-enterprise A10 and release approval remain pending',results,passed:results.length===commands.length && results.every(r=>r.exitCode===0)},null,2));
if(results.length!==commands.length || results.some(r=>r.exitCode!==0))process.exitCode=1;
} finally { await release(); }
