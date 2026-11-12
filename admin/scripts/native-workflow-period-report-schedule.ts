/** Development/ops entry for the B5.9 weekly scheduler.
 *
 * It is a single-shot command, not a Worker or timer. The existing
 * assistant-worker endpoint calls the same scheduler tick when
 * `NATIVE_WORKFLOW_SCHEDULE_ENABLED=1` and an enterprise allowlist is set.
 *
 * Usage (from admin/):
 *   npx tsx scripts/native-workflow-period-report-schedule.ts --development --ensure-published `
 *     --enterprise-id 1454 --max-projects 1
 *   npx tsx scripts/native-workflow-period-report-schedule.ts --development `
 *     --enterprise-id 1454 --period-start 2026-11-02 --mode tick
 *   npx tsx scripts/native-workflow-period-report-schedule.ts --enterprise-id 1454 --show-latest
 *   npx tsx scripts/native-workflow-period-report-schedule.ts --enterprise-id 1454 --pause --reason "manual hold"
 *   npx tsx scripts/native-workflow-period-report-schedule.ts --enterprise-id 1454 --resume
 *   npx tsx scripts/native-workflow-period-report-schedule.ts --enterprise-id 1454 --cancel --period-start 2026-11-02
 */
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { one } from '@/db/repositories/assistant-repository';
import { withTenantTransaction } from '@/db/transaction';
import {
  assertB4ConnectionIdentity,
  describeB4DatabaseTarget,
  resolveB4DatabaseTarget,
} from '@/lib/native-workflow/live/dev-config';
import {
  createDatabasePeriodReportScheduleEnvironment,
} from '@/lib/native-workflow/live/period-report-schedule-ports';
import {
  cancelScheduledPeriodReport,
  readScheduledPeriodReportDispatch,
  resolveScheduledPeriod,
  runScheduledPeriodReportDispatch,
  setScheduledPeriodReportPaused,
} from '@/lib/native-workflow/live/period-report-schedule';
import {
  createFilePeriodReportScheduleStore,
  resolveNativeWorkflowScheduleDir,
} from '@/lib/native-workflow/live/period-report-schedule-store';
import { scheduleRunId, scheduleEventId } from '@/lib/native-workflow/live/period-report-schedule-types';
import { parseFixedPeriod } from '@/lib/native-workflow/live/period-event';
import {
  createFilePeriodReportBatchStore,
  resolveNativeWorkflowBatchDir,
} from '@/lib/native-workflow/live/period-report-batch-store';
import { createFileWorkflowRunStore } from '@/lib/native-workflow/live/run-store';
import { resolveNativeWorkflowRunDir } from '@/lib/native-workflow/live/run-dir';
import {
  createFileWorkflowStore,
  resolveNativeWorkflowStoreDir,
} from '@/lib/native-workflow/store/file-store';
import {
  createWorkflowService,
  type NativeWorkflowTemplateId,
} from '@/lib/native-workflow/service';
import type { PublishedWorkflowVersion } from '@/lib/native-workflow/store/types';
import { WorkflowOperationError } from '@/lib/native-workflow/errors';

loadEnvConfig(process.cwd());

const DEFAULT_ENTERPRISE_ID = '1454';
const DEFAULT_DEFINITION_ID = 'period-report-weekly';

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

function positiveId(name: string, value: string): string {
  if (!/^[1-9]\d{0,18}$/.test(value)) failJson({ error: `${name} must be a positive integer id` });
  return value;
}

function positiveInteger(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!/^[1-9]\d{0,3}$/.test(value)) failJson({ error: `${name} must be a positive integer` });
  return Number(value);
}

const enterpriseId = positiveId(
  '--enterprise-id',
  option('--enterprise-id') ?? DEFAULT_ENTERPRISE_ID,
);
const periodStart = option('--period-start');
if (periodStart !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(periodStart)) {
  failJson({ error: '--period-start must be YYYY-MM-DD' });
}
const mode = option('--mode') ?? 'tick';
if (!['tick', 'observe'].includes(mode)) {
  failJson({ error: '--mode must be tick or observe' });
}
const maxProjects = positiveInteger('--max-projects', option('--max-projects'), 5);
const definitionId = option('--definition-id') ?? DEFAULT_DEFINITION_ID;
const revision = option('--revision');
if (revision !== undefined && !/^[1-9]\d{0,8}$/.test(revision)) {
  failJson({ error: '--revision must be a positive integer' });
}
const ensurePublished = process.argv.includes('--ensure-published');
const showRun = option('--show-run');
const showLatest = process.argv.includes('--show-latest');
const listRuns = process.argv.includes('--list');
const pause = process.argv.includes('--pause');
const resume = process.argv.includes('--resume');
const cancel = process.argv.includes('--cancel');
const reason = option('--reason') ?? null;

const definitionStore = createFileWorkflowStore({ rootDir: resolveNativeWorkflowStoreDir() });
const workflowService = createWorkflowService({ store: definitionStore });
const runStore = createFileWorkflowRunStore({ rootDir: resolveNativeWorkflowRunDir() });
const batchStore = createFilePeriodReportBatchStore({ rootDir: resolveNativeWorkflowBatchDir() });
const scheduleStore = createFilePeriodReportScheduleStore({
  rootDir: resolveNativeWorkflowScheduleDir(),
});

async function loadPublished(input?: {
  readonly definitionId: string;
  readonly revision: number;
}): Promise<PublishedWorkflowVersion> {
  const id = input?.definitionId ?? definitionId;
  const record = await definitionStore.get(id);
  if (!record) {
    failJson({ error: `definition ${id} was not found; pass --ensure-published` });
  }
  const wanted = input?.revision ?? (revision === undefined ? undefined : Number(revision));
  if (wanted !== undefined) {
    const version = record.versions.find((candidate) => candidate.revision === wanted);
    if (!version) failJson({ error: `published revision ${wanted} was not found for ${id}` });
    return version;
  }
  const latest = record.versions[record.versions.length - 1];
  if (!latest) {
    if (!ensurePublished) {
      failJson({ error: `definition ${id} has no published revision; pass --ensure-published` });
    }
    const published = await workflowService.publishDraft({
      definitionId: id,
      expectedDraftRevision: record.draft.draftRevision,
    });
    return published.version;
  }
  return latest;
}

async function ensureTemplatePublished(): Promise<void> {
  const record = await definitionStore.get(definitionId);
  if (record?.versions.length) return;
  if (!record) {
    const templateId = definitionId as NativeWorkflowTemplateId;
    await workflowService.createFromTemplate(templateId);
    const created = await definitionStore.get(definitionId);
    if (!created) failJson({ error: `definition ${definitionId} could not be created` });
    await workflowService.publishDraft({
      definitionId,
      expectedDraftRevision: created.draft.draftRevision,
    });
    return;
  }
  await workflowService.publishDraft({
    definitionId,
    expectedDraftRevision: record.draft.draftRevision,
  });
}

async function main(): Promise<void> {
  if (showRun || showLatest || listRuns) {
    if (listRuns) {
      const runs = await scheduleStore.list({ enterpriseId, limit: 20 });
      console.log(JSON.stringify({ success: true, enterpriseId, runs }, null, 2));
      return;
    }
    const result = await readScheduledPeriodReportDispatch({
      enterpriseId,
      store: scheduleStore,
      ...(showRun ? { runId: showRun } : {}),
      ...(periodStart && !showRun ? { periodStart } : {}),
    });
    console.log(JSON.stringify({ success: true, ...result }, null, 2));
    return;
  }

  if (pause || resume || cancel) {
    if (cancel) {
      const cancelledPeriod = periodStart
        ?? resolveScheduledPeriod(new Date()).periodStart;
      const result = await cancelScheduledPeriodReport({
        enterpriseId,
        periodStart: cancelledPeriod,
        updatedBy: 'cli',
        reason,
        store: scheduleStore,
      });
      console.log(JSON.stringify({ success: true, periodStart: cancelledPeriod, ...result }, null, 2));
      return;
    }
    const control = await setScheduledPeriodReportPaused({
      enterpriseId,
      paused: pause && !resume,
      updatedBy: 'cli',
      reason,
      store: scheduleStore,
    });
    console.log(JSON.stringify({ success: true, control }, null, 2));
    return;
  }

  // A repeated run resolves exactly the revision frozen in its schedule record.
  const runNow = new Date();
  const runPeriod = resolveScheduledPeriod(runNow, periodStart);
  // Reject a future/unended week before publishing, resolving the database
  // target or opening any connection. This is the same trusted-clock rule as
  // the batch entry.
  parseFixedPeriod({
    eventId: scheduleEventId(runPeriod.periodStart),
    eventType: 'period_report',
    occurredAt: runPeriod.endAt,
    periodKind: 'weekly',
    periodStart: runPeriod.periodStart,
    periodEnd: runPeriod.periodEnd,
  }, runNow);
  if (ensurePublished) await ensureTemplatePublished();
  const existingRun = await scheduleStore.get(
    scheduleRunId(enterpriseId, runPeriod.periodStart),
  );
  const frozen = existingRun?.published ?? null;
  const published = frozen
    ? await loadPublished(frozen)
    : await loadPublished();

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

  const environment = createDatabasePeriodReportScheduleEnvironment({
    loadPublished: async (input) => input ? loadPublished(input) : published,
    runStore,
    now: () => runNow,
  });

  let summary: Awaited<ReturnType<typeof runScheduledPeriodReportDispatch>>;
  try {
    summary = await runScheduledPeriodReportDispatch({
      enterpriseIds: [enterpriseId],
      mode: mode as 'tick' | 'observe',
      ...(periodStart ? { periodStart } : {}),
      maxProjectsPerRound: maxProjects,
      issuedBy: 'cli',
    }, {
      store: scheduleStore,
      batchStore,
      runStore,
      environment,
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

  const enterprise = summary.enterprises[0];
  const complete = summary.enabled
    && enterprise
    && !enterprise.busy
    && (enterprise.status === 'completed' || enterprise.status === 'observing');
  console.log(JSON.stringify({
    success: Boolean(complete),
    database: describeB4DatabaseTarget(database),
    definition: published.definition.definitionId,
    revision: published.revision,
    ...summary,
  }, null, 2));
  // A configured-time wait (`gate.due === false` without a reason) is a
  // normal no-op; a blocked plan/schedule is a real failure.
  process.exitCode = !summary.enabled || enterprise?.busy
    ? 2
    : enterprise?.gate?.reason || enterprise?.status === 'failed'
      ? 1
      : enterprise?.status === 'partial' || enterprise?.status === 'dispatching'
        ? 2
        : 0;
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
