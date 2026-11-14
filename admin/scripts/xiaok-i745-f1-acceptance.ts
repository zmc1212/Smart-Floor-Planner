/** I7.4.5-F1 real PostgreSQL 17 acceptance for two-project weekly report
 * scope isolation. It refuses any database other than the dedicated local
 * i745_f1_accept target and never sends a real notification. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import type { Row } from '@/db/repositories/assistant-repository';

const admin = path.resolve(process.cwd());
loadEnvConfig(admin, true);
const connectionFile = path.resolve(admin, '..', 'tmp/xiaok-i745-f1/connection.private.json');
if (!fs.existsSync(connectionFile)) throw new Error('Missing tmp/xiaok-i745-f1/connection.private.json');
const connections = JSON.parse(fs.readFileSync(connectionFile, 'utf8')) as { DATABASE_URL: string; MIGRATION_URL: string };
const target = new URL(connections.DATABASE_URL);
if (target.hostname !== '127.0.0.1' || target.port !== '55432' || target.pathname !== '/i745_f1_accept'
  || target.username !== 'sfp_app') {
  throw new Error('Use only 127.0.0.1:55432/i745_f1_accept as sfp_app');
}
process.env.DATABASE_URL = connections.DATABASE_URL;

type CheckStatus = 'passed' | 'failed' | 'limited' | 'not_run' | 'unknown';
const output = path.resolve(process.argv.find(value => value.startsWith('--output='))?.slice(9)
  || '../tmp/xiaok-i745-f1/acceptance-' + Date.now());
assert.ok(!fs.existsSync(path.join(output, 'result.json')), 'Preserve every original outcome');
fs.mkdirSync(output, { recursive: true });
const result: {
  startedAt: string; finishedAt?: string; database: string; user: string; checks: Array<{ id: string; status: CheckStatus;
    detail: string; evidence?: unknown }>; ids: Record<string, unknown>; error?: string;
} = { startedAt: new Date().toISOString(), database: 'i745_f1_accept', user: 'sfp_app', checks: [], ids: {} };
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
  const { getDefaultMenuKeys } = await import('@/lib/admin-user-roles');
  const { ConstructionService } = await import('@/lib/construction/service');
  const { SiteChatService, recordVersion } = await import('@/lib/construction/site-chat');
  const { advanceConfiguredConstructionReports, processConstructionReport,
    deliverConfiguredConstructionReports } =
    await import('@/lib/construction/report-worker');
  const { processAssistantJob, runContext, failRun } = await import('@/lib/assistant/infrastructure/job-queue');
  const { appendMessage } = await import('@/lib/assistant/core/conversation');
  const bcrypt = (await import('bcryptjs')).default;
  const pg = (await import('pg')).default;

  const identity = (await withPlatformTransaction(tx => one(tx, sql`select current_user usr,current_database() db,
    version() ver,(select rolsuper from pg_roles where rolname=current_user) super`)))!;
  assert.equal(identity.usr, 'sfp_app'); assert.equal(identity.db, 'i745_f1_accept'); assert.equal(identity.super, false);
  result.ids.environment = identity;
  const rls = await withPlatformTransaction(tx => rows(tx, sql`select c.relname,c.relrowsecurity rls,c.relforcerowsecurity forced
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='app'
    and c.relname in ('xiaok_pilot_project_scopes','construction_report_settings','construction_reports',
      'construction_report_versions','construction_report_deliveries','assistant_messages') order by 1`));
  check('env.pg17_rls', rls.every(row => row.rls === true && row.forced === true) ? 'passed' : 'failed',
    'PG17 非超级用户 sfp_app，强制 RLS 生效', { identity, rls });

  // Fixed acceptance clock: the weekly period is Monday 2026-11-09 to Monday
  // 2026-11-16. Synthetic records are written before that boundary.
  const reportNow = new Date('2026-11-16T20:00:00+08:00');
  const reportNow2 = new Date(reportNow.getTime() + 60_000);
  const periodStart = new Date('2026-11-09T00:00:00+08:00');
  const periodEnd = new Date('2026-11-16T00:00:00+08:00');
  const suffix = String(Date.now());
  const passwordHash = await bcrypt.hash('I745-Pass-' + suffix, 10);
  let phoneSeq = 0;
  const nextPhone = () => '19974' + String(++phoneSeq).padStart(6, '0');

  const createEnterprise = (name: string) => withPlatformTransaction(async tx => {
    const row = await one(tx, sql`insert into app.enterprises(name,code,status,registration_mode)
      values(${name},${'i745-' + suffix + '-' + randomUUID().slice(0, 8)},'active','manual') returning id::text`);
    const eid = String(row!.id);
    await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,retention_days,daily_requests,daily_tokens,daily_cost_micros)
      values(${eid},true,365,100000,1000000000,1000000000)`);
    return eid;
  });
  const createUser = (eid: string, name: string) => withPlatformTransaction(async tx => String((await one(tx,
    sql`insert into app.users(enterprise_id,phone,nickname,role) values(${eid},${nextPhone()},${name},'user') returning id::text`))!.id));
  const createAdmin = (eid: string, role: string, name: string, index: number) => withPlatformTransaction(async tx => {
    const linked = await one(tx, sql`insert into app.users(enterprise_id,nickname,role) values(${eid},${name},'user') returning id::text`);
    const row = await one(tx, sql`insert into app.admin_users(enterprise_id,user_id,username,password_hash,display_name,role,status,must_change_password,menu_permissions,construction_trades)
      values(${eid},${String(linked!.id)},${'i745_' + suffix + '_' + index},${passwordHash},${name},${role},'active',false,
      ARRAY(select jsonb_array_elements_text(${JSON.stringify(getDefaultMenuKeys(role))}::jsonb)),ARRAY[]::text[]) returning id::text`);
    return String(row!.id);
  });
  const createProject = async (eid: string, bossId: string, managerId: string, ownerId: string, name: string,
    rooms: string[]) => {
    const leadId = await withTenantTransaction(eid, async tx => String((await one(tx, sql`insert into app.leads
      (enterprise_id,customer_user_id,name,phone,source) values(${eid},${ownerId},${name},${nextPhone()},'natural') returning id::text`))!.id));
    const service = new ConstructionService({ enterpriseId: eid, adminId: bossId });
    return String((await service.execute('create', { leadId, name, managerId, rooms }, randomUUID())).id);
  };

  const enterprise = await createEnterprise('I7.4.5-F1 合成验收企业-' + suffix);
  const ownerA = await createUser(enterprise, 'F1 试点内业主');
  const ownerB = await createUser(enterprise, 'F1 范围外业主');
  const boss = await createAdmin(enterprise, 'enterprise_admin', 'F1 老板', 1);
  const manager = await createAdmin(enterprise, 'construction_staff', 'F1 项目经理', 2);
  const worker = await createAdmin(enterprise, 'construction_staff', 'F1 施工人员', 3);
  const pidA = await createProject(enterprise, boss, manager, ownerA, 'F1 试点内项目 101', ['卫生间', '客厅']);
  const pidB = await createProject(enterprise, boss, manager, ownerB, 'F1 范围外项目 205', ['厨房']);
  result.ids = { ...result.ids, enterprise, ownerA, ownerB, boss, manager, worker, pidA, pidB };
  let scopeVersion = 0;
  const saveScope = async (projectIds: string[], status: 'active' | 'inactive' = 'active') => {
    const version = ++scopeVersion;
    await withTenantTransaction(enterprise, tx => tx.execute(sql`insert into app.xiaok_pilot_project_scopes
      (enterprise_id,pilot_id,project_ids,created_by,scope_version,status)
      values(${enterprise},'f1-pilot',array[${sql.join(projectIds.map(pid => sql`${pid}::bigint`), sql`, `)}],
        ${boss},${version},${status})`));
    return version;
  };

  const ownerService = new ConstructionService({ enterpriseId: enterprise, adminId: boss });
  for (const pid of [pidA, pidB]) {
    const detail = (await ownerService.execute('detail', { projectId: pid })).project as Record<string, unknown>;
    await ownerService.execute('progress', { projectId: pid, expectedVersion: Number(detail.version),
      stageKey: pid === pidA ? 'utilities' : 'masonry_carpentry', note: 'F1 合成验收进入阶段', sendReminder: false }, randomUUID());
    const afterProgress = (await ownerService.execute('detail', { projectId: pid })).project as Record<string, unknown>;
    await ownerService.execute('member', { projectId: pid, expectedVersion: Number(afterProgress.version), adminId: worker,
      role: 'worker', active: true, workLabel: '现场施工' }, randomUUID());
    await withTenantTransaction(enterprise, tx => tx.execute(sql`update app.construction_projects
      set customer_access=true where enterprise_id=${enterprise} and id=${pid}`));
  }

  const workerChat = new SiteChatService({ enterpriseId: enterprise, adminId: worker });
  const publishRecord = async (pid: string, roomName: string, text: string, completed: string) => {
    const messageId = randomUUID();
    const draft = await workerChat.withWriteScope(pid, async (tx, conversation) => {
      const room = await one(tx, sql`select id::text,name from app.construction_rooms where enterprise_id=${enterprise}
        and project_id=${pid} and name=${roomName}`);
      assert.ok(room?.id);
      const message = await appendMessage(tx, workerChat.actor, String(conversation.id), { author: 'admin', clientMessageId: messageId,
        purpose: 'site.source', content: { version: 1, blocks: [{ type: 'text', text: completed }] } });
      const data = { title: 'F1 合成现场记录', completed, pending: '', coordination: '', roomId: room.id, note: text };
      const row = (await one(tx, sql`insert into app.construction_site_records(enterprise_id,project_id,conversation_id,source_message_id,
        author_id,status,data,room_id,room_name_snapshot) values(${enterprise},${pid},${String(conversation.id)},${String(message.id)},${worker},
        'draft',${JSON.stringify(data)}::jsonb,${String(room.id)},${roomName}) returning *`))!;
      await recordVersion(tx, enterprise, row, worker, 'organized');
      return row;
    });
    if (draft.status === 'draft') await new SiteChatService({ enterpriseId: enterprise, adminId: manager })
      .mutate(pid, String(draft.id), 'publish', { expectedVersion: Number(draft.version), audience: 'customer' }, randomUUID());
    return String(draft.id);
  };
  const recordA = await publishRecord(pidA, '卫生间', 'F1 试点内项目完成水电布管。', '水电布管完成');
  const recordB = await publishRecord(pidB, '厨房', 'F1 范围外项目完成墙砖铺贴。', '厨房墙砖铺贴完成');
  result.ids.records = { recordA, recordB };

  const maxStage = (await withTenantTransaction(enterprise, tx => one(tx, sql`select coalesce(max(id),0)::text id
    from app.domain_event_outbox where enterprise_id=${enterprise} and type='construction.stage.updated.v1'`)))!;
  await withTenantTransaction(enterprise, tx => tx.execute(sql`insert into app.construction_report_settings
    (enterprise_id,enabled,daily_time,weekly_time,weekly_day,project_ids,stage_keys,next_daily_at,next_weekly_at,stage_cursor,stage_enabled,audiences,inactive_policy,dispatch_epoch)
    values(${enterprise},true,'20:00','20:00',1,'[]'::jsonb,'[]'::jsonb,${new Date(reportNow.getTime() + 86400000)},${new Date(reportNow.getTime() - 3600000)},
      ${String(maxStage.id)},true,'["customer","boss"]'::jsonb,'pause_inactive',1)`));
  const settingsBefore = await withTenantTransaction(enterprise, tx => one(tx, sql`select project_ids,stage_keys,audiences
    from app.construction_report_settings where enterprise_id=${enterprise}`));
  await saveScope([pidA]);
  result.ids.settingsBefore = settingsBefore;
  check('fixture.synthetic_two_projects', JSON.stringify(settingsBefore?.project_ids) === '[]' ? 'passed' : 'failed',
    '合成企业、两个项目、业主/老板账号与空 project_ids', { enterprise, pidA, pidB, ownerA, ownerB, boss, manager, worker,
      pilotScope: [pidA], settingsProjectIds: settingsBefore?.project_ids });

  const pilotEnv = { XIAOK_WEEKLY_REPORT_MODE: 'pilot', XIAOK_WEEKLY_REPORT_ENTERPRISE_ID: enterprise,
    XIAOK_WEEKLY_REPORT_PILOT_ID: 'f1-pilot' };
  const generation = await advanceConfiguredConstructionReports({ now: reportNow, env: pilotEnv });
  check('generate.pilot_scope', generation.mode === 'pilot' && generation.scopeStatus === 'active'
    && generation.scopedProjects === 1 && generation.queued === 2 && generation.errors.length === 0 ? 'passed' : 'failed',
    'pilot 周报生成只排入 101 的业主与老板周报', generation);

  const factsLoop = async () => {
    for (let index = 0; index < 40; index++) {
      const pending = await withPlatformTransaction(tx => one(tx, sql`select count(*)::int n from app.assistant_jobs j
        join app.assistant_runs r on r.enterprise_id=j.enterprise_id and r.id=j.run_id
        where j.enterprise_id=${enterprise} and j.status='queued' and r.purpose='construction.report.facts'`));
      if (!Number(pending?.n)) break;
      const claimed = await processAssistantJob(async lease => {
        const purpose = await withTenantTransaction(lease.enterpriseId, async tx => String((await runContext(tx, lease)).run.purpose));
        if (purpose === 'construction.report.facts') await processConstructionReport(lease);
        else await failRun(lease, 'ai_unavailable').catch(() => undefined);
      });
      if (!claimed.claimed) break;
    }
  };
  await factsLoop();

  const reports = await withTenantTransaction(enterprise, tx => rows(tx, sql`select r.id::text report_id,r.kind,r.binding_id::text,
    b.audience,b.user_id::text,b.admin_id::text,v.revision,v.run_id::text,v.facts,v.facts_hash,v.status,
    run.policy_snapshot
    from app.construction_reports r
    join app.construction_report_versions v on v.enterprise_id=r.enterprise_id and v.report_id=r.id and v.revision=r.latest_revision
    join app.assistant_runs run on run.enterprise_id=v.enterprise_id and run.id=v.run_id
    join app.construction_followup_bindings b on b.enterprise_id=r.enterprise_id and b.id=r.binding_id
    where r.enterprise_id=${enterprise} order by r.id`));
  const weekly = reports.filter(report => String(report.kind) === 'weekly');
  const projectIds = (facts: unknown) => {
    const projects = (facts as { projects?: Array<{ id?: unknown }> } | null)?.projects;
    return Array.isArray(projects) ? projects.map(project => String(project.id)) : [];
  };
  const bossReport = weekly.find(report => String(report.audience) === 'boss')!;
  const customerReport = weekly.find(report => String(report.audience) === 'customer')!;
  const onlyA = weekly.every(report => projectIds(report.facts).length === 1 && projectIds(report.facts)[0] === pidA);
  const policyScoped = weekly.every(report => {
    const scope = (report.policy_snapshot as Record<string, unknown>).scope as Record<string, unknown>;
    return JSON.stringify(scope.project_ids) === JSON.stringify([pidA]);
  });
  check('generate.reports_only_101', weekly.length === 2 && onlyA && policyScoped ? 'passed' : 'failed',
    '业主与老板周报事实只包含项目 101，policy snapshot 记录 [101]', { weekly: weekly.length,
      boss: { reportId: bossReport?.report_id, revision: bossReport?.revision, runId: bossReport?.run_id,
        facts: bossReport?.facts, factsHash: bossReport?.facts_hash },
      customer: { reportId: customerReport?.report_id, revision: customerReport?.revision, runId: customerReport?.run_id,
        facts: customerReport?.facts, factsHash: customerReport?.facts_hash } });

  const settingsAfterGeneration = await withTenantTransaction(enterprise, tx => one(tx, sql`select project_ids
    from app.construction_report_settings where enterprise_id=${enterprise}`));
  check('generate.settings_unchanged', JSON.stringify(settingsAfterGeneration?.project_ids) === '[]' ? 'passed' : 'failed',
    '原始 construction_report_settings.project_ids 保持空数组', { before: settingsBefore?.project_ids,
      after: settingsAfterGeneration?.project_ids });

  const repeatGeneration = await advanceConfiguredConstructionReports({ now: reportNow, env: pilotEnv });
  const reportCountAfterRepeat = await withTenantTransaction(enterprise, tx => one(tx, sql`select count(*)::int n
    from app.construction_reports where enterprise_id=${enterprise}`));
  check('generate.repeat_idempotent', repeatGeneration.queued === 0 && Number(reportCountAfterRepeat?.n) === reports.length
    ? 'passed' : 'failed', '同一周期重复 tick 不重复创建报告', { repeatGeneration, reports: reportCountAfterRepeat?.n });

  const detailB = (await ownerService.execute('detail', { projectId: pidB })).project as Record<string, unknown>;
  await ownerService.execute('progress', { projectId: pidB, expectedVersion: Number(detailB.version),
    stageKey: 'painting', note: 'F1 范围外阶段事件', sendReminder: false }, randomUUID());
  const scopeStage = await advanceConfiguredConstructionReports({ now: reportNow2, env: pilotEnv });
  const reportCountAfterStage = await withTenantTransaction(enterprise, tx => one(tx, sql`select count(*)::int n
    from app.construction_reports where enterprise_id=${enterprise}`));
  check('generate.stage_event_outside_scope', scopeStage.queued === 0
    && Number(reportCountAfterStage?.n) === reports.length ? 'passed' : 'failed',
    '范围外项目 stage event 不创建报告', { generation: scopeStage, reports: reportCountAfterStage?.n });

  const delivery = await deliverConfiguredConstructionReports({ now: reportNow, env: pilotEnv });
  const deliveries = await withTenantTransaction(enterprise, tx => rows(tx, sql`select d.report_id::text,d.revision,d.binding_id::text,
    d.state,d.message_id::text,m.conversation_id::text,b.audience
    from app.construction_report_deliveries d
    left join app.assistant_messages m on m.enterprise_id=d.enterprise_id and m.id=d.message_id
    join app.construction_followup_bindings b on b.enterprise_id=d.enterprise_id and b.id=d.binding_id
    where d.enterprise_id=${enterprise} order by d.event_id`));
  const messages = await withTenantTransaction(enterprise, tx => one(tx, sql`select count(*)::int n
    from app.assistant_messages where enterprise_id=${enterprise}`));
  const deliveredRows = deliveries.filter(row => String(row.state) === 'delivered');
  check('deliver.pilot_scope', delivery.delivered === 2 && deliveredRows.length === 2
    && deliveredRows.every(row => row.message_id && row.conversation_id) ? 'passed' : 'failed',
    'pilot 投递业主与老板周报，messageId 与 delivery 回执一致', { delivery, deliveries,
      messages: messages?.n, reportIds: [bossReport?.report_id, customerReport?.report_id] });

  const repeatDelivery = await deliverConfiguredConstructionReports({ now: reportNow, env: pilotEnv });
  const messagesAfterRepeat = await withTenantTransaction(enterprise, tx => one(tx, sql`select count(*)::int n
    from app.assistant_messages where enterprise_id=${enterprise}`));
  check('deliver.repeat_idempotent', repeatDelivery.delivered === 0
    && Number(messagesAfterRepeat?.n) === Number(messages?.n) ? 'passed' : 'failed',
    '重复投递 tick 不重复发送', { repeatDelivery, before: messages?.n, after: messagesAfterRepeat?.n });

  // ------------------------------ non-empty enterprise filter intersection
  const maxReportId = Math.max(...reports.map(report => Number(report.report_id)));
  const reportNow3 = new Date('2026-11-23T20:00:00+08:00');
  await withTenantTransaction(enterprise, tx => tx.execute(sql`update app.construction_report_settings
    set project_ids=${JSON.stringify([pidB])}::jsonb,next_daily_at=${new Date(reportNow3.getTime() + 86400000)},
      next_weekly_at=${new Date(reportNow3.getTime() - 3600000)} where enterprise_id=${enterprise}`));
  await saveScope([pidA, pidB]);
  const intersection = await advanceConfiguredConstructionReports({ now: reportNow3, env: pilotEnv });
  await factsLoop();
  const intersectionReports = await withTenantTransaction(enterprise, tx => rows(tx, sql`select r.id::text report_id,b.audience,
    v.facts,run.policy_snapshot from app.construction_reports r
    join app.construction_report_versions v on v.enterprise_id=r.enterprise_id and v.report_id=r.id and v.revision=r.latest_revision
    join app.assistant_runs run on run.enterprise_id=v.enterprise_id and run.id=v.run_id
    join app.construction_followup_bindings b on b.enterprise_id=r.enterprise_id and b.id=r.binding_id
    where r.enterprise_id=${enterprise} and r.id>${maxReportId} and r.kind='weekly' order by r.id`));
  const intersectionOnlyB = intersectionReports.length === 2 && intersectionReports.every(report => {
    const scope = (report.policy_snapshot as Record<string, unknown>).scope as Record<string, unknown>;
    return JSON.stringify(projectIds(report.facts)) === JSON.stringify([pidB])
      && JSON.stringify(scope.project_ids) === JSON.stringify([pidB]);
  });
  await withTenantTransaction(enterprise, tx => tx.execute(sql`update app.construction_report_deliveries set state='revoked'
    where enterprise_id=${enterprise} and report_id>${maxReportId}`));
  await withTenantTransaction(enterprise, tx => tx.execute(sql`update app.construction_report_settings
    set project_ids='[]'::jsonb where enterprise_id=${enterprise}`));
  await saveScope([pidA]);
  check('generate.enterprise_filter_intersection', intersection.mode === 'pilot' && intersection.queued === 2
    && intersectionOnlyB ? 'passed' : 'failed',
    '企业 project_ids=[205] 与试点 [101,205] 交集为 [205]，只生成项目 205 周报',
    { intersection, reports: intersectionReports.map(report => ({ reportId: report.report_id, audience: report.audience,
      facts: report.facts, policy: report.policy_snapshot })) });

  // ------------------------------ scope change and synthetic pending history
  const createSyntheticRun = async (tx: PostgresTransaction, binding: Row, projectIds: string[]) => {
    const conversation = (await one(tx, sql`select context_revision from app.assistant_conversations
      where enterprise_id=${enterprise} and id=${String(binding.conversation_id)}`))!;
    return (await one(tx, sql`insert into app.assistant_runs
      (enterprise_id,conversation_id,trigger_kind,trigger_schedule_key,purpose,policy_snapshot,context_revision,knowledge_epoch)
      values(${enterprise},${String(binding.conversation_id)},'scheduled_task',${'f1-synthetic-run-' + randomUUID()},
        'construction.report.facts',${JSON.stringify({ reportDispatchEpoch: 1, scope: { project_ids: projectIds } })}::jsonb,
        ${Number(conversation.context_revision)},1) returning *`))!;
  };
  const historyFacts = { protocol: 'construction-report-facts-v1', projects: [{ id: pidA }, { id: pidB }],
    projectsTruncated: false, knowledgeStatus: 'not_generated', arrangementsStatus: 'not_aggregated',
    issuesStatus: 'not_aggregated' };
  const history = await withTenantTransaction(enterprise, async tx => {
    const binding = (await one(tx, sql`select * from app.construction_followup_bindings where enterprise_id=${enterprise}
      and id=${String(bossReport.binding_id)}`))!;
    const run = await createSyntheticRun(tx, binding, [pidA, pidB]);
    const report = (await one(tx, sql`insert into app.construction_reports
      (enterprise_id,binding_id,report_key,kind,period_start,period_end,cutoff_at,scheduled_at)
      values(${enterprise},${String(binding.id)},${'f1-history-' + randomUUID()},'weekly',${periodStart},${periodEnd},${periodEnd},${periodEnd}) returning *`))!;
    const version = (await one(tx, sql`insert into app.construction_report_versions
      (enterprise_id,report_id,revision,run_id,status,facts,facts_hash,generated_at,period_end,cutoff_at)
      values(${enterprise},${String(report.id)},1,${String(run.id)},'facts_ready',${JSON.stringify(historyFacts)}::jsonb,
        'f1-history-hash',now(),${periodEnd},${periodEnd}) returning *`))!;
    const event = (await one(tx, sql`insert into app.domain_event_outbox
      (enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
      values(${enterprise},'construction.report.facts_ready.v1','construction_report',${String(report.id)},1,
        '{"kind":"system"}',${String(report.id)},${JSON.stringify({ synthetic: 'i745-f1-history' })}::jsonb) returning *`))!;
    await tx.execute(sql`insert into app.construction_report_deliveries
      (enterprise_id,report_id,revision,binding_id,event_id,state)
      values(${enterprise},${String(report.id)},1,${String(binding.id)},${String(event.id)},'pending')`);
    return { reportId: String(report.id), revision: Number(version.revision), eventId: String(event.id),
      factsHash: String(version.facts_hash), facts: version.facts };
  });
  result.ids.history = history;
  const outboxBeforeDelivery = await withTenantTransaction(enterprise, tx => one(tx, sql`select count(*)::int n
    from app.domain_event_outbox where enterprise_id=${enterprise}`));
  await saveScope([pidA, pidB]);
  await saveScope([pidA]);
  const historyDelivery = await deliverConfiguredConstructionReports({ now: reportNow, env: pilotEnv });
  const historyState = await withTenantTransaction(enterprise, tx => one(tx, sql`select d.state,d.message_id::text,
    v.facts,v.facts_hash from app.construction_report_deliveries d
    join app.construction_report_versions v on v.enterprise_id=d.enterprise_id and v.report_id=d.report_id and v.revision=d.revision
    where d.enterprise_id=${enterprise} and d.report_id=${history.reportId} and d.revision=1`));
  const outboxAfter = await withTenantTransaction(enterprise, tx => one(tx, sql`select count(*)::int n
    from app.domain_event_outbox where enterprise_id=${enterprise}`));
  const deliveredBeforeHistory = deliveredRows.map(row => ({ reportId: row.report_id, messageId: row.message_id }));
  check('history.scope_change_revoked', historyDelivery.delivered === 0 && historyState?.state === 'revoked'
    && historyState.message_id === null && JSON.stringify(historyState.facts) === JSON.stringify(history.facts)
    && historyState.facts_hash === history.factsHash && Number(outboxAfter?.n) === Number(outboxBeforeDelivery?.n)
    ? 'passed' : 'failed', '范围从 101+205 改为仅 101 后，已排队老板报告被撤销且版本/事实/Outbox 不变',
    { historyDelivery, historyState, outboxBefore: outboxBeforeDelivery?.n, outboxAfter: outboxAfter?.n,
      deliveredBeforeHistory, history });

  // ------------------------------ permission, missing facts, cross-enterprise
  const minimalFacts = (ids: string[]) => ({ protocol: 'construction-report-facts-v1',
    projects: ids.map(id => ({ id, name: 'F1 合成项目', stageKey: null, progressRevision: 0, stageEvents: [],
      stageEventsTruncated: false, records: [], recordsTruncated: false, noPublishedRecords: true,
      pending: { ownerConfirmations: [], designerReviews: [], workerTasks: [], missingMaterials: [] },
      issues: [], arrangements: [] })), projectsTruncated: false, knowledgeStatus: 'not_generated',
    arrangementsStatus: 'not_aggregated', issuesStatus: 'not_aggregated' });
  const synthetic = async (facts: unknown, options: { bindingId?: string; factsHash?: string;
    factsReady?: boolean; projectIds?: string[] } = {}) =>
    withTenantTransaction(enterprise, async tx => {
      const binding = (await one(tx, sql`select * from app.construction_followup_bindings where enterprise_id=${enterprise}
        and id=${String(options.bindingId || bossReport.binding_id)}`))!;
      const run = await createSyntheticRun(tx, binding, options.projectIds || [pidA]);
      const report = (await one(tx, sql`insert into app.construction_reports
        (enterprise_id,binding_id,report_key,kind,period_start,period_end,cutoff_at,scheduled_at)
        values(${enterprise},${String(binding.id)},${'f1-synthetic-' + randomUUID()},'weekly',${periodStart},${periodEnd},${periodEnd},${periodEnd}) returning *`))!;
      const ready = options.factsReady !== false;
      const factsValue = ready ? sql`${JSON.stringify(facts)}::jsonb` : sql`null`;
      const hashValue = ready ? (options.factsHash || 'f1-synthetic-hash') : null;
      const generatedValue = ready ? new Date() : null;
      const version = (await one(tx, sql`insert into app.construction_report_versions
        (enterprise_id,report_id,revision,run_id,status,facts,facts_hash,generated_at,period_end,cutoff_at)
        values(${enterprise},${String(report.id)},1,${String(run.id)},${ready ? 'facts_ready' : 'queued'},
          ${factsValue},${hashValue},${generatedValue},${periodEnd},${periodEnd}) returning *`))!;
      const event = (await one(tx, sql`insert into app.domain_event_outbox
        (enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
        values(${enterprise},'construction.report.facts_ready.v1','construction_report',${String(report.id)},1,
          '{"kind":"system"}',${String(report.id)},${JSON.stringify({ synthetic: 'i745-f1' })}::jsonb) returning *`))!;
      await tx.execute(sql`insert into app.construction_report_deliveries
        (enterprise_id,report_id,revision,binding_id,event_id,state)
        values(${enterprise},${String(report.id)},1,${String(binding.id)},${String(event.id)},'pending')`);
      return { reportId: String(report.id), eventId: String(event.id), version: version };
    });
  const markRevoked = (reportId: string) => withTenantTransaction(enterprise, tx => tx.execute(sql`update app.construction_report_deliveries
    set state='revoked' where enterprise_id=${enterprise} and report_id=${reportId}`));

  // F: revoke customer access before delivery.
  await withTenantTransaction(enterprise, tx => tx.execute(sql`update app.construction_projects set customer_access=false
    where enterprise_id=${enterprise} and id=${pidA}`));
  const customerBinding = (await withTenantTransaction(enterprise, tx => one(tx, sql`select id::text from app.construction_followup_bindings
    where enterprise_id=${enterprise} and audience='customer' and project_id=${pidA} order by id desc limit 1`)))!;
  const revokedCustomer = await synthetic(minimalFacts([pidA]), { bindingId: String(customerBinding.id),
    projectIds: [pidA] });
  const revokedDelivery = await deliverConfiguredConstructionReports({ now: reportNow, env: pilotEnv });
  const revokedState = await withTenantTransaction(enterprise, tx => one(tx, sql`select state,message_id::text
    from app.construction_report_deliveries where enterprise_id=${enterprise} and report_id=${revokedCustomer.reportId}`));
  await withTenantTransaction(enterprise, tx => tx.execute(sql`update app.construction_projects set customer_access=true
    where enterprise_id=${enterprise} and id=${pidA}`));
  check('fault.recipient_revoked', revokedDelivery.delivered === 0 && revokedState?.state === 'revoked'
    && !revokedState.message_id ? 'passed' : 'failed', '业主撤权后待发送报告被撤销',
    { revokedDelivery, revokedState, reportId: revokedCustomer.reportId });

  // D: missing facts.
  const missing = await synthetic(null, { factsReady: false });
  const missingDelivery = await deliverConfiguredConstructionReports({ now: reportNow, env: pilotEnv });
  const missingState = await withTenantTransaction(enterprise, tx => one(tx, sql`select state,message_id::text
    from app.construction_report_deliveries where enterprise_id=${enterprise} and report_id=${missing.reportId}`));
  check('fault.missing_facts', missingDelivery.delivered === 0 && missingState?.state === 'revoked'
    && !missingState.message_id ? 'passed' : 'failed', 'facts 缺失时不投递', { missingDelivery, missingState });

  // E: foreign project cannot enter the pilot scope, and a synthetic foreign fact is revoked.
  const enterpriseB = await createEnterprise('I7.4.5-F1 跨企业合成-' + suffix);
  const ownerForeign = await createUser(enterpriseB, 'F1 跨企业业主');
  const bossForeign = await createAdmin(enterpriseB, 'enterprise_admin', 'F1 跨企业老板', 4);
  const managerForeign = await createAdmin(enterpriseB, 'construction_staff', 'F1 跨企业经理', 5);
  const pidForeign = await createProject(enterpriseB, bossForeign, managerForeign, ownerForeign, 'F1 跨企业项目', ['厨房']);
  let scopeRejected = false;
  try {
    await withTenantTransaction(enterprise, tx => tx.execute(sql`insert into app.xiaok_pilot_project_scopes
      (enterprise_id,pilot_id,project_ids,created_by,scope_version,status)
      values(${enterprise},'f1-foreign',array[${pidForeign}::bigint],${boss},1,'active')`));
  } catch { scopeRejected = true; }
  const foreign = await synthetic(minimalFacts([pidForeign]), { projectIds: [pidForeign] });
  const foreignDelivery = await deliverConfiguredConstructionReports({ now: reportNow, env: pilotEnv });
  const foreignState = await withTenantTransaction(enterprise, tx => one(tx, sql`select state,message_id::text
    from app.construction_report_deliveries where enterprise_id=${enterprise} and report_id=${foreign.reportId}`));
  check('fault.cross_enterprise', scopeRejected && foreignDelivery.delivered === 0 && foreignState?.state === 'revoked'
    ? 'passed' : 'failed', '跨企业项目不能写入试点范围，也不能进入投递', { scopeRejected, foreignDelivery, foreignState,
      enterpriseB, pidForeign });

  // A/B/C: fail-closed modes with constructed pending reports.
  const pendingA = await synthetic(minimalFacts([pidA]));
  const missingPilot = await deliverConfiguredConstructionReports({ now: reportNow, env: { ...pilotEnv, XIAOK_WEEKLY_REPORT_PILOT_ID: 'missing-f1' } });
  const pendingAState = await withTenantTransaction(enterprise, tx => one(tx, sql`select state from app.construction_report_deliveries
    where enterprise_id=${enterprise} and report_id=${pendingA.reportId}`));
  check('fault.pilot_not_found', missingPilot.delivered === 0 && pendingAState?.state === 'pending' ? 'passed' : 'failed',
    'Pilot 不存在时零投递，待发送保持 pending', { missingPilot, pendingAState });

  await saveScope([pidA], 'inactive');
  const inactive = await deliverConfiguredConstructionReports({ now: reportNow, env: pilotEnv });
  const pendingBState = await withTenantTransaction(enterprise, tx => one(tx, sql`select state from app.construction_report_deliveries
    where enterprise_id=${enterprise} and report_id=${pendingA.reportId}`));
  check('fault.pilot_inactive', inactive.delivered === 0 && pendingBState?.state === 'pending' ? 'passed' : 'failed',
    'Pilot inactive 时零投递，待发送保持 pending', { inactive, pendingBState });

  await saveScope([pidA]);
  const ownerClient = new pg.Client({ connectionString: connections.MIGRATION_URL });
  await ownerClient.connect();
  let resolverFault: { delivered: number; scopeStatus?: string | null; errors?: unknown } = { delivered: -1 };
  try {
    await ownerClient.query('revoke select on app.xiaok_pilot_project_scopes from sfp_app');
    resolverFault = await deliverConfiguredConstructionReports({ now: reportNow, env: pilotEnv });
  } finally {
    await ownerClient.query('grant select,insert on app.xiaok_pilot_project_scopes to sfp_app');
    await ownerClient.end();
  }
  const pendingCState = await withTenantTransaction(enterprise, tx => one(tx, sql`select state from app.construction_report_deliveries
    where enterprise_id=${enterprise} and report_id=${pendingA.reportId}`));
  check('fault.resolver_unavailable', resolverFault.delivered === 0 && resolverFault.scopeStatus === 'unavailable'
    && pendingCState?.state === 'pending' ? 'passed' : 'failed', 'Resolver 不可用时零投递且不回退企业全量',
    { resolverFault, pendingCState });
  await markRevoked(pendingA.reportId);

  // H: enterprise mode keeps the original behavior and can deliver both projects.
  const enterpriseReport = await synthetic(minimalFacts([pidA, pidB]), { projectIds: [pidA, pidB] });
  const enterpriseDelivery = await deliverConfiguredConstructionReports({ now: reportNow,
    env: { XIAOK_WEEKLY_REPORT_MODE: 'enterprise', XIAOK_WEEKLY_REPORT_ENTERPRISE_ID: enterprise } });
  const enterpriseState = await withTenantTransaction(enterprise, tx => one(tx, sql`select state,message_id::text
    from app.construction_report_deliveries where enterprise_id=${enterprise} and report_id=${enterpriseReport.reportId}`));
  check('mode.enterprise_compatible', enterpriseDelivery.mode === 'enterprise' && enterpriseDelivery.delivered >= 1
    && enterpriseState?.state === 'delivered' && enterpriseState.message_id ? 'passed' : 'failed',
    'enterprise 模式保持原投递行为，不受 pilot 范围限制',
    { enterpriseDelivery, enterpriseState, reportId: enterpriseReport.reportId });

  const finalSettings = await withTenantTransaction(enterprise, tx => one(tx, sql`select project_ids
    from app.construction_report_settings where enterprise_id=${enterprise}`));
  const finalCounts = await withTenantTransaction(enterprise, tx => one(tx, sql`select
    (select count(*)::int from app.construction_reports where enterprise_id=${enterprise}) reports,
    (select count(*)::int from app.construction_report_versions where enterprise_id=${enterprise}) versions,
    (select count(*)::int from app.construction_report_deliveries where enterprise_id=${enterprise}) deliveries,
    (select count(*)::int from app.assistant_messages where enterprise_id=${enterprise}) messages,
    (select count(*)::int from app.domain_event_outbox where enterprise_id=${enterprise}) outbox`));
  check('final.settings_and_history', JSON.stringify(finalSettings?.project_ids) === '[]' ? 'passed' : 'failed',
    '最终企业 project_ids 未修改，历史表仅追加', { finalSettings, finalCounts });

  result.ids.finalCounts = finalCounts;
  await closePostgresPool();
}

main().catch(error => {
  result.error = (error as Error).stack || String(error);
  check('run.completed', 'failed', '验收脚本执行失败', { error: (error as Error).message });
}).finally(() => {
  result.finishedAt = new Date().toISOString();
  save();
  console.log(JSON.stringify({ output, passed: result.checks.filter(item => item.status === 'passed').length,
    failed: result.checks.filter(item => item.status === 'failed').length }));
});
