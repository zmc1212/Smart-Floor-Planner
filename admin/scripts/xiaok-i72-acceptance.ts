/** I7.2 isolated live acceptance. It refuses any database other than the
 * explicitly named local I7.2 acceptance target and only uses synthetic data. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';

const admin = path.resolve(process.cwd());
loadEnvConfig(admin, true);

const target = process.env.XIAOK_I72_DATABASE_URL?.trim();
if (!target) throw new Error('XIAOK_I72_DATABASE_URL is required');
const parsed = new URL(target);
if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || parsed.port !== '55443'
  || parsed.pathname !== '/i72_accept' || parsed.username !== 'sfp_app') {
  throw new Error('Use only the isolated I7.2 acceptance database (127.0.0.1:55443/i72_accept as sfp_app)');
}
process.env.DATABASE_URL = target;

const run: {
  startedAt: string; finishedAt?: string; database: string; ids: Record<string, unknown>;
  checks: Array<{ id: string; status: 'passed' | 'failed' | 'limited' | 'not_run' | 'unknown'; detail: string; evidence?: unknown }>;
} = {
  startedAt: new Date().toISOString(),
  database: parsed.pathname.slice(1),
  checks: [] as Array<{ id: string; status: 'passed' | 'failed' | 'limited' | 'not_run' | 'unknown'; detail: string; evidence?: unknown }>,
  ids: {} as Record<string, unknown>,
};
const check = (id: string, status: typeof run.checks[number]['status'], detail: string, evidence?: unknown) => {
  run.checks.push({ id, status, detail, ...(evidence === undefined ? {} : { evidence }) });
};

async function main() {
  const { withPlatformTransaction, withTenantTransaction } = await import('@/db/transaction');
  const { one, rows } = await import('@/db/repositories/assistant-repository');
  const { closePostgresPool } = await import('@/lib/postgresql');
  const { fingerprint } = await import('@/lib/assistant/contracts');
  const { appendMessage } = await import('@/lib/assistant/core/conversation');
  const { getDefaultMenuKeys } = await import('@/lib/admin-user-roles');
  const { ConstructionService } = await import('@/lib/construction/service');
  const { SiteChatService, recordVersion } = await import('@/lib/construction/site-chat');
  const { currentRecord, openRecordIssue, readSiteIssueBase } = await import('@/lib/construction/site-issues');
  const { advanceStageReminders, deliverStageReminders, pauseStageReminders, resumeStageReminders, cancelStageReminder } = await import('@/lib/xiaok-v1/reminder-service');
  const { advanceConstructionReports, deliverConstructionReports, processConstructionReport } = await import('@/lib/construction/report-worker');
  const { processAssistantJob, failRun, runContext } = await import('@/lib/assistant/infrastructure/job-queue');
  const { buildRoleWeeklyDigest } = await import('@/lib/xiaok-v1/weekly-report-service');
  const { stageChatForConversation } = await import('@/lib/xiaok-v1/stage-chat-service');
  const { followupProjects } = await import('@/lib/construction/report-scope');
  const { FollowupService } = await import('@/lib/construction/followup-service');
  const { enqueueReportCorrection } = await import('@/lib/construction/report-store');

  const identity = await withPlatformTransaction(tx => one(tx, sql`select current_user as db_user,current_database() as db_name`));
  assert.equal(identity?.db_user, 'sfp_app');
  assert.equal(identity?.db_name, 'i72_accept');

  const now = new Date();
  const shanghaiDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const day = (offset: number) => {
    const base = new Date(shanghaiDate + 'T00:00:00+08:00');
    return new Date(base.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  };

  // ---------------------------------------------------------------- fixture
  const suffix = String(now.getTime());
  const enterprise = await withPlatformTransaction(async tx => {
    const inserted = await one(tx, sql`insert into app.enterprises(name,code,status,registration_mode)
      values(${'I7.2验收合成-' + suffix},${'xiaok-i72-accept-' + suffix},'active','manual') returning id::text`);
    assert.ok(inserted?.id);
    const eid = String(inserted.id);
    await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,retention_days,daily_requests,daily_tokens,daily_cost_micros)
      values(${eid},true,365,100000,1000000000,1000000000)`);
    return eid;
  });
  run.ids.enterpriseId = enterprise;

  const user = (phone: string, nickname: string) => withPlatformTransaction(async tx => {
    const inserted = await one(tx, sql`insert into app.users(enterprise_id,phone,nickname,role) values(${enterprise},${phone},${nickname},'user') returning id::text`);
    return String(inserted!.id);
  });
  const adminUser = (role: string, name: string, phone: string, index: number) => withPlatformTransaction(async tx => {
    const username = 'i72_' + suffix + '_' + index;
    const menus = JSON.stringify(getDefaultMenuKeys(role));
    const linked = await one(tx, sql`insert into app.users(enterprise_id,phone,nickname,role)
      values(${enterprise},${phone},${name},'user') returning id::text`);
    const inserted = await one(tx, sql`insert into app.admin_users(enterprise_id,user_id,username,password_hash,display_name,role,status,must_change_password,phone,menu_permissions,construction_trades)
      values(${enterprise},${String(linked!.id)},${username},'x',${name},${role},'active',false,${phone},
      ARRAY(select jsonb_array_elements_text(${menus}::jsonb)),ARRAY[]::text[]) returning id::text`);
    return String(inserted!.id);
  });

  const ownerA = await user('19972000001', '业主甲');
  const ownerB = await user('19972000002', '业主乙');
  const boss = await adminUser('enterprise_admin', '老板周工', '19972000011', 1);
  const manager = await adminUser('construction_staff', '项目经理陈工', '19972000012', 2);
  const designer = await adminUser('designer', '设计师林木', '19972000013', 3);
  const worker = await adminUser('construction_staff', '施工陈师傅', '19972000014', 4);
  run.ids = { ...run.ids, ownerA, ownerB, boss, manager, designer, worker };

  const owner = new ConstructionService({ enterpriseId: enterprise, adminId: boss });
  const project = async (name: string, ownerId: string, rooms: string[]) => withTenantTransaction(enterprise, async tx => {
    const lead = await one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source)
      values(${enterprise},${ownerId},${name},${'19972' + Math.floor(Math.random() * 1e6)},'natural') returning id::text`);
    return String(lead!.id);
  }).then(leadId => owner.execute('create', { leadId, name, managerId: manager, rooms }, randomUUID()));

  const projectA = await project('I7.2 水电项目', ownerA, ['卫生间', '客厅']);
  const projectB = await project('I7.2 泥木项目', ownerB, ['厨房']);
  const projectC = await project('I7.2 十阶段项目', ownerA, ['主卧']);
  const projectD = await project('I7.2 记录停滞项目', ownerB, ['卧室']);
  const pidA = String(projectA.id), pidB = String(projectB.id), pidC = String(projectC.id), pidD = String(projectD.id);
  run.ids = { ...run.ids, projectA: pidA, projectB: pidB, projectC: pidC, projectD: pidD };

  for (const pid of [pidA, pidB, pidC, pidD]) {
    for (const [role, aid] of [['designer', designer], ['worker', worker]] as const) {
      const detail = await owner.execute('detail', { projectId: pid });
      await owner.execute('member', { projectId: pid, expectedVersion: (detail.project as { version: number }).version,
        adminId: aid, role, active: true, workLabel: role === 'designer' ? '设计核对' : '现场施工' }, randomUUID());
    }
  }

  const stage = async (pid: string, key: string) => {
    const detail = await owner.execute('detail', { projectId: pid });
    await owner.execute('progress', { projectId: pid, expectedVersion: (detail.project as { version: number }).version,
      stageKey: key, note: 'I7.2 合成验收进入' + key, sendReminder: false }, randomUUID());
  };
  await stage(pidA, 'utilities');
  await stage(pidB, 'masonry_carpentry');
  await stage(pidD, 'painting');

  const createC01 = (ownerId: string, projectIds: string[]) => withTenantTransaction(enterprise, async tx => {
    const conversation = await one(tx, sql`insert into app.assistant_conversations(enterprise_id,purpose,entry_snapshot,policy_version)
      values(${enterprise},'customer_consultation',${JSON.stringify({ kind: 'construction_project', id: projectIds[0] })}::jsonb,1) returning id::text`);
    const cid = String(conversation!.id);
    await tx.execute(sql`insert into app.assistant_participants(enterprise_id,conversation_id,principal_kind,user_id,participant_role,grant_basis)
      values(${enterprise},${cid},'user',${ownerId},'owner',${JSON.stringify({ kind: 'owner' })}::jsonb)`);
    for (const pid of projectIds) await tx.execute(sql`insert into app.construction_links(enterprise_id,project_id,conversation_id)
      values(${enterprise},${pid},${cid}) on conflict do nothing`);
    return cid;
  });
  const c01A = await createC01(ownerA, [pidA]);
  const c01B = await createC01(ownerB, [pidB]);
  run.ids = { ...run.ids, c01A, c01B };

  const rooms = async (pid: string) => withTenantTransaction(enterprise, tx => rows<{ id: string; name: string }>(tx,
    sql`select id::text,name from app.construction_rooms where enterprise_id=${enterprise} and project_id=${pid} order by id`));
  const roomsA = await rooms(pidA), roomsB = await rooms(pidB);
  const plan = async (pid: string, nodes: Array<{ key: string; stageKey: string; roomId: string | null; plannedStart: string; plannedEnd: string }>) =>
    owner.execute('saveSchedule', { projectId: pid, expectedVersion: 0,
      title: 'I7.2 施工计划', note: '合成验收计划', nodes }, randomUUID());
  const scheduleA = await plan(pidA, [
    { key: 'utilities_bath', stageKey: 'utilities', roomId: roomsA[0].id, plannedStart: day(-12), plannedEnd: day(-5) },
    { key: 'utilities_living', stageKey: 'utilities', roomId: roomsA[1].id, plannedStart: day(-2), plannedEnd: day(4) },
  ]);
  const scheduleB = await plan(pidB, [
    { key: 'masonry_kitchen', stageKey: 'masonry_carpentry', roomId: roomsB[0].id, plannedStart: day(-2), plannedEnd: day(5) },
  ]);
  run.ids.scheduleA = scheduleA; run.ids.scheduleB = scheduleB;

  // Real published records through the existing Construction service.
  const workerChat = new SiteChatService({ enterpriseId: enterprise, adminId: worker });
  const publishRecord = async (pid: string, roomName: string, text: string, completed: string, pending: string, coordination: string) => {
    const messageId = randomUUID();
    const draft = await workerChat.withWriteScope(pid, async (tx, c) => {
      const room = await one(tx, sql`select id::text,name from app.construction_rooms where enterprise_id=${enterprise}
        and project_id=${pid} and name=${roomName}`);
      assert.ok(room?.id);
      const message = await appendMessage(tx, workerChat.actor, String(c.id), { author: 'admin', clientMessageId: messageId,
        purpose: 'site.source', content: { version: 1, blocks: [{ type: 'text', text: [completed, pending, coordination].join('\n') }] } });
      const data = { title: 'I7.2 现场记录', completed, pending, coordination, roomId: room.id, note: text };
      const row = (await one(tx, sql`insert into app.construction_site_records(enterprise_id,project_id,conversation_id,source_message_id,
        author_id,status,data,room_id,room_name_snapshot) values(${enterprise},${pid},${String(c.id)},${String(message.id)},${worker},
        'draft',${JSON.stringify(data)}::jsonb,${String(room.id)},${roomName}) returning *`))!;
      await recordVersion(tx, enterprise, row, worker, 'organized');
      return { row, messageId: String(message.id) };
    });
    if (draft.row.status === 'draft') await new SiteChatService({ enterpriseId: enterprise, adminId: manager })
      .mutate(pid, String(draft.row.id), 'publish', { expectedVersion: Number(draft.row.version), audience: 'customer' }, randomUUID());
    return { recordId: String(draft.row.id), messageId: draft.messageId };
  };
  const recordA = await publishRecord(pidA, '卫生间', '本周完成水电开槽和布管。', '水电开槽和布管完成', '卫生间等电位连接待补照片', '请业主确认客厅电视墙插座位置');
  const recordA2 = await publishRecord(pidA, '客厅', '客厅线管继续排布。', '客厅线管排布完成', '', '');
  const recordB = await publishRecord(pidB, '厨房', '本周完成墙砖铺贴。', '厨房墙砖铺贴完成', '地砖等待材料进场', '');
  const recordB2 = await publishRecord(pidB, '厨房', '厨房地砖铺贴完成。', '厨房地砖铺贴完成', '', '');
  const recordB3 = await publishRecord(pidB, '厨房', '厨房门套收口修正。', '厨房门套收口修正', '', '');
  const recordB4 = await publishRecord(pidB, '厨房', '厨房吊顶基层完成。', '厨房吊顶基层完成', '', '');
  const recordD = await publishRecord(pidD, '卧室', '卧室墙面基层处理。', '卧室墙面基层处理', '', '');
  await withTenantTransaction(enterprise, tx => tx.execute(sql`update app.construction_site_records set published_at=now()-interval '10 days'
    where enterprise_id=${enterprise} and id=${recordD.recordId}`));

  const issue = async (pid: string, recordId: string, sourceMessageId: string, state: string, options: {
    ownerId?: string; confirmed?: boolean; revision: number; title?: string;
  }) => withTenantTransaction(enterprise, async tx => {
    const source = await currentRecord(tx, enterprise, pid, recordId);
    assert.ok(source);
    const request = await one(tx, sql`select content from app.assistant_messages where enterprise_id=${enterprise} and id=${sourceMessageId}`);
    assert.ok(request);
    const opened = await openRecordIssue(tx, enterprise, pid, recordId, source!, {
      openedBy: worker, requestMessageId: sourceMessageId, requestHash: fingerprint(request!.content),
      requestText: options.title || 'I7.2 合成验收事项', projectReview: false,
    }, { kind: 'admin', adminId: manager }, randomUUID());
    const base = await readSiteIssueBase(tx, enterprise, pid, opened!.issueId);
    assert.ok(base);
    const payload = { ...base, revision: options.revision, state, action: 'i72',
      ...(options.ownerId ? { ownerId: options.ownerId } : {}), ...(options.confirmed ? { confirmed: true, confirmedAt: now.toISOString(), confirmedBy: manager } : {}) };
    await tx.execute(sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
      values(${enterprise},'construction.site.issue.progress.v1','construction_site_issue',${opened!.issueId},${options.revision},
      '{"kind":"admin"}'::jsonb,${randomUUID()},${JSON.stringify(payload)}::jsonb)`);
    return opened!.issueId;
  });
  const issueDesigner = await issue(pidA, recordA.recordId, recordA.messageId, 'awaiting_owner', { ownerId: designer, revision: 2, title: '客厅插座点位请设计师核对' });
  const issueWorker = await issue(pidA, recordA2.recordId, recordA2.messageId, 'awaiting_owner', { ownerId: worker, confirmed: true, revision: 2, title: '卫生间等电位照片待补' });
  const issueRectifying = await issue(pidB, recordB.recordId, recordB.messageId, 'rectifying', { ownerId: worker, confirmed: true, revision: 2, title: '厨房阴角空鼓整改中' });
  const issueReview = await issue(pidB, recordB2.recordId, recordB2.messageId, 'awaiting_review', { ownerId: worker, confirmed: true, revision: 3, title: '厨房地砖平整度待复核' });
  const issueClosed = await issue(pidB, recordB3.recordId, recordB3.messageId, 'closed', { ownerId: worker, confirmed: true, revision: 3, title: '厨房门套收口已修正' });
  const issueManager = await issue(pidB, recordB4.recordId, recordB4.messageId, 'awaiting_owner', { ownerId: manager, confirmed: true, revision: 2, title: '项目经理待安排吊顶验收' });
  run.ids = { ...run.ids, issueDesigner, issueWorker, issueRectifying, issueReview, issueClosed, issueManager,
    recordA, recordA2, recordB, recordB2, recordB3, recordB4, recordD };

  // Report settings: weekly only, all four audiences, two projects in scope.
  await withTenantTransaction(enterprise, tx => tx.execute(sql`insert into app.construction_report_settings
    (enterprise_id,enabled,next_daily_at,next_weekly_at,weekly_day,audiences,project_ids)
    values(${enterprise},true,${new Date(now.getTime() + 86_400_000)},${new Date(now.getTime() - 60_000)},1,'["customer","worker","designer","boss"]'::jsonb,${JSON.stringify([pidA, pidB])}::jsonb)`));

  // ------------------------------------------------------- I7.2.2 reminders
  const firstSync = await advanceStageReminders(now, enterprise);
  const firstDelivery = await deliverStageReminders(now, enterprise);
  const remindersA = await withTenantTransaction(enterprise, tx => rows(tx, sql`select * from app.construction_stage_reminders
    where enterprise_id=${enterprise} and project_id=${pidA} order by reminder_id`));
  const remindersB = await withTenantTransaction(enterprise, tx => rows(tx, sql`select * from app.construction_stage_reminders
    where enterprise_id=${enterprise} and project_id=${pidB} order by reminder_id`));
  const allReminders = [...remindersA, ...remindersB];
  const byTrigger = (trigger: string) => allReminders.filter(row => String(row.trigger_type) === trigger);
  const byRole = (role: string) => allReminders.filter(row => String(row.target_role) === role);
  check('reminder.stage_entered', byTrigger('stage_entered').length > 0 ? 'passed' : 'failed',
    '真实 Worker tick 生成阶段进入提醒', { sync: firstSync, delivery: firstDelivery, count: byTrigger('stage_entered').length });
  check('reminder.plan_node_overdue', byTrigger('plan_node_overdue').length > 0 ? 'passed' : 'failed',
    '已发布计划过期生成节点提醒', { count: byTrigger('plan_node_overdue').length });
  check('reminder.plan_node_due_soon', byTrigger('plan_node_due_soon').length > 0 ? 'passed' : 'failed',
    '临近节点生成到期提醒', { count: byTrigger('plan_node_due_soon').length });
  check('reminder.owner_target', byRole('owner').length > 0 ? 'passed' : 'failed', '业主提醒目标为真实业主账号', { count: byRole('owner').length });
  check('reminder.designer_target', byRole('designer').length > 0 ? 'passed' : 'failed', '设计师提醒目标为项目设计师', { count: byRole('designer').length });
  check('reminder.worker_target', byRole('worker').length > 0 ? 'passed' : 'failed', '施工人员提醒目标为项目施工人员', { count: byRole('worker').length });
  check('reminder.manager_target', byRole('manager').length > 0 ? 'passed' : 'failed', '项目经理角色保留独立目标', { count: byRole('manager').length });
  const bossReminders = byRole('boss');
  check('reminder.boss_exception', bossReminders.length > 0 ? 'passed' : 'failed',
    '老板只收到真实计划过期例外', { count: bossReminders.length, triggers: bossReminders.map(row => row.trigger_type) });
  check('reminder.in_app_receipt', allReminders.filter(row => String(row.status) === 'delivered').every(row => row.message_id && row.conversation_id) ? 'passed' : 'failed',
    '已送达提醒均有会话与消息回执', { delivered: allReminders.filter(row => String(row.status) === 'delivered').length });
  check('reminder.boss_no_ordinary_todo', bossReminders.every(row => ['plan_node_overdue', 'issue_overdue'].includes(String(row.trigger_type))) ? 'passed' : 'failed',
    '普通待办未推送给老板');
  check('reminder.owner_confirmation', byTrigger('owner_confirmation').length > 0 ? 'passed' : 'failed', '业主待确认事项提醒', { count: byTrigger('owner_confirmation').length });
  check('reminder.designer_review', byTrigger('designer_review').length > 0 ? 'passed' : 'failed', '设计师待核对事项提醒', { count: byTrigger('designer_review').length });
  check('reminder.worker_missing_material', byTrigger('worker_missing_material').length > 0 ? 'passed' : 'failed',
    '施工人员待补资料提醒', { count: byTrigger('worker_missing_material').length });
  check('reminder.assignee_todo', byTrigger('assignee_todo').length > 0 ? 'passed' : 'failed', '项目经理待处理事项提醒', { count: byTrigger('assignee_todo').length });
  const projectDReminders = await withTenantTransaction(enterprise, tx => rows(tx, sql`select * from app.construction_stage_reminders
    where enterprise_id=${enterprise} and project_id=${pidD} order by reminder_id`));
  check('reminder.data_stale', projectDReminders.some(row => String(row.trigger_type) === 'data_stale') ? 'passed' : 'failed',
    '有真实旧记录时生成记录待更新提醒', { triggers: projectDReminders.map(row => row.trigger_type) });
  const projectCReminders = await withTenantTransaction(enterprise, tx => rows(tx, sql`select trigger_type from app.construction_stage_reminders
    where enterprise_id=${enterprise} and project_id=${pidC}`));
  check('reminder.no_plan_no_due', projectCReminders.every(row => !['plan_node_due_soon', 'plan_node_overdue', 'stage_ending'].includes(String(row.trigger_type)))
    ? 'passed' : 'failed', '没有有效计划时不生成精确到期提醒');
  check('reminder.issue_overdue', 'limited', '现有事项没有真实约定期限字段，不生成问题超期提醒', { dueField: null });


  const secondSync = await advanceStageReminders(now, enterprise);
  const afterSecond = await withTenantTransaction(enterprise, tx => one(tx, sql`select count(*)::int as n from app.construction_stage_reminders where enterprise_id=${enterprise} and project_id=${pidA}`));
  check('reminder.dedupe', Number(afterSecond?.n) === remindersA.length ? 'passed' : 'failed', '重复 tick 不重复生成', { before: remindersA.length, after: afterSecond?.n, secondSync });

  // Permission revocation stops later delivery.
  await withTenantTransaction(enterprise, tx => tx.execute(sql`update app.construction_members set active=false
    where enterprise_id=${enterprise} and project_id=${pidA} and admin_id=${designer}`));
  await advanceStageReminders(now, enterprise);
  const revoked = await withTenantTransaction(enterprise, tx => one(tx, sql`select count(*)::int as n from app.construction_stage_reminders
    where enterprise_id=${enterprise} and project_id=${pidA} and target_principal_id=${designer} and status='pending'`));
  check('reminder.permission_revoked', Number(revoked?.n) === 0 ? 'passed' : 'failed', '撤权后不再保留待发提醒', { pending: revoked?.n });
  await withTenantTransaction(enterprise, tx => tx.execute(sql`update app.construction_members set active=true
    where enterprise_id=${enterprise} and project_id=${pidA} and admin_id=${designer}`));

  // Quiet hours: a new project enters design at night.
  await stage(pidC, 'design');
  const night = new Date(shanghaiDate + 'T22:30:00+08:00');
  await advanceStageReminders(night, enterprise);
  const nightRow = await withTenantTransaction(enterprise, tx => one(tx, sql`select scheduled_at from app.construction_stage_reminders
    where enterprise_id=${enterprise} and project_id=${pidC} order by scheduled_at limit 1`));
  const nightHour = Number(new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', hour12: false })
    .format(new Date(String(nightRow?.scheduled_at))).replace(/\D/g, ''));
  check('reminder.quiet_hours', nightHour >= 8 && nightHour < 21 ? 'passed' : 'failed', '安静时段顺延而非丢弃', { scheduledAt: nightRow?.scheduled_at, nightHour });

  // All ten stages produce a stage-entered reminder for the real project.
  const stageKeys = ['preparation', 'design', 'demolition', 'utilities', 'masonry_carpentry', 'painting', 'installation', 'furnishing', 'completion', 'move_in'];
  const stageEvidence: unknown[] = [];
  for (const key of stageKeys) {
    await stage(pidC, key);
    await advanceStageReminders(now, enterprise);
    const row = await withTenantTransaction(enterprise, tx => one(tx, sql`select stage_id,dedupe_key,status from app.construction_stage_reminders
      where enterprise_id=${enterprise} and project_id=${pidC} and status in ('pending','delivered') order by reminder_id desc limit 1`));
    stageEvidence.push({ key, stageId: row?.stage_id, dedupeKey: row?.dedupe_key, status: row?.status });
  }
  check('reminder.ten_stages', stageEvidence.length === 10 && stageEvidence.every(item => (item as { stageId?: string }).stageId)
    ? 'passed' : 'failed', '十个阶段均生成阶段提醒', stageEvidence);
  const expiredOldStage = await withTenantTransaction(enterprise, tx => one(tx, sql`select count(*)::int as n from app.construction_stage_reminders
    where enterprise_id=${enterprise} and project_id=${pidC} and status='expired' and last_error='stage_changed'`));
  check('reminder.stage_reevaluate', Number(expiredOldStage?.n) > 0 ? 'passed' : 'failed', '阶段变化后旧阶段提醒过期重评', expiredOldStage);

  const ownerActor = { enterpriseId: enterprise, principal: { kind: 'user' as const, userId: ownerA }, contextVersion: 0, capabilities: [] };
  const pause = await pauseStageReminders(ownerActor, { projectId: pidC, triggerType: 'all' });
  const pausedRow = await withTenantTransaction(enterprise, tx => one(tx, sql`select count(*)::int as n from app.construction_stage_reminders
    where enterprise_id=${enterprise} and project_id=${pidC} and target_principal_id=${ownerA} and status='paused'`));
  await resumeStageReminders(ownerActor, { projectId: pidC, triggerType: 'all' });
  const resumed = await withTenantTransaction(enterprise, tx => one(tx, sql`select count(*)::int as n from app.construction_stage_reminders
    where enterprise_id=${enterprise} and project_id=${pidC} and target_principal_id=${ownerA} and status='pending'`));
  check('reminder.pause_resume', pause.paused && Number(pausedRow?.n) > 0 && Number(resumed?.n) > 0 ? 'passed' : 'failed',
    '暂停与恢复按真实收件人生效', { paused: pausedRow?.n, resumed: resumed?.n });

  const cancelTarget = await withTenantTransaction(enterprise, tx => one(tx, sql`select reminder_id from app.construction_stage_reminders
    where enterprise_id=${enterprise} and project_id=${pidC} and target_principal_id=${ownerA} and status='pending' order by reminder_id limit 1`));
  const cancelled = cancelTarget ? await cancelStageReminder(ownerActor, { reminderId: String(cancelTarget.reminder_id) }) : null;
  check('reminder.cancel', cancelled?.cancelled === true ? 'passed' : 'failed', '收件人可取消自己的待发提醒', cancelled);

  // A closed inbox fails honestly; reopening the same real conversation retries.
  await withTenantTransaction(enterprise, tx => tx.execute(sql`update app.assistant_conversations set status='archived' where enterprise_id=${enterprise} and id=${c01B}`));
  await stage(pidD, 'installation');
  await advanceStageReminders(now, enterprise);
  const failedDelivery = await deliverStageReminders(now, enterprise);
  const failedRow = await withTenantTransaction(enterprise, tx => one(tx, sql`select status,last_error,message_id from app.construction_stage_reminders
    where enterprise_id=${enterprise} and project_id=${pidD} and target_principal_id=${ownerB} and stage_id='installation' order by reminder_id limit 1`));
  await withTenantTransaction(enterprise, tx => tx.execute(sql`update app.assistant_conversations set status='open' where enterprise_id=${enterprise} and id=${c01B}`));
  await deliverStageReminders(now, enterprise);
  const retriedRow = await withTenantTransaction(enterprise, tx => one(tx, sql`select status,last_error,message_id from app.construction_stage_reminders
    where enterprise_id=${enterprise} and project_id=${pidD} and target_principal_id=${ownerB} and stage_id='installation' order by reminder_id limit 1`));
  check('reminder.failure_retry', String(failedRow?.status) === 'failed' && String(retriedRow?.status) === 'delivered' && retriedRow?.message_id
    ? 'passed' : 'failed', '发送失败保留状态并在恢复后重试', { failed: failedRow, retried: retriedRow, failedDelivery });

  // ------------------------------------------------------- I7.2.3 reports
  const queued = await advanceConstructionReports(now, enterprise);
  let processed = 0;
  for (let index = 0; index < 30; index++) {
    const pendingFacts = await withPlatformTransaction(tx => one(tx, sql`select count(*)::int as n from app.assistant_jobs j
      join app.assistant_runs r on r.enterprise_id=j.enterprise_id and r.id=j.run_id
      where j.enterprise_id=${enterprise} and j.status='queued' and r.purpose='construction.report.facts'`));
    if (!Number(pendingFacts?.n)) break;
    const result = await processAssistantJob(async lease => {
      const purpose = await withTenantTransaction(lease.enterpriseId, async tx => String((await runContext(tx, lease)).run.purpose));
      if (purpose === 'construction.report.facts') { await processConstructionReport(lease); processed++; }
      else await failRun(lease, 'ai_unavailable').catch(() => undefined);
    });
    if (!result.claimed) break;
  }
  const delivered = await deliverConstructionReports(enterprise);
  const reports = await withTenantTransaction(enterprise, tx => rows(tx, sql`select r.*,v.revision as revision,v.facts,v.facts_hash,v.generated_at,v.status as version_status,
    d.state as delivery_state,d.message_id,b.audience,b.user_id,b.admin_id
    from app.construction_reports r join app.construction_report_versions v on v.enterprise_id=r.enterprise_id and v.report_id=r.id
    left join app.construction_report_deliveries d on d.enterprise_id=r.enterprise_id and d.report_id=r.id and d.revision=v.revision
    left join app.construction_followup_bindings b on b.enterprise_id=r.enterprise_id and b.id=r.binding_id
    where r.enterprise_id=${enterprise} and r.kind='weekly' order by r.id`));
  const audiences = [...new Set(reports.map(row => String(row.audience)))].sort();
  check('report.weekly_generated', reports.length >= 4 ? 'passed' : 'failed', '真实 Worker 生成周报事实与版本',
    { queued, processed, delivered, reports: reports.length, audiences });
  check('report.four_roles', ['boss', 'customer', 'designer', 'worker'].every(audience => audiences.includes(audience)) ? 'passed' : 'failed',
    '四个角色均有周报', audiences);
  const bossReport = reports.find(row => String(row.audience) === 'boss');
  const bossFacts = bossReport?.facts as { projects?: Array<{ id: string }> } | undefined;
  check('report.boss_cross_project', (bossFacts?.projects?.length || 0) >= 2 ? 'passed' : 'failed', '老板周报覆盖授权范围内多个项目',
    { projects: bossFacts?.projects?.map(item => item.id) });
  const customerReport = reports.find(row => String(row.audience) === 'customer');
  const customerFacts = customerReport?.facts as { projects?: Array<{ id: string; weekSchedule?: unknown }> } | undefined;
  check('report.customer_scope', customerFacts?.projects?.length === 1 ? 'passed' : 'failed', '业主只看到自己的项目',
    { projects: customerFacts?.projects?.map(item => item.id) });
  check('report.week_schedule', customerFacts?.projects?.[0]?.weekSchedule ? 'passed' : 'failed', '周报事实含已发布计划快照');

  const digestEvidence: unknown[] = [];
  for (const report of reports) {
    const digest = buildRoleWeeklyDigest({ facts: report.facts as never, binding: {
      enterprise_id: enterprise, user_id: report.user_id, admin_id: report.admin_id, audience: report.audience,
    }, report: {
      id: String(report.id), revision: Number(report.revision), period_start: String(report.period_start),
      period_end: String(report.period_end), generated_at: report.generated_at ? String(report.generated_at) : null,
      facts_hash: report.facts_hash ? String(report.facts_hash) : null,
      delivery_state: report.delivery_state ? String(report.delivery_state) : null,
    } });
    digestEvidence.push({ reportId: String(report.id), revision: Number(report.latest_revision), audience: report.audience,
      delivery: report.delivery_state, messageId: report.message_id, sourceSnapshotVersion: report.facts_hash,
      sections: digest?.sections?.map(section => section.key) });
  }
  check('report.role_sections', digestEvidence.every(item => (item as { sections?: string[] }).sections?.length)
    ? 'passed' : 'failed', '四角色章节由同一事实快照投影', digestEvidence);
  check('report.delivery_receipt', reports.filter(row => String(row.delivery_state) === 'delivered').every(row => row.message_id)
    ? 'passed' : 'failed', '周报投递有站内消息回执', { delivered: reports.filter(row => String(row.delivery_state) === 'delivered').length });

  // Same period rerun must not create another report.
  const beforeRerun = reports.length;
  await withTenantTransaction(enterprise, tx => tx.execute(sql`update app.construction_report_settings set next_weekly_at=${new Date(now.getTime() - 60_000)}
    where enterprise_id=${enterprise}`));
  await advanceConstructionReports(now, enterprise);
  const afterRerun = await withTenantTransaction(enterprise, tx => one(tx, sql`select count(*)::int as n from app.construction_reports
    where enterprise_id=${enterprise} and kind='weekly'`));
  check('report.idempotent', Number(afterRerun?.n) === beforeRerun ? 'passed' : 'failed', '同一周期重复运行不重复生成',
    { before: beforeRerun, after: afterRerun?.n });

  // Reentry reads the saved weekly report and its history through the real
  // followup service, not a script-local projection.
  const ownerContext = await withTenantTransaction(enterprise, tx => one(tx, sql`select context_version from app.users where id=${ownerA}`));
  const followup = new FollowupService({ enterpriseId: enterprise, principal: { kind: 'user', userId: ownerA },
    contextVersion: Number(ownerContext?.context_version || 1), capabilities: ['assistant.followup.self'] });
  const ownerReport = reports.find(row => String(row.audience) === 'customer' && String(row.user_id) === ownerA);
  const reentry = ownerReport ? await followup.detail(String(ownerReport.binding_id), String(ownerReport.id), Number(ownerReport.revision)) : null;
  check('report.reentry', !!(reentry && 'weeklyReport' in reentry && reentry.weeklyReport
    && reentry.weeklyReport.contract.reportId === String(ownerReport!.id)
    && reentry.weeklyReport.contract.reportVersion === Number(ownerReport!.revision)
    && reentry.weeklyReport.contract.sourceSnapshotVersion === String(ownerReport!.facts_hash))
    ? 'passed' : 'failed', '退出重新进入读取同一周报事实与版本', { reportId: ownerReport?.id, revision: ownerReport?.revision });
  const history = ownerReport ? await followup.reports(String(ownerReport.binding_id), undefined, { kind: 'weekly' }) : null;
  check('report.history', !!history?.items?.some(item => item.reportId === String(ownerReport!.id)) ? 'passed' : 'failed',
    '历史周报可在原入口重新查看', { items: history?.items?.map(item => ({ reportId: item.reportId, revision: item.revision, available: item.available })) });

  // A fact revision adds a version and keeps the original.
  const correction = ownerReport ? await withTenantTransaction(enterprise, async tx => {
    const settings = await one(tx, sql`select * from app.construction_report_settings where enterprise_id=${enterprise} and enabled for share`);
    const report = await one(tx, sql`select * from app.construction_reports where enterprise_id=${enterprise} and id=${String(ownerReport.id)} for update`);
    return report && settings ? enqueueReportCorrection(tx, enterprise, report, settings, new Date(String(report.period_end)), false) : null;
  }) : null;
  if (correction) {
    for (let index = 0; index < 10; index++) {
      const pendingFacts = await withPlatformTransaction(tx => one(tx, sql`select count(*)::int as n from app.assistant_jobs j
        join app.assistant_runs r on r.enterprise_id=j.enterprise_id and r.id=j.run_id
        where j.enterprise_id=${enterprise} and j.status='queued' and r.purpose='construction.report.facts'`));
      if (!Number(pendingFacts?.n)) break;
      const result = await processAssistantJob(async lease => {
        const purpose = await withTenantTransaction(lease.enterpriseId, async tx => String((await runContext(tx, lease)).run.purpose));
        if (purpose === 'construction.report.facts') await processConstructionReport(lease);
        else await failRun(lease, 'ai_unavailable').catch(() => undefined);
      });
      if (!result.claimed) break;
    }
    await deliverConstructionReports(enterprise);
  }
  const versions = ownerReport ? await withTenantTransaction(enterprise, tx => rows(tx, sql`select revision,status from app.construction_report_versions
    where enterprise_id=${enterprise} and report_id=${String(ownerReport.id)} order by revision`)) : [];
  const oldVersion = ownerReport ? await followup.detail(String(ownerReport.binding_id), String(ownerReport.id), 1).catch(() => null) : null;
  check('report.versioning', !!correction && versions.length >= 2 && !!oldVersion
    ? 'passed' : 'failed', '数据修订生成新版本并保留旧版本', { correction, versions, oldAvailable: !!oldVersion });

  // Revoked designer loses historical report access without rewriting the report.
  await withTenantTransaction(enterprise, tx => tx.execute(sql`update app.construction_members set active=false
    where enterprise_id=${enterprise} and project_id=${pidA} and admin_id=${designer}`));
  const designerBinding = await withTenantTransaction(enterprise, tx => one(tx, sql`select * from app.construction_followup_bindings
    where enterprise_id=${enterprise} and principal_key=${'admin:' + designer} and audience='designer' order by id limit 1`));
  const visibleAfterRevoke = designerBinding
    ? await withTenantTransaction(enterprise, tx => followupProjects(tx, enterprise, designerBinding, false, [pidA])) : [];
  check('report.permission_masking', visibleAfterRevoke.length === 0 ? 'passed' : 'failed',
    '撤权后历史周报按当前权限遮蔽', { bindingId: designerBinding?.id, visibleProjects: visibleAfterRevoke.map(row => String(row.id)) });
  await withTenantTransaction(enterprise, tx => tx.execute(sql`update app.construction_members set active=true
    where enterprise_id=${enterprise} and project_id=${pidA} and admin_id=${designer}`));

  // --------------------------------------------------- I7.2.4 C01 stage chat
  const conversation = await withTenantTransaction(enterprise, tx => one(tx, sql`select conversation_id from app.construction_followup_bindings
    where enterprise_id=${enterprise} and principal_key=${'user:' + ownerA} and audience='customer' order by id limit 1`));
  const stageReply = conversation?.conversation_id ? await withTenantTransaction(enterprise, tx => stageChatForConversation({
    tx, enterpriseId: enterprise, conversationId: String(conversation.conversation_id), userId: ownerA,
    question: '现在水电阶段需要注意什么？',
  })) : null;
  check('c01.stage_answer', !!(stageReply && /水电/u.test(stageReply) && /不替代/u.test(stageReply)) ? 'passed' : 'failed',
    '业主 C01 直接得到当前阶段知识回答', { conversationId: conversation?.conversation_id, excerpt: stageReply?.slice(0, 160) });

  // Duplicate outbox: an already appended reminder message must not duplicate.
  const deliveredReminder = allReminders.find(row => String(row.status) === 'delivered');
  const duplicateMessageCount = deliveredReminder ? await withTenantTransaction(enterprise, tx => one(tx, sql`select count(*)::int as n
    from app.assistant_messages where enterprise_id=${enterprise} and conversation_id=${String(deliveredReminder.conversation_id)}
    and source_event_id in (select id from app.domain_event_outbox where enterprise_id=${enterprise}
      and type='construction.stage_reminder.delivered.v1' and aggregate_id=${String(deliveredReminder.reminder_id)})
    and purpose='construction.stage_reminder'`)) : null;
  check('outbox.duplicate', Number(duplicateMessageCount?.n) === 1 ? 'passed' : 'failed', '重复 Outbox 不重复投递站内消息', duplicateMessageCount);

  // AI unavailable: deterministic business facts and stage answers remain.
  check('ai.degraded', !!(stageReply && reports.length) ? 'passed' : 'failed', '未配置模型时阶段问答、提醒和周报事实仍可用', { stageAnswer: !!stageReply, reports: reports.length });

  run.ids.reportIds = reports.map(row => String(row.id));
  run.finishedAt = new Date().toISOString();
  const output = path.join(admin, '..', 'tmp/xiaok-i72-acceptance');
  fs.mkdirSync(output, { recursive: true });
  const file = path.join(output, 'result-' + suffix + '.json');
  fs.writeFileSync(file, JSON.stringify(run, null, 2) + '\n');
  console.log(JSON.stringify({ result: file, checks: run.checks.map(item => item.id + ':' + item.status) }));
  await closePostgresPool();
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
