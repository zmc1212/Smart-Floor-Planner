/** Preflight for the four-receiver period-report batch.
 *
 * One read-only (project-row-locked) transaction proves the management executor
 * still has real project write permission and that the single report plan is
 * valid for all four receivers before the batch creates its host manifest or
 * any sub-run can enqueue a report:
 *   - the plan is enabled (otherwise the existing Worker would not process it),
 *   - the legacy scheduler/stage path is parked (single execution path),
 *   - `project_ids` is exactly the one host project,
 *   - the same `audiences` row allows customer/worker/designer/boss.
 *
 * The batch never rewrites these settings between receivers.
 */

import { sql } from 'drizzle-orm';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import type { ConstructionActor } from '@/lib/construction/contracts';
import { WorkflowOperationError } from '../errors';
import { writeProjectAccess, type ProjectAccess, type ProjectLock } from './project-access';
import type { PeriodReportBatchReceiver } from './period-report-batch';

export const BATCH_AUDIENCES = ['customer', 'worker', 'designer', 'boss'] as const;

export interface PeriodReportBatchPlanEvidence {
  readonly enabled: true;
  readonly stageEnabled: false;
  readonly projectIds: readonly string[];
  readonly audiences: readonly string[] | null;
  readonly nextDailyAt: string | null;
  readonly nextWeeklyAt: string | null;
  readonly executor: {
    readonly owner: boolean;
    readonly memberRole: string | null;
  };
}

export interface PeriodReportBatchPreflightInput {
  readonly enterpriseId: string;
  readonly projectId: string;
  readonly actor: ConstructionActor;
  readonly receivers: readonly PeriodReportBatchReceiver[];
}

/** Offline seams; production always uses the real transaction/authorization. */
export interface PeriodReportBatchPreflightDependencies {
  readonly transaction?: <T>(
    enterpriseId: bigint | number | string,
    callback: (tx: PostgresTransaction) => Promise<T>,
  ) => Promise<T>;
  readonly authorizeWrite?: (
    tx: PostgresTransaction,
    actor: ConstructionActor,
    projectId: string,
    lock: ProjectLock,
  ) => Promise<ProjectAccess>;
  readonly now?: () => Date;
}

function fail(code: string, status: number, message: string, details?: unknown): never {
  throw new WorkflowOperationError(code, status, message, details);
}

function scheduleParked(value: unknown, now: Date): { at: string | null; parked: boolean } {
  if (value === null || value === undefined) return { at: null, parked: false };
  const at = new Date(String(value));
  if (!Number.isFinite(at.getTime())) return { at: String(value), parked: false };
  return { at: at.toISOString(), parked: at.getTime() > now.getTime() };
}

function configuredProjectIds(settings: Row): string[] {
  const value = settings.project_ids;
  return Array.isArray(value) ? value.map((projectId) => String(projectId)) : [];
}

function configuredAudiences(settings: Row): string[] | null {
  return Array.isArray(settings.audiences)
    ? settings.audiences.map((audience) => String(audience))
    : null;
}

/**
 * Validate the single report plan and the management executor before the first
 * batch business write. Only selects/locks rows; nothing is updated.
 */
export async function assertPeriodReportBatchPlan(
  input: PeriodReportBatchPreflightInput,
  dependencies: PeriodReportBatchPreflightDependencies = {},
): Promise<PeriodReportBatchPlanEvidence> {
  const now = (dependencies.now ?? (() => new Date()))();
  const transaction = dependencies.transaction ?? withTenantTransaction;
  const authorizeWrite = dependencies.authorizeWrite ?? writeProjectAccess;

  return transaction(input.enterpriseId, async (tx) => {
    const access = await authorizeWrite(tx, input.actor, input.projectId, 'update');
    const settings = await one(
      tx,
      sql`select * from app.construction_report_settings
        where enterprise_id=${input.enterpriseId} for share`,
    );
    if (!settings) {
      fail('period_report_plan_missing', 422, 'the enterprise report plan is missing');
    }
    if (settings.enabled !== true) {
      fail(
        'period_report_plan_disabled',
        422,
        'the existing report worker would not process a disabled plan',
      );
    }
    if (settings.stage_enabled !== false) {
      fail(
        'period_report_legacy_scheduler_due',
        409,
        'the legacy stage report path must stay off for a fixed batch period',
      );
    }
    const daily = scheduleParked(settings.next_daily_at, now);
    const weekly = scheduleParked(settings.next_weekly_at, now);
    if (!daily.parked || !weekly.parked) {
      fail(
        'period_report_legacy_scheduler_due',
        409,
        'the legacy construction report scheduler is still due for this enterprise',
        { nextDailyAt: daily.at, nextWeeklyAt: weekly.at },
      );
    }
    const projectIds = configuredProjectIds(settings);
    if (projectIds.length !== 1 || projectIds[0] !== input.projectId) {
      fail(
        'period_report_project_scope_mismatch',
        409,
        `the batch plan must contain exactly project ${input.projectId}`,
        { projectIds },
      );
    }
    const audiences = configuredAudiences(settings);
    if (audiences) {
      const missing = BATCH_AUDIENCES.filter((audience) => !audiences.includes(audience));
      if (missing.length) {
        fail(
          'period_report_audience_disabled',
          409,
          `the batch plan does not allow ${missing.join(', ')}`,
          { audiences, missing },
        );
      }
    }
    return {
      enabled: true,
      stageEnabled: false,
      projectIds,
      audiences,
      nextDailyAt: daily.at,
      nextWeeklyAt: weekly.at,
      executor: {
        owner: access.owner,
        memberRole: access.memberRole,
      },
    };
  });
}

/**
 * Authorization for observing an existing batch request. The management
 * executor is re-checked with the same real project write rule; no plan or
 * receiver write happens on this path.
 */
export async function assertPeriodReportBatchExecutor(
  input: PeriodReportBatchPreflightInput,
  dependencies: PeriodReportBatchPreflightDependencies = {},
): Promise<void> {
  const transaction = dependencies.transaction ?? withTenantTransaction;
  const authorizeWrite = dependencies.authorizeWrite ?? writeProjectAccess;
  await transaction(input.enterpriseId, async (tx) => {
    await authorizeWrite(tx, input.actor, input.projectId, 'update');
  });
}
