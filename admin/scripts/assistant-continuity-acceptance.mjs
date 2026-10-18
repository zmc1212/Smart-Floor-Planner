import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import nextEnv from '@next/env';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';

const root = path.resolve(import.meta.dirname, '..'); process.chdir(root); nextEnv.loadEnvConfig(process.env.XIAOK_ACCEPTANCE_ENV_ROOT || root, true);
process.env.DATABASE_URL = JSON.parse(fs.readFileSync(process.env.XIAOK_ACCEPTANCE_CONNECTION_FILE || '../tmp/xiaok-vector/connection.private.json', 'utf8').replace(/^\uFEFF/, '')).DATABASE_URL;
const mode = process.argv.includes('--agent-regression') ? 'agent-regression' : process.argv.includes('--regression') ? 'regression'
  : process.argv.includes('--mini') ? 'mini' : process.argv.includes('--unit') ? 'unit' : process.argv.includes('--claims') ? 'claims'
  : process.argv.includes('--materials') ? 'materials' : 'service';
const release = ['mini','unit'].includes(mode) ? async () => {} : await lockAssistantAcceptance(), output = path.resolve(process.env.XIAOK_ACCEPTANCE_OUTPUT || '../tmp/xiaok-corrections-continuity');
fs.mkdirSync(output, { recursive: true });
try {
  const files = mode === 'service' ? ['src/db/__tests__/assistant-team-materials.test.ts','src/db/__tests__/assistant-need-issues.test.ts','src/lib/assistant/__tests__/answer-continuity.test.ts','src/lib/assistant/__tests__/synthesis.test.ts','src/lib/assistant/__tests__/agent-memory.test.ts','src/lib/assistant/__tests__/agent-runtime.test.ts']
    : mode === 'unit' ? ['src/lib/assistant/__tests__/answer-continuity.test.ts','src/lib/assistant/__tests__/synthesis.test.ts','src/lib/assistant/__tests__/agent-memory.test.ts','src/lib/assistant/__tests__/agent-runtime.test.ts']
    : mode === 'agent-regression' ? ['src/db/__tests__/assistant-synthesis.test.ts','src/db/__tests__/assistant-materials.test.ts']
    : mode === 'claims' ? ['src/db/__tests__/assistant-need-issues.test.ts']
    : mode === 'materials' ? ['src/db/__tests__/construction-materials.test.ts']
    : mode === 'regression' ? ['src/db/__tests__/assistant-shared-materials.test.ts','src/db/__tests__/construction-issue-continuation.test.ts',
      'src/db/__tests__/construction-materials.test.ts','src/db/__tests__/construction-resolution.test.ts','src/db/__tests__/construction-plans.test.ts',
      'src/db/__tests__/assistant-synthesis.test.ts','src/db/__tests__/assistant-materials.test.ts']
    : fs.readdirSync('../miniprogram/test').filter(f => /^(assistant-|construction-(site-chat|materials|plans|resolution|chat))/.test(f) && f.endsWith('.test.js')).map(f => '../miniprogram/test/' + f);
  const watched = [...new Set([...files, ...['answer-continuity','memory-sources','business-tools','memory','materials','context','worker','bound-context','synthesis','synthesis-sources'].map(f => 'src/lib/assistant/agent/' + f + '.ts'),
    'src/lib/assistant/__tests__/fixtures/continuity-v51.json','src/lib/assistant/__tests__/fixtures/continuity-v52.json','src/lib/assistant/__tests__/fixtures/continuity-v53.json','src/lib/assistant/__tests__/fixtures/continuity-v54.json','src/lib/assistant/__tests__/fixtures/continuity-v55.json','src/lib/assistant/__tests__/fixtures/continuity-v56.json','src/lib/construction/need-issues.ts'])];
  const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const sourceManifest = watched.map(file => ({ file, sha256: hash(file) }));
  fs.writeFileSync(path.join(output, mode + '-source-start.json'), JSON.stringify({ started: new Date().toISOString(), sourceManifest }, null, 2));
  const child = spawn(process.execPath, [...(mode === 'mini' ? [] : ['--import','tsx']), '--test','--test-reporter=tap','--test-concurrency=1',
    ...(mode === 'claims' ? ['--test-name-pattern=uncommitted memory'] : []), ...files],
    { cwd: root, env: process.env, windowsHide: true, stdio: ['ignore','pipe','pipe'] });
  let log = ''; fs.writeFileSync(path.join(output, mode + '.log'), '');
  const collect = c => { log += c; fs.appendFileSync(path.join(output, mode + '.log'), c); }; child.stdout.on('data', collect); child.stderr.on('data', collect);
  process.exitCode = await new Promise((resolve,reject) => { child.once('error',reject); child.once('exit',code => resolve(code ?? 1)); });
  const summary = { exitCode: process.exitCode, mode, files, finished: new Date().toISOString(),
    sourceManifest, changedDuringRun: sourceManifest.filter(s => s.sha256 !== hash(s.file)).map(s => s.file),
    reality: mode === 'mini' ? 'client unit tests; no native runtime' : mode === 'unit' ? 'pure unit tests and deterministic model protocols; no database, provider or native claim' : 'isolated PostgreSQL writes; deterministic model adapters; no real-model claim',
    counts: Object.fromEntries([...log.matchAll(/^# (tests|pass|fail|skipped) (\d+)/gm)].map(m => [m[1], Number(m[2])])) };
  fs.writeFileSync(path.join(output, mode + '-status.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary)); console.log(log.split('\n').filter(l => /not ok|error:|actual:|expected:|Error:/.test(l)).join('\n'));
} finally { await release(); }
