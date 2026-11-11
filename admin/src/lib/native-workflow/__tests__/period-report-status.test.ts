import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { WorkflowOperationError } from '../errors';
import {
  extractPeriodReportRunBinding,
  mapPeriodReportRunStatus,
  readPeriodReportRunStatus,
  type PeriodReportBusinessSnapshot,
  type PeriodRunBindingView,
} from '../live/period-report-status';
import { createFileWorkflowRunStore } from '../live/run-store';
import type {
  LiveBusinessEvent,
  LiveRunRecord,
  LiveRunStatus,
} from '../live/types';
import type { TriggerEvent } from '../types';

const ENTERPRISE = '1454';
const PROJECT = '1455';
const ADMIN = '1454000007';
const PERIOD_START = '2026-11-10';
const PERIOD_END = '2026-11-10';
/** Exclusive Shanghai midnight after 2026-11-10. */
const PERIOD_END_INSTANT = '2026-11-10T16:00:00.000Z';
const NOW = '2026-11-11T03:00:00.000Z';
const OBSERVED_AT = '2026-11-11T03:00:00.000Z';
const DIGEST = 'a'.repeat(64);

const event: TriggerEvent = {
  eventId: 'b5-daily-20261110',
  eventType: 'period_report',
  occurredAt: '2026-11-11T02:00:00.000Z',
  periodKind: 'daily',
  periodStart: PERIOD_START,
  periodEnd: PERIOD_END,
};

const businessEvent: LiveBusinessEvent = {
  outboxEventId: null,
  progressRevision: 0,
  stageKey: '',
  settingsVersion: 1,
  source: 'current_project_revision',
  periodKind: 'daily',
  periodStart: PERIOD_START,
  periodEnd: PERIOD_END,
};

function receipt(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    receiptId: 'report:5001:1',
    simulated: false,
    source: 'construction_reports',
    reportId: '5001',
    revision: 1,
    runId: '8001',
    reportKey: 'report-key',
    bindingId: '9001',
    conversationId: '7001',
    reused: false,
    ...overrides,
  };
}

interface RecordOptions {
  readonly status?: LiveRunStatus;
  readonly runId?: string;
  readonly enterpriseId?: string;
  readonly projectId?: string;
  readonly saveOutcome?: 'succeeded' | 'failed' | 'unknown';
  readonly includeSave?: boolean;
  readonly saveReceipt?: Record<string, unknown> | null;
  readonly event?: TriggerEvent;
  readonly businessEvent?: LiveBusinessEvent;
  readonly runError?: { code: string; path: string; message: string } | null;
}

function makeRecord(options: RecordOptions = {}): LiveRunRecord {
  const runId = options.runId ?? 'run-period-1';
  const status = options.status ?? 'completed';
  const saveOutcome = options.saveOutcome ?? 'succeeded';
  const operations = options.includeSave === false
    ? []
    : [{
        nodeId: 'save-period-report',
        capabilityRef: 'save.period_report',
        effect: 'save' as const,
        nodeVersion: 'save@1',
        idempotencyKey: 'idem-save',
        startedAt: NOW,
        finishedAt: NOW,
        outcome: saveOutcome,
        ...(options.saveReceipt === null
          ? {}
          : { outputs: { saved: true, saveReceipt: options.saveReceipt ?? receipt() } }),
        ...(saveOutcome === 'succeeded'
          ? {}
          : {
              error: {
                code: 'save_not_confirmed',
                path: 'nodes.save-period-report',
                message: 'save not confirmed',
              },
            }),
      }];
  const runError = options.runError ?? null;
  return {
    binding: {
      runId,
      definitionId: 'period-report-daily',
      revision: 1,
      digest: DIGEST,
      nodeVersions: { 'trigger-1': 'trigger@1/trigger.period_report' },
      event: options.event ?? event,
      businessEvent: options.businessEvent ?? businessEvent,
    },
    enterpriseId: options.enterpriseId ?? ENTERPRISE,
    projectId: options.projectId ?? PROJECT,
    status,
    state: {
      runId,
      definitionId: 'period-report-daily',
      revision: 1,
      digest: DIGEST,
      mode: 'live',
      status: status === 'completed' ? 'completed' : status === 'failed' ? 'failed' : 'running',
      currentNodeId: null,
      pendingNodeId: null,
      visitedNodeIds: [],
      outputs: {},
      processedEventIds: [],
      error: runError,
      outcome: status === 'completed' ? 'delivered' : null,
      stepCount: 1,
      traceSeq: 1,
    },
    trace: [],
    operations,
    createdAt: '2026-11-11T02:00:00.000Z',
    updatedAt: NOW,
  };
}

function bindingView(record: LiveRunRecord = makeRecord()): PeriodRunBindingView {
  const extracted = extractPeriodReportRunBinding(record);
  assert.equal(extracted.ok, true);
  assert.ok(extracted.binding);
  return extracted.binding;
}

type SnapshotOptions = Partial<PeriodReportBusinessSnapshot>;

function snapshot(overrides: SnapshotOptions = {}): PeriodReportBusinessSnapshot {
  return {
    report: {
      id: '5001',
      binding_id: '9001',
      report_key: 'report-key',
      kind: 'daily',
      period_start: '2026-11-09T16:00:00.000Z',
      period_end: PERIOD_END_INSTANT,
      latest_revision: 1,
    },
    version: {
      revision: 1,
      status: 'facts_ready',
      generated_at: '2026-11-11T02:00:00.000Z',
      body_present: true,
      knowledge_status: 'ready',
      body_run_id: '8002',
      body_error_code: null,
      body_attempts: 0,
    },
    factsRun: { id: '8001', status: 'succeeded', error_code: null },
    factsJob: {
      jobId: '9101',
      status: 'succeeded',
      attempts: 1,
      providerStartedAt: '2026-11-11T02:00:00.000Z',
    },
    bodyRun: { id: '8002', status: 'succeeded', error_code: null },
    bodyJob: {
      jobId: '9102',
      status: 'succeeded',
      attempts: 1,
      providerStartedAt: '2026-11-11T02:10:00.000Z',
    },
    delivery: {
      state: 'delivered',
      message_id: '8101',
      delivered_at: '2026-11-11T02:20:00.000Z',
      read_at: null,
    },
    message: {
      id: '8101',
      conversation_id: '7001',
      purpose: 'construction.report.facts',
      seq: '12',
    },
    binding: {
      id: '9001',
      project_id: PROJECT,
      conversation_id: '7001',
      audience: 'customer',
      status: 'enabled',
      user_id: '1454000002',
    },
    project: {
      id: PROJECT,
      name: '测试项目',
      status: 'active',
      customer_access: true,
      current_stage_key: 'plumbing',
    },
    conversation: { id: '7001', status: 'open', retention_redacted: false },
    followup_available: true,
    source_project_ids: [PROJECT],
    read_error: null,
    ...overrides,
  };
}

function map(
  snapshotOverrides: SnapshotOptions = {},
  record: LiveRunRecord = makeRecord(),
) {
  return mapPeriodReportRunStatus({
    record,
    binding: bindingView(record),
    snapshot: snapshot(snapshotOverrides),
    observedAt: OBSERVED_AT,
  });
}

// ---------------------------------------------------------------------------
// extract
// ---------------------------------------------------------------------------

test('extract reads the last successful save receipt as the run binding', () => {
  const extracted = extractPeriodReportRunBinding(makeRecord());
  assert.equal(extracted.ok, true);
  assert.deepEqual(extracted.reasons, []);
  assert.deepEqual(extracted.binding, {
    runId: 'run-period-1',
    enterpriseId: ENTERPRISE,
    projectId: PROJECT,
    projectName: '',
    definitionId: 'period-report-daily',
    definitionRevision: 1,
    digest: DIGEST,
    periodKind: 'daily',
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    reportId: '5001',
    reportRevision: 1,
    reportKey: 'report-key',
    factsRunId: '8001',
    bindingId: '9001',
    conversationId: '7001',
    savedReused: false,
  });
});

test('extract rejects a run without a confirmed save receipt', () => {
  const missing = extractPeriodReportRunBinding(makeRecord({ includeSave: false }));
  assert.equal(missing.ok, false);
  assert.equal(missing.binding, null);
  assert.ok(missing.reasons.includes('save_not_succeeded'));

  const noReceipt = extractPeriodReportRunBinding(makeRecord({ saveReceipt: null }));
  assert.equal(noReceipt.ok, false);
  assert.ok(noReceipt.reasons.includes('save_receipt_missing'));
});

test('extract rejects failed or unknown save outcomes', () => {
  for (const outcome of ['failed', 'unknown'] as const) {
    const extracted = extractPeriodReportRunBinding(makeRecord({ saveOutcome: outcome }));
    assert.equal(extracted.ok, false);
    assert.equal(extracted.binding, null);
    assert.ok(extracted.reasons.includes('save_not_succeeded'));
  }
});

test('extract rejects a simulated receipt', () => {
  const extracted = extractPeriodReportRunBinding(
    makeRecord({ saveReceipt: receipt({ simulated: true }) }),
  );
  assert.equal(extracted.ok, false);
  assert.ok(extracted.reasons.includes('save_simulated'));
});

test('extract rejects a receipt without the report identity', () => {
  const missing = extractPeriodReportRunBinding(
    makeRecord({ saveReceipt: receipt({ reportId: '' }) }),
  );
  assert.equal(missing.ok, false);
  assert.ok(missing.reasons.includes('report_id_missing'));

  const fractional = extractPeriodReportRunBinding(
    makeRecord({ saveReceipt: receipt({ revision: 1.5 }) }),
  );
  assert.equal(fractional.ok, false);
  assert.ok(fractional.reasons.includes('report_revision_invalid'));
});

test('extract rejects a period event that diverges from the business event', () => {
  const extracted = extractPeriodReportRunBinding(
    makeRecord({ event: { ...event, periodEnd: '2026-11-11' } }),
  );
  assert.equal(extracted.ok, false);
  assert.ok(extracted.reasons.includes('period_event_mismatch'));
});

test('extract rejects a non-daily period and a non-period event', () => {
  const unsupported = extractPeriodReportRunBinding(
    makeRecord({ businessEvent: { ...businessEvent, periodKind: undefined } }),
  );
  assert.equal(unsupported.ok, false);
  assert.ok(unsupported.reasons.includes('period_kind_unsupported'));

  const stageEvent = extractPeriodReportRunBinding(
    makeRecord({
      event: {
        eventId: 'stage-1',
        eventType: 'stage_changed',
        occurredAt: NOW,
        stageKey: 'plumbing',
      },
    }),
  );
  assert.equal(stageEvent.ok, false);
  assert.ok(stageEvent.reasons.includes('period_event_mismatch'));
});

// ---------------------------------------------------------------------------
// mapping
// ---------------------------------------------------------------------------

test('a queued facts step maps to processing, not completed', () => {
  const progress = map({
    version: {
      revision: 1,
      status: 'queued',
      generated_at: null,
      body_present: false,
      knowledge_status: 'not_generated',
      body_run_id: null,
      body_error_code: null,
      body_attempts: 0,
    },
    factsRun: null,
    factsJob: null,
    bodyRun: null,
    bodyJob: null,
    delivery: null,
    message: null,
  });
  assert.equal(progress.facts.state, 'queued');
  assert.equal(progress.overall, 'processing');
  assert.equal(progress.processing, true);
  assert.equal(progress.completed, false);
});

test('facts ready with a queued body stays processing', () => {
  const progress = map({
    version: {
      revision: 1,
      status: 'facts_ready',
      generated_at: '2026-11-11T02:00:00.000Z',
      body_present: false,
      knowledge_status: 'queued',
      body_run_id: '8002',
      body_error_code: null,
      body_attempts: 1,
    },
    bodyRun: { id: '8002', status: 'queued', error_code: null },
    bodyJob: { jobId: '9102', status: 'queued', attempts: 1, providerStartedAt: null },
    delivery: null,
    message: null,
  });
  assert.equal(progress.facts.state, 'ready');
  assert.equal(progress.body.state, 'queued');
  assert.equal(progress.overall, 'processing');
});

test('delivery delivered while the body is not ready is processing, never completed', () => {
  const progress = map({
    version: {
      revision: 1,
      status: 'facts_ready',
      generated_at: '2026-11-11T02:00:00.000Z',
      body_present: false,
      knowledge_status: 'not_generated',
      body_run_id: null,
      body_error_code: null,
      body_attempts: 0,
    },
    bodyRun: null,
    bodyJob: null,
  });
  assert.equal(progress.delivery.state, 'delivered');
  assert.equal(progress.body.state, 'waiting');
  assert.equal(progress.overall, 'processing');
  assert.equal(progress.completed, false);
});

test('facts ready, body ready and a confirmed delivery complete the run', () => {
  const progress = map();
  assert.equal(progress.facts.state, 'ready');
  assert.equal(progress.body.state, 'ready');
  assert.equal(progress.delivery.state, 'delivered');
  assert.equal(progress.availability.state, 'available');
  assert.equal(progress.overall, 'completed');
  assert.equal(progress.completed, true);
  assert.equal(progress.processing, false);
});

test('a failed body run fails the run without claiming completion', () => {
  const progress = map({
    version: {
      revision: 1,
      status: 'facts_ready',
      generated_at: '2026-11-11T02:00:00.000Z',
      body_present: false,
      knowledge_status: 'failed',
      body_run_id: '8002',
      body_error_code: 'context_changed',
      body_attempts: 3,
    },
    bodyRun: { id: '8002', status: 'failed', error_code: 'context_changed' },
    bodyJob: { jobId: '9102', status: 'failed', attempts: 3, providerStartedAt: null },
    delivery: null,
    message: null,
  });
  assert.equal(progress.body.state, 'failed');
  assert.equal(progress.overall, 'failed');
  assert.equal(progress.completed, false);
  assert.ok(progress.reasons.includes('body_failed'));
});

test('indeterminate or unknown body states stay unknown', () => {
  const indeterminate = map({
    version: {
      revision: 1,
      status: 'facts_ready',
      generated_at: '2026-11-11T02:00:00.000Z',
      body_present: false,
      knowledge_status: 'queued',
      body_run_id: '8002',
      body_error_code: null,
      body_attempts: 1,
    },
    bodyRun: { id: '8002', status: 'indeterminate', error_code: null },
    bodyJob: null,
    delivery: null,
    message: null,
  });
  assert.equal(indeterminate.body.state, 'unknown');
  assert.equal(indeterminate.overall, 'unknown');
  assert.equal(indeterminate.completed, false);
  assert.ok(indeterminate.reasons.includes('body_unknown'));

  const unknown = map({
    version: {
      revision: 1,
      status: 'facts_ready',
      generated_at: '2026-11-11T02:00:00.000Z',
      body_present: false,
      knowledge_status: 'queued',
      body_run_id: '8002',
      body_error_code: null,
      body_attempts: 1,
    },
    bodyRun: { id: '8002', status: 'mystery', error_code: null },
    bodyJob: null,
    delivery: null,
    message: null,
  });
  assert.equal(unknown.body.state, 'unknown');
  assert.equal(unknown.overall, 'unknown');
});

test('revoked access, conversation, project or followup makes the run unavailable', () => {
  const variants: SnapshotOptions[] = [
    { binding: { ...snapshot().binding!, status: 'stopped' } },
    { binding: { ...snapshot().binding!, audience: 'worker' } },
    { project: { ...snapshot().project!, customer_access: false } },
    { project: null },
    { conversation: null },
    { conversation: { ...snapshot().conversation!, retention_redacted: true } },
    { followup_available: false },
  ];
  for (const variant of variants) {
    const progress = map(variant);
    assert.equal(progress.availability.state, 'access_revoked');
    assert.equal(progress.overall, 'unavailable');
    assert.equal(progress.completed, false);
    assert.ok(progress.reasons.includes('access_revoked'));
  }
});

test('facts ready with no still-valid source project is source_unavailable', () => {
  const empty = map({ source_project_ids: [] });
  assert.equal(empty.facts.state, 'ready');
  assert.equal(empty.availability.state, 'source_unavailable');
  assert.equal(empty.overall, 'unavailable');
  assert.ok(empty.reasons.includes('source_unavailable'));

  const foreign = map({ source_project_ids: ['9999'] });
  assert.equal(foreign.availability.state, 'source_unavailable');
  assert.equal(foreign.overall, 'unavailable');
});

test('report, version and facts rows that do not match the binding stay unknown', () => {
  const cases: Array<{ overrides: SnapshotOptions; reason: string }> = [
    { overrides: { report: { ...snapshot().report!, id: '9999' } }, reason: 'report_binding_mismatch' },
    { overrides: { report: { ...snapshot().report!, kind: 'weekly' } }, reason: 'report_binding_mismatch' },
    {
      overrides: { report: { ...snapshot().report!, period_end: '2026-11-11T16:00:00.000Z' } },
      reason: 'report_binding_mismatch',
    },
    {
      overrides: { version: { ...snapshot().version!, revision: 2 } },
      reason: 'version_binding_mismatch',
    },
    {
      overrides: { factsRun: { id: '9999', status: 'succeeded', error_code: null } },
      reason: 'facts_binding_mismatch',
    },
  ];
  for (const entry of cases) {
    const progress = map(entry.overrides);
    assert.equal(progress.overall, 'unknown');
    assert.equal(progress.completed, false);
    assert.equal(progress.processing, false);
    assert.ok(progress.reasons.includes(entry.reason));
    // A mismatched row is never projected as this run's state.
    assert.equal(progress.facts.state, 'unknown');
  }
});

test('a workflow run failure never overrides a business completion', () => {
  const record = makeRecord({
    status: 'failed',
    runError: {
      code: 'delivery_not_confirmed',
      path: '$',
      message: 'the worker has not confirmed delivery yet',
    },
  });
  const progress = map({}, record);
  assert.equal(progress.overall, 'completed');
  assert.equal(progress.completed, true);
});

// ---------------------------------------------------------------------------
// reader
// ---------------------------------------------------------------------------

test('the reader is repeatable and never rewrites the run file', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'period-report-status-'));
  const runId = 'run-period-reader';
  try {
    const store = createFileWorkflowRunStore({ rootDir: dir });
    const record = makeRecord({ runId });
    await store.create(record);
    const runFile = path.join(dir, 'runs', `${runId}.json`);
    const before = await readFile(runFile, 'utf8');
    const beforeEntries = await readdir(path.join(dir, 'runs'));

    let loads = 0;
    const loadSnapshot = async () => {
      loads += 1;
      return snapshot();
    };
    const options = {
      runId,
      viewer: { enterpriseId: ENTERPRISE, adminId: ADMIN },
      runStore: store,
      loadSnapshot,
      now: () => new Date(NOW),
    };

    const first = await readPeriodReportRunStatus(options);
    const second = await readPeriodReportRunStatus(options);

    assert.equal(loads, 2);
    assert.equal(first.bound, true);
    assert.equal(first.contract, 'period-report-run-status-v1');
    assert.equal(first.observedAt, NOW);
    assert.equal(first.binding?.projectName, '测试项目');
    assert.equal(first.progress?.overall, 'completed');
    assert.deepEqual(second.binding, first.binding);
    assert.deepEqual(second.progress, first.progress);
    assert.deepEqual(second.raw, first.raw);
    assert.deepEqual(second.reasons, first.reasons);

    assert.equal(await readFile(runFile, 'utf8'), before);
    assert.deepEqual(await readdir(path.join(dir, 'runs')), beforeEntries);

    const raw = await readPeriodReportRunStatus({
      ...options,
      loadSnapshot: async () => snapshot(),
    });
    assert.equal(raw.raw.status, record.status);
    assert.equal(raw.raw.updatedAt, record.updatedAt);
    assert.equal(raw.raw.operations[0]?.capabilityRef, 'save.period_report');
    assert.equal(raw.raw.operations[0]?.outcome, 'succeeded');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the reader keeps a failed workflow run in raw while the business status completes', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'period-report-status-raw-'));
  const runId = 'run-period-raw';
  try {
    const store = createFileWorkflowRunStore({ rootDir: dir });
    await store.create(makeRecord({
      runId,
      status: 'failed',
      runError: {
        code: 'delivery_not_confirmed',
        path: '$',
        message: 'delivery not confirmed yet',
      },
    }));

    const observation = await readPeriodReportRunStatus({
      runId,
      viewer: { enterpriseId: ENTERPRISE, adminId: ADMIN },
      runStore: store,
      loadSnapshot: async () => snapshot(),
      now: () => new Date(NOW),
    });

    assert.equal(observation.progress?.overall, 'completed');
    assert.equal(observation.raw.status, 'failed');
    assert.equal(observation.raw.errorCode, 'delivery_not_confirmed');
    assert.equal(observation.raw.errorMessage, 'delivery not confirmed yet');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the reader refuses a run from another viewer enterprise with 403', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'period-report-status-tenant-'));
  const runId = 'run-period-tenant';
  try {
    const store = createFileWorkflowRunStore({ rootDir: dir });
    await store.create(makeRecord({ runId }));

    await assert.rejects(
      () => readPeriodReportRunStatus({
        runId,
        viewer: { enterpriseId: '9999', adminId: ADMIN },
        runStore: store,
        loadSnapshot: async () => snapshot(),
        now: () => new Date(NOW),
      }),
      (error: unknown) => error instanceof WorkflowOperationError
        && error.code === 'run_enterprise_forbidden'
        && error.status === 403,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a failed snapshot read is unknown and visibly carries read_error', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'period-report-status-read-'));
  const runId = 'run-period-read-error';
  try {
    const store = createFileWorkflowRunStore({ rootDir: dir });
    await store.create(makeRecord({ runId }));

    const observation = await readPeriodReportRunStatus({
      runId,
      viewer: { enterpriseId: ENTERPRISE, adminId: ADMIN },
      runStore: store,
      loadSnapshot: async () => {
        throw new Error('connection reset');
      },
      now: () => new Date(NOW),
    });

    assert.equal(observation.bound, true);
    assert.equal(observation.progress?.overall, 'unknown');
    assert.equal(observation.progress?.completed, false);
    assert.equal(observation.progress?.availability.state, 'unknown');
    assert.equal(observation.progress?.availability.reason, 'read_error');
    assert.ok(observation.progress?.reasons.includes('read_error'));
    assert.deepEqual(observation.reasons, observation.progress?.reasons);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('an unconfirmed save returns an unbound observation without querying business rows', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'period-report-status-unbound-'));
  const runId = 'run-period-unbound';
  try {
    const store = createFileWorkflowRunStore({ rootDir: dir });
    await store.create(makeRecord({ runId, saveReceipt: null }));

    let loads = 0;
    const observation = await readPeriodReportRunStatus({
      runId,
      viewer: { enterpriseId: ENTERPRISE, adminId: ADMIN },
      runStore: store,
      loadSnapshot: async () => {
        loads += 1;
        return snapshot();
      },
      now: () => new Date(NOW),
    });

    assert.equal(loads, 0);
    assert.equal(observation.bound, false);
    assert.equal(observation.binding, null);
    assert.equal(observation.progress, null);
    assert.ok(observation.reasons.includes('save_receipt_missing'));
    assert.equal(observation.raw.status, 'completed');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a missing run is a 404 run_not_found', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'period-report-status-missing-'));
  try {
    const store = createFileWorkflowRunStore({ rootDir: dir });
    await assert.rejects(
      () => readPeriodReportRunStatus({
        runId: 'run-does-not-exist',
        viewer: { enterpriseId: ENTERPRISE, adminId: ADMIN },
        runStore: store,
        loadSnapshot: async () => snapshot(),
        now: () => new Date(NOW),
      }),
      (error: unknown) => error instanceof WorkflowOperationError
        && error.code === 'run_not_found'
        && error.status === 404,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
