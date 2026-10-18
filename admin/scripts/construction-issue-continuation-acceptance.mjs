import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import nextEnv from '@next/env';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';

const root = path.resolve(import.meta.dirname, '..'); process.chdir(root); nextEnv.loadEnvConfig(root, true);
process.env.DATABASE_URL = JSON.parse(fs.readFileSync('../tmp/xiaok-vector/connection.private.json', 'utf8').replace(/^\uFEFF/, '')).DATABASE_URL;
const release = await lockAssistantAcceptance(), output = path.resolve('../tmp/xiaok-issue-continuation');
fs.mkdirSync(output, { recursive: true });
try {
  const mode = process.argv.includes('--regression') ? 'regression' : process.argv.includes('--materials-regression') ? 'materials-regression' : process.argv.includes('--mini') ? 'mini' : 'service';
  const files = mode === 'service' ? ['src/db/__tests__/construction-issue-continuation.test.ts']
    : mode === 'materials-regression' ? ['src/db/__tests__/construction-materials.test.ts']
    : mode === 'regression' ? ['src/db/__tests__/construction-materials.test.ts','src/db/__tests__/construction-resolution.test.ts',
      'src/db/__tests__/construction-plans.test.ts','src/db/__tests__/assistant-synthesis.test.ts','src/db/__tests__/assistant-materials.test.ts','src/db/__tests__/assistant-need-issues.test.ts']
    : fs.readdirSync('../miniprogram/test').filter(f => /^(assistant-|construction-(site-chat|materials|plans|resolution|chat))/.test(f) && f.endsWith('.test.js')).map(f => '../miniprogram/test/' + f);
  const child = spawn(process.execPath, [...(mode === 'mini' ? [] : ['--import','tsx']), '--test','--test-reporter=tap','--test-concurrency=1',...files],
    { cwd: root, env: process.env, windowsHide: true, stdio: ['ignore','pipe','pipe'] });
  let log = ''; const collect = c => { log += c; fs.appendFileSync(path.join(output, mode + '.log'), c); };
  fs.writeFileSync(path.join(output, mode + '.log'), ''); child.stdout.on('data', collect); child.stderr.on('data', collect);
  process.exitCode = await new Promise((resolve,reject) => { child.once('error',reject); child.once('exit',code => resolve(code ?? 1)); });
  const summary = { exitCode: process.exitCode, mode, files, finished: new Date().toISOString(),
    counts: Object.fromEntries([...log.matchAll(/^# (tests|pass|fail|skipped) (\d+)/gm)].map(m => [m[1], Number(m[2])])) };
  fs.writeFileSync(path.join(output, mode + '-status.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary)); console.log(log.split('\n').filter(l => /not ok|error:|actual:|expected:|Error:/.test(l)).join('\n'));
} finally { await release(); }
