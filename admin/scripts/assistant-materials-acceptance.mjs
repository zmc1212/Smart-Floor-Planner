import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import nextEnv from '@next/env';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';

const root = path.resolve(import.meta.dirname, '..');
process.chdir(root); nextEnv.loadEnvConfig(root, true);
const config = JSON.parse(fs.readFileSync('../tmp/xiaok-vector/connection.private.json', 'utf8').replace(/^\uFEFF/, ''));
const url = new URL(config.DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.port !== '55432' || url.pathname !== '/xiaok_embedding_eval') throw Error('Isolated evaluation database required');
if (process.env.XIAOK_MATERIALS_LIVE === '1') process.env.XIAOK_MATERIALS_PRIMARY_DATABASE_URL = process.env.DATABASE_URL;
process.env.DATABASE_URL = config.DATABASE_URL;
const release = await lockAssistantAcceptance();
try {
  const out = path.resolve(root, '../tmp/xiaok-vector/materials-followups-batch'); fs.mkdirSync(out, { recursive: true });
  const logPath = path.join(out, process.env.XIAOK_MATERIALS_LIVE === '1' ? 'materials-live.log' : 'materials-isolated.log');
  fs.writeFileSync(logPath, '');
  const child = spawn(process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=1',
    'src/db/__tests__/assistant-materials.test.ts'], { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let log = ''; const collect = c => { log += c; fs.appendFileSync(logPath, c); };
  child.stdout.on('data', collect); child.stderr.on('data', collect);
  process.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', c => resolve(c ?? 1)); });
  console.log(log.split('\n').filter((s, i, a) => /✔|✖|tests |pass |fail |skip|error:|actual:|expected:|cause:|Error:/.test(s) || /error:|actual:|expected:/.test(a[i - 1] || '')).slice(-65).join('\n'));
} finally { await release(); }
