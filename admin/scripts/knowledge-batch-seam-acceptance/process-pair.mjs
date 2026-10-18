import fs from 'node:fs';
import path from 'node:path';
import { fork } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function createPair({ admin, output, mode, env, onBroker, onEvent = event => { void event; } }) {
  const pending = new Map(), processes = [], ready = [];
  let sequence = 0;
  for (let index = 0; index < 2; index++) {
    const log = fs.openSync(path.join(output, `process-${index}.log`), 'w');
    const child = fork(path.join(admin, 'scripts/knowledge-batch-seam-acceptance/process.ts'), [], {
      cwd: admin, windowsHide: true, execArgv: ['--import', pathToFileURL(path.join(admin, 'scripts/knowledge-batch-seam-acceptance/network-guard.mjs')).href, '--import', 'tsx'],
      env: { ...env, XIAOK_SEAM_MODE: mode, XIAOK_SEAM_GUARD_REPORT: path.join(output, `process-${index}-network.json`) },
      stdio: ['ignore', log, log, 'ipc'],
    });
    fs.closeSync(log); processes.push(child);
    ready.push(new Promise((resolve, reject) => {
      let started = false;
      const timer = setTimeout(() => reject(Error('SEAM_CHILD_READY_TIMEOUT')), 30000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', () => { clearTimeout(timer); if (!started) reject(Error('SEAM_CHILD_START_FAILED')); });
      child.on('message', message => {
        if (message.type === 'ready') { started = true; clearTimeout(timer); resolve(child.pid); }
        else if (message.type === 'event') onEvent({ ...message, pid: child.pid, index });
        else if (message.type === 'rpc') Promise.resolve().then(() => onBroker(message.method, message.input, index))
          .then(value => child.send({ type: 'rpc-result', id: message.id, value }), error => child.send({ type: 'rpc-result', id: message.id, error: error.code || error.message }));
        else if (message.type === 'result') {
          const key = index + ':' + message.id, item = pending.get(key);
          if (item) { clearTimeout(item.timer); pending.delete(key); item.resolve(message); }
        }
      });
    }));
    child.on('exit', () => {
      for (const [key, item] of pending) if (key.startsWith(index + ':')) {
        clearTimeout(item.timer); pending.delete(key); item.reject(Error('SEAM_CHILD_EXITED'));
      }
    });
  }
  return {
    processes,
    ready: () => Promise.all(ready),
    command(index, action, input = {}) {
      const id = ++sequence, key = index + ':' + id;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(key); reject(Error('SEAM_CHILD_TIMEOUT')); }, 30000);
        pending.set(key, { resolve, reject, timer }); processes[index].send({ type: 'command', id, action, input });
      });
    },
    async close() {
      await Promise.all(processes.map(async (child, index) => {
        if (child.exitCode !== null || child.signalCode) return;
        try { await this.command(index, 'shutdown'); } catch { /* retain an uncertain close as a failure below */ }
        await new Promise(resolve => {
          const timer = setTimeout(resolve, 3000); child.once('exit', () => { clearTimeout(timer); resolve(); });
          if (child.exitCode !== null || child.signalCode) { clearTimeout(timer); resolve(); }
        });
        if (child.exitCode === null && !child.signalCode) { child.kill(); throw Error('SEAM_CHILD_CLEANUP_UNCERTAIN'); }
      }));
    },
  };
}
