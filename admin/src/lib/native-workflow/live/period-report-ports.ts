import { sql, type SQL } from 'drizzle-orm';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { AssistantError, fail } from '@/lib/assistant/contracts';
import type { ConstructionActor } from '@/lib/construction/contracts';
import {
  collectReportFacts,
  followupAvailable,
  reportAudienceEnabled,
  type ReportProject,
} from '@/lib/construction/report-scope';
import { enqueueReport } from '@/lib/construction/report-store';
import { WorkflowOperationError, workflowIssue } from '../errors';
import { isPlainObject } from '../guards';
import type { PendingOperation, WorkflowValue } from '../types';
import { writeProjectAccess } from './project-access';
import {
  assertOperationPeriodMatches,
  parseFixedPeriod,
  periodReportKey,
  type FixedPeriod,
} from './period-event';
import {
  LiveOperationFailure,
  LiveOperationUnknownError,
  type LiveOperationPorts,
  type LivePeriodReceiver,
} from './types';

/**
 * B5 live adapter for the daily period-report template.
 *
 * It reuses the existing report lifecycle (`enqueueReport` + facts collection +
 * delivery receipts). It never creates a second fact store, model client,
 * queue or message: `save.period_report` only enqueues the real report task,
 * and `deliver.inapp` only reads the receipt written by the existing Worker.
 *
 * Single-project, one host-selected receiver (customer/worker/designer/boss).
 * The existing `construction_report_settings` plan stays enabled so its Worker
 * processes the queued facts/body/delivery, but the legacy scheduler times are
 * parked and stage reports are off. A still-due legacy schedule or a disabled
 * plan refuses the period instead of creating a second path or an unprocessable
 * task.
 */
export interface PeriodReportPortOptions {
  readonly actor: ConstructionActor;
  /** Host-selected receiver; absent keeps the legacy project customer. */
  readonly receiver?: LivePeriodReceiver;
  /** Test/CLI seam; defaults to the real tenant-transaction store. */
  readonly store?: PeriodReportStore;
  /** Test seam for the trusted clock; defaults to `new Date()` per execute. */
  readonly now?: () => Date;
}

export type PeriodReceiverStatus =
  | 'available'
  | 'binding_missing'
  | 'project_inactive'
  | 'customer_access_revoked'
  | 'worker_unavailable'
  | 'designer_unavailable'
  | 'boss_unavailable'
  | 'conversation_unavailable'
  | 'audience_disabled';

export type PeriodReceiverKind = 'customer' | 'worker' | 'designer' | 'boss';

export interface PeriodReportScope {
  readonly enterpriseId: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly bindingId: string | null;
  readonly conversationId: string | null;
  readonly receiverKind: PeriodReceiverKind;
  readonly receiverAdminId: string | null;
  readonly receiverUserId: string | null;
  readonly bindingAudience: PeriodReceiverKind;
  readonly reportKey: string;
  /** The plan is enabled so the existing Worker may process the queued task. */
  readonly legacyPlanEnabled: boolean;
  /** The legacy scheduler is still due and could generate the same period. */
  readonly legacyScheduleDue: boolean;
  readonly audienceEnabled: boolean;
  readonly receiverAvailable: boolean;
  readonly receiverStatus: PeriodReceiverStatus;
}

export interface StoredPeriodReport {
  readonly reportId: string;
  readonly revision: number;
  readonly runId: string;
  readonly conversationId: string;
  readonly reportKey: string;
  readonly reused: boolean;
}

export interface PeriodReportRecord {
  readonly projectId: string;
  readonly recordId: string;
  readonly version: number;
  readonly source: 'construction_record';
  readonly occurredAt: string;
  readonly room: string;
  readonly title: string;
  readonly completed: string;
  readonly pending: string;
  readonly coordination: string;
  readonly note: string;
}

export interface PeriodRecordRead {
  readonly records: readonly PeriodReportRecord[];
  readonly truncated: boolean;
}

export interface PeriodReportPhoto {
  readonly projectId: string;
  readonly recordId: string;
  readonly version: number;
  readonly photoId: string;
  readonly width: number | null;
  readonly height: number | null;
}

export interface PeriodDeliveryRecord {
  readonly state: string;
  readonly messageId: string | null;
  readonly conversationId: string | null;
  readonly deliveredAt: string | null;
  readonly messagePurpose: string | null;
}

/** Real business reads/writes; injectable so the adapter logic is testable offline. */
export interface PeriodReportStore {
  loadScope(input: {
    readonly actor: ConstructionActor;
    readonly projectId: string;
    readonly period: FixedPeriod;
    readonly write: boolean;
    readonly receiver: LivePeriodReceiver;
  }): Promise<PeriodReportScope>;
  findReport(scope: PeriodReportScope, period: FixedPeriod): Promise<StoredPeriodReport | null>;
  enqueue(input: {
    readonly actor: ConstructionActor;
    readonly projectId: string;
    readonly period: FixedPeriod;
    readonly receiver: LivePeriodReceiver;
  }): Promise<StoredPeriodReport | null>;
  readRecords(scope: PeriodReportScope, period: FixedPeriod): Promise<PeriodRecordRead>;
  readPhotos(
    scope: PeriodReportScope,
    records: readonly PeriodReportRecord[],
  ): Promise<readonly PeriodReportPhoto[]>;
  readDelivery(
    scope: PeriodReportScope,
    reportId: string,
    revision: number,
  ): Promise<PeriodDeliveryRecord | null>;
}

/** Offline seams for the default store; production uses the real implementations. */
export interface PeriodReportStoreDependencies {
  readonly transaction?: <T>(
    enterpriseId: bigint | number | string,
    callback: (tx: PostgresTransaction) => Promise<T>,
  ) => Promise<T>;
  readonly authorizeWrite?: (
    tx: PostgresTransaction,
    actor: ConstructionActor,
    projectId: string,
    lock: 'share' | 'update',
  ) => Promise<unknown>;
  readonly enqueueReport?: typeof enqueueReport;
}

type LockMode = 'share' | 'update';

function lockClause(mode: LockMode): SQL {
  return mode === 'update' ? sql`for update` : sql`for share`;
}

function configuredProjectIds(settings: Row): string[] {
  const value = settings.project_ids;
  return Array.isArray(value) ? value.map((projectId) => String(projectId)) : [];
}

/**
 * Single active execution path for the fixed period.
 *
 * `construction_report_settings.enabled` must stay on because the existing
 * Worker refuses to process facts/body/delivery otherwise. The legacy
 * scheduler is therefore parked instead: both next-run timestamps must be in
 * the future and stage reports must be off. A due timestamp or an enabled
 * stage path refuses the B run before it can create a second report.
 */
function legacyScheduleDue(settings: Row): boolean {
  if (settings.enabled !== true) return false;
  if (settings.stage_enabled !== false) return true;
  const now = Date.now();
  for (const field of ['next_daily_at', 'next_weekly_at'] as const) {
    const value = settings[field];
    const at = value === null || value === undefined ? Number.NaN : new Date(String(value)).getTime();
    if (!Number.isFinite(at) || at <= now) return true;
  }
  return false;
}

function assertConfiguredProject(
  settings: Row,
  projectId: string,
  receiverKind: PeriodReceiverKind,
): void {
  const configured = configuredProjectIds(settings);
  if (receiverKind !== 'customer') {
    // A staff/boss receiver is single-project by contract: a broader or empty
    // plan would let another project's period slip into this run.
    if (configured.length !== 1 || configured[0] !== projectId) {
      fail('period_report_project_scope_mismatch', 409);
    }
    return;
  }
  if (configured.length && !configured.includes(projectId)) {
    fail('period_report_project_out_of_scope', 409);
  }
}

function narrowedSettings(settings: Row, projectId: string): Row {
  // A single-project B run must not inherit a broader enterprise filter.
  return { ...settings, project_ids: [projectId] };
}

function receiverAdminId(receiver: LivePeriodReceiver): string | null {
  return receiver.kind === 'customer' ? null : receiver.adminId ?? null;
}

const KNOWN_RECEIVER_KINDS: ReadonlySet<string> = new Set(['customer', 'worker', 'designer', 'boss']);

async function customerBinding(
  tx: PostgresTransaction,
  enterpriseId: string,
  projectId: string,
  mode: LockMode,
): Promise<Row | undefined> {
  return one(
    tx,
    sql`select b.* from app.construction_followup_bindings b
      where b.enterprise_id=${enterpriseId} and b.project_id=${projectId}
        and b.audience='customer' and b.status='enabled'
      order by b.id limit 1 ${lockClause(mode)}`,
  );
}

async function enterpriseBinding(
  tx: PostgresTransaction,
  enterpriseId: string,
  adminId: string,
  audience: 'worker' | 'designer' | 'boss',
  mode: LockMode,
): Promise<Row | undefined> {
  const principal = `admin:${adminId}`;
  return one(
    tx,
    sql`select b.* from app.construction_followup_bindings b
      where b.enterprise_id=${enterpriseId} and b.principal_key=${principal}
        and b.audience=${audience} and b.project_id is null and b.scope_key='enterprise'
        and b.status='enabled'
      order by b.id limit 1 ${lockClause(mode)}`,
  );
}

async function receiverBinding(
  tx: PostgresTransaction,
  enterpriseId: string,
  projectId: string,
  receiver: LivePeriodReceiver,
  mode: LockMode,
): Promise<Row | undefined> {
  if (receiver.kind === 'customer') {
    return customerBinding(tx, enterpriseId, projectId, mode);
  }
  const adminId = receiverAdminId(receiver);
  if (!adminId) return undefined;
  return enterpriseBinding(tx, enterpriseId, adminId, receiver.kind, mode);
}

/**
 * The existing enterprise owner policy for a boss receiver.
 *
 * A boss follows the same `construction_followup_staff_access` contract as the
 * followup read path: the account must be the enterprise's own active
 * `enterprise_admin` and the access role must be `owner`. It deliberately does
 * not require a project member row and never reads `customer_access`. Platform
 * `admin`/`super_admin` accounts can also be owners, but they may only join a
 * follow-up themselves; a host-selected boss run must not bind them.
 */
async function bossAvailable(
  tx: PostgresTransaction,
  enterpriseId: string,
  adminId: string,
): Promise<boolean> {
  const admin = await one(
    tx,
    sql`select id,role from app.admin_users
      where enterprise_id=${enterpriseId} and id=${adminId} and status='active'
        and role='enterprise_admin' and must_change_password=false for share`,
  );
  // Keep the identity check explicit in addition to the SQL predicate, so a
  // caller cannot treat a platform owner account as this host-selected boss.
  if (!admin || String(admin.role) !== 'enterprise_admin') return false;
  return String((await one(
    tx,
    sql`select app.construction_followup_staff_access(${adminId}::bigint,${enterpriseId}::bigint) as role`,
  ))?.role) === 'owner';
}

/** The existing enterprise staff policy plus the fixed project membership. */
async function staffAvailable(
  tx: PostgresTransaction,
  enterpriseId: string,
  adminId: string,
  projectId: string,
  role: 'worker' | 'designer',
): Promise<boolean> {
  const adminRole = role === 'designer' ? 'designer' : 'construction_staff';
  const admin = await one(
    tx,
    sql`select id from app.admin_users
      where enterprise_id=${enterpriseId} and id=${adminId} and status='active'
        and role=${adminRole} and must_change_password=false for share`,
  );
  if (!admin) return false;
  const member = await one(
    tx,
    sql`select role from app.construction_members
      where enterprise_id=${enterpriseId} and project_id=${projectId} and admin_id=${adminId}
        and active and role<>'observer' for share`,
  );
  if (!member) return false;
  return Boolean((await one(
    tx,
    sql`select app.construction_followup_staff_access(${adminId}::bigint,${enterpriseId}::bigint) as role`,
  ))?.role);
}

/** The receiver's current account/owner rule; boss never uses the staff checks. */
async function receiverAccountAvailable(
  tx: PostgresTransaction,
  enterpriseId: string,
  adminId: string,
  receiverKind: Exclude<PeriodReceiverKind, 'customer'>,
  projectId: string,
): Promise<boolean> {
  if (receiverKind === 'boss') return bossAvailable(tx, enterpriseId, adminId);
  return staffAvailable(tx, enterpriseId, adminId, projectId, receiverKind);
}

/** Re-resolve exactly the binding this receiver was authorized against. */
async function receiverBindingById(
  tx: PostgresTransaction,
  scope: PeriodReportScope,
  mode: LockMode,
): Promise<Row | undefined> {
  if (!scope.bindingId) return undefined;
  if (scope.receiverKind !== 'customer') {
    const adminId = scope.receiverAdminId;
    if (!adminId) return undefined;
    const principal = `admin:${adminId}`;
    return one(
      tx,
      sql`select * from app.construction_followup_bindings
        where enterprise_id=${scope.enterpriseId} and id=${scope.bindingId}
          and principal_key=${principal} and audience=${scope.receiverKind}
          and project_id is null and scope_key='enterprise' and status='enabled'
        ${lockClause(mode)}`,
    );
  }
  return one(
    tx,
    sql`select * from app.construction_followup_bindings
      where enterprise_id=${scope.enterpriseId} and id=${scope.bindingId}
        and project_id=${scope.projectId} and audience='customer' and status='enabled'
      ${lockClause(mode)}`,
  );
}

async function receiverBindingAvailable(
  tx: PostgresTransaction,
  scope: PeriodReportScope,
  binding: Row,
): Promise<boolean> {
  if (!await followupAvailable(tx, scope.enterpriseId, binding)) return false;
  if (scope.receiverKind === 'customer') return true;
  const adminId = scope.receiverAdminId;
  return Boolean(adminId)
    && receiverAccountAvailable(
      tx,
      scope.enterpriseId,
      adminId!,
      scope.receiverKind,
      scope.projectId,
    );
}

interface ReportExpectation {
  readonly kind: FixedPeriod['kind'];
  readonly start: Date;
  readonly end: Date;
  readonly projectId: string;
  readonly receiverKind: PeriodReceiverKind;
}

function sameInstant(value: unknown, expected: Date): boolean {
  const at = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(at.getTime()) && at.getTime() === expected.getTime();
}

function snapshotProjectIds(snapshot: unknown): string[] {
  const policy = snapshot as Row | null;
  const scope = policy?.scope as Row | null | undefined;
  const ids = scope?.project_ids;
  return Array.isArray(ids) ? ids.map((projectId) => String(projectId)) : [];
}

async function findReportInTransaction(
  tx: PostgresTransaction,
  enterpriseId: string,
  bindingId: string,
  reportKey: string,
  conversationId: string,
  expected: ReportExpectation,
): Promise<StoredPeriodReport | null> {
  const report = await one(
    tx,
    sql`select id,binding_id,kind,period_start,period_end,latest_revision
      from app.construction_reports
      where enterprise_id=${enterpriseId} and binding_id=${bindingId} and report_key=${reportKey}
      order by id limit 1`,
  );
  if (!report) return null;
  const version = await one(
    tx,
    sql`select v.revision,v.run_id,run.conversation_id,run.policy_snapshot
      from app.construction_report_versions v
      join app.assistant_runs run
        on run.enterprise_id=v.enterprise_id and run.id=v.run_id
      where v.enterprise_id=${enterpriseId} and v.report_id=${String(report.id)}
        and v.revision=${Number(report.latest_revision)}`,
  );
  if (expected.receiverKind !== 'customer') {
    // A staff run is a single-project receiver: never inherit another
    // project's or another conversation generation's same-period report.
    if (String(report.binding_id) !== bindingId) {
      fail('period_report_scope_conflict', 409);
    }
    if (!version) fail('period_report_scope_conflict', 409);
    if (String(version.conversation_id) !== conversationId) {
      fail('period_report_generation_conflict', 409);
    }
    const projectIds = snapshotProjectIds(version.policy_snapshot);
    if (
      String(report.kind) !== expected.kind
      || !sameInstant(report.period_start, expected.start)
      || !sameInstant(report.period_end, expected.end)
      || projectIds.length !== 1
      || projectIds[0] !== expected.projectId
    ) {
      fail('period_report_scope_conflict', 409);
    }
  }
  if (!version) return null;
  return {
    reportId: String(report.id),
    revision: Number(version.revision),
    runId: String(version.run_id),
    conversationId,
    reportKey,
    reused: true,
  };
}

async function loadScopeInTransaction(
  tx: PostgresTransaction,
  actor: ConstructionActor,
  projectId: string,
  period: FixedPeriod,
  write: boolean,
  authorizeWrite: typeof writeProjectAccess,
  receiver: LivePeriodReceiver,
): Promise<PeriodReportScope> {
  // B reports are a management path: every capability, including reads, uses
  // the existing construction owner/manager rule. Tenant scope is fixed by the
  // host run, never by the definition.
  const access = await authorizeWrite(tx, actor, projectId, write ? 'update' : 'share');
  const project = access.project;
  const settings = await one(
    tx,
    sql`select * from app.construction_report_settings
      where enterprise_id=${actor.enterpriseId} ${lockClause(write ? 'update' : 'share')}`,
  );
  if (!settings) fail('period_report_plan_missing', 422);
  assertConfiguredProject(settings, projectId, receiver.kind);

  const binding = await receiverBinding(
    tx,
    actor.enterpriseId,
    projectId,
    receiver,
    write ? 'update' : 'share',
  );
  const conversation = binding
    ? await one(
        tx,
        sql`select * from app.assistant_conversations
          where enterprise_id=${actor.enterpriseId} and id=${String(binding.conversation_id)}
          ${lockClause(write ? 'update' : 'share')}`,
      )
    : undefined;
  const audienceEnabled = binding ? reportAudienceEnabled(settings, binding) : false;

  let receiverStatus: PeriodReceiverStatus = 'available';
  if (!binding || !conversation) receiverStatus = 'binding_missing';
  else if (
    String(project.status) !== 'active'
    || ['completion', 'move_in'].includes(String(project.current_stage_key ?? ''))
  ) receiverStatus = 'project_inactive';
  else if (receiver.kind === 'customer' && !project.customer_access) {
    receiverStatus = 'customer_access_revoked';
  } else if (receiver.kind !== 'customer') {
    const adminId = receiverAdminId(receiver);
    if (
      !adminId
      || !await receiverAccountAvailable(tx, actor.enterpriseId, adminId, receiver.kind, projectId)
    ) {
      receiverStatus = `${receiver.kind}_unavailable`;
    } else if (!audienceEnabled) receiverStatus = 'audience_disabled';
    else if (!await followupAvailable(tx, actor.enterpriseId, binding)) {
      receiverStatus = 'conversation_unavailable';
    }
  } else if (!audienceEnabled) receiverStatus = 'audience_disabled';
  else if (!await followupAvailable(tx, actor.enterpriseId, binding)) {
    receiverStatus = 'conversation_unavailable';
  }

  const reportKey = binding && conversation
    ? periodReportKey(period, {
        id: String(conversation.id),
        followupGeneration: (conversation.entry_snapshot as Row | null)?.followupGeneration,
      })
    : '';

  const bindingAudience: PeriodReceiverKind =
    String(binding?.audience) === 'worker'
      ? 'worker'
      : String(binding?.audience) === 'designer'
        ? 'designer'
        : String(binding?.audience) === 'boss'
          ? 'boss'
          : receiver.kind;

  return {
    enterpriseId: actor.enterpriseId,
    projectId,
    projectName: String(project.name ?? ''),
    bindingId: binding ? String(binding.id) : null,
    conversationId: conversation ? String(conversation.id) : null,
    receiverKind: receiver.kind,
    receiverAdminId: receiver.kind === 'customer' ? null : receiverAdminId(receiver),
    receiverUserId: binding?.user_id ? String(binding.user_id) : null,
    bindingAudience,
    reportKey,
    legacyPlanEnabled: settings.enabled === true,
    legacyScheduleDue: legacyScheduleDue(settings),
    audienceEnabled,
    receiverAvailable: receiverStatus === 'available',
    receiverStatus,
  };
}

async function queueInTransaction(
  tx: PostgresTransaction,
  actor: ConstructionActor,
  projectId: string,
  period: FixedPeriod,
  authorizeWrite: typeof writeProjectAccess,
  enqueue: typeof enqueueReport,
  receiver: LivePeriodReceiver,
): Promise<StoredPeriodReport | null> {
  // Re-authorize at the top of the write transaction, with the same project →
  // settings → binding → conversation lock order as the scope read. A manager
  // revoked between the scope check and this transaction must not enqueue.
  await authorizeWrite(tx, actor, projectId, 'update');
  const settings = await one(
    tx,
    sql`select * from app.construction_report_settings
      where enterprise_id=${actor.enterpriseId} for update`,
  );
  if (!settings) fail('period_report_plan_missing', 422);
  // Re-check inside the write transaction: the legacy scheduler must never
  // create a parallel report for this period, and a disabled plan would leave
  // an unprocessable task for the existing Worker.
  if (settings.enabled !== true) fail('period_report_plan_disabled', 422);
  if (legacyScheduleDue(settings)) fail('period_report_legacy_scheduler_due', 409);
  assertConfiguredProject(settings, projectId, receiver.kind);

  const binding = await receiverBinding(tx, actor.enterpriseId, projectId, receiver, 'update');
  if (!binding) fail('period_report_receiver_unavailable', 409);
  if (!reportAudienceEnabled(settings, binding)) fail('period_report_audience_disabled', 409);
  if (receiver.kind !== 'customer') {
    const adminId = receiverAdminId(receiver);
    if (
      !adminId
      || !await receiverAccountAvailable(tx, actor.enterpriseId, adminId, receiver.kind, projectId)
    ) {
      fail('period_report_receiver_unavailable', 409);
    }
  }
  if (!await followupAvailable(tx, actor.enterpriseId, binding)) {
    fail('period_report_receiver_unavailable', 409);
  }
  const conversation = await one(
    tx,
    sql`select * from app.assistant_conversations
      where enterprise_id=${actor.enterpriseId} and id=${String(binding.conversation_id)} for update`,
  );
  if (!conversation) fail('period_report_receiver_unavailable', 409);
  const reportKey = periodReportKey(period, {
    id: String(conversation.id),
    followupGeneration: (conversation.entry_snapshot as Row | null)?.followupGeneration,
  });

  const enqueued = await enqueue(
    tx,
    actor.enterpriseId,
    binding,
    narrowedSettings(settings, projectId),
    {
      kind: period.kind,
      start: period.start,
      end: period.end,
      cutoff: period.cutoff,
      scheduledAt: period.scheduledAt,
    },
  );
  if (enqueued) {
    return {
      reportId: enqueued.reportId,
      revision: enqueued.revision,
      runId: enqueued.runId,
      conversationId: enqueued.conversationId,
      reportKey,
      reused: false,
    };
  }
  return findReportInTransaction(
    tx,
    actor.enterpriseId,
    String(binding.id),
    reportKey,
    String(conversation.id),
    {
      kind: period.kind,
      start: period.start,
      end: period.end,
      projectId,
      receiverKind: receiver.kind,
    },
  );
}

function reportField(data: Row, key: string, max = 500): string {
  const value = data[key];
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function projectRecords(project: ReportProject | undefined): PeriodReportRecord[] {
  if (!project) return [];
  return project.records.map((record) => {
    const data = record.data as Row;
    return {
      projectId: project.id,
      recordId: record.id,
      version: record.version,
      source: 'construction_record' as const,
      occurredAt: record.publishedAt,
      room: record.room,
      title: reportField(data, 'title'),
      completed: reportField(data, 'completed'),
      pending: reportField(data, 'pending'),
      coordination: reportField(data, 'coordination'),
      note: reportField(data, 'note'),
    };
  });
}

async function readRecordsInTransaction(
  tx: PostgresTransaction,
  scope: PeriodReportScope,
  period: FixedPeriod,
): Promise<PeriodRecordRead> {
  if (!scope.bindingId) return { records: [], truncated: false };
  const binding = await receiverBindingById(tx, scope, 'share');
  if (!binding || !await receiverBindingAvailable(tx, scope, binding)) {
    return { records: [], truncated: false };
  }
  const settings = await one(
    tx,
    sql`select * from app.construction_report_settings
      where enterprise_id=${scope.enterpriseId} for share`,
  );
  if (!settings) fail('period_report_plan_missing', 422);
  const facts = await collectReportFacts(
    tx,
    scope.enterpriseId,
    binding,
    {
      kind: period.kind,
      period_start: period.start,
      period_end: period.end,
      cutoff_at: period.cutoff,
      stage_event_id: null,
      stage_event: null,
    },
    narrowedSettings(settings, scope.projectId),
  );
  const project = facts.projects.find((candidate) => candidate.id === scope.projectId);
  return {
    records: projectRecords(project),
    truncated: facts.projectsTruncated || project?.recordsTruncated === true,
  };
}

async function readPhotosInTransaction(
  tx: PostgresTransaction,
  scope: PeriodReportScope,
  records: readonly PeriodReportRecord[],
): Promise<readonly PeriodReportPhoto[]> {
  if (!scope.bindingId || !records.length) return [];
  const binding = await receiverBindingById(tx, scope, 'share');
  if (!binding || !await receiverBindingAvailable(tx, scope, binding)) return [];

  const recordIds = [...new Set(records.map((record) => record.recordId))];
  const versions = new Map(records.map((record) => [record.recordId, record.version]));
  const assets = await rows(
    tx,
    sql`select a.record_id::text as record_id,m.id::text as media_id,m.width,m.height
      from app.construction_site_attachments a
      join app.construction_site_media m
        on m.enterprise_id=a.enterprise_id and m.project_id=a.project_id and m.id=a.media_id
      join app.construction_site_records r
        on r.enterprise_id=a.enterprise_id and r.project_id=a.project_id
        and r.id=a.record_id and r.status='published'
      where a.enterprise_id=${scope.enterpriseId} and a.project_id=${scope.projectId}
        and a.record_id=any(ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(recordIds)}::jsonb))::bigint[])
        and m.deleted_at is null
        ${binding.audience === 'customer'
          ? sql`and r.audience='customer' and r.published_customer_id=${binding.user_id ? String(binding.user_id) : null}`
          : sql``}
      order by a.record_id,a.position`,
  );
  return assets.map((asset) => ({
    projectId: scope.projectId,
    recordId: String(asset.record_id),
    version: versions.get(String(asset.record_id)) ?? 0,
    photoId: String(asset.media_id),
    width: asset.width === null || asset.width === undefined ? null : Number(asset.width),
    height: asset.height === null || asset.height === undefined ? null : Number(asset.height),
  }));
}

async function readDeliveryInTransaction(
  tx: PostgresTransaction,
  scope: PeriodReportScope,
  reportId: string,
  revision: number,
): Promise<PeriodDeliveryRecord | null> {
  if (!scope.bindingId) return null;
  const binding = await receiverBindingById(tx, scope, 'share');
  if (!binding || !await receiverBindingAvailable(tx, scope, binding)) return null;
  const delivery = await one(
    tx,
    sql`select d.state,d.message_id,d.delivered_at,
        m.conversation_id as message_conversation_id,m.purpose as message_purpose
      from app.construction_report_deliveries d
      left join app.assistant_messages m
        on m.enterprise_id=d.enterprise_id and m.id=d.message_id
      where d.enterprise_id=${scope.enterpriseId} and d.report_id=${reportId}
        and d.revision=${revision} and d.binding_id=${scope.bindingId}
      limit 1`,
  );
  if (!delivery) return null;
  return {
    state: String(delivery.state),
    messageId: delivery.message_id ? String(delivery.message_id) : null,
    conversationId: delivery.message_conversation_id
      ? String(delivery.message_conversation_id)
      : null,
    deliveredAt: delivery.delivered_at ? new Date(String(delivery.delivered_at)).toISOString() : null,
    messagePurpose: delivery.message_purpose ? String(delivery.message_purpose) : null,
  };
}

/** Default store: every method uses the existing tenant transaction scope. */
export function createPeriodReportStore(
  dependencies: PeriodReportStoreDependencies = {},
): PeriodReportStore {
  const transaction = dependencies.transaction ?? withTenantTransaction;
  const authorizeWrite = (dependencies.authorizeWrite ?? writeProjectAccess) as typeof writeProjectAccess;
  const enqueue = dependencies.enqueueReport ?? enqueueReport;
  return {
    loadScope: ({ actor, projectId, period, write, receiver }) =>
      transaction(actor.enterpriseId, (tx) =>
        loadScopeInTransaction(tx, actor, projectId, period, write, authorizeWrite, receiver),
      ),
    findReport: (scope, period) =>
      scope.bindingId && scope.conversationId
        ? transaction(scope.enterpriseId, (tx) =>
            findReportInTransaction(
              tx,
              scope.enterpriseId,
              scope.bindingId!,
              scope.reportKey,
              scope.conversationId!,
              {
                kind: period.kind,
                start: period.start,
                end: period.end,
                projectId: scope.projectId,
                receiverKind: scope.receiverKind,
              },
            ),
          )
        : Promise.resolve(null),
    enqueue: ({ actor, projectId, period, receiver }) =>
      transaction(actor.enterpriseId, (tx) =>
        queueInTransaction(tx, actor, projectId, period, authorizeWrite, enqueue, receiver),
      ),
    readRecords: (scope, period) =>
      transaction(scope.enterpriseId, (tx) =>
        readRecordsInTransaction(tx, scope, period),
      ),
    readPhotos: (scope, records) =>
      transaction(scope.enterpriseId, (tx) =>
        readPhotosInTransaction(tx, scope, records),
      ),
    readDelivery: (scope, reportId, revision) =>
      transaction(scope.enterpriseId, (tx) =>
        readDeliveryInTransaction(tx, scope, reportId, revision),
      ),
  };
}

function failure(operation: PendingOperation, code: string, message: string): LiveOperationFailure {
  return new LiveOperationFailure(workflowIssue(code, `nodes.${operation.nodeId}`, message));
}

function scopeKey(scope: PeriodReportScope): string {
  return `${scope.enterpriseId}:${scope.receiverKind}:${scope.receiverAdminId ?? ''}:${scope.projectId}:${scope.reportKey}`;
}

function receiverFailure(operation: PendingOperation, status: PeriodReceiverStatus): LiveOperationFailure {
  return failure(
    operation,
    status === 'audience_disabled'
      ? 'period_report_audience_disabled'
      : 'period_report_receiver_unavailable',
    `period report receiver is ${status}`,
  );
}

/** The host read object must describe exactly the authorized receiver. */
function receiversMatchScope(
  receivers: Readonly<Record<string, unknown>>,
  scope: PeriodReportScope,
  projectId: string,
): boolean {
  const same = (field: string, expected: string | null) =>
    String(receivers[field] ?? '') === String(expected ?? '');
  if (!same('projectId', projectId)
    || !same('bindingId', scope.bindingId)
    || !same('conversationId', scope.conversationId)) {
    return false;
  }
  if (scope.receiverKind === 'worker') {
    return same('scope', 'enterprise_worker') && same('workerAdminId', scope.receiverAdminId);
  }
  if (scope.receiverKind === 'designer') {
    return same('scope', 'enterprise_designer') && same('designerAdminId', scope.receiverAdminId);
  }
  if (scope.receiverKind === 'boss') {
    return same('scope', 'enterprise_boss') && same('bossAdminId', scope.receiverAdminId);
  }
  return same('scope', 'project_customer') && same('customerUserId', scope.receiverUserId);
}

function saveReceipt(report: StoredPeriodReport, scope: PeriodReportScope): Record<string, WorkflowValue> {
  return {
    saved: true,
    saveReceipt: {
      receiptId: `report:${report.reportId}:${report.revision}`,
      simulated: false,
      source: 'construction_reports',
      reportId: report.reportId,
      revision: report.revision,
      runId: report.runId,
      reportKey: report.reportKey,
      bindingId: String(scope.bindingId),
      conversationId: report.conversationId,
      reused: report.reused,
      receiverKind: scope.receiverKind,
      receiverAdminId: scope.receiverAdminId,
      projectScope: [scope.projectId],
    },
  };
}

function undelivered(
  status: string,
  report: StoredPeriodReport | null,
  messageId = '',
  conversationId = '',
): Record<string, WorkflowValue> {
  return {
    delivered: false,
    deliveryReceipt: {
      receiptId: '',
      simulated: false,
      source: 'construction_report_deliveries',
      status,
      ...(report ? { reportId: report.reportId, revision: report.revision } : {}),
      ...(messageId ? { messageId } : {}),
      ...(conversationId ? { conversationId } : {}),
    },
  };
}

function composePeriodReport(
  input: Readonly<Record<string, WorkflowValue>>,
  period: FixedPeriod,
): Record<string, WorkflowValue> {
  const records = Array.isArray(input.records) ? input.records : [];
  const photos = Array.isArray(input.photos) ? input.photos : [];
  // This is a deterministic facts heading, not the report body. The existing
  // report-body Worker composes and stores the delivered body separately.
  const count = `本期按原始施工记录整理 ${records.length} 条进展、获权照片 ${photos.length} 张。`;
  const title = period.kind === 'weekly'
    ? `施工周报 · ${period.periodStart} ~ ${period.periodEnd}`
    : `施工日报 · ${period.periodStart}`;
  return {
    title,
    body: records.length || photos.length ? count : '本期没有新的已发布施工记录或获权照片。',
    missingItems: [],
  };
}

export function createPeriodReportPorts(options: PeriodReportPortOptions): LiveOperationPorts {
  const store = options.store ?? createPeriodReportStore();
  const now = options.now ?? (() => new Date());
  const receiver: LivePeriodReceiver = options.receiver ?? { kind: 'customer' };
  const saved = new Map<string, StoredPeriodReport>();
  const records = new Map<string, PeriodRecordRead>();

  return {
    async execute(operation, context) {
      try {
        // An unknown host receiver must be rejected explicitly; it must never
        // silently fall through to the project owner path.
        if (!KNOWN_RECEIVER_KINDS.has(receiver.kind)) {
          throw failure(
            operation,
            'receiver_kind_invalid',
            `receiver kind ${JSON.stringify(receiver.kind)} is not supported`,
          );
        }
        const bound = context.businessEvent.receiver;
        if (
          bound
          && (bound.kind !== receiver.kind
            || (bound.adminId ?? '') !== (receiver.adminId ?? ''))
        ) {
          throw failure(
            operation,
            'receiver_binding_mismatch',
            'the host receiver does not match the run business event receiver',
          );
        }
        const period = parseFixedPeriod(context.event, now());
        switch (operation.capabilityRef) {
          case 'read.period_records': {
            assertOperationPeriodMatches(operation.input, period);
            const scope = await store.loadScope({
              actor: options.actor,
              projectId: context.projectId,
              period,
              receiver,
              write: false,
            });
            if (!scope.bindingId) {
              return { records: [], recordCount: 0, hasRecords: false };
            }
            const read = await store.readRecords(scope, period);
            records.set(scopeKey(scope), read);
            return {
              records: read.records.map((record): Record<string, unknown> => ({ ...record })),
              recordCount: read.records.length,
              hasRecords: read.records.length > 0,
            };
          }
          case 'read.authorized_photos': {
            assertOperationPeriodMatches(operation.input, period);
            const scope = await store.loadScope({
              actor: options.actor,
              projectId: context.projectId,
              period,
              receiver,
              write: false,
            });
            if (!scope.bindingId) return { photos: [], photoCount: 0 };
            const key = scopeKey(scope);
            let read = records.get(key);
            if (!read) {
              read = await store.readRecords(scope, period);
              records.set(key, read);
            }
            if (!read.records.length) return { photos: [], photoCount: 0 };
            const photos = await store.readPhotos(scope, read.records);
            return {
              photos: photos.map((photo): Record<string, unknown> => ({ ...photo })),
              photoCount: photos.length,
            };
          }
          case 'read.receiver_scope': {
            const scope = await store.loadScope({
              actor: options.actor,
              projectId: context.projectId,
              period,
              receiver,
              write: false,
            });
            if (!scope.receiverAvailable) {
              const unavailable: Record<string, WorkflowValue> = {
                receivers: {
                  scope: 'none',
                  projectId: context.projectId,
                  status: scope.receiverStatus,
                },
                receiverCount: 0,
              };
              return unavailable;
            }
            const available: Record<string, WorkflowValue> = {
              receivers: scope.receiverKind === 'worker'
                ? {
                    scope: 'enterprise_worker',
                    projectId: context.projectId,
                    bindingId: scope.bindingId,
                    conversationId: scope.conversationId,
                    workerAdminId: scope.receiverAdminId,
                    audience: 'worker',
                  }
                : scope.receiverKind === 'designer'
                  ? {
                      scope: 'enterprise_designer',
                      projectId: context.projectId,
                      bindingId: scope.bindingId,
                      conversationId: scope.conversationId,
                      designerAdminId: scope.receiverAdminId,
                      audience: 'designer',
                    }
                  : scope.receiverKind === 'boss'
                    ? {
                        scope: 'enterprise_boss',
                        projectId: context.projectId,
                        bindingId: scope.bindingId,
                        conversationId: scope.conversationId,
                        bossAdminId: scope.receiverAdminId,
                        audience: 'boss',
                      }
                    : {
                        scope: 'project_customer',
                        projectId: context.projectId,
                        bindingId: scope.bindingId,
                        conversationId: scope.conversationId,
                        customerUserId: scope.receiverUserId,
                        audience: 'customer',
                      },
              receiverCount: 1,
            };
            return available;
          }
          case 'compose.period_report': {
            assertOperationPeriodMatches(operation.input, period);
            return composePeriodReport(operation.input, period);
          }
          case 'save.period_report': {
            const scope = await store.loadScope({
              actor: options.actor,
              projectId: context.projectId,
              period,
              receiver,
              write: true,
            });
            if (!scope.legacyPlanEnabled) {
              throw failure(
                operation,
                'period_report_plan_disabled',
                'the existing report worker would not process a disabled plan',
              );
            }
            if (scope.legacyScheduleDue) {
              throw failure(
                operation,
                'period_report_legacy_scheduler_due',
                'the legacy construction report scheduler is still due for this enterprise',
              );
            }
            if (!scope.receiverAvailable) throw receiverFailure(operation, scope.receiverStatus);

            const existing = await store.findReport(scope, period);
            if (existing) {
              saved.set(scopeKey(scope), existing);
              return saveReceipt(existing, scope);
            }
            const enqueued = await store.enqueue({
              actor: options.actor,
              projectId: context.projectId,
              period,
              receiver,
            });
            if (!enqueued) {
              const raced = await store.findReport(scope, period);
              if (!raced) {
                throw failure(
                  operation,
                  'period_report_not_queued',
                  'the existing report lifecycle did not queue this period',
                );
              }
              saved.set(scopeKey(scope), raced);
              return saveReceipt(raced, scope);
            }
            // `store.enqueue` already reports whether it created the report or
            // found the durable row after an insert conflict; never rewrite that.
            saved.set(scopeKey(scope), enqueued);
            return saveReceipt(enqueued, scope);
          }
          case 'deliver.inapp': {
            const scope = await store.loadScope({
              actor: options.actor,
              projectId: context.projectId,
              period,
              receiver,
              write: true,
            });
            if (!scope.legacyPlanEnabled) {
              throw failure(
                operation,
                'period_report_plan_disabled',
                'the existing report worker would not process a disabled plan',
              );
            }
            if (scope.legacyScheduleDue) {
              throw failure(
                operation,
                'period_report_legacy_scheduler_due',
                'the legacy construction report scheduler is still due for this enterprise',
              );
            }
            if (!scope.receiverAvailable) {
              return undelivered(scope.receiverStatus, null);
            }
            const receivers = operation.input.receivers;
            if (!isPlainObject(receivers)) {
              throw failure(
                operation,
                'receiver_scope_mismatch',
                'delivery receivers must be the host read object',
              );
            }
            if (
              !receiversMatchScope(receivers, scope, context.projectId)
            ) {
              throw failure(
                operation,
                'receiver_scope_mismatch',
                `delivery receivers do not match the authorized ${scope.receiverKind} receiver`,
              );
            }
            const key = scopeKey(scope);
            const report = saved.get(key) ?? await store.findReport(scope, period);
            if (!report) {
              throw failure(
                operation,
                'period_report_not_saved',
                'delivery requires a saved period report',
              );
            }
            const receipt = await store.readDelivery(scope, report.reportId, report.revision);
            if (!receipt) return undelivered('not_enqueued', report);
            const confirmed = receipt.state === 'delivered'
              && Boolean(receipt.messageId)
              && receipt.conversationId === scope.conversationId
              && receipt.messagePurpose === 'construction.report.facts';
            if (!confirmed) {
              return undelivered(
                receipt.state === 'delivered' ? 'delivery_receipt_unconfirmed' : receipt.state,
                report,
                receipt.messageId ?? '',
                receipt.conversationId ?? '',
              );
            }
            return {
              delivered: true,
              deliveryReceipt: {
                receiptId: `report-delivery:${report.reportId}:${report.revision}:${String(scope.bindingId)}`,
                simulated: false,
                source: 'construction_report_deliveries',
                reportId: report.reportId,
                revision: report.revision,
                status: 'delivered',
                messageId: receipt.messageId,
                conversationId: receipt.conversationId,
                ...(receipt.deliveredAt ? { deliveredAt: receipt.deliveredAt } : {}),
              },
            };
          }
          default:
            throw failure(
              operation,
              'unsupported_live_capability',
              `${operation.capabilityRef} is not supported by the B5 period report adapter`,
            );
        }
      } catch (error) {
        if (error instanceof LiveOperationFailure || error instanceof LiveOperationUnknownError) {
          throw error;
        }
        if (error instanceof AssistantError) {
          throw new LiveOperationFailure(
            workflowIssue(error.code, `nodes.${operation.nodeId}`, error.message),
          );
        }
        if (error instanceof WorkflowOperationError) {
          throw new LiveOperationFailure(
            workflowIssue(error.code, `nodes.${operation.nodeId}`, error.message),
          );
        }
        throw new LiveOperationUnknownError(
          workflowIssue(
            'live_operation_unknown',
            `nodes.${operation.nodeId}`,
            error instanceof Error ? error.message.slice(0, 300) : 'operation outcome is unknown',
          ),
        );
      }
    },
  };
}
