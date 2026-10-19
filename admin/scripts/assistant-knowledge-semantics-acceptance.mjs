import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import nextEnv from '@next/env';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';

const root = path.resolve(import.meta.dirname, '..'), args = process.argv.slice(2);
const flags = new Set(['--live', '--knowledge-only', '--followup', '--preflight', '--budget-only', '--revocation-only']);
const options = new Set(['--connection-file', '--lock-wait-ms', '--env-dir', '--output-dir']);
const seenArguments = new Set();
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (seenArguments.has(arg) || (!flags.has(arg) && !options.has(arg))) throw Error('Invalid or duplicate acceptance argument');
  seenArguments.add(arg);
  if (options.has(arg) && (!args[++i] || args[i].startsWith('--'))) throw Error('Missing acceptance option value');
}
const followup = args.includes('--followup'), preflight = args.includes('--preflight'), budgetOnly = args.includes('--budget-only');
const revocationOnly = args.includes('--revocation-only'), nonpaidModes = [preflight, budgetOnly, revocationOnly].filter(Boolean).length;
if (nonpaidModes && (!followup || args.includes('--live')) || nonpaidModes > 1 || followup && args.includes('--knowledge-only'))
  throw Error('Followup modes must be explicit and separate');
if (!args.includes('--live') && !nonpaidModes) throw Error('Use --live explicitly: this acceptance invokes the existing configured paid text model.');
const option = name => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  if (!args[i + 1] || args[i + 1].startsWith('--')) throw Error(`Missing ${name} value`);
  return args[i + 1];
};
const connection = option('--connection-file');
if (!connection) throw Error('An existing approved --connection-file is required.');
const wait = Number(option('--lock-wait-ms') || 0);
if (!Number.isSafeInteger(wait) || wait < 0 || wait > 1800000) throw Error('Invalid lock wait; maximum 30 minutes.');
process.chdir(root);
nextEnv.loadEnvConfig(path.resolve(option('--env-dir') || root), true);
const output = path.resolve(option('--output-dir') || '../tmp/knowledge-semantics/live');
if (!output.startsWith(path.resolve(root, '../tmp') + path.sep)) throw Error('Acceptance output must stay in this worktree tmp');
if (fs.existsSync(path.join(output, 'live.json')) || fs.existsSync(path.join(output, 'source-freeze.json'))) throw Error('Acceptance output already used');
fs.mkdirSync(output, { recursive: true });
const database = new URL(JSON.parse(fs.readFileSync(path.resolve(connection), 'utf8').replace(/^\uFEFF/, '')).DATABASE_URL);
const application = 'kb_semantics_' + process.pid + '_' + randomUUID(); database.searchParams.set('application_name', application);
process.env.DATABASE_URL = database.toString();
process.env.XIAOK_KNOWLEDGE_SEMANTICS_LOCK_APPLICATION = application;
process.env.XIAOK_KNOWLEDGE_SEMANTICS_LOCK_OWNER = String(process.pid);
process.env.XIAOK_KNOWLEDGE_SEMANTICS_OUTPUT = output;
process.env.XIAOK_KNOWLEDGE_SEMANTICS_ONLY = args.includes('--knowledge-only') ? '1' : '0';
process.env.XIAOK_KNOWLEDGE_SEMANTICS_FOLLOWUP = followup ? '1' : '0';
process.env.XIAOK_KNOWLEDGE_SEMANTICS_PREFLIGHT = preflight ? '1' : '0';
process.env.XIAOK_KNOWLEDGE_SEMANTICS_BUDGET_ONLY = budgetOnly ? '1' : '0';
process.env.XIAOK_KNOWLEDGE_SEMANTICS_REVOCATION_ONLY = revocationOnly ? '1' : '0';
const sources = ['scripts/assistant-knowledge-semantics-acceptance.mjs','scripts/assistant-knowledge-semantics-followup.ts',
  'scripts/assistant-knowledge-revocation.ts','scripts/knowledge-batch-seam-acceptance/network-guard.mjs',
  'scripts/assistant-knowledge-semantic-rules.ts','scripts/assistant-knowledge-semantics-live.ts', 'scripts/assistant-knowledge-coverage-cases.ts',
  'scripts/assistant-professional-cases.ts', 'scripts/assistant-synthesis-cases.ts',
  'src/lib/ai/postgres-workflow-chat.ts', 'src/lib/ai/providers/agent-chat.ts', 'src/lib/platform-llm-config.ts'];
function collect(dir) {
  for (const entry of fs.readdirSync(path.resolve(root, dir), { withFileTypes: true })) {
    const file = dir + '/' + entry.name;
    if (entry.isDirectory() && entry.name !== '__tests__') collect(file);
    else if (entry.isFile() && /\.tsx?$/.test(file)) sources.push(file);
  }
}
collect('src/lib/assistant');
const hashes = () => Object.fromEntries(sources.sort().map(file => [file, createHash('sha256').update(fs.readFileSync(path.resolve(root, file))).digest('hex')]));
let release = async () => {};
try {
  const deadline = Date.now() + wait, seen = new Set();
  while (true) {
    try { release = await lockAssistantAcceptance(); break; }
    catch (error) {
      const pending = ['Another assistant acceptance run holds the isolated database lock.',
        'Acceptance requires an idle isolated queue; do not run standalone assistant suites or workers concurrently.'].includes(error.message);
      if (!pending || Date.now() >= deadline) throw error;
      if (!seen.has(error.message)) { seen.add(error.message); console.log(error.message + ' Waiting for normal release; no writes or Worker startup.'); }
      await new Promise(resolve => setTimeout(resolve, Math.min(5000, deadline - Date.now())));
    }
  }
  console.log(JSON.stringify({ lock: 'acquired', mode: revocationOnly ? 'real PostgreSQL revocation, deterministic injected providers, external I/O blocked' : preflight ? 'read-only preflight' : budgetOnly ? 'real PostgreSQL, simulated HTTP budget check' : 'configured live C01 service acceptance', started: new Date().toISOString() }));
  const before = hashes(); fs.writeFileSync(path.join(output, 'source-freeze.json'), JSON.stringify(before, null, 2));
  const guard = pathToFileURL(path.resolve(root, 'scripts/knowledge-batch-seam-acceptance/network-guard.mjs')).href;
  const child = spawn(process.execPath, [...(revocationOnly ? ['--import', guard] : []), '--import', 'tsx', 'scripts/assistant-knowledge-semantics-live.ts'],
    { cwd: root, env: { ...process.env, ...(revocationOnly ? { XIAOK_SEAM_DATABASE_ALLOWED: '1', XIAOK_SEAM_GUARD_REPORT: path.join(output,'network-guard.json') } : {}) }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const logfile = path.join(output, 'service.log'); fs.writeFileSync(logfile, '');
  for (const stream of [child.stdout, child.stderr]) stream.on('data', value => { fs.appendFileSync(logfile, value); process.stdout.write(value); });
  const exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); });
  const network = revocationOnly ? JSON.parse(fs.readFileSync(path.join(output,'network-guard.json'),'utf8')) : null;
  const networkSafe = !revocationOnly || network?.providerFetches === 0 && network?.blockedSockets === 0;
  const after = hashes(), sourceStable = JSON.stringify(before) === JSON.stringify(after);
  fs.writeFileSync(path.join(output, 'service-status.json'), JSON.stringify({ exitCode, sourceStable, networkSafe, network, before, after,
    finished: new Date().toISOString(), scope: revocationOnly ? 'Real PostgreSQL/C01 revocation with injected deterministic providers; external I/O blocked'
      : preflight ? 'Read-only configuration/receipt preflight; no fixtures/external calls'
      : budgetOnly ? 'Real PostgreSQL and Agent budget check; simulated HTTP, no external calls'
        : 'Actual customer C01 Request handlers and user Agent, configured text model and real Embedding; no listening HTTP server/native UI',
    semanticReview: 'Separate source-bound review required; process success is not semantic acceptance',
  }, null, 2));
  process.exitCode = exitCode || (sourceStable && networkSafe ? 0 : 1);
} finally {
  await release();
  fs.writeFileSync(path.join(output, 'lock-release.json'), JSON.stringify({ released: true, finished: new Date().toISOString() }, null, 2));
}
