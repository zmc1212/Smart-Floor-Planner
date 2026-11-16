import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const workerScript = fileURLToPath(new URL('../assistant-worker.mjs', import.meta.url));
const healthcheckScript = fileURLToPath(new URL('../assistant-worker-healthcheck.mjs', import.meta.url));
const secret = 'synthetic-worker-secret-i748';
const responseData = 'synthetic-private-response-i748';

async function poll(read, matches) {
  const deadline = Date.now() + 8000;
  do {
    const value = await read();
    if (matches(value)) return value;
    await delay(20);
  } while (Date.now() < deadline);
  assert.fail('expected Worker diagnostics were not observed');
}

async function workerFixture(t, respond) {
  const directory = await mkdtemp(path.join(tmpdir(), 'sfp-worker-test-'));
  const healthFile = path.join(directory, 'health.json');
  const requests = [];
  let refuseTick = false;
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url?.endsWith('/preflight')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: { safetyGate: {
        status: 'open', reason: 'pilot_scope_configured', deliveryScope: 'pilot', mode: 'pilot',
        enterpriseId: '1', pilotId: 'worker-test',
      } } }));
      return;
    }
    if (refuseTick) {
      req.socket.destroy();
      return;
    }
    requests.push({ method: req.method, url: req.url, authorized: req.headers['x-cron-secret'] === secret });
    respond?.(res, requests.length);
  });
  let child, exited;
  let logs = '';
  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) child.kill();
    if (exited) await exited;
    if (server.listening) {
      const closed = once(server, 'close');
      server.close();
      server.closeAllConnections();
      await closed;
    }
    await rm(directory, { recursive: true, force: true });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const endpoint = `http://127.0.0.1:${server.address().port}/api/internal/assistant/jobs/run`;
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    ASSISTANT_WORKER_ENDPOINT: endpoint,
    ASSISTANT_WORKER_PREFLIGHT_ENDPOINT: endpoint.replace(/\/run$/, '/preflight'),
    ASSISTANT_WORKER_HEALTH_FILE: healthFile,
    CRON_SECRET: secret,
  };
  return {
    server, directory, healthFile, requests,
    refuseTick() { refuseTick = true; },
    start(overrides) {
      child = spawn(process.execPath, [workerScript], { env: { ...env, ...overrides }, stdio: ['ignore', 'pipe', 'pipe'] });
      exited = once(child, 'close');
      for (const stream of [child.stdout, child.stderr]) {
        stream.setEncoding('utf8');
        stream.on('data', chunk => { logs += chunk; });
      }
      return child.pid;
    },
    waitForExit: () => exited,
    logs: () => logs,
    health: (matches) => poll(async () => {
      try { return JSON.parse(await readFile(healthFile, 'utf8')); }
      catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    }, value => value !== null && matches(value)),
    checkHealth() {
      const result = spawnSync(process.execPath, [healthcheckScript], { env, encoding: 'utf8', timeout: 5000 });
      assert.ifError(result.error);
      return { exit: result.status, report: JSON.parse(result.stdout || result.stderr) };
    },
  };
}

function finish(response, status, success) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ success, data: responseData, secret }));
}

test('Worker records an in-flight request and then a fresh, redacted success', async (t) => {
  let pendingResponse;
  const fixture = await workerFixture(t, res => { pendingResponse = res; });
  const startedAt = Date.now();
  const pid = fixture.start();
  const pending = await fixture.health(h => h.lastRequestAt !== null);
  assert.equal(pending.workerPid, pid);
  assert.ok(pending.lastRequestAt >= startedAt);
  assert.equal(pending.lastSuccessAt, null);

  await poll(() => pendingResponse, Boolean);
  finish(pendingResponse, 200, true);
  const health = await fixture.health(h => h.lastSuccessAt !== null);
  assert.ok(health.lastSuccessAt >= health.lastRequestAt);
  assert.equal(health.lastFailureAt, null);
  assert.equal(health.consecutiveFailures, 0);
  assert.equal(health.lastHttpStatus, 200);
  assert.equal(health.lastErrorCode, null);
  assert.deepEqual(fixture.requests[0], { method: 'POST', url: '/api/internal/assistant/jobs/run', authorized: true });
  const check = fixture.checkHealth();
  assert.equal(check.exit, 0);
  assert.equal(check.report.processStatus, 'running');
  assert.equal(check.report.tickStatus, 'fresh');
  const raw = await readFile(fixture.healthFile, 'utf8');
  assert.equal(raw.includes(secret), false);
  assert.equal(raw.includes(responseData), false);
});

for (const [status, errorCode] of [
  [401, 'unauthorized'],
  [422, 'invalid_request'],
  [503, 'worker_unavailable'],
  [200, 'job_execution_failed'],
]) {
  test(`Worker classifies HTTP ${status} failure as ${errorCode}`, async (t) => {
    const fixture = await workerFixture(t, res => finish(res, status, false));
    fixture.start();
    const health = await fixture.health(h => h.lastErrorCode === errorCode);
    assert.equal(health.lastHttpStatus, status);
    assert.ok(health.lastFailureAt >= health.lastRequestAt);
    assert.equal(health.lastSuccessAt, null);
    assert.equal(health.consecutiveFailures, 1);
    const { exit, report } = fixture.checkHealth();
    assert.equal(exit, 1);
    assert.equal(report.reason, errorCode);
    assert.equal(report.processStatus, 'running');
    assert.equal(report.tickStatus, 'failed');
    const diagnostics = (await readFile(fixture.healthFile, 'utf8')) + fixture.logs();
    assert.ok(diagnostics.includes(errorCode));
    assert.equal(diagnostics.includes(secret), false);
    assert.equal(diagnostics.includes(responseData), false);
  });
}

test('Worker retains the prior success during failures and clears the streak after recovery', async (t) => {
  const statuses = [503, 422, 200];
  const fixture = await workerFixture(t, (res, n) => {
    const status = statuses[Math.min(n - 1, statuses.length - 1)];
    finish(res, status, status === 200);
  });
  const previousSuccess = Date.now() - 10000;
  await writeFile(fixture.healthFile, JSON.stringify({ lastSuccessAt: previousSuccess }));
  fixture.start();
  const first = await fixture.health(h => h.consecutiveFailures === 1);
  const second = await fixture.health(h => h.consecutiveFailures === 2);
  for (const health of [first, second]) assert.equal(health.lastSuccessAt, previousSuccess);
  assert.ok(second.lastRequestAt - first.lastRequestAt >= 1900);
  assert.ok(second.lastFailureAt > first.lastFailureAt);
  const failed = fixture.checkHealth();
  assert.equal(failed.exit, 1);
  assert.equal(failed.report.reason, 'invalid_request');

  const recovered = await fixture.health(h => h.lastSuccessAt > previousSuccess);
  assert.equal(recovered.consecutiveFailures, 0);
  assert.equal(recovered.lastErrorCode, null);
  assert.equal(recovered.lastHttpStatus, 200);
  assert.equal(recovered.lastFailureAt, second.lastFailureAt);
  assert.equal(fixture.checkHealth().exit, 0);
});

test('Worker identifies a refused endpoint without a synthetic HTTP status', async (t) => {
  const fixture = await workerFixture(t);
  fixture.refuseTick();
  fixture.start();
  const health = await fixture.health(h => h.lastErrorCode === 'endpoint_unreachable');
  assert.ok(health.lastRequestAt);
  assert.equal(health.lastHttpStatus, null);
  assert.equal(health.consecutiveFailures, 1);
  assert.equal(fixture.checkHealth().report.reason, 'endpoint_unreachable');
});

test('Worker with no CRON_SECRET exits and writes a diagnostic without making a request', { timeout: 10000 }, async (t) => {
  const fixture = await workerFixture(t);
  fixture.start({ CRON_SECRET: '' });
  const [exit] = await fixture.waitForExit();
  assert.equal(exit, 1);
  const health = await fixture.health(h => h.lastErrorCode === 'missing_secret');
  assert.equal(health.lastRequestAt, null);
  assert.ok(health.lastFailureAt);
  assert.equal(health.lastHttpStatus, null);
  assert.equal(fixture.requests.length, 0);
  assert.equal(fixture.checkHealth().report.reason, 'missing_secret');
});

test('Worker reports an unavailable health file while preserving the tick', async (t) => {
  const fixture = await workerFixture(t, res => finish(res, 200, true));
  fixture.start({ ASSISTANT_WORKER_HEALTH_FILE: path.join(fixture.directory, 'missing', 'health.json') });
  await poll(fixture.logs, logs => logs.includes('health_file_unavailable'));
  await poll(() => fixture.requests.length, n => n > 0);
  assert.equal(fixture.logs().includes(secret), false);
});
