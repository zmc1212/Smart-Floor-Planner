import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import nextEnv from '@next/env';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';
import { freezeD4RuntimeConfig } from './assistant-d4-runtime-config.mjs';

const admin = path.resolve(import.meta.dirname, '..'), root = path.resolve(admin, '..');
process.chdir(admin); nextEnv.loadEnvConfig(admin, true);
const mode = process.argv[2] || 'unit', name = process.argv[3] || `d4-sharing-${mode}-${Date.now()}`;
if (!/^[a-z0-9-]+$/.test(name)) throw Error('Invalid evidence folder');
const out = path.join(root, 'tmp', name); fs.mkdirSync(out, { recursive: false });
const runtimeConfig = path.join(out, 'tsconfig.runtime.json');
const files = mode === 'unit' ? ['src/lib/assistant/__tests__/material-sharing.test.ts', 'src/lib/assistant/__tests__/agent-tool-scope.test.ts', 'src/lib/assistant/__tests__/agent-tool-input.test.ts']
  : mode === 'service' ? ['src/db/__tests__/construction-material-sharing.test.ts']
  : mode === 'boundary' ? ['src/db/__tests__/construction-material-sharing-boundaries.test.ts']
  : mode === 'revocation' ? ['src/db/__tests__/construction-material-sharing-boundaries.test.ts']
  : mode === 'compat-repair' ? ['src/db/__tests__/assistant-materials.test.ts', 'src/db/__tests__/construction-material-sharing-boundaries.test.ts']
  : mode === 'compat' ? ['src/db/__tests__/construction-material-sharing-boundaries.test.ts', 'src/db/__tests__/construction-materials.test.ts', 'src/db/__tests__/construction-chat-queries.test.ts', 'src/db/__tests__/assistant-materials.test.ts']
  : mode === 'site-context' ? ['src/db/__tests__/construction-site-context.test.ts']
  : mode === 'site-context-compat' ? ['src/db/__tests__/construction-chat-queries.test.ts', 'src/db/__tests__/construction-materials.test.ts', 'src/db/__tests__/construction-issue-continuation.test.ts', 'src/db/__tests__/construction-resolution.test.ts', 'src/db/__tests__/assistant-materials.test.ts']
  : mode === 'site-context-resolution-roles' || mode === 'site-context-resolution-recovery' ? ['src/db/__tests__/construction-resolution.test.ts']
  : mode === 'site-actions-unit' ? ['src/lib/construction/__tests__/site-action-contract.test.ts']
  : mode === 'site-actions' ? ['src/db/__tests__/construction-site-actions.test.ts']
  : mode === 'site-actions-compat' ? ['src/db/__tests__/construction-chat-queries.test.ts', 'src/db/__tests__/construction-materials.test.ts', 'src/db/__tests__/construction-site-context.test.ts']
  : mode === 'site-actions-queue' ? ['src/db/__tests__/assistant.test.ts', 'src/db/__tests__/assistant-usage.test.ts']
  : [];
if (!files.length) throw Error('Expected a named bounded D4 acceptance mode');
const unitMode = mode === 'unit' || mode === 'site-actions-unit';
const binding = () => {
  const paths = [...files.map(f => 'admin/' + f), 'admin/scripts/assistant-d4-sharing-fixture.ts', 'admin/scripts/assistant-d4-sharing-acceptance.mjs', 'admin/scripts/assistant-d4-runtime-config.mjs', 'admin/scripts/assistant-acceptance-safety.mjs', 'admin/package-lock.json', path.relative(root, runtimeConfig)];
  for (const dir of ['admin/src/lib/assistant', 'admin/src/lib/construction', 'admin/src/db']) {
    const walk = folder => { for (const item of fs.readdirSync(path.join(root, folder), { withFileTypes: true })) {
      const file = `${folder}/${item.name}`; if (item.isDirectory()) walk(file); else if (/\.(ts|json)$/.test(file) && !file.includes('/__tests__/')) paths.push(file);
    } }; walk(dir);
  }
  if (!unitMode) paths.push('tmp/xiaok-vector/connection.private.json', 'admin/.env.local');
  return Object.fromEntries([...new Set(paths)].filter(f => fs.existsSync(path.join(root, f))).map(f => [f, createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex')]));
};
const report = { delivery: 'D4', mode, files, started: new Date().toISOString(), before: binding(), passed: false, providerCalls: 0 };
let release;
const save = () => fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
try {
  if (!unitMode) {
    process.env.DATABASE_URL = JSON.parse(fs.readFileSync(path.join(root, 'tmp/xiaok-vector/connection.private.json'), 'utf8').replace(/^\uFEFF/, '')).DATABASE_URL;
    release = await lockAssistantAcceptance(process.env.DATABASE_URL, { waitForLock: true });
  }
  report.runtimeConfiguration = freezeD4RuntimeConfig(admin, runtimeConfig);
  report.before = binding(); // Bind the pinned effective config after any resource wait, before child imports/fixtures.
  save();
  const resolutionSelected = mode === 'site-context-resolution-roles' ? [
    'owner, admin and super_admin inherit formal resolve and close in the selected enterprise without employee membership',
    'concurrent replacement and execution, plus close/evidence correction, cannot leave an effective stale closed state',
    'actual member removal and re-addition never resurrect an old approved plan or formal evidence',
  ] : mode === 'site-context-resolution-recovery' ? [
    'actual reviewer and manager downgrades cannot revive old approval or closure after role restoration',
    'changed source can be re-reviewed on the same issue without reviving old closure or deadlocking its recovery',
    'actual query_followups checkpoints formal closed evidence into the existing revocable Agent source chain',
  ] : [];
  const pattern = resolutionSelected.length ? ['--test-name-pattern', '^(?:' + resolutionSelected.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')$']
    : mode === 'revocation' ? ['--test-name-pattern', '^scoped revocation selects the actual requested kind and rejects a model-selected different grant$'] : [];
  const child = spawn(process.execPath, ['--import', 'tsx', '--test', '--test-reporter=tap', '--test-concurrency=1', ...pattern, ...files],
    { cwd: admin, env: { ...process.env, TSX_TSCONFIG_PATH: runtimeConfig, XIAOK_MATERIALS_LIVE: '0', CONSTRUCTION_LIVE_MODEL: '0', D4_EVIDENCE_DIRECTORY: out }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  const collect = chunk => { log += chunk; fs.appendFileSync(path.join(out, 'test.log'), chunk); };
  child.stdout.on('data', collect); child.stderr.on('data', collect);
  report.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => resolve(code ?? 1)); });
  report.counts = Object.fromEntries([...log.matchAll(/^# (tests|pass|fail|skipped) (\d+)/gm)].map(m => [m[1], Number(m[2])]));
  report.skippedTests = log.split('\n').filter(l => /^ok .* # SKIP/.test(l));
  const expectedSkip = 'PPT15/23 configured model repeats the sourced need-to-materials path twice';
  report.selectedTestNames = resolutionSelected;
  report.expectedSkippedTests = resolutionSelected.length ? [...fs.readFileSync(path.join(admin, files[0]), 'utf8').matchAll(/^test\('([^']+)'/gm)]
    .map(match => match[1]).filter(name => !resolutionSelected.includes(name)) : mode.includes('compat') ? [expectedSkip] : mode === 'revocation' ? [
    'an expired displayed preview cannot grant access',
    'legacy commands with personal-recipient wording stay private until the actual preview and team confirmation',
    'a newer same-room grant from another owned consultation fences the previous preview',
    'two confirmations do not duplicate a grant and consent-source changes revoke its read model',
    'a model cannot claim it shared or revoked data without the actual service receipt',
    'an old private upload cannot be selected through a source-message argument after intervening text',
    'an interrupted clarification after a project correction cannot confirm the older preview',
    'an ordinary acknowledgement retains privacy until the separate explicit team authorization',
  ] : [];
  const unexpectedSkips = report.skippedTests.filter(l => !report.expectedSkippedTests.some(name => l.includes(' - ' + name + ' # SKIP')));
  report.after = binding(); report.drift = [...new Set([...Object.keys(report.before), ...Object.keys(report.after)])].filter(f => report.before[f] !== report.after[f]);
  report.passed = report.exitCode === 0 && report.counts.tests > 0 && !unexpectedSkips.length && !report.drift.length
    && (!resolutionSelected.length || report.counts.pass === resolutionSelected.length);
  process.exitCode = report.passed ? 0 : 1;
  console.log(JSON.stringify({ mode, passed: report.passed, counts: report.counts, drift: report.drift, evidence: out }));
  console.log(log.split('\n').filter(l => /not ok|error:|actual:|expected:|Error:/.test(l)).join('\n'));
} catch (error) { report.error = String(error.stack || error); process.exitCode = 1; console.error(report.error); }
finally { report.finished = new Date().toISOString(); save(); await release?.(); }
