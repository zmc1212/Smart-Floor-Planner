import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { developmentEnvironment, developmentWorkerEnvironment, superviseDevelopment } from '../dev.mjs';

test('development binds the local reader endpoint without overriding explicit configuration', () => {
  assert.equal(developmentEnvironment({}).ASSISTANT_PUBLIC_READER_URL, 'http://127.0.0.1:18095');
  assert.equal(developmentEnvironment({ ASSISTANT_PUBLIC_READER_URL: ' http://127.0.0.1:19999 ' }).ASSISTANT_PUBLIC_READER_URL,
    'http://127.0.0.1:19999');
});

test('worker follows the actual Next port and preserves an explicit endpoint', () => {
  const env = { CRON_SECRET: 'synthetic-test-only' };
  for (const args of [['--webpack', '-p', '3006'], ['--turbopack', '--port', '3006'], ['--port=3006']]) {
    assert.equal(developmentWorkerEnvironment(args, env).ASSISTANT_WORKER_ENDPOINT, 'http://127.0.0.1:3006/api/internal/assistant/jobs/run');
  }
  assert.match(developmentWorkerEnvironment([], { ...env, PORT: '3119' }).ASSISTANT_WORKER_ENDPOINT, /:3119\//);
  assert.equal(developmentWorkerEnvironment(['-p', '3119'], { ...env, ASSISTANT_WORKER_ENDPOINT: 'http://localhost:3120/custom' }).ASSISTANT_WORKER_ENDPOINT, 'http://localhost:3120/custom');
  assert.deepEqual(env, { CRON_SECRET: 'synthetic-test-only' });
});

test('missing worker credentials or an invalid port prevents a partially usable development server', () => {
  assert.throws(() => developmentWorkerEnvironment(['-p', '3006'], {}), /CRON_SECRET/);
  for (const port of ['', 'NaN', '0', '65536']) assert.throws(() => developmentWorkerEnvironment(['-p', port], { CRON_SECRET: 'synthetic-test-only' }), /port/);
});

async function waitFor(check) {
  const until = Date.now() + 10000;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise(done => setTimeout(done, 25));
  }
  throw Error('child process condition timed out');
}

test('a real consumer crash restarts, and stopping development leaves no owned child running', { timeout: 15000 }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sfp-dev-worker-'));
  const trace = path.join(dir, 'children.jsonl');
  const messages = [];
  const script = role => `const fs=require('fs');const file=${JSON.stringify(trace)};
    fs.appendFileSync(file,JSON.stringify({role:${JSON.stringify(role)},pid:process.pid,endpoint:process.env.ASSISTANT_WORKER_ENDPOINT})+'\\n');
    if(${JSON.stringify(role)}==='worker'&&fs.readFileSync(file,'utf8').split('\\n').filter(x=>x.includes('"role":"worker"')).length===1)process.exit(2);
    setInterval(()=>{},1000);`;
  const development = superviseDevelopment({ args: ['-p', '3119'], env: { ...process.env, CRON_SECRET: 'synthetic-test-only', ASSISTANT_WORKER_ENDPOINT: '' },
    commands: { next: [process.execPath, ['-e', script('next')]], worker: [process.execPath, ['-e', script('worker')]] }, restartMs: 25, log: message => messages.push(message) });
  let children;
  try {
    await waitFor(async () => {
      children = await fs.readFile(trace, 'utf8').catch(() => '');
      return children.trim().split('\n').filter(line => line.includes('"role":"worker"')).length === 2;
    });
    development.stop();
    assert.equal(await development.completion, 0);
    const records = children.trim().split('\n').map(line => JSON.parse(line));
    assert.equal(records.filter(row => row.role === 'next').length, 1);
    assert.ok(records.filter(row => row.role === 'worker').every(row => row.endpoint.includes(':3119/')));
    assert.equal(messages.length, 1);
    for (const child of records) assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
  } finally {
    development.stop();
    await development.completion;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('Next exit stops its consumer and keeps the server failure visible', { timeout: 10000 }, async () => {
  const development = superviseDevelopment({ args: ['-p', '3119'], env: { ...process.env, CRON_SECRET: 'synthetic-test-only' },
    commands: { next: [process.execPath, ['-e', 'setTimeout(()=>process.exit(7),100)']], worker: [process.execPath, ['-e', 'setInterval(()=>{},1000)']] }, restartMs: 25 });
  assert.equal(await development.completion, 7);
});
