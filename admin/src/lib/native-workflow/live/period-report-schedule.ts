/** B5.9 unified weekly scheduler for the four-receiver period report.
 *
 * One call:
 *   1. resolves the latest finished Shanghai Monday-to-Monday week;
 *   2. creates or reuses one schedule run per configured enterprise;
 *   3. discovers eligible projects with the existing active-project/lead/plan
 *      rules and resolves the four receivers from current business contracts;
 *   4. dispatches one project at a time through the existing B5.8 batch, with a
 *      deterministic request id per project and period;
 *   5. observes report/body/delivery/read state through the existing status
 *      reader, without executing ports or calling a model;
 *   6. maintains a reference-only issue ledger and sends idempotent in-app
 *      reminders for existing unresolved construction issues.
 *
 * The run record is host schedule state. It never replaces
 * construction_reports, construction_report_versions,
 * construction_report_deliveries, read receipts or site issues.
 */

import { randomUUID } from 'node:crypto';
import { AssistantError } from '@/lib/assistant/contracts';
import { WorkflowOperationError } from '../errors';
import { isPlainObject } from '../guards';
import type { PublishedWorkflowVersion } from '../store/types';
import type { TriggerEvent } from '../types';
import { parseFixedPeriod } from './period-event';
import type {
  PeriodReportBatchEntryState,
  PeriodReportBatchInput,
  PeriodReportBatchManifest,
} from './period-report-batch';
import type { PeriodReportBatchStore } from './period-report-batch-store';
import {
  countProjects,
  emptyCounts,
  scheduleEventId,
  scheduleRequestId,
  scheduleRunId,
  SCHEDULE_RUN_VERSION,
  type PeriodReportScheduleControl,
  type PeriodReportScheduleRun,
  type ScheduledCounts,
  type ScheduledIssueItem,
  type ScheduledPeriod,
  type ScheduledProjectEntry,
  type ScheduledProjectPlan,
  type ScheduledReceiverView,
  type ScheduledReminderRecord,
  type ScheduledRunStatus,
  type ScheduledWeeklyClaimRecord,
} from './period-report-schedule-types';
import type {
  PeriodReportScheduleEnvironment,
  ScheduleIssueSnapshot,
  ScheduleWeeklyClaim,
} from './period-report-schedule-environment';
import {
  buildScheduledJobTraces,
  buildScheduledRunTrace,
  type ScheduledJobTrace,
  type ScheduledRunTrace,
} from './period-report-schedule-observability';
import type { PeriodReportScheduleStore } from './period-report-schedule-store';
import type { PeriodReportRunObservation } from './period-report-status';
import type { LiveRunRecord, LiveRunStore, RuntimeWriteGuard } from './types';
import { MAX_NATIVE_WORKFLOW_SCHEDULE_ENTERPRISES } from './tenant-allowlist';

const DAY_MS = 86_400_000;
const SHANGHAI_OFFSET_MS = 8 * 3_600_000;
const READ_OBSERVATION_WINDOW_MS = 7 * DAY_MS;
const MAX_PROJECTS_PER_ROUND = 20;
const DEFAULT_MAX_PROJECTS_PER_ROUND = 5;
const DEFAULT_OBSERVE_INTERVAL_MS = 15 * 60_000;
const DEFAULT_READ_OBSERVE_INTERVAL_MS = 6 * 3_600_000;
const DEFAULT_MAX_RUN_MS = 90_000;
const DEFAULT_LEASE_TTL_MS = 10 * 60_000;
const DEFAULT_RECHECK_LIMIT = 3;
/** Pre-dispatch receiver/project recovery is bounded to the read window. */
const PRE_DISPATCH_RECOVERY_WINDOW_MS = 7 * DAY_MS;
/** After the fast rechecks, a still-missing receiver is retried slowly. */
const DEFAULT_ATTENTION_RECHECK_INTERVAL_MS = 6 * 3_600_000;
const MAX_PRIOR_RUNS_PER_TICK = 2;
const TERMINAL_ISSUE_STATES: ReadonlySet<string> = new Set([
  'cancelled',
  'resolved',
  'closed',
]);
const RETRYABLE_SKIP_REASONS: ReadonlySet<string> = new Set([
  'worker_missing',
  'worker_ambiguous',
  'designer_missing',
  'designer_ambiguous',
  'boss_missing',
  'boss_ambiguous',
  'executor_missing',
  'executor_separation_unavailable',
  'customer_missing',
  'customer_access_revoked',
]);
/**
 * Errors that a re-read of current business state can never fix. They stop the
 * project on the first failure instead of burning the bounded recheck budget.
 */
const PERMANENT_FAILURE_CODES: ReadonlySet<string> = new Set([
  'period_report_schedule_receivers_invalid',
  'period_report_schedule_run_invalid',
  'period_report_schedule_conflict',
  'period_report_batch_conflict',
  'published_changed',
  'construction_not_found',
  'run_scope_unavailable',
]);
/** Planning window: no dispatch/observation survives past this instant. */
const SCHEDULE_WINDOW_MS = PRE_DISPATCH_RECOVERY_WINDOW_MS;

export interface ScheduledPeriodReportDispatchOptions {
  /** Explicit enterprise allowlist. Empty means nothing is dispatched. */
  readonly enterpriseIds: readonly string[];
  /** `tick` dispatches and observes; `observe` is read-only over existing runs. */
  readonly mode?: 'tick' | 'observe';
  /** Acceptance/replay override; the default is the latest finished week. */
  readonly periodStart?: string;
  readonly maxProjectsPerRound?: number;
  readonly observeIntervalMs?: number;
  readonly readObservationIntervalMs?: number;
  readonly recheckIntervalMs?: number;
  readonly recheckLimit?: number;
  readonly maxRunDurationMs?: number;
  readonly leaseTtlMs?: number;
  readonly issuedBy?: string;
}

export interface ScheduledPeriodReportDispatchDependencies {
  /** Creates a tenant-bound adapter set for the existing multi-enterprise tick. */
  readonly forEnterprise?: (enterpriseId: string) => ScheduledPeriodReportDispatchDependencies;
  readonly store: PeriodReportScheduleStore;
  readonly batchStore: PeriodReportBatchStore;
  readonly runStore: LiveRunStore;
  readonly environment: PeriodReportScheduleEnvironment;
}

/**
 * The weekly time gate as read/claimed in this tick.
 *
 * `due` is the enterprise's configured `weekly_day`/`weekly_time` instant for
 * the resolved week; `claimed` is true only for the one call that atomically
 * advanced `next_weekly_at`. `alreadyConsumed` means the due slot was already
 * taken (by the legacy weekly path or an earlier B tick).
 */
export interface ScheduledScheduleGate {
  readonly due: boolean;
  readonly claimed: boolean;
  readonly alreadyConsumed: boolean;
  readonly dueAt: string | null;
  readonly nextWeeklyAt: string | null;
  readonly reason: string | null;
}

export interface ScheduledEnterpriseSummary {
  readonly enterpriseId: string;
  readonly runId: string;
  readonly status: ScheduledRunStatus | 'missing';
  readonly paused: boolean;
  readonly busy: boolean;
  readonly gate: ScheduledScheduleGate | null;
  readonly counts: ScheduledCounts;
  readonly dispatchedProjects: readonly string[];
  readonly observedProjects: readonly string[];
  /** Older claimed runs continued this tick (bounded). */
  readonly recoveredRuns: readonly string[];
  readonly skipReasons: readonly string[];
  readonly error: { readonly code: string; readonly message: string } | null;
}

export interface ScheduledPeriodReportDispatchSummary {
  readonly enabled: boolean;
  readonly period: ScheduledPeriod;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly enterprises: readonly ScheduledEnterpriseSummary[];
  /** Redacted run-level traces for operations; never tenant business content. */
  readonly runs: readonly ScheduledRunTrace[];
  /** Redacted per-project/period job traces (bounded). */
  readonly traces: readonly ScheduledJobTrace[];
  readonly totals: ScheduledCounts;
}

export interface ScheduledPeriodReportDispatchReadResult {
  readonly control: PeriodReportScheduleControl;
  readonly run: PeriodReportScheduleRun | null;
  readonly counts: ScheduledCounts;
  readonly runTrace: ScheduledRunTrace | null;
  readonly traces: readonly ScheduledJobTrace[];
}

interface DispatchContext extends ScheduledPeriodReportDispatchDependencies {
  readonly writeGuard?: RuntimeWriteGuard;
  readonly now: Date;
  readonly maxProjectsPerRound: number;
  readonly observeIntervalMs: number;
  readonly readObservationIntervalMs: number;
  readonly recheckIntervalMs: number;
  readonly recheckLimit: number;
  readonly maxRunDurationMs: number;
  readonly leaseTtlMs: number;
  readonly deadline: number;
  readonly mode: 'tick' | 'observe';
  readonly issuedBy: string;
}

interface EnterpriseWork {
  readonly dispatched: string[];
  readonly observed: string[];
}

function fail(code: string, status: number, message: string, details?: unknown): never {
  throw new WorkflowOperationError(code, status, message, details);
}

function positiveId(value: string): boolean {
  return /^[1-9]\d{0,18}$/.test(value);
}

function uniqueIds(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => String(value)))].filter(positiveId);
}

function calendarDate(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    ? { year, month, day }
    : null;
}

function addCalendarDays(value: string, days: number): string {
  const date = calendarDate(value);
  if (!date) fail('period_event_invalid', 409, 'periodStart must be a real calendar date');
  return new Date(Date.UTC(date.year, date.month - 1, date.day + days))
    .toISOString()
    .slice(0, 10);
}

function shanghaiDate(date: Date): string {
  return new Date(date.getTime() + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * The latest complete Shanghai Monday-to-Monday week.
 *
 * At Monday 00:00 the week that just ended is returned (right-open end equal
 * to now); on any later day the previous full week is returned. This is the
 * B5.4 weekly contract, not the legacy configurable `weekly_day` schedule.
 */
export function resolveEndedShanghaiWeek(now: Date): ScheduledPeriod {
  if (!Number.isFinite(now.getTime())) {
    fail('period_event_invalid', 409, 'the trusted clock is invalid');
  }
  const local = new Date(now.getTime() + SHANGHAI_OFFSET_MS);
  const daysSinceMonday = (local.getUTCDay() + 6) % 7;
  const mondayUtc = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
  ) - daysSinceMonday * DAY_MS;
  const monday = new Date(mondayUtc - SHANGHAI_OFFSET_MS);
  const start = new Date(monday.getTime() - 7 * DAY_MS);
  return {
    kind: 'weekly',
    periodStart: shanghaiDate(start),
    periodEnd: shanghaiDate(monday),
    startAt: start.toISOString(),
    endAt: monday.toISOString(),
  };
}

export function resolveScheduledPeriod(
  now: Date,
  periodStart?: string,
): ScheduledPeriod {
  if (periodStart === undefined) return resolveEndedShanghaiWeek(now);
  const end = addCalendarDays(periodStart, 7);
  const startDate = calendarDate(periodStart);
  const endDate = calendarDate(end);
  if (!startDate || !endDate) {
    fail('period_event_invalid', 409, 'periodStart must be a real calendar date');
  }
  const start = new Date(Date.UTC(startDate.year, startDate.month - 1, startDate.day) - SHANGHAI_OFFSET_MS);
  const endAt = new Date(Date.UTC(endDate.year, endDate.month - 1, endDate.day) - SHANGHAI_OFFSET_MS);
  return {
    kind: 'weekly',
    periodStart,
    periodEnd: end,
    startAt: start.toISOString(),
    endAt: endAt.toISOString(),
  };
}

function fixedPeriodOf(period: ScheduledPeriod, now: Date) {
  const event: TriggerEvent = {
    eventId: scheduleEventId(period.periodStart),
    eventType: 'period_report',
    occurredAt: period.endAt,
    periodKind: 'weekly',
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
  };
  // The trusted-clock ended check is shared with every live period entry.
  return parseFixedPeriod(event, now);
}

function auditEntry(
  at: string,
  action: string,
  code?: string,
  message?: string,
) {
  return {
    at,
    action,
    ...(code ? { code } : {}),
    ...(message ? { message: message.slice(0, 300) } : {}),
  };
}

function withAudit(
  run: PeriodReportScheduleRun,
  entry: { at: string; action: string; code?: string; message?: string },
): PeriodReportScheduleRun {
  return {
    ...run,
    audit: [...run.audit, entry].slice(-200),
    updatedAt: entry.at,
  };
}

function gateOf(claim: ScheduleWeeklyClaim): ScheduledScheduleGate {
  return {
    due: claim.due,
    claimed: claim.claimed,
    alreadyConsumed: claim.alreadyConsumed,
    dueAt: claim.dueAt,
    nextWeeklyAt: claim.nextWeeklyAt,
    reason: claim.reason,
  };
}

function claimRecordOf(
  period: ScheduledPeriod,
  claim: ScheduleWeeklyClaim,
  at: string,
): ScheduledWeeklyClaimRecord {
  return {
    periodStart: period.periodStart,
    claimedAt: at,
    previousNextWeeklyAt: claim.previousNextWeeklyAt,
    nextWeeklyAt: claim.nextWeeklyAt,
    dueAt: claim.dueAt,
  };
}

function hasDispatchEvidence(run: PeriodReportScheduleRun): boolean {
  return Object.values(run.projects).some((entry) =>
    !!entry.dispatchedAt || !!entry.batchStatus || entry.receivers.length > 0);
}

/**
 * A batch manifest freezes the four receiver ids. Once it exists, a later
 * recovery must reuse those ids instead of resolving receivers again.
 */
function planWithFrozenReceivers(
  plan: ScheduledProjectPlan,
  manifest: PeriodReportBatchManifest,
): ScheduledProjectPlan {
  const byKind = new Map(manifest.receivers.map((receiver) => [receiver.kind, receiver.adminId]));
  return {
    ...plan,
    workerAdminId: byKind.get('worker') ?? plan.workerAdminId,
    designerAdminId: byKind.get('designer') ?? plan.designerAdminId,
    bossAdminId: byKind.get('boss') ?? plan.bossAdminId,
    executorAdminId: manifest.actorAdminId,
  };
}

function recoveryWindowOpen(period: ScheduledPeriod, now: Date): boolean {
  return now.getTime() <= new Date(period.endAt).getTime() + PRE_DISPATCH_RECOVERY_WINDOW_MS;
}

/**
 * Cross-tenant guard for a record loaded by its deterministic id. A run file
 * that somehow carries another enterprise must never be advanced, cancelled or
 * observed by this tenant.
 */
function assertRunTenant(
  run: PeriodReportScheduleRun | null,
  enterpriseId: string,
): PeriodReportScheduleRun | null {
  if (run && run.enterpriseId !== enterpriseId) {
    fail(
      'period_report_schedule_forbidden',
      403,
      'the schedule run belongs to another enterprise',
      { runId: run.runId },
    );
  }
  return run;
}

function periodIsCancelled(
  control: PeriodReportScheduleControl,
  periodStart: string,
): boolean {
  return (control.cancelledPeriods ?? []).includes(periodStart);
}

/**
 * Terminal cancellation of one run. The evidence already written (batches,
 * receivers, deliveries, reads, issue ledger) is preserved; only the schedule
 * stops. A cancelled run is never resumed: a new week gets a new run id.
 */
function cancelledRun(
  run: PeriodReportScheduleRun,
  at: string,
  reason: string | null,
): PeriodReportScheduleRun {
  const projects = Object.fromEntries(
    Object.entries(run.projects).map(([projectId, entry]) => [
      projectId,
      { ...entry, nextObservationAt: null },
    ]),
  );
  return withAudit({
    ...run,
    status: 'cancelled',
    cancelledAt: at,
    cancelReason: reason,
    projects,
  }, auditEntry(at, 'run_cancelled', undefined, reason ?? 'tenant_cancelled'));
}

async function cancelRun(
  run: PeriodReportScheduleRun,
  context: DispatchContext,
  reason: string | null,
): Promise<PeriodReportScheduleRun> {
  if (run.status === 'cancelled') return run;
  const at = context.environment.now().toISOString();
  return context.store.update(
    finalizeRun(cancelledRun(run, at, reason), context.environment.now()),
  );
}

function withProjectAudit(
  entry: ScheduledProjectEntry,
  at: string,
  action: string,
  code?: string,
  message?: string,
): ScheduledProjectEntry {
  return {
    ...entry,
    audit: [...entry.audit, auditEntry(at, action, code, message)].slice(-50),
    updatedAt: at,
  };
}

function withEntry(
  run: PeriodReportScheduleRun,
  entry: ScheduledProjectEntry,
): PeriodReportScheduleRun {
  return {
    ...run,
    projects: { ...run.projects, [entry.plan.projectId]: entry },
    updatedAt: entry.updatedAt,
  };
}

function sameNodeVersions(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const leftIds = Object.keys(left).sort();
  const rightIds = Object.keys(right).sort();
  return leftIds.length === rightIds.length
    && leftIds.every((nodeId, index) => nodeId === rightIds[index] && left[nodeId] === right[nodeId]);
}

function publishedIdentity(published: PublishedWorkflowVersion) {
  return {
    definitionId: published.definition.definitionId,
    revision: published.revision,
    digest: published.digest,
    nodeVersions: published.nodeVersions,
  };
}

async function loadFrozenPublished(
  run: PeriodReportScheduleRun,
  environment: PeriodReportScheduleEnvironment,
): Promise<PublishedWorkflowVersion> {
  if (!run.published) {
    fail('published_unavailable', 409, 'the schedule run has no frozen published revision');
  }
  const frozen = run.published;
  let published: PublishedWorkflowVersion;
  try {
    published = await environment.loadPublished({
      definitionId: frozen.definitionId,
      revision: frozen.revision,
    });
  } catch {
    fail(
      'published_unavailable',
      409,
      `published ${frozen.definitionId}@${frozen.revision} is no longer available`,
    );
  }
  if (
    published.definition.definitionId !== frozen.definitionId
    || published.revision !== frozen.revision
    || published.digest !== frozen.digest
    || !sameNodeVersions(published.nodeVersions, frozen.nodeVersions)
  ) {
    fail(
      'published_changed',
      409,
      `published ${frozen.definitionId}@${frozen.revision} no longer matches the frozen schedule identity`,
    );
  }
  return published;
}

function initialEntry(
  plan: ScheduledProjectPlan,
  requestId: string,
  eventId: string,
  at: string,
): ScheduledProjectEntry {
  return {
    plan,
    state: 'queued',
    reason: null,
    errorCode: null,
    requestId,
    eventId,
    batchStatus: null,
    receivers: [],
    issues: [],
    carryOverIssueIds: [],
    reminders: [],
    dispatchedAt: null,
    observedAt: null,
    nextObservationAt: null,
    recheckCount: 0,
    dispatchAttempts: 0,
    updatedAt: at,
    audit: [],
  };
}

function mergeEntry(
  previous: ScheduledProjectEntry | undefined,
  next: ScheduledProjectEntry,
): ScheduledProjectEntry {
  if (!previous) return next;
  return {
    ...next,
    // A failed recovery must never erase the frozen batch evidence a previous
    // tick already observed. A real re-read can only add to it.
    receivers: previous.receivers.length ? previous.receivers : next.receivers,
    batchStatus: previous.batchStatus ?? next.batchStatus,
    dispatchedAt: previous.dispatchedAt ?? next.dispatchedAt,
    issues: previous.issues.length ? previous.issues : next.issues,
    carryOverIssueIds: previous.carryOverIssueIds.length
      ? previous.carryOverIssueIds
      : next.carryOverIssueIds,
    reminders: previous.reminders,
    recheckCount: previous.recheckCount,
    dispatchAttempts: previous.dispatchAttempts ?? next.dispatchAttempts ?? 0,
    audit: previous.audit,
  };
}

function openIssue(issue: ScheduledIssueItem): boolean {
  return !TERMINAL_ISSUE_STATES.has(issue.status);
}

function chooseReminderTarget(
  issue: ScheduledIssueItem,
  plan: ScheduledProjectPlan,
): { kind: 'worker' | 'designer' | 'boss'; adminId: string } | null {
  if (!openIssue(issue)) return null;
  const carried = issue.periods.length >= 2;
  if (!issue.ownerId || issue.status === 'invalidated' || carried) {
    return plan.bossAdminId
      ? { kind: 'boss', adminId: plan.bossAdminId }
      : null;
  }
  if (issue.status === 'awaiting_review') {
    if (plan.designerAdminId) return { kind: 'designer', adminId: plan.designerAdminId };
    return plan.bossAdminId ? { kind: 'boss', adminId: plan.bossAdminId } : null;
  }
  if (issue.status === 'implemented' || issue.status === 'resolved') {
    // Implemented evidence is waiting for formal management review/closure.
    return plan.bossAdminId ? { kind: 'boss', adminId: plan.bossAdminId } : null;
  }
  if (issue.ownerId === plan.workerAdminId && plan.workerAdminId) {
    return { kind: 'worker', adminId: plan.workerAdminId };
  }
  if (issue.ownerId === plan.designerAdminId && plan.designerAdminId) {
    return { kind: 'designer', adminId: plan.designerAdminId };
  }
  return plan.bossAdminId ? { kind: 'boss', adminId: plan.bossAdminId } : null;
}

function mergeLedger(
  previous: readonly ScheduledIssueItem[],
  issues: readonly ScheduleIssueSnapshot[],
  periodStart: string,
  now: string,
): ScheduledIssueItem[] {
  const byId = new Map(previous.map((item) => [item.issueId, item]));
  for (const issue of issues) {
    const old = byId.get(issue.issueId);
    const open = !TERMINAL_ISSUE_STATES.has(issue.status);
    const periods = open
      ? [...new Set([...(old?.periods ?? []), periodStart])]
      : [...(old?.periods ?? [])];
    byId.set(issue.issueId, {
      issueId: issue.issueId,
      sourceRecordId: issue.sourceRecordId,
      status: issue.status,
      ownerId: issue.ownerId,
      ownerName: issue.ownerName,
      lastResult: issue.lastResult,
      targetKind: old?.targetKind ?? null,
      firstPeriod: old?.firstPeriod ?? periodStart,
      lastPeriod: open ? periodStart : old?.lastPeriod ?? periodStart,
      periods,
      updatedAt: issue.updatedAt || now,
    });
  }
  return [...byId.values()]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 50);
}

function carryOverIds(items: readonly ScheduledIssueItem[], periodStart: string): string[] {
  return items
    .filter((item) => openIssue(item)
      && item.periods.length >= 2
      && item.periods.includes(periodStart))
    .map((item) => item.issueId);
}

interface ErrorClassification {
  readonly state: 'needs_attention' | 'failed' | 'unknown';
  readonly code: string;
  readonly reason: string;
}

function classifyError(error: unknown): ErrorClassification {
  if (error instanceof WorkflowOperationError) {
    if (PERMANENT_FAILURE_CODES.has(error.code)) {
      // Re-reading current state cannot resolve a frozen/conflicting identity.
      // Record the failure and stop this project instead of retrying.
      return {
        state: 'failed',
        code: error.code,
        reason: `${error.code}: ${error.message}`.slice(0, 300),
      };
    }
    if (
      error.code === 'construction_forbidden'
      || error.code === 'run_enterprise_forbidden'
      || error.code === 'published_unavailable'
    ) {
      // Permission or a temporarily unavailable published target can be
      // restored; the bounded recheck may try again.
      return { state: 'needs_attention', code: error.code, reason: error.code };
    }
    return {
      state: 'failed',
      code: error.code,
      reason: `${error.code}: ${error.message}`.slice(0, 300),
    };
  }
  if (error instanceof AssistantError) {
    if (error.status === 403 || error.status === 404) {
      return { state: 'needs_attention', code: error.code, reason: error.code };
    }
    return {
      state: 'failed',
      code: error.code,
      reason: `${error.code}: ${error.message}`.slice(0, 300),
    };
  }
  const databaseCode = (error as { code?: unknown } | null)?.code;
  if (databaseCode === '40P01' || databaseCode === '40001') {
    // A transient database conflict did not create a batch; the bounded
    // recheck may retry the same deterministic request id.
    return { state: 'needs_attention', code: 'database_conflict', reason: 'database_conflict' };
  }
  return {
    state: 'unknown',
    code: 'live_operation_unknown',
    reason: error instanceof Error ? error.message.slice(0, 300) : 'live_operation_unknown',
  };
}

function receiverViews(
  manifest: PeriodReportBatchManifest,
  previous: readonly ScheduledReceiverView[],
): ScheduledReceiverView[] {
  const old = new Map(previous.map((receiver) => [receiver.kind, receiver]));
  return manifest.entries.map((entry) => {
    const prior = old.get(entry.kind);
    // A recovered receiver has left the original manifest entry behind. Its
    // active run/report must never be replaced by the frozen old receipt that
    // the manifest still carries for audit.
    if (prior?.superseded && prior.runId !== entry.runId) return { ...prior, adminId: entry.adminId };
    const generated = entry.saveReceipt?.regenerated === true;
    return {
      kind: entry.kind,
      adminId: entry.adminId,
      runId: entry.runId,
      state: entry.state,
      reason: entry.reason,
      errorCode: entry.errorCode,
      reportId: entry.saveReceipt?.reportId ?? prior?.reportId ?? null,
      revision: entry.saveReceipt?.revision ?? prior?.revision ?? null,
      factsRunId: entry.saveReceipt?.runId ?? prior?.factsRunId ?? null,
      reportKey: entry.saveReceipt?.reportKey ?? prior?.reportKey ?? null,
      bindingId: entry.saveReceipt?.bindingId ?? prior?.bindingId ?? null,
      conversationId: entry.saveReceipt?.conversationId ?? prior?.conversationId ?? null,
      deliveryState: entry.deliveryReceipt?.status ?? prior?.deliveryState ?? null,
      messageId: entry.deliveryReceipt?.messageId ?? prior?.messageId ?? null,
      deliveryConversationId: entry.deliveryReceipt?.conversationId
        ?? prior?.deliveryConversationId
        ?? null,
      deliveredAt: prior?.deliveredAt ?? null,
      readAt: prior?.readAt ?? null,
      observedAt: entry.observation?.observedAt ?? prior?.observedAt ?? null,
      ...(generated
        ? {
            superseded: {
              runId: entry.runId,
              reportId: entry.saveReceipt?.supersededReportId ?? prior?.reportId ?? null,
              revision: entry.saveReceipt?.supersededRevision ?? prior?.revision ?? null,
              reason: entry.saveReceipt?.supersededReason ?? 'source_unavailable',
              deliveryState: prior?.deliveryState ?? null,
              messageId: prior?.messageId ?? null,
              deliveredAt: prior?.deliveredAt ?? null,
              readAt: prior?.readAt ?? null,
              replacedAt: entry.observation?.observedAt ?? entry.updatedAt,
            },
          }
        : prior?.superseded
          ? { superseded: prior.superseded }
          : {}),
    };
  });
}

function projectStateFromManifest(
  manifest: PeriodReportBatchManifest,
  receivers: readonly ScheduledReceiverView[],
): ScheduledProjectEntry['state'] {
  // Once a receiver's invalid historical report has been replaced by a
  // recovery run, the old manifest is historical evidence only. The current
  // project state is derived from the active receiver views so the old
  // source-revoked report can never be counted as delivered/completed.
  if (receivers.some((receiver) => receiver.superseded)) {
    if (receivers.some((receiver) => receiver.state === 'failed')) return 'failed';
    if (receivers.some((receiver) => receiver.state === 'unknown')) return 'unknown';
    if (receivers.some((receiver) =>
      receiver.state === 'unavailable' || receiver.state === 'stopped')) {
      return 'needs_attention';
    }
    if (receivers.every((receiver) => receiver.state === 'completed')) return 'completed';
    if (receivers.some((receiver) =>
      !!receiver.reportId && receiver.deliveryState !== 'delivered')) {
      return 'waiting_delivery';
    }
    return 'processing';
  }
  if (manifest.status === 'completed') return 'completed';
  if (manifest.status === 'failed') return 'failed';
  if (manifest.status === 'unknown') return 'unknown';
  if (manifest.status === 'partial') return 'needs_attention';
  const waiting = receivers.some((receiver) =>
    !!receiver.reportId
    && receiver.deliveryState !== 'delivered'
    && receiver.state !== 'failed'
    && receiver.state !== 'unknown');
  return waiting ? 'waiting_delivery' : 'processing';
}

function stateFromObservation(
  progress: PeriodReportRunObservation['progress'],
): PeriodReportBatchEntryState {
  if (!progress) return 'unknown';
  if (progress.overall === 'completed') return 'completed';
  if (progress.overall === 'stopped') return 'stopped';
  if (progress.overall === 'unavailable') return 'unavailable';
  if (progress.overall === 'failed') return 'failed';
  if (progress.overall === 'processing') return 'processing';
  return 'unknown';
}

function manifestReason(
  manifest: PeriodReportBatchManifest,
): string | null {
  if (!manifest.reasons.length) return null;
  return manifest.reasons.join(',').slice(0, 300);
}

function manifestErrorCode(
  manifest: PeriodReportBatchManifest,
): string | null {
  if (manifest.status !== 'failed' && manifest.status !== 'unknown') return null;
  return manifest.entries.find((entry) => entry.errorCode)?.errorCode ?? null;
}

function hasUnread(receivers: readonly ScheduledReceiverView[]): boolean {
  return receivers.some((receiver) => !!receiver.reportId && !receiver.readAt);
}

function withObservationSchedule(
  entry: ScheduledProjectEntry,
  period: ScheduledPeriod,
  now: Date,
  options: {
    readonly observeIntervalMs: number;
    readonly readObservationIntervalMs: number;
    readonly recheckIntervalMs: number;
    readonly recheckLimit: number;
  },
): ScheduledProjectEntry {
  const nowMs = now.getTime();
  // No active state is polled past the bounded read/recovery window. A run
  // that still has unfinished work at that instant is finalized as `expired`.
  const windowOpen = nowMs <= new Date(period.endAt).getTime() + SCHEDULE_WINDOW_MS;
  let next: string | null = null;
  if (entry.state === 'processing' || entry.state === 'waiting_delivery') {
    next = windowOpen ? new Date(nowMs + options.observeIntervalMs).toISOString() : null;
  } else if (entry.state === 'dispatching') {
    next = windowOpen ? new Date(nowMs + options.observeIntervalMs).toISOString() : null;
  } else if (entry.state === 'completed' || entry.state === 'partial') {
    const windowEnd = new Date(period.endAt).getTime() + READ_OBSERVATION_WINDOW_MS;
    if (hasUnread(entry.receivers) && nowMs < windowEnd) {
      next = new Date(nowMs + options.readObservationIntervalMs).toISOString();
    }
  } else if (entry.state === 'needs_attention' && recoveryWindowOpen(period, now)) {
    // Fast bounded rechecks first; after that a real receiver/permission fix
    // must still be discoverable, but at a slower cadence instead of never.
    // A frozen batch keeps being observed so a restored account/customer
    // permission can resume its original, unchanged receivers.
    const interval = entry.batchStatus
      ? options.observeIntervalMs
      : entry.recheckCount < options.recheckLimit
        ? options.recheckIntervalMs
        : Math.max(options.recheckIntervalMs, DEFAULT_ATTENTION_RECHECK_INTERVAL_MS);
    next = new Date(nowMs + interval).toISOString();
  }
  return {
    ...entry,
    nextObservationAt: next,
    updatedAt: now.toISOString(),
  };
}

function entryFromPlan(
  plan: ScheduledProjectPlan,
  run: PeriodReportScheduleRun,
  at: string,
): ScheduledProjectEntry {
  return {
    ...initialEntry(
      plan,
      scheduleRequestId(run.enterpriseId, plan.projectId, run.period.periodStart),
      scheduleEventId(run.period.periodStart),
      at,
    ),
    state: plan.skipReasons.length ? 'skipped' : 'queued',
    reason: plan.skipReasons.length ? plan.skipReasons.join(',') : null,
  };
}

async function markSkippedOrNeedsAttention(
  run: PeriodReportScheduleRun,
  plan: ScheduledProjectPlan,
  context: DispatchContext,
): Promise<PeriodReportScheduleRun> {
  const nowDate = context.environment.now();
  const now = nowDate.toISOString();
  const previous = run.projects[plan.projectId];
  const base = mergeEntry(previous, {
    ...entryFromPlan(plan, run, now),
    plan,
  });
  const retryable = plan.skipReasons.some((reason) => RETRYABLE_SKIP_REASONS.has(reason))
    && !plan.skipReasons.includes('no_period_activity');
  const state: ScheduledProjectEntry['state'] = retryable ? 'needs_attention' : 'skipped';
  const next = withObservationSchedule({
    ...base,
    state,
    reason: plan.skipReasons.join(',') || null,
    errorCode: null,
    observedAt: now,
  }, run.period, nowDate, context);
  const audited = withProjectAudit(
    next,
    now,
    retryable ? 'project_needs_attention' : 'project_skipped',
    plan.skipReasons[0],
    plan.skipReasons.join(','),
  );
  return context.store.update(withAudit(
    withEntry(run, audited),
    auditEntry(now, retryable ? 'project_needs_attention' : 'project_skipped',
      plan.skipReasons[0], `${plan.projectId}: ${plan.skipReasons.join(',')}`),
  ));
}

/**
 * Freeze-preserving attention state for an existing batch.
 *
 * The receiver/batch evidence already recorded must survive a customer or
 * receiver identity change; only the attention reason is new.
 */
async function markFrozenNeedsAttention(
  run: PeriodReportScheduleRun,
  plan: ScheduledProjectPlan,
  codes: readonly string[],
  context: DispatchContext,
): Promise<PeriodReportScheduleRun> {
  const nowDate = context.environment.now();
  const now = nowDate.toISOString();
  const previous = run.projects[plan.projectId];
  const base = previous
    ? { ...previous, plan }
    : { ...entryFromPlan(plan, run, now), plan };
  const next = withObservationSchedule({
    ...base,
    state: 'needs_attention',
    reason: [...new Set(codes)].join(',') || null,
    errorCode: null,
    observedAt: now,
  }, run.period, nowDate, context);
  const audited = withProjectAudit(
    next,
    now,
    'project_needs_attention',
    codes[0],
    [...new Set(codes)].join(','),
  );
  return context.store.update(withAudit(
    withEntry(run, audited),
    auditEntry(now, 'project_needs_attention', codes[0], `${plan.projectId}: ${codes.join(',')}`),
  ));
}

async function sendReminders(
  entry: ScheduledProjectEntry,
  plan: ScheduledProjectPlan,
  run: PeriodReportScheduleRun,
  context: DispatchContext,
): Promise<ScheduledProjectEntry> {
  const settled = new Set(
    entry.reminders
      .filter((reminder) => reminder.status === 'sent' || reminder.reason === 'already_sent')
      .map((reminder) => `${reminder.issueId}:${reminder.targetKind}:${reminder.adminId}`),
  );
  const reminders: ScheduledReminderRecord[] = [...entry.reminders];
  let sent = 0;
  for (const issue of entry.issues) {
    if (sent >= 5) break;
    const target = chooseReminderTarget(issue, plan);
    if (!target) continue;
    const key = `${issue.issueId}:${target.kind}:${target.adminId}`;
    if (settled.has(key)) continue;
    const at = context.environment.now().toISOString();
    try {
      const result = await context.environment.sendReminder({
        writeGuard: context.writeGuard,
        enterpriseId: run.enterpriseId,
        projectId: plan.projectId,
        projectName: plan.projectName,
        period: fixedPeriodOf(run.period, context.now),
        issue: {
          issueId: issue.issueId,
          sourceRecordId: issue.sourceRecordId,
          status: issue.status,
          ownerId: issue.ownerId,
          ownerName: issue.ownerName,
          lastResult: issue.lastResult,
          updatedAt: issue.updatedAt,
        },
        targetKind: target.kind,
        adminId: target.adminId,
      });
      reminders.push({
        issueId: issue.issueId,
        targetKind: target.kind,
        adminId: target.adminId,
        status: result.sent ? 'sent' : 'skipped',
        reason: result.reason,
        messageId: result.messageId,
        at,
      });
      settled.add(key);
      if (result.sent) sent += 1;
    } catch (error) {
      reminders.push({
        issueId: issue.issueId,
        targetKind: target.kind,
        adminId: target.adminId,
        status: 'skipped',
        reason: classifyError(error).reason,
        messageId: null,
        at,
      });
      settled.add(key);
    }
  }
  return {
    ...entry,
    reminders: reminders.slice(-20),
  };
}

async function observeReceipts(
  entry: ScheduledProjectEntry,
  enterpriseId: string,
  context: DispatchContext,
): Promise<ScheduledProjectEntry> {
  const plan = entry.plan;
  if (!plan.executorAdminId) return entry;
  const receivers: ScheduledReceiverView[] = [];
  for (const receiver of entry.receivers) {
    if (receiver.state === 'not_started' || !receiver.runId) {
      receivers.push(receiver);
      continue;
    }
    try {
      const observation: PeriodReportRunObservation = await context.environment.observeStatus({
        runId: receiver.runId,
        viewer: { enterpriseId, adminId: plan.executorAdminId },
      });
      if (observation.bound && observation.progress) {
        const delivery = observation.progress.delivery;
        const binding = observation.binding;
        const recovered = !!receiver.superseded;
        receivers.push({
          ...receiver,
          ...(recovered
            ? {
                state: stateFromObservation(observation.progress),
                reason: observation.progress.overall === 'completed'
                  || observation.progress.overall === 'processing'
                  ? null
                  : observation.progress.availability.reason
                    ?? observation.progress.reasons[0]
                    ?? observation.progress.overall,
                errorCode: observation.progress.overall === 'failed'
                  ? observation.progress.reasons[0] ?? null
                  : null,
                ...(binding
                  ? {
                      reportId: binding.reportId,
                      revision: binding.reportRevision,
                      factsRunId: binding.factsRunId,
                      reportKey: binding.reportKey,
                      bindingId: binding.bindingId,
                      conversationId: binding.conversationId,
                    }
                  : {}),
              }
            : {}),
          deliveryState: delivery.deliveryState ?? receiver.deliveryState,
          messageId: delivery.messageId ?? receiver.messageId,
          deliveryConversationId: delivery.conversationId ?? receiver.deliveryConversationId,
          deliveredAt: delivery.deliveredAt ?? receiver.deliveredAt,
          readAt: delivery.readAt ?? receiver.readAt,
          observedAt: observation.observedAt,
        });
      } else {
        receivers.push({ ...receiver, observedAt: observation.observedAt });
      }
    } catch {
      // A status read failure is data for the schedule record; it never rewrites
      // an already observed delivery or read receipt.
      receivers.push(receiver);
    }
  }
  return {
    ...entry,
    receivers,
    observedAt: context.environment.now().toISOString(),
  };
}

function applyManifest(
  entry: ScheduledProjectEntry,
  manifest: PeriodReportBatchManifest,
  at: string,
): ScheduledProjectEntry {
  const receivers = receiverViews(manifest, entry.receivers);
  const state = projectStateFromManifest(manifest, receivers);
  const activeIssue = receivers.find((receiver) =>
    receiver.state === 'unavailable'
    || receiver.state === 'stopped'
    || receiver.state === 'failed'
    || receiver.state === 'unknown');
  return {
    ...entry,
    state,
    reason: state === 'completed'
      ? null
      : activeIssue
        ? `${activeIssue.kind}:${activeIssue.reason ?? activeIssue.state}`
        : manifestReason(manifest) ?? entry.reason,
    errorCode: activeIssue?.errorCode ?? manifestErrorCode(manifest) ?? entry.errorCode,
    batchStatus: manifest.status,
    receivers,
    observedAt: at,
    updatedAt: at,
  };
}

async function buildBatchInput(
  run: PeriodReportScheduleRun,
  plan: ScheduledProjectPlan,
  context: DispatchContext,
): Promise<PeriodReportBatchInput> {
  if (!plan.executorAdminId || !plan.workerAdminId || !plan.designerAdminId || !plan.bossAdminId) {
    fail('period_report_schedule_receivers_invalid', 422, 'the project plan has no complete receiver set');
  }
  const published = await loadFrozenPublished(run, context.environment);
  const actor = { enterpriseId: run.enterpriseId, adminId: plan.executorAdminId };
  const event: TriggerEvent = {
    eventId: scheduleEventId(run.period.periodStart),
    eventType: 'period_report',
    occurredAt: run.period.endAt,
    periodKind: 'weekly',
    periodStart: run.period.periodStart,
    periodEnd: run.period.periodEnd,
  };
  return {
    requestId: scheduleRequestId(run.enterpriseId, plan.projectId, run.period.periodStart),
    enterpriseId: run.enterpriseId,
    projectId: plan.projectId,
    actor,
    event,
    receivers: [
      { kind: 'customer' },
      { kind: 'worker', adminId: plan.workerAdminId },
      { kind: 'designer', adminId: plan.designerAdminId },
      { kind: 'boss', adminId: plan.bossAdminId },
    ],
    loadPublished: async () => published,
    writeGuard: context.writeGuard,
    portsFor: (receiver, writeGuard) => context.environment.portsFor(receiver, {
      writeGuard,
      enterpriseId: run.enterpriseId,
      projectId: plan.projectId,
      actor,
    }),
    runStore: context.runStore,
    batchStore: context.batchStore,
  };
}

async function dispatchProject(
  run: PeriodReportScheduleRun,
  plan: ScheduledProjectPlan,
  context: DispatchContext,
  work: EnterpriseWork,
): Promise<PeriodReportScheduleRun> {
  const now = context.environment.now().toISOString();
  const previous = run.projects[plan.projectId];
  const requestId = scheduleRequestId(run.enterpriseId, plan.projectId, run.period.periodStart);
  // Once a batch manifest exists its receivers, project, period and published
  // revision are frozen. Recovery reuses those ids and never re-resolves them,
  // even when the database now offers a different worker/designer/boss.
  const manifest = await context.batchStore.get(requestId);
  const effectivePlan = manifest ? planWithFrozenReceivers(plan, manifest) : plan;

  if (
    !effectivePlan.executorAdminId
    || !effectivePlan.workerAdminId
    || !effectivePlan.designerAdminId
    || !effectivePlan.bossAdminId
    || !effectivePlan.customerUserId
    || (!manifest && effectivePlan.skipReasons.length)
  ) {
    const reasons = manifest && !effectivePlan.customerUserId
      ? [...new Set([...effectivePlan.skipReasons, 'customer_missing'])]
      : [...new Set(effectivePlan.skipReasons)];
    const codes = reasons.length ? reasons : ['receiver_incomplete'];
    return manifest
      ? markFrozenNeedsAttention(run, effectivePlan, codes, context)
      : markSkippedOrNeedsAttention(
        run,
        { ...effectivePlan, skipReasons: codes },
        context,
      );
  }

  // The customer receiver is identity-less in the host manifest; re-read the
  // current lead/customer binding before any recovery so a changed or revoked
  // customer is refused instead of silently replaced.
  const customer = await context.environment.ensureCustomerBinding({
    writeGuard: context.writeGuard,
    enterpriseId: run.enterpriseId,
    projectId: effectivePlan.projectId,
    customerUserId: effectivePlan.customerUserId,
  });
  if (!customer.available) {
    const reason = customer.reason ?? 'customer_receiver_unavailable';
    return manifest
      ? markFrozenNeedsAttention(run, effectivePlan, [reason], context)
      : markSkippedOrNeedsAttention(run, {
        ...effectivePlan,
        skipReasons: [...effectivePlan.skipReasons, reason],
      }, context);
  }

  const issues = await context.environment.loadIssues({
    enterpriseId: run.enterpriseId,
    projectId: effectivePlan.projectId,
    period: fixedPeriodOf(run.period, context.now),
  });
  const ledger = await context.store.ledger(run.enterpriseId, effectivePlan.projectId);
  const merged = mergeLedger(ledger.items, issues, run.period.periodStart, now);
  const targeted = merged.map((issue) => ({
    ...issue,
    targetKind: chooseReminderTarget(issue, effectivePlan)?.kind ?? issue.targetKind ?? null,
  }));
  await context.store.saveLedger({
    ...ledger,
    items: targeted,
    updatedAt: now,
  });

  const entry = {
    ...mergeEntry(previous, {
      ...initialEntry(
        effectivePlan,
        requestId,
        scheduleEventId(run.period.periodStart),
        now,
      ),
      state: 'dispatching',
      issues: targeted,
      carryOverIssueIds: carryOverIds(targeted, run.period.periodStart),
      dispatchedAt: now,
      nextObservationAt: new Date(context.now.getTime() + context.observeIntervalMs).toISOString(),
    }),
    // A dispatch attempt is counted even when the batch later fails; a retry
    // that merely observes the frozen manifest does not increment it.
    dispatchAttempts: (previous?.dispatchAttempts ?? 0) + 1,
  };
  let current = withEntry(
    withAudit(run, auditEntry(now, 'project_dispatched', undefined, effectivePlan.projectId)),
    withProjectAudit(entry, now, 'project_dispatched'),
  );
  current = await context.store.update(current);

  let next: ScheduledProjectEntry;
  try {
    const input = await buildBatchInput(current, effectivePlan, context);
    const result = await context.environment.runBatch(input);
    next = applyManifest(entry, result.manifest, context.environment.now().toISOString());
    next = await observeReceipts(next, current.enterpriseId, context);
    next = applyObservedState(next, result.manifest);
    next = await sendReminders(next, effectivePlan, current, context);
    next = withObservationSchedule(next, current.period, context.environment.now(), context);
    work.dispatched.push(effectivePlan.projectId);
  } catch (error) {
    const classified = classifyError(error);
    const at = context.environment.now().toISOString();
    let recovered = withProjectAudit(
      {
        ...entry,
        state: classified.state,
        reason: classified.reason,
        errorCode: classified.code,
        nextObservationAt: null,
      },
      at,
      'project_dispatch_failed',
      classified.code,
      classified.reason,
    );
    recovered = await sendReminders(recovered, effectivePlan, current, context);
    next = recovered;
    work.dispatched.push(effectivePlan.projectId);
  }

  const at = context.environment.now().toISOString();
  const audited = withProjectAudit(
    withObservationSchedule(next, current.period, context.environment.now(), context),
    at,
    'project_state',
    next.state === 'failed' || next.state === 'unknown' ? next.errorCode ?? undefined : undefined,
    `${next.state}${next.reason ? `:${next.reason}` : ''}`,
  );
  return context.store.update(withEntry(current, audited));
}

function applyObservedState(
  entry: ScheduledProjectEntry,
  manifest: PeriodReportBatchManifest,
): ScheduledProjectEntry {
  if (!entry.receivers.some((receiver) => receiver.superseded)) return entry;
  const state = projectStateFromManifest(manifest, entry.receivers);
  const activeIssue = entry.receivers.find((receiver) =>
    receiver.state === 'unavailable'
    || receiver.state === 'stopped'
    || receiver.state === 'failed'
    || receiver.state === 'unknown');
  return {
    ...entry,
    state,
    reason: state === 'completed'
      ? null
      : activeIssue
        ? `${activeIssue.kind}:${activeIssue.reason ?? activeIssue.state}`
        : entry.reason,
    errorCode: activeIssue?.errorCode ?? entry.errorCode,
  };
}

function schedulerEvent(period: ScheduledPeriod): TriggerEvent {
  return {
    eventId: scheduleEventId(period.periodStart),
    eventType: 'period_report',
    occurredAt: period.endAt,
    periodKind: 'weekly',
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
  };
}

/**
 * The save receipt a recovery run actually produced. A trace without a
 * confirmed save is never treated as a replacement report.
 */
function savedReportReceipt(record: LiveRunRecord): {
  readonly reportId: string;
  readonly revision: number;
  readonly runId: string;
  readonly reportKey: string;
  readonly bindingId: string;
  readonly conversationId: string;
} | null {
  const operation = [...record.operations]
    .reverse()
    .find((candidate) => candidate.capabilityRef === 'save.period_report');
  const receipt = operation?.outputs?.saveReceipt;
  if (
    operation?.outcome !== 'succeeded'
    || operation.outputs?.saved !== true
    || !isPlainObject(receipt)
    || typeof receipt.reportId !== 'string'
    || typeof receipt.revision !== 'number'
    || typeof receipt.runId !== 'string'
    || typeof receipt.reportKey !== 'string'
    || typeof receipt.bindingId !== 'string'
    || typeof receipt.conversationId !== 'string'
  ) {
    return null;
  }
  return {
    reportId: receipt.reportId,
    revision: Number(receipt.revision),
    runId: receipt.runId,
    reportKey: receipt.reportKey,
    bindingId: receipt.bindingId,
    conversationId: receipt.conversationId,
  };
}

function isSourceRevoked(receiver: ScheduledReceiverView): boolean {
  return receiver.state === 'unavailable'
    && !!receiver.reportId
    && !!receiver.reason
    && (receiver.reason === 'source_unavailable' || receiver.reason.startsWith('source_'));
}

/**
 * Replace one source-revoked historical report with a new immutable revision
 * under a deterministic recovery run id.
 *
 * The frozen batch manifest stays untouched as historical evidence. The
 * receiver view records the old report, message and read receipt under
 * `superseded`, and only the recovery run/report is observed afterwards.
 */
async function recoverInvalidReport(
  run: PeriodReportScheduleRun,
  entry: ScheduledProjectEntry,
  context: DispatchContext,
): Promise<ScheduledProjectEntry | null> {
  if (!recoveryWindowOpen(run.period, context.environment.now())) return null;
  if (!entry.batchStatus || !entry.plan.executorAdminId || !run.published) return null;
  const candidate = entry.receivers.find((receiver) =>
    isSourceRevoked(receiver) && !receiver.superseded);
  if (!candidate) return null;
  if (candidate.kind !== 'customer' && !candidate.adminId) return null;
  const now = context.environment.now().toISOString();
  const recoveryRunId = `${entry.requestId}-${candidate.kind}-recovery`;
  try {
    const result = await context.environment.recoverReceiver({
      writeGuard: context.writeGuard,
      enterpriseId: run.enterpriseId,
      projectId: entry.plan.projectId,
      actor: { enterpriseId: run.enterpriseId, adminId: entry.plan.executorAdminId },
      event: schedulerEvent(run.period),
      receiver: candidate.kind === 'customer'
        ? { kind: 'customer' }
        : { kind: candidate.kind, adminId: candidate.adminId! },
      runId: recoveryRunId,
      published: {
        definitionId: run.published.definitionId,
        revision: run.published.revision,
      },
    });
    const receipt = savedReportReceipt(result.record);
    const replacement: ScheduledReceiverView = {
      kind: candidate.kind,
      adminId: candidate.adminId,
      runId: recoveryRunId,
      state: receipt ? 'processing' : result.record.status === 'failed' ? 'failed' : 'unknown',
      reason: receipt ? null : result.record.state.error?.code ?? 'recovery_save_missing',
      errorCode: receipt ? null : result.record.state.error?.code ?? null,
      reportId: receipt?.reportId ?? null,
      revision: receipt?.revision ?? null,
      factsRunId: receipt?.runId ?? null,
      reportKey: receipt?.reportKey ?? null,
      bindingId: receipt?.bindingId ?? null,
      conversationId: receipt?.conversationId ?? null,
      deliveryState: null,
      messageId: null,
      deliveryConversationId: null,
      deliveredAt: null,
      readAt: null,
      observedAt: now,
      superseded: {
        runId: candidate.runId,
        reportId: candidate.reportId,
        revision: candidate.revision,
        reason: candidate.reason,
        deliveryState: candidate.deliveryState,
        messageId: candidate.messageId,
        deliveredAt: candidate.deliveredAt,
        readAt: candidate.readAt,
        replacedAt: now,
      },
    };
    const replaced: ScheduledProjectEntry = {
      ...entry,
      receivers: entry.receivers.map((receiver) =>
        receiver.kind === candidate.kind ? replacement : receiver),
      state: receipt ? 'waiting_delivery' : 'processing',
      reason: null,
      errorCode: null,
      observedAt: now,
      updatedAt: now,
    };
    const observed = await observeReceipts(replaced, run.enterpriseId, context);
    return withProjectAudit(
      observed,
      now,
      'receiver_report_recovered',
      candidate.reason ?? undefined,
      `${candidate.kind}:${candidate.reportId}:${candidate.revision}`
        + `->${receipt ? `${receipt.reportId}:${receipt.revision}` : 'pending'}`,
    );
  } catch (error) {
    const classified = classifyError(error);
    return withProjectAudit(
      {
        ...entry,
        state: 'needs_attention',
        reason: `${candidate.kind}:${classified.reason}`,
        errorCode: classified.code,
        observedAt: now,
        updatedAt: now,
      },
      now,
      'receiver_recovery_failed',
      classified.code,
      `${candidate.kind}: ${classified.reason}`,
    );
  }
}

async function observeProject(
  run: PeriodReportScheduleRun,
  projectId: string,
  context: DispatchContext,
  work: EnterpriseWork,
): Promise<PeriodReportScheduleRun> {
  const entry = run.projects[projectId];
  if (!entry || (!entry.batchStatus && !entry.dispatchedAt)) return run;
  const manifest = await context.batchStore.get(entry.requestId);
  const plan = manifest ? planWithFrozenReceivers(entry.plan, manifest) : entry.plan;
  if (!plan.executorAdminId) return run;
  if (manifest && !plan.customerUserId) {
    return markFrozenNeedsAttention(run, plan, ['customer_missing'], context);
  }
  if (manifest) {
    // A never-started customer sub-run must not be dispatched to a changed or
    // revoked customer after the manifest froze the original receiver set.
    const customer = await context.environment.ensureCustomerBinding({
      writeGuard: context.writeGuard,
      enterpriseId: run.enterpriseId,
      projectId: plan.projectId,
      customerUserId: plan.customerUserId!,
    });
    if (!customer.available) {
      return markFrozenNeedsAttention(
        run,
        plan,
        [customer.reason ?? 'customer_receiver_unavailable'],
        context,
      );
    }
  }
  try {
    const input = await buildBatchInput(run, plan, context);
    const result = await context.environment.runBatch(input);
    let next = applyManifest(
      { ...entry, plan },
      result.manifest,
      context.environment.now().toISOString(),
    );
    next = await observeReceipts(next, run.enterpriseId, context);
    next = applyObservedState(next, result.manifest);
    next = await recoverInvalidReport(run, next, context) ?? next;
    next = withObservationSchedule(next, run.period, context.environment.now(), context);
    work.observed.push(projectId);
    const at = context.environment.now().toISOString();
    const audited = withProjectAudit(
      next,
      at,
      'project_observed',
      undefined,
      `${next.state}${next.reason ? `:${next.reason}` : ''}`,
    );
    return context.store.update(
      withAudit(
        withEntry(run, audited),
        auditEntry(at, 'project_observed', undefined, `${projectId}: ${next.state}`),
      ),
    );
  } catch (error) {
    const classified = classifyError(error);
    const at = context.environment.now().toISOString();
    const next = withObservationSchedule(withProjectAudit(
      {
        ...entry,
        // A later observation cannot deny evidence a delivered report already
        // produced. It becomes a schedule attention item instead of a re-run.
        state: entry.state === 'completed' ? 'needs_attention' : entry.state,
        reason: classified.reason,
        errorCode: classified.code,
        nextObservationAt: null,
      },
      at,
      'project_observation_failed',
      classified.code,
      classified.reason,
    ), run.period, context.environment.now(), context);
    work.observed.push(projectId);
    return context.store.update(withEntry(
      withAudit(run, auditEntry(at, 'project_observation_failed', classified.code, `${projectId}: ${classified.reason}`)),
      next,
    ));
  }
}

async function recheckProject(
  run: PeriodReportScheduleRun,
  entry: ScheduledProjectEntry,
  context: DispatchContext,
): Promise<PeriodReportScheduleRun> {
  const now = context.environment.now().toISOString();
  // A manifest is the freeze point: receivers, project, period, executor and
  // published revision can no longer be re-determined. Resume the existing
  // batch with its original identities instead of discovering new ones.
  const manifest = await context.batchStore.get(entry.requestId);
  if (manifest) {
    const plan = planWithFrozenReceivers(entry.plan, manifest);
    const next = withProjectAudit(
      {
        ...entry,
        plan,
        state: 'dispatching',
        reason: null,
        errorCode: null,
        recheckCount: entry.recheckCount + 1,
        nextObservationAt: now,
      },
      now,
      'project_rechecked',
      undefined,
      'batch_frozen_resume',
    );
    return context.store.update(withEntry(
      withAudit(
        run,
        auditEntry(now, 'project_rechecked', undefined, `${entry.plan.projectId}: batch_frozen_resume`),
      ),
      next,
    ));
  }
  try {
    const discovery = await context.environment.discover({
      enterpriseId: run.enterpriseId,
      period: fixedPeriodOf(run.period, context.now),
      projectId: entry.plan.projectId,
    });
    const plan = discovery.projects.find((candidate) => candidate.projectId === entry.plan.projectId);
    const recheckCount = entry.recheckCount + 1;
    if (!plan || discovery.skipReasons.length) {
      const reasons = [...discovery.skipReasons, ...(plan?.skipReasons ?? ['project_unavailable'])];
      const next = withProjectAudit(
        {
          ...entry,
          state: 'needs_attention',
          reason: [...new Set(reasons)].join(','),
          errorCode: null,
          recheckCount,
        },
        now,
        'project_rechecked',
        reasons[0],
        [...new Set(reasons)].join(','),
      );
      return context.store.update(
        withEntry(run, withObservationSchedule(next, run.period, context.environment.now(), context)),
      );
    }
    if (plan.skipReasons.length) {
      const next = withProjectAudit(
        {
          ...entry,
          plan,
          state: 'needs_attention',
          reason: plan.skipReasons.join(','),
          errorCode: null,
          recheckCount,
        },
        now,
        'project_rechecked',
        plan.skipReasons[0],
        plan.skipReasons.join(','),
      );
      return context.store.update(
        withEntry(run, withObservationSchedule(next, run.period, context.environment.now(), context)),
      );
    }
    // The receiver/permission gap is resolved. The same deterministic request
    // id is safe because no batch manifest or sub-run was ever created.
    const ready = withProjectAudit(
      {
        ...entry,
        plan,
        state: 'queued',
        reason: null,
        errorCode: null,
        recheckCount,
        nextObservationAt: null,
      },
      now,
      'project_rechecked',
      undefined,
      'receivers_available',
    );
    return context.store.update(withEntry(
      withAudit(run, auditEntry(now, 'project_rechecked', undefined, `${entry.plan.projectId}: receivers_available`)),
      ready,
    ));
  } catch (error) {
    const classified = classifyError(error);
    // A permanent/unknown recheck failure is terminal for this project: the
    // entry stops being rescheduled instead of retrying until the window ends.
    const next = withProjectAudit(
      {
        ...entry,
        state: classified.state === 'needs_attention' ? entry.state : classified.state,
        recheckCount: entry.recheckCount + 1,
        reason: classified.reason,
        errorCode: classified.code,
        nextObservationAt: classified.state === 'needs_attention'
          ? entry.nextObservationAt
          : null,
      },
      now,
      'project_recheck_failed',
      classified.code,
      classified.reason,
    );
    return context.store.update(
      withEntry(run, withObservationSchedule(next, run.period, context.environment.now(), context)),
    );
  }
}

function runStatus(run: PeriodReportScheduleRun): ScheduledRunStatus {
  // Cancellation and expiry are explicit terminal states; a later tick must
  // not recompute them back into an active status.
  if (run.status === 'cancelled' || run.status === 'expired') return run.status;
  if (run.lastError) return 'failed';
  const plans = run.queue;
  if (plans.length === 0) return run.lastError ? 'failed' : 'completed';
  const entries = plans
    .map((plan) => run.projects[plan.projectId])
    .filter((entry): entry is ScheduledProjectEntry => !!entry);
  const dispatching = plans.some((plan) => {
    const entry = run.projects[plan.projectId];
    return !entry
      || entry.state === 'queued'
      || (entry.state === 'dispatching' && !entry.batchStatus);
  });
  const working = entries.some((entry) =>
    entry.state === 'dispatching'
    || entry.state === 'processing'
    || entry.state === 'waiting_delivery');
  const failed = entries.filter((entry) =>
    entry.state === 'failed' || entry.state === 'unknown');
  const partial = entries.filter((entry) =>
    entry.state === 'partial'
    || entry.state === 'needs_attention'
    || entry.state === 'skipped');
  const completed = entries.filter((entry) => entry.state === 'completed');
  const observing = entries.some((entry) => !!entry.nextObservationAt);
  if (dispatching) return 'dispatching';
  if (working) return 'observing';
  if (failed.length === plans.length) return 'failed';
  if (partial.length || failed.length) return observing ? 'observing' : 'partial';
  if (completed.length === plans.length) return observing ? 'observing' : 'completed';
  return 'dispatching';
}

function finalizeRun(
  run: PeriodReportScheduleRun,
  now: Date,
): PeriodReportScheduleRun {
  const computed = runStatus(run);
  // Unfinished dispatch/observation past the bounded window is reported as an
  // explicit `expired` run instead of a permanently "dispatching" record.
  const expired = !recoveryWindowOpen(run.period, now)
    && (computed === 'dispatching' || computed === 'observing');
  const status: ScheduledRunStatus = expired ? 'expired' : computed;
  const counts = countProjects(run.queue, run.projects);
  const entries = Object.values(run.projects);
  const observing = entries.some((entry) => !!entry.nextObservationAt);
  const terminal = status === 'completed'
    || status === 'partial'
    || status === 'failed'
    || status === 'cancelled'
    || status === 'expired';
  const next = expired && run.status !== 'expired'
    ? withAudit(run, auditEntry(
      now.toISOString(),
      'run_expired',
      undefined,
      'the weekly recovery/read window closed with unfinished work',
    ))
    : run;
  return {
    ...next,
    status,
    counts,
    updatedAt: now.toISOString(),
    finishedAt: terminal && !observing ? next.finishedAt ?? now.toISOString() : null,
  };
}

async function advanceRun(
  input: PeriodReportScheduleRun,
  context: DispatchContext,
  work: EnterpriseWork,
): Promise<PeriodReportScheduleRun> {
  let run = input;
  const nowMs = () => context.environment.now().getTime();
  // A tenant cancellation is re-read before observation and again before every
  // dispatch, so a cancel issued mid-tick stops the remaining projects.
  const initialControl = await context.store.control(run.enterpriseId);
  if (periodIsCancelled(initialControl, run.period.periodStart)) {
    return cancelRun(run, context, initialControl.reason);
  }
  if (initialControl.paused) return run;
  const due = run.queue
    .map((plan) => run.projects[plan.projectId])
    .filter((entry): entry is ScheduledProjectEntry =>
      !!entry
      && !!entry.nextObservationAt
      && new Date(entry.nextObservationAt).getTime() <= nowMs())
    .slice(0, context.maxProjectsPerRound);
  for (const entry of due) {
    if (nowMs() > context.deadline) {
      run = withAudit(run, auditEntry(context.environment.now().toISOString(), 'deferred_due_to_time_budget'));
      break;
    }
    const control = await context.store.control(run.enterpriseId);
    if (periodIsCancelled(control, run.period.periodStart)) return cancelRun(run, context, control.reason);
    if (control.paused) return run;
    run = await observeProject(run, entry.plan.projectId, context, work);
  }

  if (context.mode === 'tick') {
    // The weekly slot is claimed once by `runEnterprise` before this run is
    // created. This function only recovers/observes what that claim produced,
    // so a `next_weekly_at` that already moved to the next week never stops an
    // in-flight batch.
    const recoveryOpen = recoveryWindowOpen(run.period, context.environment.now());
    const rechecks = run.queue
      .map((plan) => run.projects[plan.projectId])
      .filter((entry): entry is ScheduledProjectEntry =>
        !!entry
        && entry.state === 'needs_attention'
        && !entry.batchStatus
        && recoveryOpen
        && !!entry.nextObservationAt
        && new Date(entry.nextObservationAt).getTime() <= nowMs())
      .slice(0, context.maxProjectsPerRound);
    for (const entry of rechecks) {
      if (nowMs() > context.deadline) {
        run = withAudit(run, auditEntry(context.environment.now().toISOString(), 'deferred_due_to_time_budget'));
        break;
      }
      run = await recheckProject(run, entry, context);
    }

    const pending = run.queue.filter((plan) => {
      const entry = run.projects[plan.projectId];
      if (!entry) return true;
      if (entry.state === 'queued' || entry.state === 'dispatching') return true;
      return entry.state === 'needs_attention'
        && !entry.batchStatus
        && recoveryOpen
        && !!entry.nextObservationAt
        && new Date(entry.nextObservationAt).getTime() <= nowMs();
    });
    let dispatched = 0;
    for (const plan of pending) {
      if (dispatched >= context.maxProjectsPerRound) break;
      if (nowMs() > context.deadline) {
        run = withAudit(run, auditEntry(context.environment.now().toISOString(), 'deferred_due_to_time_budget'));
        break;
      }
      const control = await context.store.control(run.enterpriseId);
      if (periodIsCancelled(control, run.period.periodStart)) {
        return cancelRun(run, context, control.reason);
      }
      if (control.paused) {
        run = withAudit(run, auditEntry(context.environment.now().toISOString(), 'dispatch_paused'));
        break;
      }
      const effectivePlan = run.projects[plan.projectId]?.plan ?? plan;
      // `dispatchProject` clamps a manifest-frozen batch and skips a fresh plan
      // with missing receivers; it never substitutes a new receiver.
      run = await dispatchProject(run, effectivePlan, context, work);
      dispatched += 1;
    }
  }

  return context.store.update(finalizeRun(run, context.environment.now()));
}

async function createRun(
  enterpriseId: string,
  period: ScheduledPeriod,
  context: DispatchContext,
  ownership: {
    readonly claim: ScheduledWeeklyClaimRecord | null;
    readonly replay: boolean;
  },
): Promise<PeriodReportScheduleRun> {
  const now = context.environment.now().toISOString();
  let published: PublishedWorkflowVersion | null = null;
  let publishedFailure: { code: string; message: string } | null = null;
  try {
    published = await context.environment.loadPublished();
  } catch (error) {
    publishedFailure = {
      code: 'published_unavailable',
      message: error instanceof Error ? error.message.slice(0, 300) : 'published_unavailable',
    };
  }
  const discovery = publishedFailure
    ? { enterpriseName: '', skipReasons: [], projects: [], excludedProjects: 0 }
    : await context.environment.discover({ enterpriseId, period: fixedPeriodOf(period, context.now) });
  const skipReasons = [
    ...(publishedFailure ? [publishedFailure.code] : []),
    ...discovery.skipReasons,
  ];
  const run: PeriodReportScheduleRun = {
    runVersion: SCHEDULE_RUN_VERSION,
    runId: scheduleRunId(enterpriseId, period.periodStart),
    enterpriseId,
    period,
    weeklyClaim: ownership.claim,
    published: published ? publishedIdentity(published) : null,
    status: skipReasons.length ? 'failed' : 'discovered',
    queue: discovery.projects,
    projects: {},
    counts: countProjects(discovery.projects, {}),
    startedAt: now,
    updatedAt: now,
    finishedAt: skipReasons.length ? now : null,
    lastError: skipReasons.length
      ? {
          code: skipReasons[0]!,
          message: skipReasons.join(','),
        }
      : null,
    audit: [
      auditEntry(now, 'run_created', undefined,
        `projects=${discovery.projects.length};excluded=${discovery.excludedProjects}`),
      ...(ownership.replay
        ? [auditEntry(now, 'replay_without_claim', undefined,
          'an explicit old-period replay never moves the current weekly slot')]
        : []),
      ...(ownership.claim
        ? [auditEntry(now, 'weekly_schedule_claimed', undefined,
          `${ownership.claim.previousNextWeeklyAt ?? ''}->${ownership.claim.nextWeeklyAt ?? ''}`)]
        : []),
      ...(skipReasons.length
        ? [auditEntry(now, 'discovery_skipped', skipReasons[0], skipReasons.join(','))]
        : []),
    ],
  };
  const created = await context.store.create(run);
  if (!created.created && ownership.claim && !created.run.weeklyClaim) {
    // A concurrent creator wrote the run before this tick recorded the claim.
    // The claim is immutable, so attach the atomically won receipt once.
    return context.store.update({
      ...created.run,
      weeklyClaim: ownership.claim,
      audit: [
        ...created.run.audit,
        auditEntry(now, 'weekly_schedule_claimed', undefined,
          `${ownership.claim.previousNextWeeklyAt ?? ''}->${ownership.claim.nextWeeklyAt ?? ''}`),
      ].slice(-200),
      updatedAt: now,
    });
  }
  return created.run;
}

function runHasWork(run: PeriodReportScheduleRun, nowMs: number): boolean {
  // Cancellation/expiry are terminal for all discovery, dispatch and polling.
  if (run.status === 'cancelled' || run.status === 'expired') return false;
  // A configuration failure is terminal for this period; a later tick must not
  // hammer the same disabled/missing plan. The next period creates a new run.
  if (run.status === 'failed' && run.lastError) return false;
  if (run.queue.length === 0) return run.status === 'discovered';
  const recoveryOpen = recoveryWindowOpen(run.period, new Date(nowMs));
  const pending = run.queue.some((plan) => {
    const entry = run.projects[plan.projectId];
    if (!entry) return true;
    if (entry.state === 'queued' || entry.state === 'dispatching') return true;
    return entry.state === 'needs_attention'
      && !entry.batchStatus
      && recoveryOpen
      && (!entry.nextObservationAt || new Date(entry.nextObservationAt).getTime() <= nowMs);
  });
  if (pending) return true;
  return Object.values(run.projects).some((entry) =>
    !!entry.nextObservationAt
    && new Date(entry.nextObservationAt).getTime() <= nowMs);
}

interface EnterpriseRunResult {
  readonly run: PeriodReportScheduleRun | null;
  readonly busy: boolean;
  readonly work: EnterpriseWork;
  readonly gate: ScheduledScheduleGate | null;
  readonly error: { readonly code: string; readonly message: string } | null;
}

/**
 * Continue one existing run under its lease. No claim and no receiver
 * discovery happen here; the run already owns its period.
 */
async function continueRun(
  run: PeriodReportScheduleRun,
  enterpriseId: string,
  context: DispatchContext,
  work: EnterpriseWork,
  gate: ScheduledScheduleGate | null,
): Promise<EnterpriseRunResult> {
  if (!runHasWork(run, context.environment.now().getTime())) {
    return { run, busy: false, work, gate, error: run.lastError ?? null };
  }
  const scoped = assertRunTenant(run, enterpriseId);
  if (!scoped) return { run: null, busy: false, work, gate, error: null };
  const fence = { owner: `${process.pid}:${randomUUID()}`, token: randomUUID() };
  const acquired = await context.store.acquire(run.runId, {
    ...fence,
    now: () => context.environment.now(),
    ttlMs: context.leaseTtlMs,
  });
  if (!acquired) {
    return {
      run: await context.store.get(run.runId),
      busy: true,
      work,
      gate,
      error: null,
    };
  }
  try {
    // The lease owner is the worker identity recorded on the run and in the
    // redacted traces. A crash leaves it behind; the next owner replaces it.
    const current = assertRunTenant(await context.store.get(scoped.runId), enterpriseId);
    if (!current || !runHasWork(current, context.environment.now().getTime())) {
      return { run: current, busy: false, work, gate, error: current?.lastError ?? null };
    }
    const assertLease = context.store.assertLease;
    const leasedContext: DispatchContext = {
      ...context,
      store: {
        ...context.store,
        update: (candidate) => context.store.update(candidate, fence),
        saveLedger: (ledger) => context.store.saveLedger(ledger, { runId: run.runId, fence }),
      },
      writeGuard: assertLease ? (tx) => assertLease(tx, run.runId, fence) : undefined,
    };
    const advanced = await advanceRun({ ...current, workerId: fence.owner }, leasedContext, work);
    return {
      run: advanced,
      busy: false,
      work,
      gate,
      error: advanced.lastError ?? null,
    };
  } finally {
    await context.store.release(run.runId, fence.owner, fence.token).catch(() => undefined);
  }
}

/**
 * The weekly slot is claimed before the first run/report exists.
 *
 *   - a not-yet-due slot creates no run and dispatches nothing;
 *   - the due slot is claimed atomically once (the legacy weekly path then
 *     sees `next_weekly_at` in the future and cannot generate the same week);
 *   - a run that already recorded its claim always continues recovery and
 *     observation, even after `next_weekly_at` moved to the next week;
 *   - an explicit old-period replay never claims and never moves the current
 *     weekly slot.
 */
async function runEnterprise(
  enterpriseId: string,
  period: ScheduledPeriod,
  context: DispatchContext,
  ownership: 'claim' | 'replay',
): Promise<EnterpriseRunResult> {
  const control = await context.store.control(enterpriseId);
  const work: EnterpriseWork = { dispatched: [], observed: [] };
  const runId = scheduleRunId(enterpriseId, period.periodStart);
  if (periodIsCancelled(control, period.periodStart)) {
    // Cancellation is checked before the weekly claim, so a cancelled period
    // never moves next_weekly_at and never creates a new batch.
    const existing = assertRunTenant(await context.store.get(runId), enterpriseId);
    return {
      run: existing ? await cancelRun(existing, context, control.reason) : null,
      busy: false,
      work,
      gate: null,
      error: null,
    };
  }
  if (control.paused) {
    return {
      run: assertRunTenant(await context.store.get(runId), enterpriseId),
      busy: false,
      work,
      gate: null,
      error: null,
    };
  }
  let run = assertRunTenant(await context.store.get(runId), enterpriseId);
  let gate: ScheduledScheduleGate | null = null;

  if (context.mode === 'observe') {
    if (!run || run.status === 'failed') {
      return { run, busy: false, work, gate: null, error: run?.lastError ?? null };
    }
    return continueRun(run, enterpriseId, context, work, null);
  }

  if (ownership === 'replay') {
    if (!run) {
      run = await createRun(enterpriseId, period, context, { claim: null, replay: true });
    }
  } else if (run && (run.weeklyClaim ?? null)) {
    // Already claimed: keep recovering/observing regardless of the slot now.
  } else if (run && hasDispatchEvidence(run)) {
    // A B5.9 run that dispatched before the claim receipt existed. Adopt it
    // instead of claiming a second time or losing its in-flight batch.
    const at = context.environment.now().toISOString();
    run = await context.store.update(withAudit({
      ...run,
      weeklyClaim: {
        periodStart: run.period.periodStart,
        claimedAt: run.startedAt,
        previousNextWeeklyAt: null,
        nextWeeklyAt: null,
      },
    }, auditEntry(at, 'weekly_claim_adopted', undefined, 'legacy dispatch evidence')));
  } else {
    const claim = await context.environment.claimWeeklySchedule({
      enterpriseId,
      period: fixedPeriodOf(period, context.now),
    });
    gate = gateOf(claim);
    const at = context.environment.now().toISOString();
    if (claim.reason) {
      if (run) {
        run = await context.store.update(withAudit({
          ...run,
          lastError: { code: claim.reason, message: claim.reason },
        }, auditEntry(at, 'weekly_claim_failed', claim.reason)));
      }
      return { run, busy: false, work, gate, error: { code: claim.reason, message: claim.reason } };
    }
    if (!claim.claimed && !claim.receipt) {
      // Either the configured weekday/time has not arrived for this week, or
      // the due slot was already consumed. Only existing read-only observation
      // is allowed; no run is created for a first report.
      if (run) {
        run = await context.store.update(withAudit(
          run,
          auditEntry(
            at,
            claim.due ? 'weekly_slot_already_consumed' : 'weekly_time_not_reached',
            undefined,
            `dueAt=${claim.dueAt ?? ''};next=${claim.nextWeeklyAt ?? ''}`,
          ),
        ));
      }
      return { run, busy: false, work, gate, error: null };
    }
    const record = claim.receipt ?? claimRecordOf(period, claim, at);
    if (!run) {
      run = await createRun(enterpriseId, period, context, { claim: record, replay: false });
    } else {
      run = await context.store.update(withAudit({
        ...run,
        weeklyClaim: record,
      }, auditEntry(
        at,
        'weekly_schedule_claimed',
        undefined,
        `${record.previousNextWeeklyAt ?? ''}->${record.nextWeeklyAt ?? ''}`,
      )));
    }
  }

  if (!run) return { run: null, busy: false, work, gate, error: null };
  return continueRun(run, enterpriseId, context, work, gate);
}

/**
 * Continue already-claimed older runs, bounded per tick.
 *
 * `maxProjectsPerRound` can defer projects past the next Monday; those
 * batches were claimed under their own period and must still be recovered and
 * observed. This path never claims and never touches the current
 * `next_weekly_at`.
 */
async function continuePriorRuns(
  enterpriseId: string,
  period: ScheduledPeriod,
  context: DispatchContext,
): Promise<{ work: EnterpriseWork; runs: string[] }> {
  const work: EnterpriseWork = { dispatched: [], observed: [] };
  if (context.mode !== 'tick') return { work, runs: [] };
  const prior = (await context.store.list({ enterpriseId, limit: 20 }))
    .filter((run) =>
      run.period.periodStart < period.periodStart
      && run.status !== 'cancelled'
      && run.status !== 'expired'
      && ((run.weeklyClaim ?? null) !== null || hasDispatchEvidence(run)))
    .slice(0, MAX_PRIOR_RUNS_PER_TICK);
  const runs: string[] = [];
  for (const candidate of prior) {
    if (context.environment.now().getTime() > context.deadline) break;
    const current = await context.store.get(candidate.runId);
    if (!current || !runHasWork(current, context.environment.now().getTime())) continue;
    const result = await continueRun(current, enterpriseId, context, work, null);
    if (!result.busy) runs.push(candidate.runId);
  }
  return { work, runs };
}

function totalsOf(
  summaries: readonly ScheduledEnterpriseSummary[],
): ScheduledCounts {
  const totals = { ...emptyCounts() };
  const mutable = totals as Record<keyof ScheduledCounts, number>;
  for (const summary of summaries) {
    for (const key of Object.keys(mutable) as Array<keyof ScheduledCounts>) {
      mutable[key] += summary.counts[key];
    }
  }
  return mutable;
}

/**
 * Run one bounded scheduler tick. The caller supplies an explicit enterprise
 * allowlist; an empty list performs no discovery, database work or dispatch.
 */
export async function runScheduledPeriodReportDispatch(
  options: ScheduledPeriodReportDispatchOptions,
  dependencies: ScheduledPeriodReportDispatchDependencies,
): Promise<ScheduledPeriodReportDispatchSummary> {
  const startedAt = dependencies.environment.now().toISOString();
  const enterpriseIds = uniqueIds(options.enterpriseIds).slice(0, MAX_NATIVE_WORKFLOW_SCHEDULE_ENTERPRISES);
  if (!enterpriseIds.length) {
    return {
      enabled: false,
      period: resolveScheduledPeriod(dependencies.environment.now(), options.periodStart),
      startedAt,
      finishedAt: dependencies.environment.now().toISOString(),
      enterprises: [],
      runs: [],
      traces: [],
      totals: emptyCounts(),
    };
  }
  const period = resolveScheduledPeriod(dependencies.environment.now(), options.periodStart);
  // Validate the fixed week before any database/store work. This also rejects a
  // period that has not ended in the Shanghai timezone.
  fixedPeriodOf(period, dependencies.environment.now());
  const mode = options.mode ?? 'tick';
  const context: DispatchContext = {
    ...dependencies,
    now: dependencies.environment.now(),
    maxProjectsPerRound: Math.max(
      1,
      Math.min(options.maxProjectsPerRound ?? DEFAULT_MAX_PROJECTS_PER_ROUND, MAX_PROJECTS_PER_ROUND),
    ),
    observeIntervalMs: Math.max(1_000, options.observeIntervalMs ?? DEFAULT_OBSERVE_INTERVAL_MS),
    readObservationIntervalMs: Math.max(
      1_000,
      options.readObservationIntervalMs ?? DEFAULT_READ_OBSERVE_INTERVAL_MS,
    ),
    recheckIntervalMs: Math.max(
      1_000,
      options.recheckIntervalMs ?? options.observeIntervalMs ?? DEFAULT_OBSERVE_INTERVAL_MS,
    ),
    recheckLimit: Math.max(0, options.recheckLimit ?? DEFAULT_RECHECK_LIMIT),
    maxRunDurationMs: Math.max(1_000, options.maxRunDurationMs ?? DEFAULT_MAX_RUN_MS),
    leaseTtlMs: Math.max(60_000, options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS),
    deadline: dependencies.environment.now().getTime()
      + Math.max(1_000, options.maxRunDurationMs ?? DEFAULT_MAX_RUN_MS),
    mode,
    issuedBy: options.issuedBy ?? 'scheduler',
  };
  const latest = resolveEndedShanghaiWeek(dependencies.environment.now());
  const ownership = options.periodStart !== undefined
    && period.periodStart !== latest.periodStart
    ? 'replay' as const
    : 'claim' as const;
  const summaries: ScheduledEnterpriseSummary[] = [];
  const runs: ScheduledRunTrace[] = [];
  const traces: ScheduledJobTrace[] = [];
  for (const enterpriseId of enterpriseIds) {
    // One enterprise's store, database or discovery failure must never stop the
    // other allow-listed tenants in the same tick. The failed tenant is reported
    // with its own code and keeps any run file it had already written.
    try {
      const scoped = { ...context, ...dependencies.forEnterprise?.(enterpriseId) };
      const control = await scoped.store.control(enterpriseId);
      const result = await runEnterprise(enterpriseId, period, scoped, ownership);
      const prior = mode === 'tick' && !control.paused
        ? await continuePriorRuns(enterpriseId, period, scoped)
        : { work: { dispatched: [], observed: [] }, runs: [] };
      const run = result.run;
      if (run) {
        runs.push(buildScheduledRunTrace(run));
        traces.push(...buildScheduledJobTraces(run, { limit: 50 }));
      }
      summaries.push({
        enterpriseId,
        runId: scheduleRunId(enterpriseId, period.periodStart),
        status: run?.status ?? 'missing',
        paused: control.paused,
        busy: result.busy,
        gate: result.gate,
        counts: run?.counts ?? emptyCounts(),
        dispatchedProjects: [...result.work.dispatched, ...prior.work.dispatched],
        observedProjects: [...result.work.observed, ...prior.work.observed],
        recoveredRuns: prior.runs,
        skipReasons: run?.lastError
          ? [run.lastError.code]
          : run?.queue.flatMap((plan) => plan.skipReasons).filter((reason, index, all) => all.indexOf(reason) === index).slice(0, 20) ?? [],
        error: result.error ?? run?.lastError ?? null,
      });
    } catch (error) {
      const code = error instanceof WorkflowOperationError || error instanceof AssistantError
        ? error.code
        : 'period_report_schedule_tick_failed';
      summaries.push({
        enterpriseId,
        runId: scheduleRunId(enterpriseId, period.periodStart),
        status: 'failed',
        paused: false,
        busy: false,
        gate: null,
        counts: emptyCounts(),
        dispatchedProjects: [],
        observedProjects: [],
        recoveredRuns: [],
        skipReasons: [code],
        error: {
          code,
          message: error instanceof WorkflowOperationError || error instanceof AssistantError ? error.message.slice(0, 300) : code,
        },
      });
    }
  }
  return {
    enabled: true,
    period,
    startedAt,
    finishedAt: dependencies.environment.now().toISOString(),
    enterprises: summaries,
    runs: runs.slice(0, 40),
    traces: traces.slice(0, 200),
    totals: totalsOf(summaries),
  };
}

/** Read-only schedule query for the admin API/CLI. Never acquires a lease. */
export async function readScheduledPeriodReportDispatch(input: {
  readonly enterpriseId: string;
  readonly store: PeriodReportScheduleStore;
  readonly runId?: string;
  readonly periodStart?: string;
  readonly now?: () => Date;
}): Promise<ScheduledPeriodReportDispatchReadResult> {
  const enterpriseId = String(input.enterpriseId);
  if (!positiveId(enterpriseId)) {
    fail('period_report_schedule_enterprise_invalid', 422, 'enterprise id is invalid');
  }
  const control = await input.store.control(enterpriseId);
  let run: PeriodReportScheduleRun | null = null;
  if (input.runId) {
    run = await input.store.get(input.runId);
    if (run && run.enterpriseId !== enterpriseId) {
      fail('period_report_schedule_forbidden', 403, 'the schedule run belongs to another enterprise');
    }
  } else if (input.periodStart) {
    run = await input.store.get(scheduleRunId(enterpriseId, input.periodStart));
  } else {
    run = (await input.store.list({ enterpriseId, limit: 1 }))[0] ?? null;
  }
  return {
    control,
    run,
    counts: run?.counts ?? emptyCounts(),
    runTrace: run ? buildScheduledRunTrace(run) : null,
    traces: run ? buildScheduledJobTraces(run) : [],
  };
}

/** Tenant-scoped pause/resume. The scheduler re-reads it before each project. */
export async function setScheduledPeriodReportPaused(input: {
  readonly enterpriseId: string;
  readonly paused: boolean;
  readonly updatedBy: string | null;
  readonly reason: string | null;
  readonly store: PeriodReportScheduleStore;
  readonly now?: () => Date;
}): Promise<PeriodReportScheduleControl> {
  const enterpriseId = String(input.enterpriseId);
  if (!positiveId(enterpriseId)) {
    fail('period_report_schedule_enterprise_invalid', 422, 'enterprise id is invalid');
  }
  return input.store.setControl(enterpriseId, {
    paused: input.paused,
    updatedBy: input.updatedBy,
    reason: input.reason,
    now: input.now ?? (() => new Date()),
  });
}

export interface CancelScheduledPeriodResult {
  readonly control: PeriodReportScheduleControl;
  readonly run: PeriodReportScheduleRun | null;
}

/**
 * Tenant-scoped cancellation of one weekly period.
 *
 * Cancellation is terminal for that period: the scheduler neither claims the
 * slot nor dispatches/observes that week again, and an existing run is marked
 * `cancelled` while all reported evidence is preserved. Other weeks and other
 * tenants are unaffected.
 */
export async function cancelScheduledPeriodReport(input: {
  readonly enterpriseId: string;
  readonly periodStart: string;
  readonly cancelled?: boolean;
  readonly updatedBy: string | null;
  readonly reason: string | null;
  readonly store: PeriodReportScheduleStore;
  readonly now?: () => Date;
}): Promise<CancelScheduledPeriodResult> {
  const enterpriseId = String(input.enterpriseId);
  if (!positiveId(enterpriseId)) {
    fail('period_report_schedule_enterprise_invalid', 422, 'enterprise id is invalid');
  }
  if (!calendarDate(input.periodStart)) {
    fail('period_report_schedule_period_invalid', 422, 'periodStart must be a real calendar date');
  }
  const now = input.now ?? (() => new Date());
  const cancelled = input.cancelled ?? true;
  const control = await input.store.cancelPeriod(enterpriseId, input.periodStart, {
    cancelled,
    updatedBy: input.updatedBy,
    reason: input.reason,
    now,
  });
  const run = assertRunTenant(
    await input.store.get(scheduleRunId(enterpriseId, input.periodStart)),
    enterpriseId,
  );
  if (!run || !cancelled || run.status === 'cancelled') return { control, run };
  const at = now().toISOString();
  return {
    control,
    run: await input.store.update(finalizeRun(cancelledRun(run, at, input.reason), now())),
  };
}
