/** I7.4.5-F2 real PostgreSQL 17 acceptance for pilot-scoped stage reminders.
 * Reuses the F1 isolated database; never sends a real notification. */
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
  || '../tmp/xiaok-i745-f2/acceptance-' + Date.now());
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
  const { currentRecord, openRecordIssue, readSiteIssueBase } = await import('@/lib/construction/site-issues');
  const { fingerprint } = await import('@/lib/assistant/contracts');
  const { appendMessage } = await import('@/lib/assistant/core/conversation');
  const { advanceConfiguredStageReminders, deliverConfiguredStageReminders } = await import('@/lib/xiaok-v1/stage-reminder-worker');
  const bcrypt = (await import('bcryptjs')).default;
  const pg = (await import('pg')).default;

  const identity = (await withPlatformTransaction(tx => one(tx, sql`select current_user usr,current_database() db,
    version() ver,(select rolsuper from pg_roles where rolname=current_user) super`)))!;
  assert.equal(identity.usr, 'sfp_app'); assert.equal(identity.db, 'i745_f1_accept'); assert.equal(identity.super, false);
  result.ids.environment = identity;
  const rls = await withPlatformTransaction(tx => rows(tx, sql`select c.relname,c.relrowsecurity rls,c.relforcerowsecurity forced
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='app'
    and c.relname in ('xiaok_pilot_project_scopes','construction_stage_reminders','construction_stage_reminder_pauses',
      'construction_followup_bindings','assistant_conversations','assistant_messages') order by 1`));
  check('env.pg17_rls', rls.every(row => row.rls === true && row.forced === true) ? 'passed' : 'failed',
    '复用 F1 PG17.10 数据库，sfp_app 非超级用户且强制 RLS', { identity, rls });

  const now = new Date('2026-11-15T10:00:00+08:00');
  const suffix = String(Date.now());
  const passwordHash = await bcrypt.hash('I745F2-Pass-' + suffix, 10);
  let phoneSeq = 0;
  const nextPhone = () => '19975' + String(++phoneSeq).padStart(6, '0');
  const createEnterprise = () => withPlatformTransaction(async tx => {
    const row = await one(tx, sql`insert into app.enterprises(name,code,status,registration_mode)
      values(${'I7.4.5-F2 提醒合成企业-' + suffix},${'i745-f2-' + suffix},'active','manual') returning id::text`);
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
      values(${eid},${String(linked!.id)},${'i745f2_' + suffix + '_' + index},${passwordHash},${name},${role},'active',false,
      ARRAY(select jsonb_array_elements_text(${JSON.stringify(getDefaultMenuKeys(role))}::jsonb)),ARRAY[]::text[]) returning id::text`);
    return String(row!.id);
  });
  const createProject = async (eid: string, bossId: string, managerId: string, ownerId: string, name: string, rooms: string[]) => {
    const leadId = await withTenantTransaction(eid, async tx => String((await one(tx, sql`insert into app.leads
      (enterprise_id,customer_user_id,name,phone,source) values(${eid},${ownerId},${name},${nextPhone()},'natural') returning id::text`))!.id));
    const service = new ConstructionService({ enterpriseId: eid, adminId: bossId });
    return String((await service.execute('create', { leadId, name, managerId, rooms }, randomUUID())).id);
  };

  const enterprise = await createEnterprise();
  const ownerA = await createUser(enterprise, 'F2 试点内业主');
  const ownerB = await createUser(enterprise, 'F2 范围外业主');
  const boss = await createAdmin(enterprise, 'enterprise_admin', 'F2 老板', 1);
  const manager = await createAdmin(enterprise, 'construction_staff', 'F2 项目经理', 2);
  const worker = await createAdmin(enterprise, 'construction_staff', 'F2 施工人员', 3);
  const pidA = await createProject(enterprise, boss, manager, ownerA, 'F2 试点内项目 101', ['卫生间', '客厅']);
  const pidB = await createProject(enterprise, boss, manager, ownerB, 'F2 范围外项目 205', ['厨房']);
  result.ids = { ...result.ids, enterprise, ownerA, ownerB, boss, manager, worker, pidA, pidB };

  const ownerService = new ConstructionService({ enterpriseId: enterprise, adminId: boss });
  const progress = async (pid: string, stageKey: string, note: string) => {
    const detail = (await ownerService.execute('detail', { projectId: pid })).project as Record<string, unknown>;
    await ownerService.execute('progress', { projectId: pid, expectedVersion: Number(detail.version), stageKey, note, sendReminder: false }, randomUUID());
  };
  const addWorker = async (pid: string) => {
    const detail = (await ownerService.execute('detail', { projectId: pid })).project as Record<string, unknown>;
    await ownerService.execute('member', { projectId: pid, expectedVersion: Number(detail.version), adminId: worker,
      role: 'worker', active: true, workLabel: '现场施工' }, randomUUID());
  };
  for (const pid of [pidA, pidB]) {
    await withTenantTransaction(enterprise, tx => tx.execute(sql`update app.construction_projects set customer_access=true
      where enterprise_id=${enterprise} and id=${pid}`));
    await addWorker(pid);
  }
  await progress(pidA, 'utilities', 'F2 试点内项目进入水电');
  await progress(pidB, 'masonry_carpentry', 'F2 范围外项目进入泥木');

  const workerChat = new SiteChatService({ enterpriseId: enterprise, adminId: worker });
  const publishRecord = async (pid: string, roomName: string, completed: string) => {
    const clientMessageId = randomUUID();
    const draft = await workerChat.withWriteScope(pid, async (tx, conversation) => {
      const room = await one(tx, sql`select id::text,name from app.construction_rooms where enterprise_id=${enterprise}
        and project_id=${pid} and name=${roomName}`);
      assert.ok(room?.id);
      const message = await appendMessage(tx, workerChat.actor, String(conversation.id), { author: 'admin', clientMessageId,
        purpose: 'site.source', content: { version: 1, blocks: [{ type: 'text', text: completed }] } });
      const data = { title: 'F2 合成现场记录', completed, pending: '', coordination: '', roomId: room.id, note: completed };
      const row = (await one(tx, sql`insert into app.construction_site_records(enterprise_id,project_id,conversation_id,source_message_id,
        author_id,status,data,room_id,room_name_snapshot) values(${enterprise},${pid},${String(conversation.id)},${String(message.id)},${worker},
        'draft',${JSON.stringify(data)}::jsonb,${String(room.id)},${roomName}) returning *`))!;
      await recordVersion(tx, enterprise, row, worker, 'organized');
      return { row, messageId: String(message.id) };
    });
    if (draft.row.status === 'draft') await new SiteChatService({ enterpriseId: enterprise, adminId: manager })
      .mutate(pid, String(draft.row.id), 'publish', { expectedVersion: Number(draft.row.version), audience: 'customer' }, randomUUID());
    return { recordId: String(draft.row.id), messageId: draft.messageId };
  };
  const recordA = await publishRecord(pidA, '卫生间', 'F2 试点内项目完成水电布管。');
  const recordA2 = await publishRecord(pidA, '客厅', 'F2 试点内项目完成客厅记录。');
  const recordB = await publishRecord(pidB, '厨房', 'F2 范围外项目完成墙砖铺贴。');

  const createIssue = async (pid: string, record: { recordId: string; messageId: string }, state: string, options: {
    ownerId?: string; title: string; revision: number;
  }) => withTenantTransaction(enterprise, async tx => {
    const source = await currentRecord(tx, enterprise, pid, record.recordId);
    assert.ok(source);
    const request = await one(tx, sql`select content from app.assistant_messages where enterprise_id=${enterprise} and id=${record.messageId}`);
    assert.ok(request);
    const opened = await openRecordIssue(tx, enterprise, pid, record.recordId, source, {
      openedBy: worker, requestMessageId: record.messageId, requestHash: fingerprint(request.content),
      requestText: options.title, projectReview: false,
    }, { kind: 'admin', adminId: manager }, randomUUID());
    const base = await readSiteIssueBase(tx, enterprise, pid, opened!.issueId);
    assert.ok(base);
    const payload = { ...base, revision: options.revision, state, action: 'i745-f2',
      ...(options.ownerId ? { ownerId: options.ownerId } : {}), confirmed: true, confirmedAt: now.toISOString(), confirmedBy: manager };
    await tx.execute(sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
      values(${enterprise},'construction.site.issue.progress.v1','construction_site_issue',${String(opened!.issueId)},${options.revision},
      '{"kind":"admin"}'::jsonb,${randomUUID()},${JSON.stringify(payload)}::jsonb)`);
    return String(opened!.issueId);
  });
  const issueManager = await createIssue(pidA, recordA, 'awaiting_rectification',
    { ownerId: manager, title: 'F2 项目经理待安排验收', revision: 2 });
  const issueWorker = await createIssue(pidA, recordA2, 'awaiting_owner',
    { ownerId: worker, title: 'F2 卫生间照片待补', revision: 3 });
  const issueOutside = await createIssue(pidB, recordB, 'awaiting_rectification',
    { ownerId: manager, title: 'F2 范围外项目经理待办', revision: 2 });
  result.ids.records = { recordA, recordA2, recordB };
  result.ids.issues = { issueManager, issueWorker, issueOutside };

  const createInbox = async (options: { ownerId?: string; adminId?: string; audience: 'customer' | 'worker'; projectId?: string }) =>
    withTenantTransaction(enterprise, async tx => {
      const conversation = (await one(tx, sql`insert into app.assistant_conversations(enterprise_id,purpose,entry_snapshot,policy_version)
        values(${enterprise},'construction_followup',${JSON.stringify({ kind: 'construction_followup', audience: options.audience })}::jsonb,1) returning *`))!;
      const conversationId = String(conversation.id);
      const principal = options.ownerId ? 'user:' + options.ownerId : 'admin:' + options.adminId;
      const scope = options.audience === 'customer' ? 'project:' + options.projectId : 'enterprise';
      const binding = (await one(tx, sql`insert into app.construction_followup_bindings
        (enterprise_id,principal_key,audience,user_id,admin_id,project_id,scope_key,conversation_id,status)
        values(${enterprise},${principal},${options.audience},${options.ownerId || null},${options.adminId || null},
          ${options.projectId || null},${scope},${conversationId},'enabled') returning *`))!;
      return { bindingId: String(binding.id), conversationId };
    });
  const ownerAInbox = await createInbox({ ownerId: ownerA, audience: 'customer', projectId: pidA });
  const ownerBInbox = await createInbox({ ownerId: ownerB, audience: 'customer', projectId: pidB });
  const workerInbox = await createInbox({ adminId: worker, audience: 'worker' });
  result.ids.inboxes = { ownerAInbox, ownerBInbox, workerInbox };

  let scopeVersion = 0;
  const saveScope = async (projectIds: string[], status: 'active' | 'inactive' = 'active') => {
    const version = ++scopeVersion;
    await withTenantTransaction(enterprise, tx => tx.execute(sql`insert into app.xiaok_pilot_project_scopes
      (enterprise_id,pilot_id,project_ids,created_by,scope_version,status)
      values(${enterprise},'f2-pilot',array[${sql.join(projectIds.map(pid => sql`${pid}::bigint`), sql`, `)}],
        ${boss},${version},${status})`));
    return version;
  };
  await saveScope([pidA]);
  const pilotEnv = { XIAOK_STAGE_REMINDER_MODE: 'pilot', XIAOK_STAGE_REMINDER_ENTERPRISE_ID: enterprise,
    XIAOK_STAGE_REMINDER_PILOT_ID: 'f2-pilot' };
  const reminderRows = (pid?: string) => withTenantTransaction(enterprise, tx => rows(tx, sql`select reminder_id,project_id,stage_id,
    trigger_type,target_role,target_principal_kind,target_principal_id,status,conversation_id,message_id,scheduled_at,last_error
    from app.construction_stage_reminders where enterprise_id=${enterprise} ${pid ? sql`and project_id=${pid}` : sql``}
    order by reminder_id`));
  const messageCount = () => withTenantTransaction(enterprise, tx => one(tx, sql`select count(*)::int n
    from app.assistant_messages where enterprise_id=${enterprise} and purpose='construction.stage_reminder'`));
  const outboxCount = () => withTenantTransaction(enterprise, tx => one(tx, sql`select count(*)::int n
    from app.domain_event_outbox where enterprise_id=${enterprise} and type='construction.stage_reminder.delivered.v1'`));
  const f1Before = await withPlatformTransaction(tx => one(tx, sql`select
    (select count(*)::int from app.construction_projects where enterprise_id=1) projects,
    (select count(*)::int from app.construction_site_records where enterprise_id=1) records,
    (select count(*)::int from app.construction_stage_reminders where enterprise_id=1) reminders`));

  const phase1Generate = await advanceConfiguredStageReminders({ now, env: pilotEnv });
  const phase1Reminders = await reminderRows();
  const phase1A = phase1Reminders.filter(row => String(row.project_id) === pidA);
  const phase1B = phase1Reminders.filter(row => String(row.project_id) === pidB);
  check('generate.phase1_101', phase1Generate.mode === 'pilot' && phase1Generate.scopeStatus === 'active'
    && phase1Generate.created > 0 && phase1A.length > 0 && phase1B.length === 0 ? 'passed' : 'failed',
    '试点范围仅 101 时只为项目 101 生成提醒', { phase1Generate, remindersA: phase1A.length, remindersB: phase1B.length,
      reminderIds: phase1A.map(row => row.reminder_id) });

  const phase1Deliver = await deliverConfiguredStageReminders({ now, env: pilotEnv });
  const phase1AfterDeliver = await reminderRows();
  const deliveredA = phase1AfterDeliver.filter(row => String(row.project_id) === pidA && String(row.status) === 'delivered');
  const deliveredB = phase1AfterDeliver.filter(row => String(row.project_id) === pidB && String(row.status) === 'delivered');
  const messages1 = await messageCount();
  check('deliver.phase1_101', phase1Deliver.mode === 'pilot' && phase1Deliver.delivered > 0
    && deliveredA.length > 0 && deliveredA.every(row => row.message_id && row.conversation_id) && deliveredB.length === 0
    ? 'passed' : 'failed', '项目 101 提醒写入真实站内会话，项目 205 无提醒与投递',
    { phase1Deliver, deliveredA: deliveredA.map(row => ({ reminderId: row.reminder_id, messageId: row.message_id,
      conversationId: row.conversation_id, role: row.target_role })), deliveredB: deliveredB.length, messages: messages1?.n });

  const repeatGenerate = await advanceConfiguredStageReminders({ now, env: pilotEnv });
  const repeatDeliver = await deliverConfiguredStageReminders({ now, env: pilotEnv });
  const messages2 = await messageCount();
  const remindersAfterRepeat = await reminderRows();
  const reminderIdsBeforeRepeat = new Set(phase1AfterDeliver.map(row => String(row.reminder_id)));
  const repeatAddedRows = remindersAfterRepeat.filter(row => !reminderIdsBeforeRepeat.has(String(row.reminder_id)));
  check('repeat.idempotent', repeatAddedRows.length === 0 && repeatDeliver.delivered === 0
    && Number(messages2?.n) === Number(messages1?.n) && remindersAfterRepeat.length === phase1AfterDeliver.length
    ? 'passed' : 'failed', '重复 Worker tick 不重复创建提醒行、不重复发送',
    { repeatGenerateDrafts: repeatGenerate.created, repeatDeliver, newReminderRows: repeatAddedRows.length,
      messagesBefore: messages1?.n, messagesAfter: messages2?.n, reminders: remindersAfterRepeat.length });

  // Phase 2: scope expands to both projects, then shrinks before delivery.
  await saveScope([pidA, pidB]);
  await progress(pidA, 'installation', 'F2 试点内项目进入安装');
  await progress(pidB, 'painting', 'F2 范围外项目进入油漆');
  const phase2Generate = await advanceConfiguredStageReminders({ now, env: pilotEnv });
  const phase2Reminders = await reminderRows();
  const pendingA = phase2Reminders.filter(row => String(row.project_id) === pidA && ['pending', 'failed'].includes(String(row.status)));
  const pendingB = phase2Reminders.filter(row => String(row.project_id) === pidB && ['pending', 'failed'].includes(String(row.status)));
  const deliveredBeforeShrink = phase2Reminders.filter(row => String(row.status) === 'delivered');
  const messagesBeforeShrink = await messageCount();
  await saveScope([pidA]);
  const shrinkDeliver = await deliverConfiguredStageReminders({ now, env: pilotEnv });
  const afterShrink = await reminderRows();
  const deliveredAfterShrink = afterShrink.filter(row => String(row.status) === 'delivered');
  const pendingBAfterShrink = afterShrink.filter(row => String(row.project_id) === pidB && ['pending', 'failed'].includes(String(row.status)));
  const messagesAfterShrink = await messageCount();
  check('scope.expand_then_shrink', phase2Generate.created > 0 && pendingA.length > 0 && pendingB.length > 0
    && shrinkDeliver.delivered > 0 && pendingBAfterShrink.length === pendingB.length
    && deliveredAfterShrink.length > deliveredBeforeShrink.length
    && Number(messagesAfterShrink?.n) > Number(messagesBeforeShrink?.n) ? 'passed' : 'failed',
    '范围先扩至 101+205 生成，再收缩为仅 101 投递；205 pending 不投递且不删除',
    { phase2Generate, pendingA: pendingA.length, pendingB: pendingB.length, shrinkDeliver,
      deliveredBefore: deliveredBeforeShrink.length, deliveredAfter: deliveredAfterShrink.length,
      pendingBAfter: pendingBAfterShrink.length, messagesBefore: messagesBeforeShrink?.n, messagesAfter: messagesAfterShrink?.n,
      scopeVersion: scopeVersion });

  // Faults: missing / inactive / resolver unavailable.
  const missingPilotEnv = { ...pilotEnv, XIAOK_STAGE_REMINDER_PILOT_ID: 'missing-f2' };
  const missingGenerate = await advanceConfiguredStageReminders({ now, env: missingPilotEnv });
  const missingDeliver = await deliverConfiguredStageReminders({ now, env: missingPilotEnv });
  check('fault.pilot_not_found', missingGenerate.created === 0 && missingDeliver.delivered === 0
    && missingGenerate.scopeStatus === 'not_found' && missingDeliver.scopeStatus === 'not_found' ? 'passed' : 'failed',
    'Pilot 不存在时零生成零投递', { missingGenerate, missingDeliver });

  await saveScope([pidA], 'inactive');
  const inactiveGenerate = await advanceConfiguredStageReminders({ now, env: pilotEnv });
  const inactiveDeliver = await deliverConfiguredStageReminders({ now, env: pilotEnv });
  check('fault.pilot_inactive', inactiveGenerate.created === 0 && inactiveDeliver.delivered === 0
    && inactiveGenerate.scopeStatus === 'inactive' && inactiveDeliver.scopeStatus === 'inactive' ? 'passed' : 'failed',
    'Pilot inactive 时零生成零投递', { inactiveGenerate, inactiveDeliver });
  await saveScope([pidA]);

  const ownerClient = new pg.Client({ connectionString: connections.MIGRATION_URL });
  await ownerClient.connect();
  let resolverGenerate: { created: number; scopeStatus?: string | null } = { created: -1 };
  let resolverDeliver: { delivered: number; scopeStatus?: string | null } = { delivered: -1 };
  try {
    await ownerClient.query('revoke select on app.xiaok_pilot_project_scopes from sfp_app');
    resolverGenerate = await advanceConfiguredStageReminders({ now, env: pilotEnv });
    resolverDeliver = await deliverConfiguredStageReminders({ now, env: pilotEnv });
  } finally {
    await ownerClient.query('grant select,insert on app.xiaok_pilot_project_scopes to sfp_app');
    await ownerClient.end();
  }
  check('fault.resolver_unavailable', resolverGenerate.created === 0 && resolverGenerate.scopeStatus === 'unavailable'
    && resolverDeliver.delivered === 0 && resolverDeliver.scopeStatus === 'unavailable' ? 'passed' : 'failed',
    'Resolver 不可用时生成与投递均 fail closed', { resolverGenerate, resolverDeliver });

  // Empty scope cannot be persisted by the schema (cardinality>0), so it is
  // covered by the existing unit tests and reported as limited here.
  check('fault.empty_scope', 'limited',
    '数据库 CHECK(cardinality(project_ids)>0) 拒绝空 active 范围；空范围零生成/零投递由 reminder-service 定向测试覆盖');

  // Permission revoked: a new pending owner reminder is cancelled at delivery.
  await progress(pidA, 'painting', 'F2 权限撤销前进入油漆');
  const permissionGenerate = await advanceConfiguredStageReminders({ now, env: pilotEnv });
  const permissionPending = (await reminderRows(pidA)).filter(row => String(row.status) === 'pending'
    && String(row.target_role) === 'owner');
  await withTenantTransaction(enterprise, tx => tx.execute(sql`update app.construction_projects set customer_access=false
    where enterprise_id=${enterprise} and id=${pidA}`));
  const messagesBeforePermission = await withTenantTransaction(enterprise, tx => one(tx, sql`select count(*)::int n
    from app.assistant_messages where enterprise_id=${enterprise} and conversation_id=${String(ownerAInbox.conversationId)}`));
  const permissionDeliver = await deliverConfiguredStageReminders({ now, env: pilotEnv });
  const permissionAfter = await reminderRows(pidA);
  const cancelled = permissionAfter.filter(row => String(row.status) === 'cancelled' && String(row.last_error) === 'permission_revoked');
  const cancelledIds = new Set(cancelled.map(row => String(row.reminder_id)));
  const cancelledPending = permissionPending.filter(row => cancelledIds.has(String(row.reminder_id)));
  const messagesAfterPermission = await withTenantTransaction(enterprise, tx => one(tx, sql`select count(*)::int n
    from app.assistant_messages where enterprise_id=${enterprise} and conversation_id=${String(ownerAInbox.conversationId)}`));
  await withTenantTransaction(enterprise, tx => tx.execute(sql`update app.construction_projects set customer_access=true
    where enterprise_id=${enterprise} and id=${pidA}`));
  check('fault.permission_revoked', permissionGenerate.created > 0 && permissionPending.length > 0
    && cancelledPending.length > 0
    && Number(messagesAfterPermission?.n) === Number(messagesBeforePermission?.n) ? 'passed' : 'failed',
    '收件人权限撤销后对应提醒被取消且业主会话不新增消息', { permissionGenerate, pending: permissionPending.length,
      permissionDeliver, cancelled: cancelledPending.length, messagesBefore: messagesBeforePermission?.n,
      messagesAfter: messagesAfterPermission?.n });

  // Missing inbox: remove the owner binding so there is no target conversation.
  await progress(pidA, 'installation', 'F2 无会话前回到安装');
  const noInboxGenerate = await advanceConfiguredStageReminders({ now, env: pilotEnv });
  const noInboxPending = (await reminderRows(pidA)).filter(row => String(row.status) === 'pending'
    && String(row.target_role) === 'owner');
  await withTenantTransaction(enterprise, tx => tx.execute(sql`delete from app.construction_followup_bindings
    where enterprise_id=${enterprise} and id=${String(ownerAInbox.bindingId)}`));
  const noInboxDeliver = await deliverConfiguredStageReminders({ now, env: pilotEnv });
  const noInboxRows = (await reminderRows(pidA)).filter(row => String(row.status) === 'failed'
    && String(row.last_error) === 'no_inbox' && String(row.target_role) === 'owner');
  const noInboxIds = new Set(noInboxRows.map(row => String(row.reminder_id)));
  await withTenantTransaction(enterprise, tx => tx.execute(sql`insert into app.construction_followup_bindings
    (enterprise_id,principal_key,audience,user_id,admin_id,project_id,scope_key,conversation_id,status)
    values(${enterprise},${'user:' + ownerA},'customer',${ownerA},null,${pidA},${'project:' + pidA},
      ${String(ownerAInbox.conversationId)},'enabled')`));
  const retryDeliver = await deliverConfiguredStageReminders({ now, env: pilotEnv });
  const retried = (await reminderRows(pidA)).filter(row => noInboxIds.has(String(row.reminder_id))
    && String(row.status) === 'delivered' && String(row.message_id));
  check('fault.no_inbox_retry', noInboxGenerate.created > 0 && noInboxPending.length > 0
    && noInboxDeliver.failed > 0 && noInboxRows.length > 0 && retryDeliver.delivered > 0
    && retried.length === noInboxRows.length
    ? 'passed' : 'failed', '目标会话缺失保持 failed/no_inbox，恢复绑定后可重试投递',
    { noInboxGenerate, noInboxDeliver, noInboxRows: noInboxRows.length, retryDeliver, retried: retried.length });

  // Enterprise mode delivers the remaining 205 pending reminder.
  const scopeBeforeEnterprise = await withTenantTransaction(enterprise, tx => one(tx, sql`select max(scope_version)::int version,
    (select status from app.xiaok_pilot_project_scopes where enterprise_id=${enterprise} order by scope_version desc limit 1) status
    from app.xiaok_pilot_project_scopes where enterprise_id=${enterprise}`));
  const enterpriseEnv = { XIAOK_STAGE_REMINDER_MODE: 'enterprise', XIAOK_STAGE_REMINDER_ENTERPRISE_ID: enterprise };
  const enterpriseDeliver = await deliverConfiguredStageReminders({ now, env: enterpriseEnv });
  const enterpriseB = (await reminderRows(pidB)).filter(row => String(row.status) === 'delivered');
  check('mode.enterprise', enterpriseDeliver.mode === 'enterprise' && enterpriseDeliver.delivered > 0
    && enterpriseB.length > 0 ? 'passed' : 'failed',
    'enterprise 模式不受 pilot 范围限制，可投递项目 205 的剩余提醒',
    { enterpriseDeliver, deliveredB: enterpriseB.map(row => ({ reminderId: row.reminder_id, role: row.target_role,
      messageId: row.message_id, conversationId: row.conversation_id })), scopeBeforeEnterprise });

  const finalReminders = await reminderRows();
  const finalMessages = await messageCount();
  const finalOutbox = await outboxCount();
  const deliveredWithReceipt = finalReminders.filter(row => String(row.status) === 'delivered');
  const f1After = await withPlatformTransaction(tx => one(tx, sql`select
    (select count(*)::int from app.construction_projects where enterprise_id=1) projects,
    (select count(*)::int from app.construction_site_records where enterprise_id=1) records,
    (select count(*)::int from app.construction_stage_reminders where enterprise_id=1) reminders`));
  check('final.receipts_and_isolation', deliveredWithReceipt.every(row => row.message_id && row.conversation_id)
    && JSON.stringify(f1Before) === JSON.stringify(f1After) ? 'passed' : 'failed',
    '所有 delivered 提醒都有真实 messageId/conversationId；F1 企业原始项目/记录/提醒不变',
    { deliveredWithReceipt: deliveredWithReceipt.length, finalMessages: finalMessages?.n, finalOutbox: finalOutbox?.n,
      f1Before, f1After });

  result.ids.final = { reminders: finalReminders.length, delivered: deliveredWithReceipt.length,
    messages: finalMessages?.n, deliveredOutbox: finalOutbox?.n,
    scope: scopeBeforeEnterprise, f1Before, f1After };
  await closePostgresPool();
}

main().catch(error => {
  result.error = (error as Error).stack || String(error);
  check('run.completed', 'failed', '验收脚本执行失败', { error: (error as Error).message });
}).finally(() => {
  result.finishedAt = new Date().toISOString();
  save();
  console.log(JSON.stringify({ output, passed: result.checks.filter(item => item.status === 'passed').length,
    failed: result.checks.filter(item => item.status === 'failed').length,
    limited: result.checks.filter(item => item.status === 'limited').length }));
});
