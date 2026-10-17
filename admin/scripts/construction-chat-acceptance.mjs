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
  const output = path.resolve(root, '../tmp/xiaok-followup-batch'); fs.mkdirSync(output, { recursive: true });
  const logPath = path.join(output, 'shared-chat.log'); fs.writeFileSync(logPath, '');
  const child = spawn(process.execPath, ['--import','tsx','--test','--test-concurrency=1','src/db/__tests__/construction-chat-queries.test.ts'],
    { cwd: root, env: process.env, windowsHide: true, stdio: ['ignore','pipe','pipe'] });
  let log = ''; const collect = c => { log += c; fs.appendFileSync(logPath, c); }; child.stdout.on('data', collect); child.stderr.on('data', collect);
  process.exitCode = await new Promise((resolve,reject) => { child.once('error',reject); child.once('exit',code => resolve(code ?? 1)); });
  fs.writeFileSync(path.join(output, 'shared-chat-status.json'), JSON.stringify({ exitCode: process.exitCode, logPath, finished: new Date().toISOString() }));
  console.log(log.split('\n').filter((s,i,a) => /✔|✖|tests |pass |fail |skip|error:|actual:|expected:|Error:/.test(s) || /error:|actual:|expected:/.test(a[i-1] || '')).slice(-65).join('\n'));
} finally { await release(); }
