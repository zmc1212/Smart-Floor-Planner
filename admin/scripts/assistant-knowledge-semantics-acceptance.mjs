import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import nextEnv from '@next/env';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';

const root = path.resolve(import.meta.dirname, '..'), args = process.argv.slice(2);
if (!args.includes('--live')) throw Error('Use --live explicitly: this acceptance invokes the existing configured paid text model.');
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
process.env.DATABASE_URL = JSON.parse(fs.readFileSync(path.resolve(connection), 'utf8').replace(/^\uFEFF/, '')).DATABASE_URL;
const output = path.resolve(option('--output-dir') || '../tmp/knowledge-semantics/live');
fs.mkdirSync(output, { recursive: true });
process.env.XIAOK_KNOWLEDGE_SEMANTICS_OUTPUT = output;
process.env.XIAOK_KNOWLEDGE_SEMANTICS_ONLY = args.includes('--knowledge-only') ? '1' : '0';
const sources = ['scripts/assistant-knowledge-semantics-live.ts', 'scripts/assistant-knowledge-coverage-cases.ts',
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
  console.log(JSON.stringify({ lock: 'acquired', mode: 'configured live C01 service acceptance', started: new Date().toISOString() }));
  const before = hashes(); fs.writeFileSync(path.join(output, 'source-freeze.json'), JSON.stringify(before, null, 2));
  const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/assistant-knowledge-semantics-live.ts'],
    { cwd: root, env: process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const logfile = path.join(output, 'service.log'); fs.writeFileSync(logfile, '');
  for (const stream of [child.stdout, child.stderr]) stream.on('data', value => { fs.appendFileSync(logfile, value); process.stdout.write(value); });
  const exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); });
  const after = hashes(), sourceStable = JSON.stringify(before) === JSON.stringify(after);
  fs.writeFileSync(path.join(output, 'service-status.json'), JSON.stringify({ exitCode, sourceStable, before, after,
    finished: new Date().toISOString(), scope: 'Actual customer C01 HTTP handlers and user Agent, configured text model and real Embedding; no listening HTTP server/native UI',
    semanticReview: 'Separate source-bound review required; process success is not semantic acceptance',
  }, null, 2));
  process.exitCode = exitCode || (sourceStable ? 0 : 1);
} finally { await release(); }
