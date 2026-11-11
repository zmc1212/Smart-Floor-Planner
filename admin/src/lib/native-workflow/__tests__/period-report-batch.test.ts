import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { ConstructionActor } from '@/lib/construction/contracts';
import { WorkflowOperationError } from '../errors';
import {
  createMemoryPeriodReportBatchStore,
  createFilePeriodReportBatchStore,
} from '../live/period-report-batch-store';
import {
  runPeriodReportBatch,
  type PeriodReportBatchDependencies,
  type PeriodReportBatchInput,
  type PeriodReportBatchManifest,
  type PeriodReportBatchReceiver,
} from '../live/period-report-batch';
import type { PeriodReportBatchPlanEvidence } from '../live/period-report-batch-preflight';
import { parseFixedPeriod } from '../live/period-event';
import type { PeriodReportEntryInput } from '../live/period-report-entry';
import type {
  PeriodOverallState,
  PeriodReportRunObservation,
} from '../live/period-report-status';
import { runPublishedLive } from '../live/runner';
import { createMemoryWorkflowRunStore } from '../live/run-store';
import {
  LiveOperationFailure,
  LiveOperationUnknownError,
  type LiveOperationPorts,
  type LivePeriodReceiver,
} from '../live/types';
import { createWorkflowService } from '../service';
import { createMemoryWorkflowStore } from '../store/memory-store';
import type { PublishedWorkflowVersion } from '../store/types';
import type { TriggerEvent, WorkflowValue } from '../types';

const ENTERPRISE_ID = '1454';
const PROJECT_ID = '1454000004';
const EXECUTOR_ADMIN = '1454000001';
const WORKER_ADMIN = '1454000008';
const DESIGNER_ADMIN = '1454000011';
const BOSS_ADMIN = '1454000013';
const REQUEST_ID = 'b5-8-joint-test-1';
const NOW = new Date('2026-11-12T02:00:00.000Z');

const actor: ConstructionActor = { enterpriseId: ENTERPRISE_ID, adminId: EXECUTOR_ADMIN };

/** Complete Shanghai week 2026-10-19..2026-10-26, right-open. */
const weeklyEvent: TriggerEvent = {
  eventId: 'b5-period-weekly-2026-10-19',
  eventType: 'period_report',
  occurredAt: '2026-10-26T10:00:00.000Z',
  periodKind: 'weekly',
  periodStart: '2026-10-19',
  periodEnd: '2026-10-26',
};

const receivers: PeriodReportBatchReceiver[] = [
  { kind: 'customer' },
  { kind: 'worker', adminId: WORKER_ADMIN },
  { kind: 'designer', adminId: DESIGNER_ADMIN },
  { kind: 'boss', adminId: BOSS_ADMIN },
];

const RECEIVER_BINDING: Record<string, { bindingId: string; conversationId: string }> = {
  customer: { bindingId: '1', conversationId: '1454000007' },
  worker: { bindingId: '2', conversationId: '1454000008' },
  designer: { bindingId: '3', conversationId: '1454000009' },
  boss: { bindingId: '4', conversationId: '1454000010' },
};

type Behavior =
  | 'delivered'
  | 'pending'
  | 'save_unavailable'
  | 'read_failed'
  | 'unknown';

const planEvidence: PeriodReportBatchPlanEvidence = {
  enabled: true,
  stageEnabled: false,
  projectIds: [PROJECT_ID],
  audiences: ['customer', 'worker', 'designer', 'boss'],
  nextDailyAt: '2099-01-01T00:00:00.000Z',
  nextWeeklyAt: '2099-01-01T00:00:00.000Z',
  executor: { owner: true, memberRole: null },
};

async function publishWeekly(): Promise<PublishedWorkflowVersion> {
  const service = createWorkflowService({
    store: createMemoryWorkflowStore(),
    now: () => '2026-11-12T01:00:00.000Z',
  });
  await service.createFromTemplate('period-report-weekly');
  const published = await service.publishDraft({
    definitionId: 'period-report-weekly',
    expectedDraftRevision: 1,
  });
  return published.version;
}

function fakePorts(
  receiver: LivePeriodReceiver,
  behavior: Behavior,
): LiveOperationPorts {
  const binding = RECEIVER_BINDING[receiver.kind]!;
  return {
    async execute(operation): Promise<Readonly<Record<string, WorkflowValue>>> {
      switch (operation.capabilityRef) {
        case 'read.period_records':
          if (behavior === 'read_failed') {
            throw new LiveOperationFailure({
              code: 'construction_forbidden',
              path: `nodes.${operation.nodeId}`,
              message: 'the test rejects the period read',
            });
          }
          return { records: [], recordCount: 0, hasRecords: false };
        case 'read.authorized_photos':
          return { photos: [], photoCount: 0 };
        case 'read.receiver_scope':
          return {
            receivers: receiver.kind === 'customer'
              ? {
                  scope: 'project_customer',
                  projectId: PROJECT_ID,
                  bindingId: binding.bindingId,
                  conversationId: binding.conversationId,
                  customerUserId: '1454000002',
                  audience: 'customer',
                }
              : {
                  scope: `enterprise_${receiver.kind}`,
                  projectId: PROJECT_ID,
                  bindingId: binding.bindingId,
                  conversationId: binding.conversationId,
                  [`${receiver.kind}AdminId`]: receiver.adminId,
                  audience: receiver.kind,
                },
            receiverCount: 1,
          };
        case 'compose.period_report':
          return {
            title: '施工周报 · 2026-10-19 ~ 2026-10-26',
            body: `${receiver.kind} report`,
            missingItems: [],
          };
        case 'save.period_report':
          if (behavior === 'save_unavailable') {
            throw new LiveOperationFailure({
              code: 'period_report_receiver_unavailable',
              path: `nodes.${operation.nodeId}`,
              message: 'period report receiver is customer_access_revoked',
            });
          }
          if (behavior === 'unknown') {
            throw new LiveOperationUnknownError({
              code: 'live_operation_unknown',
              path: `nodes.${operation.nodeId}`,
              message: 'the test lost the enqueue outcome',
            });
          }
          return {
            saved: true,
            saveReceipt: {
              receiptId: `report:${receiver.kind}:1`,
              simulated: false,
              source: 'construction_reports',
              reportId: `${receiver.kind}-report`,
              revision: 1,
              runId: `${receiver.kind}-facts-run`,
              reportKey: `${receiver.kind}-report-key`,
              bindingId: binding.bindingId,
              conversationId: binding.conversationId,
              reused: false,
              receiverKind: receiver.kind,
              receiverAdminId: receiver.kind === 'customer' ? null : receiver.adminId,
              projectScope: [PROJECT_ID],
            },
          };
        case 'deliver.inapp':
          if (behavior === 'delivered') {
            return {
              delivered: true,
              deliveryReceipt: {
                receiptId: `report-delivery:${receiver.kind}:1:${binding.bindingId}`,
                simulated: false,
                source: 'construction_report_deliveries',
                reportId: `${receiver.kind}-report`,
                revision: 1,
                status: 'delivered',
                messageId: `${receiver.kind}-message`,
                conversationId: binding.conversationId,
                deliveredAt: '2026-11-12T03:00:00.000Z',
              },
            };
          }
          return {
            delivered: false,
            deliveryReceipt: {
              receiptId: '',
              simulated: false,
              source: 'construction_report_deliveries',
              status: 'not_enqueued',
              reportId: `${receiver.kind}-report`,
              revision: 1,
            },
          };
        default:
          throw new LiveOperationFailure({
            code: 'unsupported_live_capability',
            path: `nodes.${operation.nodeId}`,
            message: operation.capabilityRef,
          });
      }
    },
  };
}

interface Harness {
  readonly published: PublishedWorkflowVersion;
  readonly input: PeriodReportBatchInput;
  readonly receiverCalls: PeriodReportEntryInput[];
  readonly observeCalls: string[];
  readonly preflightCalls: number[];
  readonly authorizeCalls: number[];
  readonly dependencies: PeriodReportBatchDependencies;
  readonly store: ReturnType<typeof createMemoryPeriodReportBatchStore>;
}

async function harness(options: {
  behaviors?: Partial<Record<string, Behavior>>;
  overall?: (receiver: string) => PeriodOverallState;
  preflight?: (input: unknown) => Promise<PeriodReportBatchPlanEvidence>;
} = {}): Promise<Harness> {
  const published = await publishWeekly();
  const store = createMemoryPeriodReportBatchStore();
  const runStore = createMemoryWorkflowRunStore();
  const receiverCalls: PeriodReportEntryInput[] = [];
  const observeCalls: string[] = [];
  const preflightCalls = [0];
  const authorizeCalls = [0];
  const behaviors = options.behaviors ?? {};
  const overall = options.overall ?? (() => 'completed' as const);

  const runReceiver = async (input: PeriodReportEntryInput) => {
    receiverCalls.push(input);
    const loaded = await input.loadPublished();
    const record = await runPublishedLive({
      published: loaded,
      enterpriseId: input.enterpriseId,
      projectId: input.projectId,
      event: input.event,
      businessEvent: {
        outboxEventId: null,
        progressRevision: 0,
        stageKey: '',
        settingsVersion: 0,
        source: 'current_project_revision',
        periodKind: 'weekly',
        periodStart: '2026-10-19',
        periodEnd: '2026-10-26',
        ...(input.receiver.kind === 'customer' ? {} : { receiver: input.receiver }),
      },
      ports: fakePorts(input.receiver, behaviors[input.receiver.kind] ?? 'delivered'),
      store: input.store,
      runId: input.runId,
      now: () => '2026-11-12T03:00:00.000Z',
    });
    return {
      period: parseFixedPeriod(input.event, NOW),
      staff: null,
      boss: null,
      businessEvent: {
        outboxEventId: null,
        progressRevision: 0,
        stageKey: '',
        settingsVersion: 0,
        source: 'current_project_revision' as const,
        periodKind: 'weekly' as const,
        periodStart: '2026-10-19',
        periodEnd: '2026-10-26',
      },
      record,
    };
  };

  const observe = async (input: { runId: string }): Promise<PeriodReportRunObservation> => {
    observeCalls.push(input.runId);
    const kind = input.runId.split('-').pop()!;
    const state = overall(kind);
    const binding = RECEIVER_BINDING[kind]!;
    if (behaviors[kind] === 'save_unavailable' || behaviors[kind] === 'read_failed') {
      return {
        contract: 'period-report-run-status-v1',
        observedAt: '2026-11-12T04:00:00.000Z',
        bound: false,
        binding: null,
        progress: null,
        raw: {
          status: 'failed',
          errorCode: null,
          errorMessage: null,
          updatedAt: '2026-11-12T03:00:00.000Z',
          operations: [],
        },
        reasons: ['save_not_succeeded'],
      };
    }
    return {
      contract: 'period-report-run-status-v1',
      observedAt: '2026-11-12T04:00:00.000Z',
      bound: true,
      binding: {
        runId: input.runId,
        enterpriseId: ENTERPRISE_ID,
        projectId: PROJECT_ID,
        projectName: '测试项目',
        definitionId: 'period-report-weekly',
        definitionRevision: 1,
        digest: published.digest,
        periodKind: 'weekly',
        periodStart: '2026-10-19',
        periodEnd: '2026-10-26',
        reportId: `${kind}-report`,
        reportRevision: 1,
        reportKey: `${kind}-report-key`,
        factsRunId: `${kind}-facts-run`,
        bindingId: binding.bindingId,
        conversationId: binding.conversationId,
        savedReused: false,
        receiverKind: kind as 'customer' | 'worker' | 'designer' | 'boss',
        receiverAdminId: kind === 'customer' ? null : WORKER_ADMIN,
        projectScope: [PROJECT_ID],
      },
      progress: {
        overall: state,
        completed: state === 'completed',
        processing: state === 'processing',
        facts: { state: 'ready', runId: `${kind}-facts-run`, runStatus: 'succeeded', versionStatus: 'facts_ready', generatedAt: null, errorCode: null, job: { jobId: null, status: null, attempts: 0, providerStartedAt: null } },
        body: { state: 'ready', runId: `${kind}-body-run`, runStatus: 'succeeded', knowledgeStatus: 'ready', generatedAt: null, errorCode: null, job: { jobId: null, status: null, attempts: 0, providerStartedAt: null } },
        delivery: {
          state: state === 'completed' ? 'delivered' : 'waiting',
          deliveryState: state === 'completed' ? 'delivered' : 'pending',
          messageId: state === 'completed' ? `${kind}-message` : null,
          conversationId: binding.conversationId,
          deliveredAt: state === 'completed' ? '2026-11-12T03:00:00.000Z' : null,
          readAt: null,
        },
        availability: state === 'unavailable'
          ? { state: 'access_revoked', reason: 'customer_access_revoked' }
          : { state: 'available', reason: 'available' },
        reasons: [],
      },
      raw: {
        status: 'completed',
        errorCode: null,
        errorMessage: null,
        updatedAt: '2026-11-12T03:00:00.000Z',
        operations: [],
      },
      reasons: [],
    };
  };

  const dependencies: PeriodReportBatchDependencies = {
    now: () => NOW,
    preflight: async () => {
      preflightCalls[0] += 1;
      return options.preflight ? options.preflight({}) : planEvidence;
    },
    authorize: async () => {
      authorizeCalls[0] += 1;
    },
    runReceiver,
    observe,
  };

  return {
    published,
    receiverCalls,
    observeCalls,
    preflightCalls,
    authorizeCalls,
    dependencies,
    store,
    input: {
      requestId: REQUEST_ID,
      enterpriseId: ENTERPRISE_ID,
      projectId: PROJECT_ID,
      actor,
      event: weeklyEvent,
      receivers,
      loadPublished: async () => published,
      portsFor: (receiver) => fakePorts(receiver, behaviors[receiver.kind] ?? 'delivered'),
      runStore,
      batchStore: store,
    },
  };
}

function entryOf(manifest: PeriodReportBatchManifest, kind: string) {
  const entry = manifest.entries.find((candidate) => candidate.kind === kind);
  assert.ok(entry, `the ${kind} entry is missing`);
  return entry;
}

test('an unfinished week is rejected before the published target, preflight or manifest', async () => {
  const state = await harness();
  const unfinished: TriggerEvent = {
    ...weeklyEvent,
    periodStart: '2026-11-09',
    periodEnd: '2026-11-16',
  };

  await assert.rejects(
    () => runPeriodReportBatch({ ...state.input, event: unfinished }, state.dependencies),
    (error: unknown) => error instanceof WorkflowOperationError
      && error.code === 'period_not_ended',
  );
  assert.equal(state.preflightCalls[0], 0);
  assert.equal(state.receiverCalls.length, 0);
  assert.equal(await state.store.get(REQUEST_ID), null);
});

test('a weekly event on the daily published template is rejected before the manifest', async () => {
  const state = await harness();
  const daily = await publishDaily();
  const input: PeriodReportBatchInput = {
    ...state.input,
    loadPublished: async () => daily,
  };

  await assert.rejects(
    () => runPeriodReportBatch(input, state.dependencies),
    (error: unknown) => error instanceof WorkflowOperationError
      && error.code === 'live_event_type_unsupported',
  );
  assert.equal(state.preflightCalls[0], 0);
  assert.equal(state.receiverCalls.length, 0);
  assert.equal(await state.store.get(REQUEST_ID), null);
});

test('a rejected executor/plan preflight leaves no manifest and no receiver run', async () => {
  const state = await harness({
    preflight: async () => {
      throw new WorkflowOperationError('construction_forbidden', 403, 'not a manager');
    },
  });

  await assert.rejects(
    () => runPeriodReportBatch(state.input, state.dependencies),
    (error: unknown) => error instanceof WorkflowOperationError
      && error.code === 'construction_forbidden',
  );
  assert.equal(state.preflightCalls[0], 1);
  assert.equal(state.receiverCalls.length, 0);
  assert.equal(await state.store.get(REQUEST_ID), null);
});

test('four receivers share one selected version/event with distinct runIds and receipts', async () => {
  const state = await harness();
  const result = await runPeriodReportBatch(state.input, state.dependencies);

  assert.equal(result.created, true);
  assert.equal(result.observedOnly, false);
  assert.equal(result.manifest.status, 'completed');
  assert.equal(result.manifest.entries.length, 4);
  assert.deepEqual(
    result.manifest.entries.map((entry) => entry.kind),
    ['customer', 'worker', 'designer', 'boss'],
  );
  assert.deepEqual(
    state.receiverCalls.map((call) => call.receiver.kind),
    ['customer', 'worker', 'designer', 'boss'],
  );
  const runIds = state.receiverCalls.map((call) => call.runId);
  assert.deepEqual(runIds, [
    `${REQUEST_ID}-customer`,
    `${REQUEST_ID}-worker`,
    `${REQUEST_ID}-designer`,
    `${REQUEST_ID}-boss`,
  ]);
  assert.equal(new Set(runIds).size, 4);
  for (const call of state.receiverCalls) {
    assert.equal(call.enterpriseId, ENTERPRISE_ID);
    assert.equal(call.projectId, PROJECT_ID);
    assert.deepEqual(call.event, weeklyEvent);
    assert.equal(call.store, state.input.runStore);
  }
  const receiptBindings = result.manifest.entries.map((entry) => entry.saveReceipt?.bindingId);
  assert.deepEqual(receiptBindings, ['1', '2', '3', '4']);
  const conversations = result.manifest.entries.map((entry) => entry.saveReceipt?.conversationId);
  assert.equal(new Set(conversations).size, 4);
  assert.equal(result.manifest.published.digest, state.published.digest);
  assert.equal(result.preflight?.projectIds.length, 1);
});

test('a queued first receiver with a real save receipt does not stop the other receivers', async () => {
  const state = await harness({
    behaviors: { customer: 'pending' },
    overall: (kind) => (kind === 'customer' ? 'processing' : 'completed'),
  });
  const result = await runPeriodReportBatch(state.input, state.dependencies);

  assert.equal(state.receiverCalls.length, 4);
  const customer = entryOf(result.manifest, 'customer');
  assert.equal(customer.state, 'processing');
  assert.equal(customer.saveReceipt?.reportId, 'customer-report');
  assert.equal(customer.deliveryReceipt?.delivered, false);
  assert.equal(customer.observation?.overall, 'processing');
  for (const kind of ['worker', 'designer', 'boss']) {
    assert.equal(entryOf(result.manifest, kind).state, 'completed');
  }
  assert.equal(result.manifest.status, 'processing');
  assert.equal(result.manifest.reasons.includes('customer:delivery_pending'), true);
});

test('an unavailable receiver keeps its reason and does not borrow another binding', async () => {
  const state = await harness({
    behaviors: { worker: 'save_unavailable' },
  });
  const result = await runPeriodReportBatch(state.input, state.dependencies);

  const worker = entryOf(result.manifest, 'worker');
  assert.equal(worker.state, 'unavailable');
  assert.equal(worker.reason, 'customer_access_revoked');
  assert.equal(worker.saveReceipt, null);
  assert.equal(state.receiverCalls.length, 4);
  assert.equal(entryOf(result.manifest, 'designer').state, 'completed');
  assert.equal(entryOf(result.manifest, 'boss').state, 'completed');
  assert.equal(result.manifest.status, 'partial');
});

test('a blocking failure stops later receivers, keeps earlier receipts and marks unexecuted entries', async () => {
  const state = await harness({
    behaviors: { designer: 'read_failed' },
  });
  const result = await runPeriodReportBatch(state.input, state.dependencies);

  assert.equal(state.receiverCalls.length, 3);
  assert.deepEqual(
    state.receiverCalls.map((call) => call.receiver.kind),
    ['customer', 'worker', 'designer'],
  );
  const customer = entryOf(result.manifest, 'customer');
  const worker = entryOf(result.manifest, 'worker');
  const designer = entryOf(result.manifest, 'designer');
  const boss = entryOf(result.manifest, 'boss');
  assert.equal(customer.state, 'completed');
  assert.equal(worker.state, 'completed');
  assert.equal(customer.saveReceipt?.reportId, 'customer-report');
  assert.equal(worker.saveReceipt?.reportId, 'worker-report');
  assert.equal(designer.state, 'failed');
  assert.equal(designer.reason, 'construction_forbidden');
  assert.equal(designer.saveReceipt, null);
  assert.equal(boss.state, 'not_started');
  assert.equal(boss.reason, 'batch_blocked');
  assert.equal(result.manifest.status, 'failed');
});

test('an unknown sub-run is not reported as success and stops the batch', async () => {
  const state = await harness({
    behaviors: { boss: 'unknown' },
  });
  const result = await runPeriodReportBatch(state.input, state.dependencies);

  assert.equal(entryOf(result.manifest, 'boss').state, 'unknown');
  assert.equal(result.manifest.status, 'unknown');
  assert.equal(result.manifest.entries.every((entry) => entry.state !== 'completed')
    || result.manifest.status === 'unknown', true);
});

test('a status observation of unavailable is not masked as completed', async () => {
  const state = await harness({
    overall: (kind) => (kind === 'boss' ? 'unavailable' : 'completed'),
  });
  const result = await runPeriodReportBatch(state.input, state.dependencies);

  const boss = entryOf(result.manifest, 'boss');
  assert.equal(boss.state, 'unavailable');
  assert.equal(boss.reason, 'customer_access_revoked');
  assert.equal(boss.observation?.availability, 'access_revoked');
  assert.equal(result.manifest.status, 'partial');
});

test('the same request only re-observes the existing sub-runs', async () => {
  const state = await harness();
  const first = await runPeriodReportBatch(state.input, state.dependencies);
  assert.equal(state.receiverCalls.length, 4);
  assert.equal(state.observeCalls.length, 4);
  assert.equal(state.preflightCalls[0], 1);

  const second = await runPeriodReportBatch(state.input, state.dependencies);

  assert.equal(second.created, false);
  assert.equal(second.observedOnly, true);
  assert.equal(state.receiverCalls.length, 4, 'no second round may run');
  assert.equal(state.observeCalls.length, 8);
  assert.equal(state.preflightCalls[0], 1, 'the plan is not revalidated for an observation');
  assert.equal(state.authorizeCalls[0], 1);
  assert.deepEqual(
    second.manifest.entries.map((entry) => entry.runId),
    first.manifest.entries.map((entry) => entry.runId),
  );
  assert.equal(second.manifest.status, 'completed');
});

test('the same request with a different project, period, receiver or version conflicts', async () => {
  const state = await harness();
  await runPeriodReportBatch(state.input, state.dependencies);
  const variant = await publishWeeklyVariant();

  const conflicts: PeriodReportBatchInput[] = [
    { ...state.input, projectId: '1454000099' },
    { ...state.input, event: { ...weeklyEvent, periodStart: '2026-10-26', periodEnd: '2026-11-02' } },
    {
      ...state.input,
      receivers: [
        { kind: 'customer' },
        { kind: 'worker', adminId: '1454000099' },
        { kind: 'designer', adminId: DESIGNER_ADMIN },
        { kind: 'boss', adminId: BOSS_ADMIN },
      ],
    },
    { ...state.input, loadPublished: async () => variant },
  ];

  for (const conflict of conflicts) {
    await assert.rejects(
      () => runPeriodReportBatch(conflict, state.dependencies),
      (error: unknown) => error instanceof WorkflowOperationError
        && error.code === 'period_report_batch_conflict',
    );
  }
  assert.equal(state.receiverCalls.length, 4);
});

test('a new request for the same period starts a new host manifest with the same receiver identities', async () => {
  const state = await harness();
  await runPeriodReportBatch(state.input, state.dependencies);

  const reused = await runPeriodReportBatch({
    ...state.input,
    requestId: `${REQUEST_ID}-second`,
  }, state.dependencies);

  assert.equal(reused.created, true);
  assert.equal(reused.manifest.requestId, `${REQUEST_ID}-second`);
  assert.deepEqual(
    reused.manifest.entries.map((entry) => entry.kind),
    ['customer', 'worker', 'designer', 'boss'],
  );
  assert.equal(state.receiverCalls.length, 8);
  assert.deepEqual(
    reused.manifest.entries.map((entry) => entry.saveReceipt?.bindingId),
    ['1', '2', '3', '4'],
  );
  assert.deepEqual(
    reused.manifest.receivers.map((receiver) => receiver.runId),
    [
      `${REQUEST_ID}-second-customer`,
      `${REQUEST_ID}-second-worker`,
      `${REQUEST_ID}-second-designer`,
      `${REQUEST_ID}-second-boss`,
    ],
  );
  assert.equal(reused.manifest.status, 'completed');
});

test('receiver order, extra kinds and the executor/boss separation are rejected before any run', async () => {
  const state = await harness();
  const invalidSets: PeriodReportBatchReceiver[][] = [
    [{ kind: 'worker', adminId: WORKER_ADMIN }],
    [receivers[1], receivers[0], receivers[2], receivers[3]],
    [
      { kind: 'customer' },
      { kind: 'worker', adminId: WORKER_ADMIN },
      { kind: 'designer', adminId: DESIGNER_ADMIN },
      { kind: 'boss', adminId: EXECUTOR_ADMIN },
    ],
    [
      { kind: 'customer', adminId: WORKER_ADMIN },
      { kind: 'worker', adminId: WORKER_ADMIN },
      { kind: 'designer', adminId: DESIGNER_ADMIN },
      { kind: 'boss', adminId: BOSS_ADMIN },
    ],
  ];

  for (const invalid of invalidSets) {
    await assert.rejects(
      () => runPeriodReportBatch({ ...state.input, receivers: invalid }, state.dependencies),
      (error: unknown) => error instanceof WorkflowOperationError
        && error.code === 'period_report_batch_receivers_invalid',
    );
  }
  assert.equal(state.receiverCalls.length, 0);
});

test('observation is read-only: it never calls ports or starts another receiver', async () => {
  const state = await harness();
  await runPeriodReportBatch(state.input, state.dependencies);
  const callsAfterFirst = state.receiverCalls.length;
  const observeAfterFirst = state.observeCalls.length;

  await runPeriodReportBatch(state.input, state.dependencies);
  await runPeriodReportBatch(state.input, state.dependencies);

  assert.equal(state.receiverCalls.length, callsAfterFirst);
  assert.equal(state.observeCalls.length, observeAfterFirst + 8);
});

test('a later completed observation refreshes a pending delivery receipt', async () => {
  let customerState: PeriodOverallState = 'processing';
  const state = await harness({
    behaviors: { customer: 'pending' },
    overall: (kind) => (kind === 'customer' ? customerState : 'completed'),
  });
  const first = await runPeriodReportBatch(state.input, state.dependencies);
  assert.equal(entryOf(first.manifest, 'customer').deliveryReceipt?.delivered, false);

  customerState = 'completed';
  const second = await runPeriodReportBatch(state.input, state.dependencies);
  const customer = entryOf(second.manifest, 'customer');
  assert.equal(customer.state, 'completed');
  assert.equal(customer.reason, null);
  assert.equal(customer.deliveryReceipt?.delivered, true);
  assert.equal(customer.deliveryReceipt?.messageId, 'customer-message');
  assert.equal(second.manifest.status, 'completed');
});

test('the file batch store is exclusive and refuses a different identity', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'native-batch-store-'));
  try {
    const state = await harness();
    const store = createFilePeriodReportBatchStore({ rootDir: root });
    const built = await runPeriodReportBatch({ ...state.input, batchStore: store }, state.dependencies);
    assert.equal(built.created, true);
    const loaded = await store.get(REQUEST_ID);
    assert.ok(loaded);
    assert.equal(loaded.status, 'completed');

    const replay = await runPeriodReportBatch({ ...state.input, batchStore: store }, state.dependencies);
    assert.equal(replay.created, false);
    assert.equal(replay.observedOnly, true);

    const conflict = {
      ...loaded,
      projectId: '1454000099',
    };
    await assert.rejects(
      () => store.update(conflict),
      (error: unknown) => error instanceof WorkflowOperationError
        && error.code === 'period_report_batch_conflict',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function publishDaily(): Promise<PublishedWorkflowVersion> {
  const service = createWorkflowService({
    store: createMemoryWorkflowStore(),
    now: () => '2026-11-12T01:00:00.000Z',
  });
  await service.createFromTemplate('period-report-daily');
  const published = await service.publishDraft({
    definitionId: 'period-report-daily',
    expectedDraftRevision: 1,
  });
  return published.version;
}

/** A valid second weekly revision with a different digest for conflict checks. */
async function publishWeeklyVariant(): Promise<PublishedWorkflowVersion> {
  const service = createWorkflowService({
    store: createMemoryWorkflowStore(),
    now: () => '2026-11-12T01:00:00.000Z',
  });
  await service.createFromTemplate('period-report-weekly');
  const record = await service.getDefinition('period-report-weekly');
  const clone = structuredClone(record.record.draft.definition);
  const definition = {
    ...clone,
    nodes: clone.nodes.map((node) => node.nodeId === 'condition-receivers'
      ? { ...node, config: { op: 'gt', right: 1 } }
      : node),
  };
  const saved = await service.saveDraft({
    definitionId: 'period-report-weekly',
    definition,
    expectedDraftRevision: record.record.draft.draftRevision,
  });
  const published = await service.publishDraft({
    definitionId: 'period-report-weekly',
    expectedDraftRevision: saved.draft.draftRevision,
  });
  return published.version;
}
