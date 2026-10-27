import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import nextEnv from '@next/env';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';

const root = path.resolve(import.meta.dirname, '..');
process.chdir(root);
const mode = process.argv.includes('--lint') ? 'lint' : process.argv.includes('--types') ? 'types' : 'service';
const evidence = process.argv.find(arg => arg.startsWith('--evidence='))?.slice('--evidence='.length) || 'xiaok-d2-formal-media';
if (!/^xiaok-[a-z0-9-]{1,80}$/.test(evidence)) throw Error('Invalid XiaoK evidence directory');
const output = path.resolve('../tmp', evidence); fs.mkdirSync(output, { recursive: true });
let release = async () => {};
if (mode === 'service') {
  nextEnv.loadEnvConfig(root, true);
  const config = JSON.parse(fs.readFileSync('../tmp/xiaok-vector/connection.private.json', 'utf8').replace(/^\uFEFF/, ''));
  process.env.DATABASE_URL = config.DATABASE_URL;
  release = await lockAssistantAcceptance(process.env.DATABASE_URL, { waitForLock: process.argv.includes('--wait-for-lock') });
}
try {
  process.env.ASSISTANT_FORMAL_MEDIA_EVIDENCE = output;
  const dependencies = () => {
    const files = [];
    const walk = folder => { for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const file = folder + '/' + entry.name;
      if (entry.isDirectory()) walk(file); else if (/\.(?:ts|mjs|js)$/.test(file)) files.push(file);
    } };
    for (const folder of ['src/lib', 'src/db']) walk(folder);
    files.push('scripts/assistant-formal-media-acceptance.mjs', 'scripts/assistant-acceptance-safety.mjs', 'package.json', 'package-lock.json', 'tsconfig.json');
    return Object.fromEntries(files.sort().map(file => [file, createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
  };
  const sources = dependencies(), started = new Date().toISOString();
  const files = ['src/lib/assistant/media/formal-source.ts', 'src/lib/assistant/media/service.ts', 'src/lib/assistant/agent/media-context.ts', 'src/db/__tests__/assistant-formal-media.test.ts'];
  const args = mode === 'types' ? ['node_modules/typescript/bin/tsc', '--noEmit', '--pretty', 'false'] : mode === 'lint'
    ? ['node_modules/eslint/bin/eslint.js', ...files.filter(file => fs.existsSync(file)), 'scripts/assistant-formal-media-acceptance.mjs']
    : ['--import', 'tsx', '--test', '--test-reporter=tap', '--test-concurrency=1', '--test-timeout=180000', 'src/db/__tests__/assistant-formal-media.test.ts'];
  fs.writeFileSync(path.join(output, mode + '-start.json'), JSON.stringify({ started, sources, mode }, null, 2));
  const logPath = path.join(output, mode + '.log'); fs.writeFileSync(logPath, ''); let log = '';
  const child = spawn(process.execPath, args, { cwd: root, env: process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const collect = chunk => { log += chunk; fs.appendFileSync(logPath, chunk); };
  child.stdout.on('data', collect); child.stderr.on('data', collect);
  const testExitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); });
  const sourcesAfter = dependencies();
  const changedDuringRun = [...new Set([...Object.keys(sources), ...Object.keys(sourcesAfter)])].filter(file => sources[file] !== sourcesAfter[file]);
  const exitCode = testExitCode || Number(changedDuringRun.length > 0);
  fs.writeFileSync(path.join(output, mode + '-status.json'), JSON.stringify({ started, finished: new Date().toISOString(), mode, exitCode, testExitCode, sources, sourcesAfter, changedDuringRun,
    scope: 'real isolated service/auth/rendering only; no model or embedding, no native acceptance' }, null, 2));
  console.log(log.split('\n').filter(line => /^(# (tests|pass|fail|skip)|not ok|ok \d|  error:|  message:)/.test(line)).slice(-30).join('\n') || `${mode}: exit ${exitCode}`);
  if (changedDuringRun.length) console.error('Source drift invalidated this batch: ' + changedDuringRun.join(', '));
  process.exitCode = exitCode;
} finally { await release(); }
