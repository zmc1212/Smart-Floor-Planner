import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { sql } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import pg from 'pg';
import { GET as constructionGet } from '@/app/api/miniprogram/construction/[[...path]]/route';
import { GET as remindersGet, POST as remindersPost } from '@/app/api/miniprogram/xiaok/reminders/route';
import { POST as stageAnswerPost } from '@/app/api/miniprogram/xiaok/stage-answer/route';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { getDefaultMenuKeys } from '@/lib/admin-user-roles';
import { fingerprint, type ActorContext, type TextModelGateway } from '@/lib/assistant/contracts';
import { appendMessage, ConversationService } from '@/lib/assistant/core/conversation';
import { processAnswer } from '@/lib/assistant/infrastructure/answer-worker';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { ensureFollowupBinding } from '@/lib/construction/report-store';
import { ConstructionService } from '@/lib/construction/service';
import { recordVersion, SiteChatService } from '@/lib/construction/site-chat';
import { currentRecord, executeSiteIssue, openRecordIssue } from '@/lib/construction/site-issues';
import { signMiniProgramToken } from '@/lib/miniprogram-jwt';
import { closePostgresPool } from '@/lib/postgresql';
import { isStageChatQuestion } from '@/lib/xiaok-v1/stage-chat-service';
import { classifyStageIntent } from '@/lib/xiaok-v1/stage-router';
import { advanceConfiguredStageReminders, deliverConfiguredStageReminders } from '@/lib/xiaok-v1/stage-reminder-worker';
import { stageDefinitions, type StageId } from '@/lib/xiaok-v1/stages';

const target = new URL(process.env.XIAOK_I7519_DATABASE_URL ?? 'http://missing');
const database = target.pathname.slice(1), out = process.env.XIAOK_I7519_OUTPUT ?? '';
const expectedLedger = process.env.XIAOK_I7519_LEDGER_SHA256 ?? '';
assert.ok(target.protocol === 'postgresql:' && target.hostname === '127.0.0.1' && /^xiaok_i7519_[a-z0-9]+$/u.test(database)
  && Number(target.port) >= 49152 && target.username === 'sfp_app' && target.password && !target.search && !target.hash,
  'Use a fresh loopback-only I7.5.19 PG17 database');
assert.ok(isAbsolute(out) && /^[a-f0-9]{64}$/u.test(expectedLedger), 'Provide a new absolute output path and the I7.5.18 ledger digest');
writeFileSync(out, '', { flag: 'wx' });
process.env.DATABASE_URL = target.href;
const run = { database, port: Number(target.port), expectedLedger, tick: '', before: '', after: '', networkAttempts: 0,
  checks: [] as Array<{ id: string; status: 'passed' | 'failed'; evidence: unknown }> };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const textBlock = (text: string) => ({ version: 1 as const, blocks: [{ type: 'text' as const, text }] });
const refused = (code: string) => (error: unknown) => (error as { code?: string })?.code === code;

function sourceBinding() {
  const files = execFileSync('git', ['ls-files', '-c', '-o', '--exclude-standard', '-z', '--', 'src', 'drizzle',
    'scripts/xiaok-i7519-business-defect-acceptance.ts', 'package.json', 'package-lock.json', 'tsconfig.json'])
    .toString().split('\0').filter(Boolean).sort();
  const digest = createHash('sha256');
  for (const file of files) digest.update(file).update('\0').update(readFileSync(file)).update('\0');
  return digest.update(JSON.stringify([database, target.port, expectedLedger, run.tick])).digest('hex');
}

async function check<T>(id: string, fn: () => Promise<T>) {
  try {
    const evidence = await fn();
    run.checks.push({ id, status: 'passed', evidence });
    console.log('PASS', id);
    return evidence;
  } catch (error) {
    run.checks.push({ id, status: 'failed', evidence: error instanceof Error ? error.stack : String(error) });
    console.error('FAIL', id);
    throw error;
  }
}

const tableState = () => withPlatformTransaction(tx => one(tx, sql`select
  (select count(*)::int from app.enterprises) as tenants,
  (select count(*)::int from app.enterprises where id=1454) as real_tenant,
  (select count(*)::int from app.assistant_jobs where status in ('queued','running')) as active,
  (select count(*)::int from app.assistant_platform_knowledge_library) as mappings`));

async function exercise(tick: Date) {
  const tenant = (label: string) => withPlatformTransaction(async tx => {
    const eid = String((await one(tx, sql`insert into app.enterprises(name,code,status,registration_mode)
      values(${'I7519 合成企业 ' + label},${'i7519-' + label},'active','manual') returning id::text`))!.id);
    assert.notEqual(eid, '1454');
    await tx.execute(sql`insert into app.assistant_enterprise_settings
      (enterprise_id,enabled,retention_days,daily_requests,daily_tokens,daily_cost_micros)
      values(${eid},true,365,1000,10000000,1000000000)`);
    return eid;
  });
  let staffPhone = 519000;
  const staff = (eid: string, role: string, label: string) => withPlatformTransaction(async tx => {
    const userId = String((await one(tx, sql`insert into app.users(enterprise_id,nickname,role,context_version,phone)
      values(${eid},${label},'user',1,${'19978' + ++staffPhone}) returning id::text`))!.id);
    const adminId = String((await one(tx, sql`insert into app.admin_users
      (enterprise_id,user_id,username,password_hash,display_name,role,status,must_change_password,menu_permissions)
      values(${eid},${userId},${label},'fixture-no-password-login',${label},${role},'active',false,
        ARRAY(select jsonb_array_elements_text(${JSON.stringify(getDefaultMenuKeys(role))}::jsonb))) returning id::text`))!.id);
    const token = await signMiniProgramToken({ sub: userId, id: userId, mode: 'staff', role: 'staff',
      enterpriseId: eid, staffId: adminId, staffRole: role, contextVersion: 1, source: 'password' });
    return { adminId, token };
  });
  const eid = await tenant('a'), other = await tenant('b');
  await withPlatformTransaction(tx => tx.execute(sql`insert into app.system_roles(role_key,label,menu_keys,description)
    values('designer','设计师',ARRAY['construction-projects'],'I7519 synthetic'),
      ('construction_staff','施工人员',ARRAY['construction-projects'],'I7519 synthetic') on conflict(role_key) do nothing`));
  const [boss, manager, designer, worker, peer, outsider] = await Promise.all([
    staff(eid, 'enterprise_admin', 'i7519_boss'), staff(eid, 'construction_staff', 'i7519_manager'),
    staff(eid, 'designer', 'i7519_designer'), staff(eid, 'construction_staff', 'i7519_worker'),
    staff(eid, 'construction_staff', 'i7519_peer'), staff(other, 'enterprise_admin', 'i7519_outsider'),
  ]);
  const construction = new ConstructionService({ enterpriseId: eid, adminId: boss.adminId });
  const foreign = new ConstructionService({ enterpriseId: other, adminId: outsider.adminId });
  const managerActor: ActorContext = { enterpriseId: eid, principal: { kind: 'admin', adminId: manager.adminId },
    contextVersion: 1, capabilities: [] };
  let phone = 519000;
  async function project(service: ConstructionService, stage: string, label: string, leadManager: string) {
    const tenantId = service.actor.enterpriseId, name = 'I7519 合成工地 ' + label;
    const { uid, leadId } = await withPlatformTransaction(async tx => {
      const uid = String((await one(tx, sql`insert into app.users(enterprise_id,nickname,context_version)
        values(${tenantId},${name},1) returning id::text`))!.id);
      const leadId = String((await one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source)
        values(${tenantId},${uid},${name},${'19977' + ++phone},'natural') returning id::text`))!.id);
      return { uid, leadId };
    });
    const created = await service.execute('create', { leadId, name, managerId: leadManager, rooms: ['卫生间'] }, randomUUID());
    const projectId = String(created.id);
    const updated = await service.execute('update', { projectId, expectedVersion: Number(created.version),
      name, status: 'active', customerAccess: true }, randomUUID());
    await service.execute('progress', { projectId, expectedVersion: Number(updated.version), stageKey: stage,
      note: 'I7519 合成阶段事实', sendReminder: false }, randomUUID());
    const actor: ActorContext = { enterpriseId: tenantId, principal: { kind: 'user', userId: uid }, contextVersion: 1,
      capabilities: ['assistant.chat.self'], entry: { kind: 'lead', id: leadId } };
    return { projectId, actor, uid };
  }
  const call = async <T>(response: Promise<Response>, expected = 200): Promise<T> => {
    const res = await response, result = await res.json();
    assert.equal(res.status, expected, JSON.stringify(result));
    assert.equal(result.success, expected === 200, JSON.stringify(result));
    return (expected === 200 ? result.data : result) as T;
  };
  const request = (route: string, token: string, data?: Record<string, unknown>) => new NextRequest(
    'http://127.0.0.1/api/miniprogram/' + route, { headers: { Authorization: 'Bearer ' + token,
      ...(data ? { 'Content-Type': 'application/json' } : {}) }, ...(data ? { method: 'POST', body: JSON.stringify(data) } : {}) });
  type Workbench = Awaited<ReturnType<typeof import('@/lib/xiaok-v1/reminder-service').listStageReminders>>;
  const inbox = (token: string, projectId?: string) =>
    call<Workbench>(remindersGet(request('xiaok/reminders' + (projectId ? '?projectId=' + projectId : ''), token)));

  const noModel: TextModelGateway = { capabilities: { streaming: false, toolCalling: false, usage: false },
    async generate() { throw new Error('Unexpected model request'); } };
  async function stageTurn(actor: ActorContext, conversation: string, question: string, expected: RegExp) {
    const chat = new ConversationService(actor), key = randomUUID(), content = textBlock(question);
    const sent = await chat.send(conversation, key, content);
    assert.ok(sent.runId);
    assert.equal((await chat.send(conversation, key, content)).runId, sent.runId);
    await assert.rejects(chat.send(conversation, key, textBlock('我更正一下刚才的问题。')), refused('idempotency_conflict'));
    const runId = String(sent.runId);
    assert.equal((await chat.run(runId)).status, 'queued');
    assert.equal(await claimJob({ enterpriseId: other, runId }), null);
    const lease = await claimJob({ enterpriseId: eid, runId });
    assert.ok(lease);
    assert.equal(await claimJob({ enterpriseId: eid, runId }), null);
    await processAnswer(lease, { model: noModel });
    const reopened = new ConversationService(actor), final = await reopened.run(runId);
    assert.equal(final.status, 'succeeded', JSON.stringify(final));
    const message = (await reopened.messages(conversation)).items.find(item => item.id === final.outputMessageId);
    assert.ok(message?.available, JSON.stringify(message));
    const saved = await withTenantTransaction(eid, tx => one(tx, sql`select purpose from app.assistant_messages
      where enterprise_id=${eid} and id=${final.outputMessageId}`));
    assert.equal(saved?.purpose, 'construction.stage_knowledge');
    const reply = (message.content as ReturnType<typeof textBlock>).blocks.map(block => block.text).join('');
    assert.match(reply, expected);
    return { question, reply, conversation, runId, messageId: final.outputMessageId };
  }

  const questions: Record<StageId, string> = {
    pre_construction: '开工准备有什么容易漏掉的？', design: '当前设计阶段需要注意什么？',
    demolition: '拆改施工前，有哪些要注意的？', utilities: '水电施工前应该先核对什么？',
    masonry: '做泥木之前要准备些什么？', painting: '油漆施工前，有哪些准备工作？',
    installation: '开始安装前，我需要检查什么？', furnishing: '软装进场前有哪些要考虑的？',
    completion: '完工阶段有哪些需要核对的事项？', occupancy: '准备入住，有什么要注意的？',
  };
  const wording: Partial<Record<StageId, Array<[string, RegExp]>>> = {
    design: [['做设计这一阶段要提前核对哪些事项？', /图纸|方案/u], ['那接下来呢？', /一般要准备什么.*还是.*实际安排/u],
      ['我是想问设计交底，这一步要先核对哪些东西？', /图纸|方案|交底/u]],
    pre_construction: [['准备开工了，有哪些资料要提前备齐？', /资料|现场/u]],
    utilities: [['这一步开始做水电了，点位要提前核对哪些东西？', /点位|插座/u]],
  };
  const sites = new Map<StageId, Awaited<ReturnType<typeof project>> & { conversation: string }>();
  for (const stage of stageDefinitions) {
    const site = await project(construction, stage.constructionKeys[0], stage.name, manager.adminId);
    const conversation = String((await new ConversationService(site.actor).create(randomUUID())).id);
    sites.set(stage.stageId, { ...site, conversation });
    await check('c01.' + stage.stageId, async () => {
      const turns = [await stageTurn(site.actor, conversation, questions[stage.stageId], new RegExp(stage.name, 'u'))];
      for (const [question, expected] of wording[stage.stageId] ?? []) turns.push(await stageTurn(site.actor, conversation, question, expected));
      return turns;
    });
  }
  await check('stage.progress_and_specialists', async () => {
    const progress = ['我家这会儿做到哪一步了？', '设计这一步比计划提前了几天？', '我们家的施工计划排出来了吗？'];
    assert.ok(progress.every(question => classifyStageIntent(question) === 'progress' && !isStageChatQuestion(question)));
    const specialist = [
      ['厨房的插座回路要提前怎么分？', 'electrical', 'electrical-specialist'],
      ['卫生间接下来做闭水试验，要怎么留记录？', 'waterproof', 'waterproof-specialist'],
    ];
    for (const [question, domain, agentId] of specialist) {
      assert.equal(isStageChatQuestion(question), false);
      const data = await call<{ answer: { handoff: unknown } }>(stageAnswerPost(request('xiaok/stage-answer', manager.token,
        { projectId: sites.get('utilities')!.projectId, question })));
      assert.deepEqual(data.answer.handoff, { agentId, domain });
    }
    return { progress, specialist };
  });

  const home = sites.get('masonry')!, pid = home.projectId;
  const detail = (projectId: string) => construction.execute('detail', { projectId });
  const member = async (projectId: string, adminId: string, role: string) => construction.execute('member',
    { projectId, adminId, role, active: true, workLabel: 'I7519 合成', expectedVersion: Number(((await detail(projectId)).project as Row).version) }, randomUUID());
  const roomId = String(((await detail(pid)).rooms as Row[])[0].id);
  const day = (offset: number) => new Date(tick.getTime() + offset * 86400000).toISOString().slice(0, 10);
  const schedule = (expectedVersion: number, from: number, to: number) => construction.execute('saveSchedule', { projectId: pid, expectedVersion,
    title: 'I7519 合成施工计划', note: '卫生间泥木施工', nodes: [{ key: 'i7519_masonry_bath', stageKey: 'masonry_carpentry',
      roomId, plannedStart: day(from), plannedEnd: day(to) }] }, randomUUID());
  await schedule(0, -2, 2);
  await member(pid, designer.adminId, 'designer');
  await member(pid, worker.adminId, 'worker');
  const bindings = await withTenantTransaction(eid, async tx => ({
    customer: await ensureFollowupBinding(tx, eid, { kind: 'user', id: home.uid, audience: 'customer', projectId: pid }),
    designer: await ensureFollowupBinding(tx, eid, { kind: 'admin', id: designer.adminId, audience: 'designer' }),
    worker: await ensureFollowupBinding(tx, eid, { kind: 'admin', id: worker.adminId, audience: 'worker' }),
    boss: await ensureFollowupBinding(tx, eid, { kind: 'admin', id: boss.adminId, audience: 'boss' }),
  }));
  const pilot = async (pilotId: string, projectId: string) => {
    await withTenantTransaction(eid, tx => tx.execute(sql`insert into app.xiaok_pilot_project_scopes
      (enterprise_id,pilot_id,project_ids,created_by,scope_version,status)
      values(${eid},${pilotId},array[${projectId}::bigint],${boss.adminId},1,'active')`));
    return { XIAOK_STAGE_REMINDER_MODE: 'pilot', XIAOK_STAGE_REMINDER_ENTERPRISE_ID: eid, XIAOK_STAGE_REMINDER_PILOT_ID: pilotId };
  };
  const env = await pilot('i7519-main', pid);
  const reminderRows = (projectId: string) => withTenantTransaction(eid, tx => rows(tx, sql`select
      reminder_id,target_role,target_principal_id::text,trigger_type,related_issue_id,status,last_error,
      conversation_id::text,message_id::text,delivered_at
    from app.construction_stage_reminders where enterprise_id=${eid} and project_id=${projectId} order by reminder_id`));
  const deliveryEvents = () => withTenantTransaction(eid, tx => rows(tx, sql`select id::text,aggregate_id from app.domain_event_outbox
    where enterprise_id=${eid} and type='construction.stage_reminder.delivered.v1' order by id`));
  const advance = () => advanceConfiguredStageReminders({ now: tick, env });
  const deliver = () => deliverConfiguredStageReminders({ now: tick, env });
  await check('reminders.10_candidates_7_delivered_3_no_inbox_and_replay', async () => {
    const first = await advance();
    assert.deepEqual([first.candidates, first.created, first.errors], [10, 10, []]);
    const delivered = await deliver();
    assert.deepEqual([delivered.delivered, delivered.no_inbox, delivered.failed, delivered.errors], [7, 3, 0, []]);
    const saved = await reminderRows(pid), events = await deliveryEvents();
    assert.equal(saved.length, 10);
    assert.equal(events.length, 7);
    assert.equal(new Set(saved.filter(row => row.message_id).map(row => row.message_id)).size, 7);
    assert.deepEqual(saved.filter(row => row.last_error === 'no_inbox').map(row => row.target_role), ['manager', 'manager', 'manager']);
    const followupActor = { ...home.actor, capabilities: ['assistant.followup.self'] };
    const reopened = await new ConversationService(followupActor).messages(String(bindings.customer.conversation_id));
    const own = saved.filter(row => row.target_role === 'owner');
    assert.ok(own.length > 0 && own.every(row => reopened.items.some(item => item.id === row.message_id && item.available)));
    const again = await advance(), repeated = await deliver();
    assert.deepEqual([again.candidates, again.created, again.errors], [10, 0, []]);
    assert.deepEqual([repeated.delivered, repeated.no_inbox, repeated.failed, repeated.errors], [0, 3, 0, []]);
    assert.deepEqual(await reminderRows(pid), saved);
    assert.deepEqual(await deliveryEvents(), events);
    assert.deepEqual(await withTenantTransaction(eid, tx => rows(tx, sql`select distinct project_id::text from app.construction_stage_reminders
      where enterprise_id=${eid}`)), [{ project_id: pid }]);
    return { first, delivered, again, repeated, saved, events };
  });

  await check('workbench.existing_entries_and_exception_boundary', async () => {
    const active = (await inbox(manager.token)).items;
    assert.deepEqual(active.map(row => row.triggerType).sort(), ['plan_node_due_soon','stage_ending','stage_entered']);
    assert.ok(active.every(row => row.projectId === pid && row.channel === 'workbench' && row.lastError === 'no_inbox' && !row.deliveredAt));
    assert.deepEqual((await inbox(manager.token, pid)).items.map(row => row.reminderId).sort(), active.map(row => row.reminderId).sort());
    assert.ok(active.filter(row => row.relatedTaskId).every(row => row.roomId === roomId && row.actionUrl.includes('roomId=' + roomId)));
    assert.equal((await inbox(boss.token)).items.length, 0);
    assert.equal((await inbox(outsider.token)).items.length, 0);
    await call(remindersGet(request('xiaok/reminders?projectId=' + pid, outsider.token)), 404);
    assert.deepEqual(await withTenantTransaction(other, tx => rows(tx, sql`select reminder_id from app.construction_stage_reminders
      where enterprise_id=${eid}`)), []);
    const shared = await call<{ items: Row[] }>(constructionGet(request('construction/projects', manager.token),
      { params: Promise.resolve({ path: ['projects'] }) }));
    assert.ok(shared.items.some(row => String(row.id) === pid && row.my_role === 'manager'));
    const brief = await call<{ items: Row[] }>(constructionGet(request('construction/brief', boss.token),
      { params: Promise.resolve({ path: ['brief'] }) }));
    assert.ok(brief.items.some(row => row.projectId === pid));
    return { manager: active.map(row => ({ id: row.reminderId, type: row.triggerType, url: row.actionUrl })),
      bossNormalTodos: 0, bossBriefProject: pid, foreignTenant: '404/rls_zero' };
  });

  await check('workbench.assignee_and_revocation', async () => {
    await member(pid, peer.adminId, 'manager');
    const workerChat = new SiteChatService({ enterpriseId: eid, adminId: worker.adminId });
    const evidence = textBlock('I7519 合成记录：卫生间墙砖收口待现场核对。');
    const draft = await workerChat.withWriteScope(pid, async (tx, c) => {
      const conversationId = String(c.id);
      const message = await appendMessage(tx, workerChat.actor, conversationId,
        { author: 'admin', clientMessageId: randomUUID(), purpose: 'site.source', content: evidence });
      const record = (await one(tx, sql`insert into app.construction_site_records
        (enterprise_id,project_id,conversation_id,source_message_id,author_id,status,data,room_id,room_name_snapshot)
        values(${eid},${pid},${conversationId},${String(message.id)},${worker.adminId},'draft',
          ${JSON.stringify({ title: 'I7519 合成记录', completed: '', pending: '收口待核对', coordination: '', note: '', roomId })}::jsonb,
          ${roomId},'卫生间') returning *`))!;
      await recordVersion(tx, eid, record, worker.adminId, 'organized');
      return { record, conversationId };
    });
    const recordId = String(draft.record.id);
    await new SiteChatService({ enterpriseId: eid, adminId: manager.adminId }).mutate(pid, recordId, 'publish',
      { expectedVersion: Number(draft.record.version), audience: 'customer' }, randomUUID());
    const issue = await withTenantTransaction(eid, async tx => {
      const source = await currentRecord(tx, eid, pid, recordId);
      assert.ok(source);
      const message = await appendMessage(tx, managerActor, draft.conversationId, { author: 'admin',
        clientMessageId: randomUUID(), purpose: 'site.source', content: evidence });
      const opened = await openRecordIssue(tx, eid, pid, recordId, source, { openedBy: manager.adminId,
        requestMessageId: String(message.id), requestHash: fingerprint(evidence), requestText: 'I7519 合成经理待核对' },
        managerActor.principal, randomUUID());
      // Seed one confirmed issue revision, not a reminder or a fake deadline.
      const payload = { ...opened, revision: 2, ownerId: manager.adminId, state: 'rectifying', confirmed: true, action: 'i7519_fixture' };
      await tx.execute(sql`insert into app.domain_event_outbox
        (enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
        values(${eid},'construction.site.issue.progress.v1','construction_site_issue',${opened.issueId},2,
          ${JSON.stringify(managerActor.principal)}::jsonb,${randomUUID()},${JSON.stringify(payload)}::jsonb)`);
      return { id: opened.issueId, messageId: String(message.id) };
    });
    assert.deepEqual((await advance()).errors, []);
    const counted = await deliver();
    assert.deepEqual([counted.delivered, counted.failed, counted.errors], [0, 0, []]);
    const own = (await inbox(manager.token, pid)).items.filter(item => item.relatedIssueId === issue.id);
    assert.equal(own.length, 1);
    assert.equal(own[0].channel, 'workbench');
    assert.ok(own[0].actionUrl.includes('item=' + issue.id));
    assert.equal((await inbox(peer.token, pid)).items.filter(item => item.relatedIssueId === issue.id).length, 0);
    assert.equal((await inbox(boss.token)).items.length, 0);
    const closed = await withTenantTransaction(eid, tx => executeSiteIssue(tx, managerActor, pid, issue.messageId,
      { action: 'cancel', target: issue.id, value: '' }, { records: {}, issues: { [issue.id]: 2 } }, true));
    assert.equal(closed?.classification, 'cancelled');
    assert.deepEqual((await advance()).errors, []);
    const history = await inbox(manager.token, pid);
    assert.ok(!history.items.some(item => item.reminderId === own[0].reminderId));
    assert.ok(history.history.some(item => item.reminderId === own[0].reminderId && item.lastError === 'condition_cleared'));
    const old = history.items.find(item => item.role === 'manager')!;
    await member(pid, manager.adminId, 'worker');
    try {
      const visible = await inbox(manager.token, pid);
      assert.ok(![...visible.items, ...visible.history].some(item => item.role === 'manager'));
      await call(remindersPost(request('xiaok/reminders', manager.token,
        { projectId: pid, action: 'cancel', reminderId: old.reminderId })), 404);
    } finally { await member(pid, manager.adminId, 'manager'); }
    // Same preexisting brief and reminder entry for a genuine plan breach.
    await schedule(1, -9, -5);
    const escalated = await advance();
    assert.deepEqual(escalated.errors, []);
    const receipt = await deliver();
    assert.deepEqual(receipt.errors, []);
    const exceptions = (await inbox(boss.token)).items;
    assert.equal(exceptions.length, 1);
    assert.deepEqual([exceptions[0].triggerType, exceptions[0].channel, exceptions[0].roomId], ['plan_node_overdue','conversation',roomId]);
    return { recordId, issue: issue.id, assignee: manager.adminId, reminderId: own[0].reminderId, closed: 'history',
      oldRoleRead: 'hidden', oldRoleCancel: 404, bossException: exceptions[0] };
  });

  await check('delivery.no_inbox_and_failed_receipt_then_recovery', async () => {
    const recovery = await project(construction, 'design', '无收件箱及失败恢复', manager.adminId);
    await member(recovery.projectId, designer.adminId, 'designer');
    const scope = await pilot('i7519-recovery', recovery.projectId);
    const deliverRecovery = () => deliverConfiguredStageReminders({ now: tick, env: scope });
    const created = await advanceConfiguredStageReminders({ now: tick, env: scope });
    assert.deepEqual([created.candidates, created.created, created.errors], [3, 3, []]);
    const eventsBefore = await deliveryEvents(), designerConversation = String(bindings.designer.conversation_id);
    const setStatus = (status: string) => withTenantTransaction(eid, tx => tx.execute(sql`update app.assistant_conversations
      set status=${status} where enterprise_id=${eid} and id=${designerConversation}`));
    await setStatus('closed');
    const first = await deliverRecovery().finally(() => setStatus('open'));
    assert.deepEqual([first.delivered, first.no_inbox, first.failed, first.errors], [0, 2, 1, []]);
    const initial = await reminderRows(recovery.projectId);
    assert.ok(initial.every(row => row.status === 'failed' && row.message_id === null && row.delivered_at === null));
    assert.equal(initial.find(row => row.target_role === 'designer')?.last_error, 'delivery_failed');
    assert.equal(initial.find(row => row.target_role === 'owner')?.last_error, 'no_inbox');
    assert.deepEqual(await deliveryEvents(), eventsBefore, 'Failed delivery must roll the event back');
    const chat = new ConversationService(recovery.actor), conversation = String((await chat.create(randomUUID())).id);
    const fixed = await deliverRecovery();
    assert.deepEqual([fixed.delivered, fixed.no_inbox, fixed.failed, fixed.errors], [2, 1, 0, []]);
    const saved = await reminderRows(recovery.projectId);
    assert.deepEqual(saved.map(row => row.reminder_id), initial.map(row => row.reminder_id));
    assert.ok((await chat.messages(conversation)).items.some(message => message.available
      && saved.some(row => row.target_role === 'owner' && row.message_id === message.id)));
    assert.equal((await deliveryEvents()).length, eventsBefore.length + 2);
    assert.equal((await deliverRecovery()).delivered, 0);
    assert.deepEqual(await reminderRows(recovery.projectId), saved);
    return { first, initial, fixed, saved, failedOutboxWrites: 0 };
  });

  await check('postflight.tenant_and_queue', async () => {
    const outside = await project(foreign, 'utilities', '范围外项目', outsider.adminId);
    assert.equal((await inbox(outsider.token, outside.projectId)).items.length, 0);
    const state = await tableState();
    assert.deepEqual(state, { tenants: 2, real_tenant: 0, active: 0, mappings: 0 });
    assert.equal(run.networkAttempts, 0);
    return state;
  });
}

async function main() {
  const client = new pg.Client({ connectionString: target.href, connectionTimeoutMillis: 4000, statement_timeout: 10000 });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { run.networkAttempts++; throw new Error('External calls are disabled during I7.5.19'); };
  // Next 10:00 Shanghai avoids quiet hours and keeps the synthetic plan dates stable during the run.
  const tick = new Date();
  tick.setUTCHours(2, 0, 0, 0);
  if (+tick < Date.now()) tick.setUTCDate(tick.getUTCDate() + 1);
  run.tick = tick.toISOString();
  try {
    run.before = sourceBinding();
    await client.connect();
    await check('preflight.fresh_pg17_schema_and_ledger', async () => {
      const { rows: [identity] } = await client.query(`select current_user as role,current_database() as database,
        current_setting('server_version_num')::int as version,shobj_description(d.oid,'pg_database') as marker,
        (select rolsuper or rolbypassrls from pg_roles where rolname=current_user) as privileged
        from pg_database d where d.datname=current_database()`);
      assert.equal(identity.database, database);
      assert.equal(identity.role, 'sfp_app');
      assert.equal(identity.privileged, false);
      assert.ok(identity.version >= 170000 && identity.version < 180000);
      assert.match(identity.marker, /^xiaok-i7519-/u);
      const { rows: [lock] } = await client.query("select pg_try_advisory_lock(hashtext('assistant_isolated_acceptance')) acquired");
      assert.equal(lock.acquired, true);
      const { rows: [ledger] } = await client.query(`select count(*)::int count,max(id) last,jsonb_agg(m order by id)::text receipt
        from (select id,hash,created_at::text from app.__drizzle_migrations) m`);
      assert.deepEqual([ledger.count, ledger.last, hash(ledger.receipt)], [129, 135, expectedLedger]);
      assert.deepEqual(await tableState(), { tenants: 0, real_tenant: 0, active: 0, mappings: 0 });
      return { ...identity, ledger: ledger.count };
    });
    await exercise(tick);
  } catch (error) {
    if (run.checks.at(-1)?.status !== 'failed')
      run.checks.push({ id: 'execution', status: 'failed', evidence: error instanceof Error ? error.stack : String(error) });
    console.error(error);
    process.exitCode = 1;
  } finally {
    globalThis.fetch = originalFetch;
    await Promise.all([client.end(), closePostgresPool()]);
    run.after = sourceBinding();
    if (run.before !== run.after) {
      run.checks.push({ id: 'source_binding', status: 'failed', evidence: 'Input bytes changed during the run' });
      process.exitCode = 1;
    }
    writeFileSync(out, JSON.stringify(run, null, 2) + '\n');
  }
}
void main();
