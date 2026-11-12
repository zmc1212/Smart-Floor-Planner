import assert from 'node:assert/strict';
import { after, before, test, type TestContext } from 'node:test';
import { appendFile, mkdir, mkdtemp, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows } from '@/db/repositories/assistant-repository';
import { cancelRuns } from '@/lib/assistant/core/conversation';
import type { ActorContext } from '@/lib/assistant/contracts';
import { closePostgresPool } from '@/lib/postgresql';
import { createWorkflowService } from '../service';
import { createFileWorkflowStore } from '../store/file-store';
import { createFilePeriodReportScheduleStore } from '../live/period-report-schedule-store';
import { createDurableToolExecutor, type DurableToolPort } from '../live/durable-tool-execution';
import { createDurableTaskRuntime } from '../live/durable-task-runtime';
import { createFileDurableTaskStore } from '../live/durable-task-store';
import { readWeeklyScheduleSettings } from '../live/period-report-schedule-ports';
import { resolveEndedShanghaiWeek, setScheduledPeriodReportPaused,
  type ScheduledPeriodReportDispatchSummary } from '../live/period-report-schedule';
import { scheduleRunId } from '../live/period-report-schedule-types';
import { b510Process } from './support/b510-controller';

const live = process.env.B59_LIVE_DEVELOPMENT === '1';
const tenant = '1454', control = '1455';
const claimType = 'native.workflow.weekly.claimed.v1';
let lockPool: Pool;

before(async () => {
  if (!live) return;
  assert.notEqual(process.env.NODE_ENV, 'production');
  const url = new URL(process.env.DATABASE_URL ?? '');
  assert.deepEqual([url.protocol, url.host, url.pathname, url.username, url.search, url.hash],
    ['postgresql:', '127.0.0.1:55433', '/xiaok_b59_test', 'sfp_app', '', '']);
  lockPool = new Pool({ connectionString: url.toString(), max: 1 });
  const client = await lockPool.connect();
  try {
    const { rows: [state] } = await client.query("select pg_try_advisory_lock(hashtext('b59_native_workflow_acceptance')) as held");
    assert.equal(state.held, true, 'B5.9 acceptance database is already in use');
  } finally {
    client.release();
  }
  await withPlatformTransaction(async tx => {
    assert.deepEqual(await one(tx, sql`select current_database() as db,current_user as role,rolsuper,rolbypassrls
      from pg_roles where rolname=current_user`), { db: 'xiaok_b59_test', role: 'sfp_app', rolsuper: false, rolbypassrls: false });
    const found = await rows(tx, sql`select code from app.enterprises where id in (1454,1455) order by id`);
    assert.deepEqual(found.map(row => row.code), ['xiaok-b59-1454', 'xiaok-b59-1455']);
    assert.equal((await one(tx, sql`select count(*)::int as active from app.assistant_jobs where status in ('queued','running')`))?.active, 0);
  });
});
after(async () => {
  await lockPool?.end();
  await closePostgresPool();
});

async function rootDir(t: TestContext) {
  await mkdir('tmp', { recursive: true });
  const root = await mkdtemp(join('tmp', 'b510-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function scheduleFixture(t: TestContext, at: Date, enterprises: string[]) {
  const period = resolveEndedShanghaiWeek(at), root = await rootDir(t);
  const definitions = createWorkflowService({ store: createFileWorkflowStore({ rootDir: join(root, 'definitions') }) });
  await definitions.createFromTemplate('period-report-weekly');
  await definitions.publishDraft({ definitionId: 'period-report-weekly', expectedDraftRevision: 1 });
  const start = new Date(period.endAt);
  const startedAt = await withPlatformTransaction(tx => one(tx, sql`select clock_timestamp() as at`));
  const owned: string[] = [];
  t.after(async () => {
    for (const eid of owned) {
      await withTenantTransaction(eid, async tx => {
        const runs = await rows(tx, sql`select r.id::text,r.conversation_id::text,r.policy_snapshot
          from app.assistant_runs r join app.construction_report_versions v on v.enterprise_id=r.enterprise_id and v.run_id=r.id
          join app.construction_reports p on p.enterprise_id=v.enterprise_id and p.id=v.report_id
          where r.enterprise_id=${eid} and r.created_at>=${startedAt?.at as Date} and r.status in ('queued','running')
          and r.purpose='construction.report.facts' and p.kind='weekly' and p.period_start between ${new Date(period.startAt)} and ${start}`);
        for (const r of runs) await cancelRuns(tx, (r.policy_snapshot as { actor: ActorContext }).actor, String(r.conversation_id), String(r.id));
        if (runs.length) console.log('B5.10 cleanup cancelled test report runs', JSON.stringify(runs.map(r => r.id)));
        await tx.execute(sql`delete from app.domain_event_outbox where enterprise_id=${eid}
          and type=${claimType} and aggregate_type='construction_report_settings' and aggregate_id=${period.periodStart}`);
        await tx.execute(sql`delete from app.construction_report_settings where enterprise_id=${eid} and next_daily_at='2099-01-01'`);
      });
    }
  });
  for (const eid of enterprises) {
    await withTenantTransaction(eid, async tx => {
      assert.equal(await one(tx, sql`select id from app.domain_event_outbox where enterprise_id=${eid}
        and type=${claimType} and aggregate_type='construction_report_settings' and aggregate_id=${period.periodStart}`), undefined);
      const saved = await one(tx, sql`insert into app.construction_report_settings
        (enterprise_id,enabled,stage_enabled,weekly_day,weekly_time,next_daily_at,next_weekly_at)
        values(${eid},true,false,1,'00:00','2099-01-01',${start}) on conflict do nothing returning enterprise_id`);
      assert.ok(saved, 'Refusing to replace existing report settings for ' + eid);
    });
    owned.push(eid);
  }
  const store = createFilePeriodReportScheduleStore({ rootDir: join(root, 'schedule') });
  const read = (eid: string) => store.get(scheduleRunId(eid, period.periodStart));
  const schedule = (ids = enterprises.join(','), fault?: string) =>
    b510Process<ScheduledPeriodReportDispatchSummary>(t, ['schedule', root, ids, at.toISOString(), fault ?? '']);
  const receipts = (eid: string) => withTenantTransaction(eid, tx => rows(tx, sql`select enterprise_id::text,id::text from app.domain_event_outbox
    where enterprise_id=${eid} and type=${claimType} and aggregate_id=${period.periodStart}`));
  return { root, start, period, store, read, schedule, receipts };
}

test('weekly ownership survives forced process termination after PostgreSQL commit and before run creation', { skip: !live, timeout: 120000 }, async t => {
  const f = await scheduleFixture(t, new Date('2026-08-10T01:00:00Z'), [tenant, control]);
  const interrupted = f.schedule(tenant, 'kill');
  assert.deepEqual(await interrupted.first, { checkpoint: 'database_claim_committed' });
  const nextAt = (await readWeeklyScheduleSettings({ enterpriseId: tenant }))?.nextWeeklyAt;
  assert.notEqual(nextAt, f.start.toISOString(), 'PostgreSQL advanced the slot before the kill');
  assert.equal(await f.read(tenant), null);
  await interrupted.kill();

  const results = await Promise.all([f.schedule().result(), f.schedule(control).result()]);
  console.log('B5.10 crash and cross-tenant summaries', JSON.stringify(results.map(result =>
    result.enterprises.map(item => ({ id: item.enterpriseId, state: item.status, gate: item.gate, error: item.error?.code })))));
  for (const eid of [tenant, control]) {
    const record = await f.read(eid);
    assert.ok(record?.weeklyClaim, 'Fresh process must recover the committed weekly slot for ' + eid);
    assert.equal(record.enterpriseId, eid);
    assert.equal(record.weeklyClaim.previousNextWeeklyAt, f.start.toISOString());
    assert.equal((await f.receipts(eid)).length, 1);
  }
  assert.equal((await readWeeklyScheduleSettings({ enterpriseId: tenant }))?.nextWeeklyAt, nextAt);
});

test('a real file write failure after the weekly claim leaves a recoverable database receipt', { skip: !live, timeout: 120000 }, async t => {
  const f = await scheduleFixture(t, new Date('2026-08-17T01:00:00Z'), [tenant, control]);
  const failed = await f.schedule([tenant, control].join(','), 'file').result();
  assert.equal(failed.enterprises[0]?.status, 'failed');
  assert.ok((await f.read(control))?.weeklyClaim, 'The healthy tenant in the same tick still records its run');
  const nextAt = (await readWeeklyScheduleSettings({ enterpriseId: tenant }))?.nextWeeklyAt;
  assert.notEqual(nextAt, f.start.toISOString());
  await rmdir(join(f.root, 'schedule', 'runs', scheduleRunId(tenant, f.period.periodStart) + '.json'));
  assert.equal(await f.read(tenant), null);
  await f.schedule().result();
  assert.ok((await f.read(tenant))?.weeklyClaim, 'Run is reconstructed after fixing the directory');
  assert.equal((await f.receipts(tenant)).length, 1);
  assert.equal((await readWeeklyScheduleSettings({ enterpriseId: tenant }))?.nextWeeklyAt, nextAt);
});

test('native weekly pause reserves the slot against an independent legacy Worker', { skip: !live, timeout: 120000 }, async t => {
  const at = new Date('2026-08-24T01:00:00Z');
  const f = await scheduleFixture(t, at, [tenant, control]);
  await setScheduledPeriodReportPaused({ enterpriseId: tenant, paused: true, store: f.store, updatedBy: null, reason: null });
  const ids = [tenant, ...Array.from({ length: 19 }, (_, index) => String(9800 + index)), control];
  const env = { NATIVE_WORKFLOW_SCHEDULE_ENABLED: '1', NATIVE_WORKFLOW_SCHEDULE_ENTERPRISE_IDS: ids.join(',') };
  const legacy = (eid: string, enabled = '1') =>
    b510Process<{ errors: unknown[] }>(t, ['legacy', f.root, eid, at.toISOString()], {
      ...env, NATIVE_WORKFLOW_SCHEDULE_ENABLED: enabled,
    }).result();
  await Promise.all([f.schedule(tenant).result(), legacy(tenant), legacy(control)]);
  assert.equal(await f.read(tenant), null);
  assert.equal((await readWeeklyScheduleSettings({ enterpriseId: tenant }))?.nextWeeklyAt, f.start.toISOString(),
    'Legacy Worker must not consume a paused native weekly slot');
  assert.notEqual((await readWeeklyScheduleSettings({ enterpriseId: control }))?.nextWeeklyAt, f.start.toISOString(),
    'The tenant outside the 20 Native slots keeps its legacy weekly cadence');
  assert.deepEqual((await legacy(tenant, '0')).errors, []);
  assert.equal((await readWeeklyScheduleSettings({ enterpriseId: tenant }))?.nextWeeklyAt, f.start.toISOString(),
    'Stopping native dispatch must not implicitly return ownership to the legacy path');
  await setScheduledPeriodReportPaused({ enterpriseId: tenant, paused: false, store: f.store, updatedBy: null, reason: null });
  await f.schedule(tenant).result();
  assert.ok((await f.read(tenant))?.weeklyClaim);
});

test('file task leases share a root across processes and split across private roots', { skip: !live, timeout: 120000 }, async t => {
  const root = await rootDir(t);
  const at = new Date('2026-11-12T10:00:00Z');
  const lease = (location: string, time: Date) =>
    b510Process<{ acquired: boolean }>(t, ['task-lease', location, tenant, time.toISOString()]).result();
  const first = await lease(root, at);
  assert.equal(first.acquired, true);
  assert.equal((await lease(root, at)).acquired, false);
  assert.equal((await lease(join(root, 'private-mount'), at)).acquired, true);
  assert.equal((await lease(root, new Date(at.getTime() + 60001))).acquired, true);
  const store = createFileDurableTaskStore({ rootDir: root });
  assert.ok(await store.readLease(tenant, 'b510-lease'));
  assert.equal(await store.readLease(control, 'b510-lease'), null);
});

test('a loopback tool commits before a lost response and duplicate callbacks write back once', { skip: !live, timeout: 30000 }, async t => {
  const root = await rootDir(t), effectFile = join(root, 'external-effects');
  const external = createServer((request, response) => {
    if (request.method !== 'POST') { response.writeHead(405).end(); return; }
    const correlation = request.headers['idempotency-key'];
    if (typeof correlation !== 'string') { response.writeHead(422).end(); return; }
    // Durable effect and an intentionally lost acceptance response.
    void appendFile(effectFile, correlation + '\n').catch(() => response.writeHead(500).end());
  });
  await new Promise<void>((resolve, reject) => {
    external.once('error', reject);
    external.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise<void>(resolve => { external.closeAllConnections(); external.close(() => resolve()); }));
  const address = external.address();
  assert.ok(address && typeof address === 'object');
  const port: DurableToolPort = {
    async dispatch(input) {
      const response = await fetch('http://127.0.0.1:' + address.port, {
        method: 'POST', headers: { 'Idempotency-Key': input.dispatchId }, signal: AbortSignal.timeout(1500),
      });
      if (!response.ok) throw Error('Tool returned an error');
      return { externalId: input.dispatchId };
    },
    async probe() { return { status: 'unknown' }; },
    async saveResult(input) {
      await writeFile(join(root, 'saved-receipt'), JSON.stringify(input.result), { flag: 'wx' });
      return { savedId: 'one-saved-result' };
    },
    async writeback(input) {
      await writeFile(join(root, 'writeback'), input.savedId, { flag: 'wx' });
    },
  };
  const createExecutor = () => createDurableToolExecutor({
    runtime: createDurableTaskRuntime({ store: createFileDurableTaskStore({ rootDir: join(root, 'tasks') }) }), port,
  });
  const request = {
    enterpriseId: tenant, tool: 'acceptance.external-effect', idempotencyKey: 'one-effect', workerId: 'first',
    effect: 'save' as const, payload: {}, timeouts: { externalCallTimeoutMs: 500 },
    delegation: { requestedBy: 'b510-synthetic', conversationId: 'acceptance', messageId: 'acceptance', runId: 'acceptance' },
    authorization: { allowed: true, actorId: 'b510-synthetic', checkedAt: new Date().toISOString(), scope: 'test:save', reason: null },
  };
  const submitted = await createExecutor().submit(request);
  assert.equal(submitted.state, 'unknown');
  const dispatchId = (await readFile(effectFile, 'utf8')).trim();
  assert.ok(dispatchId && !dispatchId.includes('\n'));
  assert.equal((await createExecutor().submit({ ...request, workerId: 'restart' })).state, 'unknown');
  const callback = { enterpriseId: tenant, taskId: submitted.taskId, dispatchId, callbackId: 'effect-committed',
    status: 'succeeded' as const, result: { effect: 'committed' } };
  assert.equal((await createExecutor().handleCallback({ ...callback, enterpriseId: control })).reason, 'not_found');
  const recovered = await createExecutor().handleCallback(callback);
  assert.equal(recovered.record?.status, 'succeeded');
  assert.equal((await createExecutor().handleCallback(callback)).reason, 'duplicate');
  assert.equal(await readFile(effectFile, 'utf8'), dispatchId + '\n');
  assert.deepEqual(JSON.parse(await readFile(join(root, 'saved-receipt'), 'utf8')), callback.result);
  assert.equal(await readFile(join(root, 'writeback'), 'utf8'), 'one-saved-result');
});
