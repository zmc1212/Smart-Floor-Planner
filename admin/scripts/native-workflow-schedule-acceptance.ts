/** Bounded B-isolated acceptance for the B5.9 weekly scheduler.
 *
 * It runs the real scheduler against the existing B database, with an explicit
 * enterprise/project/period and the four B5.8 receivers. It reuses the existing
 * published weekly definition, the existing reports/deliveries when the chosen
 * week already has them, and the existing Worker. It never creates a second
 * Worker, queue or model path.
 *
 * The command is single-shot. A repeated run with the same period must not
 * create a report, job, message or delivery. If this is a fresh week, start the
 * existing assistant-worker first and pass `--wait-worker`.
 *
 * Usage (from admin/):
 *   $env:B4_LIVE_APP_DATABASE_URL='postgresql://sfp_app:...@127.0.0.1:55433/smart_floor_planner'
 *   npx tsx scripts/native-workflow-schedule-acceptance.ts --development `
 *     --enterprise-id 1454 --project-id 1454000004 `
 *     --worker-id 1454000008 --designer-id 1454000011 --boss-id 1454000013 `
 *     --customer-user-id 1454000002 --period-start 2026-10-19 --wait-worker
 */
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { one } from '@/db/repositories/assistant-repository';
import { withTenantTransaction } from '@/db/transaction';
import {
  assertB4ConnectionIdentity,
  describeB4DatabaseTarget,
  resolveB4DatabaseTarget,
} from '@/lib/native-workflow/live/dev-config';
import { parseFixedPeriod } from '@/lib/native-workflow/live/period-event';
import { createDatabasePeriodReportScheduleEnvironment } from '@/lib/native-workflow/live/period-report-schedule-ports';
import {
  resolveScheduledPeriod,
  runScheduledPeriodReportDispatch,
} from '@/lib/native-workflow/live/period-report-schedule';
import {
  createFilePeriodReportScheduleStore,
  resolveNativeWorkflowScheduleDir,
} from '@/lib/native-workflow/live/period-report-schedule-store';
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
import type { PublishedWorkflowVersion } from '@/lib/native-workflow/store/types';

loadEnvConfig(process.cwd());

const DEFAULT_ENTERPRISE_ID = '1454';
const DEFAULT_PROJECT_ID = '1454000004';
const DEFAULT_WORKER_ID = '1454000008';
const DEFAULT_DESIGNER_ID = '1454000011';
const DEFAULT_BOSS_ID = '1454000013';
const DEFAULT_CUSTOMER_ID = '1454000002';
const DEFAULT_PERIOD_START = '2026-10-19';

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) {
    console.error(JSON.stringify({ success: false, error: `${name} requires a value` }));
    process.exit(1);
  }
  return value;
}

function id(name: string, fallback: string): string {
  const value = option(name) ?? fallback;
  if (!/^[1-9]\d{0,18}$/.test(value)) {
    console.error(JSON.stringify({ success: false, error: `${name} must be a positive id` }));
    process.exit(1);
  }
  return value;
}

const enterpriseId = id('--enterprise-id', DEFAULT_ENTERPRISE_ID);
const projectId = id('--project-id', DEFAULT_PROJECT_ID);
const workerId = id('--worker-id', DEFAULT_WORKER_ID);
const designerId = id('--designer-id', DEFAULT_DESIGNER_ID);
const bossId = id('--boss-id', DEFAULT_BOSS_ID);
const customerUserId = id('--customer-user-id', DEFAULT_CUSTOMER_ID);
const periodStartArg = option('--period-start') ?? DEFAULT_PERIOD_START;
if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStartArg)) {
  console.error(JSON.stringify({ success: false, error: '--period-start must be YYYY-MM-DD' }));
  process.exit(1);
}
const waitWorker = process.argv.includes('--wait-worker');
const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
const acceptanceId = `b5-9-schedule-${stamp}-${randomUUID().slice(0, 8)}`;
const outputDir = path.resolve(process.cwd(), 'tmp/b5-9-schedule-runs', acceptanceId);

interface Check {
  readonly name: string;
  readonly pass: boolean;
  readonly detail: unknown;
}

const checks: Check[] = [];
function check(name: string, pass: boolean, detail: unknown = null): void {
  checks.push({ name, pass, detail });
}

async function main() {
  const runNow = new Date();
  const database = resolveB4DatabaseTarget({ purpose: 'app' });
  process.env.DATABASE_URL = database.url;
  const connected = await withTenantTransaction(enterpriseId, async (tx) => one(
    tx,
    sql`select current_database() as database,current_user as username`,
  ));
  assertB4ConnectionIdentity(database, {
    database: String(connected?.database ?? ''),
    username: String(connected?.username ?? ''),
  });

  const period = resolveScheduledPeriod(runNow, periodStartArg);
  parseFixedPeriod({
    eventId: `schedule-weekly-${period.periodStart}`,
    eventType: 'period_report',
    occurredAt: period.endAt,
    periodKind: 'weekly',
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
  }, runNow);

  const definitionStore = createFileWorkflowStore({ rootDir: resolveNativeWorkflowStoreDir() });
  const loadPublished = async (): Promise<PublishedWorkflowVersion> => {
    const record = await definitionStore.get('period-report-weekly');
    const latest = record?.versions[record.versions.length - 1];
    if (!latest) {
      throw new Error('period-report-weekly has no published revision; run the B5.8 ensure-published command first');
    }
    return latest;
  };
  const published = await loadPublished();

  const runStore = createFileWorkflowRunStore({ rootDir: resolveNativeWorkflowRunDir() });
  const batchStore = createFilePeriodReportBatchStore({ rootDir: resolveNativeWorkflowBatchDir() });
  const scheduleStore = createFilePeriodReportScheduleStore({
    rootDir: resolveNativeWorkflowScheduleDir(),
  });

  const before = await withTenantTransaction(enterpriseId, async (tx) => one(
    tx,
    sql`select * from app.construction_report_settings where enterprise_id=${enterpriseId}`,
  ));
  if (!before) throw new Error('the enterprise report plan is missing');

  let restoreError: string | null = null;
  try {
    await withTenantTransaction(enterpriseId, async (tx) => {
      await tx.execute(sql`update app.construction_report_settings set
        enabled=true,daily_time=${String(before.daily_time)},weekly_time=${String(before.weekly_time)},
        weekly_day=${Number(before.weekly_day ?? 1)},project_ids=${JSON.stringify([projectId])}::jsonb,
        stage_keys='[]'::jsonb,audiences=${JSON.stringify(
          Array.isArray(before.audiences)
            ? before.audiences
            : ['customer', 'worker', 'designer', 'boss'],
        )}::jsonb,
        stage_enabled=false,next_daily_at='2099-01-01T00:00:00.000Z',
        next_weekly_at='2099-01-01T00:00:00.000Z',version=version+1,updated_at=now()
        where enterprise_id=${enterpriseId}`);
    });

    const environment = createDatabasePeriodReportScheduleEnvironment({
      loadPublished,
      runStore,
      now: () => new Date(),
    });
    const deps = { store: scheduleStore, batchStore, runStore, environment };

    const first = await runScheduledPeriodReportDispatch({
      enterpriseIds: [enterpriseId],
      mode: 'tick',
      periodStart: period.periodStart,
      maxProjectsPerRound: 1,
      observeIntervalMs: 5 * 60_000,
      readObservationIntervalMs: 6 * 3_600_000,
      maxRunDurationMs: 120_000,
      issuedBy: 'b5-9-acceptance',
    }, deps);
    const runId = `schedule-${enterpriseId}-weekly-${period.periodStart}`;
    let run = await scheduleStore.get(runId);
    if (!run) throw new Error(`schedule run ${runId} was not created`);
    let entry = run.projects[projectId];
    check('the scheduler discovered the test project', !!entry, {
      queue: run.queue.map((plan) => plan.projectId),
      excluded: run.audit.find((audit) => audit.action === 'run_created')?.message ?? null,
    });
    check('the scheduler allocated the project request', !!entry?.requestId, entry?.requestId ?? null);
    check('the project dispatch is not a config failure', !!entry && !['failed', 'unknown'].includes(entry.state), {
      state: entry?.state,
      reason: entry?.reason,
    });

    const requestId = entry?.requestId ?? '';
    const manifest = requestId ? await batchStore.get(requestId) : null;
    check('one host batch manifest exists for the project', !!manifest, requestId);
    check('the manifest has exactly the four receivers', manifest?.receivers.length === 4, manifest?.receivers);
    check('the four receivers use distinct reserved sub-runs', new Set(manifest?.receivers.map((receiver) => receiver.runId)).size === 4);

    const receipts = manifest?.entries
      .map((receiverEntry) => ({ kind: receiverEntry.kind, receipt: receiverEntry.saveReceipt }))
      .filter((item) => !!item.receipt) ?? [];
    check('the coordinator saved one report per receiver', receipts.length === 4, receipts.map((item) => item.kind));
    check('the reports are distinct', new Set(receipts.map((item) => item.receipt!.reportId)).size === 4);

    if (waitWorker) {
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        run = (await scheduleStore.get(runId))!;
        entry = run.projects[projectId]!;
        if (entry.state === 'completed' || entry.state === 'partial' || entry.state === 'failed') break;
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
    }

    const business = await withTenantTransaction(enterpriseId, async (tx) => {
      const reports = receipts.length
        ? await tx.execute(sql`select r.id::text as report_id,r.kind,r.period_start,r.period_end,
            v.revision,v.status,v.body is not null as body_present,
            d.state as delivery_state,d.message_id::text as message_id,d.delivered_at,d.read_at
          from app.construction_reports r
          join app.construction_report_versions v on v.enterprise_id=r.enterprise_id and v.report_id=r.id
            and v.revision=r.latest_revision
          join app.construction_report_deliveries d on d.enterprise_id=v.enterprise_id and d.report_id=v.report_id
            and d.revision=v.revision and d.binding_id=r.binding_id
          where r.enterprise_id=${enterpriseId}
            and r.id=any(ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(
              receipts.map((item) => item.receipt!.reportId),
            )}::jsonb))::bigint[])
          order by r.id`)
        : { rows: [] };
      const counters = await one(tx, sql`select
        (select count(*)::int from app.construction_reports where enterprise_id=${enterpriseId}) as reports,
        (select count(*)::int from app.construction_report_deliveries where enterprise_id=${enterpriseId}) as deliveries,
        (select count(*)::int from app.assistant_messages where enterprise_id=${enterpriseId}) as messages,
        (select count(*)::int from app.assistant_jobs where enterprise_id=${enterpriseId}) as jobs`);
      return { reports: reports.rows, counters };
    });
    check('four business reports exist for the four receipts', business.reports.length === 4, business.reports);
    check('every delivery has a message', business.reports.every((row) => !!row.message_id), business.reports);
    check('the project entry is observable', !!entry && ['completed', 'partial', 'processing', 'waiting_delivery'].includes(entry.state), {
      state: entry?.state,
      receivers: entry?.receivers.map((receiver) => ({
        kind: receiver.kind,
        state: receiver.state,
        delivery: receiver.deliveryState,
        readAt: receiver.readAt,
      })),
    });

    const second = await runScheduledPeriodReportDispatch({
      enterpriseIds: [enterpriseId],
      mode: 'tick',
      periodStart: period.periodStart,
      maxProjectsPerRound: 1,
      issuedBy: 'b5-9-acceptance-repeat',
    }, deps);
    const after = await withTenantTransaction(enterpriseId, async (tx) => one(tx, sql`select
      (select count(*)::int from app.construction_reports where enterprise_id=${enterpriseId}) as reports,
      (select count(*)::int from app.construction_report_deliveries where enterprise_id=${enterpriseId}) as deliveries,
      (select count(*)::int from app.assistant_messages where enterprise_id=${enterpriseId}) as messages,
      (select count(*)::int from app.assistant_jobs where enterprise_id=${enterpriseId}) as jobs`));
    check('the repeated scheduler run created no report', Number(after?.reports) === Number(business.counters?.reports), {
      before: business.counters?.reports,
      after: after?.reports,
    });
    check('the repeated scheduler run created no delivery', Number(after?.deliveries) === Number(business.counters?.deliveries));
    check('the repeated scheduler run created no message', Number(after?.messages) === Number(business.counters?.messages));
    check('the repeated scheduler run created no job', Number(after?.jobs) === Number(business.counters?.jobs));

    const verification = {
      success: checks.every((item) => item.pass),
      acceptanceId,
      database: describeB4DatabaseTarget(database),
      definition: `${published.definition.definitionId}@${published.revision}`,
      period,
      enterpriseId,
      projectId,
      receivers: { workerId, designerId, bossId, customerUserId },
      firstRun: first.enterprises[0] ?? null,
      secondRun: second.enterprises[0] ?? null,
      run: await scheduleStore.get(runId),
      manifest,
      checks,
    };
    await mkdir(outputDir, { recursive: true });
    await writeFile(
      path.join(outputDir, 'verification.json'),
      `${JSON.stringify(verification, null, 2)}\n`,
      'utf8',
    );
    console.log(JSON.stringify({
      success: verification.success,
      acceptanceId,
      output: path.join(outputDir, 'verification.json'),
      checks: checks.map((item) => ({ name: item.name, pass: item.pass })),
    }, null, 2));
    process.exitCode = verification.success ? 0 : 1;
  } finally {
    try {
      const audiences = before.audiences === null || before.audiences === undefined
        ? sql`NULL`
        : sql`${JSON.stringify(before.audiences)}::jsonb`;
      await withTenantTransaction(enterpriseId, async (tx) => {
        await tx.execute(sql`update app.construction_report_settings set
          enabled=${before.enabled},daily_time=${String(before.daily_time)},weekly_time=${String(before.weekly_time)},
          weekly_day=${Number(before.weekly_day ?? 1)},project_ids=${JSON.stringify(before.project_ids)}::jsonb,
          stage_keys=${JSON.stringify(before.stage_keys)}::jsonb,
          audiences=${audiences},
          stage_enabled=${before.stage_enabled},next_daily_at=${before.next_daily_at},
          next_weekly_at=${before.next_weekly_at},stage_cursor=${String(before.stage_cursor)},
          dispatch_epoch=${Number(before.dispatch_epoch ?? 1)},version=version+1,updated_at=now()
          where enterprise_id=${enterpriseId}`);
      });
    } catch (error) {
      restoreError = error instanceof Error ? error.message : String(error);
    }
    await mkdir(outputDir, { recursive: true });
    await writeFile(
      path.join(outputDir, 'restore.json'),
      `${JSON.stringify({
        restored: restoreError === null,
        error: restoreError,
      }, null, 2)}\n`,
      'utf8',
    );
    if (restoreError) process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    success: false,
    error: error instanceof Error ? error.message : String(error),
  }));
  process.exitCode = 1;
});
