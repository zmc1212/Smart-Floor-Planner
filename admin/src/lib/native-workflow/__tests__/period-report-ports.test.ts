import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AssistantError, fingerprint } from '@/lib/assistant/contracts';
import type { ConstructionActor } from '@/lib/construction/contracts';
import type { PendingOperation, TriggerEvent, WorkflowValue } from '../types';
import {
  parseFixedDailyPeriod,
  periodReportKey,
  type FixedPeriod,
} from '../live/period-event';
import {
  createPeriodReportPorts,
  type PeriodDeliveryRecord,
  type PeriodRecordRead,
  type PeriodReportPhoto,
  type PeriodReportScope,
  type PeriodReportStore,
  type StoredPeriodReport,
} from '../live/period-report-ports';
import {
  LiveOperationFailure,
  LiveOperationUnknownError,
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
  const period = parseFixedDailyPeriod(event);
  return {
    enterpriseId: actor.enterpriseId,
    projectId: '1455',
    projectName: '测试项目',
    bindingId: '9001',
    conversationId: '7001',
    customerUserId: '1454000002',
    reportKey: periodReportKey(period, { id: '7001' }),
    legacyPlanEnabled: true,
    legacyScheduleDue: false,
    audienceEnabled: true,
    receiverAvailable: true,
    receiverStatus: 'available',
    ...overrides,
  };
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
    findCalls: 0,
    recordCalls: 0,
    photoCalls: 0,
    deliveryCalls: 0,
    ...initial,
  };
  const store: PeriodReportStore = {
    async loadScope() {
      return state.scope;
    },
    async findReport() {
      state.findCalls += 1;
      // The first read is the pre-check; a later read is the post-conflict
      // re-read after `enqueue` returned null.
      return state.findCalls === 1 ? state.existing : (state.raced ?? state.existing);
    },
    async enqueue({ projectId, period }) {
      state.enqueueCalls.push(period);
      state.enqueueProjects.push(projectId);
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
  const period = parseFixedDailyPeriod(event);
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
  const period = parseFixedDailyPeriod(event);
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
  });
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
  assert.match(String(receipt.receiptId), /^report:5001:1$/);
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
