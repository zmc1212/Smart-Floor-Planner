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
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { Client } from 'pg';
import type { PostgresTransaction } from '@/db/transaction';
import type { PilotReadinessOptions } from '@/lib/xiaok-v1/pilot-readiness';

const configured = process.env.PILOT_READINESS_TEST_DATABASE_URL?.trim();
const allowedTarget = (() => {
  if (!configured) return null;
  try {
    const url = new URL(configured);
    return ['127.0.0.1', 'localhost'].includes(url.hostname) && ['55432', '55448'].includes(url.port)
      && url.pathname === '/pilot_readiness_eval' && url.username === 'sfp_app';
  } catch {
    return false;
  }
})();
if (configured && !allowedTarget) {
  throw new Error('Use the isolated pilot_readiness_eval database on loopback port 55432 or 55448 as sfp_app');
}
const skip = configured ? false : 'PILOT_READINESS_TEST_DATABASE_URL is not configured';
const migrationUrl = process.env.PILOT_READINESS_TEST_MIGRATION_URL?.trim();
if (migrationUrl) {
  const migration = new URL(migrationUrl);
  const app = configured && new URL(configured);
  if (!app || migration.hostname !== app.hostname || migration.port !== app.port
    || migration.pathname !== app.pathname || migration.username !== 'sfp_migrator') {
    throw new Error('Use the migrator for the same isolated pilot readiness database');
  }
}

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
  enterprise?: Fixture;
  reportPlan?: boolean;
  manager?: boolean;
  designerMembership?: boolean;
  workerMembership?: boolean;
  boss?: boolean;
  bossRole?: 'enterprise_admin' | 'designer';
  plan?: boolean;
  bindings?: boolean;
  stage?: boolean;
  c01?: boolean;
  name?: string;
};

let one: typeof import('@/db/repositories/assistant-repository').one;
let withPlatformTransaction: typeof import('@/db/transaction').withPlatformTransaction;
let withTenantTransaction: typeof import('@/db/transaction').withTenantTransaction;
let closePostgresPool: typeof import('@/lib/postgresql').closePostgresPool;
let checkPilotReadiness: typeof import('@/lib/xiaok-v1/pilot-readiness').checkPilotReadiness;
let PilotProjectScopeService: typeof import('@/lib/xiaok-v1/pilot-project-scope').PilotProjectScopeService;
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
  const enterprise = options.enterprise ? { id: options.enterprise.enterpriseId }
    : await one<{ id: string }>(tx, sql`insert into app.enterprises(name,code,status,registration_mode)
    values(${'PilotReadiness ' + label + ' ' + runId},${'pilot-readiness-' + label + '-' + runId},'active','manual') returning id::text as id`);
  const enterpriseId = String(enterprise!.id);
  // The followup access functions compare this tenant GUC even inside a
  // platform transaction, so bindings must be seeded with the same scope.
  await tx.execute(sql`select set_config('app.current_enterprise_id',${enterpriseId},true)`);
  if (!options.enterprise) {
    await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,retention_days,daily_requests,daily_tokens,daily_cost_micros)
      values(${enterpriseId},true,365,100000,1000000000,1000000000)`);
    await tx.execute(sql`insert into app.construction_stage_settings(enterprise_id,stages)
      values(${enterpriseId},${JSON.stringify(defaultConstructionStages)}::jsonb)`);
  }
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
  const bossId = options.boss === false ? '' : options.bossRole === 'designer' ? designerId
    : options.enterprise?.bossId ?? await admin('enterprise_admin', '老板');

  const project = await one<{ id: string }>(tx, sql`insert into app.construction_projects(enterprise_id,lead_id,name,current_stage_key)
    values(${enterpriseId},${String(lead!.id)},${options.name ?? '工地 ' + label},${options.stage === false ? null : 'utilities'}) returning id::text as id`);
  const projectId = String(project!.id);
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

  if (options.c01 !== false) {
    const c01 = await one<{ id: string }>(tx, sql`insert into app.assistant_conversations(enterprise_id,purpose,entry_snapshot,policy_version)
      values(${enterpriseId},'customer_consultation',${JSON.stringify({ kind: 'lead', id: String(lead!.id) })}::jsonb,1) returning id::text as id`);
    await tx.execute(sql`insert into app.assistant_participants(enterprise_id,conversation_id,principal_kind,user_id,grant_basis)
      values(${enterpriseId},${String(c01!.id)},'user',${String(owner!.id)},${JSON.stringify({ kind: 'customer_consultation' })}::jsonb)`);
  }

  if (!options.enterprise && options.reportPlan !== false) {
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
    if (bossId && !options.enterprise && options.boss !== false && options.bossRole !== 'designer') await bind('boss', { kind: 'admin', id: bossId }, null);
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
      ['enterprises', 'id'],
      ['construction_projects', 'id'], ['construction_members', 'admin_id,project_id'],
      ['construction_rooms', 'id'], ['construction_stage_settings', 'enterprise_id'],
      ['construction_report_settings', 'enterprise_id'], ['construction_followup_bindings', 'id'],
      ['construction_stage_reminders', 'reminder_id'], ['construction_stage_reminder_pauses', 'enterprise_id,project_id,principal_kind,principal_id,trigger_type'],
      ['assistant_conversations', 'id'], ['assistant_messages', 'id'], ['assistant_participants', 'id'],
      ['assistant_enterprise_settings', 'enterprise_id'], ['admin_users', 'id'], ['users', 'id'], ['leads', 'id'],
      ['domain_event_outbox', 'id'], ['construction_reports', 'id'], ['construction_report_versions', 'report_id,revision'],
      ['assistant_runs', 'id'], ['assistant_jobs', 'id'], ['construction_report_deliveries', 'event_id'],
      ['xiaok_pilot_project_scopes', 'enterprise_id,pilot_id,scope_version'],
    ];
    const result: Record<string, unknown> = {};
    for (const [table, order] of targets) {
      result[table] = await one(tx, sql`select count(*)::int as count,
        coalesce(md5(string_agg(t::text,'|' order by ${sql.raw(order)})),'') as digest
        from ${sql.raw('app.' + table)} t where ${sql.raw(table === 'enterprises' ? 'id' : 'enterprise_id')} in (${ids})`);
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
  const scope = await import('@/lib/xiaok-v1/pilot-project-scope');
  const stages = await import('@/lib/construction/stages');
  withPlatformTransaction = transaction.withPlatformTransaction;
  withTenantTransaction = transaction.withTenantTransaction;
  one = repository.one;
  closePostgresPool = postgres.closePostgresPool;
  checkPilotReadiness = checker.checkPilotReadiness;
  PilotProjectScopeService = scope.PilotProjectScopeService;
  defaultConstructionStages = stages.defaultConstructionStages;
  drizzleFolder = path.resolve(process.cwd(), 'drizzle');

  const identity = await withPlatformTransaction(tx => one(tx,
    sql`select current_user as role,current_database() as database,current_setting('server_version_num')::int / 10000 as major`));
  assert.deepEqual(identity, { role: 'sfp_app', database: 'pilot_readiness_eval', major: 17 });

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
    values.scope = await fixture(tx, 'scope-primary');
    values.second = await fixture(tx, 'scope-complete', { enterprise: values.scope, name: '合成·带测试字样的工地' });
    values.incomplete = await fixture(tx, 'scope-incomplete', {
      enterprise: values.scope, stage: false, plan: false, c01: false, workerMembership: false, bindings: false,
    });
    await tx.execute(sql`update app.construction_report_settings set project_ids='[]',stage_keys='["utilities"]'
      where enterprise_id=${values.scope.enterpriseId}`);
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
  enterpriseId: fixtureValue.enterpriseId, enterpriseAudit: true, now, env: healthEnv(health), migrationsFolder: drizzleFolder,
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

const scopeRun = (options: Partial<PilotReadinessOptions> = {}) => checkPilotReadiness({
  enterpriseId: fixtures.scope.enterpriseId, now, env: healthEnv(freshHealthFile), migrationsFolder: drizzleFolder, ...options,
});
const scopeService = () => new PilotProjectScopeService({ enterpriseId: fixtures.scope.enterpriseId, adminId: fixtures.scope.bossId });
const saveScope = (pilotId: string, projectIds: string[], expectedVersion = 0, status = 'active') =>
  scopeService().save(pilotId, { projectIds, expectedVersion, status });
const securityChecks = ['assistant.enabled', 'worker.heartbeat', 'database.account', 'database.migrations', 'database.rls'];
const checkStatuses = (report: Awaited<ReturnType<typeof scopeRun>>) =>
  Object.fromEntries(report.enterpriseChecks.map(check => [check.id, check.status]));

test('A one explicitly configured pilot project is checked without choosing other active projects', { skip }, async () => {
  const { scope, second, incomplete } = fixtures;
  const config = await saveScope('pilot-a', [scope.projectId]);
  assert.deepEqual(config, { enterpriseId: scope.enterpriseId, pilotId: 'pilot-a', projectIds: [scope.projectId],
    createdBy: scope.bossId, createdAt: config.createdAt, scopeVersion: 1, status: 'active' });
  assert.ok(Number.isFinite(Date.parse(config.createdAt)));
  assert.deepEqual(await scopeService().read('pilot-a'), config);
  const report = await scopeRun({ pilotId: 'pilot-a' });
  assert.deepEqual(report.pilotScope.configuration, config);
  assert.deepEqual(report.projects.map(project => project.id), [scope.projectId]);
  assert.deepEqual(report.roleAccounts.owner.map(account => account.id), [scope.ownerId]);
  assert.deepEqual(report.outsideScope.activeProjects.map(project => project.projectId), [second.projectId, incomplete.projectId]);
  assert.deepEqual(report.blockers, []);
  assert.deepEqual(report.warnings.map(warning => warning.checkId), ['pilot.outside_delivery']);
  assert.deepEqual(report.outsideScope.reminders.candidateProjectIds, [second.projectId]);
  assert.deepEqual(report.outsideScope.weeklyReports.planCandidateProjectIds, [second.projectId]);
  const states = checkStatuses(report);
  assert.ok(securityChecks.every(check => states[check] === 'passed'));
  const preview = await scopeRun({ projectIds: [scope.projectId] });
  assert.deepEqual(preview.projects, report.projects);
  assert.equal(preview.pilotScope.configuration, null);
  assert.ok(preview.warnings.some(warning => warning.checkId === 'pilot.scope'));
});

test('B two selected projects are checked independently, with the remaining active project outside', { skip }, async () => {
  const { scope, second, incomplete } = fixtures;
  const projectIds = [scope.projectId, second.projectId];
  await saveScope('pilot-b', projectIds);
  const report = await scopeRun({ pilotId: 'pilot-b' });
  assert.equal(report.readiness, 'ready');
  assert.deepEqual(report.projects.map(project => project.id), projectIds);
  assert.deepEqual(report.outsideScope.activeProjects.map(project => project.projectId), [incomplete.projectId]);
  assert.ok(report.projects.every(project => project.plan.structurallyValid && project.members.worker.length === 1));
  assert.deepEqual(report.roleAccounts.boss[0].projectIds, projectIds);
});

test('C foreign IDs are indistinguishable from unavailable IDs, even in a mixed scope', { skip }, async () => {
  const { scope, G } = fixtures;
  const projectIds = [scope.projectId, G.projectId];
  await assert.rejects(async () => saveScope('pilot-c', projectIds), { code: 'pilot_project_unavailable' });
  await assert.rejects(async () => saveScope('pilot-c', ['999999999']), { code: 'pilot_project_unavailable' });
  const preview = await scopeRun({ projectIds });
  assert.equal(preview.readiness, 'blocked');
  assert.deepEqual(preview.pilotScope.unavailableProjectIds, [G.projectId]);
  assert.deepEqual(preview.projects, []);
  assert.deepEqual(preview.roleAccounts.owner, []);
  assert.ok(preview.outsideScope.activeProjects.every(project => project.projectId !== G.projectId));
  assert.ok(!JSON.stringify(preview).includes('工地 G'));
  // Even a direct insert with app credentials cannot persist an invalid reference.
  await assert.rejects(() => withTenantTransaction(scope.enterpriseId, tx => tx.execute(sql`
    insert into app.xiaok_pilot_project_scopes(enterprise_id,pilot_id,project_ids,created_by,scope_version,status)
    values(${scope.enterpriseId},'invalid-direct',array[${G.projectId}::bigint],${scope.bossId},1,'active')`)),
  error => (error as { cause?: { constraint?: string } }).cause?.constraint === 'xiaok_pilot_projects_available');
  await new PilotProjectScopeService({ enterpriseId: G.enterpriseId, adminId: G.bossId })
    .save('pilot-c', { projectIds: [G.projectId], expectedVersion: 0, status: 'active' });
  assert.equal((await scopeRun({ pilotId: 'pilot-c' })).pilotScope.configuration, null);
  const direct = await withTenantTransaction(scope.enterpriseId, tx => one(tx, sql`select count(*)::int as count
    from app.xiaok_pilot_project_scopes where enterprise_id=${G.enterpriseId}`));
  assert.equal(direct?.count, 0);
});

test('D empty, omitted and missing scopes never select defaults and still check enterprise safety', { skip }, async () => {
  await assert.rejects(async () => saveScope('pilot-d', []), { code: 'pilot_scope_invalid' });
  for (const input of [{ projectIds: [] }, {}, { pilotId: 'pilot-d' }]) {
    const report = await scopeRun({ ...input, env: healthEnv(missingHealthFile) });
    assert.equal(report.readiness, 'blocked');
    assert.deepEqual(report.projects, []);
    assert.deepEqual(report.pilotScope.requestedProjectIds, []);
    assert.ok(report.blockers.some(item => item.checkId === 'pilot.scope'));
    const states = checkStatuses(report);
    assert.equal(states['worker.heartbeat'], 'failed');
    assert.ok(securityChecks.every(check => states[check]));
  }
});

test('E selected incomplete project is visible even when a second project has the missing roles and C01', { skip }, async () => {
  const { scope, incomplete } = fixtures;
  const beforeSave = await digest([scope.enterpriseId]);
  await saveScope('pilot-e', [scope.projectId, incomplete.projectId]);
  const afterSave = await digest([scope.enterpriseId]);
  const { xiaok_pilot_project_scopes: savedScopes, ...savedFacts } = afterSave;
  assert.notDeepEqual(savedScopes, beforeSave.xiaok_pilot_project_scopes);
  for (const [table, value] of Object.entries(savedFacts)) assert.deepEqual(value, beforeSave[table], table);
  const report = await scopeRun({ pilotId: 'pilot-e' });
  assert.equal(report.readiness, 'blocked');
  assert.deepEqual(report.projectGaps, {
    missingStageProjectIds: [incomplete.projectId],
    missingPlanProjectIds: [incomplete.projectId],
    incompleteRoleProjects: [{ projectId: incomplete.projectId, missingRoles: ['worker'] }],
    missingC01ProjectIds: [incomplete.projectId],
  });
  assert.equal(report.pilotProjectChecks.find(check => check.id === 'owner.c01')?.status, 'warning');
});

test('F an outside project with no stage remains active and cannot block project readiness', { skip }, async () => {
  const { scope, second, incomplete } = fixtures;
  await saveScope('pilot-f', [scope.projectId, second.projectId]);
  const report = await scopeRun({ pilotId: 'pilot-f' });
  assert.equal(report.readiness, 'ready');
  assert.deepEqual(report.projectGaps, {
    missingStageProjectIds: [], missingPlanProjectIds: [], incompleteRoleProjects: [], missingC01ProjectIds: [],
  });
  assert.deepEqual(report.outsideScope.activeProjects.map(project => [project.projectId, project.currentStageKey]), [[incomplete.projectId, null]]);
  const live = await withTenantTransaction(scope.enterpriseId, tx => one(tx, sql`select status from app.construction_projects
    where enterprise_id=${scope.enterpriseId} and id=${incomplete.projectId}`));
  assert.equal(live?.status, 'active');
});

test('G existing outside reminders and queued weekly facts are reported without causing writes', { skip }, async () => {
  const { scope, second } = fixtures;
  await saveScope('pilot-g', [scope.projectId]);
  await withTenantTransaction(scope.enterpriseId, async tx => {
    for (const [suffix, status] of [['1', 'pending'], ['2', 'failed'], ['3', 'paused'], ['4', 'acknowledged']]) {
      const reminderId = 'rem_' + second.projectId.padStart(23, '0') + suffix;
      await tx.execute(sql`insert into app.construction_stage_reminders
        (reminder_id,enterprise_id,project_id,target_role,target_principal_kind,target_principal_id,trigger_type,trigger_evidence,scheduled_at,status,dedupe_key,action_url,title,body)
        values(${reminderId},${scope.enterpriseId},${second.projectId},'owner','user',${second.ownerId},'stage_entered','{}',${now},
          ${status},${reminderId},'/test','Synthetic outside reminder','Synthetic fixture')`);
    }
    const binding = await one(tx, sql`select id,conversation_id from app.construction_followup_bindings
      where enterprise_id=${scope.enterpriseId} and project_id=${second.projectId} and audience='customer'`);
    const report = await one(tx, sql`insert into app.construction_reports
      (enterprise_id,binding_id,report_key,kind,period_start,period_end,cutoff_at,scheduled_at)
      values(${scope.enterpriseId},${String(binding!.id)},${'outside-weekly-' + runId},'weekly',${now},${now},${now},${now}) returning id`);
    const run = await one(tx, sql`insert into app.assistant_runs
      (enterprise_id,conversation_id,trigger_kind,trigger_schedule_key,purpose,policy_snapshot,context_revision,knowledge_epoch)
      values(${scope.enterpriseId},${String(binding!.conversation_id)},'scheduled_task',${'outside-weekly-' + runId},'construction.report.facts','{}',0,1)
      returning id`);
    await tx.execute(sql`insert into app.construction_report_versions
      (enterprise_id,report_id,revision,run_id,status,facts,facts_hash,generated_at,period_end,cutoff_at)
      values(${scope.enterpriseId},${String(report!.id)},1,${String(run!.id)},'facts_ready',
        ${JSON.stringify({ projects: [{ id: second.projectId }] })}::jsonb,'synthetic',${now},${now},${now})`);
    const event = await one(tx, sql`insert into app.domain_event_outbox
      (enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
      values(${scope.enterpriseId},'construction.report.facts_ready.v1','construction_report',${String(report!.id)},1,'{"kind":"system"}',
        ${String(run!.id)},'{}') returning id`);
    await tx.execute(sql`insert into app.construction_report_deliveries(enterprise_id,report_id,revision,binding_id,event_id)
      values(${scope.enterpriseId},${String(report!.id)},1,${String(binding!.id)},${String(event!.id)})`);
  });
  const beforeRun = await digest([scope.enterpriseId]);
  const report = await scopeRun({ pilotId: 'pilot-g' });
  assert.deepEqual(await scopeRun({ pilotId: 'pilot-g' }), report);
  assert.deepEqual(await digest([scope.enterpriseId]), beforeRun);
  assert.equal(report.readiness, 'limited');
  assert.deepEqual(report.reminderStatus.byStatus, {});
  assert.deepEqual(report.outsideScope.reminders.unfinishedByProject, [
    { projectId: second.projectId, byStatus: { failed: 1, paused: 1, pending: 1 } },
  ]);
  assert.deepEqual(report.outsideScope.weeklyReports.pendingOrHeldByProject, [{ projectId: second.projectId, count: 1 }]);
  assert.deepEqual(report.outsideScope.weeklyReports.planCandidateProjectIds, [second.projectId]);
  const scoped = await scopeRun({ pilotId: 'pilot-b' });
  assert.deepEqual(scoped.reminderStatus.byStatus, { acknowledged: 1, failed: 1, paused: 1, pending: 1 });
});

test('H multiple pilots keep independent latest versions, preserve history and reject concurrent overwrites', { skip }, async () => {
  const { scope, second } = fixtures;
  const first = await saveScope('pilot-h-1', [scope.projectId]);
  const sibling = await saveScope('pilot-h-2', [second.projectId]);
  const both = await Promise.allSettled([
    saveScope('pilot-h-1', [second.projectId], 1),
    saveScope('pilot-h-1', [scope.projectId, second.projectId], 1),
  ]);
  assert.equal(both.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = both.find(result => result.status === 'rejected');
  assert.equal(rejected?.reason.code, 'version_conflict');
  const updated = await scopeService().read('pilot-h-1');
  assert.equal(updated.scopeVersion, 2);
  assert.deepEqual(await scopeService().read('pilot-h-2'), sibling);
  const history = await withTenantTransaction(scope.enterpriseId, tx => one(tx, sql`select project_ids::text[] as projects from app.xiaok_pilot_project_scopes
    where enterprise_id=${scope.enterpriseId} and pilot_id='pilot-h-1' and scope_version=1`));
  assert.deepEqual(history?.projects, first.projectIds);
  await saveScope('pilot-h-1', updated.projectIds, 2, 'inactive');
  const disabled = await scopeRun({ pilotId: 'pilot-h-1' });
  assert.equal(disabled.pilotScope.configuration?.status, 'inactive');
  assert.deepEqual(disabled.projects, []);
  assert.equal(disabled.readiness, 'blocked');
  assert.deepEqual((await scopeRun({ pilotId: 'pilot-h-2' })).projects.map(project => project.id), [second.projectId]);
});

test('inactive projects retain their outside backlog and cannot make a saved scope impossible to deactivate', { skip }, async () => {
  const { scope, second } = fixtures;
  const pilotId = 'pilot-archive';
  await saveScope(pilotId, [second.projectId]);
  const state = (status: string) => withTenantTransaction(scope.enterpriseId, tx => tx.execute(sql`update app.construction_projects set status=${status}
    where enterprise_id=${scope.enterpriseId} and id=${second.projectId}`));
  await state('archived');
  try {
    const scoped = await scopeRun({ pilotId });
    assert.equal(scoped.readiness, 'blocked');
    assert.deepEqual(scoped.pilotScope.unavailableProjectIds, [second.projectId]);
    assert.deepEqual(scoped.projects, []);
    const outside = await scopeRun({ pilotId: 'pilot-a' });
    assert.ok(!outside.outsideScope.activeProjects.some(project => project.projectId === second.projectId));
    assert.deepEqual(outside.outsideScope.reminders.unfinishedByProject?.map(project => project.projectId), [second.projectId]);
    assert.deepEqual(outside.outsideScope.weeklyReports.pendingOrHeldByProject, [{ projectId: second.projectId, count: 1 }]);
    assert.equal((await saveScope(pilotId, [second.projectId], 1, 'inactive')).status, 'inactive');
    await assert.rejects(async () => saveScope(pilotId, [second.projectId], 2), { code: 'pilot_project_unavailable' });
  } finally {
    await state('active');
  }
});

test('configuration API requires the selected enterprise and live management permission', { skip }, async () => {
  const { GET, PUT } = await import('@/app/api/construction/pilot-scopes/[pilotId]/route');
  const { scope, G } = fixtures;
  const pilotId = 'route-test';
  const ctx = { params: Promise.resolve({ pilotId }) };
  const secret = new TextEncoder().encode(process.env.JWT_SECRET || 'fallback_secret_random_123');
  const request = async (adminId: string, role: string, method = 'PUT', audience?: string, enterpriseId = scope.enterpriseId) => {
    const jwt = new SignJWT({ id: adminId, role, enterpriseId }).setProtectedHeader({ alg: 'HS256' });
    if (audience) jwt.setAudience(audience);
    const token = await jwt.sign(secret);
    return new NextRequest('http://localhost/api/construction/pilot-scopes/' + pilotId, {
      method, headers: { cookie: 'auth_token=' + token }, ...(method === 'PUT' ? {
        body: JSON.stringify({ expectedVersion: 0, status: 'active', projectIds: [scope.projectId] }),
      } : {}),
    });
  };
  assert.equal((await PUT(await request(scope.designerId, 'designer'), ctx)).status, 403);
  // A stale elevated session and a valid manager of a different enterprise are both denied by the DB gate.
  assert.equal((await PUT(await request(scope.designerId, 'enterprise_admin'), ctx)).status, 403);
  assert.equal((await PUT(await request(G.bossId, 'enterprise_admin'), ctx)).status, 403);
  assert.equal((await PUT(await request(scope.bossId, 'enterprise_admin', 'PUT', 'miniprogram'), ctx)).status, 401);
  assert.equal((await GET(await request(scope.bossId, 'enterprise_admin', 'GET'), ctx)).status, 404);
  const saved = await PUT(await request(scope.bossId, 'enterprise_admin'), ctx);
  assert.equal(saved.status, 200);
  assert.equal(saved.headers.get('Cache-Control'), 'no-store');
  const reentry = await GET(await request(scope.bossId, 'enterprise_admin', 'GET'), ctx);
  assert.deepEqual(await reentry.json(), await saved.json());

  await withTenantTransaction(scope.enterpriseId, tx => tx.execute(sql`update app.admin_users set must_change_password=true where id=${scope.bossId}`));
  try {
    assert.equal((await GET(await request(scope.bossId, 'enterprise_admin', 'GET'), ctx)).status, 403);
  } finally {
    await withTenantTransaction(scope.enterpriseId, tx => tx.execute(sql`update app.admin_users set must_change_password=false where id=${scope.bossId}`));
  }
  for (const role of ['admin', 'super_admin']) {
    const platform = await withPlatformTransaction(tx => one(tx, sql`insert into app.admin_users
      (enterprise_id,username,password_hash,role,status,must_change_password,display_name)
      values(null,${'pilot-platform-' + role + '-' + runId},'unusable-synthetic',${role},'active',false,'Synthetic platform admin') returning id`));
    const id = String(platform!.id);
    assert.equal((await PUT(await request(id, role, 'PUT', undefined, ''), ctx)).status, 400);
    const selected = { params: Promise.resolve({ pilotId: role + '-route-test' }) };
    const configured = await PUT(await request(id, role), selected);
    assert.equal(configured.status, 200);
    assert.equal((await configured.json()).data.createdBy, id);
  }
});

test('empty scope still reports absent migration, missing FORCE RLS, unavailable Assistant and Worker', {
  skip: skip || (!migrationUrl && 'PILOT_READINESS_TEST_MIGRATION_URL is not configured'),
}, async () => {
  const migrator = new Client({ connectionString: migrationUrl, connectionTimeoutMillis: 4000 });
  await migrator.connect();
  const { scope } = fixtures;
  try {
    await withTenantTransaction(scope.enterpriseId, tx => tx.execute(sql`update app.assistant_enterprise_settings set enabled=false
      where enterprise_id=${scope.enterpriseId}`));
    await migrator.query('alter table app.construction_stage_reminder_pauses no force row level security');
    await migrator.query('alter table app.construction_stage_reminders rename to i744_hidden_reminders');
    try {
      const report = await scopeRun({ projectIds: [], env: healthEnv(missingHealthFile) });
      const states = checkStatuses(report);
      assert.equal(report.readiness, 'blocked');
      assert.equal(states['database.migrations'], 'failed');
      assert.equal(states['database.rls'], 'failed');
      assert.equal(states['assistant.enabled'], 'failed');
      assert.equal(states['worker.heartbeat'], 'failed');
      assert.equal(states['database.account'], 'passed');
      assert.deepEqual(report.projects, []);
      assert.equal(report.checks.find(check => check.id === 'reminder.state')?.status, 'skipped');
      assert.equal(report.outsideScope.reminders.unfinishedByProject, null);
    } finally {
      await migrator.query('alter table app.i744_hidden_reminders rename to construction_stage_reminders');
    }
  } finally {
    await migrator.query('alter table app.construction_stage_reminder_pauses force row level security');
    await withTenantTransaction(scope.enterpriseId, tx => tx.execute(sql`update app.assistant_enterprise_settings set enabled=true
      where enterprise_id=${scope.enterpriseId}`));
    await migrator.end();
  }
});
