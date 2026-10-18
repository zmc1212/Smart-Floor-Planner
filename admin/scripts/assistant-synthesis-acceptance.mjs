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
  const output = path.resolve(root, '../tmp/xiaok-synthesis'); fs.mkdirSync(output, { recursive: true });
  const regression = process.argv.includes('--regression');
  const resolution = process.argv.includes('--resolution-regression');
  const agent = process.argv.includes('--agent-regression');
  const pattern = process.env.XIAOK_SYNTHESIS_TEST_PATTERN;
  const files = resolution ? ['src/db/__tests__/construction-resolution.test.ts'] : agent ? ['src/db/__tests__/assistant-agent.test.ts'] : regression ? ['src/db/__tests__/assistant-agent.test.ts','src/db/__tests__/assistant-materials.test.ts','src/db/__tests__/assistant-need-issues.test.ts',
    'src/db/__tests__/construction-resolution.test.ts','src/db/__tests__/construction-plans.test.ts','src/db/__tests__/construction-materials.test.ts','src/db/__tests__/construction-chat-queries.test.ts']
    : ['src/lib/assistant/__tests__/synthesis.test.ts','src/db/__tests__/assistant-synthesis.test.ts'];
  const child = spawn(process.execPath, ['--import','tsx','--test','--test-reporter=tap','--test-concurrency=1','--test-timeout=180000',...(pattern ? ['--test-name-pattern',pattern] : []),...files],
    { cwd: root, env: process.env, windowsHide: true, stdio: ['ignore','pipe','pipe'] });
  const name = resolution ? 'resolution-regression' : agent ? 'agent-regression' : regression ? 'regression' : pattern ? 'service-filtered' : 'service';
  const logfile = path.join(output, name + '.log'); fs.writeFileSync(logfile, ''); let log = '';
  const write = c => { log += c; fs.appendFileSync(logfile, c); };
  child.stdout.on('data', write); child.stderr.on('data', write);
  process.exitCode = await new Promise((resolve,reject) => { child.once('error',reject); child.once('exit',code => resolve(code ?? 1)); });
  fs.writeFileSync(path.join(output,name+'-status.json'),JSON.stringify({ exitCode:process.exitCode, finished:new Date().toISOString(), model:'injected deterministic provider; real isolated database and retrieval' }));
  console.log(log.split('\n').filter(s => /^(# (tests|pass|fail|skip)|not ok|ok \d|  error:|  message:)/.test(s)).join('\n'));
} finally { await release(); }
