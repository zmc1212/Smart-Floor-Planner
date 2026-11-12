import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type { TestContext } from 'node:test';

type Message<T> = { result: T } | { checkpoint: string } | { error: string };

export function b510Process<T>(t: TestContext, args: string[], env: Record<string, string> = {}) {
  const child = spawn(process.execPath, ['--import', 'tsx', join(__dirname, 'b510-process.ts'), ...args], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    windowsHide: true,
    env: { ...process.env, ...env },
  });
  const exited = new Promise<number | null>(resolve => child.once('exit', resolve));
  const first = new Promise<Message<T>>((resolve, reject) => {
    child.once('message', value => resolve(value as Message<T>));
    child.once('error', reject);
    child.once('exit', (code, signal) => reject(Error('B5.10 child exited before receipt: ' + (signal ?? code))));
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exited;
  });
  return {
    first, exited,
    async kill() { child.kill('SIGKILL'); await exited; },
    async result() {
      const value = await first;
      if (!('result' in value)) throw Error('B5.10 child result missing: ' + JSON.stringify(value));
      return value.result;
    },
  };
}
