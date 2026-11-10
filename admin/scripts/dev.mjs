import { spawn, execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nextEnv from '@next/env';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function developmentEnvironment(env) {
  // The local purpose-built reader is part of the development stack. Keep the
  // exact endpoint in both Next and the assistant worker so a restart does not
  // fail public research closed as web_reader_unconfigured. Explicit configuration
  // still wins.
  return { ...env, ASSISTANT_PUBLIC_READER_URL: env.ASSISTANT_PUBLIC_READER_URL?.trim()
    || 'http://127.0.0.1:18095' };
}

export function developmentWorkerEnvironment(args, env) {
  let port = env.PORT || '3000';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-p' || args[i] === '--port') port = args[++i];
    else if (args[i].startsWith('--port=')) port = args[i].slice(7);
  }
  if (!/^\d+$/.test(String(port)) || Number(port) < 1 || Number(port) > 65535) throw Error('Invalid development port');
  if (!env.CRON_SECRET?.trim()) throw Error('CRON_SECRET is required to start development with the assistant worker');
  return { ...env, ASSISTANT_WORKER_ENDPOINT: env.ASSISTANT_WORKER_ENDPOINT?.trim()
    || `http://127.0.0.1:${Number(port)}/api/internal/assistant/jobs/run` };
}

function stopOwnedChild(child) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  // Next owns a server subprocess. Stop only the tree that this launcher created.
  if (process.platform === 'win32') execFile('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true }, () => {});
  else child.kill('SIGTERM');
}

/** Own both development processes; a stopped consumer must never leave a silent queue. */
export function superviseDevelopment({ args, env, commands, restartMs = 2000, log = console.error }) {
  const workerEnv = developmentWorkerEnvironment(args, env);
  const launch = (command, childEnv) => spawn(command[0], command[1], { cwd: root, env: childEnv, stdio: 'inherit', windowsHide: true });
  const nextCommand = commands?.next || [process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'dev', ...args]];
  const workerCommand = commands?.worker || [process.execPath, [path.join(root, 'scripts/assistant-worker.mjs')]];
  let stopping = false, worker, restart;
  let resolve;
  const completion = new Promise(done => { resolve = done; });
  const next = launch(nextCommand, env);
  const stop = (code = 0) => {
    if (stopping) return;
    stopping = true;
    clearTimeout(restart);
    stopOwnedChild(next);
    if (worker) stopOwnedChild(worker);
    // Wait for owned children so restarting dev cannot orphan a consumer/server.
    Promise.all([next, worker].filter(Boolean).map(child => child.exitCode !== null || child.signalCode !== null
      ? Promise.resolve() : new Promise(done => child.once('close', done)))).then(() => resolve(code));
  };
  next.once('error', () => { log('[dev] failed to start Next.js'); stop(1); });
  next.once('exit', code => stop(code ?? 1));
  const startWorker = () => {
    if (stopping) return;
    worker = launch(workerCommand, workerEnv);
    worker.once('error', () => log('[dev] failed to start assistant worker'));
    worker.once('close', (code, signal) => {
      if (stopping) return;
      log(`[dev] assistant worker stopped (${signal || code}); restarting in ${restartMs}ms`);
      restart = setTimeout(startWorker, restartMs);
    });
  };
  startWorker();
  return { completion, stop };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  nextEnv.loadEnvConfig(root, true);
  try {
    const development = superviseDevelopment({ args: process.argv.slice(2), env: developmentEnvironment(process.env) });
    process.once('SIGINT', () => development.stop(0));
    process.once('SIGTERM', () => development.stop(0));
    process.exitCode = await development.completion;
  } catch (error) {
    console.error('[dev]', error.message);
    process.exitCode = 1;
  }
}
