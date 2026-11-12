import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WorkflowOperationError } from '../errors';
import { createMemoryPeriodReportBatchStore } from '../live/period-report-batch-store';
import type { PeriodReportEntryInput } from '../live/period-report-entry';
import {
  readScheduledPeriodReportDispatch,
  resolveEndedShanghaiWeek,
  runScheduledPeriodReportDispatch,
  setScheduledPeriodReportPaused,
  type ScheduledPeriodReportDispatchDependencies,
} from '../live/period-report-schedule';
import type { PeriodReportScheduleEnvironment } from '../live/period-report-schedule-environment';
import { createMemoryPeriodReportScheduleStore } from '../live/period-report-schedule-store';
import type {
  ScheduledIssueItem,
  ScheduledProjectPlan,
} from '../live/period-report-schedule-types';
import type {
  PeriodOverallState,
  PeriodReportRunObservation,
} from '../live/period-report-status';
import { runPeriodReportBatch } from '../live/period-report-batch';
import { createMemoryWorkflowRunStore } from '../live/run-store';
import type {
  LiveOperationRecord,
  LiveRunRecord,
  LiveRunStatus,
} from '../live/types';
import { createWorkflowService } from '../service';
import { createMemoryWorkflowStore } from '../store/memory-store';
import type { PublishedWorkflowVersion } from '../store/types';

const ENTERPRISE_ID = '1454';
const PROJECT_A = '1454000004';
const PROJECT_B = '1454000005';
const EXECUTOR = '1454000001';
const WORKER = '1454000008';
const DESIGNER = '1454000011';
const BOSS = '1454000013';
const CUSTOMER = '1454000002';
const NOW = new Date('2026-11-12T02:00:00.000Z');

type Behavior =
  | 'completed'
  | 'pending'
  | 'failed'
  | 'unknown'
  | 'unavailable'
  | 'crash';

interface Harness {
  readonly store: ReturnType<typeof createMemoryPeriodReportScheduleStore>;
  readonly batchStore: ReturnType<typeof createMemoryPeriodReportBatchStore>;
  readonly runStore: ReturnType<typeof createMemoryWorkflowRunStore>;
  readonly deps: ScheduledPeriodReportDispatchDependencies;
  readonly published: PublishedWorkflowVersion;
  readonly batchRequests: string[];
  readonly runReceiverCalls: string[];
  readonly reminders: Array<{ issueId: string; targetKind: string; adminId: string }>;
  plans: ScheduledProjectPlan[];
  issues: Array<{
    issueId: string;
    sourceRecordId: string;
    status: string;
    ownerId: string | null;
    ownerName: string;
    lastResult: string;
    updatedAt: string;
  }>;
  behaviors: Map<string, Behavior>;
  readAt: Map<string, string | null>;
  clock: Date;
  setClock(date: Date): void;
  setBehavior(projectId: string, behavior: Behavior): void;
  setReadAt(runId: string, readAt: string | null): void;
  publish(): { definitionId: string; revision: number };
}

function plan(projectId: string, overrides: Partial<ScheduledProjectPlan> = {}): ScheduledProjectPlan {
  return {
    projectId,
    projectName: `project-${projectId}`,
    customerUserId: CUSTOMER,
    customerAccess: true,
    workerAdminId: WORKER,
    designerAdminId: DESIGNER,
    bossAdminId: BOSS,
    executorAdminId: EXECUTOR,
    activity: { publishedRecords: 1, stageEvents: 0, openIssues: 0 },
    skipReasons: [],
    ...overrides,
  };
}

async function publishWeekly(): Promise<PublishedWorkflowVersion> {
  const service = createWorkflowService({
    store: createMemoryWorkflowStore(),
    now: () => '2026-11-12T01:00:00.000Z',
  });
  await service.createFromTemplate('period-report-weekly');
  const result = await service.publishDraft({
    definitionId: 'period-report-weekly',
    expectedDraftRevision: 1,
  });
  return result.version;
}

function businessEvent(input: PeriodReportEntryInput) {
  const receiver = input.receiver;
  return {
    outboxEventId: null,
    progressRevision: 0,
    stageKey: '',
    settingsVersion: 0,
    source: 'current_project_revision' as const,
    periodKind: input.event.periodKind,
    periodStart: input.event.periodStart,
    periodEnd: input.event.periodEnd,
    ...(receiver.kind !== 'customer' ? { receiver } : {}),
  };
}

function saveOperation(input: PeriodReportEntryInput, at: string): LiveOperationRecord {
  const suffix = input.receiver.kind;
  return {
    nodeId: 'save',
    capabilityRef: 'save.period_report',
    effect: 'write',
    nodeVersion: '1',
    idempotencyKey: `save-${input.runId}`,
    startedAt: at,
    finishedAt: at,
    outcome: 'succeeded',
    outputs: {
      saved: true,
      saveReceipt: {
        receiptId: `report:${input.runId}:1`,
        simulated: false,
        reportId: `report-${input.runId}`,
        revision: 1,
        runId: `facts-${input.runId}`,
        reportKey: `key-${input.projectId}`,
        bindingId: `binding-${suffix}`,
        conversationId: `conversation-${suffix}`,
        reused: false,
        receiverKind: suffix,
        receiverAdminId: suffix === 'customer' ? null : input.receiver.adminId,
        projectScope: [input.projectId],
      },
    },
  };
}

function deliveryOperation(input: PeriodReportEntryInput, at: string): LiveOperationRecord {
  const suffix = input.receiver.kind;
  return {
    nodeId: 'deliver',
    capabilityRef: 'deliver.inapp',
    effect: 'deliver',
    nodeVersion: '1',
    idempotencyKey: `deliver-${input.runId}`,
    startedAt: at,
    finishedAt: at,
    outcome: 'succeeded',
    outputs: {
      delivered: true,
      deliveryReceipt: {
        receiptId: `delivery-${input.runId}`,
        simulated: false,
        status: 'delivered',
        messageId: `message-${suffix}`,
        conversationId: `conversation-${suffix}`,
      },
    },
  };
}

function pendingDeliveryOperation(input: PeriodReportEntryInput, at: string): LiveOperationRecord {
  return {
    nodeId: 'deliver',
    capabilityRef: 'deliver.inapp',
    effect: 'deliver',
    nodeVersion: '1',
    idempotencyKey: `deliver-${input.runId}`,
    startedAt: at,
    finishedAt: at,
    outcome: 'failed',
    error: {
      code: 'delivery_not_confirmed',
      path: 'nodes.deliver',
      message: 'the existing Worker has not delivered this report yet',
    },
    outputs: {
      delivered: false,
      deliveryReceipt: {
        receiptId: '',
        simulated: false,
        status: 'pending',
      },
    },
  };
}

function recordFor(
  input: PeriodReportEntryInput,
  published: PublishedWorkflowVersion,
  behavior: Behavior,
  clock: Date,
): LiveRunRecord {
  const at = clock.toISOString();
  const operations: LiveOperationRecord[] = [];
  if (behavior !== 'failed' && behavior !== 'unknown' && behavior !== 'crash') {
    operations.push(saveOperation(input, at));
  }
  if (behavior === 'completed') operations.push(deliveryOperation(input, at));
  if (behavior === 'pending') operations.push(pendingDeliveryOperation(input, at));
  if (behavior === 'failed') {
    operations.push({
      nodeId: 'read',
      capabilityRef: 'read.period_records',
      effect: 'read',
      nodeVersion: '1',
      idempotencyKey: `read-${input.runId}`,
      startedAt: at,
      finishedAt: at,
      outcome: 'failed',
      error: {
        code: 'period_report_read_failed',
        path: 'nodes.read',
        message: 'the test rejects the period read',
      },
    });
  }
  if (behavior === 'unknown') {
    operations.push({
      nodeId: 'read',
      capabilityRef: 'read.period_records',
      effect: 'read',
      nodeVersion: '1',
      idempotencyKey: `read-${input.runId}`,
      startedAt: at,
      finishedAt: at,
      outcome: 'unknown',
      error: {
        code: 'provider_timeout',
        path: 'nodes.read',
        message: 'the provider result is unknown',
      },
    });
  }
  const status: LiveRunStatus = behavior === 'unknown' || behavior === 'crash'
    ? 'unknown'
    : behavior === 'failed'
      ? 'failed'
      : behavior === 'crash'
        ? 'running'
        : 'completed';
  const recordStatus: LiveRunStatus = behavior === 'crash' ? 'running' : status;
  return {
    binding: {
      runId: input.runId,
      definitionId: published.definition.definitionId,
      revision: published.revision,
      digest: published.digest,
      nodeVersions: published.nodeVersions,
      event: input.event,
      businessEvent: businessEvent(input),
    },
    enterpriseId: input.enterpriseId,
    projectId: input.projectId,
    status: recordStatus,
    state: {
      runId: input.runId,
      definitionId: published.definition.definitionId,
      revision: published.revision,
      digest: published.digest,
      mode: 'live',
      status: recordStatus === 'unknown' || recordStatus === 'running' ? 'failed' : recordStatus,
      currentNodeId: null,
      pendingNodeId: null,
      visitedNodeIds: [],
      outputs: {},
      processedEventIds: [input.event.eventId],
      error: null,
      outcome: null,
      stepCount: 0,
      traceSeq: 0,
    },
    trace: [],
    operations,
    createdAt: at,
    updatedAt: at,
  };
}

function observationFor(
  runId: string,
  behavior: Behavior,
  at: string,
  readAt: string | null,
): PeriodReportRunObservation {
  const overall: PeriodOverallState = behavior === 'completed'
    ? 'completed'
    : behavior === 'pending'
      ? 'processing'
      : behavior === 'failed'
        ? 'failed'
        : 'unknown';
  return {
    contract: 'period-report-run-status-v1',
    observedAt: at,
    bound: true,
    binding: null,
    progress: {
      overall,
      completed: overall === 'completed',
      processing: overall === 'processing',
      facts: {
        state: behavior === 'failed' ? 'failed' : behavior === 'unknown' ? 'unknown' : 'ready',
        runId: `facts-${runId}`,
        runStatus: behavior === 'failed' ? 'failed' : 'succeeded',
        versionStatus: behavior === 'failed' ? 'queued' : 'facts_ready',
        generatedAt: at,
        errorCode: behavior === 'failed' ? 'period_report_read_failed' : null,
        job: { jobId: null, status: null, attempts: 0, providerStartedAt: null },
      },
      body: {
        state: behavior === 'unknown' ? 'unknown' : 'ready',
        runId: `body-${runId}`,
        runStatus: 'succeeded',
        knowledgeStatus: 'ready',
        generatedAt: at,
        errorCode: null,
        job: { jobId: null, status: null, attempts: 0, providerStartedAt: null },
      },
      delivery: {
        state: behavior === 'completed'
          ? 'delivered'
          : behavior === 'pending'
            ? 'waiting'
            : 'unknown',
        deliveryState: behavior === 'completed'
          ? 'delivered'
          : behavior === 'pending'
            ? 'pending'
            : null,
        messageId: behavior === 'completed' ? `message-${runId.split('-').at(-1)}` : null,
        conversationId: behavior === 'completed'
          ? `conversation-${runId.split('-').at(-1)}`
          : null,
        deliveredAt: behavior === 'completed' ? at : null,
        readAt,
      },
      availability: { state: 'available', reason: 'available' },
      reasons: [],
    },
    raw: {
      status: behavior === 'unknown' ? 'unknown' : behavior === 'failed' ? 'failed' : 'completed',
      errorCode: null,
      errorMessage: null,
      updatedAt: at,
      operations: [],
    },
    reasons: [],
  };
}

async function makeHarness(options?: {
  plans?: ScheduledProjectPlan[];
  behavior?: Behavior;
}): Promise<Harness> {
  const store = createMemoryPeriodReportScheduleStore();
  const batchStore = createMemoryPeriodReportBatchStore();
  const runStore = createMemoryWorkflowRunStore();
  const published = await publishWeekly();
  const batchRequests: string[] = [];
  const runReceiverCalls: string[] = [];
  const reminders: Array<{ issueId: string; targetKind: string; adminId: string }> = [];
  const behaviors = new Map<string, Behavior>();
  const readAt = new Map<string, string | null>();
  const harness: Harness = {
    store,
    batchStore,
    runStore,
    published,
    batchRequests,
    runReceiverCalls,
    reminders,
    plans: options?.plans ?? [plan(PROJECT_A)],
    issues: [],
    behaviors,
    readAt,
    clock: new Date(NOW),
    setClock(date) {
      harness.clock = new Date(date);
    },
    setBehavior(projectId, behavior) {
      behaviors.set(projectId, behavior);
    },
    setReadAt(runId, value) {
      readAt.set(runId, value);
    },
    publish() {
      return {
        definitionId: published.definition.definitionId,
        revision: published.revision,
      };
    },
    deps: undefined as unknown as ScheduledPeriodReportDispatchDependencies,
  };
  for (const candidate of harness.plans) {
    behaviors.set(candidate.projectId, options?.behavior ?? 'completed');
  }

  const runReceiver = async (input: PeriodReportEntryInput) => {
    runReceiverCalls.push(`${input.projectId}:${input.receiver.kind}`);
    const behavior = behaviors.get(input.projectId) ?? 'completed';
    if (behavior === 'unavailable') {
      throw new WorkflowOperationError(
        `${input.receiver.kind}_receiver_unavailable`,
        422,
        `${input.receiver.kind} receiver is unavailable`,
      );
    }
    const record = recordFor(input, published, behavior, harness.clock);
    const created = await input.store.create(record);
    return { record: created.record } as never;
  };

  const environment: PeriodReportScheduleEnvironment = {
    now: () => new Date(harness.clock),
    loadPublished: async (input) => {
      if (!input) return published;
      assert.equal(input.definitionId, published.definition.definitionId);
      assert.equal(input.revision, published.revision);
      return published;
    },
    discover: async () => ({
      enterpriseName: 'Test enterprise',
      skipReasons: [],
      projects: harness.plans,
      excludedProjects: 0,
    }),
    claimWeeklySchedule: async () => ({
      claimed: true,
      previousNextWeeklyAt: '2026-11-02T00:00:00.000Z',
      nextWeeklyAt: '2026-11-16T00:00:00.000Z',
      reason: null,
    }),
    ensureCustomerBinding: async () => ({
      available: true,
      reason: null,
      bindingId: 'binding-customer',
      conversationId: 'conversation-customer',
    }),
    runBatch: async (input) => {
      batchRequests.push(input.requestId);
      return runPeriodReportBatch(input, {
        now: () => new Date(harness.clock),
        preflight: async () => ({
          enabled: true,
          stageEnabled: false,
          projectIds: [input.projectId],
          audiences: ['customer', 'worker', 'designer', 'boss'],
          nextDailyAt: '2099-01-01T00:00:00.000Z',
          nextWeeklyAt: '2099-01-01T00:00:00.000Z',
          executor: { owner: true, memberRole: null },
        }),
        authorize: async () => undefined,
        runReceiver,
        observe: async ({ runId }) => {
          const behavior = behaviors.get(
            [...behaviors.keys()].find((projectId) => runId.includes(projectId)) ?? '',
          ) ?? 'completed';
          return observationFor(
            runId,
            behavior,
            harness.clock.toISOString(),
            readAt.get(runId) ?? null,
          );
        },
      });
    },
    portsFor: () => ({
      execute: async () => ({}),
    }),
    observeStatus: async ({ runId }) => {
      const behavior = behaviors.get(
        [...behaviors.keys()].find((projectId) => runId.includes(projectId)) ?? '',
      ) ?? 'completed';
      return observationFor(
        runId,
        behavior,
        harness.clock.toISOString(),
        readAt.get(runId) ?? null,
      );
    },
    loadIssues: async () => harness.issues,
    sendReminder: async (input) => {
      reminders.push({
        issueId: input.issue.issueId,
        targetKind: input.targetKind,
        adminId: input.adminId,
      });
      return { sent: true, reason: null, messageId: `reminder-${reminders.length}` };
    },
  };
  (harness as { deps: ScheduledPeriodReportDispatchDependencies }).deps = {
    store,
    batchStore,
    runStore,
    environment,
  };
  return harness;
}

function options(overrides: Record<string, unknown> = {}) {
  return {
    enterpriseIds: [ENTERPRISE_ID],
    maxProjectsPerRound: 5,
    observeIntervalMs: 15 * 60_000,
    readObservationIntervalMs: 6 * 3_600_000,
    recheckIntervalMs: 15 * 60_000,
    recheckLimit: 3,
    maxRunDurationMs: 90_000,
    ...overrides,
  };
}

function entryOf(harness: Harness, projectId: string) {
  return harness.store.get(`schedule-${ENTERPRISE_ID}-weekly-2026-11-02`)
    .then((run) => {
      assert.ok(run);
      return run.projects[projectId];
    });
}

test('resolves the last ended Shanghai Monday-to-Monday week', () => {
  const monday = resolveEndedShanghaiWeek(new Date('2026-11-08T16:00:00.000Z'));
  assert.equal(monday.periodStart, '2026-11-02');
  assert.equal(monday.periodEnd, '2026-11-09');
  const sunday = resolveEndedShanghaiWeek(new Date('2026-11-08T15:59:59.000Z'));
  assert.equal(sunday.periodStart, '2026-10-26');
  assert.equal(sunday.periodEnd, '2026-11-02');
  const wednesday = resolveEndedShanghaiWeek(new Date('2026-11-11T02:00:00.000Z'));
  assert.equal(wednesday.periodStart, '2026-11-02');
  assert.equal(wednesday.periodEnd, '2026-11-09');
});

test('rejects a period that has not ended before touching the store', async () => {
  const harness = await makeHarness();
  await assert.rejects(
    () => runScheduledPeriodReportDispatch(
      options({ periodStart: '2026-11-09' }),
      harness.deps,
    ),
    (error: unknown) => error instanceof WorkflowOperationError
      && error.code === 'period_not_ended',
  );
  assert.equal(harness.batchRequests.length, 0);
});

test('dispatches one project with four independent receivers and a deterministic request', async () => {
  const harness = await makeHarness();
  const summary = await runScheduledPeriodReportDispatch(options(), harness.deps);
  assert.equal(summary.enabled, true);
  assert.equal(summary.period.periodStart, '2026-11-02');
  assert.deepEqual(harness.batchRequests, [
    `schedule-${ENTERPRISE_ID}-${PROJECT_A}-weekly-2026-11-02`,
  ]);
  assert.deepEqual(harness.runReceiverCalls.sort(), [
    `${PROJECT_A}:boss`,
    `${PROJECT_A}:customer`,
    `${PROJECT_A}:designer`,
    `${PROJECT_A}:worker`,
  ]);
  const entry = await entryOf(harness, PROJECT_A);
  assert.equal(entry.state, 'completed');
  assert.equal(entry.receivers.length, 4);
  assert.equal(entry.receivers.every((receiver) => !!receiver.reportId), true);
  assert.equal(entry.receivers.every((receiver) => receiver.deliveryState === 'delivered'), true);
  assert.equal(summary.enterprises[0]!.counts.completed, 1);
});

test('a repeated tick does not create a second batch or model-visible work', async () => {
  const harness = await makeHarness();
  await runScheduledPeriodReportDispatch(options(), harness.deps);
  const first = await entryOf(harness, PROJECT_A);
  const calls = harness.runReceiverCalls.length;
  await runScheduledPeriodReportDispatch(options(), harness.deps);
  const second = await entryOf(harness, PROJECT_A);
  assert.equal(harness.runReceiverCalls.length, calls);
  assert.equal(second.dispatchedAt, first.dispatchedAt);
  assert.equal(second.batchStatus, 'completed');
});

test('keeps multiple projects independent and isolates one failure', async () => {
  const harness = await makeHarness({
    plans: [plan(PROJECT_A), plan(PROJECT_B)],
    behavior: 'completed',
  });
  harness.setBehavior(PROJECT_A, 'failed');
  const summary = await runScheduledPeriodReportDispatch(options(), harness.deps);
  assert.equal(harness.batchRequests.length, 2);
  assert.notEqual(harness.batchRequests[0], harness.batchRequests[1]);
  const failed = await entryOf(harness, PROJECT_A);
  const completed = await entryOf(harness, PROJECT_B);
  assert.equal(failed.state, 'failed');
  assert.equal(completed.state, 'completed');
  assert.equal(summary.enterprises[0]!.counts.completed, 1);
  assert.equal(summary.enterprises[0]!.counts.failed, 1);
});

test('an unknown result is never replayed automatically', async () => {
  const harness = await makeHarness({ behavior: 'unknown' });
  await runScheduledPeriodReportDispatch(options(), harness.deps);
  const entry = await entryOf(harness, PROJECT_A);
  assert.equal(entry.state, 'unknown');
  assert.equal(entry.nextObservationAt, null);
  const calls = harness.runReceiverCalls.length;
  await runScheduledPeriodReportDispatch(options(), harness.deps);
  assert.equal(harness.runReceiverCalls.length, calls);
});

test('waits for delivery without rewriting it as delivered', async () => {
  const harness = await makeHarness({ behavior: 'pending' });
  await runScheduledPeriodReportDispatch(options(), harness.deps);
  const entry = await entryOf(harness, PROJECT_A);
  assert.equal(entry.state, 'waiting_delivery');
  assert.equal(entry.receivers.every((receiver) => !!receiver.reportId), true);
  assert.equal(entry.receivers.every((receiver) => receiver.deliveryState === 'pending'), true);
  assert.ok(entry.nextObservationAt);
  harness.setBehavior(PROJECT_A, 'completed');
  for (const receiver of entry.receivers) {
    harness.setReadAt(receiver.runId, '2026-11-12T03:00:00.000Z');
  }
  harness.setClock(new Date('2026-11-12T02:20:00.000Z'));
  await runScheduledPeriodReportDispatch(options(), harness.deps);
  const delivered = await entryOf(harness, PROJECT_A);
  assert.equal(delivered.state, 'completed');
  assert.equal(delivered.receivers.every((receiver) => receiver.readAt === '2026-11-12T03:00:00.000Z'), true);
});

test('keeps unread distinct from undelivered and stops when every receiver read', async () => {
  const harness = await makeHarness();
  await runScheduledPeriodReportDispatch(options(), harness.deps);
  const first = await entryOf(harness, PROJECT_A);
  assert.equal(first.state, 'completed');
  assert.equal(first.receivers.every((receiver) => receiver.readAt === null), true);
  assert.ok(first.nextObservationAt);
  const runId = first.receivers.find((receiver) => receiver.kind === 'worker')!.runId;
  harness.setClock(new Date('2026-11-12T09:00:00.000Z'));
  for (const receiver of first.receivers) harness.setReadAt(receiver.runId, '2026-11-12T08:00:00.000Z');
  await runScheduledPeriodReportDispatch(options(), harness.deps);
  const second = await entryOf(harness, PROJECT_A);
  assert.equal(second.state, 'completed');
  assert.equal(second.nextObservationAt, null);
  assert.equal(second.receivers.every((receiver) => receiver.readAt === '2026-11-12T08:00:00.000Z'), true);
  assert.ok(runId);
});

test('a missing receiver becomes needs-attention and recovers with the same request id', async () => {
  const harness = await makeHarness({
    plans: [plan(PROJECT_A, { workerAdminId: null, skipReasons: ['worker_missing'] })],
  });
  await runScheduledPeriodReportDispatch(options(), harness.deps);
  let entry = await entryOf(harness, PROJECT_A);
  assert.equal(entry.state, 'needs_attention');
  assert.equal(harness.batchRequests.length, 0);
  assert.ok(entry.nextObservationAt);
  harness.plans = [plan(PROJECT_A)];
  harness.setClock(new Date('2026-11-12T02:20:00.000Z'));
  await runScheduledPeriodReportDispatch(options(), harness.deps);
  entry = await entryOf(harness, PROJECT_A);
  assert.equal(entry.state, 'completed');
  assert.deepEqual(harness.batchRequests, [
    `schedule-${ENTERPRISE_ID}-${PROJECT_A}-weekly-2026-11-02`,
  ]);
});

test('a concurrent dispatcher sees the run lease and does not duplicate work', async () => {
  const harness = await makeHarness();
  const runId = `schedule-${ENTERPRISE_ID}-weekly-2026-11-02`;
  await harness.store.acquire(runId, {
    owner: 'other-process',
    now: () => harness.clock,
    ttlMs: 60_000,
  });
  const summary = await runScheduledPeriodReportDispatch(options(), harness.deps);
  assert.equal(summary.enterprises[0]!.busy, true);
  assert.equal(harness.batchRequests.length, 0);
});

test('pause stops dispatch and resume continues it', async () => {
  const harness = await makeHarness();
  await setScheduledPeriodReportPaused({
    enterpriseId: ENTERPRISE_ID,
    paused: true,
    updatedBy: 'test',
    reason: 'hold',
    store: harness.store,
    now: () => harness.clock,
  });
  const paused = await runScheduledPeriodReportDispatch(options(), harness.deps);
  assert.equal(paused.enterprises[0]!.paused, true);
  assert.equal(harness.batchRequests.length, 0);
  await setScheduledPeriodReportPaused({
    enterpriseId: ENTERPRISE_ID,
    paused: false,
    updatedBy: 'test',
    reason: null,
    store: harness.store,
    now: () => harness.clock,
  });
  await runScheduledPeriodReportDispatch(options(), harness.deps);
  assert.equal(harness.batchRequests.length, 1);
});

test('a project with no period activity is skipped without a batch', async () => {
  const harness = await makeHarness({
    plans: [plan(PROJECT_A, {
      skipReasons: ['no_period_activity'],
      activity: { publishedRecords: 0, stageEvents: 0, openIssues: 0 },
    })],
  });
  await runScheduledPeriodReportDispatch(options(), harness.deps);
  const entry = await entryOf(harness, PROJECT_A);
  assert.equal(entry.state, 'skipped');
  assert.equal(entry.reason, 'no_period_activity');
  assert.equal(harness.batchRequests.length, 0);
});

test('carries an open issue across weeks by id and escalates it without duplicates', async () => {
  const harness = await makeHarness();
  harness.issues = [{
    issueId: '9001',
    sourceRecordId: '5001',
    status: 'awaiting_review',
    ownerId: DESIGNER,
    ownerName: 'Designer',
    lastResult: '等待核对原记录',
    updatedAt: '2026-11-08T01:00:00.000Z',
  }];
  await runScheduledPeriodReportDispatch(options(), harness.deps);
  assert.deepEqual(harness.reminders, [{
    issueId: '9001',
    targetKind: 'designer',
    adminId: DESIGNER,
  }]);
  let ledger: readonly ScheduledIssueItem[] = (await harness.store.ledger(ENTERPRISE_ID, PROJECT_A)).items;
  assert.equal(ledger.length, 1);
  assert.deepEqual(ledger[0]!.periods, ['2026-11-02']);

  harness.setClock(new Date('2026-11-16T02:00:00.000Z'));
  await runScheduledPeriodReportDispatch(options(), harness.deps);
  ledger = (await harness.store.ledger(ENTERPRISE_ID, PROJECT_A)).items;
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0]!.issueId, '9001');
  assert.deepEqual(ledger[0]!.periods, ['2026-11-02', '2026-11-09']);
  assert.equal(harness.reminders.length, 2);
  assert.deepEqual(harness.reminders[1], {
    issueId: '9001',
    targetKind: 'boss',
    adminId: BOSS,
  });
});

test('a closed issue stays closed in the ledger and is not reminded again', async () => {
  const harness = await makeHarness();
  harness.issues = [{
    issueId: '9002',
    sourceRecordId: '5002',
    status: 'closed',
    ownerId: DESIGNER,
    ownerName: 'Designer',
    lastResult: '已关闭',
    updatedAt: '2026-11-08T01:00:00.000Z',
  }];
  await runScheduledPeriodReportDispatch(options(), harness.deps);
  const ledger = (await harness.store.ledger(ENTERPRISE_ID, PROJECT_A)).items;
  assert.equal(ledger[0]!.status, 'closed');
  assert.equal(harness.reminders.length, 0);
});

test('limits one round to the configured project count and continues next tick', async () => {
  const harness = await makeHarness({
    plans: [plan(PROJECT_A), plan(PROJECT_B), plan('1454000006')],
  });
  await runScheduledPeriodReportDispatch(options({ maxProjectsPerRound: 2 }), harness.deps);
  assert.equal(harness.batchRequests.length, 2);
  await runScheduledPeriodReportDispatch(options({ maxProjectsPerRound: 2 }), harness.deps);
  assert.equal(harness.batchRequests.length, 3);
});

test('the read-only query never dispatches or changes the schedule', async () => {
  const harness = await makeHarness();
  await runScheduledPeriodReportDispatch(options(), harness.deps);
  const before = await harness.store.get(`schedule-${ENTERPRISE_ID}-weekly-2026-11-02`);
  const calls = harness.batchRequests.length;
  const result = await readScheduledPeriodReportDispatch({
    enterpriseId: ENTERPRISE_ID,
    store: harness.store,
  });
  assert.ok(result.run);
  assert.equal(result.run!.updatedAt, before!.updatedAt);
  assert.equal(harness.batchRequests.length, calls);
  await assert.rejects(
    () => readScheduledPeriodReportDispatch({
      enterpriseId: '999999',
      store: harness.store,
      runId: result.run!.runId,
    }),
    (error: unknown) => error instanceof WorkflowOperationError
      && error.code === 'period_report_schedule_forbidden',
  );
});
