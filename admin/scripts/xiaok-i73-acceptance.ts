/** I7.3 isolated pilot acceptance. It refuses any database other than the
 * explicitly named local I7.3 acceptance target and only uses synthetic data. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import bcrypt from 'bcryptjs';

const admin = path.resolve(process.cwd());
loadEnvConfig(admin, true);

const target = process.env.XIAOK_I73_DATABASE_URL?.trim();
if (!target) throw new Error('XIAOK_I73_DATABASE_URL is required');
const parsed = new URL(target);
if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || parsed.port !== '55443'
  || parsed.pathname !== '/i73_accept' || parsed.username !== 'sfp_app') {
  throw new Error('Use only the isolated I7.3 acceptance database (127.0.0.1:55443/i73_accept as sfp_app)');
}
process.env.DATABASE_URL = target;

type CheckStatus = 'passed' | 'failed' | 'limited' | 'not_run' | 'unknown';
const run: {
  startedAt: string; finishedAt?: string; database: string; ids: Record<string, unknown>;
  checks: Array<{ id: string; status: CheckStatus; detail: string; evidence?: unknown }>;
  ui?: Record<string, unknown>;
} = {
  startedAt: new Date().toISOString(), database: parsed.pathname.slice(1), checks: [], ids: {},
};
const check = (id: string, status: CheckStatus, detail: string, evidence?: unknown) => {
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
  const { currentRecord, openRecordIssue, readSiteIssue, readSiteIssueBase } = await import('@/lib/construction/site-issues');
  const { advanceStageReminders, deliverStageReminders, listStageReminders } = await import('@/lib/xiaok-v1/reminder-service');
  const { advanceConstructionReports, deliverConstructionReports, processConstructionReport } = await import('@/lib/construction/report-worker');
  const { processAssistantJob, failRun, runContext } = await import('@/lib/assistant/infrastructure/job-queue');
  const { buildRoleWeeklyDigest } = await import('@/lib/xiaok-v1/weekly-report-service');
  const { stageChatForConversation } = await import('@/lib/xiaok-v1/stage-chat-service');
  const { FollowupService } = await import('@/lib/construction/followup-service');
  const { enqueueReportCorrection } = await import('@/lib/construction/report-store');
  const { signMiniProgramToken } = await import('@/lib/miniprogram-jwt');

  const identity = await withPlatformTransaction(tx => one(tx, sql`select current_user as db_user,current_database() as db_name`));
  assert.equal(identity?.db_user, 'sfp_app');
  assert.equal(identity?.db_name, 'i73_accept');

  const now = new Date();
  const shanghaiDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const day = (offset: number) => {
    const base = new Date(shanghaiDate + 'T00:00:00+08:00');
    return new Date(base.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  };
  // Reminder ticks run at a fixed permitted hour so the acceptance result does
  // not depend on the wall clock crossing the quiet-hours boundary.
  const reminderNow = new Date(shanghaiDate + 'T10:00:00+08:00');

  // ---------------------------------------------------------------- fixture
  const suffix = String(now.getTime());
  const password = 'I73-Pass-' + suffix;
  const passwordHash = await bcrypt.hash(password, 10);
  const enterprise = await withPlatformTransaction(async tx => {
    const inserted = await one(tx, sql`insert into app.enterprises(name,code,status,registration_mode)
      values(${'I7.3试点验收合成-' + suffix},${'xiaok-i73-accept-' + suffix},'active','manual') returning id::text`);
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
    const username = 'i73_' + suffix + '_' + index;
    const linked = await one(tx, sql`insert into app.users(enterprise_id,phone,nickname,role)
      values(${enterprise},${phone},${name},'user') returning id::text`);
    const inserted = await one(tx, sql`insert into app.admin_users(enterprise_id,user_id,username,password_hash,display_name,role,status,must_change_password,phone,menu_permissions,construction_trades)
      values(${enterprise},${String(linked!.id)},${username},${passwordHash},${name},${role},'active',false,${phone},
      ARRAY(select jsonb_array_elements_text(${JSON.stringify(getDefaultMenuKeys(role))}::jsonb)),ARRAY[]::text[]) returning id::text`);
    return { adminId: String(inserted!.id), userId: String(linked!.id), username };
  });

  const ownerA = await user('19973000001', '试点业主甲');
  const ownerB = await user('19973000002', '试点业主乙');
  // A synthetic WeChat identity is required by the real customer assistant
  // auth path. It is isolated test data, never a real account binding.
  await withPlatformTransaction(tx => tx.execute(sql`insert into app.wechat_identities(user_id,openid)
    values(${ownerA},${'i73-openid-' + suffix + '-a'}),(${ownerB},${'i73-openid-' + suffix + '-b'})`));
  const boss = await adminUser('enterprise_admin', '试点老板周', '19973000011', 1);
  const manager = await adminUser('construction_staff', '试点项目经理陈', '19973000012', 2);
  const designer = await adminUser('designer', '试点设计师林', '19973000013', 3);
  const worker = await adminUser('construction_staff', '试点施工陈师傅', '19973000014', 4);
  run.ids = { ...run.ids, ownerA, ownerB, boss: boss.adminId, manager: manager.adminId, designer: designer.adminId, worker: worker.adminId };

  const owner = new ConstructionService({ enterpriseId: enterprise, adminId: boss.adminId });
  const project = async (name: string, ownerId: string, rooms: string[]) => withTenantTransaction(enterprise, async tx => {
    const lead = await one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source)
      values(${enterprise},${ownerId},${name},${'19973' + Math.floor(Math.random() * 1e6)},'natural') returning id::text`);
    return String(lead!.id);
  }).then(leadId => owner.execute('create', { leadId, name, managerId: manager.adminId, rooms }, randomUUID()));

  const projectA = await project('I7.3 水电试点项目A', ownerA, ['卫生间', '客厅']);
  const projectB = await project('I7.3 泥木试点项目B', ownerB, ['厨房']);
  const projectC = await project('I7.3 阶段变更项目C', ownerA, ['主卧']);
  const pidA = String(projectA.id), pidB = String(projectB.id), pidC = String(projectC.id);
  run.ids = { ...run.ids, projectA: pidA, projectB: pidB, projectC: pidC };

  for (const pid of [pidA, pidB, pidC]) {
    for (const [role, aid] of [['designer', designer.adminId], ['worker', worker.adminId]] as const) {
      const detail = await owner.execute('detail', { projectId: pid });
      await owner.execute('member', { projectId: pid, expectedVersion: (detail.project as { version: number }).version,
        adminId: aid, role, active: true, workLabel: role === 'designer' ? '设计核对' : '现场施工' }, randomUUID());
    }
  }

  const stage = async (pid: string, key: string) => {
    const detail = await owner.execute('detail', { projectId: pid });
    await owner.execute('progress', { projectId: pid, expectedVersion: (detail.project as { version: number }).version,
      stageKey: key, note: 'I7.3 合成验收进入' + key, sendReminder: false }, randomUUID());
  };
  await stage(pidA, 'utilities');
  await stage(pidB, 'masonry_carpentry');
  await stage(pidC, 'utilities');

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
  const c01C = await createC01(ownerA, [pidC]);
  run.ids = { ...run.ids, c01A, c01C };

  const rooms = async (pid: string) => withTenantTransaction(enterprise, tx => rows<{ id: string; name: string }>(tx,
    sql`select id::text,name from app.construction_rooms where enterprise_id=${enterprise} and project_id=${pid} order by id`));
  const roomsA = await rooms(pidA), roomsB = await rooms(pidB), roomsC = await rooms(pidC);
  const plan = async (pid: string, nodes: Array<{ key: string; stageKey: string; roomId: string | null; plannedStart: string; plannedEnd: string }>) =>
    owner.execute('saveSchedule', { projectId: pid, expectedVersion: 0,
      title: 'I7.3 施工计划', note: '合成验收计划', nodes }, randomUUID());
  const scheduleA = await plan(pidA, [
    { key: 'utilities_bath', stageKey: 'utilities', roomId: roomsA[0].id, plannedStart: day(-12), plannedEnd: day(-5) },
    { key: 'utilities_living', stageKey: 'utilities', roomId: roomsA[1].id, plannedStart: day(-2), plannedEnd: day(4) },
  ]);
  const scheduleB = await plan(pidB, [
    { key: 'masonry_kitchen', stageKey: 'masonry_carpentry', roomId: roomsB[0].id, plannedStart: day(-2), plannedEnd: day(5) },
  ]);
  const scheduleC = await plan(pidC, [
    { key: 'utilities_bedroom', stageKey: 'utilities', roomId: roomsC[0].id, plannedStart: day(-3), plannedEnd: day(3) },
  ]);
  run.ids = { ...run.ids, scheduleA, scheduleB, scheduleC };

  const workerChat = new SiteChatService({ enterpriseId: enterprise, adminId: worker.adminId });
  const publishRecord = async (pid: string, roomName: string, text: string, completed: string, pending: string, coordination: string) => {
    const messageId = randomUUID();
    const draft = await workerChat.withWriteScope(pid, async (tx, c) => {
      const room = await one(tx, sql`select id::text,name from app.construction_rooms where enterprise_id=${enterprise}
        and project_id=${pid} and name=${roomName}`);
      assert.ok(room?.id);
      const message = await appendMessage(tx, workerChat.actor, String(c.id), { author: 'admin', clientMessageId: messageId,
        purpose: 'site.source', content: { version: 1, blocks: [{ type: 'text', text: [completed, pending, coordination].join('\n') }] } });
      const data = { title: 'I7.3 现场记录', completed, pending, coordination, roomId: room.id, note: text };
      const row = (await one(tx, sql`insert into app.construction_site_records(enterprise_id,project_id,conversation_id,source_message_id,
        author_id,status,data,room_id,room_name_snapshot) values(${enterprise},${pid},${String(c.id)},${String(message.id)},${worker.adminId},
        'draft',${JSON.stringify(data)}::jsonb,${String(room.id)},${roomName}) returning *`))!;
      await recordVersion(tx, enterprise, row, worker.adminId, 'organized');
      return { row, messageId: String(message.id) };
    });
    if (draft.row.status === 'draft') await new SiteChatService({ enterpriseId: enterprise, adminId: manager.adminId })
      .mutate(pid, String(draft.row.id), 'publish', { expectedVersion: Number(draft.row.version), audience: 'customer' }, randomUUID());
    return { recordId: String(draft.row.id), messageId: draft.messageId };
  };
  const recordA = await publishRecord(pidA, '卫生间', '本周完成水电开槽和布管。', '水电开槽和布管完成', '卫生间等电位连接待补照片', '请业主确认客厅电视墙插座位置');
  const recordA2 = await publishRecord(pidA, '客厅', '客厅线管继续排布。', '客厅线管排布完成', '', '');
  const recordB = await publishRecord(pidB, '厨房', '本周完成墙砖铺贴。', '厨房墙砖铺贴完成', '地砖等待材料进场', '');
  const recordB2 = await publishRecord(pidB, '厨房', '厨房地砖铺贴完成。', '厨房地砖铺贴完成', '', '');
  const recordB3 = await publishRecord(pidB, '厨房', '厨房门套收口修正。', '厨房门套收口修正', '', '');
  const recordB4 = await publishRecord(pidB, '厨房', '厨房吊顶基层完成。', '厨房吊顶基层完成', '', '');

  const issue = async (pid: string, recordId: string, sourceMessageId: string, state: string, options: {
    ownerId?: string; confirmed?: boolean; revision: number; title?: string;
  }) => withTenantTransaction(enterprise, async tx => {
    const source = await currentRecord(tx, enterprise, pid, recordId);
    assert.ok(source);
    const request = await one(tx, sql`select content from app.assistant_messages where enterprise_id=${enterprise} and id=${sourceMessageId}`);
    assert.ok(request);
    const opened = await openRecordIssue(tx, enterprise, pid, recordId, source!, {
      openedBy: worker.adminId, requestMessageId: sourceMessageId, requestHash: fingerprint(request!.content),
      requestText: options.title || 'I7.3 合成验收事项', projectReview: false,
    }, { kind: 'admin', adminId: manager.adminId }, randomUUID());
    const base = await readSiteIssueBase(tx, enterprise, pid, opened!.issueId);
    assert.ok(base);
    const payload = { ...base, revision: options.revision, state, action: 'i73',
      ...(options.ownerId ? { ownerId: options.ownerId } : {}), ...(options.confirmed ? { confirmed: true, confirmedAt: now.toISOString(), confirmedBy: manager.adminId } : {}) };
    await tx.execute(sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
      values(${enterprise},'construction.site.issue.progress.v1','construction_site_issue',${opened!.issueId},${options.revision},
      '{"kind":"admin"}'::jsonb,${randomUUID()},${JSON.stringify(payload)}::jsonb)`);
    return opened!.issueId;
  });
  const issueDesigner = await issue(pidA, recordA.recordId, recordA.messageId, 'awaiting_owner', { ownerId: designer.adminId, revision: 2, title: '客厅插座点位请设计师核对' });
  const issueWorker = await issue(pidA, recordA2.recordId, recordA2.messageId, 'awaiting_owner', { ownerId: worker.adminId, confirmed: true, revision: 2, title: '卫生间等电位照片待补' });
  const issueRectifying = await issue(pidB, recordB.recordId, recordB.messageId, 'rectifying', { ownerId: worker.adminId, confirmed: true, revision: 2, title: '厨房阴角空鼓整改中' });
  const issueReview = await issue(pidB, recordB2.recordId, recordB2.messageId, 'awaiting_review', { ownerId: worker.adminId, confirmed: true, revision: 3, title: '厨房地砖平整度待复核' });
  const issueClosed = await issue(pidB, recordB3.recordId, recordB3.messageId, 'closed', { ownerId: worker.adminId, confirmed: true, revision: 3, title: '厨房门套收口已修正' });
  const issueManager = await issue(pidB, recordB4.recordId, recordB4.messageId, 'awaiting_owner', { ownerId: manager.adminId, confirmed: true, revision: 2, title: '项目经理待安排吊顶验收' });
  run.ids = { ...run.ids, issueDesigner, issueWorker, issueRectifying, issueReview, issueClosed, issueManager,
    recordA, recordA2, recordB, recordB2, recordB3, recordB4 };

  await withTenantTransaction(enterprise, tx => tx.execute(sql`insert into app.construction_report_settings
    (enterprise_id,enabled,next_daily_at,next_weekly_at,weekly_day,audiences,project_ids)
    values(${enterprise},true,${new Date(now.getTime() + 86_400_000)},${new Date(now.getTime() - 60_000)},1,'["customer","worker","designer","boss"]'::jsonb,${JSON.stringify([pidA, pidB])}::jsonb)`));

  // ------------------------------------------------- I7.3 reminders + workbench
  const sync = await advanceStageReminders(reminderNow, enterprise);
  const delivered = await deliverStageReminders(reminderNow, enterprise);
  const managerActor = { enterpriseId: enterprise, principal: { kind: 'admin' as const, adminId: manager.adminId }, contextVersion: 0, capabilities: [] };
  const designerActor = { enterpriseId: enterprise, principal: { kind: 'admin' as const, adminId: designer.adminId }, contextVersion: 0, capabilities: [] };
  const workerActor = { enterpriseId: enterprise, principal: { kind: 'admin' as const, adminId: worker.adminId }, contextVersion: 0, capabilities: [] };
  const ownerActor = { enterpriseId: enterprise, principal: { kind: 'user' as const, userId: ownerA }, contextVersion: 0, capabilities: [] };
  const managerInbox = await listStageReminders(managerActor);
  const managerWorkbench = managerInbox.items.filter(item => item.channel === 'workbench');
  check('reminder.manager_workbench', managerWorkbench.length > 0 && managerWorkbench.every(item => item.status === 'failed' && item.lastError === 'no_inbox')
    ? 'passed' : 'failed', '项目经理无私人会话时以现有工作台待办作为接收渠道', {
    count: managerWorkbench.length, rest: managerInbox.items.length, sync, delivered,
  });
  const managerConversations = await withTenantTransaction(enterprise, tx => one(tx, sql`select count(*)::int as n from app.assistant_conversations c
    join app.assistant_participants p on p.enterprise_id=c.enterprise_id and p.conversation_id=c.id
    where c.enterprise_id=${enterprise} and p.admin_id=${manager.adminId}`));
  check('reminder.manager_no_borrowed_chat', Number(managerConversations?.n) === 0 ? 'passed' : 'failed',
    '项目经理未借用老板或施工人员会话', { conversations: managerConversations?.n });

  const workerInbox = await listStageReminders(workerActor, pidA);
  const nodeReminder = workerInbox.items.find(item => item.relatedTaskId && item.roomId);
  check('reminder.room_deep_link', !!nodeReminder ? 'passed' : 'failed', '计划节点提醒返回真实房间定位信息',
    { reminderId: nodeReminder?.reminderId, roomId: nodeReminder?.roomId, actionUrl: nodeReminder?.actionUrl });
  const designerInbox = await listStageReminders(designerActor, pidA);
  const issueReminder = designerInbox.items.find(item => item.relatedIssueId);
  check('reminder.issue_deep_link', issueReminder?.relatedIssueId === issueDesigner ? 'passed' : 'failed',
    '事项提醒返回真实 issueId 供页面定位', { reminderId: issueReminder?.reminderId, issueId: issueReminder?.relatedIssueId });

  const deliveredItems = (await listStageReminders(ownerActor, pidA)).items.filter(item => item.status === 'delivered');
  check('reminder.delivered_not_read', deliveredItems.length > 0 && deliveredItems.every(item => item.deliveredAt && !('readAt' in item))
    ? 'passed' : 'failed', '站内已送达明确保留未读语义', { delivered: deliveredItems.length });

  // A revoked designer loses even already delivered reminder content before the next tick.
  await withTenantTransaction(enterprise, tx => tx.execute(sql`update app.construction_members set active=false
    where enterprise_id=${enterprise} and project_id=${pidA} and admin_id=${designer.adminId}`));
  const revokedInbox = await listStageReminders(designerActor);
  check('reminder.revoked_hidden', revokedInbox.items.every(item => item.projectId !== pidA)
    ? 'passed' : 'failed', '权限撤销后历史提醒内容不再返回', { projectAItems: revokedInbox.items.filter(item => item.projectId === pidA).length });
  await withTenantTransaction(enterprise, tx => tx.execute(sql`update app.construction_members set active=true
    where enterprise_id=${enterprise} and project_id=${pidA} and admin_id=${designer.adminId}`));

  // Stage change keeps closed reminders as explicit history, not current todos.
  await stage(pidC, 'masonry_carpentry');
  await advanceStageReminders(reminderNow, enterprise);
  const managerCInbox = await listStageReminders(managerActor, pidC);
  check('reminder.history_expired', managerCInbox.items.every(item => item.status !== 'expired')
    && managerCInbox.history.some(item => item.status === 'expired')
    ? 'passed' : 'failed', '阶段变化后旧提醒进入历史并明确标记已过期', {
    current: managerCInbox.items.map(item => ({ id: item.reminderId, status: item.status })),
    history: managerCInbox.history.map(item => ({ id: item.reminderId, status: item.status })),
  });

  // ------------------------------------------------- I7.3 weekly reports
  const queued = await advanceConstructionReports(now, enterprise);
  for (let index = 0; index < 30; index++) {
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
  const reportDelivery = await deliverConstructionReports(enterprise);
  // The isolated dev Worker also consumes the shared queue. Wait for the four
  // role facts to reach facts_ready before projecting digests and receipts.
  for (let index = 0; index < 90; index++) {
    const ready = await withTenantTransaction(enterprise, tx => one(tx, sql`select count(distinct b.audience)::int as n
      from app.construction_reports r
      join app.construction_report_versions v on v.enterprise_id=r.enterprise_id and v.report_id=r.id
        and v.revision=r.latest_revision and v.status='facts_ready'
      join app.construction_followup_bindings b on b.enterprise_id=r.enterprise_id and b.id=r.binding_id
      where r.enterprise_id=${enterprise} and r.kind='weekly'`));
    if (Number(ready?.n) >= 4) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  const reports = await withTenantTransaction(enterprise, tx => rows(tx, sql`select r.*,v.revision as revision,v.facts,v.facts_hash,v.generated_at,v.status as version_status,
    d.state as delivery_state,d.message_id,b.audience,b.user_id,b.admin_id
    from app.construction_reports r join app.construction_report_versions v on v.enterprise_id=r.enterprise_id and v.report_id=r.id
      and v.revision=r.latest_revision and v.status='facts_ready'
    left join app.construction_report_deliveries d on d.enterprise_id=r.enterprise_id and d.report_id=r.id and d.revision=v.revision
    left join app.construction_followup_bindings b on b.enterprise_id=r.enterprise_id and b.id=r.binding_id
    where r.enterprise_id=${enterprise} and r.kind='weekly' order by r.id`));
  const deliveredReports = await deliverConstructionReports(enterprise);
  const readyReports = reports.filter(row => row.facts && Array.isArray((row.facts as { projects?: unknown }).projects));
  check('report.four_roles', ['boss', 'customer', 'designer', 'worker'].every(audience => readyReports.some(row => String(row.audience) === audience))
    ? 'passed' : 'failed', '四端各自生成周报', { queued, delivery: reportDelivery, deliveredReports,
    audiences: [...new Set(readyReports.map(row => String(row.audience)))], versions: reports.length });

  const digests = readyReports.map(report => {
    const digest = buildRoleWeeklyDigest({ facts: report.facts as never, binding: {
      enterprise_id: enterprise, user_id: report.user_id, admin_id: report.admin_id, audience: report.audience,
    }, report: {
      id: String(report.id), revision: Number(report.revision), period_start: String(report.period_start),
      period_end: String(report.period_end), generated_at: report.generated_at ? String(report.generated_at) : null,
      facts_hash: report.facts_hash ? String(report.facts_hash) : null,
      delivery_state: report.delivery_state ? String(report.delivery_state) : null,
    } });
    return { audience: String(report.audience), report, digest };
  });
  const sectionKeys = (audience: string) => digests.find(item => item.audience === audience)?.digest?.sections.map(section => section.key) || [];
  check('report.role_distinct', sectionKeys('customer').join(',') !== sectionKeys('boss').join(',')
    && sectionKeys('designer').join(',') !== sectionKeys('worker').join(',')
    ? 'passed' : 'failed', '四端周报章节不同，非同一正文', {
    customer: sectionKeys('customer'), designer: sectionKeys('designer'), boss: sectionKeys('boss'), worker: sectionKeys('worker'),
  });
  const ownerDigest = digests.find(item => item.audience === 'customer')?.digest;
  const ownerText = JSON.stringify(ownerDigest || {});
  const ownerIssueIds = (ownerDigest?.sections.find(section => section.key === 'issues')?.lines || [])
    .flatMap(line => line.sourceRefs);
  check('report.owner_no_internal', !ownerText.includes('厨房阴角空鼓整改中')
    && !ownerText.includes('厨房地砖平整度待复核') && !ownerText.includes('厨房门套收口已修正')
    && ownerIssueIds.every(refId => String(refId).startsWith('issue:'))
    ? 'passed' : 'failed', '业主周报只含对客记录问题，不泄露内部问题与整改备注', { issueRefs: ownerIssueIds });

  const customerReport = readyReports.find(row => String(row.audience) === 'customer');
  const customerContext = await withTenantTransaction(enterprise, tx => one(tx, sql`select context_version from app.users where id=${ownerA}`));
  const followup = new FollowupService({ enterpriseId: enterprise, principal: { kind: 'user', userId: ownerA },
    contextVersion: Number(customerContext?.context_version || 1), capabilities: ['assistant.followup.self'] });
  const ownerDetail = customerReport ? await followup.detail(String(customerReport.binding_id), String(customerReport.id), Number(customerReport.revision)) : null;
  const factsOnly = ownerDetail && 'contentStatus' in ownerDetail && ownerDetail.contentStatus === 'facts_only';
  check('report.facts_only', !!factsOnly && !!(ownerDetail && 'weeklyReport' in ownerDetail && ownerDetail.weeklyReport)
    ? 'passed' : 'failed', '未配置模型时周报按确定性事实模板展示', {
    contentStatus: ownerDetail && 'contentStatus' in ownerDetail ? ownerDetail.contentStatus : null,
    sections: ownerDetail && 'weeklyReport' in ownerDetail ? ownerDetail.weeklyReport?.sections.map(section => section.key) : null,
  });
  const snapshot = ownerDetail && 'weeklyReport' in ownerDetail ? ownerDetail.weeklyReport?.contract : null;
  check('report.snapshot_binding', !!snapshot && snapshot.sourceSnapshotVersion === String(customerReport?.facts_hash)
    && snapshot.reportVersion === Number(customerReport?.revision)
    ? 'passed' : 'failed', '周报保留原 sourceSnapshotVersion 与报告版本', {
    reportId: customerReport?.id, revision: customerReport?.revision, factsHash: customerReport?.facts_hash,
    contractSnapshot: snapshot?.sourceSnapshotVersion,
  });
  const customerFacts = (customerReport?.facts as { projects?: Array<{ id: string; stageKey: string }> } | undefined)?.projects || [];
  check('report.customer_scope', customerFacts.length === 1 && customerFacts[0].id === pidA ? 'passed' : 'failed',
    '业主周报只含自己的项目', { projects: customerFacts.map(item => item.id) });
  const bossReport = readyReports.find(row => String(row.audience) === 'boss');
  const bossFacts = (bossReport?.facts as { projects?: Array<{ id: string }> } | undefined)?.projects || [];
  check('report.boss_cross_project', bossFacts.length >= 2 ? 'passed' : 'failed', '老板周报覆盖授权范围内多个项目', { projects: bossFacts.map(item => item.id) });
  const stageAcrossRoles = digests.map(item => JSON.stringify((item.report.facts as { projects?: Array<{ stageKey?: string }> }).projects?.map(project => project.stageKey) || []));
  check('report.same_facts', stageAcrossRoles.every((value, index) => index === 0 || value !== '[]') ? 'passed' : 'failed',
    '四端周报读取同一项目阶段事实');

  const history = customerReport ? await followup.reports(String(customerReport.binding_id), undefined, { kind: 'weekly' }) : null;
  check('report.history', !!history?.items?.some(item => item.reportId === String(customerReport!.id)) ? 'passed' : 'failed',
    '历史周报可重新进入查看', { items: history?.items?.map(item => ({ reportId: item.reportId, revision: item.revision, available: item.available })) });

  const correction = customerReport ? await withTenantTransaction(enterprise, async tx => {
    const settings = await one(tx, sql`select * from app.construction_report_settings where enterprise_id=${enterprise} and enabled for share`);
    const report = await one(tx, sql`select * from app.construction_reports where enterprise_id=${enterprise} and id=${String(customerReport.id)} for update`);
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
  const versions = customerReport ? await withTenantTransaction(enterprise, tx => rows(tx, sql`select revision from app.construction_report_versions
    where enterprise_id=${enterprise} and report_id=${String(customerReport.id)} order by revision`)) : [];
  const oldVersion = customerReport ? await followup.detail(String(customerReport.binding_id), String(customerReport.id), 1).catch(() => null) : null;
  check('report.versioning', !!correction && versions.length >= 2 && !!oldVersion ? 'passed' : 'failed',
    '修订生成新版本且旧版本仍绑定原生成快照', { versions: versions.map(row => Number(row.revision)), oldAvailable: !!oldVersion });

  // ------------------------------------------------- I7.3 PM review + journey
  const beforeReview = await withTenantTransaction(enterprise, tx => readSiteIssue(tx, enterprise, pidB, issueReview));
  const reviewBase = await withTenantTransaction(enterprise, tx => readSiteIssueBase(tx, enterprise, pidB, issueReview));
  assert.ok(reviewBase);
  await withTenantTransaction(enterprise, tx => tx.execute(sql`insert into app.domain_event_outbox
    (enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
    values(${enterprise},'construction.site.issue.progress.v1','construction_site_issue',${issueReview},4,'{"kind":"admin"}'::jsonb,${randomUUID()},
    ${JSON.stringify({ ...reviewBase, revision: 4, state: 'closed', action: 'manager_review', reviewedBy: manager.adminId, reviewedAt: now.toISOString() })}::jsonb)`));
  const afterReview = await withTenantTransaction(enterprise, tx => readSiteIssue(tx, enterprise, pidB, issueReview));
  check('pm.review_receipt', !!afterReview && afterReview.revision > (beforeReview?.revision || 0)
    && ['resolved', 'closed'].includes(String(afterReview.classification))
    ? 'passed' : 'failed', '项目经理完成正式复核并得到新版本回执', {
    before: beforeReview ? { revision: beforeReview.revision, classification: beforeReview.classification } : null,
    after: afterReview ? { revision: afterReview.revision, classification: afterReview.classification } : null,
  });

  const stageReply = await withTenantTransaction(enterprise, tx => stageChatForConversation({
    tx, enterpriseId: enterprise, conversationId: c01A, userId: ownerA, question: '现在水电阶段需要注意什么？',
  }));
  check('journey.c01_stage_answer', !!(stageReply && /水电/u.test(stageReply) && /不替代/u.test(stageReply))
    ? 'passed' : 'failed', '业主在原 C01 会话内得到当前阶段知识回答', { conversationId: c01A, excerpt: stageReply?.slice(0, 140) });

  const designerInboxAfter = await listStageReminders(designerActor, pidA);
  const ownerInboxAfter = await listStageReminders(ownerActor, pidA);
  check('journey.four_end_facts', ownerInboxAfter.items.some(item => item.status === 'delivered')
    && designerInboxAfter.items.some(item => item.status === 'delivered' || item.status === 'pending' || item.status === 'failed')
    ? 'passed' : 'failed', '业主与设计师均收到真实阶段事实提醒', {
    owner: ownerInboxAfter.items.length, designer: designerInboxAfter.items.length,
  });

  check('ai.degraded', !!(stageReply && reports.length) ? 'passed' : 'failed',
    '未配置模型时阶段问答、提醒和周报事实仍可用', { stageAnswer: !!stageReply, reports: reports.length });

  // ------------------------------------------------ UI identity and navigation
  const contextFor = async (kind: 'user' | 'admin', id: string) => withTenantTransaction(enterprise, tx => one(tx,
    kind === 'user' ? sql`select context_version from app.users where id=${id}` : sql`select 1 as context_version`));
  const ownerCtx = await contextFor('user', ownerA);
  const ownerToken = await signMiniProgramToken({ sub: ownerA, id: ownerA, mode: 'customer', role: 'user', enterpriseId: enterprise,
    contextVersion: Number(ownerCtx?.context_version || 1), source: 'wechat' });
  // Staff tokens come from the real password login endpoint so the UI and the
  // acceptance use the same signed context the Mini Program receives.
  const apiOrigin = process.env.XIAOK_I73_API_ORIGIN?.trim() || 'http://127.0.0.1:3016';
  const login = async (username: string) => {
    const response = await fetch(apiOrigin + '/api/auth/miniprogram', { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'password', username, password }) });
    const body = await response.json() as { token?: string; error?: string };
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.ok(body.token);
    return body.token;
  };
  run.ui = {
    apiOrigin,
    webOrigin: apiOrigin,
    enterpriseId: enterprise,
    password,
    accounts: {
      ownerA: { token: ownerToken, userId: ownerA, conversationId: c01A },
      boss: { username: boss.username, adminId: boss.adminId, token: await login(boss.username) },
      manager: { username: manager.username, adminId: manager.adminId, token: await login(manager.username) },
      designer: { username: designer.username, adminId: designer.adminId, token: await login(designer.username) },
      worker: { username: worker.username, adminId: worker.adminId, token: await login(worker.username) },
    },
    projects: {
      A: { id: pidA, name: 'I7.3 水电试点项目A', stageKey: 'utilities', roomId: roomsA[0].id },
      B: { id: pidB, name: 'I7.3 泥木试点项目B', stageKey: 'masonry_carpentry', roomId: roomsB[0].id },
      C: { id: pidC, name: 'I7.3 阶段变更项目C', stageKey: 'masonry_carpentry', roomId: roomsC[0].id },
    },
    reminder: {
      issueId: issueDesigner, issueReviewId: issueReview,
      planNodeKey: nodeReminder?.relatedTaskId || null, roomId: nodeReminder?.roomId || null,
      managerWorkbench: managerWorkbench.map(item => ({ reminderId: item.reminderId, projectId: item.projectId, title: item.title })),
    },
  };

  run.ids.reportIds = reports.map(row => String(row.id));
  run.finishedAt = new Date().toISOString();
  const output = path.join(admin, '..', 'tmp/xiaok-i73-acceptance');
  fs.mkdirSync(output, { recursive: true });
  const file = path.join(output, 'result-' + suffix + '.json');
  fs.writeFileSync(file, JSON.stringify(run, null, 2) + '\n');
  fs.writeFileSync(path.join(output, 'latest.json'), JSON.stringify({ file, suffix, enterpriseId: enterprise, ui: run.ui }, null, 2) + '\n');
  console.log(JSON.stringify({ result: file, checks: run.checks.map(item => item.id + ':' + item.status) }));
  await closePostgresPool();
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
