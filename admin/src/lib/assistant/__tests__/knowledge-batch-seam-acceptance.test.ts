import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { unchangedEffects, assertTwoProcesses, assertSameItemOnce, assertCancellationFence, assertRecovered, assertConfigurationRejected, safeErrorCode } from '../../../../scripts/knowledge-batch-seam-acceptance/assertions.mjs';
import { parseSeamArguments } from '../../../../scripts/assistant-knowledge-batch-seam-acceptance.mjs';

const sha = 'a'.repeat(64);
const snapshot = () => ({ counts: { runs: 1, jobs: 1, reservations: 1, providerAttempts: 1, providerMarkers: 1 },
  dispatchCalls: 1, providerFetches: 1, intent: { cancelled: true, manifestHash: sha, requestKey: 'original-cancel' }, intentCount: 1,
  runId: '21', conversationId: '20', createKey: 'original-create', sendKey: 'original-send',
  runStatus: 'indeterminate', reservationStatus: 'reconciling', costMicros: null });

test('wrapped database diagnostics retain only safe codes and terminate for cyclic causes', () => {
  const error = new Error('SQL and private parameters must stay out of the report', { cause: Object.assign(new Error('private value'), { code: '40P01' }) });
  assert.equal(safeErrorCode(error), '40P01');
  assert.equal(safeErrorCode(new Error('private value')), 'SEAM_ACTION_FAILED');
  const cyclic: { cause?: unknown } = {}; cyclic.cause = cyclic;
  assert.equal(safeErrorCode(cyclic), 'SEAM_ACTION_FAILED');
});

test('independent process evidence requires two distinct positive PIDs', () => {
  assertTwoProcesses([100, 101]);
  for (const pids of [[100, 100], [100], [100, 0], [100, -1]]) assert.throws(() => assertTwoProcesses(pids));
});
test('same-item acceptance requires exactly one run/job/reservation and one dispatch', () => {
  const value = snapshot(); value.counts.providerAttempts = 0; value.counts.providerMarkers = 0; value.providerFetches = 0; assertSameItemOnce(value);
  const duplicate = structuredClone(value); duplicate.counts.jobs++;
  assert.throws(() => assertSameItemOnce(duplicate));
});
test('every effect count, including provider markers and HTTP, is independently fenced', () => {
  const before = snapshot(); unchangedEffects(before, structuredClone(before));
  for (const field of Object.keys(before.counts) as Array<keyof typeof before.counts>) {
    const bad = structuredClone(before); bad.counts[field]++; assert.throws(() => unchangedEffects(before, bad));
  }
  for (const field of ['dispatchCalls', 'providerFetches'] as const) {
    const bad = structuredClone(before); bad[field]++; assert.throws(() => unchangedEffects(before, bad));
  }
});
test('cancel acceptance needs committed canonical intent, same manifest/key and no late admission', () => {
  const before = snapshot(); assertCancellationFence(before, structuredClone(before));
  for (const change of ['missing', 'cleared', 'second-intent', 'new-key', 'new-hash', 'new-run']) {
    const bad = structuredClone(before);
    if (change === 'missing' || change === 'cleared') bad.intent.cancelled = false;
    if (change === 'second-intent') bad.intentCount++;
    if (change === 'new-key') bad.intent.requestKey = 'different';
    if (change === 'new-hash') bad.intent.manifestHash = 'b'.repeat(64);
    if (change === 'new-run') bad.counts.runs++;
    assert.throws(() => assertCancellationFence(change === 'missing' ? bad : before, bad));
  }
});
test('recovery rejects any changed original binding, status, reconciliation or zero-filled bill', () => {
  const original = snapshot(), before = { ...original, runId: null, conversationId: null };
  assertRecovered(original, before, structuredClone(original));
  for (const field of ['runId', 'conversationId', 'createKey', 'sendKey', 'runStatus', 'reservationStatus', 'costMicros']) {
    const bad = { ...original, [field]: field === 'costMicros' ? 0 : 'changed' };
    assert.throws(() => assertRecovered(original, before, bad));
  }
});
test('configuration rejection requires changed actual revision and the correct local boundary', () => {
  const before = snapshot(), valid = { beforeRevision: sha, afterRevision: 'b'.repeat(64), errorCode: 'execution_changed' };
  assertConfigurationRejected(before, before, valid);
  for (const bad of [{ ...valid, afterRevision: sha }, { ...valid, errorCode: 'SEAM_EXTERNAL_HTTP_BLOCKED' }, { ...valid, beforeRevision: 'unmeasured' }])
    assert.throws(() => assertConfigurationRejected(before, before, bad));
});
test('offline CLI rejects service options, mixed modes and unknown/duplicate switches', () => {
  assert.deepEqual(parseSeamArguments([]), {});
  for (const args of [['--offline', '--connection-file', 'must-not-read'], ['--offline', '--service'], ['--service', '--service'], ['--unknown'], ['--output-dir']])
    assert.throws(() => parseSeamArguments(args));
});
test('service without ready SHA/factory stops before reading private environment/connection files', () => {
  const output = path.resolve('../tmp/knowledge-seam-preparation/preflight-' + randomUUID());
  const r = spawnSync(process.execPath, ['scripts/assistant-knowledge-batch-seam-acceptance.mjs', '--service',
    '--connection-file', 'NONEXISTENT-MUST-NOT-READ.private.json', '--env-dir', 'NONEXISTENT-MUST-NOT-READ-ENV', '--output-dir', output], {
    cwd: process.cwd(), windowsHide: true, encoding: 'utf8', timeout: 10000,
    env: { NODE_ENV:'test', SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, TEMP: process.env.TEMP, TMP: process.env.TMP },
  });
  assert.equal(r.status, 1); const status = JSON.parse(fs.readFileSync(path.join(output, 'runner-status.json'), 'utf8'));
  assert.equal(status.errorCode, 'SEAM_FACTORY_NOT_READY'); assert.equal(status.databaseOpened, false);
  assert.equal(status.driverPid, undefined); assert.equal(status.network.databaseConnections, 0);
});
test('the process guard blocks external fetch/TCP/TLS and offline PostgreSQL before any I/O', () => {
  const guard = pathToFileURL(path.resolve('scripts/knowledge-batch-seam-acceptance/network-guard.mjs')).href;
  const code = `import net from 'node:net'; import tls from 'node:tls'; import {networkReport} from ${JSON.stringify(guard)};
    try {await fetch('https://example.invalid');}catch{}
    for(const host of ['example.invalid','127.0.0.1'])try{new net.Socket().connect({host,port:55432});}catch{}
    try{tls.connect({host:'example.invalid',port:443});}catch{}
    console.log(JSON.stringify(networkReport()));`;
  const r = spawnSync(process.execPath, ['--import', guard, '--input-type=module', '-e', code], {
    cwd: process.cwd(), windowsHide: true, encoding: 'utf8', timeout: 10000,
    env: { NODE_ENV:'test', SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, TEMP: process.env.TEMP, TMP: process.env.TMP, XIAOK_SEAM_DATABASE_ALLOWED: '0' },
  });
  assert.equal(r.status, 0, r.stderr); const report = JSON.parse(r.stdout);
  assert.equal(report.providerFetches, 1); assert.equal(report.blockedSockets, 3); assert.equal(report.databaseConnections, 0);
});
