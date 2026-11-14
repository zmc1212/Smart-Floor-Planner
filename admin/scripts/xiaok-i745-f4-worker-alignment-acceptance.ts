/** I7.4.5-F4 real PostgreSQL 17 acceptance for the unified reminder and weekly
 * report Worker configuration. Reuses the F1/F2 isolated database and the F2
 * synthetic enterprise/pilot. It never sends a real notification. */
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
  || '../tmp/xiaok-i745-f4/run-' + Date.now());
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
  const { runAssistantJobsTick } = await import('@/lib/assistant/infrastructure/jobs-tick');
  const { advanceConfiguredStageReminders, deliverConfiguredStageReminders } =
    await import('@/lib/xiaok-v1/stage-reminder-worker');
  const { advanceConfiguredConstructionReports, deliverConfiguredConstructionReports } =
    await import('@/lib/construction/report-worker');
  const { POST } = await import('@/app/api/internal/assistant/jobs/run/route');

  const identity = (await withPlatformTransaction(tx => one(tx, sql`select current_user usr,current_database() db,
    version() ver,(select rolsuper from pg_roles where rolname=current_user) super`)))!;
  assert.equal(identity.usr, 'sfp_app'); assert.equal(identity.db, 'i745_f1_accept'); assert.equal(identity.super, false);
  result.ids.environment = identity;
  const rls = await withPlatformTransaction(tx => rows(tx, sql`select c.relname,c.relrowsecurity rls,c.relforcerowsecurity forced
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='app'
    and c.relname in ('xiaok_pilot_project_scopes','construction_stage_reminders','construction_report_settings',
      'construction_reports','construction_report_versions','construction_report_deliveries','assistant_messages') order by 1`));
  check('env.pg17_rls', rls.length === 7 && rls.every(row => row.rls === true && row.forced === true)
    ? 'passed' : 'failed', '复用 F1/F2 PG17.10 数据库，sfp_app 非超级用户且强制 RLS', { identity, rls });

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
  const mismatchEnv = {
    ...unifiedEnv,
    XIAOK_WEEKLY_REPORT_MODE: 'enterprise',
  };
  result.ids.config = { enterpriseId: enterprise, pilotId,
    unified: { reminderMode: 'pilot', weeklyMode: 'pilot' },
    mismatch: { reminderMode: 'pilot', weeklyMode: 'enterprise' } };

  const counts = async () => (await withTenantTransaction(enterprise, tx => one(tx, sql`select
    (select count(*)::int from app.construction_stage_reminders where enterprise_id=${enterprise} and project_id=${pidA}) reminders_a,
    (select count(*)::int from app.construction_stage_reminders where enterprise_id=${enterprise} and project_id=${pidB}) reminders_b,
    (select count(*)::int from app.construction_reports where enterprise_id=${enterprise}) reports,
    (select count(*)::int from app.construction_report_deliveries where enterprise_id=${enterprise}) deliveries,
    (select count(*)::int from app.assistant_messages where enterprise_id=${enterprise}) messages,
    (select count(*)::int from app.domain_event_outbox where enterprise_id=${enterprise}) outbox`)))!;
  const before = await counts();
  const queuedJobs = await withPlatformTransaction(tx => one(tx, sql`select count(*)::int n from app.assistant_jobs
    where status in ('queued','running')`));
  check('env.quiet_queue', Number(queuedJobs?.n) === 0 ? 'passed' : 'limited',
    '完整 Route 验收前确认没有待处理 Assistant Job，避免处理无关任务', { queuedJobs: queuedJobs?.n });

  // ---------------------------------------------------------------- real Route
  // The mismatch path skips all four pilot workers, so it is safe to run the
  // complete HTTP Route before adding the unified fixture.
  const previousSecret = process.env.CRON_SECRET;
  Object.assign(process.env, mismatchEnv);
  let unauthorizedStatus: number | null = null;
  try {
    delete process.env.CRON_SECRET;
    unauthorizedStatus = (await POST(new Request('http://localhost/api/internal/assistant/jobs/run', {
      method: 'POST' }))).status;
  } finally {
    if (previousSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previousSecret;
  }
  check('route.unauthorized', unauthorizedStatus === 401 ? 'passed' : 'failed',
    '未携带 Worker 密钥的请求在任何任务前返回 401', { status: unauthorizedStatus });

  const secret = 'i745-f4-' + randomUUID();
  process.env.CRON_SECRET = secret;
  const routeResponse = await POST(new Request('http://localhost/api/internal/assistant/jobs/run', {
    method: 'POST', headers: { 'x-cron-secret': secret } }));
  const routePayload = await routeResponse.json() as { success?: boolean; requestId?: string;
    data?: Record<string, unknown> };
  const routeData = routePayload.data || {};
  const routeCounts = await counts();
  result.ids.route = { requestId: routePayload.requestId, status: routeResponse.status };
  check('route.mismatch_http', routeResponse.status === 200 && routePayload.success === true
    && (routeData.pilotScopeAlignment as Record<string, unknown> | undefined)?.status === 'mismatch'
    ? 'passed' : 'failed', '真实 Route 在提醒 pilot、周报 enterprise 时返回 200 并记录配置不一致',
    { requestId: routePayload.requestId, status: routeResponse.status,
      alignment: routeData.pilotScopeAlignment });
  check('route.mismatch_zero_workers', ['constructionReportChecks', 'stageReminderChecks',
    'constructionReportDeliveries', 'stageReminderDeliveries'].every(key => {
    const value = routeData[key] as Record<string, unknown> | undefined;
    return value?.skipped === true && value?.reason === 'pilot_worker_alignment'
      && value?.errorCode === 'pilot_worker_mode_mismatch';
  }) ? 'passed' : 'failed', '四项 Worker 在真实 Route 中全部跳过且无企业回退',
  { constructionReportChecks: routeData.constructionReportChecks,
    stageReminderChecks: routeData.stageReminderChecks,
    constructionReportDeliveries: routeData.constructionReportDeliveries,
    stageReminderDeliveries: routeData.stageReminderDeliveries });
  const routeOthers = { claimed: routeData.claimed, inAppDeliveries: routeData.inAppDeliveries,
    knowledgeBatchChecks: routeData.knowledgeBatchChecks, nativeWorkflowSchedule: routeData.nativeWorkflowSchedule,
    nativeWorkflowDelegations: routeData.nativeWorkflowDelegations, nativeWorkflowTools: routeData.nativeWorkflowTools };
  check('route.other_jobs', routeResponse.status === 200 && countsUnchanged(before, routeCounts)
    ? 'passed' : 'failed', '配置不一致时其他 Assistant Job 继续执行且试点业务数据零变化',
    { others: routeOthers, before, after: routeCounts });
  delete process.env.CRON_SECRET;

  function countsUnchanged(left: Record<string, unknown>, right: Record<string, unknown>) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  // ------------------------------------------------------------ unified fixture
  const latestScope = (await withTenantTransaction(enterprise, tx => one(tx, sql`select scope_version,status,
    project_ids::text from app.xiaok_pilot_project_scopes where enterprise_id=${enterprise} and pilot_id=${pilotId}
    order by scope_version desc limit 1`)))!;
  const scopeVersion = Number(latestScope.scope_version) + 1;
  await withTenantTransaction(enterprise, tx => tx.execute(sql`insert into app.xiaok_pilot_project_scopes
    (enterprise_id,pilot_id,project_ids,created_by,scope_version,status)
    values(${enterprise},${pilotId},array[${pidA}::bigint],${boss},${scopeVersion},'active')`));
  result.ids.scopeVersion = scopeVersion;
  result.ids.previousScope = latestScope;

  // F2 created the owner inbox rows directly, so the synthetic owner
  // conversation has no participant. The report facts path authorizes the
  // conversation through that participant; add the same row that
  // ensureFollowupBinding() would have created. No conversation is replaced.
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
  result.ids.ownerBinding = ownerBinding;

  const settingsBefore = await withTenantTransaction(enterprise, tx => one(tx, sql`select *
    from app.construction_report_settings where enterprise_id=${enterprise}`));
  const maxStage = (await withTenantTransaction(enterprise, tx => one(tx, sql`select coalesce(max(id),0)::text id
    from app.domain_event_outbox where enterprise_id=${enterprise} and type='construction.stage.updated.v1'`)))!;
  if (!settingsBefore) {
    await withTenantTransaction(enterprise, tx => tx.execute(sql`insert into app.construction_report_settings
      (enterprise_id,enabled,daily_time,weekly_time,weekly_day,project_ids,stage_keys,next_daily_at,next_weekly_at,
        stage_cursor,stage_enabled,audiences,inactive_policy,dispatch_epoch)
      values(${enterprise},true,'20:00','20:00',1,'[]'::jsonb,'[]'::jsonb,
        ${new Date(reportNow.getTime() + 86400000)},${new Date(reportNow.getTime() - 3600000)},
        ${String(maxStage.id)},false,'["customer","boss"]'::jsonb,'pause_inactive',1)`));
  } else {
    await withTenantTransaction(enterprise, tx => tx.execute(sql`update app.construction_report_settings set
      enabled=true,project_ids='[]'::jsonb,stage_keys='[]'::jsonb,audiences='["customer","boss"]'::jsonb,
      next_daily_at=${new Date(reportNow.getTime() + 86400000)},next_weekly_at=${new Date(reportNow.getTime() - 3600000)},
      stage_cursor=${String(maxStage.id)},stage_enabled=false where enterprise_id=${enterprise}`));
  }
  const settingsAfter = await withTenantTransaction(enterprise, tx => one(tx, sql`select project_ids,audiences,
    next_weekly_at,stage_enabled from app.construction_report_settings where enterprise_id=${enterprise}`));
  result.ids.reportSettings = { before: settingsBefore, after: settingsAfter };

  const service = new ConstructionService({ enterpriseId: enterprise, adminId: boss });
  const detail = (await service.execute('detail', { projectId: pidA })).project as Record<string, unknown>;
  // Reports only cover projects before completion/move_in, so the synthetic
  // project is normalized to 油漆 and then advanced to 软装. This produces a
  // fresh stage event for reminders while staying report-eligible.
  await service.execute('progress', { projectId: pidA, expectedVersion: Number(detail.version),
    stageKey: 'painting', note: 'I7.4.5-F4 统一 Worker 验收归一化到油漆', sendReminder: false }, randomUUID());
  const beforeAdvance = (await service.execute('detail', { projectId: pidA })).project as Record<string, unknown>;
  await service.execute('progress', { projectId: pidA, expectedVersion: Number(beforeAdvance.version),
    stageKey: 'furnishing', note: 'I7.4.5-F4 统一 Worker 验收进入软装', sendReminder: false }, randomUUID());
  const detailAfter = (await service.execute('detail', { projectId: pidA })).project as Record<string, unknown>;
  const detailB = (await service.execute('detail', { projectId: pidB })).project as Record<string, unknown>;
  const stageKey = 'furnishing';
  result.ids.projects = { pilotProject: pidA, outsideProject: pidB, previousStage: detail.current_stage_key,
    pilotStage: detailAfter.current_stage_key, outsideStage: detailB.current_stage_key };

  const beforeTick = await counts();
  Object.assign(process.env, unifiedEnv);
  const stubbed = {
    advanceKnowledgeBatches: async () => 0,
    processAssistantJob: async () => ({ claimed: false }),
    processAssistantRun: async () => undefined,
    deliverSiteNotifications: async () => 0,
    deliverPublicConsents: async () => 0,
    processPortfolioCopy: async () => false,
  };
  const firstTick = await runAssistantJobsTick({ now: reportNow, env: unifiedEnv, ...stubbed });
  result.ids.workerRequestId = result.runId;
  check('tick1.alignment', firstTick.pilotScopeAlignment.status === 'aligned'
    && firstTick.pilotScopeAlignment.mode === 'pilot'
    && firstTick.pilotScopeAlignment.enterpriseId === enterprise
    && firstTick.pilotScopeAlignment.pilotId === pilotId ? 'passed' : 'failed',
    '统一配置下两条链路解析到相同 enterpriseId 与 pilotId',
    { alignment: firstTick.pilotScopeAlignment, requestId: result.runId });

  const reminderChecks = firstTick.stageReminderChecks as Record<string, unknown>;
  check('tick1.reminder_generation', reminderChecks.mode === 'pilot' && reminderChecks.pilotId === pilotId
    && Number(reminderChecks.scopeVersion) === scopeVersion && reminderChecks.scopeStatus === 'active'
    && Number(reminderChecks.created) > 0 ? 'passed' : 'failed',
    '提醒链路读取最新 scopeVersion 并在试点内项目生成提醒', reminderChecks);
  const reportChecks = firstTick.constructionReportChecks as Record<string, unknown>;
  check('tick1.report_generation', reportChecks.mode === 'pilot' && reportChecks.pilotId === pilotId
    && Number(reportChecks.scopeVersion) === scopeVersion && reportChecks.scopeStatus === 'active'
    && Number(reportChecks.scopedProjects) === 1 && Number(reportChecks.queued) === 2
    && (reportChecks.errors as unknown[] | undefined)?.length === 0 ? 'passed' : 'failed',
    '周报链路读取最新 scopeVersion 并只为试点项目排入业主与老板周报', reportChecks);
  const reminderDelivery = firstTick.stageReminderDeliveries as Record<string, unknown>;
  check('tick1.reminder_delivery', reminderDelivery.mode === 'pilot' && reminderDelivery.pilotId === pilotId
    && Number(reminderDelivery.scopeVersion) === scopeVersion && Number(reminderDelivery.delivered) > 0
    ? 'passed' : 'failed', '提醒链路在同一 tick 正常投递试点内提醒', reminderDelivery);

  // Prepare report facts exactly like the normal Worker would across ticks.
  // The acceptance claims only this fixture's facts runs; no unrelated job is
  // processed.
  const factsRuns = await withTenantTransaction(enterprise, tx => rows(tx, sql`select id::text run_id
    from app.assistant_runs where enterprise_id=${enterprise} and purpose='construction.report.facts'
    and status in ('queued','running') order by id`));
  for (const run of factsRuns) {
    const lease = await claimJob({ enterpriseId: enterprise, runId: String(run.run_id) });
    if (lease) await processConstructionReport(lease);
  }

  const reports = await withTenantTransaction(enterprise, tx => rows(tx, sql`select r.id::text report_id,r.kind,
    r.binding_id::text,b.audience,v.revision,v.run_id::text,v.facts,v.facts_hash,v.status,run.policy_snapshot
    from app.construction_reports r
    join app.construction_report_versions v on v.enterprise_id=r.enterprise_id and v.report_id=r.id and v.revision=r.latest_revision
    join app.assistant_runs run on run.enterprise_id=v.enterprise_id and run.id=v.run_id
    join app.construction_followup_bindings b on b.enterprise_id=r.enterprise_id and b.id=r.binding_id
    where r.enterprise_id=${enterprise} and r.kind='weekly' order by r.id`));
  const projectIds = (facts: unknown) => {
    const projects = (facts as { projects?: Array<{ id?: unknown }> } | null)?.projects;
    return Array.isArray(projects) ? projects.map(project => String(project.id)) : [];
  };
  const policyIds = (snapshot: unknown) => {
    const scope = (snapshot as { scope?: { project_ids?: unknown } } | null)?.scope;
    return Array.isArray(scope?.project_ids) ? scope!.project_ids!.map(String) : [];
  };
  const weekly = reports.filter(report => String(report.report_id) !== '');
  check('facts.reports_only_pilot', weekly.length === 2
    && weekly.every(report => projectIds(report.facts).length === 1 && projectIds(report.facts)[0] === pidA)
    && weekly.every(report => JSON.stringify(policyIds(report.policy_snapshot)) === JSON.stringify([pidA]))
    ? 'passed' : 'failed', '业主与老板周报 facts 和 policy snapshot 只包含试点项目 ' + pidA,
    { weekly: weekly.map(report => ({ reportId: report.report_id, audience: report.audience,
      revision: report.revision, runId: report.run_id, factsHash: report.facts_hash,
      projectIds: projectIds(report.facts), policyProjectIds: policyIds(report.policy_snapshot) })) });

  const secondTick = await runAssistantJobsTick({ now: reportNow, env: unifiedEnv, ...stubbed });
  const reportDelivery = secondTick.constructionReportDeliveries as Record<string, unknown>;
  const secondReminderDelivery = secondTick.stageReminderDeliveries as Record<string, unknown>;
  check('tick2.report_delivery', reportDelivery.mode === 'pilot' && reportDelivery.pilotId === pilotId
    && Number(reportDelivery.scopeVersion) === scopeVersion && Number(reportDelivery.delivered) === 2
    ? 'passed' : 'failed', '周报链路在同一企业/试点下读取最新 scopeVersion 并投递两份周报', reportDelivery);
  check('tick2.reminder_delivery', secondReminderDelivery.scopeVersion !== undefined
    && Number(secondReminderDelivery.scopeVersion) === scopeVersion ? 'passed' : 'failed',
    '提醒投递同样读取最新 scopeVersion', secondReminderDelivery);

  const deliveries = await withTenantTransaction(enterprise, tx => rows(tx, sql`select
    d.report_id::text,d.revision,d.state,d.message_id::text,m.conversation_id::text,b.audience
    from app.construction_report_deliveries d
    left join app.assistant_messages m on m.enterprise_id=d.enterprise_id and m.id=d.message_id
    join app.construction_followup_bindings b on b.enterprise_id=d.enterprise_id and b.id=d.binding_id
    where d.enterprise_id=${enterprise} order by d.report_id,d.revision`));
  const deliveredReports = deliveries.filter(row => String(row.state) === 'delivered');
  check('delivery.receipts', deliveredReports.length >= 2
    && deliveredReports.every(row => row.message_id && row.conversation_id) ? 'passed' : 'failed',
    '周报 delivered 均有真实 messageId 与 conversationId',
    deliveredReports.map(row => ({ deliveryId: String(row.report_id) + ':' + String(row.revision),
      reportId: row.report_id, messageId: row.message_id, conversationId: row.conversation_id,
      audience: row.audience })));

  const reminders = await withTenantTransaction(enterprise, tx => rows(tx, sql`select reminder_id,project_id::text,
    stage_id,trigger_type,target_role,status,conversation_id::text,message_id::text
    from app.construction_stage_reminders where enterprise_id=${enterprise}
    and project_id in (${pidA},${pidB}) order by reminder_id`));
  const newRemindersA = reminders.filter(row => String(row.project_id) === pidA
    && String(row.stage_id) === stageKey);
  const deliveredRemindersA = newRemindersA.filter(row => String(row.status) === 'delivered'
    && row.message_id && row.conversation_id);
  check('reminder.receipts', newRemindersA.length > 0 && deliveredRemindersA.length > 0
    ? 'passed' : 'failed', '新阶段提醒写入真实站内会话并带 messageId',
    deliveredRemindersA.map(row => ({ reminderId: row.reminder_id, messageId: row.message_id,
      conversationId: row.conversation_id, role: row.target_role })));

  // ---------------------------------------------------- latest scope version
  const scopeNow = await withTenantTransaction(enterprise, tx => one(tx, sql`select scope_version,status,
    project_ids::text from app.xiaok_pilot_project_scopes where enterprise_id=${enterprise} and pilot_id=${pilotId}
    order by scope_version desc limit 1`));
  check('scope.latest_read', Number(scopeNow?.scope_version) === scopeVersion
    && Number(reminderChecks.scopeVersion) === scopeVersion && Number(reportChecks.scopeVersion) === scopeVersion
    && Number(reportDelivery.scopeVersion) === scopeVersion ? 'passed' : 'failed',
    '两条链路都读取数据库最新 active 范围版本，真实项目范围仅 [' + pidA + ']',
    { databaseScope: scopeNow, reminderScopeVersion: reminderChecks.scopeVersion,
      reportScopeVersion: reportChecks.scopeVersion, deliveryScopeVersion: reportDelivery.scopeVersion });

  // -------------------------------------------------------- outside scope
  const afterTicks = await counts();
  const outsideReports = weekly.filter(report => projectIds(report.facts).some(id => id === pidB));
  check('scope.outside_project', outsideReports.length === 0
    && Number(afterTicks.reminders_b) === Number(beforeTick.reminders_b) ? 'passed' : 'failed',
    '范围外项目 9 没有新增提醒或周报',
    { remindersB: { before: beforeTick.reminders_b, after: afterTicks.reminders_b },
      reportsWithOutsideProject: outsideReports.length });

  // ------------------------------------------------------- repeated tick
  const thirdTick = await runAssistantJobsTick({ now: reportNow, env: unifiedEnv, ...stubbed });
  const thirdReminder = thirdTick.stageReminderChecks as Record<string, unknown>;
  const thirdReminderDelivery = thirdTick.stageReminderDeliveries as Record<string, unknown>;
  const thirdReport = thirdTick.constructionReportChecks as Record<string, unknown>;
  const thirdReportDelivery = thirdTick.constructionReportDeliveries as Record<string, unknown>;
  const afterRepeat = await counts();
  check('tick3.idempotent', Number(thirdReminderDelivery.delivered) === 0
    && Number(thirdReport.queued) === 0 && Number(thirdReportDelivery.delivered) === 0
    && countsUnchanged(afterTicks, afterRepeat)
    ? 'passed' : 'failed', '重复统一 tick 不重复生成或投递业务副作用',
    { thirdReminder, thirdReminderDelivery, thirdReport, thirdReportDelivery,
      before: afterTicks, after: afterRepeat });

  // --------------------------------------------------- mismatch after data
  Object.assign(process.env, mismatchEnv);
  const calls = { advanceReminders: 0, deliverReminders: 0, advanceReports: 0, deliverReports: 0,
    knowledge: 0, assistant: 0 };
  const mismatchTick = await runAssistantJobsTick({
    now: new Date(reportNow.getTime() + 60000), env: mismatchEnv,
    advanceKnowledgeBatches: async () => { calls.knowledge += 1; return 0; },
    processAssistantJob: async () => { calls.assistant += 1; return { claimed: false }; },
    processAssistantRun: async () => undefined,
    deliverSiteNotifications: async () => 0,
    deliverPublicConsents: async () => 0,
    processPortfolioCopy: async () => false,
    advanceConfiguredStageReminders: async input => {
      calls.advanceReminders += 1; return advanceConfiguredStageReminders(input);
    },
    deliverConfiguredStageReminders: async input => {
      calls.deliverReminders += 1; return deliverConfiguredStageReminders(input);
    },
    advanceConfiguredConstructionReports: async input => {
      calls.advanceReports += 1; return advanceConfiguredConstructionReports(input);
    },
    deliverConfiguredConstructionReports: async input => {
      calls.deliverReports += 1; return deliverConfiguredConstructionReports(input);
    },
  });
  const afterMismatch = await counts();
  check('mismatch.zero_calls', mismatchTick.pilotScopeAlignment.status === 'mismatch'
    && mismatchTick.pilotScopeAlignment.errorCode === 'pilot_worker_mode_mismatch'
    && [calls.advanceReminders, calls.deliverReminders, calls.advanceReports, calls.deliverReports]
      .every(count => count === 0) ? 'passed' : 'failed',
    '配置不一致 tick 中四项 Worker 调用次数均为 0，不回退 enterprise',
    { alignment: mismatchTick.pilotScopeAlignment, calls });
  check('mismatch.no_side_effect', countsUnchanged(afterRepeat, afterMismatch) ? 'passed' : 'failed',
    '配置不一致 tick 后提醒、周报、投递、消息与 Outbox 均无新增',
    { before: afterRepeat, after: afterMismatch });
  check('mismatch.other_jobs', calls.knowledge === 1 && calls.assistant === 1 ? 'passed' : 'failed',
    '配置不一致时 Knowledge Batch 与 Assistant Job 仍各执行一次', { calls });
  check('mismatch.responses', ['constructionReportChecks', 'stageReminderChecks',
    'constructionReportDeliveries', 'stageReminderDeliveries'].every(key => {
    const value = mismatchTick[key as keyof typeof mismatchTick] as Record<string, unknown>;
    return value?.skipped === true && value?.reason === 'pilot_worker_alignment'
      && value?.errorCode === 'pilot_worker_mode_mismatch';
  }) ? 'passed' : 'failed', '四项响应均明确标记 skipped 与 pilot_worker_alignment',
  { constructionReportChecks: mismatchTick.constructionReportChecks,
    stageReminderChecks: mismatchTick.stageReminderChecks,
    constructionReportDeliveries: mismatchTick.constructionReportDeliveries,
    stageReminderDeliveries: mismatchTick.stageReminderDeliveries });

  const finalReminders = await withTenantTransaction(enterprise, tx => one(tx, sql`select
    count(*)::int total, count(*) filter (where status='delivered')::int delivered,
    count(*) filter (where status='failed')::int failed from app.construction_stage_reminders where enterprise_id=${enterprise}`));
  result.ids.final = { counts: afterMismatch, reminders: finalReminders,
    reports: weekly.map(report => ({ reportId: report.report_id, audience: report.audience,
      revision: report.revision, runId: report.run_id, factsHash: report.facts_hash })),
    deliveries: deliveredReports.map(row => ({ deliveryId: row.delivery_id, reportId: row.report_id,
      messageId: row.message_id, conversationId: row.conversation_id })),
    reminderMessages: deliveredRemindersA.map(row => ({ reminderId: row.reminder_id,
      messageId: row.message_id, conversationId: row.conversation_id })) };

  check('limits.notifications', 'not_run', '未发送真实微信/订阅通知，也未部署生产');
  check('limits.full_route_aligned', 'limited',
    '统一配置下的四项任务使用真实业务入口与真实数据库、通过 Worker 编排函数执行；完整 HTTP Route 仅在配置不一致路径做真实执行，因为其时钟不可注入且会处理无关排队任务');
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
