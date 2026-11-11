/** Development-only B5.4 entry for one published daily or weekly period report.
 *
 * It binds one published revision and one fixed period (a Shanghai day or a
 * Monday-to-Monday week), then reuses the existing report lifecycle:
 * `save.period_report` calls the real `enqueueReport` (report/version/run/job),
 * and `deliver.inapp` only reads the receipt written by the existing Worker. No
 * model, FastGPT or embedding call happens in this process; a real Worker must
 * process the queued run.
 *
 * Required environment:
 *   B4_LIVE_APP_DATABASE_URL=postgresql://sfp_app:...@127.0.0.1:55433/smart_floor_planner
 *
 * Usage (from admin/):
 *   npx tsx scripts/native-workflow-period-report.ts --development --ensure-published `
 *     --admin-id 1454000001 --project-id 1454000004 `
 *     --period-start 2026-11-10 --run-id b5-2-daily-001
 *   npx tsx scripts/native-workflow-period-report.ts --development --ensure-published `
 *     --period-kind weekly --period-start 2026-11-02 --run-id b5-4-weekly-001
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { one } from '@/db/repositories/assistant-repository';
import { withTenantTransaction } from '@/db/transaction';
import type { ConstructionActor } from '@/lib/construction/contracts';
import { createFileWorkflowStore, resolveNativeWorkflowStoreDir } from '@/lib/native-workflow/store/file-store';
import { createWorkflowService, type NativeWorkflowTemplateId } from '@/lib/native-workflow/service';
import {
  assertB4ConnectionIdentity,
  describeB4DatabaseTarget,
  resolveB4DatabaseTarget,
} from '@/lib/native-workflow/live/dev-config';
import { runPublishedLive } from '@/lib/native-workflow/live/runner';
import { createFileWorkflowRunStore } from '@/lib/native-workflow/live/run-store';
import { createPeriodReportPorts } from '@/lib/native-workflow/live/period-report-ports';
import { parseFixedPeriod } from '@/lib/native-workflow/live/period-event';
import {
  parsePeriodKind,
  resolveCliPeriod,
  type PeriodCliKind,
} from '@/lib/native-workflow/live/period-cli';
import type { LiveBusinessEvent, LiveRunRecord } from '@/lib/native-workflow/live/types';
import type { TriggerEvent } from '@/lib/native-workflow/types';

loadEnvConfig(process.cwd());

const DEFAULT_ENTERPRISE_ID = '1454';

function failJson(payload: Record<string, unknown>, exitCode = 1): never {
  console.error(JSON.stringify({ success: false, ...payload }, null, 2));
  process.exit(exitCode);
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) failJson({ error: `${name} requires a value` });
  return value;
}

function required(name: string): string {
  const value = option(name);
  if (!value) failJson({ error: `${name} is required` });
  return value;
}

function positiveId(name: string, value: string): string {
  if (!/^[1-9]\d{0,18}$/.test(value)) failJson({ error: `${name} must be a positive integer id` });
  return value;
}

function dateOnly(name: string, value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) failJson({ error: `${name} must be YYYY-MM-DD` });
  return value;
}

function resolveRunDir(): string {
  return process.env.NATIVE_WORKFLOW_RUN_DIR?.trim()
    || path.resolve(process.cwd(), 'tmp/native-workflow-runs');
}

const showRun = option('--show-run');
const executing = !showRun;
const enterpriseId = positiveId('--enterprise-id', option('--enterprise-id') ?? DEFAULT_ENTERPRISE_ID);
const adminId = executing ? positiveId('--admin-id', required('--admin-id')) : '';
const projectId = executing ? positiveId('--project-id', required('--project-id')) : '';

interface CliTarget {
  readonly kind: PeriodCliKind;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly eventId: string;
  readonly definitionId: string;
}

function resolveTarget(): CliTarget {
  const start = dateOnly('--period-start', required('--period-start'));
  const end = option('--period-end');
  try {
    const resolved = resolveCliPeriod({
      kind: parsePeriodKind(option('--period-kind')),
      periodStart: start,
      ...(end === undefined ? {} : { periodEnd: dateOnly('--period-end', end) }),
    });
    return {
      kind: resolved.kind,
      periodStart: resolved.periodStart,
      periodEnd: resolved.periodEnd,
      eventId: option('--event-id') ?? resolved.eventId,
      definitionId: option('--definition-id') ?? resolved.definitionId,
    };
  } catch (error) {
    failJson({ error: error instanceof Error ? error.message : String(error) });
  }
}

const target: CliTarget | null = executing ? resolveTarget() : null;
const occurredAt = target ? option('--occurred-at') ?? `${target.periodStart}T10:00:00.000Z` : '';
const requestedRevision = option('--revision');
const runId = option('--run-id') ?? `native-period-${Date.now()}-${randomUUID().slice(0, 8)}`;
const ensurePublished = process.argv.includes('--ensure-published');

const definitionStore = createFileWorkflowStore({ rootDir: resolveNativeWorkflowStoreDir() });
const workflowService = createWorkflowService({ store: definitionStore });
const runStore = createFileWorkflowRunStore({ rootDir: resolveRunDir() });

function receiptOf(record: LiveRunRecord, port: 'saveReceipt' | 'deliveryReceipt') {
  for (const operation of [...record.operations].reverse()) {
    const value = operation.outputs?.[port];
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  }
  return null;
}

async function resolvePublished(definitionId: string) {
  let record = await definitionStore.get(definitionId);
  if (!record) {
    if (!ensurePublished) failJson({ error: `definition ${definitionId} was not found; pass --ensure-published` });
    const templateId = definitionId as NativeWorkflowTemplateId;
    await workflowService.createFromTemplate(templateId);
    record = await definitionStore.get(definitionId);
  }
  if (!record) failJson({ error: `definition ${definitionId} could not be created` });
  const latest = record.versions[record.versions.length - 1];
  let version = requestedRevision === undefined
    ? latest
    : record.versions.find((candidate) => candidate.revision === Number(requestedRevision));
  if (!version) {
    if (!ensurePublished || requestedRevision !== undefined) {
      failJson({ error: `published revision ${requestedRevision ?? '(latest)'} was not found for ${definitionId}` });
    }
    const published = await workflowService.publishDraft({
      definitionId,
      expectedDraftRevision: record.draft.draftRevision,
    });
    version = published.version;
  }
  return version;
}

async function evidence(projectId: string, businessEvent: LiveBusinessEvent) {
  const kind = businessEvent.periodKind;
  return withTenantTransaction(enterpriseId, async (tx) => {
    const reports = await one(tx, sql`select count(*)::int as count from app.construction_reports
      where enterprise_id=${enterpriseId} and kind=${kind}
        and period_start=${`${businessEvent.periodStart}T00:00:00+08:00`}::timestamptz`);
    const report = await one(tx, sql`select id,latest_revision,report_key,period_start,period_end
      from app.construction_reports where enterprise_id=${enterpriseId} and kind=${kind}
      and period_start=${`${businessEvent.periodStart}T00:00:00+08:00`}::timestamptz order by id limit 1`);
    const version = report
      ? await one(tx, sql`select revision,run_id,status,body_run_id from app.construction_report_versions
          where enterprise_id=${enterpriseId} and report_id=${String(report.id)}
            and revision=${Number(report.latest_revision)}`)
      : undefined;
    const delivery = report
      ? await one(tx, sql`select state,message_id,delivered_at,revision from app.construction_report_deliveries
          where enterprise_id=${enterpriseId} and report_id=${String(report.id)}
          order by revision desc limit 1`)
      : undefined;
    const jobs = await one(tx, sql`select count(*)::int as count from app.assistant_jobs
      where enterprise_id=${enterpriseId} and status in ('queued','running')`);
    const usage = await one(tx, sql`select count(*)::int as count from app.assistant_usage_records
      where enterprise_id=${enterpriseId}`);
    const attempts = await one(tx, sql`select count(*)::int as count from app.ai_provider_attempts
      where enterprise_id=${enterpriseId}`);
    return {
      periodKind: kind,
      reportCount: Number(reports?.count ?? 0),
      report: report ?? null,
      version: version ?? null,
      delivery: delivery ?? null,
      queuedJobs: Number(jobs?.count ?? 0),
      assistantUsageRecords: Number(usage?.count ?? 0),
      aiProviderAttempts: Number(attempts?.count ?? 0),
      projectId,
    };
  });
}

async function main() {
  if (showRun) {
    const record = await runStore.get(showRun);
    if (!record) failJson({ error: `run ${showRun} was not found` });
    console.log(JSON.stringify({ success: true, run: record }, null, 2));
    return;
  }

  const database = resolveB4DatabaseTarget({ purpose: 'app' });
  process.env.DATABASE_URL = database.url;
  const connected = await withTenantTransaction(enterpriseId, async (tx) => one(
    tx,
    sql`select current_database() as database, current_user as username`,
  ));
  assertB4ConnectionIdentity(database, {
    database: String(connected?.database ?? ''),
    username: String(connected?.username ?? ''),
  });

  const bound = target;
  if (!bound) failJson({ error: 'a period target is required' });

  const version = await resolvePublished(bound.definitionId);
  const actor: ConstructionActor = { enterpriseId, adminId };
  const event: TriggerEvent = {
    eventId: bound.eventId,
    eventType: 'period_report',
    occurredAt,
    periodKind: bound.kind,
    periodStart: bound.periodStart,
    periodEnd: bound.periodEnd,
  };
  const period = parseFixedPeriod(event);
  const businessEvent: LiveBusinessEvent = {
    outboxEventId: null,
    progressRevision: 0,
    stageKey: '',
    settingsVersion: 0,
    source: 'current_project_revision',
    periodKind: period.kind,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
  };

  const ports = createPeriodReportPorts({ actor });
  const record = await runPublishedLive({
    published: version,
    enterpriseId,
    projectId,
    event,
    businessEvent,
    ports,
    store: runStore,
    runId,
  });
  const business = await evidence(projectId, businessEvent);
  console.log(JSON.stringify({
    success: record.status === 'completed',
    runId,
    status: record.status,
    database: describeB4DatabaseTarget(database),
    binding: record.binding,
    businessEvent,
    operations: record.operations.map((operation) => ({
      nodeId: operation.nodeId,
      capabilityRef: operation.capabilityRef,
      effect: operation.effect,
      outcome: operation.outcome,
      error: operation.error ?? null,
    })),
    saveReceipt: receiptOf(record, 'saveReceipt'),
    deliveryReceipt: receiptOf(record, 'deliveryReceipt'),
    error: record.state.error,
    business,
  }, null, 2));
  process.exitCode = record.status === 'completed' ? 0 : 2;
}

main().catch((error) => {
  console.error(JSON.stringify({
    success: false,
    error: error instanceof Error ? error.message : String(error),
  }));
  process.exitCode = 1;
});
