import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import nextEnv from '@next/env';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';

const root = path.resolve(import.meta.dirname, '..'); process.chdir(root); nextEnv.loadEnvConfig(root, true);
const unit = process.argv.includes('--unit'), output = path.resolve('../tmp/xiaok-history-v68');
const image=process.argv.includes('--image'),mode=unit?'unit':image?'image':process.argv.includes('--regression')?'regression':'service';
const files = unit ? ['src/lib/assistant/__tests__/context-budget.test.ts','src/lib/assistant/__tests__/agent-runtime.test.ts']
  : process.argv.includes('--regression')||image ? ['src/db/__tests__/assistant-agent.test.ts'] : ['src/db/__tests__/assistant-history.test.ts'];
if (!unit) process.env.DATABASE_URL = JSON.parse(fs.readFileSync('../tmp/xiaok-vector/connection.private.json', 'utf8').replace(/^\uFEFF/, '')).DATABASE_URL;
const release = unit ? async () => {} : await lockAssistantAcceptance(undefined, { waitForLock: true });
fs.mkdirSync(output, { recursive: true });
try {
  const logFile = path.join(output, mode+'.log'); fs.writeFileSync(logFile, '');
  const child = spawn(process.execPath, ['--import','tsx','--test','--test-concurrency=1',...(image?['--test-name-pattern=first image schedules']:[]), ...files], { cwd: root, env: process.env, windowsHide: true, stdio: ['ignore','pipe','pipe'] });
  let log = ''; const collect = b => { log += b; fs.appendFileSync(logFile,b); }; child.stdout.on('data', collect); child.stderr.on('data', collect);
  const code = await new Promise((resolve,reject) => { child.once('error',reject); child.once('exit',resolve); });
  fs.writeFileSync(logFile, log);
  console.log(log.split('\n').filter(l => /^(# (tests|pass|fail|skipped)|[✔✖ℹ]|not ok)|error:|Error:|Configured request|messageBytes|toolBytes/.test(l)).join('\n'));
  process.exitCode = code ?? 1;
  const result={code,mode,files,output,finished:new Date().toISOString(),counts:Object.fromEntries([...log.matchAll(/^[#ℹ] (tests|pass|fail|skipped) (\d+)/gm)].map(m=>[m[1],Number(m[2])]))};
  fs.writeFileSync(path.join(output,mode+'-status.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
} finally { await release(); }
