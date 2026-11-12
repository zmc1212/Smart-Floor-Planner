/** Server adapter for the B5.9 weekly scheduler.
 *
 * It reuses the existing construction authorization, report discovery, site
 * issue projection, follow-up bindings and in-app message channel. It never
 * creates a second report engine, Worker, queue, issue store or message
 * channel:
 *   - project discovery uses the same active-project/lead/plan/stage rules as
 *     `discoverFollowups`;
 *   - receivers are resolved from the current staff/owner/member/binding rules;
 *   - the four-receiver batch is the existing `runPeriodReportBatch`;
 *   - the weekly schedule is claimed on the existing
 *     `construction_report_settings.next_weekly_at`;
 *   - reminders are idempotent `domain_event_outbox` rows plus the existing
 *     in-app message append.
 *
 * Every reminder references an existing `construction.site.issue.*` event. It
 * never derives a confirmed construction defect from a model report body.
 */

import { sql } from 'drizzle-orm';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { appendMessage } from '@/lib/assistant/core/conversation';
import {
  activeReportProject,
  deliveryActor,
  followupAvailable,
} from '@/lib/construction/report-scope';
import { ensureFollowupBinding } from '@/lib/construction/report-store';
import { readSiteIssue } from '@/lib/construction/site-issues';
import { WorkflowOperationError } from '../errors';
import type { PublishedWorkflowVersion } from '../store/types';
import type { FixedPeriod } from './period-event';
import {
  nextWeeklyClaimAt,
  parseWeeklyExecutionConfig,
  weeklyExecutionAt,
} from './period-report-schedule-calendar';
import {
  assertPeriodReportBatchExecutor,
  type PeriodReportBatchPlanEvidence,
  type PeriodReportBatchPreflightInput,
} from './period-report-batch-preflight';
import {
  runPeriodReportBatch,
} from './period-report-batch';
import { runPeriodReportEntry } from './period-report-entry';
import { createPeriodReportPorts } from './period-report-ports';
import { readPeriodReportRunStatus } from './period-report-status';
import { writeProjectAccess } from './project-access';
import type {
  PeriodReportScheduleEnvironment,
  ScheduleCustomerBindingResult,
  ScheduleDiscoveryResult,
  ScheduleIssueSnapshot,
  ScheduleReminderInput,
  ScheduleReminderResult,
  ScheduleWeeklyClaim,
} from './period-report-schedule-environment';
import type { ScheduledProjectPlan } from './period-report-schedule-types';
import { readPostgresScheduleControl } from './runtime-postgres-stores';
import type { LivePeriodReceiver, LiveRunStore, RuntimeWriteGuard } from './types';

const weeklyClaimEvent = 'native.workflow.weekly.claimed.v1';
const AUDIENCES = ['customer', 'worker', 'designer', 'boss'] as const;
const OPEN_ISSUE_STATES = "('cancelled','resolved','closed')";
const ID_PATTERN = /^[1-9]\d{0,18}$/;

export interface DatabaseScheduleEnvironmentOptions {
  readonly postgresControl?: boolean;
  readonly loadPublished: (input?: {
    readonly definitionId: string;
    readonly revision: number;
  }) => Promise<PublishedWorkflowVersion>;
  readonly runStore: LiveRunStore;
  readonly now?: () => Date;
}

function assertId(value: string, label: string): string {
  if (!ID_PATTERN.test(value)) {
    throw new WorkflowOperationError(
      'period_report_schedule_id_invalid',
      422,
      `${label} ${JSON.stringify(value)} is not a positive integer id`,
    );
  }
  return value;
}

function configuredIds(value: unknown): string[] {
  return Array.isArray(value) ? value.map((id) => String(id)) : [];
}

function configuredAudiences(value: unknown): string[] | null {
  return Array.isArray(value) ? value.map((audience) => String(audience)) : null;
}

function idArraySql(ids: readonly string[]) {
  return sql`ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))`;
}

function roleToKind(role: string): 'worker' | 'designer' | null {
  if (role === 'construction_staff') return 'worker';
  if (role === 'designer') return 'designer';
  return null;
}

function endOfDay(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

interface ActivityCounts {
  readonly publishedRecords: number;
  readonly stageEvents: number;
  readonly openIssues: number;
}

function activityTotal(activity: ActivityCounts): number {
  return activity.publishedRecords + activity.stageEvents + activity.openIssues;
}

function employeeCandidateReason(kind: 'worker' | 'designer', count: number): string | null {
  if (count === 0) return `${kind}_missing`;
  if (count > 1) return `${kind}_ambiguous`;
  return null;
}

async function readActivity(
  tx: PostgresTransaction,
  enterpriseId: string,
  projectIds: readonly string[],
  period: FixedPeriod,
): Promise<Map<string, ActivityCounts>> {
  const result = new Map<string, ActivityCounts>();
  if (!projectIds.length) return result;
  const ids = idArraySql(projectIds);
  const records = await rows(
    tx,
    sql`select project_id::text as project_id,count(*)::int as n
      from app.construction_site_records
      where enterprise_id=${enterpriseId} and project_id=any(${ids}::bigint[])
        and status='published' and published_at>=${period.start} and published_at<${period.end}
      group by project_id`,
  );
  const stages = await rows(
    tx,
    sql`select aggregate_id as project_id,count(*)::int as n
      from app.domain_event_outbox
      where enterprise_id=${enterpriseId} and type='construction.stage.updated.v1'
        and aggregate_id=any(${ids}::text[])
        and created_at>=${period.start} and created_at<${period.end}
      group by aggregate_id`,
  );
  const recordCounts = new Map(records.map((row) => [String(row.project_id), Number(row.n)]));
  const stageCounts = new Map(stages.map((row) => [String(row.project_id), Number(row.n)]));
  for (const projectId of projectIds) {
    result.set(projectId, {
      publishedRecords: recordCounts.get(projectId) ?? 0,
      stageEvents: stageCounts.get(projectId) ?? 0,
      openIssues: 0,
    });
  }
  return result;
}

/** A carried-over open issue is already part of the existing report facts. */
async function openIssueCount(
  tx: PostgresTransaction,
  enterpriseId: string,
  projectId: string,
): Promise<number> {
  const count = await one(
    tx,
    sql`with opened as (
        select id,payload from app.domain_event_outbox
        where enterprise_id=${enterpriseId} and type='construction.site.issue.opened.v1'
          and payload->>'projectId'=${projectId}
        order by id desc limit 21
      )
      select count(*)::int as n from opened o
      where coalesce((
        select e.payload->>'state' from app.domain_event_outbox e
        where e.enterprise_id=${enterpriseId} and e.aggregate_type='construction_site_issue'
          and e.aggregate_id=o.id::text
          and e.type in ('construction.site.issue.progress.v1','construction.site.issue.lifecycle.v1')
        order by e.created_at desc, e.id desc limit 1
      ), o.payload->>'state') not in ${sql.raw(OPEN_ISSUE_STATES)}`,
  );
  return Number(count?.n ?? 0);
}

interface StaffCandidate {
  readonly projectId: string;
  readonly adminId: string;
  readonly kind: 'worker' | 'designer';
}

interface BindingCandidate {
  readonly adminId: string;
  readonly audience: string;
}

async function discoverStaff(
  tx: PostgresTransaction,
  enterpriseId: string,
  projectIds: readonly string[],
): Promise<StaffCandidate[]> {
  if (!projectIds.length) return [];
  const found = await rows(
    tx,
    sql`select m.project_id::text as project_id,a.id::text as admin_id,a.role
      from app.construction_members m
      join app.admin_users a on a.enterprise_id=m.enterprise_id and a.id=m.admin_id
      where m.enterprise_id=${enterpriseId} and m.active and m.role<>'observer'
        and m.project_id=any(${idArraySql(projectIds)}::bigint[])
        and a.status='active' and a.must_change_password=false
        and a.role in ('construction_staff','designer')
        and app.construction_followup_staff_access(a.id::bigint,${enterpriseId}::bigint) is not null
      order by m.project_id,a.id`,
  );
  return found.flatMap((row) => {
    const kind = roleToKind(String(row.role));
    return kind
      ? [{ projectId: String(row.project_id), adminId: String(row.admin_id), kind }]
      : [];
  });
}

async function discoverBindings(
  tx: PostgresTransaction,
  enterpriseId: string,
): Promise<BindingCandidate[]> {
  const found = await rows(
    tx,
    sql`select admin_id::text as admin_id,audience
      from app.construction_followup_bindings
      where enterprise_id=${enterpriseId} and status='enabled'
        and project_id is null and scope_key='enterprise'
        and audience in ('worker','designer','boss')
      order by id`,
  );
  return found.map((row) => ({
    adminId: String(row.admin_id),
    audience: String(row.audience),
  }));
}

async function discoverOwners(
  tx: PostgresTransaction,
  enterpriseId: string,
): Promise<string[]> {
  const found = await rows(
    tx,
    sql`select a.id::text as admin_id
      from app.admin_users a
      where a.enterprise_id=${enterpriseId} and a.status='active' and a.must_change_password=false
        and a.role='enterprise_admin'
        and app.construction_followup_staff_access(a.id::bigint,${enterpriseId}::bigint)='owner'
      order by a.id`,
  );
  return found.map((row) => String(row.admin_id));
}

async function discoverProjectManagers(
  tx: PostgresTransaction,
  enterpriseId: string,
  projectId: string,
): Promise<string[]> {
  const found = await rows(
    tx,
    // `distinct on` keeps one row per admin while allowing the stable id order;
    // `select distinct ... order by a.id` is rejected because a.id is not in the
    // projection (a.id::text is), which only shows up against a real database.
    sql`select distinct on (a.id) a.id::text as admin_id
      from app.construction_members m
      join app.admin_users a on a.enterprise_id=m.enterprise_id and a.id=m.admin_id
      where m.enterprise_id=${enterpriseId} and m.project_id=${projectId}
        and m.active and m.role='manager'
        and a.status='active' and a.must_change_password=false
        and a.role in ('construction_staff','designer','enterprise_admin')
        and app.construction_actor_access(a.id::bigint,${enterpriseId}::bigint) is not null
      order by a.id`,
  );
  return found.map((row) => String(row.admin_id));
}

function uniqueChoice<T>(values: readonly T[]): T | 'ambiguous' | null {
  const unique = [...new Set(values)];
  if (unique.length === 0) return null;
  if (unique.length > 1) return 'ambiguous';
  return unique[0]!;
}

function chooseBoss(
  owners: readonly string[],
  bindings: readonly BindingCandidate[],
): { bossId: string | null; reason: string | null } {
  if (owners.length === 0) return { bossId: null, reason: 'boss_missing' };
  if (owners.length === 1) return { bossId: owners[0]!, reason: null };
  const bound = owners.filter((ownerId) =>
    bindings.some((binding) => binding.audience === 'boss' && binding.adminId === ownerId));
  const choice = uniqueChoice(bound);
  if (typeof choice === 'string' && choice !== 'ambiguous') {
    return { bossId: choice, reason: null };
  }
  return { bossId: null, reason: 'boss_ambiguous' };
}

function chooseStaff(
  kind: 'worker' | 'designer',
  projectId: string,
  staff: readonly StaffCandidate[],
  bindings: readonly BindingCandidate[],
): { adminId: string | null; reason: string | null } {
  const candidates = staff.filter((candidate) =>
    candidate.kind === kind && candidate.projectId === projectId);
  const direct = uniqueChoice(candidates.map((candidate) => candidate.adminId));
  if (direct === null) return { adminId: null, reason: `${kind}_missing` };
  if (direct !== 'ambiguous') return { adminId: direct, reason: null };
  const bound = candidates
    .map((candidate) => candidate.adminId)
    .filter((adminId) =>
      bindings.some((binding) => binding.audience === kind && binding.adminId === adminId));
  const choice = uniqueChoice(bound);
  if (typeof choice === 'string' && choice !== 'ambiguous') {
    return { adminId: choice, reason: null };
  }
  return { adminId: null, reason: employeeCandidateReason(kind, candidates.length) };
}

function chooseExecutor(
  owners: readonly string[],
  managers: readonly string[],
  receiverIds: ReadonlySet<string>,
  bossId: string | null,
): { executorAdminId: string | null; reason: string | null } {
  const ownerCandidates = owners.filter((adminId) => adminId !== bossId);
  const managerCandidates = managers.filter((adminId) => adminId !== bossId);
  const preferred = [
    ...ownerCandidates.filter((adminId) => !receiverIds.has(adminId)),
    ...managerCandidates.filter((adminId) => !receiverIds.has(adminId)),
    ...ownerCandidates,
    ...managerCandidates,
  ];
  // An executor is a management capability, not a report receiver. The first
  // deterministic candidate (lowest id inside each preference group) is used;
  // multiple owners are not an ambiguity as long as one is not the boss.
  const choice = [...new Set(preferred)][0] ?? null;
  if (choice) return { executorAdminId: choice, reason: null };
  if (owners.length > 0 && ownerCandidates.length === 0 && managerCandidates.length === 0) {
    return { executorAdminId: null, reason: 'executor_separation_unavailable' };
  }
  return { executorAdminId: null, reason: 'executor_missing' };
}

async function discoverProjects(input: {
  readonly enterpriseId: string;
  readonly period: FixedPeriod;
  readonly projectId?: string;
}): Promise<ScheduleDiscoveryResult> {
  const enterpriseId = assertId(input.enterpriseId, 'enterprise id');
  if (input.projectId !== undefined) assertId(input.projectId, 'project id');
  return withTenantTransaction(enterpriseId, async (tx) => {
    const enterprise = await one(
      tx,
      sql`select e.id,e.name,a.enabled as assistant_enabled
        from app.enterprises e
        join app.assistant_enterprise_settings a on a.enterprise_id=e.id
        where e.id=${enterpriseId} and e.status='active'`,
    );
    if (!enterprise) {
      return {
        enterpriseName: '',
        skipReasons: ['enterprise_inactive'],
        projects: [],
        excludedProjects: 0,
      };
    }
    if (enterprise.assistant_enabled !== true) {
      return {
        enterpriseName: String(enterprise.name ?? ''),
        skipReasons: ['assistant_disabled'],
        projects: [],
        excludedProjects: 0,
      };
    }
    const settings = await one(
      tx,
      sql`select * from app.construction_report_settings
        where enterprise_id=${enterpriseId} for share`,
    );
    if (!settings) {
      return {
        enterpriseName: String(enterprise.name ?? ''),
        skipReasons: ['plan_missing'],
        projects: [],
        excludedProjects: 0,
      };
    }
    const skipReasons: string[] = [];
    if (settings.enabled !== true) skipReasons.push('plan_disabled');
    if (settings.stage_enabled !== false) skipReasons.push('legacy_stage_enabled');
    const audiences = configuredAudiences(settings.audiences);
    if (audiences) {
      const missing = AUDIENCES.filter((audience) => !audiences.includes(audience));
      if (missing.length) skipReasons.push(`audience_disabled:${missing.join(',')}`);
    }

    const projectIds = configuredIds(settings.project_ids);
    const stageKeys = configuredIds(settings.stage_keys);
    const projectFilter = input.projectId
      ? sql`and p.id=${input.projectId}`
      : sql``;
    const projects = await rows(
      tx,
      sql`select p.id::text as id,p.name,p.customer_access,l.customer_user_id
        from app.construction_projects p
        join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
        where p.enterprise_id=${enterpriseId}
          and ${activeReportProject}
          and l.archived_at is null
          and (jsonb_array_length(${JSON.stringify(projectIds)}::jsonb)=0
            or ${JSON.stringify(projectIds)}::jsonb ? p.id::text)
          and (jsonb_array_length(${JSON.stringify(stageKeys)}::jsonb)=0
            or ${JSON.stringify(stageKeys)}::jsonb ? p.current_stage_key)
          ${projectFilter}
        order by p.id limit 21 for share of p,l`,
    );
    if (projects.length > 20) {
      return {
        enterpriseName: String(enterprise.name ?? ''),
        skipReasons: [...skipReasons, 'construction_report_scope_too_large'],
        projects: [],
        excludedProjects: 0,
      };
    }
    const excluded = await one(
      tx,
      sql`select count(*)::int as n
        from app.construction_projects p
        join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
        where p.enterprise_id=${enterpriseId}
          and (p.status<>'active'
            or coalesce(p.current_stage_key,'') in ('completion','move_in')
            or l.archived_at is not null)`,
    );
    const ids = projects.map((project) => String(project.id));
    const activity = await readActivity(tx, enterpriseId, ids, input.period);
    const staff = await discoverStaff(tx, enterpriseId, ids);
    const bindings = await discoverBindings(tx, enterpriseId);
    const owners = await discoverOwners(tx, enterpriseId);
    const boss = chooseBoss(owners, bindings);
    const plans: ScheduledProjectPlan[] = [];

    for (const project of projects) {
      const projectId = String(project.id);
      const reasons: string[] = [];
      const customerUserId = project.customer_user_id
        ? String(project.customer_user_id)
        : null;
      const customerAccess = project.customer_access === true;
      if (!customerUserId) reasons.push('customer_missing');
      if (!customerAccess) reasons.push('customer_access_revoked');
      const worker = chooseStaff('worker', projectId, staff, bindings);
      const designer = chooseStaff('designer', projectId, staff, bindings);
      if (worker.reason) reasons.push(worker.reason);
      if (designer.reason) reasons.push(designer.reason);
      if (boss.reason) reasons.push(boss.reason);
      const receiverIds = new Set(
        [worker.adminId, designer.adminId, boss.bossId].filter(
          (adminId): adminId is string => !!adminId,
        ),
      );
      const managers = await discoverProjectManagers(tx, enterpriseId, projectId);
      const executor = chooseExecutor(owners, managers, receiverIds, boss.bossId);
      if (executor.reason) reasons.push(executor.reason);

      let counts = activity.get(projectId) ?? {
        publishedRecords: 0,
        stageEvents: 0,
        openIssues: 0,
      };
      if (counts.publishedRecords === 0 && counts.stageEvents === 0) {
        counts = { ...counts, openIssues: await openIssueCount(tx, enterpriseId, projectId) };
      }
      if (activityTotal(counts) === 0) reasons.push('no_period_activity');

      plans.push({
        projectId,
        projectName: String(project.name ?? ''),
        customerUserId,
        customerAccess,
        workerAdminId: worker.adminId,
        designerAdminId: designer.adminId,
        bossAdminId: boss.bossId,
        executorAdminId: executor.executorAdminId,
        activity: counts,
        skipReasons: [...new Set(reasons)],
      });
    }

    return {
      enterpriseName: String(enterprise.name ?? ''),
      skipReasons: [...new Set(skipReasons)],
      projects: plans,
      excludedProjects: Number(excluded?.n ?? 0),
    };
  });
}

function weeklyClaimResult(input: {
  readonly claimed: boolean;
  readonly due: boolean;
  readonly alreadyConsumed: boolean;
  readonly dueAt: Date | null;
  readonly previous: Date | null;
  readonly nextWeeklyAt: Date | null;
  readonly reason: string | null;
}): ScheduleWeeklyClaim {
  return {
    claimed: input.claimed,
    due: input.due,
    alreadyConsumed: input.alreadyConsumed,
    dueAt: input.dueAt ? input.dueAt.toISOString() : null,
    previousNextWeeklyAt: input.previous ? input.previous.toISOString() : null,
    nextWeeklyAt: input.nextWeeklyAt ? input.nextWeeklyAt.toISOString() : null,
    reason: input.reason,
  };
}

/**
 * Atomically claim the enterprise's weekly execution slot for one period.
 *
 * A complete Monday-to-Monday week ending at `period.end` is only executable
 * after the configured `weekly_day`/`weekly_time` instant. The stored
 * `next_weekly_at` is the second half of the business contract: if it is still
 * in the future, the legacy weekly worker (or an earlier B tick) already
 * consumed this cycle, so generation must not start again.
 *
 * The row lock plus the conditional update make the claim exactly-once even
 * with concurrent Worker ticks.
 */
async function claimWeeklySchedule(input: {
  readonly enterpriseId: string;
  readonly period: FixedPeriod;
  readonly now: Date;
  readonly postgresControl?: boolean;
}): Promise<ScheduleWeeklyClaim> {
  const enterpriseId = assertId(input.enterpriseId, 'enterprise id');
  return withTenantTransaction(enterpriseId, async (tx) => {
    if (input.postgresControl) {
      const control = await readPostgresScheduleControl(tx, enterpriseId, 'shared');
      if (control.paused || control.cancelledPeriods.includes(input.period.periodStart)) {
        return weeklyClaimResult({
          claimed: false, due: false, alreadyConsumed: false, dueAt: null, previous: null,
          nextWeeklyAt: null, reason: control.paused ? 'schedule_paused' : 'period_cancelled',
        });
      }
    }
    const settings = await one(
      tx,
      sql`select * from app.construction_report_settings
        where enterprise_id=${enterpriseId} for update`,
    );
    if (!settings) {
      return weeklyClaimResult({
        claimed: false,
        due: false,
        alreadyConsumed: false,
        dueAt: null,
        previous: null,
        nextWeeklyAt: null,
        reason: 'plan_missing',
      });
    }
    const previous = new Date(String(settings.next_weekly_at));
    const previousValid = Number.isFinite(previous.getTime());
    const stored = previousValid ? previous : null;
    if (settings.enabled !== true) {
      return weeklyClaimResult({
        claimed: false,
        due: false,
        alreadyConsumed: false,
        dueAt: null,
        previous: stored,
        nextWeeklyAt: stored,
        reason: 'plan_disabled',
      });
    }
    if (settings.stage_enabled !== false) {
      return weeklyClaimResult({
        claimed: false,
        due: false,
        alreadyConsumed: false,
        dueAt: null,
        previous: stored,
        nextWeeklyAt: stored,
        reason: 'legacy_stage_enabled',
      });
    }
    const saved = await one(tx, sql`select payload from app.domain_event_outbox
      where enterprise_id=${enterpriseId} and type=${weeklyClaimEvent}
        and aggregate_type='construction_report_settings' and aggregate_id=${input.period.periodStart}
        and aggregate_version=1`);
    if (saved) {
      const payload = saved.payload as Row;
      const claimedAt = endOfDay(payload.claimedAt), dueAt = endOfDay(payload.dueAt);
      const previous = endOfDay(payload.previousNextWeeklyAt), nextWeeklyAt = endOfDay(payload.nextWeeklyAt);
      return {
        claimed: false, due: true, alreadyConsumed: true, dueAt,
        previousNextWeeklyAt: previous, nextWeeklyAt,
        reason: claimedAt && dueAt && previous && nextWeeklyAt ? null : 'weekly_claim_receipt_invalid',
        ...(claimedAt && dueAt && previous && nextWeeklyAt ? { receipt: {
          periodStart: input.period.periodStart, claimedAt, dueAt, previousNextWeeklyAt: previous, nextWeeklyAt,
        } } : {}),
      };
    }
    // Use the same default as the legacy scheduler only for a missing day;
    // a corrupt time blocks instead of being silently normalized.
    const config = parseWeeklyExecutionConfig(
      settings.weekly_day ?? 1,
      settings.weekly_time,
    );
    if (!config) {
      return weeklyClaimResult({
        claimed: false,
        due: false,
        alreadyConsumed: false,
        dueAt: null,
        previous: stored,
        nextWeeklyAt: stored,
        reason: 'weekly_schedule_invalid',
      });
    }
    const dueAt = weeklyExecutionAt({
      periodEnd: input.period.end,
      weeklyDay: config.weeklyDay,
      weeklyTime: config.weeklyTime,
    });
    if (input.now.getTime() < dueAt.getTime()) {
      return weeklyClaimResult({
        claimed: false,
        due: false,
        alreadyConsumed: false,
        dueAt,
        previous: stored,
        nextWeeklyAt: stored,
        reason: null,
      });
    }
    if (!previousValid) {
      return weeklyClaimResult({
        claimed: false,
        due: true,
        alreadyConsumed: false,
        dueAt,
        previous: null,
        nextWeeklyAt: null,
        reason: 'weekly_schedule_missing',
      });
    }
    if (previous.getTime() > input.now.getTime()) {
      // The configured execution instant passed, but the stored slot is
      // already in the next cycle: the legacy path or an earlier B tick owns
      // this week. Starting here would create a duplicate weekly report.
      return weeklyClaimResult({
        claimed: false,
        due: true,
        alreadyConsumed: true,
        dueAt,
        previous,
        nextWeeklyAt: previous,
        reason: null,
      });
    }
    const next = nextWeeklyClaimAt({
      now: input.now,
      weeklyTime: config.weeklyTime,
      weeklyDay: config.weeklyDay,
      periodStart: input.period.start,
    });
    if (next.getTime() <= input.now.getTime()) {
      return weeklyClaimResult({
        claimed: false,
        due: true,
        alreadyConsumed: false,
        dueAt,
        previous,
        nextWeeklyAt: next,
        reason: 'weekly_schedule_invalid',
      });
    }
    const updated = await one(
      tx,
      sql`update app.construction_report_settings
        set next_weekly_at=${next},version=version+1,updated_at=now()
        where enterprise_id=${enterpriseId}
          and enabled=true and stage_enabled=false and next_weekly_at<=${input.now}
        returning next_weekly_at`,
    );
    if (!updated) {
      // Defensive: the row lock already serializes claimants, but never report
      // a claim this transaction did not really write.
      const latest = await one(
        tx,
        sql`select next_weekly_at from app.construction_report_settings
          where enterprise_id=${enterpriseId}`,
      );
      return weeklyClaimResult({
        claimed: false,
        due: true,
        alreadyConsumed: true,
        dueAt,
        previous,
        nextWeeklyAt: endOfDay(latest?.next_weekly_at)
          ? new Date(String(latest!.next_weekly_at))
          : previous,
        reason: null,
      });
    }
    const receipt = {
      periodStart: input.period.periodStart,
      claimedAt: input.now.toISOString(),
      dueAt: dueAt.toISOString(),
      previousNextWeeklyAt: previous.toISOString(),
      nextWeeklyAt: next.toISOString(),
    };
    // The slot and its ownership commit together. A new process can restore a
    // missing host run without advancing the weekly clock or claiming a legacy slot.
    await tx.execute(sql`insert into app.domain_event_outbox
      (enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
      values(${enterpriseId},${weeklyClaimEvent},'construction_report_settings',${input.period.periodStart},1,
        '{"kind":"system"}',${input.period.periodStart},${JSON.stringify(receipt)}::jsonb)`);
    return { ...weeklyClaimResult({
      claimed: true,
      due: true,
      alreadyConsumed: false,
      dueAt,
      previous,
      nextWeeklyAt: next,
      reason: null,
    }), receipt };
  });
}

export interface WeeklyScheduleSettingsSnapshot {
  readonly settingsEnabled: boolean;
  readonly stageEnabled: boolean | null;
  readonly weeklyDay: number | null;
  readonly weeklyTime: string | null;
  readonly nextWeeklyAt: string | null;
  readonly audiences: readonly string[];
}

/**
 * Read-only operations view of the tenant's stored weekly schedule.
 *
 * It never locks, claims, advances `next_weekly_at` or dispatches. The admin API
 * uses it to show the current slot and next execution time for the tenant in
 * scope; a missing settings row returns null instead of inventing defaults.
 */
export async function readWeeklyScheduleSettings(input: {
  readonly enterpriseId: string;
}): Promise<WeeklyScheduleSettingsSnapshot | null> {
  const enterpriseId = assertId(input.enterpriseId, 'enterprise id');
  return withTenantTransaction(enterpriseId, async (tx) => {
    const settings = await one(
      tx,
      sql`select enabled,stage_enabled,weekly_day,weekly_time,next_weekly_at,audiences
        from app.construction_report_settings where enterprise_id=${enterpriseId}`,
    );
    if (!settings) return null;
    return {
      settingsEnabled: settings.enabled === true,
      stageEnabled: settings.stage_enabled === null || settings.stage_enabled === undefined
        ? null
        : settings.stage_enabled === true,
      weeklyDay: settings.weekly_day === null || settings.weekly_day === undefined
        ? null
        : Number(settings.weekly_day),
      weeklyTime: settings.weekly_time === null || settings.weekly_time === undefined
        ? null
        : String(settings.weekly_time),
      nextWeeklyAt: endOfDay(settings.next_weekly_at),
      audiences: configuredAudiences(settings.audiences) ?? [],
    };
  });
}

async function ensureCustomerBinding(input: {
  readonly writeGuard?: RuntimeWriteGuard;
  readonly enterpriseId: string;
  readonly projectId: string;
  readonly customerUserId: string;
}): Promise<ScheduleCustomerBindingResult> {
  const enterpriseId = assertId(input.enterpriseId, 'enterprise id');
  const projectId = assertId(input.projectId, 'project id');
  const customerUserId = assertId(input.customerUserId, 'customer user id');
  return withTenantTransaction(enterpriseId, async (tx) => {
    await input.writeGuard?.(tx);
    const project = await one(
      tx,
      sql`select p.*,l.customer_user_id,l.archived_at
        from app.construction_projects p
        join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
        where p.enterprise_id=${enterpriseId} and p.id=${projectId}
        for share of p,l`,
    );
    if (
      !project
      || project.status !== 'active'
      || project.customer_access !== true
      || project.archived_at !== null
      || String(project.customer_user_id ?? '') !== customerUserId
    ) {
      return {
        available: false,
        reason: 'customer_access_revoked',
        bindingId: null,
        conversationId: null,
      };
    }
    const binding: Row = await ensureFollowupBinding(tx, enterpriseId, {
      kind: 'user',
      id: customerUserId,
      audience: 'customer',
      projectId,
    });
    if (String(binding.status) !== 'enabled') {
      return {
        available: false,
        reason: `binding_${String(binding.status)}`,
        bindingId: String(binding.id),
        conversationId: String(binding.conversation_id),
      };
    }
    if (!await followupAvailable(tx, enterpriseId, binding)) {
      return {
        available: false,
        reason: 'conversation_unavailable',
        bindingId: String(binding.id),
        conversationId: String(binding.conversation_id),
      };
    }
    return {
      available: true,
      reason: null,
      bindingId: String(binding.id),
      conversationId: String(binding.conversation_id),
    };
  });
}

async function loadIssues(input: {
  readonly enterpriseId: string;
  readonly projectId: string;
  readonly period: FixedPeriod;
}): Promise<readonly ScheduleIssueSnapshot[]> {
  const enterpriseId = assertId(input.enterpriseId, 'enterprise id');
  const projectId = assertId(input.projectId, 'project id');
  return withTenantTransaction(enterpriseId, async (tx) => {
    const opened = await rows(
      tx,
      sql`select o.id,
          coalesce((
            select max(e.created_at) from app.domain_event_outbox e
            where e.enterprise_id=${enterpriseId} and e.aggregate_type='construction_site_issue'
              and e.aggregate_id=o.id::text
              and e.type in ('construction.site.issue.progress.v1','construction.site.issue.lifecycle.v1')
          ), o.created_at) as updated_at
        from app.domain_event_outbox o
        where o.enterprise_id=${enterpriseId} and o.type='construction.site.issue.opened.v1'
          and o.payload->>'projectId'=${projectId}
        order by o.id desc limit 21`,
    );
    const issues: ScheduleIssueSnapshot[] = [];
    for (const event of opened.slice(0, 20)) {
      const issue = await readSiteIssue(tx, enterpriseId, projectId, String(event.id));
      if (!issue) continue;
      const updatedAt = new Date(String(event.updated_at));
      issues.push({
        issueId: String(event.id),
        sourceRecordId: issue.recordId,
        status: issue.status,
        ownerId: issue.ownerId,
        ownerName: issue.ownerName,
        lastResult: issue.text.slice(0, 600),
        updatedAt: Number.isFinite(updatedAt.getTime())
          ? updatedAt.toISOString()
          : new Date().toISOString(),
      });
    }
    return issues;
  });
}

const STATUS_LABEL: Readonly<Record<string, string>> = {
  awaiting_owner: '待负责人处理',
  awaiting_review: '已回复，待核对',
  invalidated: '原材料或房间已变化，待重新核对',
  implemented: '已记录落实证据，待正式核对',
  resolved: '已解决，待关闭',
  reopened: '已重新打开，待处理',
};

function reminderText(input: ScheduleReminderInput): string {
  const label = STATUS_LABEL[input.issue.status] ?? input.issue.status;
  const owner = input.issue.ownerName || '未分配';
  const body = [
    `【周报跟进】${input.projectName} ${input.period.periodStart}~${input.period.periodEnd}`,
    `事项${input.issue.issueId}（原施工记录${input.issue.sourceRecordId}）：${label}；负责人：${owner}。`,
    input.issue.lastResult,
    '请沿现有跟进流程处理。本提醒只引用已存在的施工事项，不代表工程验收、批准或逾期结论。',
  ].filter((line) => line.trim()).join('\n');
  return body.slice(0, 1_400);
}

async function sendReminder(input: ScheduleReminderInput): Promise<ScheduleReminderResult> {
  const enterpriseId = assertId(input.enterpriseId, 'enterprise id');
  const projectId = assertId(input.projectId, 'project id');
  const adminId = assertId(input.adminId, 'admin id');
  return withTenantTransaction(enterpriseId, async (tx) => {
    await input.writeGuard?.(tx);
    // Match the construction service lock order: project first, then the
    // receiver account/member/binding and finally the destination conversation.
    const project = await one(
      tx,
      sql`select * from app.construction_projects
        where enterprise_id=${enterpriseId} and id=${projectId} for share`,
    );
    if (!project || project.status !== 'active') {
      return { sent: false, reason: 'project_inactive', messageId: null };
    }
    const account = await one(
      tx,
      sql`select id,role,status,must_change_password from app.admin_users
        where enterprise_id=${enterpriseId} and id=${adminId} for share`,
    );
    if (
      !account
      || account.status !== 'active'
      || account.must_change_password !== false
    ) {
      return { sent: false, reason: 'account_unavailable', messageId: null };
    }
    const access = await one(
      tx,
      sql`select app.construction_followup_staff_access(
        ${adminId}::bigint,${enterpriseId}::bigint) as role`,
    );
    const role = String(account.role);
    if (input.targetKind === 'boss') {
      if (role !== 'enterprise_admin') {
        return { sent: false, reason: 'boss_role_changed', messageId: null };
      }
      if (String(access?.role) !== 'owner') {
        return { sent: false, reason: 'boss_access_revoked', messageId: null };
      }
    } else {
      const expectedRole = input.targetKind === 'designer' ? 'designer' : 'construction_staff';
      if (role !== expectedRole) {
        return {
          sent: false,
          reason: `${input.targetKind}_role_changed`,
          messageId: null,
        };
      }
      const member = await one(
        tx,
        sql`select role from app.construction_members
          where enterprise_id=${enterpriseId} and project_id=${projectId}
            and admin_id=${adminId} and active and role<>'observer' for share`,
      );
      if (!member || !access?.role) {
        return {
          sent: false,
          reason: `${input.targetKind}_membership_revoked`,
          messageId: null,
        };
      }
    }
    const binding = await one(
      tx,
      sql`select * from app.construction_followup_bindings
        where enterprise_id=${enterpriseId} and principal_key=${`admin:${adminId}`}
          and audience=${input.targetKind} and status='enabled'
          and project_id is null and scope_key='enterprise'
        order by id limit 1 for update`,
    );
    if (!binding) {
      return { sent: false, reason: 'binding_missing', messageId: null };
    }
    if (!await followupAvailable(tx, enterpriseId, binding)) {
      return { sent: false, reason: 'conversation_unavailable', messageId: null };
    }
    const conversation = await one(
      tx,
      sql`select * from app.assistant_conversations
        where enterprise_id=${enterpriseId} and id=${String(binding.conversation_id)}
        for update`,
    );
    if (
      !conversation
      || conversation.status !== 'open'
      || conversation.purpose !== 'construction_followup'
    ) {
      return { sent: false, reason: 'conversation_not_open', messageId: null };
    }
    // One reminder per issue per period per target. A repeated scheduler tick
    // hits the outbox unique key and never appends a second message.
    const periodVersion = Number(input.period.periodStart.replace(/-/g, ''));
    const event = await one(
      tx,
      sql`insert into app.domain_event_outbox(
          enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
        values(${enterpriseId},'construction.report.followup.v1','construction_site_issue',
          ${input.issue.issueId},${periodVersion},'{"kind":"system"}'::jsonb,${input.issue.issueId},
          ${JSON.stringify({
            projectId,
            issueId: input.issue.issueId,
            sourceRecordId: input.issue.sourceRecordId,
            status: input.issue.status,
            ownerId: input.issue.ownerId,
            targetKind: input.targetKind,
            adminId,
            periodStart: input.period.periodStart,
            periodEnd: input.period.periodEnd,
          })}::jsonb)
        on conflict(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version) do nothing
        returning id`,
    );
    if (!event) {
      return { sent: false, reason: 'already_sent', messageId: null };
    }
    const message = await appendMessage(
      tx,
      deliveryActor(enterpriseId, binding),
      String(conversation.id),
      {
        author: 'system',
        eventId: String(event.id),
        purpose: 'construction.followup',
        content: { version: 1, blocks: [{ type: 'text', text: reminderText(input) }] },
      },
    );
    return { sent: true, reason: null, messageId: String(message.id) };
  });
}

/** The B5.8 preflight narrowed the plan to one project; the scheduler does not. */
export function createScheduledPeriodReportPreflight(options: {
  readonly now: () => Date;
}): (input: PeriodReportBatchPreflightInput) => Promise<PeriodReportBatchPlanEvidence> {
  return async (input) => {
    const now = options.now();
    return withTenantTransaction(input.enterpriseId, async (tx) => {
      // Project write access is the existing owner/manager rule. The lock order
      // matches the single-receiver path: project, then report settings.
      const access = await writeProjectAccess(tx, input.actor, input.projectId, 'update');
      const settings = await one(
        tx,
        sql`select * from app.construction_report_settings
          where enterprise_id=${input.enterpriseId} for share`,
      );
      if (!settings) {
        throw new WorkflowOperationError(
          'period_report_plan_missing',
          422,
          'the enterprise report plan is missing',
        );
      }
      if (settings.enabled !== true) {
        throw new WorkflowOperationError(
          'period_report_plan_disabled',
          422,
          'the existing report worker would not process a disabled plan',
        );
      }
      if (settings.stage_enabled !== false) {
        throw new WorkflowOperationError(
          'period_report_legacy_scheduler_due',
          409,
          'the legacy stage report path must stay off for the scheduled weekly run',
        );
      }
      const weeklyAt = new Date(String(settings.next_weekly_at));
      if (!Number.isFinite(weeklyAt.getTime()) || weeklyAt.getTime() <= now.getTime()) {
        throw new WorkflowOperationError(
          'period_report_legacy_scheduler_due',
          409,
          'the legacy weekly scheduler is still due for this enterprise',
          { nextWeeklyAt: endOfDay(settings.next_weekly_at) },
        );
      }
      const projectIds = configuredIds(settings.project_ids);
      if (projectIds.length && !projectIds.includes(input.projectId)) {
        throw new WorkflowOperationError(
          'period_report_project_out_of_scope',
          409,
          `the report plan does not contain project ${input.projectId}`,
          { projectIds },
        );
      }
      const audiences = configuredAudiences(settings.audiences);
      if (audiences) {
        const missing = AUDIENCES.filter((audience) => !audiences.includes(audience));
        if (missing.length) {
          throw new WorkflowOperationError(
            'period_report_audience_disabled',
            409,
            `the report plan does not allow ${missing.join(', ')}`,
            { audiences, missing },
          );
        }
      }
      return {
        enabled: true,
        stageEnabled: false,
        projectIds,
        audiences,
        nextDailyAt: endOfDay(settings.next_daily_at),
        nextWeeklyAt: weeklyAt.toISOString(),
        executor: { owner: access.owner, memberRole: access.memberRole },
      };
    });
  };
}

export function createDatabasePeriodReportScheduleEnvironment(
  options: DatabaseScheduleEnvironmentOptions,
): PeriodReportScheduleEnvironment {
  const now = options.now ?? (() => new Date());
  const preflight = createScheduledPeriodReportPreflight({ now });
  return {
    now,
    loadPublished: options.loadPublished,
    discover: (input) => discoverProjects(input),
    claimWeeklySchedule: (input) => claimWeeklySchedule({ ...input, now: now(), postgresControl: options.postgresControl }),
    ensureCustomerBinding,
    runBatch: (input) => runPeriodReportBatch(input, {
      preflight,
      authorize: assertPeriodReportBatchExecutor,
      now,
    }),
    recoverReceiver: async (input) => {
      const published = await options.loadPublished({
        definitionId: input.published.definitionId,
        revision: input.published.revision,
      });
      return runPeriodReportEntry({
        loadPublished: async () => published,
        enterpriseId: input.enterpriseId,
        projectId: input.projectId,
        actor: input.actor,
        event: input.event,
        receiver: input.receiver,
        ports: createPeriodReportPorts({
          actor: input.actor,
          receiver: input.receiver,
          writeGuard: input.writeGuard,
          projectScope: 'plan',
          legacy: 'weekly_claimed',
          now,
        }),
        store: options.runStore,
        writeGuard: input.writeGuard,
        runId: input.runId,
      }, { now });
    },
    portsFor: (receiver: LivePeriodReceiver, context) => createPeriodReportPorts({
      actor: context.actor,
      receiver,
      writeGuard: context.writeGuard,
      projectScope: 'plan',
      legacy: 'weekly_claimed',
      now,
    }),
    observeStatus: ({ runId, viewer }) => readPeriodReportRunStatus({
      runId,
      viewer,
      runStore: options.runStore,
      now,
    }),
    loadIssues,
    sendReminder,
  };
}
