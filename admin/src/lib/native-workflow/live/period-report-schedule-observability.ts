/** Redacted scheduling trace for the B5.9 weekly scheduler.
 *
 * One trace per project/period job plus one run-level summary. These records
 * exist so an operator can tell which tenant/period/worker executed what and
 * why it stopped, without copying tenant business content into logs.
 *
 * Included: ids, period, planned/actual instants, worker id, state, attempt
 * and retry counters and a stable error code.
 * Deliberately excluded: project names, issue text, receiver admin ids, model
 * output and any free-form reason that could contain tenant business content.
 */

import type {
  PeriodReportScheduleRun,
  ScheduledProjectEntry,
  ScheduledRunStatus,
} from './period-report-schedule-types';

/** A hard bound so one tick can never emit an unbounded log payload. */
const MAX_TRACES = 200;
const MAX_LOG_TRACES = 50;

export interface ScheduledJobTrace {
  readonly tenantId: string;
  /** The schedule (run) identity: one enterprise + one finished week. */
  readonly scheduleId: string;
  /** Stable project + period job identity (the batch request id). */
  readonly jobId: string;
  readonly projectId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  /** Planned execution instant of the period. */
  readonly plannedAt: string;
  readonly dispatchedAt: string | null;
  readonly observedAt: string | null;
  readonly workerId: string | null;
  readonly state: ScheduledProjectEntry['state'];
  readonly attempts: number;
  readonly retryCount: number;
  readonly failureCode: string | null;
}

export interface ScheduledRunTrace {
  readonly tenantId: string;
  readonly scheduleId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly status: ScheduledRunStatus;
  readonly plannedAt: string;
  readonly claimedAt: string | null;
  readonly nextWeeklyAt: string | null;
  readonly workerId: string | null;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly finishedAt: string | null;
  readonly cancelledAt: string | null;
  readonly counts: PeriodReportScheduleRun['counts'];
  readonly failureCode: string | null;
}

function plannedAtOf(run: PeriodReportScheduleRun): string {
  return run.weeklyClaim?.dueAt ?? run.period.endAt;
}

export function buildScheduledRunTrace(run: PeriodReportScheduleRun): ScheduledRunTrace {
  return {
    tenantId: run.enterpriseId,
    scheduleId: run.runId,
    periodStart: run.period.periodStart,
    periodEnd: run.period.periodEnd,
    status: run.status,
    plannedAt: plannedAtOf(run),
    claimedAt: run.weeklyClaim?.claimedAt ?? null,
    nextWeeklyAt: run.weeklyClaim?.nextWeeklyAt ?? null,
    workerId: run.workerId ?? null,
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
    finishedAt: run.finishedAt,
    cancelledAt: run.cancelledAt ?? null,
    counts: run.counts,
    failureCode: run.lastError?.code ?? null,
  };
}

export function buildScheduledJobTraces(
  run: PeriodReportScheduleRun,
  options: { readonly limit?: number } = {},
): ScheduledJobTrace[] {
  const limit = Math.max(1, Math.min(options.limit ?? MAX_TRACES, MAX_TRACES));
  const plannedAt = plannedAtOf(run);
  return run.queue
    .map((plan) => run.projects[plan.projectId])
    .filter((entry): entry is ScheduledProjectEntry => !!entry)
    .slice(0, limit)
    .map((entry) => ({
      tenantId: run.enterpriseId,
      scheduleId: run.runId,
      jobId: entry.requestId,
      projectId: entry.plan.projectId,
      periodStart: run.period.periodStart,
      periodEnd: run.period.periodEnd,
      plannedAt,
      dispatchedAt: entry.dispatchedAt,
      observedAt: entry.observedAt,
      workerId: run.workerId ?? null,
      state: entry.state,
      attempts: entry.dispatchAttempts ?? 0,
      retryCount: entry.recheckCount,
      failureCode: entry.errorCode,
    }));
}

/**
 * One compact, redacted log line per tick. The caller decides where it goes;
 * the payload contains no project name, issue text or model output.
 */
export function scheduleTickLogPayload(input: {
  readonly enabled: boolean;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly enterprises: readonly {
    readonly enterpriseId: string;
    readonly runId: string;
    readonly status: ScheduledRunStatus | 'missing';
    readonly busy: boolean;
    readonly paused: boolean;
    readonly error: { readonly code: string } | null;
    readonly dispatchedProjects: readonly string[];
    readonly observedProjects: readonly string[];
  }[];
  readonly runs: readonly ScheduledRunTrace[];
  readonly traces: readonly ScheduledJobTrace[];
}): Record<string, unknown> {
  return {
    event: 'native_workflow_schedule_tick',
    enabled: input.enabled,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    enterprises: input.enterprises.map((enterprise) => ({
      tenantId: enterprise.enterpriseId,
      scheduleId: enterprise.runId,
      status: enterprise.status,
      busy: enterprise.busy,
      paused: enterprise.paused,
      failureCode: enterprise.error?.code ?? null,
      dispatched: enterprise.dispatchedProjects.length,
      observed: enterprise.observedProjects.length,
    })),
    runs: input.runs.slice(0, MAX_LOG_TRACES),
    jobs: input.traces.slice(0, MAX_LOG_TRACES),
    truncated: input.traces.length > MAX_LOG_TRACES,
  };
}
