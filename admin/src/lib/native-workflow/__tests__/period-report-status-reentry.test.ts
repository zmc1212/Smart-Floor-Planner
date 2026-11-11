import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  PERIOD_REPORT_STATUS_CONTRACT,
  readPeriodReportRunStatus,
  type PeriodReportBusinessSnapshot,
  type PeriodRunBindingView,
} from '../live/period-report-status';
import { createFileWorkflowRunStore } from '../live/run-store';
import type { LiveRunRecord } from '../live/types';
import { createWorkflowService } from '../service';
import { createFileWorkflowStore } from '../store/file-store';
import type { WorkflowDefinition } from '../types';

const RUN_ID = 'b5-3-reentry-001';
const ENTERPRISE_ID = '1454';
const PROJECT_ID = '1454000004';
const PERIOD_START = '2026-11-06';
const PERIOD_END = '2026-11-06';
const NOW = new Date('2026-11-11T12:00:00.000Z');

function baseRecord(options: {
  readonly digest: string;
  readonly nodeVersions: Readonly<Record<string, string>>;
  readonly definitionRevision?: number;
}): LiveRunRecord {
  const revision = options.definitionRevision ?? 1;
  return {
    binding: {
      runId: RUN_ID,
      definitionId: 'period-report-daily',
      revision,
      digest: options.digest,
      nodeVersions: options.nodeVersions,
      event: {
        eventId: 'b5-3-period-0001',
        eventType: 'period_report',
        occurredAt: '2026-11-11T11:58:00.000Z',
        periodKind: 'daily',
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
      },
      businessEvent: {
        outboxEventId: null,
        progressRevision: 1,
        stageKey: '',
        settingsVersion: 1,
        source: 'current_project_revision',
        periodKind: 'daily',
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
      },
    },
    enterpriseId: ENTERPRISE_ID,
    projectId: PROJECT_ID,
    // The raw trace is honestly failed: the run reached deliver.inapp before
    // the asynchronous report Worker had delivered the message.
    status: 'failed',
    state: {
      runId: RUN_ID,
      definitionId: 'period-report-daily',
      revision,
      digest: options.digest,
      mode: 'live',
      status: 'failed',
      currentNodeId: null,
      pendingNodeId: null,
      visitedNodeIds: [],
      outputs: {},
      processedEventIds: ['b5-3-period-0001'],
      error: {
        code: 'delivery_not_confirmed',
        path: 'nodes.deliver-report',
        message: 'report delivery is still pending',
      },
      outcome: null,
      stepCount: 0,
      traceSeq: 0,
    },
    trace: [],
    operations: [
      {
        nodeId: 'save-report',
        capabilityRef: 'save.period_report',
        effect: 'save',
        nodeVersion: 'save-report:v1',
        idempotencyKey: 'save:period:2026-11-06',
        startedAt: '2026-11-11T11:58:01.000Z',
        finishedAt: '2026-11-11T11:58:02.000Z',
        outcome: 'succeeded',
        outputs: {
          saved: true,
          saveReceipt: {
            receiptId: 'report:4:1',
            simulated: false,
            source: 'construction_reports',
            reportId: '4',
            revision: 1,
            runId: '7',
            reportKey: 'k',
            bindingId: '1',
            conversationId: '1454000007',
            reused: false,
          },
        },
      },
      {
        nodeId: 'deliver-report',
        capabilityRef: 'deliver.inapp',
        effect: 'deliver',
        nodeVersion: 'deliver-report:v1',
        idempotencyKey: 'deliver:period:2026-11-06',
        startedAt: '2026-11-11T11:58:03.000Z',
        finishedAt: '2026-11-11T11:58:04.000Z',
        outcome: 'failed',
        outputs: {
          delivered: false,
          deliveryReceipt: {
            receiptId: '',
            simulated: false,
            source: 'construction_report_deliveries',
            status: 'pending',
            reportId: '4',
            revision: 1,
          },
        },
        error: {
          code: 'delivery_not_confirmed',
          path: 'nodes.deliver-report',
          message: 'report delivery is still pending',
        },
      },
    ],
    createdAt: '2026-11-11T11:58:00.000Z',
    updatedAt: '2026-11-11T11:58:04.000Z',
  };
}

/** Facts/body/delivery already succeeded in the business tables. */
function readySnapshot(): PeriodReportBusinessSnapshot {
  return {
    report: {
      id: '4',
      binding_id: '1',
      report_key: 'k',
      kind: 'daily',
      period_start: PERIOD_START,
      // Period end is exclusive: the next Shanghai midnight in UTC.
      period_end: '2026-11-06T16:00:00.000Z',
      latest_revision: 1,
    },
    version: {
      revision: 1,
      status: 'facts_ready',
      generated_at: '2026-11-11T12:05:00.000Z',
      body_present: true,
      knowledge_status: 'ready',
      body_run_id: '8',
      body_error_code: null,
      body_attempts: 1,
    },
    factsRun: { id: '7', status: 'succeeded', error_code: null },
    factsJob: {
      jobId: '21',
      status: 'succeeded',
      attempts: 1,
      providerStartedAt: '2026-11-11T12:00:10.000Z',
    },
    bodyRun: { id: '8', status: 'succeeded', error_code: null },
    bodyJob: {
      jobId: '22',
      status: 'succeeded',
      attempts: 1,
      providerStartedAt: '2026-11-11T12:01:00.000Z',
    },
    delivery: {
      state: 'delivered',
      message_id: '115',
      delivered_at: '2026-11-11T12:04:30.000Z',
      read_at: null,
    },
    message: {
      id: '115',
      conversation_id: '1454000007',
      purpose: 'construction.report.facts',
      seq: '3',
    },
    binding: {
      id: '1',
      project_id: PROJECT_ID,
      conversation_id: '1454000007',
      audience: 'customer',
      status: 'enabled',
      user_id: '1454000002',
    },
    project: {
      id: PROJECT_ID,
      name: '测试项目',
      status: 'active',
      customer_access: true,
      current_stage_key: 'plumbing',
    },
    conversation: { id: '1454000007', status: 'active', retention_redacted: false },
    followup_available: true,
    source_project_ids: [PROJECT_ID],
    read_error: null,
  };
}

function readErrorSnapshot(): PeriodReportBusinessSnapshot {
  return {
    ...readySnapshot(),
    report: null,
    version: null,
    factsRun: null,
    factsJob: null,
    bodyRun: null,
    bodyJob: null,
    delivery: null,
    message: null,
    binding: null,
    project: null,
    conversation: null,
    followup_available: false,
    source_project_ids: [],
    read_error: 'read_failed',
  };
}

/** Facts succeeded, but the body run cannot be classified yet. */
function indeterminateBodySnapshot(): PeriodReportBusinessSnapshot {
  return {
    ...readySnapshot(),
    version: {
      revision: 1,
      status: 'unknown',
      generated_at: null,
      body_present: false,
      knowledge_status: 'unknown',
      body_run_id: '8',
      body_error_code: null,
      body_attempts: 0,
    },
    bodyRun: { id: '8', status: 'unknown', error_code: null },
    bodyJob: {
      jobId: '22',
      status: 'unknown',
      attempts: 0,
      providerStartedAt: null,
    },
    delivery: null,
    message: null,
  };
}

interface FileSnapshot {
  readonly path: string;
  readonly content: string;
  readonly size: number;
  readonly mtimeMs: number;
}

/** Every file under the run store, including content and mtime. */
async function snapshotFiles(root: string): Promise<FileSnapshot[]> {
  const files: FileSnapshot[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      const [content, info] = await Promise.all([readFile(full, 'utf8'), stat(full)]);
      files.push({
        path: path.relative(root, full),
        content,
        size: info.size,
        mtimeMs: info.mtimeMs,
      });
    }
  }

  await walk(root);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

test('re-entry reads the same binding and business progress without rewriting the run record', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'b5-3-status-reentry-'));
  try {
    const runStore = createFileWorkflowRunStore({ rootDir: path.join(root, 'runs-store') });
    const created = await runStore.create(baseRecord({ digest: 'digest-v1', nodeVersions: { 'trigger-1': 'v1' } }));
    assert.equal(created.created, true);

    const before = await snapshotFiles(path.join(root, 'runs-store'));
    assert.equal(before.length, 1);

    const snapshots: PeriodRunBindingView[] = [];
    const options = {
      runId: RUN_ID,
      viewer: { enterpriseId: ENTERPRISE_ID, adminId: '1454000001' },
      runStore,
      // The only injectable dependency: no ports, enqueue, model or delivery
      // callback is provided, so a read has nothing it could execute.
      loadSnapshot: async (_transaction: unknown, binding: PeriodRunBindingView) => {
        snapshots.push(binding);
        return readySnapshot();
      },
      now: () => NOW,
    };

    const first = await readPeriodReportRunStatus(options);
    const second = await readPeriodReportRunStatus(options);
    const after = await snapshotFiles(path.join(root, 'runs-store'));

    // Refreshing or re-entering restores the same report and revision.
    assert.equal(first.contract, PERIOD_REPORT_STATUS_CONTRACT);
    assert.equal(first.bound, true);
    assert.ok(first.binding);
    assert.ok(first.progress);
    assert.ok(second.binding);
    assert.ok(second.progress);
    assert.deepEqual(second.binding, first.binding);
    assert.deepEqual(second.progress, first.progress);

    assert.equal(first.binding.runId, RUN_ID);
    assert.equal(first.binding.enterpriseId, ENTERPRISE_ID);
    assert.equal(first.binding.projectId, PROJECT_ID);
    assert.equal(first.binding.projectName, '测试项目');
    assert.equal(first.binding.definitionId, 'period-report-daily');
    assert.equal(first.binding.definitionRevision, 1);
    assert.equal(first.binding.digest, 'digest-v1');
    assert.equal(first.binding.periodKind, 'daily');
    assert.equal(first.binding.periodStart, PERIOD_START);
    assert.equal(first.binding.periodEnd, PERIOD_END);
    assert.equal(first.binding.reportId, '4');
    assert.equal(first.binding.reportRevision, 1);
    assert.equal(first.binding.reportKey, 'k');
    assert.equal(first.binding.factsRunId, '7');
    assert.equal(first.binding.bindingId, '1');
    assert.equal(first.binding.conversationId, '1454000007');
    assert.equal(first.binding.savedReused, false);

    // Current business progress is read from the snapshot, not the raw trace.
    assert.equal(first.progress.facts.state, 'ready');
    assert.equal(first.progress.body.state, 'ready');
    assert.equal(first.progress.delivery.state, 'delivered');
    assert.equal(first.progress.availability.state, 'available');
    assert.equal(first.progress.overall, 'completed');
    assert.equal(first.progress.completed, true);

    // The immutable workflow trace stays an honest delivery_not_confirmed.
    assert.equal(first.raw.status, 'failed');
    assert.equal(first.raw.operations.length, 2);
    assert.equal(first.raw.operations[0]?.outcome, 'succeeded');
    assert.equal(first.raw.operations[1]?.outcome, 'failed');
    assert.equal(first.raw.operations[1]?.errorCode, 'delivery_not_confirmed');

    assert.equal(snapshots.length, 2);
    assert.equal(snapshots[0]?.reportId, '4');

    // Reading status never writes a run record (content and mtime unchanged).
    assert.deepEqual(after, before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a newly published definition revision never rewrites an old run binding', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'b5-3-status-republish-'));
  try {
    const service = createWorkflowService({
      store: createFileWorkflowStore({ rootDir: path.join(root, 'definitions') }),
      now: () => '2026-11-11T12:00:00.000Z',
    });
    const created = await service.createFromTemplate('period-report-daily');
    const firstPublished = await service.publishDraft({
      definitionId: 'period-report-daily',
      expectedDraftRevision: 1,
    });
    assert.equal(firstPublished.version.revision, 1);

    const changed = JSON.parse(JSON.stringify(created.draft.definition)) as {
      nodes: Array<{ nodeId: string; config?: Record<string, unknown> } & Record<string, unknown>>;
      [key: string]: unknown;
    };
    // compose.period_report has no config keys; the number gate does, so a
    // different threshold produces a distinct canonical definition/digest.
    const gate = changed.nodes.find((node) => node.nodeId === 'condition-receivers');
    assert.ok(gate);
    gate.config = { ...(gate.config ?? {}), right: -1 };
    await service.saveDraft({
      definitionId: 'period-report-daily',
      definition: changed as unknown as WorkflowDefinition,
      expectedDraftRevision: 1,
    });
    const secondPublished = await service.publishDraft({
      definitionId: 'period-report-daily',
      expectedDraftRevision: 2,
    });
    assert.equal(secondPublished.version.revision, 2);
    assert.notEqual(secondPublished.version.digest, firstPublished.version.digest);

    const runStore = createFileWorkflowRunStore({ rootDir: path.join(root, 'runs-store') });
    await runStore.create(baseRecord({
      digest: firstPublished.version.digest,
      nodeVersions: firstPublished.version.nodeVersions,
      definitionRevision: firstPublished.version.revision,
    }));

    let snapshotCalls = 0;
    const observation = await readPeriodReportRunStatus({
      runId: RUN_ID,
      viewer: { enterpriseId: ENTERPRISE_ID, adminId: '1454000001' },
      runStore,
      loadSnapshot: async () => {
        snapshotCalls += 1;
        return readySnapshot();
      },
      now: () => NOW,
    });

    assert.equal(snapshotCalls, 1);
    assert.equal(observation.bound, true);
    assert.ok(observation.binding);
    // The run record keeps the published revision/digest it started with.
    assert.equal(observation.binding.definitionRevision, firstPublished.version.revision);
    assert.equal(observation.binding.digest, firstPublished.version.digest);
    assert.equal(observation.binding.reportId, '4');
    assert.equal(observation.binding.reportRevision, 1);
    assert.equal(observation.binding.factsRunId, '7');

    // The definition store has indeed moved on to a second revision.
    const latest = await service.getDefinition('period-report-daily');
    assert.equal(latest.record.versions[latest.record.versions.length - 1]?.revision, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('read errors and an indeterminate body stay unknown and are never retried or written', async () => {
  for (const [name, snapshot] of [
    ['read_error', readErrorSnapshot()],
    ['body_indeterminate', indeterminateBodySnapshot()],
  ] as const) {
    const root = await mkdtemp(path.join(os.tmpdir(), `b5-3-status-${name}-`));
    try {
      const runStore = createFileWorkflowRunStore({ rootDir: path.join(root, 'runs-store') });
      await runStore.create(baseRecord({ digest: 'digest-v1', nodeVersions: { 'trigger-1': 'v1' } }));

      const before = await snapshotFiles(path.join(root, 'runs-store'));
      let snapshotCalls = 0;
      const options = {
        runId: RUN_ID,
        viewer: { enterpriseId: ENTERPRISE_ID, adminId: '1454000001' },
        runStore,
        loadSnapshot: async () => {
          snapshotCalls += 1;
          return snapshot;
        },
        now: () => NOW,
      };

      const first = await readPeriodReportRunStatus(options);
      const second = await readPeriodReportRunStatus(options);
      const after = await snapshotFiles(path.join(root, 'runs-store'));

      assert.equal(first.bound, true, name);
      assert.ok(first.progress, name);
      assert.ok(second.progress, name);
      assert.equal(first.progress.overall, 'unknown', name);
      assert.equal(first.progress.completed, false, name);
      assert.deepEqual(second.progress, first.progress, name);
      assert.deepEqual(second.binding, first.binding, name);

      // A second read calls only the snapshot loader again: no re-execution,
      // no enqueue/model/delivery, and no automatic retry.
      assert.equal(snapshotCalls, 2, name);
      assert.deepEqual(after, before, name);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});
