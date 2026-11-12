import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { sql } from 'drizzle-orm';
import { one, rows } from '@/db/repositories/assistant-repository';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { getPostgresPool } from '@/lib/postgresql';
import { createPostgresDurableTaskStore } from '@/lib/native-workflow/live/durable-task-postgres-store';
import { resolveNativeWorkflowTaskDir } from '@/lib/native-workflow/live/durable-task-store';
import { resolveNativeWorkflowBatchDir } from '@/lib/native-workflow/live/period-report-batch-store';
import { resolveNativeWorkflowScheduleDir } from '@/lib/native-workflow/live/period-report-schedule-store';
import { resolveNativeWorkflowRunDir } from '@/lib/native-workflow/live/run-dir';
import {
  insertCheckpoint, listCheckpoints, storedState,
} from '@/lib/native-workflow/live/runtime-postgres-repository';
import {
  captureSnapshot, checksum, runtimeKinds, validateSnapshot, type MigrationScope,
  type Snapshot, type SnapshotRecord,
} from './native-workflow-runtime-snapshot';

const operations = ['dry-run', 'validate', 'export', 'import', 'verify', 'cutover', 'rollback'] as const;
const isolatedDatabase = 'xiaok_b511_test';
const isolatedRole = 'sfp_app';

type CutoverReceipt = {
  readonly version: 1;
  readonly enterpriseId: string;
  readonly scope: MigrationScope;
  readonly database: string;
  readonly snapshotSha256: string;
  readonly revisionsSha256: string;
  readonly businessSha256: string;
  readonly recordedAt: string;
  readonly sha256: string;
};

function required(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function isolatedUrl(): string {
  required(process.env.NODE_ENV !== 'production', 'runtime migration is limited to an isolated development database');
  const target = process.env.B511_RUNTIME_MIGRATION_DATABASE_URL;
  required(target, 'B511_RUNTIME_MIGRATION_DATABASE_URL is required');
  const url = new URL(target);
  required(url.protocol === 'postgresql:' && url.hostname === '127.0.0.1'
    && Number(url.port) >= 1024 && url.pathname === '/' + isolatedDatabase && url.username === isolatedRole
    && !url.search && !url.hash, 'runtime migration database is outside the isolated target');
  return url.toString();
}

async function verifyConnection(tx: PostgresTransaction, enterpriseId: string) {
  const identity = await one(tx, sql`select current_database() as db, current_user as role,
    (select rolsuper or rolbypassrls from pg_roles where rolname=current_user) as bypass,
    app.current_enterprise_id()::text as tenant`);
  required(identity?.db === isolatedDatabase && identity.role === isolatedRole
    && identity.bypass === false && identity.tenant === enterpriseId, 'database or tenant identity mismatch');
  required(await one(tx, sql`select id from app.enterprises where id=${enterpriseId}`), 'enterprise is missing');
}

async function readDestination(tx: PostgresTransaction, enterpriseId: string, scope: MigrationScope) {
  if (scope === 'runtime') {
    const result = [];
    for (const kind of runtimeKinds) {
      const records = await listCheckpoints(tx, kind, enterpriseId);
      result.push(...records.map((row) => ({ kind, ...row })));
    }
    return result;
  }
  const records = await rows<{ id: string; revision: number; state: unknown }>(tx, sql`
    select id,revision,state from app.native_workflow_durable_tasks where enterprise_id=${enterpriseId} order by id`);
  return records.map((row) => ({ kind: 'task', ...row }));
}

function verifyDestination(
  destination: Awaited<ReturnType<typeof readDestination>>, records: SnapshotRecord[],
) {
  const lookup = new Map(destination.map((row) => [row.kind + '/' + row.id, row]));
  required(destination.length === records.length, 'destination record count differs from the source snapshot');
  for (const record of records) {
    const { state } = record;
    const clean = { ...storedState(state) };
    if ('lease' in clean) delete (clean as { lease?: unknown }).lease;
    const saved = lookup.get(record.kind + '/' + record.id);
    required(saved && checksum(saved.state) === checksum(clean), 'destination differs for ' + record.kind + '/' + record.id);
  }
  const revisions = destination.map((row) => row.kind + '/' + row.id + ':' + row.revision).sort();
  return checksum(revisions);
}

async function validateProjectScope(tx: PostgresTransaction, enterpriseId: string, records: SnapshotRecord[]) {
  const projects = new Set<string>();
  for (const { kind, state } of records) {
    if ('projectId' in state && state.projectId) projects.add(state.projectId);
    if (kind === 'schedule') {
      for (const project of state.queue) projects.add(project.projectId);
      for (const id of Object.keys(state.projects)) projects.add(id);
    }
  }
  required([...projects].every((id) => /^[1-9]\d{0,18}$/.test(id)), 'invalid project identity');
  if (!projects.size) return;
  const ids = sql.join([...projects].map((id) => sql`${id}::bigint`), sql`,`);
  const matching = await rows(tx, sql`select id from app.construction_projects where enterprise_id=${enterpriseId}
    and id in (${ids})`);
  required(matching.length === projects.size, 'source references a missing or out-of-scope project');
}

async function validateHistoricalReceipts(tx: PostgresTransaction, enterpriseId: string, records: SnapshotRecord[]) {
  for (const record of records) {
    if (record.kind !== 'batch') continue;
    for (const entry of record.state.entries) {
      const save = entry.saveReceipt;
      if (save) {
        const report = await one(tx, sql`select r.id from app.construction_reports r
          join app.construction_report_versions v on v.enterprise_id=r.enterprise_id and v.report_id=r.id
          where r.enterprise_id=${enterpriseId} and r.id::text=${save.reportId} and r.report_key=${save.reportKey}
            and r.binding_id::text=${save.bindingId} and v.revision=${save.revision} and v.run_id::text=${save.runId}`);
        required(report, 'historical report receipt cannot be verified for ' + entry.runId);
      }
      const delivery = entry.deliveryReceipt;
      if (delivery?.delivered) {
        const message = await one(tx, sql`select id from app.assistant_messages
          where enterprise_id=${enterpriseId} and id::text=${delivery.messageId}
            and conversation_id::text=${delivery.conversationId}`);
        required(message, 'historical delivery receipt cannot be verified for ' + entry.runId);
      }
    }
  }
}

async function importRecords(tx: PostgresTransaction, enterpriseId: string, records: SnapshotRecord[]) {
  const tasks = createPostgresDurableTaskStore({ tx, enterpriseId });
  for (const record of records) {
    if (record.kind === 'task') {
      await tasks.create(record.state);
    } else {
      await insertCheckpoint(tx, record.kind, record.id, record.state,
        record.kind === 'schedule' ? record.state.period.periodStart : undefined);
    }
  }
}

async function assertDestinationIdle(tx: PostgresTransaction, enterpriseId: string, scope: MigrationScope) {
  const leases = scope === 'tasks'
    ? sql`select id from app.native_workflow_durable_tasks where enterprise_id=${enterpriseId} and lease_until>clock_timestamp()`
    : sql`select id from app.native_workflow_schedule_runs where enterprise_id=${enterpriseId} and lease_until>clock_timestamp()
      union all select id from app.native_workflow_report_batches where enterprise_id=${enterpriseId} and lease_until>clock_timestamp()`;
  required(!await one(tx, sql`select id from (${leases}) owned limit 1`), 'database still has an active runtime lease');
}

/** Compare authoritative business rows too. A write may commit just before
 * a runtime checkpoint or acknowledgement is lost. */
async function businessWatermark(tx: PostgresTransaction, enterpriseId: string, scope: MigrationScope) {
  const state = scope === 'runtime'
    ? await one(tx, sql`select
      (select to_jsonb(s) from app.construction_report_settings s where s.enterprise_id=${enterpriseId}) as settings,
      (select jsonb_agg(to_jsonb(r) order by r.id) from app.construction_reports r where r.enterprise_id=${enterpriseId}) as reports,
      (select jsonb_agg(to_jsonb(v)-'facts' order by v.report_id,v.revision) from app.construction_report_versions v
        where v.enterprise_id=${enterpriseId}) as versions,
      (select jsonb_agg(to_jsonb(d) order by d.report_id,d.revision,d.binding_id) from app.construction_report_deliveries d
        where d.enterprise_id=${enterpriseId}) as deliveries,
      (select jsonb_agg(jsonb_build_array(j.id,j.status,j.attempts,j.updated_at) order by j.id)
        from app.assistant_jobs j join app.construction_report_versions v
          on v.enterprise_id=j.enterprise_id and v.run_id=j.run_id where j.enterprise_id=${enterpriseId}) as jobs,
      (select jsonb_agg(e.id order by e.id) from app.domain_event_outbox e where e.enterprise_id=${enterpriseId}
        and e.type in ('native.workflow.weekly.claimed.v1','construction.report.followup.v1')) as outbox`)
    : await one(tx, sql`select
      (select jsonb_agg(jsonb_build_array(d.id,d.state,d.updated_at) order by d.id)
        from app.native_workflow_delegations d where d.enterprise_id=${enterpriseId}) as delegations,
      (select jsonb_agg(jsonb_build_array(e.id,e.type) order by e.id) from app.domain_event_outbox e
        where e.enterprise_id=${enterpriseId} and e.aggregate_type='native_workflow_delegation') as outbox,
      (select jsonb_agg(jsonb_build_array(d.id,d.status,d.attempts) order by d.id) from app.domain_event_deliveries d
        where d.enterprise_id=${enterpriseId} and d.consumer_key='native.tool.result.v1') as callbacks`);
  return checksum(state);
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      scope: { type: 'string' }, 'enterprise-id': { type: 'string' }, snapshot: { type: 'string' },
      receipt: { type: 'string' }, 'writers-stopped': { type: 'boolean' },
      'run-dir': { type: 'string' }, 'batch-dir': { type: 'string' },
      'schedule-dir': { type: 'string' }, 'task-dir': { type: 'string' },
    },
  });
  const operation = operations.find((candidate) => candidate === positionals[0]);
  const enterpriseId = values['enterprise-id'];
  const scope = values.scope;
  required(operation && positionals.length === 1 && enterpriseId && /^[1-9]\d{0,18}$/.test(enterpriseId)
    && (scope === 'runtime' || scope === 'tasks'), 'specify one operation, --enterprise-id and --scope runtime|tasks');
  const capture = () => captureSnapshot(enterpriseId, scope, {
    run: values['run-dir'] ?? resolveNativeWorkflowRunDir(),
    batch: values['batch-dir'] ?? resolveNativeWorkflowBatchDir(),
    schedule: values['schedule-dir'] ?? resolveNativeWorkflowScheduleDir(),
    task: values['task-dir'] ?? resolveNativeWorkflowTaskDir(),
  });
  const snapshotFile = values.snapshot;
  const sourceOnly = operation === 'dry-run' || operation === 'export' || (operation === 'validate' && !snapshotFile);
  required(sourceOnly || snapshotFile, '--snapshot is required');
  const snapshot = sourceOnly ? await capture() : JSON.parse(await readFile(snapshotFile!, 'utf8')) as Snapshot;
  required(snapshot.scope === scope && snapshot.enterpriseId === enterpriseId, 'snapshot tenant or scope mismatch');
  const { records, leases } = validateSnapshot(snapshot);
  const summary = {
    operation, enterpriseId, scope, records: records.length, files: snapshot.files.length,
    activeLeases: leases.filter((lease) => lease.expiresAt > Date.now()).length, snapshotSha256: snapshot.sha256,
  };
  if (operation === 'export') {
    required(snapshotFile, '--snapshot is required for export');
    await writeFile(snapshotFile, JSON.stringify(snapshot, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  }
  if (operation === 'dry-run' || operation === 'validate' || operation === 'export') {
    console.log(JSON.stringify(summary));
    return;
  }

  const maintenance = operation === 'import' || operation === 'cutover' || operation === 'rollback';
  if (maintenance) {
    required(values['writers-stopped'], 'stop all source and destination writers before maintenance operations');
    required(summary.activeLeases === 0, 'source snapshot still has an active execution lease');
    required((await capture()).sha256 === snapshot.sha256, 'source files changed since export');
  }
  const receiptFile = values.receipt;
  if (operation === 'cutover' || operation === 'rollback') required(receiptFile, '--receipt is required');
  const rollback = operation === 'rollback' ? JSON.parse(await readFile(receiptFile!, 'utf8')) as CutoverReceipt : null;

  process.env.DATABASE_URL = isolatedUrl();
  try {
    const verified = await withTenantTransaction(enterpriseId, async (tx) => {
      await verifyConnection(tx, enterpriseId);
      // Serialize migration operators for this tenant. Writers are stopped
      // independently before entering maintenance.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'native.workflow.migrate:' + enterpriseId},0))`);
      if (maintenance) await assertDestinationIdle(tx, enterpriseId, scope);
      await validateProjectScope(tx, enterpriseId, records);
      await validateHistoricalReceipts(tx, enterpriseId, records);
      if (operation === 'import') await importRecords(tx, enterpriseId, records);
      const revisionsSha256 = verifyDestination(await readDestination(tx, enterpriseId, scope), records);
      const businessSha256 = operation === 'cutover' || rollback
        ? await businessWatermark(tx, enterpriseId, scope) : undefined;
      if (rollback) {
        const { sha256, ...body } = rollback;
        required(sha256 === checksum(body) && body.version === 1 && body.enterpriseId === enterpriseId
          && body.scope === scope && body.database === isolatedDatabase && body.snapshotSha256 === snapshot.sha256,
        'cutover receipt mismatch');
        required(body.revisionsSha256 === revisionsSha256 && body.businessSha256 === businessSha256,
          'database changed after cutover. Reconcile new runtime and business writes before returning to files');
      }
      return { revisionsSha256, businessSha256 };
    });
    if (operation === 'cutover') {
      const body = { version: 1, enterpriseId, scope, database: isolatedDatabase,
        snapshotSha256: snapshot.sha256, ...verified, recordedAt: new Date().toISOString() };
      await writeFile(receiptFile!, JSON.stringify({ ...body, sha256: checksum(body) }, null, 2) + '\n',
        { flag: 'wx', mode: 0o600 });
    }
    console.log(JSON.stringify({
      ...summary, ...verified,
      ...(operation === 'cutover' ? { adapterAfterRestart: 'postgres' } : {}),
      ...(operation === 'rollback' ? { adapterAfterRestart: 'file' } : {}),
    }));
  } finally {
    await getPostgresPool().end();
  }
}

main().catch((error: unknown) => {
  // Drizzle errors can carry complete row payloads in their SQL parameters.
  const message = error instanceof Error && !('query' in error)
    ? error.message.replace(/postgres(?:ql)?:\/\/[^\s]+/g, '[database URL]') : 'runtime migration database operation failed';
  console.error(JSON.stringify({ success: false, error: message }));
  process.exitCode = 1;
});
