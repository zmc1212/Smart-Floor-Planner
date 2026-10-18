import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import nextEnv from '@next/env';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';

const root = path.resolve(import.meta.dirname, '..'); process.chdir(root); nextEnv.loadEnvConfig(root, true);
const config = JSON.parse(fs.readFileSync('../tmp/xiaok-vector/connection.private.json', 'utf8').replace(/^\uFEFF/, ''));
process.env.DATABASE_URL = config.DATABASE_URL;
const release = await lockAssistantAcceptance();
try {
  const output = path.resolve(root, '../tmp/xiaok-p5'); fs.mkdirSync(output, { recursive: true });
  const agentRegression = process.argv.includes('--agent-regression');
  const args = ['--import','tsx','--test','--test-concurrency=1',...(agentRegression
    ? ['src/db/__tests__/assistant-materials.test.ts','src/db/__tests__/assistant-need-issues.test.ts','src/db/__tests__/assistant-agent.test.ts']
    : ['src/db/__tests__/construction-plans.test.ts'])];
  if (process.argv.includes('--regression')) args.push('src/db/__tests__/construction-materials.test.ts','src/db/__tests__/construction-chat-queries.test.ts','src/db/__tests__/assistant-need-issues.test.ts');
  const child = spawn(process.execPath, args, { cwd: root, env: process.env, windowsHide: true, stdio: ['ignore','pipe','pipe'] });
  const name = agentRegression ? 'plans-agent-regression' : process.argv.includes('--regression') ? 'plans-regression' : 'plans-service';
  let log = ''; child.stdout.on('data', c => { log += c; }); child.stderr.on('data', c => { log += c; });
  process.exitCode = await new Promise((resolve,reject) => { child.once('error',reject); child.once('exit',code => resolve(code ?? 1)); });
  fs.writeFileSync(path.join(output,name+'.log'),log);
  fs.writeFileSync(path.join(output,name+'-status.json'),JSON.stringify({exitCode:process.exitCode,finished:new Date().toISOString()}));
  console.log(log.split('\n').filter((s,i,a) => /✔|✖|tests |pass |fail |skip|error:|actual:|expected:|Error:/.test(s) || /error:|actual:|expected:/.test(a[i-1] || '')).slice(-55).join('\n'));
} finally { await release(); }
