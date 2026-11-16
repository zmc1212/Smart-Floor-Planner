import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  aggregateAlertStatus,
  buildOperationsAlerts,
  readOperationsThresholds,
  readWorkerHeartbeat,
  retrievalConfiguration,
  ratioString,
} from '../operations';

test('operations thresholds are configurable, bounded, and keep warn below critical', () => {
  const thresholds = readOperationsThresholds({
    ASSISTANT_OPERATIONS_QUEUE_BACKLOG_WARN: '3',
    ASSISTANT_OPERATIONS_QUEUE_BACKLOG_CRITICAL: '9',
    ASSISTANT_OPERATIONS_INSUFFICIENT_RATIO_WARN: '0.25',
    ASSISTANT_OPERATIONS_INSUFFICIENT_RATIO_CRITICAL: '0.75',
    ASSISTANT_OPERATIONS_LATENCY_P95_WARN_MS: 'not-a-number',
    ASSISTANT_OPERATIONS_LATENCY_P95_CRITICAL_MS: '2',
  });
  assert.equal(thresholds.queueBacklogWarn, 3);
  assert.equal(thresholds.queueBacklogCritical, 9);
  assert.equal(thresholds.insufficientRatioWarn, 0.25);
  assert.equal(thresholds.insufficientRatioCritical, 0.75);
  assert.equal(thresholds.latencyP95WarnMs, 30000);
  assert.equal(thresholds.latencyP95CriticalMs, 90000);
  assert.equal(ratioString('1', '4'), '0.250000');
  assert.equal(ratioString('1', '0'), 'unknown');
});

test('operations alerts classify objective thresholds and unavailable samples', () => {
  const thresholds = readOperationsThresholds({});
  const alerts = buildOperationsAlerts({
    queueBacklog: '50',
    queueOldestAgeSeconds: '301',
    answerLatencyP95Ms: '90001',
    latencySamples: '4',
    insufficientRatio: '0.500001',
    answeredCount: '4',
    citationFailures: '5',
    unknownCostBacklog: '1',
    worker: { freshness: 'unknown', lastSuccessAt: 'unknown', ageSeconds: 'unknown', liveProbe: false },
    thresholds,
  });
  assert.deepEqual(alerts.map(alert => alert.status), ['critical', 'critical', 'critical', 'critical', 'critical', 'warning', 'unknown']);
  assert.equal(alerts[2].unit, 'milliseconds');
  assert.equal(alerts[6].reason, 'heartbeat_unavailable');
  assert.equal(aggregateAlertStatus(alerts), 'critical');
  const noSamples = buildOperationsAlerts({
    queueBacklog: '0', queueOldestAgeSeconds: '0', answerLatencyP95Ms: 'unknown', latencySamples: '0', insufficientRatio: 'unknown', answeredCount: '0',
    citationFailures: '0', unknownCostBacklog: '0', worker: { freshness: 'fresh', lastSuccessAt: '2026-10-15T00:00:00.000Z', ageSeconds: '1', liveProbe: false }, thresholds,
  });
  assert.equal(noSamples.find(alert => alert.code === 'answer_latency_p95')?.status, 'unknown');
  assert.equal(noSamples.find(alert => alert.code === 'insufficient_evidence_ratio')?.status, 'unknown');
  assert.equal(aggregateAlertStatus(noSamples), 'unknown');
});

test('API reads the same shared worker health file and reports stale/unknown safely', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sfp-worker-health-'));
  const file = path.join(dir, 'assistant-worker-health.json');
  try {
    const now = 1_800_000_000_000;
    await writeFile(file, JSON.stringify({ lastSuccessAt: now - 5_000 }));
    const fresh = await readWorkerHeartbeat({ ASSISTANT_WORKER_HEALTH_FILE: file }, 60, now);
    assert.equal(fresh.freshness, 'fresh');
    assert.equal(fresh.liveProbe, false);

    await writeFile(file, JSON.stringify({ lastSuccessAt: now - 120_000 }));
    const stale = await readWorkerHeartbeat({ ASSISTANT_WORKER_HEALTH_FILE: file }, 60, now);
    assert.equal(stale.freshness, 'stale');

    await rm(file);
    const missing = await readWorkerHeartbeat({ ASSISTANT_WORKER_HEALTH_FILE: file }, 60, now);
    assert.equal(missing.freshness, 'unknown');
    assert.equal(JSON.stringify(missing).includes(file), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('retrieval status reports configuration without exposing credentials or claiming live health', () => {
  const configured = retrievalConfiguration({ ASSISTANT_EMBEDDING_URL: 'http://127.0.0.1:18089', ASSISTANT_EMBEDDING_API_KEY: 'secret-value' });
  assert.equal(configured.configured, true);
  assert.equal(configured.status, 'configured');
  assert.equal(configured.health, 'unknown');
  assert.equal(JSON.stringify(configured).includes('secret-value'), false);
  assert.equal(retrievalConfiguration({ ASSISTANT_EMBEDDING_URL: 'https://example.invalid' }).reason, 'missing_api_key');
  assert.equal(retrievalConfiguration({ ASSISTANT_EMBEDDING_URL: 'http://remote.example', ASSISTANT_EMBEDDING_API_KEY: 'x' }).reason, 'invalid_url');
});
