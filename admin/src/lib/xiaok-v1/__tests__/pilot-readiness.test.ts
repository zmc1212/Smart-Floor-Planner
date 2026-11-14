/** Isolated PostgreSQL 17 tests for the read-only pilot readiness checker.
 *
 * The test refuses any database other than the dedicated pilot readiness
 * acceptance database. If PILOT_READINESS_TEST_DATABASE_URL is absent the file
 * is skipped so existing regression commands keep working. */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';

const configured = process.env.PILOT_READINESS_TEST_DATABASE_URL?.trim();
const allowedTarget = (() => {
  if (!configured) return null;
  try {
    const url = new URL(configured);
    return ['127.0.0.1', 'localhost'].includes(url.hostname) && url.port === '55432'
      && url.pathname === '/pilot_readiness_eval' && url.username === 'sfp_app';
  } catch {
    return false;
  }
})();
if (configured && !allowedTarget) {
  throw new Error('Refuse to run: PILOT_READINESS_TEST_DATABASE_URL must point to 127.0.0.1:55432/pilot_readiness_eval as sfp_app');
}
const skip = configured ? false : 'PILOT_READINESS_TEST_DATABASE_URL is not configured';

type Transaction = PostgresTransaction;
type Fixture = {
  enterpriseId: string;
  ownerId: string;
  leadId: string;
  projectId: string;
  managerId: string;
  designerId: string;
  workerId: string;
  bossId: string;
};
type FixtureOptions = {
  reportPlan?: boolean;
  manager?: boolean;
  designerMembership?: boolean;
  workerMembership?: boolean;
  boss?: boolean;
  bossRole?: 'enterprise_admin' | 'designer';
  plan?: boolean;
  bindings?: boolean;
};

let one: typeof import('@/db/repositories/assistant-repository').one;
let withPlatformTransaction: typeof import('@/db/transaction').withPlatformTransaction;
let withTenantTransaction: typeof import('@/db/transaction').withTenantTransaction;
let closePostgresPool: typeof import('@/lib/postgresql').closePostgresPool;
let checkPilotReadiness: typeof import('@/lib/xiaok-v1/pilot-readiness').checkPilotReadiness;
let defaultConstructionStages: typeof import('@/lib/construction/stages').defaultConstructionStages;

const now = new Date('2026-11-14T10:00:00+08:00');
const runId = `${Date.now()}-${process.pid}`;
const fixtures: Record<string, Fixture> = {};
let healthDirectory = '';
let freshHealthFile = '';
let missingHealthFile = '';
let drizzleFolder = '';

const day = (offset: number) => {
  const date = new Date(now.getTime() + offset * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(date);
};

async function fixture(tx: Transaction, label: string, options: FixtureOptions = {}): Promise<Fixture> {
  const enterprise = await one<{ id: string }>(tx, sql`insert into app.enterprises(name,code,status,registration_mode)
    values(${'PilotReadiness ' + label + ' ' + runId},${'pilot-readiness-' + label + '-' + runId},'active','manual') returning id::text as id`);
  const enterpriseId = String(enterprise!.id);
  // The followup access functions compare this tenant GUC even inside a
  // platform transaction, so bindings must be seeded with the same scope.
  await tx.execute(sql`select set_config('app.current_enterprise_id',${enterpriseId},true)`);
  await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,retention_days,daily_requests,daily_tokens,daily_cost_micros)
    values(${enterpriseId},true,365,100000,1000000000,1000000000)`);
  await tx.execute(sql`insert into app.system_roles(role_key,label,menu_keys)
    values('designer','合成设计师',array['construction-projects']) on conflict do nothing`);

  const owner = await one<{ id: string }>(tx, sql`insert into app.users(nickname,role)
    values(${'业主 ' + label},'user') returning id::text as id`);
  const lead = await one<{ id: string }>(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source,status)
    values(${enterpriseId},${String(owner!.id)},${'项目 ' + label},'13800000000','pilot_readiness','converted') returning id::text as id`);
  const admin = async (role: string, name: string) => {
    const row = await one<{ id: string }>(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password,display_name)
      values(${enterpriseId},${'pilot-' + label + '-' + name + '-' + runId},'unusable-synthetic',${role},'active',false,${name}) returning id::text as id`);
    return String(row!.id);
  };
  const managerId = options.manager === false ? '' : await admin('construction_staff', '项目经理');
  const designerId = await admin('designer', '设计师');
  const workerId = await admin('construction_staff', '施工人员');
  const bossId = options.boss === false ? '' : options.bossRole === 'designer' ? designerId : await admin('enterprise_admin', '老板');

  const project = await one<{ id: string }>(tx, sql`insert into app.construction_projects(enterprise_id,lead_id,name,current_stage_key)
    values(${enterpriseId},${String(lead!.id)},${'工地 ' + label},'utilities') returning id::text as id`);
  const projectId = String(project!.id);
  await tx.execute(sql`insert into app.construction_stage_settings(enterprise_id,stages)
    values(${enterpriseId},${JSON.stringify(defaultConstructionStages)}::jsonb)`);
  const room = await one<{ id: string }>(tx, sql`insert into app.construction_rooms(enterprise_id,project_id,name)
    values(${enterpriseId},${projectId},'卫生间') returning id::text as id`);

  const member = async (adminId: string, role: string) => {
    if (!adminId) return;
    await tx.execute(sql`insert into app.construction_members(enterprise_id,project_id,admin_id,role,active)
      values(${enterpriseId},${projectId},${adminId},${role},true)`);
  };
  if (managerId) await member(managerId, 'manager');
  if (options.designerMembership !== false) await member(designerId, 'designer');
  if (options.workerMembership !== false) await member(workerId, 'worker');

  if (options.plan !== false) {
    const payload = {
      projectId, version: 1, title: '试点施工计划', note: '', publisherId: managerId || bossId,
      completionPolicy: 'explicit',
      nodes: [{ key: 'node_1', stageKey: 'utilities', roomId: String(room!.id), plannedStart: day(-7), plannedEnd: day(7) }],
    };
    await tx.execute(sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
      values(${enterpriseId},'construction.schedule.published.v1','construction_project',${projectId},1,
        ${JSON.stringify({ kind: 'admin', id: managerId || bossId })}::jsonb,${projectId},${JSON.stringify(payload)}::jsonb)`);
  }

  const c01 = await one<{ id: string }>(tx, sql`insert into app.assistant_conversations(enterprise_id,purpose,entry_snapshot,policy_version)
    values(${enterpriseId},'customer_consultation',${JSON.stringify({ kind: 'lead', id: String(lead!.id) })}::jsonb,1) returning id::text as id`);
  await tx.execute(sql`insert into app.assistant_participants(enterprise_id,conversation_id,principal_kind,user_id,grant_basis)
    values(${enterpriseId},${String(c01!.id)},'user',${String(owner!.id)},${JSON.stringify({ kind: 'customer_consultation' })}::jsonb)`);

  if (options.reportPlan !== false) {
    await tx.execute(sql`insert into app.construction_report_settings(enterprise_id,enabled,daily_time,weekly_time,project_ids,stage_keys,
        next_daily_at,next_weekly_at,weekly_day,audiences)
      values(${enterpriseId},true,'20:00','08:00',${JSON.stringify([projectId])}::jsonb,'[]'::jsonb,
        ${new Date(now.getTime() + 86_400_000)},${new Date(now.getTime() + 7 * 86_400_000)},1,
        ${JSON.stringify(['customer', 'worker', 'designer', 'boss'])}::jsonb)`);
  }

  if (options.bindings !== false) {
    const bind = async (audience: string, principal: { kind: 'user' | 'admin'; id: string }, project: string | null) => {
      const conversation = await one<{ id: string }>(tx, sql`insert into app.assistant_conversations(enterprise_id,purpose,entry_snapshot,policy_version)
        values(${enterpriseId},'construction_followup',${JSON.stringify({
          kind: 'construction_followup', audience, scope: project ? 'project:' + project : 'enterprise',
        })}::jsonb,1) returning id::text as id`);
      const binding = await one<{ id: string }>(tx, sql`insert into app.construction_followup_bindings(enterprise_id,principal_key,audience,user_id,admin_id,project_id,scope_key,conversation_id)
        values(${enterpriseId},${principal.kind + ':' + principal.id},${audience},
          ${principal.kind === 'user' ? principal.id : null},${principal.kind === 'admin' ? principal.id : null},
          ${project},${project ? 'project:' + project : 'enterprise'},${String(conversation!.id)}) returning id::text as id`);
      await tx.execute(sql`insert into app.assistant_participants(enterprise_id,conversation_id,principal_kind,user_id,admin_id,grant_basis)
        values(${enterpriseId},${String(conversation!.id)},${principal.kind},
          ${principal.kind === 'user' ? principal.id : null},${principal.kind === 'admin' ? principal.id : null},
          ${JSON.stringify({ kind: 'construction_followup', bindingId: String(binding!.id) })}::jsonb)`);
    };
    await bind('customer', { kind: 'user', id: String(owner!.id) }, projectId);
    if (bossId && options.boss !== false && options.bossRole !== 'designer') await bind('boss', { kind: 'admin', id: bossId }, null);
    if (options.designerMembership !== false) await bind('designer', { kind: 'admin', id: designerId }, null);
    if (options.workerMembership !== false) await bind('worker', { kind: 'admin', id: workerId }, null);
  }

  return {
    enterpriseId, ownerId: String(owner!.id), leadId: String(lead!.id), projectId,
    managerId, designerId, workerId, bossId,
  };
}

const healthEnv = (file: string): NodeJS.ProcessEnv => ({ ...process.env, ASSISTANT_WORKER_HEALTH_FILE: file });

async function digest(enterpriseIds: string[]) {
  const ids = sql.raw(enterpriseIds.map(id => `'${id}'`).join(','));
  return withPlatformTransaction(async tx => {
    const targets: Array<[string, string]> = [
      ['construction_projects', 'id'], ['construction_members', 'admin_id,project_id'],
      ['construction_rooms', 'id'], ['construction_stage_settings', 'enterprise_id'],
      ['construction_report_settings', 'enterprise_id'], ['construction_followup_bindings', 'id'],
      ['construction_stage_reminders', 'reminder_id'], ['construction_stage_reminder_pauses', 'enterprise_id,project_id,principal_kind,principal_id,trigger_type'],
      ['assistant_conversations', 'id'], ['assistant_messages', 'id'], ['assistant_participants', 'id'],
      ['assistant_enterprise_settings', 'enterprise_id'], ['admin_users', 'id'], ['users', 'id'], ['leads', 'id'],
      ['domain_event_outbox', 'id'], ['construction_reports', 'id'], ['construction_report_versions', 'report_id,revision'],
      ['assistant_runs', 'id'], ['assistant_jobs', 'id'],
    ];
    const result: Record<string, unknown> = {};
    for (const [table, order] of targets) {
      result[table] = await one(tx, sql`select count(*)::int as count,
        coalesce(md5(string_agg(t::text,'|' order by ${sql.raw(order)})),'') as digest
        from ${sql.raw('app.' + table)} t where enterprise_id in (${ids})`);
    }
    return result;
  });
}

before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = configured!;
  const transaction = await import('@/db/transaction');
  const repository = await import('@/db/repositories/assistant-repository');
  const postgres = await import('@/lib/postgresql');
  const checker = await import('@/lib/xiaok-v1/pilot-readiness');
  const stages = await import('@/lib/construction/stages');
  withPlatformTransaction = transaction.withPlatformTransaction;
  withTenantTransaction = transaction.withTenantTransaction;
  one = repository.one;
  closePostgresPool = postgres.closePostgresPool;
  checkPilotReadiness = checker.checkPilotReadiness;
  defaultConstructionStages = stages.defaultConstructionStages;
  drizzleFolder = path.resolve(process.cwd(), 'drizzle');

  const identity = await withPlatformTransaction(tx => one<{ role: string; database: string }>(tx,
    sql`select current_user as role,current_database() as database`));
  assert.deepEqual(identity, { role: 'sfp_app', database: 'pilot_readiness_eval' });

  healthDirectory = await mkdtemp(path.join(tmpdir(), 'pilot-readiness-'));
  freshHealthFile = path.join(healthDirectory, 'fresh-health.json');
  missingHealthFile = path.join(healthDirectory, 'missing-health.json');
  await writeFile(freshHealthFile, JSON.stringify({ lastSuccessAt: now.getTime() }));

  const created = await withPlatformTransaction(async tx => {
    const values: Record<string, Fixture> = {};
    values.A = await fixture(tx, 'A');
    values.B = await fixture(tx, 'B', { reportPlan: false });
    values.C = await fixture(tx, 'C', { manager: false });
    values.D = await fixture(tx, 'D');
    values.E = await fixture(tx, 'E', { plan: false });
    values.F = await fixture(tx, 'F', { boss: false, designerMembership: false, workerMembership: false });
    values.G = await fixture(tx, 'G');
    return values;
  });
  Object.assign(fixtures, created);
});

after(async () => {
  if (skip) return;
  await closePostgresPool();
  if (healthDirectory) await rm(healthDirectory, { recursive: true, force: true });
});

const run = (fixtureValue: Fixture, health = freshHealthFile) => checkPilotReadiness({
  enterpriseId: fixtureValue.enterpriseId, now, env: healthEnv(health), migrationsFolder: drizzleFolder,
});

test('A complete pilot enterprise is ready', { skip }, async () => {
  const report = await run(fixtures.A);
  assert.equal(report.readiness, 'ready');
  assert.deepEqual(report.blockers, []);
  assert.deepEqual(report.warnings, []);
  assert.deepEqual(report.projects.map(project => project.id), [fixtures.A.projectId]);
  assert.equal(report.projects[0].currentStageKey, 'utilities');
  assert.equal(report.projects[0].stageValid, true);
  assert.equal(report.projects[0].plan.structurallyValid, true);
  assert.equal(report.projects[0].plan.currentStageScheduled, true);
  assert.equal(report.projects[0].c01.available, true);
  assert.equal(report.roleAccounts.owner.length, 1);
  assert.equal(report.roleAccounts.owner[0].id, fixtures.A.ownerId);
  assert.equal(report.roleAccounts.owner[0].name, '客户 ' + fixtures.A.ownerId);
  assert.equal(report.roleAccounts.boss.length, 1);
  assert.equal(report.roleAccounts.manager.length, 1);
  assert.equal(report.roleAccounts.designer.length, 1);
  assert.equal(report.roleAccounts.worker.length, 1);
  assert.deepEqual(report.rejectedAccounts, []);
  assert.equal(report.weeklyReportStatus.enabled, true);
  assert.deepEqual(report.weeklyReportStatus.missingAudiences, []);
  assert.deepEqual(report.weeklyReportStatus.missingBindingAudiences, []);
  assert.equal(report.inboxStatus.missingChannels.length, 0);
  assert.equal(report.workerStatus.freshness, 'fresh');
  assert.equal(report.rlsStatus.account.role, 'sfp_app');
  assert.equal(report.rlsStatus.account.superuser, false);
  assert.equal(report.rlsStatus.account.bypassRls, false);
  assert.ok(report.rlsStatus.tables.every(table => table.exists && table.rls && table.forced && table.policies > 0));
  assert.ok(report.migrationStatus.migrations.every(migration => migration.schemaApplied));
  // The customer is a platform-level identity and is invisible to the tenant
  // transaction; owner detection must still use the lead/project binding.
  const invisibleOwner = await withTenantTransaction(fixtures.A.enterpriseId, tx => one<{ count: number }>(tx,
    sql`select count(*)::int as count from app.users where id=${fixtures.A.ownerId}`));
  assert.equal(invisibleOwner?.count, 0);
});

test('B missing weekly report plan is blocked', { skip }, async () => {
  const report = await run(fixtures.B);
  assert.equal(report.readiness, 'blocked');
  assert.ok(report.blockers.some(item => item.checkId === 'report.plan'));
  assert.equal(report.weeklyReportStatus.configured, false);
  assert.equal(report.weeklyReportStatus.enabled, false);
  assert.ok(report.checks.find(item => item.id === 'report.audiences')?.status === 'skipped');
});

test('C missing project manager is blocked', { skip }, async () => {
  const report = await run(fixtures.C);
  assert.equal(report.readiness, 'blocked');
  assert.ok(report.blockers.some(item => item.checkId === 'role.manager'));
  assert.ok(report.blockers.some(item => item.checkId === 'manager.workbench'));
  assert.equal(report.roleAccounts.manager.length, 0);
});

test('D worker not running is blocked', { skip }, async () => {
  const report = await run(fixtures.D, missingHealthFile);
  assert.equal(report.readiness, 'blocked');
  assert.deepEqual(report.blockers.map(item => item.checkId), ['worker.heartbeat']);
  assert.equal(report.workerStatus.freshness, 'unknown');
});

test('E missing valid construction plan is blocked', { skip }, async () => {
  const report = await run(fixtures.E);
  assert.equal(report.readiness, 'blocked');
  assert.ok(report.blockers.some(item => item.checkId === 'project.schedule'));
  assert.equal(report.projects[0].plan.available, false);
  assert.deepEqual(report.blockers.map(item => item.checkId), ['project.schedule']);
});

test('F incomplete project permissions are reported without bypass', { skip }, async () => {
  const report = await run(fixtures.F);
  assert.equal(report.readiness, 'blocked');
  const ids = report.blockers.map(item => item.checkId);
  assert.ok(ids.includes('role.boss'));
  assert.ok(ids.includes('role.designer'));
  assert.ok(ids.includes('role.worker'));
  assert.ok(!ids.includes('role.manager'));
  assert.equal(report.roleAccounts.designer.length, 0);
  assert.equal(report.roleAccounts.worker.length, 0);
  assert.equal(report.roleAccounts.boss.length, 0);
  const reasons = new Set(report.rejectedAccounts.map(item => `${item.id}:${item.reason}`));
  assert.ok(reasons.has(`${fixtures.F.designerId}:no_active_project_membership`));
  assert.ok(reasons.has(`${fixtures.F.workerId}:no_active_project_membership`));
});

test('enterprise data stays isolated and RLS blocks cross-tenant reads', { skip }, async () => {
  const a = await run(fixtures.A);
  const g = await run(fixtures.G);
  assert.deepEqual(a.projects.map(project => project.id), [fixtures.A.projectId]);
  assert.deepEqual(g.projects.map(project => project.id), [fixtures.G.projectId]);
  assert.deepEqual(a.roleAccounts.owner.map(account => account.id), [fixtures.A.ownerId]);
  assert.deepEqual(g.roleAccounts.owner.map(account => account.id), [fixtures.G.ownerId]);
  assert.deepEqual(a.weeklyReportStatus.projectIds, [fixtures.A.projectId]);
  assert.deepEqual(g.weeklyReportStatus.projectIds, [fixtures.G.projectId]);
  const leak = await withTenantTransaction(fixtures.A.enterpriseId, tx => one<{ count: number }>(tx,
    sql`select count(*)::int as count from app.construction_projects where id=${fixtures.G.projectId}`));
  assert.equal(leak?.count, 0);
  const roleLeak = await withTenantTransaction(fixtures.A.enterpriseId, tx => one<{ count: number }>(tx,
    sql`select count(*)::int as count from app.admin_users where id=${fixtures.G.managerId}`));
  assert.equal(roleLeak?.count, 0);
});

test('the checker has no write side effects and repeated runs are stable', { skip }, async () => {
  const ids = [fixtures.A.enterpriseId, fixtures.B.enterpriseId, fixtures.C.enterpriseId,
    fixtures.D.enterpriseId, fixtures.E.enterpriseId, fixtures.F.enterpriseId, fixtures.G.enterpriseId];
  const beforeRun = await digest(ids);
  const first = await run(fixtures.A);
  const second = await run(fixtures.A);
  const afterRun = await digest(ids);
  assert.deepEqual(afterRun, beforeRun);
  assert.deepEqual(second, first);
});

test('a non-existent or invisible enterprise is reported explicitly', { skip }, async () => {
  const report = await checkPilotReadiness({
    enterpriseId: '999999999', now, env: healthEnv(freshHealthFile), migrationsFolder: drizzleFolder,
  });
  assert.equal(report.readiness, 'blocked');
  assert.equal(report.enterpriseName, null);
  assert.ok(report.blockers.some(item => item.checkId === 'enterprise.status'));
  assert.deepEqual(report.projects, []);
  assert.deepEqual(report.roleAccounts.owner, []);
});
