import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import nextEnv from '@next/env';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';
import { freezeD4RuntimeConfig } from './assistant-d4-runtime-config.mjs';

const admin = path.resolve(import.meta.dirname, '..'), root = path.dirname(admin);
process.chdir(admin); nextEnv.loadEnvConfig(admin, true);
const mode = process.argv[2], name = process.argv[3];
if (!/^(unit|service|compat)$/.test(mode) || !/^d4-watch-[a-z0-9-]+$/.test(name)) throw Error('Expected unit/service/compat and labelled d4-watch evidence directory');
const output = path.join(root, 'tmp', name); fs.mkdirSync(output);
const runtimeConfig = path.join(output, 'tsconfig.runtime.json');
const files = mode === 'unit' ? ['src/lib/assistant/__tests__/site-watch-contract.test.ts'] : mode === 'service'
  ? ['src/db/__tests__/construction-site-watches.test.ts']
  : ['src/db/__tests__/construction-site-chat.test.ts', 'src/db/__tests__/construction-material-sharing-boundaries.test.ts'];
const binding = () => {
  const paths = [...files.map(f => 'admin/' + f), 'admin/scripts/assistant-site-watch-acceptance.mjs', 'admin/scripts/assistant-d4-sharing-fixture.ts',
    'admin/scripts/assistant-acceptance-safety.mjs', 'admin/scripts/assistant-d4-runtime-config.mjs', 'admin/package-lock.json', path.relative(root, runtimeConfig)];
  for (const dir of ['admin/src/lib/assistant', 'admin/src/lib/construction', 'admin/src/db', 'admin/src/lib/ai/providers']) {
    const walk = folder => { for (const item of fs.readdirSync(path.join(root, folder), { withFileTypes: true })) {
      const file = folder + '/' + item.name; if (item.isDirectory()) walk(file); else if (/\.(ts|json)$/.test(file) && !file.includes('/__tests__/')) paths.push(file);
    } }; walk(dir);
  }
  if (mode !== 'unit') paths.push('tmp/xiaok-vector/connection.private.json', 'admin/.env.local');
  return Object.fromEntries([...new Set(paths)].filter(f => fs.existsSync(path.join(root, f))).map(f => [f, createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex')]));
};
const report = { delivery: 'D4', mode, files, started: new Date().toISOString(), passed: false, providerCalls: 0 };
const save = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
let release;
try {
  if (mode !== 'unit') {
    process.env.DATABASE_URL = JSON.parse(fs.readFileSync(path.join(root, 'tmp/xiaok-vector/connection.private.json'), 'utf8').replace(/^\uFEFF/, '')).DATABASE_URL;
    release = await lockAssistantAcceptance(process.env.DATABASE_URL, { waitForLock: true });
  }
  report.configuration = freezeD4RuntimeConfig(admin, runtimeConfig); report.before = binding(); save();
  const child = spawn(process.execPath, ['--import', 'tsx', '--test', '--test-reporter=tap', '--test-concurrency=1', ...files],
    { cwd: admin, windowsHide: true, env: { ...process.env, TSX_TSCONFIG_PATH: runtimeConfig, CONSTRUCTION_LIVE_MODEL: '0', D4_EVIDENCE_DIRECTORY: output }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; const collect = chunk => { log += chunk; fs.appendFileSync(path.join(output, 'test.log'), chunk); };
  child.stdout.on('data', collect); child.stderr.on('data', collect);
  report.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => resolve(code ?? 1)); });
  report.counts = Object.fromEntries([...log.matchAll(/^# (tests|pass|fail|skipped) (\d+)/gm)].map(m => [m[1], Number(m[2])]));
  report.skippedTests = log.split('\n').filter(l => /^ok .* # SKIP/.test(l));
  report.after = binding(); report.drift = [...new Set([...Object.keys(report.before), ...Object.keys(report.after)])].filter(f => report.before[f] !== report.after[f]);
  const unexpectedSkips = report.skippedTests.filter(l => mode !== 'compat' || !l.includes('configured real provider, private photo and durable Worker produce a reviewable draft without formal approvals'));
  report.passed = report.exitCode === 0 && report.counts.tests > 0 && !unexpectedSkips.length && !report.drift.length;
  console.log(JSON.stringify({ mode, passed: report.passed, counts: report.counts, drift: report.drift, evidence: output }));
  console.log(log.split('\n').filter(l => /not ok|error:|actual:|expected:|Error:/.test(l)).join('\n'));
} catch (error) { report.error = String(error.stack || error); console.error(report.error); }
finally { report.finished = new Date().toISOString(); save(); await release?.(); process.exitCode = report.passed ? 0 : 1; }
