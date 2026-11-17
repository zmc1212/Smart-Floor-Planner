import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { test } from 'node:test';

const admin = path.resolve(import.meta.dirname, '../..');

async function startMock(handler) {
  const counts = { preflight: 0, tick: 0 };
  const server = createServer((incoming, outgoing) => {
    if (incoming.method === 'GET') counts.preflight += 1;
    else counts.tick += 1;
    handler(incoming, outgoing, counts);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return { server, counts, base: 'http://127.0.0.1:' + address.port + '/api/internal/assistant/jobs' };
}

async function stop(server) {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

async function readHealth(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return {};
  }
}

async function waitFor(predicate, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return false;
}

async function withWorker(handler, run) {
  const directory = await mkdtemp(path.join(tmpdir(), 'assistant-worker-safety-'));
  const health = path.join(directory, 'health.json');
  const mock = await startMock(handler);
  const child = spawn(process.execPath, ['scripts/assistant-worker.mjs'], {
    cwd: admin, stdio: 'ignore',
    env: {
      ...process.env,
      CRON_SECRET: 'i758-worker-safety',
      ASSISTANT_WORKER_ENDPOINT: mock.base + '/run',
      ASSISTANT_WORKER_PREFLIGHT_ENDPOINT: mock.base + '/preflight',
      ASSISTANT_WORKER_HEALTH_FILE: health,
    },
  });
  const exited = new Promise(resolve => child.once('exit', code => resolve(code)));
  try {
    return await run({ child, exited, health, mock });
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const done = new Promise(resolve => child.once('exit', resolve));
      child.kill();
      await Promise.race([done, new Promise(resolve => setTimeout(resolve, 5000))]);
    }
    await stop(mock.server);
    await rm(directory, { recursive: true, force: true });
  }
}

const closedGate = {
  status: 'closed', reason: 'pilot_scope_missing', deliveryScope: 'none',
  mode: 'enterprise', enterpriseId: null, pilotId: null,
};
const disabledGate = {
  status: 'closed', reason: 'worker_disabled', deliveryScope: 'none',
  mode: null, enterpriseId: null, pilotId: null,
};
test('I7.5.8 a resident Worker starts ticking when the admin enables it', async () => {
  let gate = disabledGate;
  await withWorker((incoming, outgoing) => {
    outgoing.writeHead(200, { 'content-type': 'application/json' });
    outgoing.end(JSON.stringify(incoming.method === 'GET'
      ? { success: true, data: { safetyGate: gate } }
      : { success: true, data: {} }));
  }, async ({ child, exited, health, mock }) => {
    assert.equal(await waitFor(async () => (await readHealth(health)).safetyGate?.reason === 'worker_disabled'), true);
    assert.equal(mock.counts.tick, 0);
    gate = openGate;
    assert.equal(await waitFor(() => mock.counts.tick > 0, 12000), true);
    assert.equal(child.exitCode, null, 'the Worker keeps running after the switch opens');
    child.kill();
    await exited;
  });
});

const openGate = {
  status: 'open', reason: 'pilot_scope_configured', deliveryScope: 'pilot',
  mode: 'pilot', enterpriseId: '1454', pilotId: 'first-pilot',
};

test('I7.5.8 a closed safety gate keeps the Worker resident and idle', async () => {
  await withWorker((incoming, outgoing) => {
    outgoing.writeHead(200, { 'content-type': 'application/json' });
    outgoing.end(JSON.stringify({ success: true, data: { safetyGate: closedGate } }));
  }, async ({ child, exited, health, mock }) => {
    const idle = await waitFor(async () => (await readHealth(health)).safetyGate?.status === 'closed');
    assert.equal(idle, true);
    assert.equal(child.exitCode, null, 'the Worker must not exit on a closed gate');
    assert.equal((await readHealth(health)).lastErrorCode, null);
    assert.ok(mock.counts.preflight >= 1);
    assert.equal(mock.counts.tick, 0);
    const checked = spawnSync(process.execPath, ['scripts/assistant-worker-healthcheck.mjs'], {
      cwd: admin, encoding: 'utf8',
      env: { ...process.env, ASSISTANT_WORKER_HEALTH_FILE: health },
    });
    assert.equal(checked.status, 1);
    assert.match(checked.stderr, /safety_gate_closed/);
    child.kill();
    await exited;
  });
});

test('I7.5.8 an admin-disabled Worker reports a healthy idle container', async () => {
  await withWorker((incoming, outgoing) => {
    outgoing.writeHead(200, { 'content-type': 'application/json' });
    outgoing.end(JSON.stringify({ success: true, data: { safetyGate: disabledGate } }));
  }, async ({ child, exited, health, mock }) => {
    const idle = await waitFor(async () => (await readHealth(health)).safetyGate?.reason === 'worker_disabled');
    assert.equal(idle, true);
    assert.equal(child.exitCode, null);
    assert.equal(mock.counts.tick, 0);
    const checked = spawnSync(process.execPath, ['scripts/assistant-worker-healthcheck.mjs'], {
      cwd: admin, encoding: 'utf8',
      env: { ...process.env, ASSISTANT_WORKER_HEALTH_FILE: health },
    });
    assert.equal(checked.status, 0);
    assert.equal(JSON.parse(checked.stdout).tickStatus, 'idle');
    child.kill();
    await exited;
  });
});

test('I7.5.8 an unavailable preflight fails closed', async () => {
  await withWorker((incoming, outgoing) => {
    outgoing.writeHead(503, { 'content-type': 'application/json' });
    outgoing.end(JSON.stringify({ success: false, code: 'assistant_preflight_unavailable' }));
  }, async ({ exited, health, mock }) => {
    assert.equal(await exited, 1);
    assert.equal(mock.counts.tick, 0);
    assert.equal((await readHealth(health)).lastErrorCode, 'preflight_unavailable');
  });
});

test('I7.5.8 an invalid preflight response fails closed', async () => {
  await withWorker((incoming, outgoing) => {
    outgoing.writeHead(200, { 'content-type': 'application/json' });
    outgoing.end(JSON.stringify({ success: true, data: {} }));
  }, async ({ exited, mock }) => {
    assert.equal(await exited, 1);
    assert.equal(mock.counts.tick, 0);
  });
});

test('I7.5.8 an open gate starts the existing tick loop', async () => {
  await withWorker((incoming, outgoing) => {
    if (incoming.method === 'GET') {
      outgoing.writeHead(200, { 'content-type': 'application/json' });
      outgoing.end(JSON.stringify({ success: true, data: { safetyGate: openGate } }));
      return;
    }
    outgoing.writeHead(200, { 'content-type': 'application/json' });
    outgoing.end(JSON.stringify({ success: true, data: { claimed: false } }));
  }, async ({ child, exited, health, mock }) => {
    const ticked = await waitFor(async () => (await readHealth(health)).lastSuccessAt > 0);
    assert.equal(ticked, true);
    assert.equal(mock.counts.preflight, 1);
    assert.ok(mock.counts.tick >= 1);
    const saved = await readHealth(health);
    assert.equal(saved.safetyGate.status, 'open');
    assert.equal(saved.lastErrorCode, null);
    child.kill();
    await exited;
  });
});
