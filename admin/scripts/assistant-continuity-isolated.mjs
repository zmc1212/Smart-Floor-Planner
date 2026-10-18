// Run this worktree's actual HTTP/Worker/model against the approved isolated
// database. The shared lock spans startup, fixtures, native transport and exit.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import nextEnv from '@next/env';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';

const admin = path.resolve(import.meta.dirname, '..'), root = path.dirname(admin);
const output = path.resolve(process.env.XIAOK_ACCEPTANCE_OUTPUT || path.join(root, 'tmp/xiaok-fact-boundaries'));
fs.mkdirSync(output, { recursive: true });
nextEnv.loadEnvConfig(process.env.XIAOK_ACCEPTANCE_ENV_ROOT || admin, true);
const primary = new URL(process.env.DATABASE_URL || '');
if (!['localhost', '127.0.0.1'].includes(primary.hostname) || primary.port !== '5432' || primary.pathname !== '/smart_floor_planner') throw Error('Existing approved development environment required for read-only provider/template reuse');
const connectionFile = process.env.XIAOK_ACCEPTANCE_CONNECTION_FILE || path.join(root, 'tmp/xiaok-vector/connection.private.json');
const isolated = JSON.parse(fs.readFileSync(connectionFile, 'utf8').replace(/^\uFEFF/, '')).DATABASE_URL;
const release = await lockAssistantAcceptance(isolated);
const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1', DATABASE_URL: isolated, XIAOK_ACCEPTANCE_PRIMARY_DATABASE_URL: primary.toString(),
  XIAOK_ACCEPTANCE_LOCK_OWNER: String(process.pid), XIAOK_ACCEPTANCE_OUTPUT: output, XIAOK_ACCEPTANCE_ORIGIN: 'http://localhost:3007',
  ASSISTANT_WORKER_ENDPOINT: 'http://localhost:3007/api/internal/assistant/jobs/run', ASSISTANT_WORKER_HEALTH_FILE: path.join(output, 'worker-health.json') };
const status = { started: new Date().toISOString(), root, origin: env.XIAOK_ACCEPTANCE_ORIGIN, lockHeld: true, isolated: 'loopback:55432/xiaok_embedding_eval', children: [], passed: false };
const statusFile = path.join(output, process.argv.includes('--native') ? 'native-isolated-status.json' : 'live-isolated-status.json');
const save = () => fs.writeFileSync(statusFile, JSON.stringify(status, null, 2));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const processes = [];
function start(label, args) {
  const log = fs.openSync(path.join(output, label + '.log'), 'a');
  const child = spawn(process.execPath, args, { cwd: admin, env, windowsHide: true, stdio: ['ignore', log, log] });
  fs.closeSync(log); processes.push(child); status.children.push({ label, pid: child.pid }); save();
  return child;
}
async function freePort() {
  await new Promise((resolve, reject) => {
    const server = net.createServer(); server.once('error', reject); server.listen(3007, 'localhost', () => server.close(resolve));
  });
}
try {
  await freePort();
  const server = start('isolated-next', ['node_modules/next/dist/bin/next', 'dev', '--webpack', '-H', 'localhost', '-p', '3007']);
  let ready = false;
  for (let n = 0; n < 90; n++) {
    if (server.exitCode !== null) throw Error('Isolated Next process exited before ready; inspect isolated-next.log');
    try { const r = await fetch(env.XIAOK_ACCEPTANCE_ORIGIN + '/api/internal/assistant/jobs/run', { headers: { 'x-cron-secret': env.CRON_SECRET }, signal: AbortSignal.timeout(3000) }); ready = r.ok; } catch { /* startup compilation */ }
    if (ready) break;
    await delay(1000);
  }
  if (!ready) throw Error('Isolated worktree server did not become ready');
  start('isolated-worker', ['scripts/assistant-worker.mjs']);
  const driver = start(process.argv.includes('--native') ? 'native-driver' : 'live-driver', ['--import', 'tsx', 'scripts/assistant-continuity-development.ts', '--isolated', ...(process.argv.includes('--native') ? ['--native'] : [])]);
  const code = await new Promise((resolve, reject) => { driver.once('error', reject); driver.once('exit', code => resolve(code ?? 1)); });
  status.driverExitCode = code; status.passed = code === 0; process.exitCode = code;
} catch (error) {
  status.error = error.message; process.exitCode = 1;
} finally {
  // Only process trees launched above. Never stop the user's 3006 service,
  // original Worker, tunnels or the existing Stable DevTools window.
  for (const child of processes.reverse()) {
    if (child.exitCode !== null) continue;
    try { if (process.platform === 'win32') execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'pipe' }); else child.kill('SIGTERM'); }
    catch { /* already exited; retain PID/exit evidence */ }
  }
  await delay(300);
  status.children = status.children.map(c => {
    let running = false; try { process.kill(c.pid, 0); running = true; } catch { /* verified absent */ }
    return { ...c, running };
  });
  if (status.children.some(c => c.running)) { status.passed = false; status.cleanupUncertain = true; process.exitCode = 1; }
  await release(); status.lockHeld = false; status.finished = new Date().toISOString(); save(); console.log(JSON.stringify(status));
}
