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
import type { PublishedWorkflowVersion } from '../store/types';
import type { TriggerEvent } from '../types';
import { parseFixedPeriod } from './period-event';
import type {
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
} from './period-report-schedule-types';
import type {
  PeriodReportScheduleEnvironment,
  ScheduleIssueSnapshot,
} from './period-report-schedule-environment';
import type { PeriodReportScheduleStore } from './period-report-schedule-store';
import type { PeriodReportRunObservation } from './period-report-status';
import type { LiveRunStore } from './types';

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
  readonly store: PeriodReportScheduleStore;
  readonly batchStore: PeriodReportBatchStore;
  readonly runStore: LiveRunStore;
  readonly environment: PeriodReportScheduleEnvironment;
}

export interface ScheduledEnterpriseSummary {
  readonly enterpriseId: string;
  readonly runId: string;
  readonly status: ScheduledRunStatus | 'missing';
  readonly paused: boolean;
  readonly busy: boolean;
  readonly counts: ScheduledCounts;
  readonly dispatchedProjects: readonly string[];
  readonly observedProjects: readonly string[];
  readonly skipReasons: readonly string[];
  readonly error: { readonly code: string; readonly message: string } | null;
}

export interface ScheduledPeriodReportDispatchSummary {
  readonly enabled: boolean;
  readonly period: ScheduledPeriod;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly enterprises: readonly ScheduledEnterpriseSummary[];
  readonly totals: ScheduledCounts;
}

export interface ScheduledPeriodReportDispatchReadResult {
  readonly control: PeriodReportScheduleControl;
  readonly run: PeriodReportScheduleRun | null;
  readonly counts: ScheduledCounts;
}

interface DispatchContext extends ScheduledPeriodReportDispatchDependencies {
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
    issues: previous.issues.length ? previous.issues : next.issues,
    carryOverIssueIds: previous.carryOverIssueIds.length
      ? previous.carryOverIssueIds
      : next.carryOverIssueIds,
    reminders: previous.reminders,
    recheckCount: previous.recheckCount,
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
    if (
      error.code === 'construction_forbidden'
      || error.code === 'construction_not_found'
      || error.code === 'run_enterprise_forbidden'
      || error.code === 'run_scope_unavailable'
      || error.code === 'period_report_batch_conflict'
      || error.code === 'published_unavailable'
      || error.code === 'published_changed'
    ) {
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
    };
  });
}

function projectStateFromManifest(
  manifest: PeriodReportBatchManifest,
  receivers: readonly ScheduledReceiverView[],
): ScheduledProjectEntry['state'] {
  if (manifest.status === 'completed') return 'completed';
  if (manifest.status === 'failed') return 'failed';
  if (manifest.status === 'unknown') return 'unknown';
  if (manifest.status === 'partial') return 'partial';
  const waiting = receivers.some((receiver) =>
    !!receiver.reportId
    && receiver.deliveryState !== 'delivered'
    && receiver.state !== 'failed'
    && receiver.state !== 'unknown');
  return waiting ? 'waiting_delivery' : 'processing';
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
  let next: string | null = null;
  if (entry.state === 'processing' || entry.state === 'waiting_delivery') {
    next = new Date(nowMs + options.observeIntervalMs).toISOString();
  } else if (entry.state === 'dispatching') {
    next = new Date(nowMs + options.observeIntervalMs).toISOString();
  } else if (entry.state === 'completed' || entry.state === 'partial') {
    const windowEnd = new Date(period.endAt).getTime() + READ_OBSERVATION_WINDOW_MS;
    if (hasUnread(entry.receivers) && nowMs < windowEnd) {
      next = new Date(nowMs + options.readObservationIntervalMs).toISOString();
    }
  } else if (
    entry.state === 'needs_attention'
    && !entry.batchStatus
    && entry.recheckCount < options.recheckLimit
  ) {
    next = new Date(nowMs + options.recheckIntervalMs).toISOString();
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
        receivers.push({
          ...receiver,
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
  return {
    ...entry,
    state,
    reason: manifestReason(manifest) ?? entry.reason,
    errorCode: manifestErrorCode(manifest) ?? entry.errorCode,
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
    portsFor: (receiver) => context.environment.portsFor(receiver, {
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
  if (
    !plan.executorAdminId
    || !plan.workerAdminId
    || !plan.designerAdminId
    || !plan.bossAdminId
    || !plan.customerUserId
    || plan.skipReasons.length
  ) {
    return markSkippedOrNeedsAttention(run, plan, context);
  }

  const customer = await context.environment.ensureCustomerBinding({
    enterpriseId: run.enterpriseId,
    projectId: plan.projectId,
    customerUserId: plan.customerUserId,
  });
  if (!customer.available) {
    const failedPlan: ScheduledProjectPlan = {
      ...plan,
      skipReasons: [
        ...plan.skipReasons,
        customer.reason ?? 'customer_receiver_unavailable',
      ],
    };
    return markSkippedOrNeedsAttention(run, failedPlan, context);
  }

  const issues = await context.environment.loadIssues({
    enterpriseId: run.enterpriseId,
    projectId: plan.projectId,
    period: fixedPeriodOf(run.period, context.now),
  });
  const ledger = await context.store.ledger(run.enterpriseId, plan.projectId);
  const merged = mergeLedger(ledger.items, issues, run.period.periodStart, now);
  const targeted = merged.map((issue) => ({
    ...issue,
    targetKind: chooseReminderTarget(issue, plan)?.kind ?? issue.targetKind ?? null,
  }));
  await context.store.saveLedger({
    ...ledger,
    items: targeted,
    updatedAt: now,
  });

  const entry = mergeEntry(previous, {
    ...initialEntry(
      plan,
      scheduleRequestId(run.enterpriseId, plan.projectId, run.period.periodStart),
      scheduleEventId(run.period.periodStart),
      now,
    ),
    state: 'dispatching',
    issues: targeted,
    carryOverIssueIds: carryOverIds(targeted, run.period.periodStart),
    dispatchedAt: now,
    nextObservationAt: new Date(context.now.getTime() + context.observeIntervalMs).toISOString(),
  });
  let current = withEntry(
    withAudit(run, auditEntry(now, 'project_dispatched', undefined, plan.projectId)),
    withProjectAudit(entry, now, 'project_dispatched'),
  );
  current = await context.store.update(current);

  let next: ScheduledProjectEntry;
  try {
    const input = await buildBatchInput(current, plan, context);
    const result = await context.environment.runBatch(input);
    next = applyManifest(entry, result.manifest, context.environment.now().toISOString());
    next = await observeReceipts(next, current.enterpriseId, context);
    next = await sendReminders(next, plan, current, context);
    next = withObservationSchedule(next, current.period, context.environment.now(), context);
    work.dispatched.push(plan.projectId);
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
    recovered = await sendReminders(recovered, plan, current, context);
    next = recovered;
    work.dispatched.push(plan.projectId);
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

async function observeProject(
  run: PeriodReportScheduleRun,
  projectId: string,
  context: DispatchContext,
  work: EnterpriseWork,
): Promise<PeriodReportScheduleRun> {
  const entry = run.projects[projectId];
  if (!entry || (!entry.batchStatus && !entry.dispatchedAt)) return run;
  const plan = entry.plan;
  if (!plan.executorAdminId) return run;
  try {
    const input = await buildBatchInput(run, plan, context);
    const result = await context.environment.runBatch(input);
    let next = applyManifest(entry, result.manifest, context.environment.now().toISOString());
    next = await observeReceipts(next, run.enterpriseId, context);
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
    const next = withProjectAudit(
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
    );
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
    const next = withProjectAudit(
      {
        ...entry,
        recheckCount: entry.recheckCount + 1,
        reason: classified.reason,
        errorCode: classified.code,
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
  const status = runStatus(run);
  const counts = countProjects(run.queue, run.projects);
  const entries = Object.values(run.projects);
  const observing = entries.some((entry) => !!entry.nextObservationAt);
  const terminal = status === 'completed' || status === 'partial' || status === 'failed';
  return {
    ...run,
    status,
    counts,
    updatedAt: now.toISOString(),
    finishedAt: terminal && !observing ? run.finishedAt ?? now.toISOString() : null,
  };
}

async function advanceRun(
  input: PeriodReportScheduleRun,
  context: DispatchContext,
  work: EnterpriseWork,
): Promise<PeriodReportScheduleRun> {
  let run = input;
  const nowMs = () => context.environment.now().getTime();
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
    run = await observeProject(run, entry.plan.projectId, context, work);
  }

  if (context.mode === 'tick') {
    // The scheduler owns this enterprise's weekly slot once it is enabled for
    // the latest ended week. Claiming even when every project is skipped keeps
    // the legacy weekly path from creating a parallel/empty weekly report.
    // A replay of an older period never moves the current schedule.
    const latestPeriod = resolveEndedShanghaiWeek(context.environment.now());
    if (run.period.periodStart === latestPeriod.periodStart) {
      const claim = await context.environment.claimWeeklySchedule({
        enterpriseId: run.enterpriseId,
        period: fixedPeriodOf(run.period, context.now),
      });
      if (claim.reason) {
        run = withAudit(run, auditEntry(
          context.environment.now().toISOString(),
          'weekly_claim_failed',
          claim.reason,
        ));
        run = {
          ...run,
          lastError: { code: claim.reason, message: claim.reason },
        };
        return context.store.update(finalizeRun(run, context.environment.now()));
      }
      if (claim.claimed) {
        run = withAudit(run, auditEntry(
          context.environment.now().toISOString(),
          'weekly_schedule_claimed',
          undefined,
          `${claim.previousNextWeeklyAt ?? ''}->${claim.nextWeeklyAt ?? ''}`,
        ));
      }
    }

    const rechecks = run.queue
      .map((plan) => run.projects[plan.projectId])
      .filter((entry): entry is ScheduledProjectEntry =>
        !!entry
        && entry.state === 'needs_attention'
        && !entry.batchStatus
        && entry.recheckCount < context.recheckLimit
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
      if (control.paused) {
        run = withAudit(run, auditEntry(context.environment.now().toISOString(), 'dispatch_paused'));
        break;
      }
      const effectivePlan = run.projects[plan.projectId]?.plan ?? plan;
      if (effectivePlan.skipReasons.length) {
        run = await markSkippedOrNeedsAttention(run, effectivePlan, context);
      } else {
        run = await dispatchProject(run, effectivePlan, context, work);
      }
      dispatched += 1;
    }
  }

  return context.store.update(finalizeRun(run, context.environment.now()));
}

async function createRun(
  enterpriseId: string,
  period: ScheduledPeriod,
  context: DispatchContext,
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
      ...(skipReasons.length
        ? [auditEntry(now, 'discovery_skipped', skipReasons[0], skipReasons.join(','))]
        : []),
    ],
  };
  const created = await context.store.create(run);
  if (created.created) {
    return created.run;
  }
  return created.run;
}

function runHasWork(
  run: PeriodReportScheduleRun,
  nowMs: number,
  recheckLimit: number,
): boolean {
  // A configuration failure is terminal for this period; a later tick must not
  // hammer the same disabled/missing plan. The next period creates a new run.
  if (run.status === 'failed' && run.lastError) return false;
  if (run.queue.length === 0) return run.status === 'discovered';
  const pending = run.queue.some((plan) => {
    const entry = run.projects[plan.projectId];
    if (!entry) return true;
    if (entry.state === 'queued' || entry.state === 'dispatching') return true;
    return entry.state === 'needs_attention'
      && !entry.batchStatus
      && entry.recheckCount < recheckLimit
      && (!entry.nextObservationAt || new Date(entry.nextObservationAt).getTime() <= nowMs);
  });
  if (pending) return true;
  return Object.values(run.projects).some((entry) =>
    !!entry.nextObservationAt
    && new Date(entry.nextObservationAt).getTime() <= nowMs);
}

async function runEnterprise(
  enterpriseId: string,
  period: ScheduledPeriod,
  context: DispatchContext,
): Promise<{ run: PeriodReportScheduleRun | null; busy: boolean; work: EnterpriseWork }> {
  const control = await context.store.control(enterpriseId);
  const work: EnterpriseWork = { dispatched: [], observed: [] };
  if (control.paused) {
    return { run: await context.store.get(scheduleRunId(enterpriseId, period.periodStart)), busy: false, work };
  }
  let run = await context.store.get(scheduleRunId(enterpriseId, period.periodStart));
  if (context.mode === 'observe' && !run) {
    return { run: null, busy: false, work };
  }
  if (!run) {
    run = await createRun(enterpriseId, period, context);
  }
  if (context.mode === 'observe' && run.status === 'failed') {
    return { run, busy: false, work };
  }
  if (!runHasWork(run, context.environment.now().getTime(), context.recheckLimit)) {
    return { run, busy: false, work };
  }
  const owner = `${process.pid}:${randomUUID()}`;
  const acquired = await context.store.acquire(run.runId, {
    owner,
    now: () => context.environment.now(),
    ttlMs: context.leaseTtlMs,
  });
  if (!acquired) {
    return { run: await context.store.get(run.runId), busy: true, work };
  }
  try {
    run = await advanceRun(run, context, work);
    return { run, busy: false, work };
  } finally {
    await context.store.release(run.runId, owner).catch(() => undefined);
  }
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
  const enterpriseIds = uniqueIds(options.enterpriseIds).slice(0, 20);
  if (!enterpriseIds.length) {
    return {
      enabled: false,
      period: resolveScheduledPeriod(dependencies.environment.now(), options.periodStart),
      startedAt,
      finishedAt: dependencies.environment.now().toISOString(),
      enterprises: [],
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
  const summaries: ScheduledEnterpriseSummary[] = [];
  for (const enterpriseId of enterpriseIds) {
    const control = await dependencies.store.control(enterpriseId);
    const result = await runEnterprise(enterpriseId, period, context);
    const run = result.run;
    summaries.push({
      enterpriseId,
      runId: scheduleRunId(enterpriseId, period.periodStart),
      status: run?.status ?? 'missing',
      paused: control.paused,
      busy: result.busy,
      counts: run?.counts ?? emptyCounts(),
      dispatchedProjects: result.work.dispatched,
      observedProjects: result.work.observed,
      skipReasons: run?.lastError
        ? [run.lastError.code]
        : run?.queue.flatMap((plan) => plan.skipReasons).filter((reason, index, all) => all.indexOf(reason) === index).slice(0, 20) ?? [],
      error: run?.lastError ?? null,
    });
  }
  return {
    enabled: true,
    period,
    startedAt,
    finishedAt: dependencies.environment.now().toISOString(),
    enterprises: summaries,
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
