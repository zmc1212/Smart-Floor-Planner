/** I7.4.5-F4.1 real PostgreSQL 17 acceptance for the complete HTTP Worker
 * route under one aligned pilot configuration. Reuses the F4 isolated database
 * and synthetic enterprise; it never sends a real notification. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';

const admin = path.resolve(process.cwd());
loadEnvConfig(admin, true);
const connectionFile = path.resolve(admin, '..', 'tmp/xiaok-i745-f2/connection.private.json');
if (!fs.existsSync(connectionFile)) throw new Error('Missing tmp/xiaok-i745-f2/connection.private.json');
const connections = JSON.parse(fs.readFileSync(connectionFile, 'utf8')) as { DATABASE_URL: string; MIGRATION_URL: string };
const target = new URL(connections.DATABASE_URL);
if (target.hostname !== '127.0.0.1' || target.port !== '55432' || target.pathname !== '/i745_f1_accept'
  || target.username !== 'sfp_app') {
  throw new Error('Reuse only 127.0.0.1:55432/i745_f1_accept as sfp_app');
}
process.env.DATABASE_URL = connections.DATABASE_URL;

type CheckStatus = 'passed' | 'failed' | 'limited' | 'not_run' | 'unknown';
const output = path.resolve(process.argv.find(value => value.startsWith('--output='))?.slice(9)
  || '../tmp/xiaok-i745-f4-1/run-' + Date.now());
assert.ok(!fs.existsSync(path.join(output, 'result.json')), 'Preserve every original outcome');
fs.mkdirSync(output, { recursive: true });
const result: {
  startedAt: string; finishedAt?: string; database: string; user: string; runId: string;
  checks: Array<{ id: string; status: CheckStatus; detail: string; evidence?: unknown }>;
  ids: Record<string, unknown>; error?: string;
} = { startedAt: new Date().toISOString(), database: 'i745_f1_accept', user: 'sfp_app',
  runId: randomUUID(), checks: [], ids: {} };
const save = () => fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
const check = (id: string, status: CheckStatus, detail: string, evidence?: unknown) => {
  result.checks.push({ id, status, detail, ...(evidence === undefined ? {} : { evidence }) });
  console.log(id + ': ' + status);
  save();
};

async function main() {
  const { withPlatformTransaction, withTenantTransaction } = await import('@/db/transaction');
  const { one, rows } = await import('@/db/repositories/assistant-repository');
  const { closePostgresPool } = await import('@/lib/postgresql');
  const { ConstructionService } = await import('@/lib/construction/service');
  const { claimJob } = await import('@/lib/assistant/infrastructure/job-queue');
  const { processConstructionReport } = await import('@/lib/construction/report-worker');
  const { createAssistantJobsPost } = await import('@/lib/assistant/infrastructure/jobs-post-handler');
  const { getDefaultMenuKeys } = await import('@/lib/admin-user-roles');
  const bcrypt = (await import('bcryptjs')).default;

  const identity = (await withPlatformTransaction(tx => one(tx, sql`select current_user usr,current_database() db,
    version() ver,(select rolsuper from pg_roles where rolname=current_user) super`)))!;
  assert.equal(identity.usr, 'sfp_app'); assert.equal(identity.db, 'i745_f1_accept'); assert.equal(identity.super, false);
  result.ids.environment = identity;
  const rls = await withPlatformTransaction(tx => rows(tx, sql`select c.relname,c.relrowsecurity rls,c.relforcerowsecurity forced
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='app'
    and c.relname in ('xiaok_pilot_project_scopes','construction_stage_reminders','construction_report_settings',
      'construction_reports','construction_report_versions','construction_report_deliveries','assistant_messages') order by 1`));
  check('env.pg17_rls', rls.length === 7 && rls.every(row => row.rls === true && row.forced === true)
    ? 'passed' : 'failed', '复用 F4 PG17.10 数据库，sfp_app 非超级用户且强制 RLS', { identity, rls });

  const enterprise = '5';
  const pilotId = 'f2-pilot';
  const pidA = '8';
  const pidB = '9';
  const boss = '12';
  const reportNow = new Date('2026-11-16T20:00:00+08:00');
  const unifiedEnv = {
    XIAOK_STAGE_REMINDER_MODE: 'pilot',
    XIAOK_STAGE_REMINDER_ENTERPRISE_ID: enterprise,
    XIAOK_STAGE_REMINDER_PILOT_ID: pilotId,
    XIAOK_WEEKLY_REPORT_MODE: 'pilot',
    XIAOK_WEEKLY_REPORT_ENTERPRISE_ID: enterprise,
    XIAOK_WEEKLY_REPORT_PILOT_ID: pilotId,
  };
  result.ids.config = { enterpriseId: enterprise, pilotId,
    reminderMode: 'pilot', weeklyMode: 'pilot' };

  const counts = async () => (await withTenantTransaction(enterprise, tx => one(tx, sql`select
    (select count(*)::int from app.construction_stage_reminders where enterprise_id=${enterprise} and project_id=${pidA}) reminders_a,
    (select count(*)::int from app.construction_stage_reminders where enterprise_id=${enterprise} and project_id=${pidB}) reminders_b,
    (select count(*)::int from app.construction_reports where enterprise_id=${enterprise}) reports,
    (select count(*)::int from app.construction_report_deliveries where enterprise_id=${enterprise}) deliveries,
    (select count(*)::int from app.assistant_messages where enterprise_id=${enterprise}) messages,
    (select count(*)::int from app.domain_event_outbox where enterprise_id=${enterprise}) outbox`)))!;

  // ------------------------------------------------------------ fixture
  const latestScope = (await withTenantTransaction(enterprise, tx => one(tx, sql`select scope_version,status,
    project_ids::text from app.xiaok_pilot_project_scopes where enterprise_id=${enterprise} and pilot_id=${pilotId}
    order by scope_version desc limit 1`)))!;
  const scopeVersion = Number(latestScope.scope_version) + 1;
  await withTenantTransaction(enterprise, tx => tx.execute(sql`insert into app.xiaok_pilot_project_scopes
    (enterprise_id,pilot_id,project_ids,created_by,scope_version,status)
    values(${enterprise},${pilotId},array[${pidA}::bigint],${boss},${scopeVersion},'active')`));
  result.ids.scopeVersion = scopeVersion;

  const ownerBinding = (await withTenantTransaction(enterprise, tx => one(tx, sql`select id::text,conversation_id::text,user_id::text
    from app.construction_followup_bindings where enterprise_id=${enterprise} and project_id=${pidA}
    and audience='customer' and status='enabled'`)))!;
  await withTenantTransaction(enterprise, async tx => {
    const participant = await one(tx, sql`select id from app.assistant_participants where enterprise_id=${enterprise}
      and conversation_id=${String(ownerBinding.conversation_id)} and principal_kind='user' and user_id=${String(ownerBinding.user_id)}`);
    if (!participant) await tx.execute(sql`insert into app.assistant_participants
      (enterprise_id,conversation_id,principal_kind,user_id,grant_basis)
      values(${enterprise},${String(ownerBinding.conversation_id)},'user',${String(ownerBinding.user_id)},
        ${JSON.stringify({ kind: 'construction_followup', bindingId: String(ownerBinding.id) })}::jsonb)`);
  });

  // A new synthetic enterprise administrator creates a fresh boss binding, so
  // the same weekly period can queue a new report without touching existing
  // customer/boss reports or replacing the F2 fixture.
  const suffix = String(Date.now());
  const passwordHash = await bcrypt.hash('I745F41-Pass-' + suffix, 10);
  const bossName = 'F4.1 老板-' + suffix.slice(-6);
  const newBoss = await withPlatformTransaction(async tx => {
    const linked = await one(tx, sql`insert into app.users(enterprise_id,phone,nickname,role)
      values(${enterprise},${'19978' + String(Date.now()).slice(-6)},${bossName},'user') returning id::text`);
    const row = await one(tx, sql`insert into app.admin_users(enterprise_id,user_id,username,password_hash,display_name,role,status,must_change_password,menu_permissions,construction_trades)
      values(${enterprise},${String(linked!.id)},${'i745f41_' + suffix},${passwordHash},${bossName},'enterprise_admin','active',false,
      ARRAY(select jsonb_array_elements_text(${JSON.stringify(getDefaultMenuKeys('enterprise_admin'))}::jsonb)),ARRAY[]::text[])
      returning id::text`);
    return String(row!.id);
  });
  result.ids.newBoss = newBoss;

  const maxStage = (await withTenantTransaction(enterprise, tx => one(tx, sql`select coalesce(max(id),0)::text id
    from app.domain_event_outbox where enterprise_id=${enterprise} and type='construction.stage.updated.v1'`)))!;
  const settingsBefore = await withTenantTransaction(enterprise, tx => one(tx, sql`select *
    from app.construction_report_settings where enterprise_id=${enterprise}`));
  if (!settingsBefore) {
    await withTenantTransaction(enterprise, tx => tx.execute(sql`insert into app.construction_report_settings
      (enterprise_id,enabled,daily_time,weekly_time,weekly_day,project_ids,stage_keys,next_daily_at,next_weekly_at,
        stage_cursor,stage_enabled,audiences,inactive_policy,dispatch_epoch)
      values(${enterprise},true,'20:00','20:00',1,'[]'::jsonb,'[]'::jsonb,
        ${new Date(reportNow.getTime() + 86400000)},${new Date(reportNow.getTime() - 3600000)},
        ${String(maxStage.id)},false,'["customer","boss"]'::jsonb,'pause_inactive',1)`));
  } else {
    await withTenantTransaction(enterprise, tx => tx.execute(sql`update app.construction_report_settings set
      enabled=true,daily_time='20:00',weekly_time='20:00',weekly_day=1,project_ids='[]'::jsonb,stage_keys='[]'::jsonb,
      audiences='["customer","boss"]'::jsonb,next_daily_at=${new Date(reportNow.getTime() + 86400000)},
      next_weekly_at=${new Date(reportNow.getTime() - 3600000)},stage_cursor=${String(maxStage.id)},stage_enabled=false
      where enterprise_id=${enterprise}`));
  }
  result.ids.reportSettings = { before: settingsBefore };

  const service = new ConstructionService({ enterpriseId: enterprise, adminId: boss });
  const detail = (await service.execute('detail', { projectId: pidA })).project as Record<string, unknown>;
  await service.execute('progress', { projectId: pidA, expectedVersion: Number(detail.version),
    stageKey: 'painting', note: 'I7.4.5-F4.1 归一化到油漆', sendReminder: false }, randomUUID());
  const beforeAdvance = (await service.execute('detail', { projectId: pidA })).project as Record<string, unknown>;
  await service.execute('progress', { projectId: pidA, expectedVersion: Number(beforeAdvance.version),
    stageKey: 'furnishing', note: 'I7.4.5-F4.1 进入软装', sendReminder: false }, randomUUID());
  const detailAfter = (await service.execute('detail', { projectId: pidA })).project as Record<string, unknown>;
  result.ids.projects = { pilotProject: pidA, outsideProject: pidB, previousStage: detail.current_stage_key,
    pilotStage: detailAfter.current_stage_key };

  const maxReportId = (await withTenantTransaction(enterprise, tx => one(tx, sql`select coalesce(max(id),0)::int id
    from app.construction_reports where enterprise_id=${enterprise}`)))!.id;
  const reminderCutoff = (await withTenantTransaction(enterprise, tx => one(tx, sql`select
    coalesce(max(created_at),'1970-01-01'::timestamptz) cutoff from app.construction_stage_reminders
    where enterprise_id=${enterprise} and project_id=${pidA}`)))!.cutoff;
  const before = await counts();
  const previousSecret = process.env.CRON_SECRET;
  const secret = 'i745-f4-1-' + randomUUID();
  process.env.CRON_SECRET = secret;
  const calls = { knowledge: 0, assistant: 0, site: 0, consent: 0, portfolio: 0 };
  const deterministic = {
    advanceKnowledgeBatches: async () => { calls.knowledge += 1; return 0; },
    processAssistantJob: async () => { calls.assistant += 1; return { claimed: false }; },
    processAssistantRun: async () => undefined,
    deliverSiteNotifications: async () => { calls.site += 1; return 0; },
    deliverPublicConsents: async () => { calls.consent += 1; return 0; },
    processPortfolioCopy: async () => { calls.portfolio += 1; return false; },
  };
  const handlerAt = (now: Date) => createAssistantJobsPost({ now, env: unifiedEnv, ...deterministic });
  const post = (now: Date, options: { body?: string; secret?: string | null } = {}) => {
    const headers: Record<string, string> = {};
    if (options.secret !== null) headers['x-cron-secret'] = options.secret || secret;
    return handlerAt(now)(new Request('http://localhost/api/internal/assistant/jobs/run', {
      method: 'POST', headers, ...(options.body === undefined ? {} : { body: options.body }),
    }));
  };
  const payloadOf = async (response: Response) => await response.json() as {
    success: boolean; requestId: string; data: Record<string, unknown> };

  try {
    const first = await post(reportNow);
    const firstPayload = await payloadOf(first);
    const data = firstPayload.data;
    result.ids.firstRequestId = firstPayload.requestId;
    check('http.status_200', first.status === 200 && firstPayload.success === true
      && typeof firstPayload.requestId === 'string' ? 'passed' : 'failed',
      '完整 HTTP POST 返回 200 与请求 ID', { status: first.status, requestId: firstPayload.requestId });
    const alignment = data.pilotScopeAlignment as Record<string, unknown>;
    check('http.alignment', alignment.status === 'aligned' && alignment.mode === 'pilot'
      && alignment.enterpriseId === enterprise && alignment.pilotId === pilotId ? 'passed' : 'failed',
      '完整 HTTP tick 的 pilotScopeAlignment 为 aligned', alignment);

    const reminderChecks = data.stageReminderChecks as Record<string, unknown>;
    const reminderDelivery = data.stageReminderDeliveries as Record<string, unknown>;
    const reportChecks = data.constructionReportChecks as Record<string, unknown>;
    const reportDelivery = data.constructionReportDeliveries as Record<string, unknown>;
    check('http.four_workers', reminderChecks.mode === 'pilot' && Number(reminderChecks.created) > 0
      && reminderDelivery.mode === 'pilot' && Number(reminderDelivery.delivered) > 0
      && reportChecks.mode === 'pilot' && Number(reportChecks.queued) > 0
      && reportDelivery.mode === 'pilot' ? 'passed' : 'failed',
      '四项真实 Worker 均通过完整 HTTP tick 执行',
      { reminderChecks, reminderDelivery, reportChecks, reportDelivery, calls });
    check('http.scope_version', Number(reminderChecks.scopeVersion) === scopeVersion
      && Number(reportChecks.scopeVersion) === scopeVersion
      && Number(reminderDelivery.scopeVersion) === scopeVersion
      && Number(reportDelivery.scopeVersion) === scopeVersion ? 'passed' : 'failed',
      'HTTP 返回数据包含两条链路真实 scopeVersion', { scopeVersion,
        reminder: reminderChecks.scopeVersion, report: reportChecks.scopeVersion,
        reminderDelivery: reminderDelivery.scopeVersion, reportDelivery: reportDelivery.scopeVersion });

    const newReports = await withTenantTransaction(enterprise, tx => rows(tx, sql`select r.id::text report_id,r.kind,
      r.binding_id::text,b.audience,v.revision,v.run_id::text,v.status,v.facts,v.facts_hash,run.policy_snapshot
      from app.construction_reports r
      join app.construction_report_versions v on v.enterprise_id=r.enterprise_id and v.report_id=r.id and v.revision=r.latest_revision
      join app.assistant_runs run on run.enterprise_id=v.enterprise_id and run.id=v.run_id
      join app.construction_followup_bindings b on b.enterprise_id=r.enterprise_id and b.id=r.binding_id
      where r.enterprise_id=${enterprise} and r.id>${Number(maxReportId)} order by r.id`));
    const projectIds = (facts: unknown) => {
      const projects = (facts as { projects?: Array<{ id?: unknown }> } | null)?.projects;
      return Array.isArray(projects) ? projects.map(project => String(project.id)) : [];
    };
    const policyIds = (snapshot: unknown) => {
      const scope = (snapshot as { scope?: { project_ids?: unknown } } | null)?.scope;
      return Array.isArray(scope?.project_ids) ? scope!.project_ids!.map(String) : [];
    };
    check('report.generation', newReports.length === 1 && String(newReports[0].kind) === 'weekly'
      && Number(reportChecks.queued) === 1
      && JSON.stringify(policyIds(newReports[0].policy_snapshot)) === JSON.stringify([pidA])
      ? 'passed' : 'failed', '完整 HTTP tick 只为当前试点范围排入一份新周报',
      { queued: reportChecks.queued, reports: newReports.map(report => ({ reportId: report.report_id,
        audience: report.audience, revision: report.revision, runId: report.run_id, status: report.status })) });

    const newReminders = await withTenantTransaction(enterprise, tx => rows(tx, sql`select reminder_id,project_id::text,
      stage_id,status,conversation_id::text,message_id::text from app.construction_stage_reminders
      where enterprise_id=${enterprise} and project_id=${pidA} and stage_id='furnishing'
      and created_at > ${reminderCutoff} order by reminder_id`));
    const deliveredReminders = newReminders.filter(row => String(row.status) === 'delivered'
      && row.message_id && row.conversation_id);
    check('reminder.generation_delivery', newReminders.length > 0 && deliveredReminders.length > 0
      ? 'passed' : 'failed', '提醒生成与投递均落在当前 Scope 的项目 8',
      { reminders: newReminders.map(row => ({ reminderId: row.reminder_id, status: row.status,
        messageId: row.message_id, conversationId: row.conversation_id })) });

    const afterFirst = await counts();
    check('scope.outside_project', Number(afterFirst.reminders_b) === Number(before.reminders_b)
      ? 'passed' : 'failed', '范围外项目 9 没有新增提醒',
      { remindersB: { before: before.reminders_b, after: afterFirst.reminders_b } });

    // Facts are prepared across the normal Worker boundary; the HTTP handler
    // keeps its deterministic assistant-job stand-in so no unrelated queue item
    // is consumed.
    const factsRuns = await withTenantTransaction(enterprise, tx => rows(tx, sql`select id::text run_id
      from app.assistant_runs where enterprise_id=${enterprise} and purpose='construction.report.facts'
      and status in ('queued','running') order by id`));
    for (const run of factsRuns) {
      const lease = await claimJob({ enterpriseId: enterprise, runId: String(run.run_id) });
      if (lease) await processConstructionReport(lease);
    }
    const reportAfterFacts = await withTenantTransaction(enterprise, tx => rows(tx, sql`select r.id::text report_id,
      v.status,v.facts,v.facts_hash,b.audience from app.construction_reports r
      join app.construction_report_versions v on v.enterprise_id=r.enterprise_id and v.report_id=r.id and v.revision=r.latest_revision
      join app.construction_followup_bindings b on b.enterprise_id=r.enterprise_id and b.id=r.binding_id
      where r.enterprise_id=${enterprise} and r.id>${Number(maxReportId)} order by r.id`));
    check('report.facts_scope', reportAfterFacts.length === 1
      && String(reportAfterFacts[0].status) === 'facts_ready'
      && JSON.stringify(projectIds(reportAfterFacts[0].facts)) === JSON.stringify([pidA])
      ? 'passed' : 'failed', '新周报 facts 只包含当前试点项目 8',
      reportAfterFacts.map(report => ({ reportId: report.report_id, audience: report.audience,
        status: report.status, factsHash: report.facts_hash, projectIds: projectIds(report.facts) })));

    const second = await post(new Date(reportNow.getTime() + 60_000));
    const secondPayload = await payloadOf(second);
    const secondData = secondPayload.data;
    result.ids.secondRequestId = secondPayload.requestId;
    const secondReportDelivery = secondData.constructionReportDeliveries as Record<string, unknown>;
    const secondReminderDelivery = secondData.stageReminderDeliveries as Record<string, unknown>;
    check('http.delivery', second.status === 200
      && Number(secondReportDelivery.delivered) === 1 && Number(secondReminderDelivery.delivered) === 0
      ? 'passed' : 'failed', '第二次完整 HTTP tick 投递新周报且不重复投递提醒',
      { status: second.status, reportDelivery: secondReportDelivery,
        reminderDelivery: secondReminderDelivery });

    const deliveries = await withTenantTransaction(enterprise, tx => rows(tx, sql`select d.report_id::text,d.revision,
      d.state,d.message_id::text,m.conversation_id::text,b.audience from app.construction_report_deliveries d
      left join app.assistant_messages m on m.enterprise_id=d.enterprise_id and m.id=d.message_id
      join app.construction_followup_bindings b on b.enterprise_id=d.enterprise_id and b.id=d.binding_id
      where d.enterprise_id=${enterprise} and d.report_id>${Number(maxReportId)} order by d.report_id,d.revision`));
    const deliveredReports = deliveries.filter(row => String(row.state) === 'delivered');
    check('report.receipts', deliveredReports.length === 1
      && deliveredReports.every(row => row.message_id && row.conversation_id) ? 'passed' : 'failed',
      '新周报 delivered 带真实 messageId 与 conversationId',
      deliveredReports.map(row => ({ deliveryId: String(row.report_id) + ':' + String(row.revision),
        reportId: row.report_id, messageId: row.message_id, conversationId: row.conversation_id,
        audience: row.audience })));

    const afterSecond = await counts();
    const third = await post(new Date(reportNow.getTime() + 120_000));
    const thirdPayload = await payloadOf(third);
    result.ids.thirdRequestId = thirdPayload.requestId;
    const thirdData = thirdPayload.data;
    const thirdReportDelivery = thirdData.constructionReportDeliveries as Record<string, unknown>;
    const thirdReportChecks = thirdData.constructionReportChecks as Record<string, unknown>;
    const thirdReminderDelivery = thirdData.stageReminderDeliveries as Record<string, unknown>;
    const afterThird = await counts();
    check('http.repeat_idempotent', third.status === 200
      && Number(thirdReportChecks.queued) === 0 && Number(thirdReportDelivery.delivered) === 0
      && Number(thirdReminderDelivery.delivered) === 0
      && JSON.stringify(afterSecond) === JSON.stringify(afterThird) ? 'passed' : 'failed',
      '重复完整 HTTP POST 不新增提醒、周报或消息',
      { status: third.status, queued: thirdReportChecks.queued, reportDelivery: thirdReportDelivery,
        reminderDelivery: thirdReminderDelivery, before: afterSecond, after: afterThird });

    const scopeNow = await withTenantTransaction(enterprise, tx => one(tx, sql`select scope_version,status,
      project_ids::text from app.xiaok_pilot_project_scopes where enterprise_id=${enterprise} and pilot_id=${pilotId}
      order by scope_version desc limit 1`));
    check('scope.database_latest', Number(scopeNow?.scope_version) === scopeVersion
      && JSON.stringify(scopeNow?.project_ids) === JSON.stringify('{' + pidA + '}') ? 'passed' : 'failed',
      '数据库最新 active 范围版本与 HTTP 返回一致，项目范围仅 [8]', { database: scopeNow,
        http: { reminder: reminderChecks.scopeVersion, report: reportChecks.scopeVersion } });

    const allReports = await withTenantTransaction(enterprise, tx => rows(tx, sql`select r.id::text report_id,
      v.facts from app.construction_reports r
      join app.construction_report_versions v on v.enterprise_id=r.enterprise_id and v.report_id=r.id and v.revision=r.latest_revision
      where r.enterprise_id=${enterprise} order by r.id`));
    check('report.no_outside_project', allReports.every(report => projectIds(report.facts).every(id => id === pidA))
      ? 'passed' : 'failed', '所有周报 facts 均不含范围外项目 9',
      allReports.map(report => ({ reportId: report.report_id, projectIds: projectIds(report.facts) })));

    const unauthorized = await post(reportNow, { secret: null });
    check('http.unauthorized', unauthorized.status === 401 ? 'passed' : 'failed',
      '未授权 POST 返回 401', { status: unauthorized.status });
    const invalid = await post(reportNow, { body: 'unexpected' });
    check('http.invalid_body', invalid.status === 422 ? 'passed' : 'failed',
      '错误请求体返回 422', { status: invalid.status });
    const failing = createAssistantJobsPost({ now: reportNow, env: unifiedEnv,
      advanceKnowledgeBatches: async () => { throw new Error('knowledge_down'); } });
    const unavailable = await failing(new Request('http://localhost/api/internal/assistant/jobs/run', {
      method: 'POST', headers: { 'x-cron-secret': secret },
    }));
    check('http.failure', unavailable.status === 503 ? 'passed' : 'failed',
      'Worker 异常返回 503', { status: unavailable.status });

    result.ids.final = {
      counts: afterThird,
      report: reportAfterFacts.map(report => ({ reportId: report.report_id, audience: report.audience,
        factsHash: report.facts_hash, projectIds: projectIds(report.facts) })),
      deliveries: deliveredReports.map(row => ({ deliveryId: String(row.report_id) + ':' + String(row.revision),
        reportId: row.report_id, messageId: row.message_id, conversationId: row.conversation_id })),
      reminders: deliveredReminders.map(row => ({ reminderId: row.reminder_id,
        messageId: row.message_id, conversationId: row.conversation_id })),
      calls,
    };
    check('limits.notifications', 'not_run', '未发送真实微信/订阅通知，也未部署生产');
  } finally {
    if (previousSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previousSecret;
  }
  await closePostgresPool();
}

main().catch(error => {
  result.error = (error as Error).stack || String(error);
  check('run.completed', 'failed', '验收脚本执行失败', { error: (error as Error).message });
}).finally(() => {
  result.finishedAt = new Date().toISOString();
  save();
  console.log(JSON.stringify({ output, runId: result.runId,
    passed: result.checks.filter(item => item.status === 'passed').length,
    failed: result.checks.filter(item => item.status === 'failed').length,
    limited: result.checks.filter(item => item.status === 'limited').length,
    not_run: result.checks.filter(item => item.status === 'not_run').length }));
});
