import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import nextEnv from '@next/env';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';

const root = path.resolve(import.meta.dirname, '..');
process.chdir(root);
const args = process.argv.slice(2);
const service = args.includes('--service');
const waitIndex = args.indexOf('--lock-wait-ms');
const lockWaitMs = waitIndex < 0 ? 0 : Number(args[waitIndex + 1]);
if (!Number.isSafeInteger(lockWaitMs) || lockWaitMs < 0 || lockWaitMs > 1800000 || (lockWaitMs && !service)) throw Error('Invalid service lock wait; maximum 30 minutes.');
const option = name => {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw Error(`Missing ${name} value`);
  return path.resolve(args[index + 1]);
};
const envRoot = option('--env-dir') || root;
nextEnv.loadEnvConfig(envRoot, true);
const output = option('--output-dir') || path.resolve(root, '../tmp/knowledge-batch');
fs.mkdirSync(output, { recursive: true });
const files = service ? ['src/db/__tests__/assistant-knowledge-operations.test.ts', 'src/db/__tests__/assistant-knowledge-batches.test.ts'] : [
  'src/lib/assistant/__tests__/knowledge-batch-client.test.ts',
  'src/lib/assistant/__tests__/knowledge-evaluation-batch.test.ts',
  'src/lib/assistant/__tests__/knowledge-evaluation.test.ts',
  'src/lib/assistant/__tests__/context-selection.test.ts',
  'src/lib/assistant/__tests__/source-file.test.ts',
];
const sourceFiles = ['src/lib/assistant/knowledge/operations.ts', 'src/lib/assistant/knowledge/evaluation-batch.ts',
  'src/lib/assistant/knowledge/operation-batch-view.ts', 'src/components/assistant/knowledge-batch-client.ts',
  'src/components/assistant/knowledge-batches.tsx', 'src/components/assistant/knowledge-operations.tsx',
  'src/app/api/assistant/knowledge/operations/[...path]/route.ts', 'src/app/(admin)/(merchant)/assistant-knowledge/page.tsx', ...files];
const hashes = () => Object.fromEntries(sourceFiles.map(file => [file, createHash('sha256').update(fs.readFileSync(path.resolve(root, file))).digest('hex')]));
let release = async () => {};
try {
  if (service) {
    const configFile = option('--connection-file');
    if (!configFile) throw Error('Service checks require the existing approved --connection-file; no target is inferred.');
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8').replace(/^\uFEFF/, ''));
    process.env.DATABASE_URL = config.DATABASE_URL;
    const deadline = Date.now() + lockWaitMs;
    let waiting = false;
    while (true) {
      try { release = await lockAssistantAcceptance(); break; }
      catch (error) {
        if (error.message !== 'Another assistant acceptance run holds the isolated database lock.' || Date.now() >= deadline) throw error;
        if (!waiting) { waiting = true; console.log('Shared acceptance lock occupied; waiting without fixture writes or Worker startup.'); }
        await new Promise(resolve => setTimeout(resolve, Math.min(5000, deadline - Date.now())));
      }
    }
    console.log(JSON.stringify({ mode: 'service', lock: 'acquired', started: new Date().toISOString() }));
  }
  const before = hashes();
  const mode = service ? 'service' : 'unit', logFile = path.join(output, mode + '.log');
  fs.writeFileSync(logFile, '');
  const child = spawn(process.execPath, ['--import', 'tsx', '--test', '--test-reporter=tap', '--test-concurrency=1',
    '--test-timeout=300000', ...files], { cwd: root, env: process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', value => { log += value; fs.appendFileSync(logFile, value); });
  const exitCode = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', code => resolve(code ?? 1)); });
  const after = hashes(), sourceStable = JSON.stringify(before) === JSON.stringify(after);
  const summary = Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped'].map(name => [name, Number(log.match(new RegExp(`^# ${name} (\\d+)`, 'm'))?.[1] ?? 0)]));
  fs.writeFileSync(path.join(output, mode + '-status.json'), JSON.stringify({ mode, exitCode, sourceStable, before, after, summary,
    finished: new Date().toISOString(), model: service ? 'deterministic model; real isolated database and existing indexing/embedding' : 'offline deterministic ports; no database/model/embedding',
    safety: service ? 'shared lock, non-superuser/non-BYPASSRLS, approved isolated database, idle queue required; no standalone Worker' : 'no database access',
  }, null, 2));
  console.log(JSON.stringify({ mode, exitCode, sourceStable, ...summary }));
  if (exitCode) console.log(log.split('\n').filter(line => /^not ok|^  error:|^  code:/.test(line)).join('\n'));
  process.exitCode = exitCode || (sourceStable ? 0 : 1);
} finally { await release(); }
