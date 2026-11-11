/** Development-only B5.8 host entry for one four-receiver period report.
 *
 * One call fixes one enterprise, one project, one ended daily/weekly period,
 * one selected published revision and exactly four host-chosen receivers:
 * the project customer (existing customer binding), one worker, one designer
 * and one enterprise boss. Each receiver runs the existing single-receiver
 * entry and ports, so each keeps its own binding/conversation, facts, report,
 * body, delivery and read receipt.
 *
 * The first call creates the B-owned host manifest and the four sub-runs. A
 * repeated `--request-id` only authorizes and observes the existing manifest:
 * it never starts a second round. A new request id for the same period reuses
 * the existing business reports/deliveries without new tasks or model calls.
 *
 * Required environment:
 *   B4_LIVE_APP_DATABASE_URL=postgresql://sfp_app:...@127.0.0.1:55433/smart_floor_planner
 *
 * Usage (from admin/):
 *   npx tsx scripts/native-workflow-period-report-batch.ts --development --ensure-published `
 *     --admin-id 1454000001 --project-id 1454000004 `
 *     --worker-id 1454000008 --designer-id 1454000011 --boss-id 1454000013 `
 *     --period-kind weekly --period-start 2026-10-19 --period-end 2026-10-26 `
 *     --request-id b5-8-joint-20261112
 *   npx tsx scripts/native-workflow-period-report-batch.ts --development --show-batch b5-8-joint-20261112
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { one } from '@/db/repositories/assistant-repository';
import { withTenantTransaction } from '@/db/transaction';
import type { ConstructionActor } from '@/lib/construction/contracts';
import { WorkflowOperationError } from '@/lib/native-workflow/errors';
import {
  createFileWorkflowStore,
  resolveNativeWorkflowStoreDir,
} from '@/lib/native-workflow/store/file-store';
import {
  createWorkflowService,
  type NativeWorkflowTemplateId,
} from '@/lib/native-workflow/service';
import {
  assertB4ConnectionIdentity,
  describeB4DatabaseTarget,
  resolveB4DatabaseTarget,
} from '@/lib/native-workflow/live/dev-config';
import { createFileWorkflowRunStore } from '@/lib/native-workflow/live/run-store';
import {
  createFilePeriodReportBatchStore,
  resolveNativeWorkflowBatchDir,
} from '@/lib/native-workflow/live/period-report-batch-store';
import { createPeriodReportPorts } from '@/lib/native-workflow/live/period-report-ports';
import { runPeriodReportBatch } from '@/lib/native-workflow/live/period-report-batch';
import {
  parseBatchReceiverTargets,
  parsePeriodKindArg,
  PeriodCliError,
  resolveCliPeriod,
  type PeriodCliKind,
} from '@/lib/native-workflow/live/period-cli';
import type { LivePeriodReceiver } from '@/lib/native-workflow/live/types';
import type { TriggerEvent } from '@/lib/native-workflow/types';

loadEnvConfig(process.cwd());

const DEFAULT_ENTERPRISE_ID = '1454';

function failJson(payload: Record<string, unknown>, exitCode = 1): never {
  console.error(JSON.stringify({ success: false, ...payload }, null, 2));
  process.exit(exitCode);
}

function failCli(error: unknown): never {
  if (error instanceof PeriodCliError) failJson({ code: error.code, error: error.message });
  failJson({ error: error instanceof Error ? error.message : String(error) });
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

const showBatch = option('--show-batch');
const executing = !showBatch;
const enterpriseId = positiveId('--enterprise-id', option('--enterprise-id') ?? DEFAULT_ENTERPRISE_ID);
const adminId = executing ? positiveId('--admin-id', required('--admin-id')) : '';
const projectId = executing ? positiveId('--project-id', required('--project-id')) : '';
const requestId = executing
  ? option('--request-id') ?? `native-joint-${Date.now()}-${randomUUID().slice(0, 8)}`
  : '';

// All receiver flags are validated before any database target or connection.
let receivers: LivePeriodReceiver[] = [];
if (executing) {
  try {
    receivers = parseBatchReceiverTargets(process.argv);
  } catch (error) {
    failCli(error);
  }
}

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
      kind: parsePeriodKindArg(process.argv),
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
    failCli(error);
  }
}

const target: CliTarget | null = executing ? resolveTarget() : null;
const occurredAt = target ? option('--occurred-at') ?? `${target.periodStart}T10:00:00.000Z` : '';
const requestedRevision = option('--revision');
const ensurePublished = process.argv.includes('--ensure-published');

const definitionStore = createFileWorkflowStore({ rootDir: resolveNativeWorkflowStoreDir() });
const workflowService = createWorkflowService({ store: definitionStore });
const runStore = createFileWorkflowRunStore({ rootDir: resolveRunDir() });
const batchStore = createFilePeriodReportBatchStore({ rootDir: resolveNativeWorkflowBatchDir() });

async function resolvePublished(definitionId: string, revision?: number) {
  const record = await definitionStore.get(definitionId);
  if (!record) {
    if (!ensurePublished || revision !== undefined) {
      failJson({ error: `definition ${definitionId} was not found; pass --ensure-published` });
    }
    const templateId = definitionId as NativeWorkflowTemplateId;
    await workflowService.createFromTemplate(templateId);
    const created = await definitionStore.get(definitionId);
    if (!created) failJson({ error: `definition ${definitionId} could not be created` });
    const published = await workflowService.publishDraft({
      definitionId,
      expectedDraftRevision: created.draft.draftRevision,
    });
    return published.version;
  }
  if (revision !== undefined) {
    const version = record.versions.find((candidate) => candidate.revision === revision);
    if (!version) {
      failJson({ error: `published revision ${revision} was not found for ${definitionId}` });
    }
    return version;
  }
  const latest = record.versions[record.versions.length - 1];
  if (!latest) {
    if (!ensurePublished) {
      failJson({ error: `definition ${definitionId} has no published revision; pass --ensure-published` });
    }
    const published = await workflowService.publishDraft({
      definitionId,
      expectedDraftRevision: record.draft.draftRevision,
    });
    return published.version;
  }
  return latest;
}

async function main() {
  if (showBatch) {
    const manifest = await batchStore.get(showBatch);
    if (!manifest) failJson({ error: `batch request ${showBatch} was not found` });
    console.log(JSON.stringify({ success: true, manifest }, null, 2));
    return;
  }

  const bound = target;
  if (!bound) failJson({ error: 'a period target is required' });

  // A repeated request resolves exactly the revision frozen in its manifest;
  // a later publish can never mix versions inside the same action.
  const existing = await batchStore.get(requestId);
  const published = existing
    ? await resolvePublished(existing.published.definitionId, existing.published.revision)
    : await resolvePublished(bound.definitionId, requestedRevision === undefined
      ? undefined
      : Number(requestedRevision));
  if (existing && existing.published.digest !== published.digest) {
    failJson({
      code: 'period_report_batch_conflict',
      error: `the recorded published digest for ${requestId} no longer matches its stored revision`,
    });
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

  const actor: ConstructionActor = { enterpriseId, adminId };
  const event: TriggerEvent = {
    eventId: bound.eventId,
    eventType: 'period_report',
    occurredAt,
    periodKind: bound.kind,
    periodStart: bound.periodStart,
    periodEnd: bound.periodEnd,
  };

  let result: Awaited<ReturnType<typeof runPeriodReportBatch>>;
  try {
    result = await runPeriodReportBatch({
      requestId,
      enterpriseId,
      projectId,
      actor,
      event,
      receivers,
      loadPublished: async () => published,
      portsFor: (receiver) => createPeriodReportPorts({ actor, receiver }),
      runStore,
      batchStore,
    });
  } catch (error) {
    if (error instanceof WorkflowOperationError) {
      failJson({
        code: error.code,
        error: error.message,
        ...(error.details && typeof error.details === 'object'
          ? error.details as Record<string, unknown>
          : {}),
      });
    }
    throw error;
  }

  const manifest = result.manifest;
  const complete = manifest.status === 'completed';
  console.log(JSON.stringify({
    success: complete,
    requestId,
    created: result.created,
    observedOnly: result.observedOnly,
    status: manifest.status,
    complete,
    database: describeB4DatabaseTarget(database),
    projectId,
    period: manifest.period,
    published: manifest.published,
    receivers: manifest.receivers,
    plan: result.preflight,
    entries: manifest.entries.map((entry) => ({
      kind: entry.kind,
      adminId: entry.adminId,
      runId: entry.runId,
      executed: entry.executed,
      state: entry.state,
      reason: entry.reason,
      errorCode: entry.errorCode,
      saveReceipt: entry.saveReceipt,
      deliveryReceipt: entry.deliveryReceipt,
      observation: entry.observation,
    })),
    reasons: manifest.reasons,
  }, null, 2));
  process.exitCode = complete ? 0 : manifest.status === 'failed' || manifest.status === 'unknown' ? 1 : 2;
}

main().catch((error) => {
  const code = error instanceof WorkflowOperationError ? error.code : undefined;
  console.error(JSON.stringify({
    success: false,
    ...(code ? { code } : {}),
    error: error instanceof Error ? error.message : String(error),
  }));
  process.exitCode = 1;
});
