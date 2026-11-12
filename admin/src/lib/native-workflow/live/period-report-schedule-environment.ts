/** Injectable seams for the B5.9 weekly scheduler.
 *
 * The orchestrator owns only host coordination: one finished Shanghai week,
 * one deterministic run per enterprise, one batch request per project, bounded
 * dispatch/observation and a follow-up ledger. Business reads/writes, receiver
 * discovery, issue projection and reminders are supplied by the server adapter
 * (`period-report-schedule-ports.ts`) or by an offline fake in tests.
 */

import type { ConstructionActor } from '@/lib/construction/contracts';
import type { PublishedWorkflowVersion } from '../store/types';
import type { FixedPeriod } from './period-event';
import type {
  PeriodReportBatchInput,
  PeriodReportBatchResult,
} from './period-report-batch';
import type { PeriodReportRunObservation } from './period-report-status';
import type { ScheduledProjectPlan } from './period-report-schedule-types';
import type { LiveOperationPorts, LivePeriodReceiver } from './types';

export interface ScheduleIssueSnapshot {
  readonly issueId: string;
  readonly sourceRecordId: string;
  readonly status: string;
  readonly ownerId: string | null;
  readonly ownerName: string;
  readonly lastResult: string;
  readonly updatedAt: string;
}

export interface ScheduleReminderInput {
  readonly enterpriseId: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly period: FixedPeriod;
  readonly issue: ScheduleIssueSnapshot;
  readonly targetKind: 'worker' | 'designer' | 'boss';
  readonly adminId: string;
}

export interface ScheduleReminderResult {
  readonly sent: boolean;
  readonly reason: string | null;
  readonly messageId: string | null;
}

export interface ScheduleDiscoveryResult {
  readonly enterpriseName: string;
  /** Enterprise-level blockers; no project is dispatched when non-empty. */
  readonly skipReasons: readonly string[];
  readonly projects: readonly ScheduledProjectPlan[];
  /** Paused/archived/terminal projects excluded by the existing rules. */
  readonly excludedProjects: number;
}

export interface ScheduleWeeklyClaim {
  readonly claimed: boolean;
  readonly previousNextWeeklyAt: string | null;
  readonly nextWeeklyAt: string | null;
  readonly reason: string | null;
}

export interface ScheduleCustomerBindingResult {
  readonly available: boolean;
  readonly reason: string | null;
  readonly bindingId: string | null;
  readonly conversationId: string | null;
}

export interface PeriodReportScheduleEnvironment {
  readonly now: () => Date;
  /**
   * Without an identity, resolves the latest published revision for a new run.
   * With an identity, resolves exactly that frozen revision; a later publish
   * must never change a run that already started.
   */
  readonly loadPublished: (input?: {
    readonly definitionId: string;
    readonly revision: number;
  }) => Promise<PublishedWorkflowVersion>;
  discover(input: {
    readonly enterpriseId: string;
    readonly period: FixedPeriod;
    readonly projectId?: string;
  }): Promise<ScheduleDiscoveryResult>;
  claimWeeklySchedule(input: {
    readonly enterpriseId: string;
    readonly period: FixedPeriod;
  }): Promise<ScheduleWeeklyClaim>;
  ensureCustomerBinding(input: {
    readonly enterpriseId: string;
    readonly projectId: string;
    readonly customerUserId: string;
  }): Promise<ScheduleCustomerBindingResult>;
  runBatch(input: PeriodReportBatchInput): Promise<PeriodReportBatchResult>;
  portsFor(
    receiver: LivePeriodReceiver,
    context: {
      readonly enterpriseId: string;
      readonly projectId: string;
      readonly actor: ConstructionActor;
    },
  ): LiveOperationPorts;
  observeStatus(input: {
    readonly runId: string;
    readonly viewer: { readonly enterpriseId: string; readonly adminId: string };
  }): Promise<PeriodReportRunObservation>;
  loadIssues(input: {
    readonly enterpriseId: string;
    readonly projectId: string;
    readonly period: FixedPeriod;
  }): Promise<readonly ScheduleIssueSnapshot[]>;
  sendReminder(input: ScheduleReminderInput): Promise<ScheduleReminderResult>;
}
