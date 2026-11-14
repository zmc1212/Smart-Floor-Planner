import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../assistant-worker-healthcheck.mjs', import.meta.url));

async function healthcheck(t, content) {
  const directory = await mkdtemp(path.join(tmpdir(), 'sfp-worker-healthcheck-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'health.json');
  if (content !== undefined) await writeFile(file, content);
  const result = spawnSync(process.execPath, [script], {
    env: { ...process.env, NODE_ENV: 'test', ASSISTANT_WORKER_HEALTH_FILE: file, CRON_SECRET: '' },
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.ifError(result.error);
  return { exit: result.status, report: JSON.parse(result.stdout || result.stderr) };
}

test('Healthcheck gives a distinct reason for a missing file', async (t) => {
  const { exit, report } = await healthcheck(t);
  assert.equal(exit, 1);
  assert.equal(report.reason, 'health_file_unavailable');
  assert.equal(report.fileError, 'missing');
  assert.equal(report.processStatus, 'unknown');
});

test('Healthcheck accepts a fresh legacy heartbeat with no PID or failure fields', async (t) => {
  const lastSuccessAt = Date.now();
  const { exit, report } = await healthcheck(t, JSON.stringify({ lastSuccessAt }));
  assert.equal(exit, 0);
  assert.equal(report.healthy, true);
  assert.equal(report.tickStatus, 'fresh');
  assert.equal(report.processStatus, 'unknown');
  assert.equal(report.lastSuccessAt, lastSuccessAt);
  assert.equal(report.consecutiveFailures, null);
});

test('Healthcheck identifies a stale heartbeat even when a process exists', async (t) => {
  const { exit, report } = await healthcheck(t, JSON.stringify({
    lastSuccessAt: Date.now() - 211000,
    workerPid: process.pid,
  }));
  assert.equal(exit, 1);
  assert.equal(report.processStatus, 'running');
  assert.equal(report.tickStatus, 'stale');
  assert.equal(report.reason, 'heartbeat_stale');
  assert.ok(report.ageSeconds >= 211);
});

test('Healthcheck requires a successful tick from a running process without heartbeat history', async (t) => {
  const { exit, report } = await healthcheck(t, JSON.stringify({
    lastRequestAt: Date.now(),
    lastSuccessAt: null,
    workerPid: process.pid,
  }));
  assert.equal(exit, 1);
  assert.equal(report.processStatus, 'running');
  assert.equal(report.tickStatus, 'no_success');
  assert.equal(report.reason, 'no_successful_tick');
});

test('Healthcheck distinguishes a stopped process from its fresh tick', async (t) => {
  const child = spawnSync(process.execPath, ['-e', ''], { timeout: 5000 });
  assert.equal(child.status, 0);
  const { exit, report } = await healthcheck(t, JSON.stringify({
    lastSuccessAt: Date.now(),
    workerPid: child.pid,
  }));
  assert.equal(exit, 1);
  assert.equal(report.processStatus, 'stopped');
  assert.equal(report.tickStatus, 'fresh');
  assert.equal(report.reason, 'worker_process_stopped');
});

test('Healthcheck rejects invalid and future timestamps without echoing file contents', async (t) => {
  for (const content of [
    '{',
    '{}',
    '{"lastSuccessAt":"synthetic-unexpected-content"}',
    JSON.stringify({ lastSuccessAt: Date.now() + 60000 }),
  ]) {
    const { exit, report } = await healthcheck(t, content);
    assert.equal(exit, 1);
    assert.equal(report.reason, 'health_file_unavailable');
    assert.equal(report.fileError, 'invalid');
    assert.equal(JSON.stringify(report).includes('synthetic-unexpected-content'), false);
  }
});
