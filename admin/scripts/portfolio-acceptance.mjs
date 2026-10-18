import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import nextEnv from '@next/env';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';
const root = path.resolve(import.meta.dirname, '..'); process.chdir(root); nextEnv.loadEnvConfig(root, true);
const config = JSON.parse(fs.readFileSync('../tmp/xiaok-vector/connection.private.json', 'utf8').replace(/^\uFEFF/, ''));
const url = new URL(config.DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.port !== '55432' || url.pathname !== '/xiaok_embedding_eval') throw Error('Isolated evaluation database required');
process.env.DATABASE_URL = config.DATABASE_URL;
const release = await lockAssistantAcceptance();
try {
  const child = spawn(process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=1', 'src/lib/portfolio/__tests__/contracts.test.ts', 'src/lib/map-services/__tests__/tianditu.test.ts', 'src/db/__tests__/map-services.test.ts', 'src/db/__tests__/portfolio.test.ts', 'src/db/__tests__/tenant-enterprise-reset.test.ts'], { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let log = ''; child.stdout.on('data', data => { log += data; }); child.stderr.on('data', data => { log += data; });
  process.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', c => resolve(c ?? 1)); });
  const target = path.resolve(root, '../tmp/xiaok-vector/portfolio-acceptance.log'); fs.writeFileSync(target, log);
  console.log(log.split('\n').filter((line, i, lines) => /✔|✖|tests |pass |fail |error:|actual:|expected:|cause:|Error:/.test(line) || /error:|actual:|expected:/.test(lines[i - 1] || '')).slice(-60).join('\n'));
} finally { await release(); }
