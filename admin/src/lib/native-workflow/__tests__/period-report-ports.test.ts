import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PostgresTransaction } from '@/db/transaction';
import { AssistantError, fingerprint } from '@/lib/assistant/contracts';
import type { ConstructionActor } from '@/lib/construction/contracts';
import type { PendingOperation, TriggerEvent, WorkflowValue } from '../types';
import {
  parseFixedDailyPeriod,
  parseFixedPeriod,
  periodReportKey,
  type FixedPeriod,
} from '../live/period-event';
import {
  createPeriodReportPorts,
  createPeriodReportStore,
  type PeriodDeliveryRecord,
  type PeriodRecordRead,
  type PeriodReportPhoto,
  type PeriodReportScope,
  type PeriodReportStore,
  type PeriodReportStoreDependencies,
  type StoredPeriodReport,
} from '../live/period-report-ports';
import {
  LiveOperationFailure,
  LiveOperationUnknownError,
  type LivePeriodReceiver,
  type LiveRunContext,
} from '../live/types';

const event: TriggerEvent = {
  eventId: 'b5-daily-20261110',
  eventType: 'period_report',
  occurredAt: '2026-11-11T02:00:00.000Z',
  periodKind: 'daily',
  periodStart: '2026-11-10',
  periodEnd: '2026-11-10',
};

const actor: ConstructionActor = { enterpriseId: '1454', adminId: '1454000007' };
const WORKER_ADMIN = '1454000008';
const workerReceiver: LivePeriodReceiver = { kind: 'worker', adminId: WORKER_ADMIN };

/** Trusted clock after the fixed 2026-11-10 Shanghai day has ended. */
const AFTER_PERIOD = new Date('2026-11-11T02:00:00.000Z');

/** Complete Shanghai week: Monday 2026-11-02 to Monday 2026-11-09, right-open. */
const weeklyEvent: TriggerEvent = {
  eventId: 'b5-weekly-20261109',
  eventType: 'period_report',
  occurredAt: '2026-11-09T02:00:00.000Z',
  periodKind: 'weekly',
  periodStart: '2026-11-02',
  periodEnd: '2026-11-09',
};

/** Exclusive end of the 2026-11-02..2026-11-09 Shanghai week. */
const WEEKLY_END = new Date('2026-11-08T16:00:00.000Z');
const WEEKLY_INPUT = {
  periodKind: 'weekly',
  periodStart: '2026-11-02',
  periodEnd: '2026-11-09',
};

function context(runId = 'b5-run-1', revision = 1): LiveRunContext {
  return {
    runId,
    definitionId: 'period-report-daily',
    revision,
    digest: 'a'.repeat(64),
    nodeVersions: { 'trigger-1': 'trigger@1/trigger.period_report' },
    event,
    businessEvent: {
      outboxEventId: null,
      progressRevision: 0,
      stageKey: '',
      settingsVersion: 1,
      source: 'current_project_revision',
    },
    enterpriseId: actor.enterpriseId,
    projectId: '1455',
  };
}

function contextWithReceiver(receiver: LivePeriodReceiver, runId = 'b5-run-1'): LiveRunContext {
  const base = context(runId);
  return {
    ...base,
    businessEvent: { ...base.businessEvent, receiver },
  };
}

function operation(
  capabilityRef: string,
  input: Record<string, WorkflowValue> = {},
  nodeId = capabilityRef.replace(/\W/g, '-'),
): PendingOperation {
  const effect: PendingOperation['effect'] = capabilityRef.startsWith('read.')
    ? 'read'
    : capabilityRef.startsWith('save.')
      ? 'save'
      : capabilityRef.startsWith('deliver.')
        ? 'deliver'
        : 'compose';
  const nodeType: PendingOperation['nodeType'] = effect === 'read'
    ? 'read_materials'
    : effect === 'save'
      ? 'save_result'
      : effect === 'deliver'
        ? 'deliver_inapp'
        : 'compose_content';
  return {
    nodeId,
    nodeType,
    capabilityRef,
    nodeVersion: `${capabilityRef}@1`,
    effect,
    input,
    mode: 'live',
    simulation: false,
    idempotencyKey: `idem:${nodeId}`,
  };
}

function scope(overrides: Partial<PeriodReportScope> = {}): PeriodReportScope {
  const period = parseFixedDailyPeriod(event, AFTER_PERIOD);
  return {
    enterpriseId: actor.enterpriseId,
    projectId: '1455',
    projectName: '测试项目',
    bindingId: '9001',
    conversationId: '7001',
    receiverKind: 'customer',
    receiverAdminId: null,
    receiverUserId: '1454000002',
    bindingAudience: 'customer',
    reportKey: periodReportKey(period, { id: '7001' }),
    legacyPlanEnabled: true,
    legacyScheduleDue: false,
    audienceEnabled: true,
    receiverAvailable: true,
    receiverStatus: 'available',
    ...overrides,
  };
}

function workerScope(overrides: Partial<PeriodReportScope> = {}): PeriodReportScope {
  const period = parseFixedDailyPeriod(event, AFTER_PERIOD);
  return scope({
    bindingId: '9002',
    conversationId: '7002',
    receiverKind: 'worker',
    receiverAdminId: WORKER_ADMIN,
    receiverUserId: null,
    bindingAudience: 'worker',
    reportKey: periodReportKey(period, { id: '7002' }),
    ...overrides,
  });
}

function storedReport(current: PeriodReportScope, reused = false): StoredPeriodReport {
  return {
    reportId: '5001',
    revision: 1,
    runId: '8001',
    conversationId: current.conversationId!,
    reportKey: current.reportKey,
    reused,
  };
}

function weeklyContext(runId = 'b5-run-weekly', revision = 1): LiveRunContext {
  return { ...context(runId, revision), event: weeklyEvent };
}

function weeklyScope(): PeriodReportScope {
  const period = parseFixedPeriod(weeklyEvent, WEEKLY_END);
  return scope({ reportKey: periodReportKey(period, { id: '7001' }) });
}

interface FakeState {
  scope: PeriodReportScope;
  existing: StoredPeriodReport | null;
  /** Durable row observed by the post-conflict re-read inside the same save. */
  raced: StoredPeriodReport | null;
  queued: StoredPeriodReport | null;
  records: PeriodRecordRead;
  photos: readonly PeriodReportPhoto[];
  delivery: PeriodDeliveryRecord | null;
  enqueueError: Error | null;
  enqueueCalls: FixedPeriod[];
  enqueueProjects: string[];
  scopeReceivers: LivePeriodReceiver[];
  enqueueReceivers: LivePeriodReceiver[];
  findCalls: number;
  recordCalls: number;
  photoCalls: number;
  deliveryCalls: number;
}

function fakeStore(initial: Partial<FakeState> = {}) {
  const base = scope();
  const state: FakeState = {
    scope: base,
    existing: null,
    raced: null,
    queued: storedReport(base),
    records: { records: [], truncated: false },
    photos: [],
    delivery: null,
    enqueueError: null,
    enqueueCalls: [],
    enqueueProjects: [],
    scopeReceivers: [],
    enqueueReceivers: [],
    findCalls: 0,
    recordCalls: 0,
    photoCalls: 0,
    deliveryCalls: 0,
    ...initial,
  };
  const store: PeriodReportStore = {
    async loadScope({ receiver }) {
      state.scopeReceivers.push(receiver);
      return state.scope;
    },
    async findReport() {
      state.findCalls += 1;
      // The first read is the pre-check; a later read is the post-conflict
      // re-read after `enqueue` returned null.
      return state.findCalls === 1 ? state.existing : (state.raced ?? state.existing);
    },
    async enqueue({ projectId, period, receiver }) {
      state.enqueueCalls.push(period);
      state.enqueueProjects.push(projectId);
      state.enqueueReceivers.push(receiver);
      if (state.enqueueError) throw state.enqueueError;
      return state.queued;
    },
    async readRecords() {
      state.recordCalls += 1;
      return state.records;
    },
    async readPhotos() {
      state.photoCalls += 1;
      return state.photos;
    },
    async readDelivery() {
      state.deliveryCalls += 1;
      return state.delivery;
    },
  };
  return { state, store };
}

function isFailure(code: string) {
  return (error: unknown) => error instanceof LiveOperationFailure && error.issue.code === code;
}

test('daily period is one fixed Shanghai day and rejects spans or other kinds', () => {
  const period = parseFixedDailyPeriod(event, AFTER_PERIOD);
  assert.equal(period.kind, 'daily');
  assert.equal(period.start.toISOString(), '2026-11-09T16:00:00.000Z');
  assert.equal(period.end.toISOString(), '2026-11-10T16:00:00.000Z');
  assert.equal(period.cutoff.toISOString(), period.end.toISOString());
  assert.equal(period.scheduledAt.toISOString(), event.occurredAt);

  assert.throws(
    () => parseFixedDailyPeriod({ ...event, periodEnd: '2026-11-11' }),
    (error: unknown) => (error as { code?: string }).code === 'period_event_invalid',
  );
  assert.throws(
    () => parseFixedDailyPeriod({ ...event, periodStart: '2026-02-30', periodEnd: '2026-02-30' }),
    (error: unknown) => (error as { code?: string }).code === 'period_event_invalid',
  );
  assert.throws(
    () => parseFixedDailyPeriod({ ...event, periodKind: 'weekly' }),
    (error: unknown) => (error as { code?: string }).code === 'period_kind_unsupported',
  );
});

test('report_key matches enqueueReport and is independent of run identity', () => {
  const period = parseFixedDailyPeriod(event, AFTER_PERIOD);
  const expected = fingerprint({
    kind: 'daily',
    start: period.start.toISOString(),
    end: period.end.toISOString(),
    event: null,
  });
  assert.equal(periodReportKey(period, null), expected);
  assert.equal(periodReportKey(period, { id: '7001' }), expected);
  assert.notEqual(
    periodReportKey(period, { id: '7001', followupGeneration: 2 }),
    expected,
  );
  assert.equal(
    periodReportKey(period, { id: '7001', followupGeneration: 2 }),
    periodReportKey(period, { id: '7001', followupGeneration: 3 }),
  );
  const nextDay = parseFixedDailyPeriod({
    ...event,
    periodStart: '2026-11-11',
    periodEnd: '2026-11-11',
  }, new Date('2026-11-12T00:00:00.000Z'));
  assert.notEqual(periodReportKey(nextDay, null), expected);
});

test('save enqueues the real lifecycle record with a live receipt', async () => {
  const { state, store } = fakeStore();
  const ports = createPeriodReportPorts({ actor, store });
  const result = await ports.execute(operation('save.period_report', { title: 't', body: 'b' }), context());

  assert.equal(result.saved, true);
  const receipt = result.saveReceipt as Record<string, unknown>;
  assert.equal(receipt.simulated, false);
  assert.equal(receipt.reportId, '5001');
  assert.equal(receipt.revision, 1);
  assert.equal(receipt.runId, '8001');
  assert.equal(receipt.reportKey, state.scope.reportKey);
  assert.equal(receipt.reused, false);
  assert.equal(receipt.receiverKind, 'customer');
  assert.equal(receipt.receiverAdminId, null);
  assert.deepEqual(receipt.projectScope, ['1455']);
  assert.match(String(receipt.receiptId), /^report:5001:1$/);
  assert.deepEqual(state.scopeReceivers, [{ kind: 'customer' }]);
  assert.deepEqual(state.enqueueReceivers, [{ kind: 'customer' }]);
  assert.equal(state.enqueueCalls.length, 1);
  assert.equal(state.enqueueProjects[0], '1455');
  assert.equal(state.enqueueCalls[0]!.start.toISOString(), '2026-11-09T16:00:00.000Z');
  assert.equal(state.enqueueCalls[0]!.end.toISOString(), '2026-11-10T16:00:00.000Z');
});

test('a repeated run for the same day reuses the same report/version/run', async () => {
  const { state, store } = fakeStore();
  const ports = createPeriodReportPorts({ actor, store });
  const first = await ports.execute(operation('save.period_report'), context('b5-run-a', 1));

  // Simulate the durable row created by the first run; a second runId or a
  // newer published revision must not be part of the business key.
  state.existing = storedReport(state.scope, true);
  state.queued = null;
  const second = await ports.execute(operation('save.period_report'), context('b5-run-b', 2));

  const a = first.saveReceipt as Record<string, unknown>;
  const b = second.saveReceipt as Record<string, unknown>;
  assert.equal(state.enqueueCalls.length, 1);
  assert.equal(a.reportId, b.reportId);
  assert.equal(a.revision, b.revision);
  assert.equal(a.runId, b.runId);
  assert.equal(a.reportKey, b.reportKey);
  assert.equal(a.reused, false);
  assert.equal(b.reused, true);
});

test('a concurrent enqueue conflict keeps the real reuse flag and row identity', async () => {
  const { state, store } = fakeStore();
  // The durable insert lost the race, so the store returns the existing row
  // already marked reused. The adapter must not relabel it as a new report.
  state.queued = storedReport(state.scope, true);
  const ports = createPeriodReportPorts({ actor, store });
  const result = await ports.execute(operation('save.period_report'), context('b5-run-race', 3));

  assert.equal(result.saved, true);
  const receipt = result.saveReceipt as Record<string, unknown>;
  assert.equal(receipt.simulated, false);
  assert.equal(receipt.reused, true);
  assert.equal(receipt.reportId, '5001');
  assert.equal(receipt.revision, 1);
  assert.equal(receipt.runId, '8001');
  assert.match(String(receipt.receiptId), /^report:5001:1$/);
  assert.equal(state.enqueueCalls.length, 1);
});

test('an enqueue conflict finds the raced row, otherwise fails without inventing success', async () => {
  const raced = fakeStore();
  raced.state.queued = null;
  raced.state.raced = storedReport(raced.state.scope, true);
  const racedPorts = createPeriodReportPorts({ actor, store: raced.store });
  const result = await racedPorts.execute(operation('save.period_report'), context('b5-run-race-a', 1));
  assert.equal(result.saved, true);
  assert.equal((result.saveReceipt as Record<string, unknown>).reused, true);
  assert.equal(raced.state.findCalls, 2);
  assert.equal(raced.state.enqueueCalls.length, 1);

  const lost = fakeStore();
  lost.state.queued = null;
  const lostPorts = createPeriodReportPorts({ actor, store: lost.store });
  await assert.rejects(
    () => lostPorts.execute(operation('save.period_report'), context('b5-run-race-b', 1)),
    isFailure('period_report_not_queued'),
  );
  assert.equal(lost.state.enqueueCalls.length, 1);
});

test('delivery cannot claim success for a disabled plan or a missing receiver', async () => {
  const disabled = fakeStore({
    scope: scope({ legacyPlanEnabled: false, legacyScheduleDue: false }),
  });
  const disabledPorts = createPeriodReportPorts({ actor, store: disabled.store });
  await assert.rejects(
    () => disabledPorts.execute(operation('deliver.inapp', { receivers: {} }), context()),
    isFailure('period_report_plan_disabled'),
  );
  assert.equal(disabled.state.deliveryCalls, 0);

  const revoked = fakeStore({
    scope: scope({ receiverAvailable: false, receiverStatus: 'customer_access_revoked' }),
  });
  const revokedPorts = createPeriodReportPorts({ actor, store: revoked.store });
  const result = await revokedPorts.execute(operation('deliver.inapp', { receivers: {} }), context());
  assert.equal(result.delivered, false);
  const receipt = result.deliveryReceipt as Record<string, unknown>;
  assert.equal(receipt.simulated, false);
  assert.equal(receipt.status, 'customer_access_revoked');
  assert.equal(receipt.receiptId, '');
  assert.equal(revoked.state.deliveryCalls, 0);
});

test('a still-due legacy schedule refuses the B period before any enqueue', async () => {
  const { state, store } = fakeStore({
    scope: scope({ legacyPlanEnabled: true, legacyScheduleDue: true }),
  });
  const ports = createPeriodReportPorts({ actor, store });

  await assert.rejects(
    () => ports.execute(operation('save.period_report'), context()),
    isFailure('period_report_legacy_scheduler_due'),
  );
  await assert.rejects(
    () => ports.execute(operation('deliver.inapp', { receivers: {} }), context()),
    isFailure('period_report_legacy_scheduler_due'),
  );
  assert.equal(state.enqueueCalls.length, 0);
});

test('a parked plan with no due legacy schedule is the single active path', async () => {
  const { state, store } = fakeStore({
    scope: scope({ legacyPlanEnabled: true, legacyScheduleDue: false }),
  });
  const ports = createPeriodReportPorts({ actor, store });
  const saved = await ports.execute(operation('save.period_report'), context());
  assert.equal(saved.saved, true);
  assert.equal(state.enqueueCalls.length, 1);
});

test('a disabled plan refuses because the worker would not process the task', async () => {
  const { state, store } = fakeStore({
    scope: scope({ legacyPlanEnabled: false, legacyScheduleDue: false }),
  });
  const ports = createPeriodReportPorts({ actor, store });
  await assert.rejects(
    () => ports.execute(operation('save.period_report'), context()),
    isFailure('period_report_plan_disabled'),
  );
  assert.equal(state.enqueueCalls.length, 0);
});

test('a missing or revoked owner receiver never creates a report task', async () => {
  const revoked = fakeStore({
    scope: scope({ receiverAvailable: false, receiverStatus: 'customer_access_revoked' }),
  });
  const ports = createPeriodReportPorts({ actor, store: revoked.store });
  await assert.rejects(
    () => ports.execute(operation('save.period_report'), context()),
    isFailure('period_report_receiver_unavailable'),
  );
  assert.equal(revoked.state.enqueueCalls.length, 0);
  const receivers = await ports.execute(operation('read.receiver_scope'), context());
  assert.equal(receivers.receiverCount, 0);
  assert.equal(
    (receivers.receivers as Record<string, unknown>).status,
    'customer_access_revoked',
  );

  const disabled = fakeStore({
    scope: scope({ receiverAvailable: false, receiverStatus: 'audience_disabled', audienceEnabled: false }),
  });
  const disabledPorts = createPeriodReportPorts({ actor, store: disabled.store });
  await assert.rejects(
    () => disabledPorts.execute(operation('save.period_report'), context()),
    isFailure('period_report_audience_disabled'),
  );
});

test('known and unknown store failures map without inventing success', async () => {
  const known = fakeStore({ enqueueError: new AssistantError('period_report_plan_missing', 422) });
  const knownPorts = createPeriodReportPorts({ actor, store: known.store });
  await assert.rejects(
    () => knownPorts.execute(operation('save.period_report'), context()),
    isFailure('period_report_plan_missing'),
  );

  const unknown = fakeStore({ enqueueError: new Error('connection reset') });
  const unknownPorts = createPeriodReportPorts({ actor, store: unknown.store });
  await assert.rejects(
    () => unknownPorts.execute(operation('save.period_report'), context()),
    (error: unknown) => error instanceof LiveOperationUnknownError
      && error.issue.code === 'live_operation_unknown',
  );
});

test('period inputs may not diverge from the fixed run event', async () => {
  const { state, store } = fakeStore();
  const ports = createPeriodReportPorts({ actor, store });
  await assert.rejects(
    () => ports.execute(
      operation('read.period_records', {
        periodKind: 'daily',
        periodStart: '2026-11-09',
        periodEnd: '2026-11-10',
      }),
      context(),
    ),
    isFailure('period_binding_mismatch'),
  );
  assert.equal(state.recordCalls, 0);
});

test('records, photos and receiver scope come from the authorized reads', async () => {
  const record = {
    projectId: '1455',
    recordId: '6101',
    version: 2,
    source: 'construction_record' as const,
    occurredAt: '2026-11-10T06:00:00.000Z',
    room: '客厅',
    title: '水电',
    completed: '布管完成',
    pending: '',
    coordination: '',
    note: '',
  };
  const photo = {
    projectId: '1455',
    recordId: '6101',
    version: 2,
    photoId: '7101',
    width: 1080,
    height: 1440,
  };
  const { state, store } = fakeStore({
    records: { records: [record], truncated: false },
    photos: [photo],
  });
  const ports = createPeriodReportPorts({ actor, store });
  const input = { periodKind: 'daily', periodStart: '2026-11-10', periodEnd: '2026-11-10' };

  const read = await ports.execute(operation('read.period_records', input), context());
  assert.equal(read.recordCount, 1);
  assert.equal(read.hasRecords, true);
  assert.deepEqual(read.records, [record]);

  const photos = await ports.execute(operation('read.authorized_photos', input), context());
  assert.equal(photos.photoCount, 1);
  assert.deepEqual(photos.photos, [photo]);
  // Photos reuse the records read by the previous node; no second facts pass.
  assert.equal(state.recordCalls, 1);
  assert.equal(state.photoCalls, 1);

  const receivers = await ports.execute(operation('read.receiver_scope'), context());
  assert.equal(receivers.receiverCount, 1);
  assert.deepEqual(receivers.receivers, {
    scope: 'project_customer',
    projectId: '1455',
    bindingId: '9001',
    conversationId: '7001',
    customerUserId: '1454000002',
    audience: 'customer',
  });

  const composed = await ports.execute(
    operation('compose.period_report', {
      ...input,
      records: read.records as WorkflowValue,
      photos: photos.photos as WorkflowValue,
      recordCount: 1,
      photoCount: 1,
    }),
    context(),
  );
  assert.equal(composed.title, '施工日报 · 2026-11-10');
  assert.match(String(composed.body), /1 条进展、获权照片 1 张/);
  assert.deepEqual(composed.missingItems, []);
});

test('a weekly period completes the existing read/compose/save/deliver flow', async () => {
  const record = {
    projectId: '1455',
    recordId: '6201',
    version: 3,
    source: 'construction_record' as const,
    occurredAt: '2026-11-05T06:00:00.000Z',
    room: '客厅',
    title: '墙面开槽',
    completed: '开槽完成',
    pending: '',
    coordination: '',
    note: '',
  };
  const photo = {
    projectId: '1455',
    recordId: '6201',
    version: 3,
    photoId: '7201',
    width: 1080,
    height: 1440,
  };
  const { state, store } = fakeStore({
    scope: weeklyScope(),
    queued: storedReport(weeklyScope()),
    records: { records: [record], truncated: false },
    photos: [photo],
    delivery: {
      state: 'delivered',
      messageId: '8101',
      conversationId: '7001',
      deliveredAt: '2026-11-09T16:05:00.000Z',
      messagePurpose: 'construction.report.facts',
    },
  });
  const ports = createPeriodReportPorts({ actor, store, now: () => WEEKLY_END });

  const read = await ports.execute(operation('read.period_records', WEEKLY_INPUT), weeklyContext());
  assert.equal(read.recordCount, 1);
  assert.equal(read.hasRecords, true);

  const photos = await ports.execute(
    operation('read.authorized_photos', WEEKLY_INPUT),
    weeklyContext(),
  );
  assert.equal(photos.photoCount, 1);

  const receivers = await ports.execute(operation('read.receiver_scope'), weeklyContext());
  assert.equal(receivers.receiverCount, 1);

  const composed = await ports.execute(
    operation('compose.period_report', {
      ...WEEKLY_INPUT,
      records: read.records as WorkflowValue,
      photos: photos.photos as WorkflowValue,
      recordCount: 1,
      photoCount: 1,
    }),
    weeklyContext(),
  );
  assert.equal(composed.title, '施工周报 · 2026-11-02 ~ 2026-11-09');
  assert.match(String(composed.body), /1 条进展、获权照片 1 张/);

  const saved = await ports.execute(operation('save.period_report'), weeklyContext());
  assert.equal(saved.saved, true);
  const savedReceipt = saved.saveReceipt as Record<string, unknown>;
  assert.equal(savedReceipt.simulated, false);
  assert.equal(savedReceipt.reportKey, state.scope.reportKey);
  assert.equal(savedReceipt.reused, false);
  assert.equal(state.enqueueCalls.length, 1);
  assert.equal(state.enqueueProjects[0], '1455');
  const period = state.enqueueCalls[0]!;
  assert.equal(period.kind, 'weekly');
  assert.equal(period.start.toISOString(), '2026-11-01T16:00:00.000Z');
  assert.equal(period.end.toISOString(), '2026-11-08T16:00:00.000Z');
  assert.equal(period.cutoff.toISOString(), period.end.toISOString());
  assert.equal(period.scheduledAt.toISOString(), weeklyEvent.occurredAt);

  // A repeated run for the same week reuses the durable report; no second task.
  state.existing = storedReport(weeklyScope(), true);
  state.queued = null;
  const repeated = await ports.execute(
    operation('save.period_report'),
    weeklyContext('b5-run-weekly-b', 2),
  );
  const repeatedReceipt = repeated.saveReceipt as Record<string, unknown>;
  assert.equal(repeatedReceipt.reused, true);
  assert.equal(repeatedReceipt.reportKey, savedReceipt.reportKey);
  assert.equal(state.enqueueCalls.length, 1);

  const delivered = await ports.execute(
    operation('deliver.inapp', { receivers: receivers.receivers as WorkflowValue }),
    weeklyContext(),
  );
  assert.equal(delivered.delivered, true);
  const deliveryReceipt = delivered.deliveryReceipt as Record<string, unknown>;
  assert.equal(deliveryReceipt.status, 'delivered');
  assert.equal(deliveryReceipt.messageId, '8101');
  assert.equal(deliveryReceipt.reportId, '5001');
});

test('delivery only reports a real, matching worker receipt', async () => {
  const { state, store } = fakeStore();
  const ports = createPeriodReportPorts({ actor, store });
  const saved = await ports.execute(operation('save.period_report'), context());
  assert.equal(saved.saved, true);
  const receivers = {
    scope: 'project_customer',
    projectId: '1455',
    bindingId: '9001',
    conversationId: '7001',
    customerUserId: '1454000002',
    audience: 'customer',
  };

  const missing = await ports.execute(operation('deliver.inapp', { receivers }), context());
  assert.equal(missing.delivered, false);
  const missingReceipt = missing.deliveryReceipt as Record<string, unknown>;
  assert.equal(missingReceipt.simulated, false);
  assert.equal(missingReceipt.status, 'not_enqueued');

  state.delivery = {
    state: 'pending',
    messageId: null,
    conversationId: null,
    deliveredAt: null,
    messagePurpose: null,
  };
  const pending = await ports.execute(operation('deliver.inapp', { receivers }), context());
  assert.equal(pending.delivered, false);
  assert.equal((pending.deliveryReceipt as Record<string, unknown>).status, 'pending');

  state.delivery = {
    state: 'delivered',
    messageId: '8101',
    conversationId: '7999',
    deliveredAt: '2026-11-11T02:05:00.000Z',
    messagePurpose: 'construction.report.facts',
  };
  const wrongConversation = await ports.execute(operation('deliver.inapp', { receivers }), context());
  assert.equal(wrongConversation.delivered, false);
  assert.equal(
    (wrongConversation.deliveryReceipt as Record<string, unknown>).status,
    'delivery_receipt_unconfirmed',
  );

  state.delivery = {
    state: 'delivered',
    messageId: '8101',
    conversationId: '7001',
    deliveredAt: '2026-11-11T02:05:00.000Z',
    messagePurpose: 'customer.message',
  };
  const wrongPurpose = await ports.execute(operation('deliver.inapp', { receivers }), context());
  assert.equal(wrongPurpose.delivered, false);

  state.delivery = {
    state: 'delivered',
    messageId: '8101',
    conversationId: '7001',
    deliveredAt: '2026-11-11T02:05:00.000Z',
    messagePurpose: 'construction.report.facts',
  };
  const delivered = await ports.execute(operation('deliver.inapp', { receivers }), context());
  assert.equal(delivered.delivered, true);
  const receipt = delivered.deliveryReceipt as Record<string, unknown>;
  assert.equal(receipt.simulated, false);
  assert.equal(receipt.status, 'delivered');
  assert.equal(receipt.messageId, '8101');
  assert.equal(receipt.conversationId, '7001');
  assert.equal(receipt.reportId, '5001');
  assert.equal(receipt.revision, 1);
  assert.match(String(receipt.receiptId), /^report-delivery:5001:1:9001$/);

  await assert.rejects(
    () => ports.execute(
      operation('deliver.inapp', { receivers: { ...receivers, conversationId: '7999' } }),
      context(),
    ),
    isFailure('receiver_scope_mismatch'),
  );
});

interface RecordedQuery {
  readonly text: string;
  readonly params: readonly unknown[];
}

/** Offline tenant transaction: records SQL text/params and returns canned rows. */
function fakeDatabase(respond: (query: RecordedQuery) => unknown[] | undefined) {
  const calls: RecordedQuery[] = [];
  const tx = {
    execute(query: { queryChunks?: unknown[] }) {
      let text = '';
      const params: unknown[] = [];
      for (const chunk of query.queryChunks ?? []) {
        if (typeof chunk === 'string') {
          text += `$${params.length + 1}`;
          params.push(chunk);
        } else if (Array.isArray((chunk as { value?: unknown[] })?.value)) {
          text += (chunk as { value: string[] }).value.join('');
        } else {
          text += '?';
        }
      }
      const call: RecordedQuery = { text, params };
      calls.push(call);
      return Promise.resolve({ rows: respond(call) ?? [] });
    },
  } as unknown as PostgresTransaction;
  return { tx, calls };
}

const workerProjectRow = {
  id: '1455',
  name: '测试项目',
  status: 'active',
  current_stage_key: 'in_progress',
  customer_access: false,
};

const workerSettings = {
  enabled: true,
  audiences: ['worker'],
  project_ids: ['1455'],
  stage_enabled: false,
  next_daily_at: '2999-01-01T00:00:00.000Z',
  next_weekly_at: '2999-01-01T00:00:00.000Z',
  version: 1,
};

const workerBindingRow = {
  id: '9002',
  audience: 'worker',
  admin_id: WORKER_ADMIN,
  user_id: null,
  project_id: null,
  scope_key: 'enterprise',
  status: 'enabled',
  conversation_id: '7002',
};

function workerResponder(overrides: {
  admin?: unknown[];
  member?: unknown[];
  access?: unknown[];
  followup?: unknown[];
} = {}) {
  return (query: RecordedQuery): unknown[] | undefined => {
    if (query.text.includes('construction_report_settings')) return [workerSettings];
    if (query.text.includes('construction_followup_bindings')) return [workerBindingRow];
    if (query.text.includes('assistant_followup_conversation_access')) {
      return overrides.followup ?? [{ allowed: true }];
    }
    if (query.text.includes('assistant_conversations')) return [{ id: '7002', entry_snapshot: {} }];
    if (query.text.includes('construction_members')) return overrides.member ?? [{ role: 'worker' }];
    if (query.text.includes('construction_followup_staff_access')) {
      return overrides.access ?? [{ role: 'worker' }];
    }
    if (query.text.includes('admin_users')) return overrides.admin ?? [{ id: WORKER_ADMIN }];
    return undefined;
  };
}

function workerPorts(respond: (query: RecordedQuery) => unknown[] | undefined) {
  const database = fakeDatabase(respond);
  const store = createPeriodReportStore({
    transaction: fakeTransaction({ count: 0 }, database.tx),
    authorizeWrite: async () => ({ owner: true, memberRole: null, project: workerProjectRow }),
  });
  return {
    ports: createPeriodReportPorts({
      actor,
      store,
      receiver: workerReceiver,
      now: () => AFTER_PERIOD,
    }),
    database,
  };
}

test('worker receiver resolves the enterprise staff binding without customer_access', async () => {
  const { ports, database } = workerPorts(workerResponder());
  const result = await ports.execute(
    operation('read.receiver_scope'),
    contextWithReceiver(workerReceiver),
  );

  assert.equal(result.receiverCount, 1);
  assert.deepEqual(result.receivers, {
    scope: 'enterprise_worker',
    projectId: '1455',
    bindingId: '9002',
    conversationId: '7002',
    workerAdminId: WORKER_ADMIN,
    audience: 'worker',
  });
  // The project keeps customer_access=false; a worker receiver never reads it.
  const bindingQuery = database.calls.find((call) => call.text.includes('construction_followup_bindings'));
  assert.ok(bindingQuery);
  assert.match(bindingQuery.text, /audience=\$3/);
  assert.match(bindingQuery.text, /project_id is null/);
  assert.match(bindingQuery.text, /scope_key='enterprise'/);
  assert.ok(bindingQuery.params.includes(`admin:${WORKER_ADMIN}`));
  assert.ok(bindingQuery.params.includes('worker'));
  const adminQuery = database.calls.find((call) => call.text.includes('admin_users'));
  assert.ok(adminQuery);
  assert.match(adminQuery.text, /role=\$3/);
  assert.ok(adminQuery.params.includes('construction_staff'));
  assert.match(adminQuery.text, /must_change_password=false/);
});

test('a worker without the fixed-project membership is receiver unavailable', async () => {
  // The SQL predicate already excludes observers; no row means no membership.
  const { ports } = workerPorts(workerResponder({ member: [] }));
  await assert.rejects(
    () => ports.execute(operation('save.period_report'), contextWithReceiver(workerReceiver)),
    isFailure('period_report_receiver_unavailable'),
  );

  const receivers = await ports.execute(
    operation('read.receiver_scope'),
    contextWithReceiver(workerReceiver),
  );
  assert.equal(receivers.receiverCount, 0);
  assert.equal(
    (receivers.receivers as Record<string, unknown>).status,
    'worker_unavailable',
  );
});

test('a worker plan must be exactly the fixed project', async () => {
  const period = parseFixedDailyPeriod(event, AFTER_PERIOD);
  for (const projectIds of [['1455', '1456'], []]) {
    const database = fakeDatabase((query) =>
      query.text.includes('construction_report_settings')
        ? [{ ...workerSettings, project_ids: projectIds }]
        : undefined);
    const store = createPeriodReportStore({
      transaction: fakeTransaction({ count: 0 }, database.tx),
      authorizeWrite: async () => ({ owner: true, memberRole: null, project: workerProjectRow }),
    });
    await assert.rejects(
      () => store.loadScope({
        actor,
        projectId: '1455',
        period,
        write: false,
        receiver: workerReceiver,
      }),
      (error: unknown) => error instanceof AssistantError
        && error.code === 'period_report_project_scope_mismatch',
    );
  }
});

test('an existing worker report must match the fixed project scope and generation', async () => {
  const period = parseFixedDailyPeriod(event, AFTER_PERIOD);
  const report = workerScope();
  const reportRow = {
    id: '5001',
    binding_id: '9002',
    kind: 'daily',
    period_start: period.start,
    period_end: period.end,
    latest_revision: 1,
  };
  const storeFor = (projectIds: string[], conversationId = '7002') => {
    const database = fakeDatabase((query) => {
      if (query.text.includes('construction_report_versions')) {
        return [{
          revision: 1,
          run_id: '8001',
          conversation_id: conversationId,
          policy_snapshot: { scope: { project_ids: projectIds } },
        }];
      }
      if (query.text.includes('construction_reports')) return [reportRow];
      return undefined;
    });
    return createPeriodReportStore({
      transaction: fakeTransaction({ count: 0 }, database.tx),
    });
  };

  await assert.rejects(
    () => storeFor(['9999']).findReport(report, period),
    (error: unknown) => error instanceof AssistantError
      && error.code === 'period_report_scope_conflict',
  );
  await assert.rejects(
    () => storeFor(['1455'], '7999').findReport(report, period),
    (error: unknown) => error instanceof AssistantError
      && error.code === 'period_report_generation_conflict',
  );

  const reused = await storeFor(['1455']).findReport(report, period);
  assert.equal(reused?.reused, true);
  assert.equal(reused?.reportId, '5001');
  assert.equal(reused?.conversationId, '7002');
});

test('a host receiver that diverges from the fixed run event is rejected', async () => {
  const { store } = fakeStore();
  const ports = createPeriodReportPorts({ actor, store, receiver: workerReceiver });
  await assert.rejects(
    () => ports.execute(
      operation('read.receiver_scope'),
      contextWithReceiver({ kind: 'customer' }),
    ),
    isFailure('receiver_binding_mismatch'),
  );

  // An absent business-event receiver keeps the legacy customer default.
  const customer = createPeriodReportPorts({ actor, store });
  const result = await customer.execute(operation('read.receiver_scope'), context());
  assert.equal(result.receiverCount, 1);
});

test('a worker report saves and delivers through the enterprise worker scope', async () => {
  const { state, store } = fakeStore({
    scope: workerScope(),
    queued: storedReport(workerScope()),
    delivery: {
      state: 'delivered',
      messageId: '8101',
      conversationId: '7002',
      deliveredAt: '2026-11-11T02:05:00.000Z',
      messagePurpose: 'construction.report.facts',
    },
  });
  const ports = createPeriodReportPorts({ actor, store, receiver: workerReceiver });

  const saved = await ports.execute(
    operation('save.period_report'),
    contextWithReceiver(workerReceiver),
  );
  assert.equal(saved.saved, true);
  const receipt = saved.saveReceipt as Record<string, unknown>;
  assert.equal(receipt.receiverKind, 'worker');
  assert.equal(receipt.receiverAdminId, WORKER_ADMIN);
  assert.deepEqual(receipt.projectScope, ['1455']);
  assert.deepEqual(state.scopeReceivers, [workerReceiver]);
  assert.deepEqual(state.enqueueReceivers, [workerReceiver]);

  const receivers = await ports.execute(
    operation('read.receiver_scope'),
    contextWithReceiver(workerReceiver),
  );
  assert.deepEqual(receivers.receivers, {
    scope: 'enterprise_worker',
    projectId: '1455',
    bindingId: '9002',
    conversationId: '7002',
    workerAdminId: WORKER_ADMIN,
    audience: 'worker',
  });

  const delivered = await ports.execute(
    operation('deliver.inapp', { receivers: receivers.receivers as WorkflowValue }),
    contextWithReceiver(workerReceiver),
  );
  assert.equal(delivered.delivered, true);
  const delivery = delivered.deliveryReceipt as Record<string, unknown>;
  assert.equal(delivery.status, 'delivered');
  assert.match(String(delivery.receiptId), /^report-delivery:5001:1:9002$/);
});

test('a customer delivery receiver object cannot deliver a worker scope', async () => {
  const { store } = fakeStore({
    scope: workerScope(),
    queued: storedReport(workerScope()),
  });
  const ports = createPeriodReportPorts({ actor, store, receiver: workerReceiver });
  await ports.execute(operation('save.period_report'), contextWithReceiver(workerReceiver));

  await assert.rejects(
    () => ports.execute(
      operation('deliver.inapp', {
        receivers: {
          scope: 'project_customer',
          projectId: '1455',
          bindingId: '9002',
          conversationId: '7002',
          customerUserId: '1454000002',
          audience: 'customer',
        },
      }),
      contextWithReceiver(workerReceiver),
    ),
    isFailure('receiver_scope_mismatch'),
  );
});

const DESIGNER_ADMIN = '1454000011';
const designerReceiver: LivePeriodReceiver = { kind: 'designer', adminId: DESIGNER_ADMIN };

function designerScope(overrides: Partial<PeriodReportScope> = {}): PeriodReportScope {
  const period = parseFixedDailyPeriod(event, AFTER_PERIOD);
  return scope({
    bindingId: '9003',
    conversationId: '7003',
    receiverKind: 'designer',
    receiverAdminId: DESIGNER_ADMIN,
    receiverUserId: null,
    bindingAudience: 'designer',
    reportKey: periodReportKey(period, { id: '7003' }),
    ...overrides,
  });
}

const designerSettings = {
  ...workerSettings,
  audiences: ['designer'],
};

const designerBindingRow = {
  id: '9003',
  audience: 'designer',
  admin_id: DESIGNER_ADMIN,
  user_id: null,
  project_id: null,
  scope_key: 'enterprise',
  status: 'enabled',
  conversation_id: '7003',
};

function designerResponder(overrides: {
  admin?: unknown[];
  member?: unknown[];
  access?: unknown[];
  followup?: unknown[];
  binding?: unknown[];
} = {}) {
  return (query: RecordedQuery): unknown[] | undefined => {
    if (query.text.includes('construction_report_settings')) return [designerSettings];
    if (query.text.includes('construction_followup_bindings')) {
      return overrides.binding ?? [designerBindingRow];
    }
    if (query.text.includes('assistant_followup_conversation_access')) {
      return overrides.followup ?? [{ allowed: true }];
    }
    if (query.text.includes('assistant_conversations')) return [{ id: '7003', entry_snapshot: {} }];
    if (query.text.includes('construction_members')) return overrides.member ?? [{ role: 'designer' }];
    if (query.text.includes('construction_followup_staff_access')) {
      return overrides.access ?? [{ role: 'worker' }];
    }
    if (query.text.includes('admin_users')) return overrides.admin ?? [{ id: DESIGNER_ADMIN }];
    return undefined;
  };
}

function designerPorts(respond: (query: RecordedQuery) => unknown[] | undefined) {
  const database = fakeDatabase(respond);
  const store = createPeriodReportStore({
    transaction: fakeTransaction({ count: 0 }, database.tx),
    authorizeWrite: async () => ({ owner: true, memberRole: null, project: workerProjectRow }),
  });
  return {
    ports: createPeriodReportPorts({
      actor,
      store,
      receiver: designerReceiver,
      now: () => AFTER_PERIOD,
    }),
    database,
  };
}

test('designer receiver resolves the enterprise designer binding without customer_access', async () => {
  const { ports, database } = designerPorts(designerResponder());
  const result = await ports.execute(
    operation('read.receiver_scope'),
    contextWithReceiver(designerReceiver),
  );

  assert.equal(result.receiverCount, 1);
  assert.deepEqual(result.receivers, {
    scope: 'enterprise_designer',
    projectId: '1455',
    bindingId: '9003',
    conversationId: '7003',
    designerAdminId: DESIGNER_ADMIN,
    audience: 'designer',
  });
  // The project keeps customer_access=false; a designer receiver never reads it.
  const bindingQuery = database.calls.find((call) => call.text.includes('construction_followup_bindings'));
  assert.ok(bindingQuery);
  assert.match(bindingQuery.text, /audience=\$3/);
  assert.match(bindingQuery.text, /project_id is null/);
  assert.match(bindingQuery.text, /scope_key='enterprise'/);
  assert.ok(bindingQuery.params.includes(`admin:${DESIGNER_ADMIN}`));
  assert.ok(bindingQuery.params.includes('designer'));
  const adminQuery = database.calls.find((call) => call.text.includes('admin_users'));
  assert.ok(adminQuery);
  assert.match(adminQuery.text, /role=\$3/);
  assert.ok(adminQuery.params.includes('designer'));
  assert.match(adminQuery.text, /must_change_password=false/);
});

test('a designer report saves and delivers through the enterprise designer scope', async () => {
  const { state, store } = fakeStore({
    scope: designerScope(),
    queued: storedReport(designerScope()),
    delivery: {
      state: 'delivered',
      messageId: '8103',
      conversationId: '7003',
      deliveredAt: '2026-11-11T02:05:00.000Z',
      messagePurpose: 'construction.report.facts',
    },
  });
  const ports = createPeriodReportPorts({ actor, store, receiver: designerReceiver });

  const saved = await ports.execute(
    operation('save.period_report'),
    contextWithReceiver(designerReceiver),
  );
  assert.equal(saved.saved, true);
  const receipt = saved.saveReceipt as Record<string, unknown>;
  assert.equal(receipt.receiverKind, 'designer');
  assert.equal(receipt.receiverAdminId, DESIGNER_ADMIN);
  assert.deepEqual(receipt.projectScope, ['1455']);
  assert.deepEqual(state.scopeReceivers, [designerReceiver]);
  assert.deepEqual(state.enqueueReceivers, [designerReceiver]);

  const receivers = await ports.execute(
    operation('read.receiver_scope'),
    contextWithReceiver(designerReceiver),
  );
  assert.deepEqual(receivers.receivers, {
    scope: 'enterprise_designer',
    projectId: '1455',
    bindingId: '9003',
    conversationId: '7003',
    designerAdminId: DESIGNER_ADMIN,
    audience: 'designer',
  });

  const delivered = await ports.execute(
    operation('deliver.inapp', { receivers: receivers.receivers as WorkflowValue }),
    contextWithReceiver(designerReceiver),
  );
  assert.equal(delivered.delivered, true);
  const delivery = delivered.deliveryReceipt as Record<string, unknown>;
  assert.equal(delivery.status, 'delivered');
  assert.match(String(delivery.receiptId), /^report-delivery:5001:1:9003$/);
});

test('a designer receiver without an active designer account is unavailable', async () => {
  // The admin query returns no row for a role mismatch (worker account).
  const { ports } = designerPorts(designerResponder({ admin: [] }));
  await assert.rejects(
    () => ports.execute(operation('save.period_report'), contextWithReceiver(designerReceiver)),
    isFailure('period_report_receiver_unavailable'),
  );

  const receivers = await ports.execute(
    operation('read.receiver_scope'),
    contextWithReceiver(designerReceiver),
  );
  assert.equal(receivers.receiverCount, 0);
  assert.equal(
    (receivers.receivers as Record<string, unknown>).status,
    'designer_unavailable',
  );
});

test('a customer delivery receiver object cannot deliver a designer scope', async () => {
  const { store } = fakeStore({
    scope: designerScope(),
    queued: storedReport(designerScope()),
  });
  const ports = createPeriodReportPorts({ actor, store, receiver: designerReceiver });
  await ports.execute(operation('save.period_report'), contextWithReceiver(designerReceiver));

  await assert.rejects(
    () => ports.execute(
      operation('deliver.inapp', {
        receivers: {
          scope: 'enterprise_worker',
          projectId: '1455',
          bindingId: '9003',
          conversationId: '7003',
          workerAdminId: DESIGNER_ADMIN,
          audience: 'worker',
        },
      }),
      contextWithReceiver(designerReceiver),
    ),
    isFailure('receiver_scope_mismatch'),
  );
});

const BOSS_ADMIN = '1454000013';
const bossReceiver: LivePeriodReceiver = { kind: 'boss', adminId: BOSS_ADMIN };

function bossScope(overrides: Partial<PeriodReportScope> = {}): PeriodReportScope {
  const period = parseFixedDailyPeriod(event, AFTER_PERIOD);
  return scope({
    bindingId: '9004',
    conversationId: '7004',
    receiverKind: 'boss',
    receiverAdminId: BOSS_ADMIN,
    receiverUserId: null,
    bindingAudience: 'boss',
    reportKey: periodReportKey(period, { id: '7004' }),
    ...overrides,
  });
}

const bossSettings = {
  ...workerSettings,
  audiences: ['boss'],
};

const bossBindingRow = {
  id: '9004',
  audience: 'boss',
  admin_id: BOSS_ADMIN,
  user_id: null,
  project_id: null,
  scope_key: 'enterprise',
  status: 'enabled',
  conversation_id: '7004',
};

function bossResponder(overrides: {
  admin?: unknown[];
  access?: unknown[];
  followup?: unknown[];
  binding?: unknown[];
  member?: unknown[];
} = {}) {
  return (query: RecordedQuery): unknown[] | undefined => {
    if (query.text.includes('construction_report_settings')) return [bossSettings];
    if (query.text.includes('construction_followup_bindings')) {
      return overrides.binding ?? [bossBindingRow];
    }
    if (query.text.includes('assistant_followup_conversation_access')) {
      return overrides.followup ?? [{ allowed: true }];
    }
    if (query.text.includes('assistant_conversations')) return [{ id: '7004', entry_snapshot: {} }];
    if (query.text.includes('construction_members')) return overrides.member ?? [];
    if (query.text.includes('construction_followup_staff_access')) {
      return overrides.access ?? [{ role: 'owner' }];
    }
    if (query.text.includes('admin_users')) {
      return overrides.admin ?? [{ id: BOSS_ADMIN, role: 'enterprise_admin' }];
    }
    return undefined;
  };
}

function bossPorts(respond: (query: RecordedQuery) => unknown[] | undefined) {
  const database = fakeDatabase(respond);
  const store = createPeriodReportStore({
    transaction: fakeTransaction({ count: 0 }, database.tx),
    authorizeWrite: async () => ({ owner: true, memberRole: null, project: workerProjectRow }),
  });
  return {
    ports: createPeriodReportPorts({
      actor,
      store,
      receiver: bossReceiver,
      now: () => AFTER_PERIOD,
    }),
    database,
  };
}

test('boss receiver resolves the enterprise boss binding without membership or customer_access', async () => {
  const { ports, database } = bossPorts(bossResponder());
  const result = await ports.execute(
    operation('read.receiver_scope'),
    contextWithReceiver(bossReceiver),
  );

  assert.equal(result.receiverCount, 1);
  assert.deepEqual(result.receivers, {
    scope: 'enterprise_boss',
    projectId: '1455',
    bindingId: '9004',
    conversationId: '7004',
    bossAdminId: BOSS_ADMIN,
    audience: 'boss',
  });
  // The boss is the enterprise owner: no project membership and no customer link.
  assert.equal(
    database.calls.filter((call) => /app\.construction_members\b/.test(call.text)).length,
    0,
  );
  const bindingQuery = database.calls.find((call) => call.text.includes('construction_followup_bindings'));
  assert.ok(bindingQuery);
  assert.match(bindingQuery.text, /audience=\$3/);
  assert.match(bindingQuery.text, /project_id is null/);
  assert.match(bindingQuery.text, /scope_key='enterprise'/);
  assert.ok(bindingQuery.params.includes(`admin:${BOSS_ADMIN}`));
  assert.ok(bindingQuery.params.includes('boss'));
  const adminQuery = database.calls.find((call) => call.text.includes('admin_users'));
  assert.ok(adminQuery);
  assert.match(adminQuery.text, /status='active'/);
  assert.match(adminQuery.text, /must_change_password=false/);
  // The owner check uses the existing followup access function.
  assert.ok(database.calls.some((call) => call.text.includes('construction_followup_staff_access')));
});

test('a boss receiver without the enterprise owner role is unavailable', async () => {
  const { ports } = bossPorts(bossResponder({ access: [{ role: 'member' }] }));
  await assert.rejects(
    () => ports.execute(operation('save.period_report'), contextWithReceiver(bossReceiver)),
    isFailure('period_report_receiver_unavailable'),
  );

  const receivers = await ports.execute(
    operation('read.receiver_scope'),
    contextWithReceiver(bossReceiver),
  );
  assert.equal(receivers.receiverCount, 0);
  assert.equal(
    (receivers.receivers as Record<string, unknown>).status,
    'boss_unavailable',
  );
});

test('a boss report saves and delivers through the enterprise boss scope', async () => {
  const { state, store } = fakeStore({
    scope: bossScope(),
    queued: storedReport(bossScope()),
    delivery: {
      state: 'delivered',
      messageId: '8104',
      conversationId: '7004',
      deliveredAt: '2026-11-11T02:05:00.000Z',
      messagePurpose: 'construction.report.facts',
    },
  });
  const ports = createPeriodReportPorts({ actor, store, receiver: bossReceiver });

  const saved = await ports.execute(
    operation('save.period_report'),
    contextWithReceiver(bossReceiver),
  );
  assert.equal(saved.saved, true);
  const receipt = saved.saveReceipt as Record<string, unknown>;
  assert.equal(receipt.receiverKind, 'boss');
  assert.equal(receipt.receiverAdminId, BOSS_ADMIN);
  assert.deepEqual(receipt.projectScope, ['1455']);
  assert.deepEqual(state.scopeReceivers, [bossReceiver]);
  assert.deepEqual(state.enqueueReceivers, [bossReceiver]);

  const receivers = await ports.execute(
    operation('read.receiver_scope'),
    contextWithReceiver(bossReceiver),
  );
  assert.deepEqual(receivers.receivers, {
    scope: 'enterprise_boss',
    projectId: '1455',
    bindingId: '9004',
    conversationId: '7004',
    bossAdminId: BOSS_ADMIN,
    audience: 'boss',
  });

  const delivered = await ports.execute(
    operation('deliver.inapp', { receivers: receivers.receivers as WorkflowValue }),
    contextWithReceiver(bossReceiver),
  );
  assert.equal(delivered.delivered, true);
  const delivery = delivered.deliveryReceipt as Record<string, unknown>;
  assert.equal(delivery.status, 'delivered');
  assert.match(String(delivery.receiptId), /^report-delivery:5001:1:9004$/);
});

test('a staff or customer delivery receiver object cannot deliver a boss scope', async () => {
  const { store } = fakeStore({
    scope: bossScope(),
    queued: storedReport(bossScope()),
  });
  const ports = createPeriodReportPorts({ actor, store, receiver: bossReceiver });
  await ports.execute(operation('save.period_report'), contextWithReceiver(bossReceiver));

  for (const receivers of [
    {
      scope: 'enterprise_designer',
      projectId: '1455',
      bindingId: '9004',
      conversationId: '7004',
      designerAdminId: BOSS_ADMIN,
      audience: 'designer',
    },
    {
      scope: 'project_customer',
      projectId: '1455',
      bindingId: '9004',
      conversationId: '7004',
      customerUserId: '1454000002',
      audience: 'customer',
    },
  ]) {
    await assert.rejects(
      () => ports.execute(
        operation('deliver.inapp', { receivers }),
        contextWithReceiver(bossReceiver),
      ),
      isFailure('receiver_scope_mismatch'),
    );
  }
});

test('an unknown host receiver kind is rejected instead of falling back to the owner', async () => {
  const { store } = fakeStore();
  const ports = createPeriodReportPorts({
    actor,
    store,
    receiver: { kind: 'service' } as unknown as LivePeriodReceiver,
  });
  await assert.rejects(
    () => ports.execute(operation('read.receiver_scope'), context()),
    isFailure('receiver_kind_invalid'),
  );
});

function isPeriodNotEnded(error: unknown): boolean {
  return (error as { code?: string }).code === 'period_not_ended';
}

/** Fake tenant transaction: records calls and forwards the same tx object. */
function fakeTransaction(transactions: { count: number }, tx: PostgresTransaction) {
  return <T>(
    _enterpriseId: bigint | number | string,
    callback: (transaction: PostgresTransaction) => Promise<T>,
  ): Promise<T> => {
    transactions.count += 1;
    return callback(tx);
  };
}

test('a daily period may only run after its Shanghai day has ended', () => {
  // end = 2026-11-10T16:00:00.000Z; the boundary itself is inclusive.
  assert.throws(
    () => parseFixedDailyPeriod(event, new Date('2026-11-10T15:59:59.999Z')),
    isPeriodNotEnded,
  );
  assert.doesNotThrow(
    () => parseFixedDailyPeriod(event, new Date('2026-11-10T16:00:00.000Z')),
  );
  assert.doesNotThrow(
    () => parseFixedDailyPeriod(event, new Date('2026-11-10T16:00:00.001Z')),
  );

  assert.throws(
    () => parseFixedDailyPeriod(
      { ...event, periodStart: '2026-11-12', periodEnd: '2026-11-12' },
      new Date('2026-11-11T00:00:00.000Z'),
    ),
    isPeriodNotEnded,
  );

  // occurredAt is only the schedule stamp; a forged one cannot end the day.
  assert.throws(
    () => parseFixedDailyPeriod(
      { ...event, occurredAt: '2026-11-20T00:00:00.000Z' },
      new Date('2026-11-10T15:00:00.000Z'),
    ),
    isPeriodNotEnded,
  );
  assert.throws(
    () => parseFixedDailyPeriod(
      { ...event, occurredAt: '2020-01-01T00:00:00.000Z' },
      new Date('2026-11-10T15:00:00.000Z'),
    ),
    isPeriodNotEnded,
  );
});

test('save refuses a period that has not ended in the trusted clock', async () => {
  const { state, store } = fakeStore();
  const ports = createPeriodReportPorts({
    actor,
    store,
    now: () => new Date('2026-11-10T15:00:00.000Z'),
  });

  await assert.rejects(
    () => ports.execute(operation('save.period_report'), context()),
    isFailure('period_not_ended'),
  );
  assert.equal(state.enqueueCalls.length, 0);
});

test('the write transaction re-checks management access before enqueueing', async () => {
  const period = parseFixedDailyPeriod(event, AFTER_PERIOD);
  const tx = {} as PostgresTransaction;
  const transactions = { count: 0 };
  let enqueueCalls = 0;
  const authorizeCalls: Array<[PostgresTransaction, ConstructionActor, string, string]> = [];
  const store = createPeriodReportStore({
    transaction: fakeTransaction(transactions, tx),
    authorizeWrite: async (receivedTx, receivedActor, projectId, lock) => {
      authorizeCalls.push([receivedTx, receivedActor, projectId, lock]);
      throw new AssistantError('construction_forbidden', 403);
    },
    enqueueReport: async () => {
      enqueueCalls += 1;
      return null;
    },
  });

  await assert.rejects(
    () => store.enqueue({ actor, projectId: '1455', period, receiver: { kind: 'customer' } }),
    (error: unknown) => error instanceof AssistantError
      && error.code === 'construction_forbidden',
  );
  assert.equal(transactions.count, 1);
  assert.equal(authorizeCalls.length, 1);
  const [receivedTx, receivedActor, projectId, lock] = authorizeCalls[0]!;
  assert.equal(receivedTx, tx);
  assert.deepEqual(receivedActor, actor);
  assert.equal(projectId, '1455');
  assert.equal(lock, 'update');
  assert.equal(enqueueCalls, 0);
});

test('a manager revoked between scope and enqueue fails inside the second transaction', async () => {
  const fake = fakeStore();
  const tx = {} as PostgresTransaction;
  const transactions = { count: 0 };
  let enqueueCalls = 0;
  const transaction: PeriodReportStoreDependencies['transaction'] =
    fakeTransaction(transactions, tx);
  const defaults = createPeriodReportStore({
    transaction,
    authorizeWrite: async () => {
      throw new AssistantError('construction_forbidden', 403);
    },
    enqueueReport: async () => {
      enqueueCalls += 1;
      return null;
    },
  });
  const store: PeriodReportStore = { ...fake.store, enqueue: defaults.enqueue };
  const ports = createPeriodReportPorts({ actor, store, now: () => AFTER_PERIOD });

  await assert.rejects(
    () => ports.execute(operation('save.period_report'), context()),
    isFailure('construction_forbidden'),
  );
  // The scope read already succeeded; only the enqueue transaction ran and it
  // refreshed the management check before touching any report row.
  assert.equal(transactions.count, 1);
  assert.equal(enqueueCalls, 0);
});

test('a caller without management access never reaches the enqueue', async () => {
  const tx = {} as PostgresTransaction;
  const transactions = { count: 0 };
  let enqueueCalls = 0;
  const store = createPeriodReportStore({
    transaction: fakeTransaction(transactions, tx),
    authorizeWrite: async () => {
      throw new AssistantError('construction_forbidden', 403);
    },
    enqueueReport: async () => {
      enqueueCalls += 1;
      return null;
    },
  });
  const ports = createPeriodReportPorts({ actor, store, now: () => AFTER_PERIOD });

  await assert.rejects(
    () => ports.execute(operation('save.period_report'), context()),
    isFailure('construction_forbidden'),
  );
  assert.equal(transactions.count, 1);
  assert.equal(enqueueCalls, 0);
});
