import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import nextEnv from '@next/env';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';

const root = path.resolve(import.meta.dirname, '..'), args = process.argv.slice(2), service = args.includes('--service');
process.chdir(root);
const option = name => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  if (!args[i + 1] || args[i + 1].startsWith('--')) throw Error(`Missing ${name} value`);
  return args[i + 1];
};
const wait = Number(option('--lock-wait-ms') || 0);
if (!Number.isSafeInteger(wait) || wait < 0 || wait > 1800000 || (wait && !service)) throw Error('Invalid service lock wait; maximum 30 minutes.');
nextEnv.loadEnvConfig(path.resolve(option('--env-dir') || root), true);
const output = path.resolve(option('--output-dir') || '../tmp/knowledge-coverage');
fs.mkdirSync(output, { recursive: true });
const files = service ? ['src/db/__tests__/assistant-knowledge-coverage.test.ts'] : [
  'src/lib/assistant/__tests__/knowledge-context-coverage.test.ts', 'src/lib/assistant/__tests__/context-selection.test.ts',
  'src/lib/assistant/__tests__/professional-knowledge.test.ts', 'src/lib/assistant/__tests__/chinese-query.test.ts',
];
const sources = ['src/lib/assistant/knowledge/context-selection.ts', 'src/lib/assistant/knowledge/retrieval.ts',
  'scripts/assistant-knowledge-coverage-cases.ts', ...files];
const hashes = () => Object.fromEntries(sources.map(file => [file, createHash('sha256').update(fs.readFileSync(path.resolve(root, file))).digest('hex')]));
let release = async () => {};
try {
  if (service) {
    const configFile = option('--connection-file');
    if (!configFile) throw Error('Service checks require the existing approved --connection-file.');
    process.env.DATABASE_URL = JSON.parse(fs.readFileSync(path.resolve(configFile), 'utf8').replace(/^\uFEFF/, '')).DATABASE_URL;
    const deadline = Date.now() + wait;
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
  const before = hashes(), mode = service ? 'service' : 'unit', file = path.join(output, mode + '.log');
  fs.writeFileSync(file, '');
  const child = spawn(process.execPath, ['--import', 'tsx', '--test', '--test-reporter=tap', '--test-concurrency=1',
    '--test-timeout=300000', ...files], { cwd: root, env: process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', value => { log += value; fs.appendFileSync(file, value); });
  const exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); });
  const after = hashes(), sourceStable = JSON.stringify(before) === JSON.stringify(after);
  const summary = Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped'].map(name => [name, Number(log.match(new RegExp(`^# ${name} ([0-9]+)`, 'm'))?.[1] || 0)]));
  fs.writeFileSync(path.join(output, mode + '-status.json'), JSON.stringify({ mode, exitCode, sourceStable, before, after, summary,
    finished: new Date().toISOString(), model: service ? 'real isolated PostgreSQL/RLS, chunking and Embedding; direct retrieval; no text model or C01 Agent' : 'offline deterministic candidates; no database/model/embedding',
    safety: service ? 'shared acceptance lock, approved non-superuser/non-BYPASSRLS target and idle queue; no standalone Worker' : 'no database access',
  }, null, 2));
  console.log(JSON.stringify({ mode, exitCode, sourceStable, ...summary }));
  if (exitCode) console.log(log.split('\n').filter(line => /^not ok|^  error:|^  code:/.test(line)).join('\n'));
  process.exitCode = exitCode || (sourceStable && summary.tests > 0 ? 0 : 1);
} finally { await release(); }
