/** Shared shapes for the B5.9 scheduled four-receiver period report.
 *
 * The schedule record is host state, not business truth. It records the fixed
 * enterprise/project/period/published revision/receivers, the host batch
 * request id and the latest observation. Reports, versions, deliveries, read
 * receipts and issues stay in their existing business tables.
 *
 * The follow-up ledger references existing construction site issues by their
 * outbox event id. It never creates a duplicate issue and never derives a
 * confirmed construction defect from model text.
 */

import type {
  PeriodReportBatchEntryState,
  PeriodReportBatchState,
} from './period-report-batch';

export const SCHEDULE_RUN_VERSION = 1 as const;
export const SCHEDULE_LEDGER_VERSION = 1 as const;

export type ScheduledReceiverKind = 'customer' | 'worker' | 'designer' | 'boss';

export interface ScheduledPeriod {
  readonly kind: 'weekly';
  /** Shanghai Monday, inclusive. */
  readonly periodStart: string;
  /** Shanghai next Monday, exclusive. */
  readonly periodEnd: string;
  readonly startAt: string;
  readonly endAt: string;
}

export interface ScheduledActivityEvidence {
  readonly publishedRecords: number;
  readonly stageEvents: number;
  readonly openIssues: number;
}

export interface ScheduledProjectPlan {
  readonly projectId: string;
  readonly projectName: string;
  readonly customerUserId: string | null;
  readonly customerAccess: boolean;
  readonly workerAdminId: string | null;
  readonly designerAdminId: string | null;
  readonly bossAdminId: string | null;
  readonly executorAdminId: string | null;
  readonly activity: ScheduledActivityEvidence;
  readonly skipReasons: readonly string[];
}

export interface ScheduledReceiverView {
  readonly kind: ScheduledReceiverKind;
  readonly adminId: string | null;
  readonly runId: string;
  readonly state: PeriodReportBatchEntryState;
  readonly reason: string | null;
  readonly errorCode: string | null;
  readonly reportId: string | null;
  readonly revision: number | null;
  readonly factsRunId: string | null;
  readonly reportKey: string | null;
  readonly bindingId: string | null;
  readonly conversationId: string | null;
  readonly deliveryState: string | null;
  readonly messageId: string | null;
  readonly deliveryConversationId: string | null;
  readonly deliveredAt: string | null;
  readonly readAt: string | null;
  readonly observedAt: string | null;
  /**
   * Present only after a historical report was invalidated by a formal source
   * revocation and a distinct recovery run created the current report. The
   * old report/message/read receipt is kept here for audit and never projected
   * as the current delivery.
   */
  readonly superseded?: ScheduledSupersededReceiver | null;
}

export interface ScheduledSupersededReceiver {
  readonly runId: string;
  readonly reportId: string | null;
  readonly revision: number | null;
  readonly reason: string | null;
  readonly deliveryState: string | null;
  readonly messageId: string | null;
  readonly deliveredAt: string | null;
  readonly readAt: string | null;
  readonly replacedAt: string;
}

export type ScheduledProjectState =
  | 'queued'
  | 'dispatching'
  | 'processing'
  | 'waiting_delivery'
  | 'completed'
  | 'partial'
  | 'needs_attention'
  | 'skipped'
  | 'failed'
  | 'unknown';

export type ScheduledReminderTarget = 'worker' | 'designer' | 'boss';

export interface ScheduledIssueItem {
  readonly issueId: string;
  readonly sourceRecordId: string;
  readonly status: string;
  readonly ownerId: string | null;
  readonly ownerName: string;
  /** Bounded excerpt of the existing issue projection; never model text. */
  readonly lastResult: string;
  readonly targetKind: ScheduledReminderTarget | null;
  readonly firstPeriod: string;
  readonly lastPeriod: string;
  readonly periods: readonly string[];
  readonly updatedAt: string;
}

export interface ScheduledReminderRecord {
  readonly issueId: string;
  readonly targetKind: ScheduledReminderTarget;
  readonly adminId: string;
  readonly status: 'sent' | 'skipped';
  readonly reason: string | null;
  readonly messageId: string | null;
  readonly at: string;
}

export interface ScheduledAuditEntry {
  readonly at: string;
  readonly action: string;
  readonly code?: string;
  readonly message?: string;
}

export interface ScheduledProjectEntry {
  readonly plan: ScheduledProjectPlan;
  readonly state: ScheduledProjectState;
  readonly reason: string | null;
  readonly errorCode: string | null;
  /** Stable per project + period; the batch store's request identity. */
  readonly requestId: string;
  readonly eventId: string;
  readonly batchStatus: PeriodReportBatchState | null;
  readonly receivers: readonly ScheduledReceiverView[];
  readonly issues: readonly ScheduledIssueItem[];
  readonly carryOverIssueIds: readonly string[];
  readonly reminders: readonly ScheduledReminderRecord[];
  /**
   * How many times a batch was actually requested for this project/period.
   * Optional so a run file written before this field still loads; readers use
   * `dispatchAttempts ?? 0`.
   */
  readonly dispatchAttempts?: number;
  readonly dispatchedAt: string | null;
  readonly observedAt: string | null;
  readonly nextObservationAt: string | null;
  readonly recheckCount: number;
  readonly updatedAt: string;
  readonly audit: readonly ScheduledAuditEntry[];
}

export interface ScheduledCounts {
  readonly due: number;
  readonly queued: number;
  readonly completed: number;
  readonly processing: number;
  readonly waitingDelivery: number;
  readonly needsAttention: number;
  readonly skipped: number;
  readonly failed: number;
  readonly unknown: number;
}

export type ScheduledRunStatus =
  | 'discovered'
  | 'dispatching'
  | 'observing'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'paused'
  /** The tenant cancelled this period; no further dispatch or observation. */
  | 'cancelled'
  /** The recovery/read window closed with work still unfinished. */
  | 'expired';

/**
 * Proof that this enterprise/period was claimed before the first report.
 *
 * It is written once, immediately after the atomic `next_weekly_at` update,
 * and is immutable afterwards. A later tick must keep recovering and observing
 * this run even though `next_weekly_at` has already moved to the next week.
 */
export interface ScheduledWeeklyClaimRecord {
  readonly periodStart: string;
  readonly claimedAt: string;
  readonly previousNextWeeklyAt: string | null;
  readonly nextWeeklyAt: string | null;
  /** Planned execution instant of this period; optional for older runs. */
  readonly dueAt?: string | null;
}

export interface PeriodReportScheduleRun {
  readonly runVersion: typeof SCHEDULE_RUN_VERSION;
  readonly runId: string;
  readonly enterpriseId: string;
  readonly period: ScheduledPeriod;
  /** null only for an explicit old-period replay, which never claims. */
  readonly weeklyClaim: ScheduledWeeklyClaimRecord | null;
  readonly published: {
    readonly definitionId: string;
    readonly revision: number;
    readonly digest: string;
    readonly nodeVersions: Readonly<Record<string, string>>;
  } | null;
  readonly status: ScheduledRunStatus;
  readonly queue: readonly ScheduledProjectPlan[];
  readonly projects: Readonly<Record<string, ScheduledProjectEntry>>;
  readonly counts: ScheduledCounts;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly finishedAt: string | null;
  /** Lease owner of the last scheduler tick that advanced this run. */
  readonly workerId?: string | null;
  readonly cancelledAt?: string | null;
  readonly cancelReason?: string | null;
  readonly lastError: { readonly code: string; readonly message: string } | null;
  readonly audit: readonly ScheduledAuditEntry[];
}

export interface PeriodReportScheduleControl {
  readonly enterpriseId: string;
  readonly paused: boolean;
  /**
   * Explicitly cancelled periods (Shanghai Monday `YYYY-MM-DD`). Cancellation
   * is terminal for that period only and never leaks to another tenant/week.
   */
  readonly cancelledPeriods: readonly string[];
  readonly updatedAt: string;
  readonly updatedBy: string | null;
  readonly reason: string | null;
}

export interface PeriodReportScheduleLedger {
  readonly ledgerVersion: typeof SCHEDULE_LEDGER_VERSION;
  readonly enterpriseId: string;
  readonly projectId: string;
  readonly items: readonly ScheduledIssueItem[];
  readonly updatedAt: string;
}

export function emptyCounts(): ScheduledCounts {
  return {
    due: 0,
    queued: 0,
    completed: 0,
    processing: 0,
    waitingDelivery: 0,
    needsAttention: 0,
    skipped: 0,
    failed: 0,
    unknown: 0,
  };
}

export function countProjects(
  queue: readonly ScheduledProjectPlan[],
  projects: Readonly<Record<string, ScheduledProjectEntry>>,
): ScheduledCounts {
  const counts = {
    ...emptyCounts(),
    due: queue.length,
  };
  const mutable = { ...counts };
  for (const plan of queue) {
    const entry = projects[plan.projectId];
    if (!entry) {
      mutable.queued += 1;
      continue;
    }
    switch (entry.state) {
      case 'queued':
      case 'dispatching':
        mutable.queued += 1;
        break;
      case 'completed':
        mutable.completed += 1;
        break;
      case 'processing':
        mutable.processing += 1;
        break;
      case 'waiting_delivery':
        mutable.waitingDelivery += 1;
        break;
      case 'partial':
      case 'needs_attention':
        mutable.needsAttention += 1;
        break;
      case 'skipped':
        mutable.skipped += 1;
        break;
      case 'failed':
        mutable.failed += 1;
        break;
      case 'unknown':
        mutable.unknown += 1;
        break;
    }
  }
  return mutable;
}

export function scheduleRunId(enterpriseId: string, periodStart: string): string {
  return `schedule-${enterpriseId}-weekly-${periodStart}`;
}

export function scheduleRequestId(
  enterpriseId: string,
  projectId: string,
  periodStart: string,
): string {
  return `schedule-${enterpriseId}-${projectId}-weekly-${periodStart}`;
}

export function scheduleEventId(periodStart: string): string {
  return `schedule-weekly-${periodStart}`;
}
