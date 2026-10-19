import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import nextEnv from '@next/env';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';

const admin = path.resolve(import.meta.dirname, '..'), root = path.dirname(admin);
const args = process.argv.slice(2);
for (const arg of args) if (!['--service', '--wait-for-lock', '--native'].includes(arg)) throw Error('Unknown handoff acceptance argument');
if (args.includes('--native') && !args.includes('--service')) throw Error('Native requires service mode');
const service = args.includes('--service'), output = path.resolve(process.env.XIAOK_ACCEPTANCE_OUTPUT || root + '/tmp/xiaok-handoff-cancel/' + (service ? 'service-' : 'offline-') + Date.now());
if (!output.startsWith(path.join(root, 'tmp') + path.sep) || fs.existsSync(output + '/status.json')) throw Error('Use an unused worktree tmp output directory');
fs.mkdirSync(output, { recursive: true });
if (service) {
  nextEnv.loadEnvConfig(process.env.XIAOK_ACCEPTANCE_ENV_ROOT || admin, true);
  const file = process.env.XIAOK_ACCEPTANCE_CONNECTION_FILE;
  if (!file) throw Error('Explicit approved isolated connection file required');
  process.env.DATABASE_URL = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')).DATABASE_URL;
}
const files = ['src/lib/assistant/core/conversation.ts', 'src/lib/assistant/handoff/service.ts', 'src/lib/assistant/handoff/intent.ts',
  'src/lib/assistant/__tests__/handoff-cancel-intent.test.ts', 'src/db/__tests__/assistant-handoff-cancel.test.ts', 'scripts/assistant-handoff-cancel-native.mjs'];
const hashes = () => files.map(file => ({ file, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(admin, file))).digest('hex') }));
const before = hashes(), status = { mode: service ? 'real isolated PostgreSQL, no Worker/provider' : 'offline', before, passed: false, lockReleased: !service };
const save = () => fs.writeFileSync(output + '/status.json', JSON.stringify(status, null, 2)); save();
let release = async () => {};
try {
  if (service) { console.log('Waiting on canonical acceptance mutex; no fixture/Worker started.'); release = await lockAssistantAcceptance(undefined, { waitForLock: args.includes('--wait-for-lock') }); console.log('Canonical mutex acquired.'); }
  const log = fs.createWriteStream(output + '/test.log');
  const tests = service ? ['src/db/__tests__/assistant-handoff-cancel.test.ts'] : ['src/lib/assistant/__tests__/handoff-cancel-intent.test.ts'];
  const child = spawn('node', ['--import', 'tsx', '--test', '--test-reporter=tap', ...tests], { cwd: admin, windowsHide: true,
    env: { ...process.env, XIAOK_HANDOFF_LOCK_HELD: service ? String(process.pid) : '', XIAOK_HANDOFF_OUTPUT: output,
      XIAOK_HANDOFF_NATIVE: args.includes('--native') ? '1' : '0' } });
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  status.exitCode = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
  await new Promise(resolve => log.end(resolve));
  const text = fs.readFileSync(output + '/test.log', 'utf8');
  status.counts = Object.fromEntries(['tests', 'pass', 'fail', 'skipped', 'cancelled'].map(key => [key, Number(text.match(new RegExp('^# ' + key + ' (\\d+)', 'm'))?.[1])]));
  status.sourceStable = JSON.stringify(before) === JSON.stringify(hashes());
  status.passed = status.exitCode === 0 && status.sourceStable;
  process.exitCode = status.passed ? 0 : 1;
} finally { await release(); status.lockReleased = true; status.finished = new Date().toISOString(); save(); console.log(JSON.stringify({ ...status, before: undefined, output })); }
