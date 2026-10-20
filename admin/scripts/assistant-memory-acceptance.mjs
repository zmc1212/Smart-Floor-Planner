import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import nextEnv from '@next/env';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';

const root = path.resolve(import.meta.dirname, '..'); process.chdir(root); nextEnv.loadEnvConfig(root, true);
const unit = process.argv.includes('--unit'), regression = process.argv.includes('--regression'), capacityOnly = process.argv.includes('--capacity-only'), historyOnly = process.argv.includes('--history-only'), targeted = process.argv.includes('--targeted');
const recoveryOnly = process.argv.includes('--recovery-only');
const sourceIntegrity = process.argv.includes('--source-integrity');
const sourceRepairOnly = process.argv.includes('--source-repair-only');
const mode = unit ? 'unit' : regression ? 'regression' : sourceRepairOnly ? 'source-repair' : recoveryOnly ? 'recovery' : capacityOnly ? 'capacity' : historyOnly ? 'history' : targeted ? 'targeted' : 'service';
const evidence = process.argv.find(arg => arg.startsWith('--evidence='))?.slice('--evidence='.length);
if (evidence !== undefined && !/^[a-z0-9][a-z0-9-]{0,95}$/.test(evidence)) throw new Error('Invalid evidence directory name');
const output = path.resolve(evidence ? '../tmp/' + evidence : sourceIntegrity ? '../tmp/xiaok-source-integrity' : process.argv.includes('--bounded-recovery') ? '../tmp/xiaok-bounded-recovery' : process.argv.includes('--mixed') ? '../tmp/xiaok-mixed-correction' : '../tmp/xiaok-memory-capacity');
const files = sourceIntegrity ? unit ? ['scripts/__tests__/assistant-manual-cases.test.mjs', 'src/lib/assistant/__tests__/citation-catalog.test.ts', 'src/lib/assistant/__tests__/synthesis.test.ts', 'src/lib/assistant/__tests__/synthesis-review.test.ts',
  'src/lib/assistant/__tests__/synthesis-source-selection.test.ts', 'src/lib/assistant/__tests__/synthesis-grounding.test.ts', 'src/lib/assistant/__tests__/synthesis-repair-budget.test.ts', 'src/lib/assistant/__tests__/synthesis-conditional-risk.test.ts', 'src/lib/assistant/__tests__/synthesis-source-roles.test.ts', 'src/lib/assistant/__tests__/synthesis-repair.test.ts', 'src/lib/assistant/__tests__/acceptance-report.test.ts', 'src/lib/assistant/__tests__/agent-memory.test.ts', 'src/lib/assistant/__tests__/model-policy.test.ts', 'src/lib/assistant/__tests__/agent-runtime.test.ts', 'src/lib/assistant/__tests__/agent-read-dedupe.test.ts', 'src/lib/assistant/__tests__/context-budget.test.ts', 'src/lib/ai/__tests__/assistant-thinking.test.ts'] : ['src/db/__tests__/assistant-synthesis.test.ts']
  : unit ? ['src/lib/assistant/__tests__/agent-memory.test.ts', 'src/lib/assistant/__tests__/agent-tool-scope.test.ts', 'src/lib/assistant/__tests__/history-summary.test.ts', 'src/lib/assistant/__tests__/context-budget.test.ts', 'src/lib/assistant/__tests__/agent-runtime.test.ts', 'src/lib/assistant/__tests__/agent-read-dedupe.test.ts', 'src/lib/ai/__tests__/assistant-thinking.test.ts']
  : regression ? ['src/db/__tests__/assistant-agent.test.ts', 'src/db/__tests__/assistant-need-issues.test.ts', 'src/db/__tests__/assistant-retention.test.ts']
    : capacityOnly ? ['src/db/__tests__/assistant-memory-capacity.test.ts'] : historyOnly || recoveryOnly ? ['src/db/__tests__/assistant-history.test.ts'] : ['src/db/__tests__/assistant-memory-capacity.test.ts', 'src/db/__tests__/assistant-history.test.ts'];
if (!unit) process.env.DATABASE_URL = JSON.parse(fs.readFileSync('../tmp/xiaok-vector/connection.private.json', 'utf8').replace(/^\uFEFF/, '')).DATABASE_URL;
if (regression) {
  process.env.ASSISTANT_RETENTION_DATABASE_URL = process.env.DATABASE_URL;
  process.env.ASSISTANT_OPERATIONS_ACCEPTANCE = '1';
}
const release = unit ? async () => {} : await lockAssistantAcceptance(undefined, { waitForLock: process.argv.includes('--wait-for-lock') });
fs.mkdirSync(output, { recursive: true });
try {
  const runId = randomUUID(); process.env.ASSISTANT_TEST_RUN_ID = runId;
  const watched = fs.readdirSync('src/lib/assistant/agent').filter(f => f.endsWith('.ts')).sort().map(f => 'src/lib/assistant/agent/' + f);
  watched.push('scripts/assistant-memory-acceptance.mjs');
  watched.push('src/lib/ai/providers/agent-chat.ts', 'src/lib/assistant/contracts/model.ts');
  if (sourceIntegrity) watched.push('src/lib/assistant/contracts/index.ts', 'src/lib/assistant/contracts/source-file.ts',
    'scripts/assistant-manual-cases.mjs',
    'src/lib/assistant/knowledge/retrieval.ts', 'src/lib/assistant/knowledge/sources.ts', 'scripts/assistant-acceptance-report.mjs',
    'scripts/assistant-real-manual-synthesis-development.ts', 'scripts/assistant-citation-protocol-development.ts');
  const hashes = () => [...watched, ...files].map(file => ({ file, sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex') }));
  const sources = hashes(), started = new Date().toISOString();
  fs.writeFileSync(path.join(output, mode + '-start.json'), JSON.stringify({ runId, pid: process.pid, started, sources }, null, 2));
  const logFile = path.join(output, mode + '.log'); fs.writeFileSync(logFile, ''); let log = '';
  const pattern = sourceRepairOnly ? ['--test-name-pattern=citation repair uses|catalog citation first draft|same-enterprise other customer|expired source during|source grounding repair|actual project stage enters|bounded citation edits']
    : recoveryOnly ? ['--test-name-pattern=empty original recall|source change before delivery|wrong final format|persisted digest']
    : targeted ? ['--test-name-pattern=AG02.*(?:real Worker|new current correction|explicit current correction)|AG05: (?:tool replay|invalid later)|AG07: (?:withdrawn current correction|archive is|memory-derived|changing a current need)'] : [];
  const child = spawn(process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=1', ...pattern, ...files], { cwd: root, env: process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const collect = b => { log += b; fs.appendFileSync(logFile, b); }; child.stdout.on('data', collect); child.stderr.on('data', collect);
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  const status = { code, mode, files, sources, changedDuringRun: hashes().filter((s, i) => s.sha256 !== sources[i].sha256).map(s => s.file), started, finished: new Date().toISOString(),
    counts: Object.fromEntries([...log.matchAll(/^[#ℹ] (tests|pass|fail|skipped) (\d+)/gm)].map(m => [m[1], Number(m[2])])) };
  fs.writeFileSync(path.join(output, mode + '-status.json'), JSON.stringify(status, null, 2));
  console.log(log.split('\n').filter(l => /^(# (tests|pass|fail|skipped)|[✔✖ℹ]|not ok)|error:|Error:/.test(l)).join('\n'));
  console.log(JSON.stringify({ ...status, sources: sources.length }));
  process.exitCode = code || !status.counts.tests || status.changedDuringRun.length ? 1 : 0;
} finally { await release(); }
