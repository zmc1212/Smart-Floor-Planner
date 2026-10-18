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
  const output = path.resolve(root, '../tmp/xiaok-p5-resolution'); fs.mkdirSync(output, { recursive: true });
  const files = process.argv.includes('--agent-regression')
    ? ['src/db/__tests__/assistant-materials.test.ts','src/db/__tests__/assistant-need-issues.test.ts','src/db/__tests__/assistant-agent.test.ts']
    : ['src/db/__tests__/construction-resolution.test.ts'];
  if (process.argv.includes('--regression')) files.push('src/db/__tests__/construction-plans.test.ts','src/db/__tests__/construction-materials.test.ts','src/db/__tests__/construction-chat-queries.test.ts');
  const recovery = process.argv.includes('--recovery'), revocation = process.argv.includes('--revocation'), provenance = process.argv.includes('--provenance');
  const child = spawn(process.execPath, ['--import','tsx','--test','--test-reporter=tap','--test-concurrency=1','--test-timeout=180000',
    ...(recovery ? ['--test-name-pattern=lost response reuses original key|changed source can be re-reviewed'] : revocation ? ['--test-name-pattern=actual reviewer and manager downgrades'] : provenance ? ['--test-name-pattern=actual query_followups checkpoints'] : []),...files], { cwd: root, env: process.env, windowsHide: true, stdio: ['ignore','pipe','pipe'] });
  let log = ''; const write = c => { log += c; fs.writeFileSync(path.join(output, 'running.log'), log); };
  child.stdout.on('data', write); child.stderr.on('data', write);
  process.exitCode = await new Promise((resolve,reject) => { child.once('error',reject); child.once('exit',code => resolve(code ?? 1)); });
  const name = recovery ? 'recovery' : revocation ? 'revocation' : provenance ? 'provenance' : process.argv.includes('--agent-regression') ? 'agent-regression' : process.argv.includes('--regression') ? 'service-regression' : 'service';
  fs.writeFileSync(path.join(output,name+'.log'),log);
  fs.writeFileSync(path.join(output,name+'-status.json'),JSON.stringify({exitCode:process.exitCode,finished:new Date().toISOString()}));
  console.log(log.split('\n').filter((s,i,a) => /✔|✖|tests |pass |fail |skip|error:|actual:|expected:|Error:/.test(s) || /error:|actual:|expected:/.test(a[i-1] || '')).slice(-65).join('\n'));
} finally { await release(); }
