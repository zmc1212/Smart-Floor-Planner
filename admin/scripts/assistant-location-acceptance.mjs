import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import nextEnv from '@next/env';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';

const admin = path.resolve(import.meta.dirname, '..'), root = path.dirname(admin);
process.chdir(admin); nextEnv.loadEnvConfig(admin, true);
process.env.DATABASE_URL = JSON.parse(fs.readFileSync(path.join(root, 'tmp/xiaok-vector/connection.private.json'), 'utf8').replace(/^\uFEFF/, '')).DATABASE_URL;
const name = process.argv[2]; if (!/^location-[a-z0-9-]+$/.test(name || '')) throw Error('Unique output name required');
const output = path.join(root, 'tmp', name); fs.mkdirSync(output);
const tests = process.argv.includes('--location-only') ? ['src/db/__tests__/assistant-location.test.ts']
  : ['src/db/__tests__/portfolio.test.ts', 'src/db/__tests__/construction-public-sites.test.ts'];
const scopes = process.argv.includes('--location-only') ? [
  'admin/src/lib/assistant/location', 'admin/src/lib/assistant/contracts.ts', 'admin/src/lib/assistant/core', 'admin/src/lib/assistant/requirements',
  'admin/src/lib/assistant/agent/memory.ts', 'admin/src/lib/assistant/agent/config.ts', 'admin/src/lib/assistant/application/auth.ts',
  'admin/src/lib/portfolio/regions.ts', 'admin/src/lib/map-services', 'admin/src/lib/postgresql.ts', 'admin/src/db',
  'admin/scripts/assistant-location-acceptance.mjs', 'admin/scripts/assistant-acceptance-safety.mjs', 'admin/.env.local', 'admin/.env.development',
  'admin/package-lock.json', 'tmp/xiaok-vector/connection.private.json', ...tests.map(file => 'admin/' + file),
] : ['admin/src/lib/assistant', 'admin/src/lib/portfolio', 'admin/src/lib/construction', 'admin/src/lib/map-services',
  'admin/src/db', 'admin/src/lib/postgresql.ts', 'admin/src/lib/platform-llm-config.ts', 'admin/src/lib/ai',
  'admin/scripts/assistant-location-acceptance.mjs', 'admin/scripts/assistant-acceptance-safety.mjs', 'admin/.env.local', 'admin/.env.development',
  'miniprogram/packages/assistant', 'miniprogram/app.json', 'miniprogram/test/assistant-location.test.js', 'admin/package-lock.json',
  'tmp/xiaok-vector/connection.private.json', ...tests.map(file => 'admin/' + file)];
function binding() { const entries = {}; const walk = file => { const full = path.join(root, file); if (!fs.existsSync(full)) return;
  if (fs.statSync(full).isDirectory()) { for (const child of fs.readdirSync(full)) if (child !== '__tests__') walk(path.join(file, child)); }
  else entries[file] = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex'); }; scopes.forEach(walk); return entries; }
const report = { target: 'loopback:55432/xiaok_embedding_eval', tests, before: binding(), modelCalls: 0, exitCode: null, drift: [] };
let release;
try {
  release = await lockAssistantAcceptance(process.env.DATABASE_URL, { waitForLock: process.argv.includes('--wait-for-lock') });
  report.before = binding();
  await release.assertHeld();
  const child = spawn(process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=1', ...tests],
    { cwd: admin, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let log = ''; child.stdout.on('data', chunk => { log += chunk; }); child.stderr.on('data', chunk => { log += chunk; });
  report.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); });
  fs.writeFileSync(path.join(output, 'test.log'), log);
  await release.assertHeld();
  console.log(log.split('\n').filter(line => /not ok|✖|error:|tests |pass |fail |skipped|Error:/.test(line)).slice(-25).join('\n'));
} catch (error) { report.error = String(error); report.exitCode = 1; }
finally {
  report.after = binding(); report.drift = Object.keys(report.before).filter(file => report.before[file] !== report.after[file]);
  fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify(report, null, 2)); await release?.();
  process.exitCode = report.exitCode || report.drift.length ? 1 : 0;
  console.log(JSON.stringify({ output, exitCode: report.exitCode, drift: report.drift, error: report.error }));
}
