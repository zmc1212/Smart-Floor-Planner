import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import nextEnv from '@next/env';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';

const root = path.resolve(import.meta.dirname, '..'); process.chdir(root); nextEnv.loadEnvConfig(root, true);
const config = JSON.parse(fs.readFileSync('../tmp/xiaok-vector/connection.private.json', 'utf8').replace(/^\uFEFF/, ''));
const url = new URL(config.DATABASE_URL);
if (!['localhost','127.0.0.1'].includes(url.hostname) || url.port !== '55432' || url.pathname !== '/xiaok_embedding_eval') throw Error('Isolated evaluation database required');
if (process.env.CONSTRUCTION_LIVE_MODEL === '1') process.env.CONSTRUCTION_PRIMARY_DATABASE_URL = process.env.DATABASE_URL;
process.env.DATABASE_URL = config.DATABASE_URL;
const release = await lockAssistantAcceptance();
try {
  const tests = process.argv.includes('--site-regression') ? ['src/db/__tests__/assistant-requirements.test.ts','src/db/__tests__/assistant.test.ts','src/db/__tests__/construction-site-chat.test.ts'] : process.argv.includes('--site-only') ? ['src/db/__tests__/construction-site-chat.test.ts'] : process.argv.includes('--entry-only') ? ['src/lib/construction/__tests__/lead-entry.test.ts', 'src/db/__tests__/construction-project-entry.test.ts'] : process.argv.includes('--staff-only') ? ['src/db/__tests__/construction-staff.test.ts'] : process.argv.includes('--followups-only')
    ? ['src/lib/construction/__tests__/contracts.test.ts', 'src/db/__tests__/construction-followups.test.ts']
    : ['src/lib/construction/__tests__/contracts.test.ts', 'src/lib/construction/__tests__/lead-entry.test.ts', 'src/db/__tests__/construction.test.ts', 'src/db/__tests__/construction-staff.test.ts', 'src/db/__tests__/construction-project-entry.test.ts', 'src/db/__tests__/construction-followups.test.ts', 'src/db/__tests__/construction-site-chat.test.ts', 'src/db/__tests__/tenant-enterprise-reset.test.ts'];
  const selectedTests = process.argv.includes('--public-only') ? ['src/db/__tests__/construction-public-sites.test.ts'] : ['src/lib/construction/__tests__/route-access.test.ts', ...tests, ...(process.argv.length === 2 ? ['src/db/__tests__/construction-public-sites.test.ts'] : [])];
  const child = spawn(process.execPath, ['--import','tsx','--test','--test-concurrency=1', ...selectedTests], { cwd: root, env: process.env, stdio: ['ignore','pipe','pipe'], windowsHide: true });
  let log = ''; child.stdout.on('data', c => { log += c; }); child.stderr.on('data', c => { log += c; });
  process.exitCode = await new Promise((resolve,reject) => { child.once('error',reject); child.once('exit', c => resolve(c ?? 1)); });
  const logName = process.argv.includes('--site-only') ? 'construction-site-chat.log' : process.argv.includes('--site-regression') ? 'construction-site-regression.log' : process.argv.includes('--entry-only') ? 'construction-project-entry.log' : 'construction-acceptance.log';
  fs.writeFileSync(path.resolve(root, '../tmp/xiaok-vector/' + (process.argv.includes('--public-only') ? 'construction-public-sites.log' : logName)), log);
  console.log(log.split('\n').filter((s,i,a) => /✔|✖|tests |pass |fail |error:|actual:|expected:|cause:|Error:/.test(s) || /error:|actual:|expected:/.test(a[i-1] || '')).slice(-70).join('\n'));
} finally { await release(); }
