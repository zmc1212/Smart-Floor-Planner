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
} from './types';

/**
 * B5 live adapter for the daily period-report template.
 *
 * It reuses the existing report lifecycle (`enqueueReport` + facts collection +
 * delivery receipts). It never creates a second fact store, model client,
 * queue or message: `save.period_report` only enqueues the real report task,
 * and `deliver.inapp` only reads the receipt written by the existing Worker.
 *
 * Single-project, owner (customer) perspective. The existing
 * `construction_report_settings` plan stays enabled so its Worker processes the
 * queued facts/body/delivery, but the legacy scheduler times are parked and
 * stage reports are off. A still-due legacy schedule or a disabled plan refuses
 * the period instead of creating a second path or an unprocessable task.
 */
export interface PeriodReportPortOptions {
  readonly actor: ConstructionActor;
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
  | 'conversation_unavailable'
  | 'audience_disabled';

export interface PeriodReportScope {
  readonly enterpriseId: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly bindingId: string | null;
  readonly conversationId: string | null;
  readonly customerUserId: string | null;
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
  }): Promise<PeriodReportScope>;
  findReport(scope: PeriodReportScope, period: FixedPeriod): Promise<StoredPeriodReport | null>;
  enqueue(input: {
    readonly actor: ConstructionActor;
    readonly projectId: string;
    readonly period: FixedPeriod;
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

function assertConfiguredProject(settings: Row, projectId: string): void {
  const configured = configuredProjectIds(settings);
  if (configured.length && !configured.includes(projectId)) {
    fail('period_report_project_out_of_scope', 409);
  }
}

function narrowedSettings(settings: Row, projectId: string): Row {
  // A single-project B run must not inherit a broader enterprise filter.
  return { ...settings, project_ids: [projectId] };
}

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

async function findReportInTransaction(
  tx: PostgresTransaction,
  enterpriseId: string,
  bindingId: string,
  reportKey: string,
  conversationId: string,
): Promise<StoredPeriodReport | null> {
  const report = await one(
    tx,
    sql`select id,latest_revision from app.construction_reports
      where enterprise_id=${enterpriseId} and binding_id=${bindingId} and report_key=${reportKey}
      order by id limit 1`,
  );
  if (!report) return null;
  const version = await one(
    tx,
    sql`select revision,run_id from app.construction_report_versions
      where enterprise_id=${enterpriseId} and report_id=${String(report.id)}
        and revision=${Number(report.latest_revision)}`,
  );
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
  assertConfiguredProject(settings, projectId);

  const binding = await customerBinding(tx, actor.enterpriseId, projectId, write ? 'update' : 'share');
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
  else if (!project.customer_access) receiverStatus = 'customer_access_revoked';
  else if (!audienceEnabled) receiverStatus = 'audience_disabled';
  else if (!await followupAvailable(tx, actor.enterpriseId, binding)) {
    receiverStatus = 'conversation_unavailable';
  }

  const reportKey = binding && conversation
    ? periodReportKey(period, {
        id: String(conversation.id),
        followupGeneration: (conversation.entry_snapshot as Row | null)?.followupGeneration,
      })
    : '';

  return {
    enterpriseId: actor.enterpriseId,
    projectId,
    projectName: String(project.name ?? ''),
    bindingId: binding ? String(binding.id) : null,
    conversationId: conversation ? String(conversation.id) : null,
    customerUserId: binding?.user_id ? String(binding.user_id) : null,
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
  assertConfiguredProject(settings, projectId);

  const binding = await customerBinding(tx, actor.enterpriseId, projectId, 'update');
  if (!binding) fail('period_report_receiver_unavailable', 409);
  if (!reportAudienceEnabled(settings, binding)) fail('period_report_audience_disabled', 409);
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
  const binding = await one(
    tx,
    sql`select * from app.construction_followup_bindings
      where enterprise_id=${scope.enterpriseId} and id=${scope.bindingId}
        and project_id=${scope.projectId} and audience='customer' and status='enabled' for share`,
  );
  if (!binding || !await followupAvailable(tx, scope.enterpriseId, binding)) {
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
  const binding = await one(
    tx,
    sql`select * from app.construction_followup_bindings
      where enterprise_id=${scope.enterpriseId} and id=${scope.bindingId}
        and project_id=${scope.projectId} and audience='customer' and status='enabled' for share`,
  );
  if (!binding || !await followupAvailable(tx, scope.enterpriseId, binding)) return [];

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
    loadScope: ({ actor, projectId, period, write }) =>
      transaction(actor.enterpriseId, (tx) =>
        loadScopeInTransaction(tx, actor, projectId, period, write, authorizeWrite),
      ),
    findReport: (scope) =>
      scope.bindingId && scope.conversationId
        ? transaction(scope.enterpriseId, (tx) =>
            findReportInTransaction(
              tx,
              scope.enterpriseId,
              scope.bindingId!,
              scope.reportKey,
              scope.conversationId!,
            ),
          )
        : Promise.resolve(null),
    enqueue: ({ actor, projectId, period }) =>
      transaction(actor.enterpriseId, (tx) =>
        queueInTransaction(tx, actor, projectId, period, authorizeWrite, enqueue),
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
  return `${scope.enterpriseId}:${scope.projectId}:${scope.reportKey}`;
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

function saveReceipt(report: StoredPeriodReport, bindingId: string): Record<string, WorkflowValue> {
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
      bindingId,
      conversationId: report.conversationId,
      reused: report.reused,
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
  const saved = new Map<string, StoredPeriodReport>();
  const records = new Map<string, PeriodRecordRead>();

  return {
    async execute(operation, context) {
      try {
        const period = parseFixedPeriod(context.event, now());
        switch (operation.capabilityRef) {
          case 'read.period_records': {
            assertOperationPeriodMatches(operation.input, period);
            const scope = await store.loadScope({
              actor: options.actor,
              projectId: context.projectId,
              period,
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
              receivers: {
                scope: 'project_customer',
                projectId: context.projectId,
                bindingId: scope.bindingId,
                conversationId: scope.conversationId,
                customerUserId: scope.customerUserId,
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
              return saveReceipt(existing, String(scope.bindingId));
            }
            const enqueued = await store.enqueue({
              actor: options.actor,
              projectId: context.projectId,
              period,
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
              return saveReceipt(raced, String(scope.bindingId));
            }
            // `store.enqueue` already reports whether it created the report or
            // found the durable row after an insert conflict; never rewrite that.
            saved.set(scopeKey(scope), enqueued);
            return saveReceipt(enqueued, String(scope.bindingId));
          }
          case 'deliver.inapp': {
            const scope = await store.loadScope({
              actor: options.actor,
              projectId: context.projectId,
              period,
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
              String(receivers.scope ?? '') !== 'project_customer'
              || String(receivers.projectId ?? '') !== context.projectId
              || String(receivers.bindingId ?? '') !== String(scope.bindingId ?? '')
              || String(receivers.conversationId ?? '') !== String(scope.conversationId ?? '')
              || String(receivers.customerUserId ?? '') !== String(scope.customerUserId ?? '')
            ) {
              throw failure(
                operation,
                'receiver_scope_mismatch',
                'delivery receivers do not match the authorized project customer',
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
