import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import nextEnv from '@next/env';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';
const root = path.resolve(import.meta.dirname, '..'); process.chdir(root); nextEnv.loadEnvConfig(root, true);
const config = JSON.parse(fs.readFileSync('../tmp/xiaok-vector/connection.private.json', 'utf8').replace(/^\uFEFF/, ''));
const url = new URL(config.DATABASE_URL);
if (!['localhost','127.0.0.1'].includes(url.hostname) || url.port !== '55432' || url.pathname !== '/xiaok_embedding_eval') throw Error('Isolated database required');
process.env.DATABASE_URL = config.DATABASE_URL;
const name = process.argv[2]; if (!/^d3-copy-service-[a-z0-9-]+$/.test(name || '')) throw Error('Unique output name required');
const output = path.resolve(root, '../tmp', name); fs.mkdirSync(output); // Never overwrite original results.
const files = ['src/lib/portfolio', 'src/components/portfolio', 'src/lib/assistant/core', 'src/db', 'src/app/api/portfolio', 'src/app/api/internal/assistant/jobs/run', 'drizzle/0097_portfolio_copy_tasks.sql', 'scripts/portfolio-copy-acceptance.mjs', '.env.local', '.env.development'];
if (process.env.PORTFOLIO_COPY_TRACE_DIR) for (let index=1;index<=4;index++) files.push(path.join(process.env.PORTFOLIO_COPY_TRACE_DIR,`wire-${index}.json`));
function binding() { const entries = []; const walk = file => { if (!fs.existsSync(file)) return; if (fs.statSync(file).isDirectory()) for (const child of fs.readdirSync(file)) walk(path.join(file, child)); else entries.push([file,crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]); }; files.forEach(walk); entries.push(['isolated-config',crypto.createHash('sha256').update(fs.readFileSync('../tmp/xiaok-vector/connection.private.json')).digest('hex')]); return entries.sort(([a],[b]) => a.localeCompare(b)); }
const report = { before: binding(), after: null, exitCode: null, drift: [], modelCalls: 0, target: 'loopback:55432/xiaok_embedding_eval' }; let release;
try {
  release = await lockAssistantAcceptance(process.env.DATABASE_URL, { waitForLock: process.argv.includes('--wait-for-lock') });
  report.before = binding();
  const replayOnly = process.argv[3] === '--replay-only';
  if (replayOnly && !process.env.PORTFOLIO_COPY_TRACE_DIR) throw Error('Saved trace inputs required');
  const extra = process.env.PORTFOLIO_COPY_TRACE_DIR ? ['src/db/__tests__/portfolio-copy-replay.test.ts'] : [];
  const child = spawn(process.execPath, ['--import','tsx','--test','--test-concurrency=1','src/lib/portfolio/__tests__/copy-contract.test.ts',...(replayOnly?[]:['src/db/__tests__/portfolio-copy.test.ts']),...extra], { cwd: root, env: process.env, stdio: ['ignore','pipe','pipe'], windowsHide: true });
  let log = ''; child.stdout.on('data', chunk => { log += chunk; }); child.stderr.on('data', chunk => { log += chunk; });
  report.exitCode = await new Promise((resolve,reject) => { child.once('error',reject);child.once('exit',code => resolve(code ?? 1)); }); fs.writeFileSync(path.join(output,'test.log'),log);
  console.log(log.split('\n').filter((line,i,lines) => /✔|✖|tests |pass |fail |error:|actual:|expected:|cause:|Error:/.test(line) || /error:|actual:|expected:/.test(lines[i-1] || '')).slice(-65).join('\n'));
} catch (e) { report.error = e.message; report.exitCode = 1; console.log('acceptance error: ' + e.message); }
finally { report.after = binding(); report.drift = report.before.filter(([file,hash]) => report.after.find(([next]) => next === file)?.[1] !== hash); fs.writeFileSync(path.join(output,'evidence.json'),JSON.stringify(report,null,2)); await release?.(); process.exitCode = report.exitCode || report.drift.length ? 1 : 0; console.log(JSON.stringify({ output,exitCode:report.exitCode,drift:report.drift,modelCalls:0 })); }
