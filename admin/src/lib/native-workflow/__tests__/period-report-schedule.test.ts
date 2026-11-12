import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WorkflowOperationError } from '../errors';
import { createMemoryPeriodReportBatchStore } from '../live/period-report-batch-store';
import type { PeriodReportEntryInput } from '../live/period-report-entry';
import {
  cancelScheduledPeriodReport,
  readScheduledPeriodReportDispatch,
  resolveEndedShanghaiWeek,
  resolveScheduledPeriod,
  runScheduledPeriodReportDispatch,
  setScheduledPeriodReportPaused,
  type ScheduledPeriodReportDispatchDependencies,
} from '../live/period-report-schedule';
import type {
  PeriodReportScheduleEnvironment,
  ScheduleWeeklyClaim,
} from '../live/period-report-schedule-environment';
import { weeklyExecutionAt } from '../live/period-report-schedule-calendar';
import { createMemoryPeriodReportScheduleStore } from '../live/period-report-schedule-store';
import {
  SCHEDULE_RUN_VERSION,
  emptyCounts,
  type ScheduledIssueItem,
  type ScheduledProjectPlan,
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
  | 'source_unavailable'
  | 'crash';

interface Harness {
  readonly store: ReturnType<typeof createMemoryPeriodReportScheduleStore>;
  readonly batchStore: ReturnType<typeof createMemoryPeriodReportBatchStore>;
  readonly runStore: ReturnType<typeof createMemoryWorkflowRunStore>;
  readonly deps: ScheduledPeriodReportDispatchDependencies;
  readonly published: PublishedWorkflowVersion;
  readonly batchRequests: string[];
  readonly runReceiverCalls: string[];
  readonly recoveryRequests: string[];
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
  receiverBehaviors: Map<string, Behavior>;
  recoveryBehavior: Behavior;
  readAt: Map<string, string | null>;
  clock: Date;
  claimRequests: Array<{ enterpriseId: string; periodStart: string; periodEnd: string }>;
  claimResult: ScheduleWeeklyClaim;
  failAfterBatchOnce: boolean;
  customerAvailable: boolean;
  /** Injected failure for a project-scoped discovery (recheck) call. */
  discoverError: Error | null;
  discoverCalls: number;
  /** One tenant whose batch always fails, to prove cross-tenant isolation. */
  failingEnterprise: string | null;
  /** Lets concurrent ticks overlap inside the batch call. */
  batchDelayMs: number;
  setClock(date: Date): void;
  setBehavior(projectId: string, behavior: Behavior): void;
  setReceiverBehavior(kind: string, behavior: Behavior): void;
  setReadAt(runId: string, readAt: string | null): void;
  setClaim(claim: ScheduleWeeklyClaim): void;
  setCustomerAvailable(available: boolean): void;
  publish(): { definitionId: string; revision: number };
}

function claimedWeekly(overrides: Partial<ScheduleWeeklyClaim> = {}): ScheduleWeeklyClaim {
  return {
    claimed: true,
    due: true,
    alreadyConsumed: false,
    dueAt: '2026-11-09T00:00:00.000Z',
    previousNextWeeklyAt: '2026-11-02T00:00:00.000Z',
    nextWeeklyAt: '2026-11-16T00:00:00.000Z',
    reason: null,
    ...overrides,
  };
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
    effect: 'save',
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
  if (behavior === 'completed' || behavior === 'source_unavailable') {
    operations.push(deliveryOperation(input, at));
  }
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
      : behavior === 'source_unavailable'
        ? 'unavailable'
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
        state: behavior === 'completed' || behavior === 'source_unavailable'
          ? 'delivered'
          : behavior === 'pending'
            ? 'waiting'
            : 'unknown',
        deliveryState: behavior === 'completed' || behavior === 'source_unavailable'
          ? 'delivered'
          : behavior === 'pending'
            ? 'pending'
            : null,
        messageId: behavior === 'completed' || behavior === 'source_unavailable'
          ? `message-${runId.split('-').at(-1)}`
          : null,
        conversationId: behavior === 'completed' || behavior === 'source_unavailable'
          ? `conversation-${runId.split('-').at(-1)}`
          : null,
        deliveredAt: behavior === 'completed' || behavior === 'source_unavailable' ? at : null,
        readAt,
      },
      availability: behavior === 'source_unavailable'
        ? { state: 'source_unavailable', reason: 'source_project_revoked' }
        : { state: 'available', reason: 'available' },
      reasons: behavior === 'source_unavailable'
        ? ['source_unavailable', 'source_project_revoked']
        : [],
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
  const recoveryRequests: string[] = [];
  const reminders: Array<{ issueId: string; targetKind: string; adminId: string }> = [];
  const behaviors = new Map<string, Behavior>();
  const receiverBehaviors = new Map<string, Behavior>();
  const readAt = new Map<string, string | null>();
  const harness: Harness = {
    store,
    batchStore,
    runStore,
    published,
    batchRequests,
    runReceiverCalls,
    recoveryRequests,
    reminders,
    plans: options?.plans ?? [plan(PROJECT_A)],
    issues: [],
    behaviors,
    receiverBehaviors,
    recoveryBehavior: 'completed',
    readAt,
    clock: new Date(NOW),
    claimRequests: [],
    claimResult: claimedWeekly(),
    failAfterBatchOnce: false,
    customerAvailable: true,
    discoverError: null,
    discoverCalls: 0,
    failingEnterprise: null,
    batchDelayMs: 0,
    setClock(date) {
      harness.clock = new Date(date);
    },
    setBehavior(projectId, behavior) {
      behaviors.set(projectId, behavior);
    },
    setReceiverBehavior(kind, behavior) {
      receiverBehaviors.set(kind, behavior);
    },
    setReadAt(runId, value) {
      readAt.set(runId, value);
    },
    setClaim(claim) {
      harness.claimResult = claim;
    },
    setCustomerAvailable(available) {
      harness.customerAvailable = available;
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

  const behaviorForRun = (runId: string): Behavior => {
    const kind = ['customer', 'worker', 'designer', 'boss']
      .find((candidate) => runId.includes(`-${candidate}`));
    if (kind && runId.endsWith(`-${kind}-recovery`)) return harness.recoveryBehavior;
    if (kind && receiverBehaviors.has(kind)) return receiverBehaviors.get(kind)!;
    return behaviors.get(
      [...behaviors.keys()].find((projectId) => runId.includes(projectId)) ?? '',
    ) ?? 'completed';
  };

  const runReceiver = async (input: PeriodReportEntryInput) => {
    runReceiverCalls.push(`${input.projectId}:${input.receiver.kind}`);
    const behavior = receiverBehaviors.get(input.receiver.kind)
      ?? behaviors.get(input.projectId)
      ?? 'completed';
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
    discover: async (input) => {
      harness.discoverCalls += 1;
      if (harness.discoverError && input.projectId) throw harness.discoverError;
      return {
        enterpriseName: 'Test enterprise',
        skipReasons: [],
        projects: harness.plans,
        excludedProjects: 0,
      };
    },
    claimWeeklySchedule: async (input) => {
      harness.claimRequests.push({
        enterpriseId: input.enterpriseId,
        periodStart: input.period.periodStart,
        periodEnd: input.period.periodEnd,
      });
      return harness.claimResult;
    },
    ensureCustomerBinding: async () => harness.customerAvailable
      ? {
          available: true,
          reason: null,
          bindingId: 'binding-customer',
          conversationId: 'conversation-customer',
        }
      : {
          available: false,
          reason: 'customer_access_revoked',
          bindingId: null,
          conversationId: null,
        },
    runBatch: async (input) => {
      batchRequests.push(input.requestId);
      if (harness.batchDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, harness.batchDelayMs));
      }
      if (harness.failingEnterprise === input.enterpriseId) {
        throw new WorkflowOperationError(
          'tenant_batch_unavailable',
          503,
          'simulated tenant batch failure',
        );
      }
      const result = await runPeriodReportBatch(input, {
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
        observe: async ({ runId }) =>
          observationFor(
            runId,
            behaviorForRun(runId),
            harness.clock.toISOString(),
            readAt.get(runId) ?? null,
          ),
      });
      if (harness.failAfterBatchOnce) {
        harness.failAfterBatchOnce = false;
        // Simulate a host crash after the manifest/sub-runs were committed but
        // before the schedule entry recorded the batch.
        throw new WorkflowOperationError(
          'construction_forbidden',
          403,
          'simulated host interruption after the batch manifest',
        );
      }
      return result;
    },
    recoverReceiver: async (input) => {
      recoveryRequests.push(input.runId);
      const entryInput: PeriodReportEntryInput = {
        loadPublished: async () => published,
        enterpriseId: input.enterpriseId,
        projectId: input.projectId,
        actor: input.actor,
        event: input.event,
        receiver: input.receiver,
        ports: { execute: async () => ({}) },
        store: runStore,
        runId: input.runId,
      };
      const record = recordFor(entryInput, published, harness.recoveryBehavior, harness.clock);
      const created = await runStore.create(record);
      return { record: created.record };
    },
    portsFor: () => ({
      execute: async () => ({}),
    }),
    observeStatus: async ({ runId }) =>
      observationFor(
        runId,
        behaviorForRun(runId),
        harness.clock.toISOString(),
        readAt.get(runId) ?? null,
      ),
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

function runOf(harness: Harness, periodStart = '2026-11-02') {
  return harness.store.get(`schedule-${ENTERPRISE_ID}-weekly-${periodStart}`);
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
  const run = await runOf(harness);
  assert.ok(run?.weeklyClaim);
  assert.equal(run!.weeklyClaim!.periodStart, '2026-11-02');
  assert.equal(summary.enterprises[0]!.gate?.claimed, true);
});

test('one enterprise failure never stops the next allow-listed enterprise', async () => {
  const harness = await makeHarness();
  const failing = '999';
  const store = {
    ...harness.store,
    control: async (enterpriseId: string) => {
      if (enterpriseId === failing) {
        throw new WorkflowOperationError(
          'period_report_schedule_store_error',
          500,
          'simulated tenant store failure',
        );
      }
      return harness.store.control(enterpriseId);
    },
  };
  const summary = await runScheduledPeriodReportDispatch(
    options({ enterpriseIds: [failing, ENTERPRISE_ID] }),
    { ...harness.deps, store },
  );
  assert.equal(summary.enabled, true);
  assert.equal(summary.enterprises.length, 2);
  const failed = summary.enterprises[0]!;
  assert.equal(failed.enterpriseId, failing);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error?.code, 'period_report_schedule_store_error');
  assert.deepEqual(failed.dispatchedProjects, []);
  assert.deepEqual(failed.recoveredRuns, []);
  const healthy = summary.enterprises[1]!;
  assert.equal(healthy.enterpriseId, ENTERPRISE_ID);
  assert.equal(healthy.error, null);
  assert.equal(healthy.counts.completed, 1);
  assert.deepEqual(harness.batchRequests, [
    `schedule-${ENTERPRISE_ID}-${PROJECT_A}-weekly-2026-11-02`,
  ]);
});

test('two allow-listed enterprises get independent runs, requests and summaries', async () => {
  const harness = await makeHarness();
  const second = '1455';
  const summary = await runScheduledPeriodReportDispatch(
    options({ enterpriseIds: [ENTERPRISE_ID, second] }),
    harness.deps,
  );
  assert.equal(summary.enterprises.length, 2);
  assert.deepEqual(harness.batchRequests.slice().sort(), [
    `schedule-${ENTERPRISE_ID}-${PROJECT_A}-weekly-2026-11-02`,
    `schedule-${second}-${PROJECT_A}-weekly-2026-11-02`,
  ].sort());
  const firstRun = await harness.store.get(`schedule-${ENTERPRISE_ID}-weekly-2026-11-02`);
  const secondRun = await harness.store.get(`schedule-${second}-weekly-2026-11-02`);
  assert.ok(firstRun);
  assert.ok(secondRun);
  assert.notEqual(firstRun!.runId, secondRun!.runId);
  assert.deepEqual(summary.enterprises.map((entry) => entry.enterpriseId), [ENTERPRISE_ID, second]);
  for (const entry of summary.enterprises) {
    assert.equal(entry.counts.completed, 1);
    assert.equal(entry.error, null);
  }
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

test('a paused enterprise never blocks another enterprise in the same tick', async () => {
  const harness = await makeHarness();
  const pausedId = '998';
  await setScheduledPeriodReportPaused({
    enterpriseId: pausedId,
    paused: true,
    updatedBy: 'ops',
    reason: 'review',
    store: harness.store,
  });
  const summary = await runScheduledPeriodReportDispatch(
    options({ enterpriseIds: [pausedId, ENTERPRISE_ID] }),
    harness.deps,
  );
  const paused = summary.enterprises[0]!;
  assert.equal(paused.enterpriseId, pausedId);
  assert.equal(paused.paused, true);
  assert.equal(paused.status, 'missing');
  assert.deepEqual(paused.dispatchedProjects, []);
  const healthy = summary.enterprises[1]!;
  assert.equal(healthy.enterpriseId, ENTERPRISE_ID);
  assert.equal(healthy.counts.completed, 1);
  assert.deepEqual(harness.batchRequests, [
    `schedule-${ENTERPRISE_ID}-${PROJECT_A}-weekly-2026-11-02`,
  ]);
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

test('implemented work is routed to management confirmation, not the executor', async () => {
  const harness = await makeHarness();
  harness.issues = [{
    issueId: '9003',
    sourceRecordId: '5003',
    status: 'implemented',
    ownerId: WORKER,
    ownerName: 'Worker',
    lastResult: '已实施，待管理确认',
    updatedAt: '2026-11-08T01:00:00.000Z',
  }];
  await runScheduledPeriodReportDispatch(options(), harness.deps);
  assert.deepEqual(harness.reminders, [{ issueId: '9003', targetKind: 'boss', adminId: BOSS }]);
});

test('an assigned issue goes to its current owner, and the same issue cannot be reminded twice in one period', async () => {
  const harness = await makeHarness();
  harness.issues = [{
    issueId: '9004',
    sourceRecordId: '5004',
    status: 'awaiting_owner',
    ownerId: WORKER,
    ownerName: 'Worker',
    lastResult: '等待现场补充',
    updatedAt: '2026-11-08T01:00:00.000Z',
  }];
  await runScheduledPeriodReportDispatch(options(), harness.deps);
  await runScheduledPeriodReportDispatch(options(), harness.deps);
  assert.deepEqual(harness.reminders, [{ issueId: '9004', targetKind: 'worker', adminId: WORKER }]);
});

test('a revoked recipient is recorded as skipped without a message and no successful reminder', async () => {
  const harness = await makeHarness();
  harness.issues = [{
    issueId: '9005',
    sourceRecordId: '5005',
    status: 'awaiting_owner',
    ownerId: WORKER,
    ownerName: 'Worker',
    lastResult: '等待现场补充',
    updatedAt: '2026-11-08T01:00:00.000Z',
  }];
  const environment = harness.deps.environment;
  (harness.deps as { environment: PeriodReportScheduleEnvironment }).environment = {
    ...environment,
    sendReminder: async () => ({ sent: false, reason: 'recipient_unavailable', messageId: null }),
  };
  await runScheduledPeriodReportDispatch(options(), harness.deps);
  const entry = await entryOf(harness, PROJECT_A);
  const reminder = entry.reminders.find((item) => item.issueId === '9005');
  assert.equal(reminder?.status, 'skipped');
  assert.equal(reminder?.reason, 'recipient_unavailable');
  assert.equal(reminder?.messageId, null);
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

test('the weekly execution instant follows weekly_day and weekly_time', () => {
  // Monday 2026-11-09 00:00 Shanghai = end of the 2026-11-02..11-09 week.
  const periodEnd = new Date('2026-11-08T16:00:00.000Z');
  assert.equal(
    weeklyExecutionAt({ periodEnd, weeklyDay: 1, weeklyTime: '00:00' }).toISOString(),
    '2026-11-08T16:00:00.000Z',
  );
  assert.equal(
    weeklyExecutionAt({ periodEnd, weeklyDay: 1, weeklyTime: '08:00' }).toISOString(),
    '2026-11-09T00:00:00.000Z',
  );
  // Wednesday and Sunday are real later execution days, not "already ended".
  assert.equal(
    weeklyExecutionAt({ periodEnd, weeklyDay: 3, weeklyTime: '08:00' }).toISOString(),
    '2026-11-11T00:00:00.000Z',
  );
  assert.equal(
    weeklyExecutionAt({ periodEnd, weeklyDay: 7, weeklyTime: '08:00' }).toISOString(),
    '2026-11-15T00:00:00.000Z',
  );
});

test('a finished week before the configured weekly time creates no run or batch', async () => {
  const harness = await makeHarness();
  // Thursday 10:00 Shanghai, but the enterprise executes on Thursday 12:00.
  harness.setClaim(claimedWeekly({
    claimed: false,
    due: false,
    alreadyConsumed: false,
    dueAt: '2026-11-12T04:00:00.000Z',
    previousNextWeeklyAt: '2026-11-12T04:00:00.000Z',
    nextWeeklyAt: '2026-11-12T04:00:00.000Z',
  }));
  const summary = await runScheduledPeriodReportDispatch(options(), harness.deps);
  assert.equal(harness.claimRequests.length, 1);
  assert.equal(harness.claimRequests[0]!.periodStart, '2026-11-02');
  assert.equal(harness.batchRequests.length, 0);
  assert.equal(await runOf(harness), null);
  assert.equal(summary.enterprises[0]!.gate?.due, false);
  assert.equal(summary.enterprises[0]!.gate?.claimed, false);
  assert.equal(summary.enterprises[0]!.status, 'missing');
});

test('Monday 00:00 is the execution boundary for a 00:00 weekly time', async () => {
  const harness = await makeHarness();
  harness.setClock(new Date('2026-11-08T16:00:00.000Z'));
  const summary = await runScheduledPeriodReportDispatch(options(), harness.deps);
  assert.equal(summary.period.periodStart, '2026-11-02');
  assert.equal(summary.period.periodEnd, '2026-11-09');
  assert.equal(summary.enterprises[0]!.gate?.claimed, true);
  assert.equal(harness.batchRequests.length, 1);
});

test('a due slot that was already consumed never starts a second generation', async () => {
  const harness = await makeHarness();
  harness.setClaim(claimedWeekly({
    claimed: false,
    due: true,
    alreadyConsumed: true,
    dueAt: '2026-11-09T00:00:00.000Z',
    previousNextWeeklyAt: '2026-11-16T00:00:00.000Z',
    nextWeeklyAt: '2026-11-16T00:00:00.000Z',
  }));
  const summary = await runScheduledPeriodReportDispatch(options(), harness.deps);
  assert.equal(harness.batchRequests.length, 0);
  assert.equal(await runOf(harness), null);
  assert.equal(summary.enterprises[0]!.gate?.alreadyConsumed, true);
});

test('a claimed run keeps recovering and observing after next_weekly_at moved', async () => {
  const harness = await makeHarness({
    plans: [plan(PROJECT_A), plan(PROJECT_B)],
  });
  await runScheduledPeriodReportDispatch(options({ maxProjectsPerRound: 1 }), harness.deps);
  assert.deepEqual(harness.batchRequests, [
    `schedule-${ENTERPRISE_ID}-${PROJECT_A}-weekly-2026-11-02`,
  ]);
  let run = await runOf(harness);
  assert.ok(run?.weeklyClaim);

  // The claim already moved next_weekly_at into the next week. A later tick
  // must still dispatch the remaining project from the claimed run.
  harness.setClock(new Date('2026-11-12T02:20:00.000Z'));
  harness.setClaim(claimedWeekly({
    claimed: false,
    due: true,
    alreadyConsumed: true,
    previousNextWeeklyAt: '2026-11-16T00:00:00.000Z',
    nextWeeklyAt: '2026-11-16T00:00:00.000Z',
  }));
  await runScheduledPeriodReportDispatch(options({ maxProjectsPerRound: 1 }), harness.deps);
  assert.equal(harness.batchRequests.length, 2);
  run = await runOf(harness);
  assert.equal(run!.projects[PROJECT_B]!.state, 'completed');

  // Read receipts keep being observed for the claimed run.
  for (const entry of Object.values(run!.projects)) {
    for (const receiver of entry.receivers) {
      harness.setReadAt(receiver.runId, '2026-11-12T09:00:00.000Z');
    }
  }
  harness.setClock(new Date('2026-11-12T13:00:00.000Z'));
  const third = await runScheduledPeriodReportDispatch(
    options({ maxProjectsPerRound: 2 }),
    harness.deps,
  );
  assert.deepEqual([...third.enterprises[0]!.observedProjects].sort(), [PROJECT_A, PROJECT_B]);
  run = await runOf(harness);
  assert.equal(
    Object.values(run!.projects).every((entry) =>
      entry.receivers.every((receiver) => receiver.readAt === '2026-11-12T09:00:00.000Z')),
    true,
  );
});

test('an explicit old-period replay never claims or moves the current weekly slot', async () => {
  const harness = await makeHarness();
  const summary = await runScheduledPeriodReportDispatch(
    options({ periodStart: '2026-10-26' }),
    harness.deps,
  );
  assert.equal(harness.claimRequests.length, 0);
  assert.equal(summary.enterprises[0]!.gate, null);
  assert.equal(harness.batchRequests.length, 1);
  const run = await runOf(harness, '2026-10-26');
  assert.ok(run);
  assert.equal(run!.weeklyClaim, null);
  assert.equal(
    run!.audit.some((entry) => entry.action === 'replay_without_claim'),
    true,
  );
});

test('a claim configuration failure blocks the run without a batch', async () => {
  const harness = await makeHarness();
  harness.setClaim(claimedWeekly({
    claimed: false,
    due: false,
    reason: 'plan_disabled',
  }));
  const summary = await runScheduledPeriodReportDispatch(options(), harness.deps);
  assert.equal(harness.batchRequests.length, 0);
  assert.equal(await runOf(harness), null);
  assert.equal(summary.enterprises[0]!.error?.code, 'plan_disabled');
  assert.equal(summary.enterprises[0]!.gate?.reason, 'plan_disabled');
});

test('a missing receiver recovers after the fast recheck budget', async () => {
  const harness = await makeHarness({
    plans: [plan(PROJECT_A, { workerAdminId: null, skipReasons: ['worker_missing'] })],
  });
  await runScheduledPeriodReportDispatch(
    options({ recheckLimit: 1, recheckIntervalMs: 60_000 }),
    harness.deps,
  );
  assert.equal(harness.batchRequests.length, 0);
  let entry = await entryOf(harness, PROJECT_A);
  assert.equal(entry.state, 'needs_attention');
  assert.equal(entry.recheckCount, 0);

  harness.setClock(new Date('2026-11-12T02:02:00.000Z'));
  await runScheduledPeriodReportDispatch(
    options({ recheckLimit: 1, recheckIntervalMs: 60_000 }),
    harness.deps,
  );
  entry = await entryOf(harness, PROJECT_A);
  assert.equal(entry.state, 'needs_attention');
  assert.equal(entry.recheckCount, 1);
  assert.ok(new Date(entry.nextObservationAt!).getTime() > harness.clock.getTime());

  // A real database fix after the fast budget is still discoverable.
  harness.plans = [plan(PROJECT_A)];
  harness.setClock(new Date('2026-11-12T08:03:00.000Z'));
  await runScheduledPeriodReportDispatch(
    options({ recheckLimit: 1, recheckIntervalMs: 60_000 }),
    harness.deps,
  );
  entry = await entryOf(harness, PROJECT_A);
  assert.equal(entry.state, 'completed');
  assert.equal(harness.batchRequests.length, 1);
});

for (const recovery of [
  {
    name: 'worker_missing',
    before: plan(PROJECT_A, { workerAdminId: null, skipReasons: ['worker_missing'] }),
  },
  {
    name: 'designer_missing',
    before: plan(PROJECT_A, { designerAdminId: null, skipReasons: ['designer_missing'] }),
  },
  {
    name: 'boss_missing',
    before: plan(PROJECT_A, { bossAdminId: null, skipReasons: ['boss_missing'] }),
  },
  {
    name: 'executor_missing',
    before: plan(PROJECT_A, { executorAdminId: null, skipReasons: ['executor_missing'] }),
  },
  {
    name: 'customer_access_revoked',
    before: plan(PROJECT_A, { customerAccess: false, skipReasons: ['customer_access_revoked'] }),
  },
] as const) {
  test(`a pre-dispatch ${recovery.name} recovers from current business permissions`, async () => {
    const harness = await makeHarness({ plans: [recovery.before] });
    await runScheduledPeriodReportDispatch(options(), harness.deps);
    assert.equal(harness.batchRequests.length, 0);
    assert.equal((await entryOf(harness, PROJECT_A))!.state, 'needs_attention');
    harness.plans = [plan(PROJECT_A)];
    harness.setClock(new Date('2026-11-12T02:20:00.000Z'));
    await runScheduledPeriodReportDispatch(options(), harness.deps);
    const entry = await entryOf(harness, PROJECT_A);
    assert.equal(entry.state, 'completed');
    assert.equal(harness.batchRequests.length, 1);
  });
}

test('a frozen batch keeps its reports when the customer permission is revoked and restored', async () => {
  const harness = await makeHarness();
  await runScheduledPeriodReportDispatch(options(), harness.deps);
  const first = await entryOf(harness, PROJECT_A);
  assert.equal(first.state, 'completed');
  assert.equal(first.receivers.length, 4);
  const receiptIds = first.receivers.map((receiver) => receiver.reportId);

  harness.setCustomerAvailable(false);
  harness.setClock(new Date('2026-11-12T09:00:00.000Z'));
  await runScheduledPeriodReportDispatch(options(), harness.deps);
  let entry = await entryOf(harness, PROJECT_A);
  assert.equal(entry.state, 'needs_attention');
  assert.equal(entry.reason, 'customer_access_revoked');
  assert.deepEqual(entry.receivers.map((receiver) => receiver.reportId), receiptIds);
  assert.equal(harness.batchRequests.length, 1);

  harness.setCustomerAvailable(true);
  harness.setClock(new Date('2026-11-12T09:20:00.000Z'));
  await runScheduledPeriodReportDispatch(options(), harness.deps);
  entry = await entryOf(harness, PROJECT_A);
  assert.equal(entry.state, 'completed');
  assert.deepEqual(entry.receivers.map((receiver) => receiver.reportId), receiptIds);
  assert.equal(harness.batchRequests.length, 2);
  assert.equal(harness.runReceiverCalls.length, 4);
});

test('a source-revoked designer report is replaced by one recovery run, never counted as delivered', async () => {
  const harness = await makeHarness();
  harness.setReceiverBehavior('designer', 'source_unavailable');
  harness.recoveryBehavior = 'pending';
  await runScheduledPeriodReportDispatch(options(), harness.deps);

  let entry = await entryOf(harness, PROJECT_A);
  assert.equal(entry.state, 'needs_attention');
  const oldDesigner = entry.receivers.find((receiver) => receiver.kind === 'designer')!;
  assert.equal(oldDesigner.state, 'unavailable');
  assert.equal(oldDesigner.reason, 'source_project_revoked');
  assert.equal(oldDesigner.deliveryState, 'delivered');
  assert.ok(oldDesigner.reportId);

  // The next due observation replaces the revoked report under a deterministic
  // recovery run id.
  harness.setClock(new Date('2026-11-12T02:20:00.000Z'));
  await runScheduledPeriodReportDispatch(options(), harness.deps);
  entry = await entryOf(harness, PROJECT_A);
  assert.equal(harness.recoveryRequests.length, 1);
  assert.equal(
    harness.recoveryRequests[0],
    `${entry.requestId}-designer-recovery`,
  );
  let designer = entry.receivers.find((receiver) => receiver.kind === 'designer')!;
  assert.equal(entry.state, 'waiting_delivery');
  assert.equal(designer.state, 'processing');
  assert.equal(designer.reportId, `report-${harness.recoveryRequests[0]}`);
  assert.equal(designer.superseded?.reportId, oldDesigner.reportId);
  assert.equal(designer.superseded?.revision, oldDesigner.revision);
  assert.equal(designer.superseded?.readAt, null);
  assert.notEqual(designer.reportId, oldDesigner.reportId);
  assert.notEqual(designer.runId, oldDesigner.runId);

  // The recovery run completes; the project is completed only from the active
  // views, not from the old manifest's delivered receipt.
  harness.recoveryBehavior = 'completed';
  harness.setClock(new Date('2026-11-12T02:40:00.000Z'));
  await runScheduledPeriodReportDispatch(options(), harness.deps);
  entry = await entryOf(harness, PROJECT_A);
  assert.equal(entry.state, 'completed');
  designer = entry.receivers.find((receiver) => receiver.kind === 'designer')!;
  assert.equal(designer.state, 'completed');
  assert.equal(designer.reportId, `report-${harness.recoveryRequests[0]}`);
  assert.equal(designer.superseded?.reportId, oldDesigner.reportId);
  assert.equal(designer.readAt, null);
  assert.equal(harness.recoveryRequests.length, 1);

  // A later tick observes again but never creates another recovery or revision.
  harness.setClock(new Date('2026-11-12T08:20:00.000Z'));
  await runScheduledPeriodReportDispatch(options(), harness.deps);
  entry = await entryOf(harness, PROJECT_A);
  assert.equal(harness.recoveryRequests.length, 1);
  assert.equal(entry.state, 'completed');
});

test('a frozen batch keeps its original receivers when identities change', async () => {
  const harness = await makeHarness();
  harness.failAfterBatchOnce = true;
  await runScheduledPeriodReportDispatch(options(), harness.deps);
  assert.equal(harness.batchRequests.length, 1);
  const run = await runOf(harness);
  let entry = run!.projects[PROJECT_A]!;
  assert.equal(entry.state, 'needs_attention');
  assert.equal(entry.plan.workerAdminId, WORKER);

  // Both the database and the local plan now offer a different worker. The
  // existing manifest must keep the original receiver and must not be rewritten.
  harness.plans = [plan(PROJECT_A, { workerAdminId: '1454000099' })];
  await harness.store.update({
    ...run!,
    projects: {
      ...run!.projects,
      [PROJECT_A]: {
        ...entry,
        plan: plan(PROJECT_A, { workerAdminId: '1454000099' }),
      },
    },
  });
  harness.setClock(new Date('2026-11-12T02:20:00.000Z'));
  await runScheduledPeriodReportDispatch(options(), harness.deps);
  entry = (await entryOf(harness, PROJECT_A))!;
  assert.equal(entry.plan.workerAdminId, WORKER);
  assert.equal(entry.state, 'completed');
  assert.equal(harness.runReceiverCalls.length, 4);
  assert.equal(harness.batchRequests.length, 2);
});

// ---------------------------------------------------------------------------
// B5.6 multi-tenant weekly scheduler reliability and recovery
// ---------------------------------------------------------------------------

const WEEK_START = '2026-11-02';

function weeklyRunId(enterpriseId: string, periodStart = WEEK_START): string {
  return `schedule-${enterpriseId}-weekly-${periodStart}`;
}

test('weeks crossing a month and a year boundary stay Monday-to-Monday', () => {
  const month = resolveEndedShanghaiWeek(new Date('2026-12-07T01:00:00.000Z'));
  assert.deepEqual(
    { periodStart: month.periodStart, periodEnd: month.periodEnd },
    { periodStart: '2026-11-30', periodEnd: '2026-12-07' },
  );
  assert.equal(month.startAt, '2026-11-29T16:00:00.000Z');
  assert.equal(month.endAt, '2026-12-06T16:00:00.000Z');

  const year = resolveScheduledPeriod(new Date('2027-01-04T01:00:00.000Z'));
  assert.deepEqual(
    { periodStart: year.periodStart, periodEnd: year.periodEnd },
    { periodStart: '2026-12-28', periodEnd: '2027-01-04' },
  );
  assert.equal(year.endAt, '2027-01-03T16:00:00.000Z');

  // Monday 00:00 Shanghai is exactly the right-open end of the prior week.
  const boundary = resolveEndedShanghaiWeek(new Date('2027-01-03T16:00:00.000Z'));
  assert.equal(boundary.periodEnd, '2027-01-04');
  assert.equal(boundary.periodStart, '2026-12-28');
});

test('two tenants run their own weekly schedule concurrently without sharing state', async () => {
  const harness = await makeHarness();
  harness.batchDelayMs = 5;
  const second = '1455';
  const [first, other] = await Promise.all([
    runScheduledPeriodReportDispatch(options(), harness.deps),
    runScheduledPeriodReportDispatch(options({ enterpriseIds: [second] }), harness.deps),
  ]);

  const firstRun = await runOf(harness);
  const secondRun = await harness.store.get(weeklyRunId(second));
  assert.ok(firstRun);
  assert.ok(secondRun);
  assert.equal(firstRun!.enterpriseId, ENTERPRISE_ID);
  assert.equal(secondRun!.enterpriseId, second);
  assert.notEqual(firstRun!.runId, secondRun!.runId);
  // No project entry or trace ever crosses the tenant boundary.
  assert.deepEqual(Object.keys(firstRun!.projects), [PROJECT_A]);
  assert.deepEqual(Object.keys(secondRun!.projects), [PROJECT_A]);
  assert.deepEqual([...new Set(first.traces.map((trace) => trace.tenantId))], [ENTERPRISE_ID]);
  assert.deepEqual([...new Set(other.traces.map((trace) => trace.tenantId))], [second]);
  assert.deepEqual(harness.batchRequests.sort(), [
    `schedule-${ENTERPRISE_ID}-${PROJECT_A}-weekly-${WEEK_START}`,
    `schedule-${second}-${PROJECT_A}-weekly-${WEEK_START}`,
  ].sort());
  assert.equal(first.enterprises[0]!.counts.completed, 1);
  assert.equal(other.enterprises[0]!.counts.completed, 1);
});

test('one tenant batch failure never affects another tenant in the same tick', async () => {
  const harness = await makeHarness();
  const failing = '1455';
  harness.failingEnterprise = failing;
  const summary = await runScheduledPeriodReportDispatch(
    options({ enterpriseIds: [failing, ENTERPRISE_ID] }),
    harness.deps,
  );

  const failed = summary.enterprises[0]!;
  const healthy = summary.enterprises[1]!;
  assert.equal(failed.enterpriseId, failing);
  assert.equal(failed.status, 'failed');
  assert.equal(healthy.enterpriseId, ENTERPRISE_ID);
  assert.equal(healthy.status, 'observing');
  assert.equal(healthy.counts.completed, 1);
  assert.equal(healthy.error, null);

  const failedRun = await harness.store.get(weeklyRunId(failing));
  assert.ok(failedRun);
  assert.equal(failedRun!.status, 'failed');
  assert.equal(failedRun!.projects[PROJECT_A]!.state, 'failed');
  assert.equal(failedRun!.projects[PROJECT_A]!.errorCode, 'tenant_batch_unavailable');
  const healthyRun = await runOf(harness);
  assert.equal(healthyRun!.status, 'observing');
  assert.equal(healthyRun!.projects[PROJECT_A]!.state, 'completed');
});

test('the same weekly window triggered concurrently dispatches each job once', async () => {
  const harness = await makeHarness();
  harness.batchDelayMs = 10;
  const results = await Promise.all([
    runScheduledPeriodReportDispatch(options(), harness.deps),
    runScheduledPeriodReportDispatch(options(), harness.deps),
  ]);
  assert.deepEqual(harness.batchRequests, [
    `schedule-${ENTERPRISE_ID}-${PROJECT_A}-weekly-${WEEK_START}`,
  ]);
  const run = await runOf(harness);
  assert.equal(run!.weeklyClaim?.periodStart, WEEK_START);
  assert.equal(run!.projects[PROJECT_A]!.state, 'completed');
  assert.equal(run!.projects[PROJECT_A]!.dispatchAttempts, 1);
  // At most one tick does the work; the other observes the held lease.
  assert.equal(results.some((result) => result.enterprises[0]!.busy), true);
});

test('a crashed worker lease is taken over after its TTL and the job runs once', async () => {
  const harness = await makeHarness();
  const runId = weeklyRunId(ENTERPRISE_ID);
  const t0 = new Date(NOW);
  assert.equal(
    await harness.store.acquire(runId, { owner: 'dead-worker', now: () => t0, ttlMs: 60_000 }),
    true,
  );

  const blocked = await runScheduledPeriodReportDispatch(options(), harness.deps);
  assert.equal(blocked.enterprises[0]!.busy, true);
  assert.equal(harness.batchRequests.length, 0);

  harness.setClock(new Date(NOW.getTime() + 61_000));
  const recovered = await runScheduledPeriodReportDispatch(options(), harness.deps);
  assert.equal(recovered.enterprises[0]!.busy, false);
  assert.equal(harness.batchRequests.length, 1);

  await runScheduledPeriodReportDispatch(options(), harness.deps);
  assert.equal(harness.batchRequests.length, 1);
  const run = await runOf(harness);
  assert.equal(run!.workerId?.startsWith(`${process.pid}:`), true);
  assert.equal(run!.projects[PROJECT_A]!.state, 'completed');
});

test('a retry after a host crash reuses the frozen batch instead of repeating work', async () => {
  const harness = await makeHarness();
  harness.failAfterBatchOnce = true;
  await runScheduledPeriodReportDispatch(options(), harness.deps);
  const receiverCalls = harness.runReceiverCalls.length;
  assert.equal(receiverCalls, 4);
  assert.equal(harness.batchRequests.length, 1);
  let entry = await entryOf(harness, PROJECT_A);
  assert.equal(entry.errorCode, 'construction_forbidden');

  harness.setClock(new Date(NOW.getTime() + 20 * 60_000));
  await runScheduledPeriodReportDispatch(options(), harness.deps);
  entry = await entryOf(harness, PROJECT_A);
  assert.equal(harness.batchRequests.length, 2);
  // The manifest was frozen by the first attempt; the retry must not re-run
  // receivers or produce a second report.
  assert.equal(harness.runReceiverCalls.length, receiverCalls);
  assert.equal(entry.state, 'completed');
  // The retry observed the already frozen batch; no second dispatch happened.
  assert.equal(entry.dispatchAttempts, 1);
});

test('a cancelled period dispatches and observes nothing afterwards', async () => {
  const harness = await makeHarness({ plans: [plan(PROJECT_A), plan(PROJECT_B)] });
  await runScheduledPeriodReportDispatch(
    options({ maxProjectsPerRound: 1 }),
    harness.deps,
  );
  assert.equal(harness.batchRequests.length, 1);

  const cancelled = await cancelScheduledPeriodReport({
    enterpriseId: ENTERPRISE_ID,
    periodStart: WEEK_START,
    updatedBy: 'tester',
    reason: 'tenant cancelled this week',
    store: harness.store,
    now: () => harness.clock,
  });
  assert.deepEqual(cancelled.control.cancelledPeriods, [WEEK_START]);
  assert.equal(cancelled.run?.status, 'cancelled');
  assert.equal(cancelled.run?.cancelReason, 'tenant cancelled this week');
  assert.ok(cancelled.run?.cancelledAt);

  harness.setClock(new Date(NOW.getTime() + 20 * 60_000));
  const summary = await runScheduledPeriodReportDispatch(
    options({ maxProjectsPerRound: 1 }),
    harness.deps,
  );
  assert.equal(harness.batchRequests.length, 1);
  assert.equal(summary.enterprises[0]!.status, 'cancelled');
  const run = await runOf(harness);
  assert.equal(run!.status, 'cancelled');
  // The undelivered second project has no entry yet, so cancellation left it
  // exactly where it was: never dispatched.
  assert.deepEqual(Object.keys(run!.projects), [PROJECT_A]);
  assert.deepEqual((await harness.store.control(ENTERPRISE_ID)).cancelledPeriods, [WEEK_START]);
});

test('a permanent recheck failure stops retrying instead of looping', async () => {
  const harness = await makeHarness({
    plans: [plan(PROJECT_A, { workerAdminId: null, skipReasons: ['worker_missing'] })],
  });
  await runScheduledPeriodReportDispatch(
    options({ recheckIntervalMs: 60_000 }),
    harness.deps,
  );
  let entry = await entryOf(harness, PROJECT_A);
  assert.equal(entry.state, 'needs_attention');
  assert.equal(harness.batchRequests.length, 0);

  harness.discoverError = new WorkflowOperationError(
    'construction_not_found',
    404,
    'the project was removed',
  );
  harness.setClock(new Date(NOW.getTime() + 2 * 60_000));
  await runScheduledPeriodReportDispatch(
    options({ recheckIntervalMs: 60_000 }),
    harness.deps,
  );
  entry = await entryOf(harness, PROJECT_A);
  assert.equal(entry.state, 'failed');
  assert.equal(entry.errorCode, 'construction_not_found');
  assert.equal(entry.nextObservationAt, null);

  const calls = harness.discoverCalls;
  harness.setClock(new Date(NOW.getTime() + 6 * 3_600_000));
  await runScheduledPeriodReportDispatch(options(), harness.deps);
  assert.equal(harness.discoverCalls, calls);
  assert.equal(harness.batchRequests.length, 0);
});

test('an unfinished run expires when the bounded recovery window closes', async () => {
  const harness = await makeHarness({ behavior: 'pending' });
  await runScheduledPeriodReportDispatch(options(), harness.deps);
  let run = await runOf(harness);
  assert.equal(run!.status, 'observing');
  assert.equal(run!.projects[PROJECT_A]!.state, 'waiting_delivery');

  harness.setClock(new Date('2026-11-16T00:00:01.000Z'));
  await runScheduledPeriodReportDispatch(options(), harness.deps);
  run = await runOf(harness);
  assert.equal(run!.status, 'expired');
  assert.equal(run!.finishedAt !== null, true);
  assert.equal(run!.projects[PROJECT_A]!.nextObservationAt, null);

  const receiverCalls = harness.runReceiverCalls.length;
  await runScheduledPeriodReportDispatch(options(), harness.deps);
  assert.equal(harness.runReceiverCalls.length, receiverCalls);
  run = await runOf(harness);
  assert.equal(run!.status, 'expired');
});

test('a new week never overwrites the previous week run or its requests', async () => {
  const harness = await makeHarness();
  await runScheduledPeriodReportDispatch(options(), harness.deps);
  const first = await runOf(harness);
  assert.ok(first);

  harness.setClock(new Date('2026-11-16T02:00:00.000Z'));
  await runScheduledPeriodReportDispatch(options(), harness.deps);

  const previous = await runOf(harness, WEEK_START);
  assert.equal(previous!.runId, first!.runId);
  assert.equal(previous!.period.periodStart, WEEK_START);
  assert.equal(previous!.period.endAt, first!.period.endAt);
  assert.equal(previous!.startedAt, first!.startedAt);
  assert.equal(previous!.weeklyClaim?.claimedAt, first!.weeklyClaim?.claimedAt);
  assert.equal(
    previous!.projects[PROJECT_A]!.requestId,
    `schedule-${ENTERPRISE_ID}-${PROJECT_A}-weekly-${WEEK_START}`,
  );

  const next = await runOf(harness, '2026-11-09');
  assert.ok(next);
  assert.notEqual(next!.runId, previous!.runId);
  assert.equal(
    next!.projects[PROJECT_A]!.requestId,
    `schedule-${ENTERPRISE_ID}-${PROJECT_A}-weekly-2026-11-09`,
  );
});

test('a run file carrying another tenant is refused and never advanced', async () => {
  const harness = await makeHarness();
  const foreign = '9999';
  const tampered = {
    runVersion: SCHEDULE_RUN_VERSION,
    runId: weeklyRunId(ENTERPRISE_ID),
    enterpriseId: foreign,
    period: {
      kind: 'weekly' as const,
      periodStart: WEEK_START,
      periodEnd: '2026-11-09',
      startAt: '2026-11-01T16:00:00.000Z',
      endAt: '2026-11-08T16:00:00.000Z',
    },
    weeklyClaim: {
      periodStart: WEEK_START,
      claimedAt: '2026-11-09T00:00:00.000Z',
      previousNextWeeklyAt: null,
      nextWeeklyAt: '2026-11-16T00:00:00.000Z',
    },
    published: null,
    status: 'discovered' as const,
    queue: [],
    projects: {},
    counts: emptyCounts(),
    startedAt: '2026-11-12T02:00:00.000Z',
    updatedAt: '2026-11-12T02:00:00.000Z',
    finishedAt: null,
    lastError: null,
    audit: [],
  };
  await harness.store.create(tampered);

  const second = '1455';
  const summary = await runScheduledPeriodReportDispatch(
    options({ enterpriseIds: [ENTERPRISE_ID, second] }),
    harness.deps,
  );
  assert.equal(summary.enterprises[0]!.status, 'failed');
  assert.equal(summary.enterprises[0]!.error?.code, 'period_report_schedule_forbidden');
  assert.equal(summary.enterprises[1]!.counts.completed, 1);
  assert.deepEqual(harness.batchRequests, [
    `schedule-${second}-${PROJECT_A}-weekly-${WEEK_START}`,
  ]);
  const untouched = await harness.store.get(weeklyRunId(ENTERPRISE_ID));
  assert.equal(untouched!.enterpriseId, foreign);
  assert.equal(untouched!.status, 'discovered');
  assert.deepEqual(untouched!.projects, {});
  assert.equal(untouched!.updatedAt, tampered.updatedAt);
});

test('scheduler traces expose the required fields and redact tenant content', async () => {
  const harness = await makeHarness();
  harness.issues = [{
    issueId: '9010',
    sourceRecordId: '5010',
    status: 'awaiting_owner',
    ownerId: WORKER,
    ownerName: 'Worker Name',
    lastResult: '敏感业务正文：业主家墙面渗水',
    updatedAt: '2026-11-08T01:00:00.000Z',
  }];
  const summary = await runScheduledPeriodReportDispatch(options(), harness.deps);

  assert.equal(summary.traces.length, 1);
  assert.equal(summary.runs.length, 1);
  const job = summary.traces[0]!;
  assert.equal(job.tenantId, ENTERPRISE_ID);
  assert.equal(job.scheduleId, weeklyRunId(ENTERPRISE_ID));
  assert.equal(job.jobId, `schedule-${ENTERPRISE_ID}-${PROJECT_A}-weekly-${WEEK_START}`);
  assert.equal(job.projectId, PROJECT_A);
  assert.equal(job.periodStart, WEEK_START);
  assert.equal(job.periodEnd, '2026-11-09');
  assert.equal(job.plannedAt, '2026-11-09T00:00:00.000Z');
  assert.ok(job.dispatchedAt);
  assert.ok(job.observedAt);
  assert.equal(job.workerId?.startsWith(`${process.pid}:`), true);
  assert.equal(job.state, 'completed');
  assert.equal(job.attempts, 1);
  assert.equal(job.retryCount, 0);
  assert.equal(job.failureCode, null);

  const runTrace = summary.runs[0]!;
  assert.equal(runTrace.tenantId, ENTERPRISE_ID);
  assert.equal(runTrace.scheduleId, weeklyRunId(ENTERPRISE_ID));
  // Delivered but unread reports stay in the bounded read-observation window.
  assert.equal(runTrace.status, 'observing');
  assert.equal(runTrace.claimedAt, NOW.toISOString());
  assert.equal(runTrace.nextWeeklyAt, '2026-11-16T00:00:00.000Z');
  assert.equal(runTrace.workerId, job.workerId);
  assert.equal(runTrace.counts.completed, 1);

  const serialized = JSON.stringify(summary);
  assert.equal(serialized.includes(`project-${PROJECT_A}`), false);
  assert.equal(serialized.includes('敏感业务正文'), false);
  assert.equal(serialized.includes(WORKER), false);
});

test('the read-only schedule query returns the same redacted traces without dispatching', async () => {
  const harness = await makeHarness();
  await runScheduledPeriodReportDispatch(options(), harness.deps);
  const before = harness.batchRequests.length;
  const read = await readScheduledPeriodReportDispatch({
    enterpriseId: ENTERPRISE_ID,
    store: harness.store,
    periodStart: WEEK_START,
  });
  assert.equal(harness.batchRequests.length, before);
  assert.equal(read.runTrace?.status, 'observing');
  assert.equal(read.traces.length, 1);
  assert.equal(read.traces[0]!.jobId, `schedule-${ENTERPRISE_ID}-${PROJECT_A}-weekly-${WEEK_START}`);

  await assert.rejects(
    () => readScheduledPeriodReportDispatch({
      enterpriseId: '1455',
      store: harness.store,
      runId: weeklyRunId(ENTERPRISE_ID),
    }),
    (error: unknown) => error instanceof WorkflowOperationError
      && error.code === 'period_report_schedule_forbidden',
  );
});
