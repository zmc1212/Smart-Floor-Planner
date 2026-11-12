/** Server-only wiring for the B5.9 weekly scheduler tick.
 *
 * The existing assistant Worker calls this through its normal endpoint; this
 * module creates no timer, interval or second Worker. It is imported only when
 * `NATIVE_WORKFLOW_SCHEDULE_ENABLED` is explicitly enabled, and it dispatches
 * only the comma-separated enterprise allowlist.
 *
 * Runtime configuration (all optional except enablement and allowlist):
 *   NATIVE_WORKFLOW_SCHEDULE_ENABLED=1
 *   NATIVE_WORKFLOW_SCHEDULE_ENTERPRISE_IDS=1454
 *   NATIVE_WORKFLOW_SCHEDULE_DEFINITION_ID=period-report-weekly
 *   NATIVE_WORKFLOW_SCHEDULE_REVISION=<published revision pin>
 *   NATIVE_WORKFLOW_SCHEDULE_MAX_PROJECTS=5
 *   NATIVE_WORKFLOW_SCHEDULE_OBSERVE_MINUTES=15
 *   NATIVE_WORKFLOW_SCHEDULE_READ_OBSERVE_MINUTES=360
 *   NATIVE_WORKFLOW_SCHEDULE_RECHECK_LIMIT=3
 *   NATIVE_WORKFLOW_SCHEDULE_MAX_RUN_MS=90000
 *   NATIVE_WORKFLOW_TASK_RECOVERY_ENABLED=1   (durable task recovery)
 *   NATIVE_WORKFLOW_TASK_DIR=<optional task store root>
 */

import { WorkflowOperationError } from '../errors';
import { createFileWorkflowStore, resolveNativeWorkflowStoreDir } from '../store/file-store';
import type { PublishedWorkflowVersion } from '../store/types';
import { createDurableTaskRuntime } from './durable-task-runtime';
import { createFileDurableTaskStore, resolveNativeWorkflowTaskDir } from './durable-task-store';
import { createFilePeriodReportBatchStore, resolveNativeWorkflowBatchDir } from './period-report-batch-store';
import { createDatabasePeriodReportScheduleEnvironment } from './period-report-schedule-ports';
import { createFilePeriodReportScheduleStore, resolveNativeWorkflowScheduleDir } from './period-report-schedule-store';
import { scheduleTickLogPayload } from './period-report-schedule-observability';
import { runScheduledPeriodReportDispatch } from './period-report-schedule';
import { createFileWorkflowRunStore } from './run-store';
import { resolveNativeWorkflowRunDir } from './run-dir';
import { nativeWorkflowEnabled, nativeWorkflowEnterpriseIds } from './tenant-allowlist';

const DEFAULT_DEFINITION_ID = 'period-report-weekly';

function positiveInteger(value: string | undefined): number | undefined {
  if (!value || !/^[1-9]\d{0,8}$/.test(value.trim())) return undefined;
  return Number(value);
}

function minutes(value: string | undefined, fallback: number): number {
  const parsed = positiveInteger(value);
  return parsed === undefined ? fallback : parsed * 60_000;
}

/** Reuses the existing worker tick; it starts no timer and no second Worker.
 * Recovery is opt-in and tenant-scoped, and one tenant's failure only records
 * that tenant's own error. */
async function recoverDurableTasks(enterpriseIds: readonly string[]): Promise<void> {
  const store = createFileDurableTaskStore({ rootDir: resolveNativeWorkflowTaskDir() });
  const runtime = createDurableTaskRuntime({ store });
  const summaries = await runtime.recoverAll(enterpriseIds);
  for (const summary of summaries) {
    try {
      console.info(JSON.stringify({
        event: 'durable_task_recovery',
        tenantId: summary.enterpriseId,
        scanned: summary.scanned,
        reclaimed: summary.reclaimed,
        retried: summary.retried,
        queued: summary.queued,
        expired: summary.expired,
        failed: summary.failed,
        waiting: summary.waiting,
        skipped: summary.skipped,
        errors: summary.errors.map((error) => error.code),
      }));
    } catch {
      // Logging must never fail the tick.
    }
  }
}

export async function loadNativeWorkflowPublished(
  env: NodeJS.ProcessEnv = process.env,
  input?: { readonly definitionId: string; readonly revision: number },
): Promise<PublishedWorkflowVersion> {
  const definitionId = input?.definitionId
    ?? env.NATIVE_WORKFLOW_SCHEDULE_DEFINITION_ID?.trim()
    ?? DEFAULT_DEFINITION_ID;
  const revision = input?.revision
    ?? positiveInteger(env.NATIVE_WORKFLOW_SCHEDULE_REVISION);
  const store = createFileWorkflowStore({ rootDir: resolveNativeWorkflowStoreDir() });
  const record = await store.get(definitionId);
  if (!record) {
    throw new WorkflowOperationError(
      'published_unavailable',
      409,
      `published definition ${definitionId} was not found`,
    );
  }
  const version = revision === undefined
    ? record.versions[record.versions.length - 1]
    : record.versions.find((candidate) => candidate.revision === revision);
  if (!version) {
    throw new WorkflowOperationError(
      'published_unavailable',
      409,
      revision === undefined
        ? `published definition ${definitionId} has no published revision`
        : `published definition ${definitionId} has no revision ${revision}`,
    );
  }
  return version;
}

export async function runNativeWorkflowScheduleTick(
  env: NodeJS.ProcessEnv = process.env,
): Promise<Awaited<ReturnType<typeof runScheduledPeriodReportDispatch>> | {
  readonly enabled: false;
  readonly reason: string;
}> {
  const enterpriseIds = nativeWorkflowEnterpriseIds(env.NATIVE_WORKFLOW_SCHEDULE_ENTERPRISE_IDS);
  // Recovery is independent of automatic scheduling: an environment may keep
  // NATIVE_WORKFLOW_SCHEDULE_ENABLED=0 while still recovering its own durable
  // tasks for the explicit allowlist.
  if (nativeWorkflowEnabled(env.NATIVE_WORKFLOW_TASK_RECOVERY_ENABLED) && enterpriseIds.length) {
    await recoverDurableTasks(enterpriseIds).catch(() => undefined);
  }
  if (!nativeWorkflowEnabled(env.NATIVE_WORKFLOW_SCHEDULE_ENABLED)) return { enabled: false, reason: 'disabled' };
  if (!enterpriseIds.length) return { enabled: false, reason: 'no_enterprise_scope' };

  const runStore = createFileWorkflowRunStore({ rootDir: resolveNativeWorkflowRunDir() });
  const batchStore = createFilePeriodReportBatchStore({ rootDir: resolveNativeWorkflowBatchDir() });
  const scheduleStore = createFilePeriodReportScheduleStore({
    rootDir: resolveNativeWorkflowScheduleDir(),
  });
  const environment = createDatabasePeriodReportScheduleEnvironment({
    loadPublished: (input) => loadNativeWorkflowPublished(env, input),
    runStore,
    now: () => new Date(),
  });
  const summary = await runScheduledPeriodReportDispatch({
    enterpriseIds,
    mode: 'tick',
    maxProjectsPerRound: positiveInteger(env.NATIVE_WORKFLOW_SCHEDULE_MAX_PROJECTS) ?? 5,
    observeIntervalMs: minutes(env.NATIVE_WORKFLOW_SCHEDULE_OBSERVE_MINUTES, 15),
    readObservationIntervalMs: minutes(env.NATIVE_WORKFLOW_SCHEDULE_READ_OBSERVE_MINUTES, 360),
    recheckLimit: positiveInteger(env.NATIVE_WORKFLOW_SCHEDULE_RECHECK_LIMIT) ?? 3,
    maxRunDurationMs: positiveInteger(env.NATIVE_WORKFLOW_SCHEDULE_MAX_RUN_MS) ?? 90_000,
    issuedBy: 'assistant-worker',
  }, {
    store: scheduleStore,
    batchStore,
    runStore,
    environment,
  });
  // One redacted structured line per tick: tenant/schedule/job ids, instants,
  // worker, state and error codes only. Project names, issue text and model
  // output are never included.
  try {
    console.info(JSON.stringify(scheduleTickLogPayload({
      enabled: summary.enabled,
      startedAt: summary.startedAt,
      finishedAt: summary.finishedAt,
      periodStart: summary.period.periodStart,
      periodEnd: summary.period.periodEnd,
      enterprises: summary.enterprises,
      runs: summary.runs,
      traces: summary.traces,
    })));
  } catch {
    // Logging must never fail the scheduler tick.
  }
  return summary;
}
