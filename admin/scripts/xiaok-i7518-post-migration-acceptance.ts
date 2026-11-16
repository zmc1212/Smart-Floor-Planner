import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { getDefaultMenuKeys } from '@/lib/admin-user-roles';
import { fingerprint, type ActorContext, type TextModelGateway } from '@/lib/assistant/contracts';
import { appendMessage, ConversationService } from '@/lib/assistant/core/conversation';
import { processAnswer } from '@/lib/assistant/infrastructure/answer-worker';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { KnowledgeService } from '@/lib/assistant/knowledge/service';
import { FollowupService } from '@/lib/construction/followup-service';
import { latestReportPeriod } from '@/lib/construction/report-calendar';
import { ensureFollowupBinding } from '@/lib/construction/report-store';
import { advanceConfiguredConstructionReports, deliverConfiguredConstructionReports, processConstructionReport } from '@/lib/construction/report-worker';
import { ConstructionService } from '@/lib/construction/service';
import { recordVersion, SiteChatService } from '@/lib/construction/site-chat';
import { closePostgresPool } from '@/lib/postgresql';
import { routeStageQuestion } from '@/lib/xiaok-v1/stage-router';
import { advanceConfiguredStageReminders, deliverConfiguredStageReminders } from '@/lib/xiaok-v1/stage-reminder-worker';
import { stageDefinitions, type StageId } from '@/lib/xiaok-v1/stages';

const mode = process.argv[2];
assert.ok(['business', 'citations'].includes(mode), 'Usage: ... [business|citations]');
const target = new URL(process.env.XIAOK_I7518_DATABASE_URL ?? 'http://missing');
const database = target.pathname.slice(1);
const expectedName = mode === 'business' ? /^xiaok_i7518_business[0-9]+$/ : /^xiaok_i7515_i7518_rag[0-9]+$/;
assert.ok(target.protocol === 'postgresql:' && target.hostname === '127.0.0.1' && expectedName.test(database)
  && Number(target.port) >= 49152 && ![5432, 55432, 55437].includes(Number(target.port))
  && target.username === 'sfp_app' && target.password && !target.search && !target.hash, 'Use a dedicated local I7.5.18 PG17 database');
const output = process.env.XIAOK_I7518_OUTPUT ?? '';
const expectedLedger = process.env.XIAOK_I7518_LEDGER_SHA256 ?? '';
assert.ok(path.isAbsolute(output) && /^[a-f0-9]{64}$/u.test(expectedLedger));
writeFileSync(output, '', { flag: 'wx' });
process.env.DATABASE_URL = target.href;
process.env.ASSISTANT_KNOWLEDGE_PROVIDER = 'LOCAL_PGVECTOR';

const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const textBlock = (text: string) => ({ version: 1 as const, blocks: [{ type: 'text' as const, text }] });
const tenantActor = (enterpriseId: string, principal: ActorContext['principal'], followup = false): ActorContext => ({
  enterpriseId, principal, contextVersion: 1, capabilities: [followup ? 'assistant.followup.self' : 'assistant.chat.self'],
});
const refuseCode = (code: string) => (error: unknown) => (error as { code?: string })?.code === code;
const result: { scope: string; startedAt: string; finishedAt?: string; before?: string; after?: string;
  checks: Array<{ id: string; status: 'passed' | 'failed'; evidence: unknown }> } = {
  scope: mode, startedAt: new Date().toISOString(), checks: [],
};
function sourceBinding() {
  const files = execFileSync('git', ['ls-files', '-c', '-o', '--exclude-standard', '-z', '--', 'src',
    'drizzle', 'scripts/xiaok-i7518-post-migration-acceptance.ts', 'package.json', 'package-lock.json', 'tsconfig.json'])
    .toString().split('\0').filter(Boolean).sort();
  const hash = createHash('sha256');
  for (const file of files) hash.update(file).update('\0').update(readFileSync(file)).update('\0');
  return hash.update(JSON.stringify({ mode, database, port: target.port, expectedLedger })).digest('hex');
}
async function check<T>(id: string, fn: () => Promise<T>) {
  try {
    const value = await fn();
    result.checks.push({ id, status: 'passed', evidence: value });
    console.log('PASS', id);
    return value;
  } catch (error) {
    result.checks.push({ id, status: 'failed', evidence: error instanceof Error ? error.stack : String(error) });
    console.error('FAIL', id);
    throw error;
  }
}

async function business() {
  const password = await bcrypt.hash(process.env.XIAOK_I7518_UI_PASSWORD ?? randomUUID(), 10);
  const tenant = (label: string) => withPlatformTransaction(async tx => {
    const enterprise = (await one(tx, sql`insert into app.enterprises (name,code,status,registration_mode)
      values(${label},${label},'active','manual') returning id::text`))!;
    const eid = String(enterprise.id);
    assert.notEqual(eid, '1454');
    await tx.execute(sql`insert into app.assistant_enterprise_settings
      (enterprise_id,enabled,retention_days,daily_requests,daily_tokens,daily_cost_micros)
      values(${eid},true,365,1000,10000000,1000000000)`);
    return eid;
  });
  const admin = (eid: string, role: string, login: string) => withPlatformTransaction(async tx => {
    const linked = (await one(tx, sql`insert into app.users(enterprise_id,nickname,role) values(${eid},${login},'user') returning id::text`))!;
    return String((await one(tx, sql`insert into app.admin_users
      (enterprise_id,user_id,username,password_hash,display_name,role,status,must_change_password,menu_permissions)
      values(${eid},${String(linked.id)},${login},${password},${login},${role},'active',false,
        ARRAY(select jsonb_array_elements_text(${JSON.stringify(getDefaultMenuKeys(role))}::jsonb))) returning id::text`))!.id);
  });
  const eid = await tenant('I7518 合成企业 A'), other = await tenant('I7518 合成企业 B');
  const [boss, manager, designer, worker, outsider] = await Promise.all([
    admin(eid, 'enterprise_admin', 'i7518_fixture_boss'), admin(eid, 'construction_staff', 'i7518_fixture_manager'),
    admin(eid, 'designer', 'i7518_fixture_designer'), admin(eid, 'construction_staff', 'i7518_fixture_worker'),
    admin(other, 'enterprise_admin', 'i7518_fixture_other'),
  ]);
  await withPlatformTransaction(tx => tx.execute(sql`insert into app.system_roles(role_key,label,menu_keys,description)
    values('designer','设计师',ARRAY['construction-projects'],'I7518 synthetic'), ('construction_staff','施工人员',ARRAY['construction-projects'],'I7518 synthetic') on conflict(role_key) do nothing`));
  const service = new ConstructionService({ enterpriseId: eid, adminId: boss });
  const foreign = new ConstructionService({ enterpriseId: other, adminId: outsider });
  let phone = 510000;
  async function project(construction: ConstructionService, stage: string, label: string, managerId: string) {
    const enterprise = construction.actor.enterpriseId;
    const { uid, leadId } = await withPlatformTransaction(async tx => {
      const uid = String((await one(tx, sql`insert into app.users(enterprise_id,nickname,context_version)
        values(${enterprise},${label},1) returning id::text`))!.id);
      const leadId = String((await one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source)
        values(${enterprise},${uid},${label},${'19977' + ++phone},'natural') returning id::text`))!.id);
      return { uid, leadId };
    });
    const input = { leadId, name: label, managerId, rooms: ['卫生间'] }, key = randomUUID();
    const created = await construction.execute('create', input, key);
    assert.equal((await construction.execute('create', input, key)).id, created.id);
    const projectId = String(created.id);
    const updated = await construction.execute('update', { projectId, expectedVersion: Number(created.version),
      name: label, status: 'active', customerAccess: true }, randomUUID());
    await construction.execute('progress', { projectId, expectedVersion: Number(updated.version), stageKey: stage,
      note: 'I7518 合成阶段事实', sendReminder: false }, randomUUID());
    const actor = { ...tenantActor(enterprise, { kind: 'user', userId: uid }), entry: { kind: 'lead' as const, id: leadId } };
    const chat = new ConversationService(actor);
    const conversation = String((await chat.create(randomUUID())).id);
    return { uid, projectId, chat, conversation };
  }
  const outside = await project(foreign, 'utilities', 'I7518 合成范围外项目', outsider);
  const cases: Record<StageId, string> = {
    pre_construction: '开工准备有什么容易漏掉的？', design: '当前设计阶段需要注意什么？',
    demolition: '拆改施工前，有哪些要注意的？', utilities: '水电施工前应该先核对什么？',
    masonry: '做泥木之前要准备些什么？', painting: '油漆施工前，有哪些准备工作？',
    installation: '开始安装前，我需要检查什么？', furnishing: '软装进场前有哪些要考虑的？',
    completion: '完工阶段有哪些需要核对的事项？', occupancy: '准备入住，有什么要注意的？',
  };
  const projects = new Map<StageId, Awaited<ReturnType<typeof project>>>();
  const noModel: TextModelGateway = { capabilities: { streaming: false, toolCalling: false, usage: false },
    async generate() { throw new Error('Unexpected model call in deterministic stage scenario'); } };
  for (const stage of stageDefinitions) {
    const flow = await project(service, stage.constructionKeys[0], 'I7518 合成工地 ' + stage.name, manager);
    projects.set(stage.stageId, flow);
    await check('stage.' + stage.stageId, async () => {
      const question = cases[stage.stageId], content = textBlock(question), key = randomUUID();
      const sent = await flow.chat.send(flow.conversation, key, content);
      const replay = await flow.chat.send(flow.conversation, key, content);
      assert.ok(sent.runId);
      assert.equal(replay.runId, sent.runId);
      await assert.rejects(flow.chat.send(flow.conversation, key, textBlock('我修正一下问题。')), refuseCode('idempotency_conflict'));
      const runId = String(sent.runId);
      assert.equal((await flow.chat.run(runId)).status, 'queued');
      assert.equal(await claimJob({ enterpriseId: other, runId }), null);
      const acquired = await claimJob({ enterpriseId: eid, runId });
      assert.ok(acquired);
      assert.equal((await flow.chat.run(runId)).status, 'running');
      assert.equal(await claimJob({ enterpriseId: eid, runId }), null);
      await processAnswer(acquired, { model: noModel });
      const final = await new ConversationService(flow.chat.actor).run(runId);
      assert.equal(final.status, 'succeeded', JSON.stringify(final));
      const answer = (await flow.chat.messages(flow.conversation)).items.find(item => item.id === final.outputMessageId);
      assert.ok(answer?.available, JSON.stringify(answer));
      const saved = await withTenantTransaction(eid, tx => one(tx, sql`select purpose from app.assistant_messages
        where enterprise_id=${eid} and id=${final.outputMessageId}`));
      assert.equal(saved?.purpose, 'construction.stage_knowledge');
      const reply = (answer.content as ReturnType<typeof textBlock>).blocks.map(block => block.text).join('');
      assert.ok(reply.includes(stage.name), reply);
      return { question, reply, projectId: flow.projectId, conversationId: flow.conversation, runId, messageId: final.outputMessageId,
        status: ['queued','running',final.status], repeatSend: 'same-run', repeatClaim: 'none' };
    });
  }
  await check('stage.specialist_routes_and_construction_denial', async () => {
    const questions = ['厨房的插座回路应该怎么分？', '卫生间的闭水试验该怎么做？'];
    const routes = questions.map(message => routeStageQuestion({ constructionStageKey: 'utilities', message }));
    assert.deepEqual(routes.map(route => route.kind === 'specialist' && route.domain), ['electrical', 'waterproof']);
    const site = projects.get('masonry')!;
    await assert.rejects(foreign.execute('detail', { projectId: site.projectId }), refuseCode('construction_not_found'));
    await assert.rejects(outside.chat.messages(site.conversation), refuseCode('assistant_resource_not_found'));
    return { questions, routes: routes.map(route => route.kind === 'specialist' && route.agentId), crossTenant: 'denied' };
  });

  const home = projects.get('masonry')!, projectId = home.projectId;
  const recipient = {
    customer: tenantActor(eid, { kind: 'user', userId: home.uid }, true),
    designer: tenantActor(eid, { kind: 'admin', adminId: designer }, true),
    boss: tenantActor(eid, { kind: 'admin', adminId: boss }, true),
    worker: tenantActor(eid, { kind: 'admin', adminId: worker }, true),
  };
  const stageKey = 'masonry_carpentry', now = new Date();
  const date = (delta: number) => new Intl.DateTimeFormat('sv-SE', {timeZone: 'Asia/Shanghai', dateStyle: 'short'})
    .format(new Date(now.getTime() + delta * 86400000));
  const factAt = new Date(latestReportPeriod('weekly', now, '08:00', 1).start.getTime() + 2 * 86400000);
  async function detail() { return service.execute('detail', { projectId }); }
  for (const [id, role] of [[designer, 'designer'], [worker, 'worker']]) await service.execute('member', {
    projectId, expectedVersion: Number(((await detail()).project as Row).version), adminId: id, role, active: true, workLabel: 'I7518 合成',
  }, randomUUID());
  const [room] = (await detail()).rooms as Row[];
  assert.ok(room?.id);
  const plan = await service.execute('saveSchedule', { projectId, expectedVersion: 0,
    title: 'I7518 合成施工计划', note: '卫生间泥木施工',
    nodes: [{ key: 'i7518_masonry_bath', stageKey, roomId: room.id, plannedStart: date(-2), plannedEnd: date(2) }],
  }, randomUUID());
  const recordText = '卫生间完成墙砖铺贴；收口等待现场核对。';
  const reporter = new SiteChatService({ enterpriseId: eid, adminId: worker });
  const draft = await reporter.withWriteScope(projectId, async (tx, conversation) => {
    const message = await appendMessage(tx, reporter.actor, String(conversation.id), {
      author: 'admin', clientMessageId: randomUUID(), purpose: 'site.source', content: textBlock(recordText),
    });
    // Synthesize the organizer's draft. The normal manager publication and all reads are real.
    const data = { title: 'I7518 合成记录', completed: recordText, pending: '核对收口', coordination: '', roomId: room.id, note: recordText };
    const row = (await one(tx, sql`insert into app.construction_site_records(enterprise_id,project_id,conversation_id,
      source_message_id,author_id,status,data,room_id,room_name_snapshot) values(${eid},${projectId},${String(conversation.id)},
      ${String(message.id)},${worker},'draft',${JSON.stringify(data)}::jsonb,${String(room.id)},'卫生间') returning *`))!;
    await recordVersion(tx, eid, row, worker, 'organized');
    return row;
  });
  const recordId = String(draft.id);
  await new SiteChatService({ enterpriseId: eid, adminId: manager }).mutate(projectId, recordId, 'publish',
    { expectedVersion: Number(draft.version), audience: 'customer' }, randomUUID());
  await withTenantTransaction(eid, tx => tx.execute(sql`update app.construction_site_records
    set created_at=${factAt},published_at=${factAt},updated_at=${factAt} where enterprise_id=${eid} and id=${recordId}`));
  await check('construction.project_schedule_record_readback', async () => {
    const readPlan = await service.execute('schedule', { projectId });
    assert.equal(readPlan.available, true);
    assert.equal(readPlan.version, plan.version);
    assert.equal(((await detail()).project as Row).current_stage_key, stageKey);
    assert.ok(JSON.stringify(await reporter.read(projectId)).includes(recordText));
    return { enterpriseId: eid, projectId, roomId: room.id, scheduleVersion: plan.version, recordId };
  });
  const bindings = new Map<string, Row>();
  await withTenantTransaction(eid, async tx => {
    for (const [audience, actor] of Object.entries(recipient)) {
      const role = audience as keyof typeof recipient;
      const principal = actor.principal;
      bindings.set(role, await ensureFollowupBinding(tx, eid, { kind: principal.kind,
        id: principal.kind === 'user' ? principal.userId : principal.adminId, audience: role,
        ...(role === 'customer' ? { projectId } : {}) }));
    }
    await tx.execute(sql`insert into app.construction_report_settings
      (enterprise_id,enabled,daily_time,weekly_time,weekly_day,next_daily_at,next_weekly_at,stage_enabled,audiences)
      values(${eid},true,'20:00','08:00',1,${new Date(now.getTime()+86400000)},${new Date(now.getTime()-3600000)},
        false,'["customer","designer","boss","worker"]'::jsonb)`);
    await tx.execute(sql`insert into app.xiaok_pilot_project_scopes(enterprise_id,pilot_id,project_ids,created_by,scope_version,status)
      values(${eid},'i7518',array[${projectId}::bigint],${boss},1,'active')`);
  });
  const env = { XIAOK_STAGE_REMINDER_MODE: 'pilot', XIAOK_STAGE_REMINDER_ENTERPRISE_ID: eid,
    XIAOK_STAGE_REMINDER_PILOT_ID: 'i7518', XIAOK_WEEKLY_REPORT_MODE: 'pilot',
    XIAOK_WEEKLY_REPORT_ENTERPRISE_ID: eid, XIAOK_WEEKLY_REPORT_PILOT_ID: 'i7518' };
  const tick = new Date();
  await check('construction.reminder_delivery_reentry_idempotency', async () => {
    const generated = await advanceConfiguredStageReminders({ now: tick, env });
    assert.ok(generated.created > 0, JSON.stringify(generated));
    const delivered = await deliverConfiguredStageReminders({ now: tick, env });
    assert.ok(delivered.delivered > 0, JSON.stringify(delivered));
    const readReminders = () => withTenantTransaction(eid, tx => rows(tx, sql`select reminder_id,project_id::text,
      trigger_type,target_role,status,message_id::text,conversation_id::text,last_error from app.construction_stage_reminders
      where enterprise_id=${eid} order by reminder_id`));
    const reminderRows = await readReminders();
    assert.ok(reminderRows.every(row => row.project_id === projectId));
    const ownerRows = reminderRows.filter(row => row.target_role === 'owner' && row.status === 'delivered');
    assert.ok(ownerRows.length);
    const ownerChat = new ConversationService(recipient.customer);
    const reopened = await ownerChat.messages(String(bindings.get('customer')!.conversation_id));
    assert.ok(ownerRows.every(row => reopened.items.some(item => item.id === row.message_id && item.available)));
    // The service's "created" metric counts candidates; detect duplicates from persisted receipts.
    const repeatAdvance = await advanceConfiguredStageReminders({ now: tick, env });
    const repeatDelivery = await deliverConfiguredStageReminders({ now: tick, env });
    assert.equal(repeatDelivery.delivered, 0);
    assert.deepEqual(await readReminders(), reminderRows);
    return { generated, delivered, repeatAdvance, repeatDelivery, reminders: reminderRows };
  });
  const reports = await check('construction.weekly_facts_worker_delivery', async () => {
    const queued = await advanceConfiguredConstructionReports({ now: tick, env });
    assert.equal(queued.scopedProjects, 1);
    assert.equal(queued.queued, 5, JSON.stringify(queued)); // Both the manager and the worker qualify as worker audience.
    const runs = await withTenantTransaction(eid, tx => rows(tx, sql`select id::text from app.assistant_runs
      where enterprise_id=${eid} and purpose='construction.report.facts' and status='queued' order by id`));
    assert.equal(runs.length, queued.queued);
    for (const run of runs) {
      const lease = await claimJob({ enterpriseId: eid, runId: String(run.id) });
      assert.ok(lease);
      assert.equal(await claimJob({ enterpriseId: eid, runId: lease.runId }), null);
      await processConstructionReport(lease);
    }
    const designerConversation = String(bindings.get('designer')!.conversation_id);
    const setMode = (mode: string) => withTenantTransaction(eid, tx => tx.execute(sql`update app.assistant_conversations set mode=${mode}
      where enterprise_id=${eid} and id=${designerConversation}`));
    const readDelivery = () => withTenantTransaction(eid, tx => rows(tx, sql`select b.audience,b.principal_key,d.report_id::text,
      d.binding_id::text,d.message_id::text,d.state,v.status,v.facts_hash,r.status as run_status
      from app.construction_report_deliveries d join app.construction_followup_bindings b
        on b.enterprise_id=d.enterprise_id and b.id=d.binding_id
      join app.construction_report_versions v on v.enterprise_id=d.enterprise_id and v.report_id=d.report_id and v.revision=d.revision
      join app.assistant_runs r on r.enterprise_id=v.enterprise_id and r.id=v.run_id
      where d.enterprise_id=${eid} order by b.audience`));
    await setMode('human');
    try {
      assert.equal((await deliverConfiguredConstructionReports({ now: tick, env })).delivered, queued.queued - 1);
      assert.equal((await readDelivery()).find(row => row.audience === 'designer')?.state, 'held');
    } finally { await setMode('ai'); }
    assert.equal((await deliverConfiguredConstructionReports({ now: tick, env })).delivered, 1);
    const delivery = await readDelivery();
    assert.equal(delivery.length, queued.queued);
    assert.deepEqual([...new Set(delivery.map(row => row.audience))], ['boss','customer','designer','worker']);
    assert.equal(delivery.filter(row => row.audience === 'worker').length, 2);
    assert.ok(delivery.every(row => row.state === 'delivered' && row.status === 'facts_ready' && row.run_status === 'succeeded'
      && row.message_id && /^[0-9a-f]{64}$/u.test(String(row.facts_hash))));
    assert.equal((await advanceConfiguredConstructionReports({ now: tick, env })).queued, 0);
    assert.equal((await deliverConfiguredConstructionReports({ now: tick, env })).delivered, 0);
    assert.deepEqual(await readDelivery(), delivery);
    return delivery;
  });
  await check('construction.weekly_four_roles_original_and_reentry', async () => {
    const verified = [];
    for (const row of reports) {
      const role = row.audience as keyof typeof recipient, binding = String(row.binding_id), report = String(row.report_id);
      const who = row.principal_key === 'admin:' + manager ? tenantActor(eid, { kind: 'admin', adminId: manager }, true) : recipient[role];
      const service = new FollowupService(who);
      const listed = await service.reports(binding);
      assert.ok(listed.items.some(item => item.reportId === report && item.available));
      const detail = await service.detail(binding, report, 1);
      assert.ok(detail.available && detail.facts && 'readToken' in detail && detail.readToken);
      assert.deepEqual(detail.facts.projects.map(item => item.id), [projectId]);
      const original = await service.record(binding, report, 1, projectId, recordId);
      assert.ok(JSON.stringify(original.data).includes(recordText));
      const key = randomUUID(), acknowledge = () => service.acknowledge(binding, report, 1, detail.readToken!, key);
      assert.deepEqual(await acknowledge(), await acknowledge());
      const reentered = await new FollowupService(who).detail(binding, report, 1);
      assert.ok(reentered.available && 'readAt' in reentered && reentered.readAt);
      verified.push({ role, principal: row.principal_key, binding, report, recordId, factsHash: row.facts_hash, readAt: reentered.readAt,
        contentStatus: 'contentStatus' in detail ? detail.contentStatus : undefined });
    }
    const denied = reports.find(row => row.audience === 'boss')!;
    await assert.rejects(new FollowupService(recipient.customer).detail(String(denied.binding_id),
      String(denied.report_id), 1), refuseCode('assistant_resource_not_found'));
    return verified;
  });
}
async function citations(client: pg.Client, corpus: string) {
  await check('0132_rls_composite_foreign_keys', async () => {
    const tables = ['assistant_message_citations','assistant_knowledge_chunks','assistant_knowledge_versions',
      'assistant_managed_knowledge_libraries','assistant_managed_knowledge_imports'];
    const { rows: rls } = await client.query("select relname,relrowsecurity,relforcerowsecurity from pg_class where relnamespace='app'::regnamespace and relname=any($1::text[]) order by 1", [tables]);
    assert.equal(rls.length, tables.length);
    assert.ok(rls.every(row => row.relrowsecurity && row.relforcerowsecurity));
    const { rows: constraints } = await client.query(`select conname,convalidated, pg_get_constraintdef(oid) as definition
      from pg_constraint where conrelid='app.assistant_message_citations'::regclass and conname like 'assistant_citation_source_%' order by 1`);
    assert.equal(constraints.length, 3);
    assert.ok(constraints.every(row => row.convalidated));
    assert.match(constraints.find(row => row.conname.endsWith('_version_fk'))?.definition, /FOREIGN KEY \(source_enterprise_id, document_id, document_version_id\)/u);
    assert.match(constraints.find(row => row.conname.endsWith('_chunk_fk'))?.definition, /FOREIGN KEY \(source_enterprise_id, document_version_id, chunk_id\)/u);
    return { rls, constraints };
  });
  const stored = await withPlatformTransaction(tx => rows(tx, sql`select c.id::text,c.enterprise_id::text,c.conversation_id::text,
      c.source_enterprise_id::text,c.platform_knowledge_enterprise_id::text,c.document_id::text,c.document_version_id::text,c.chunk_id::text,
      c.source_hash,c.quote_snapshot,k.text,k.text_hash,asset.source_hash as file_hash,asset.data as file_bytes,v.version_number,v.professional->'origin'->>'page' as page,p.user_id::text,v.published_by::text
    from app.assistant_message_citations c join app.assistant_knowledge_chunks k on k.enterprise_id=c.source_enterprise_id and k.id=c.chunk_id
    join app.assistant_knowledge_versions v on v.enterprise_id=k.enterprise_id and v.id=k.document_version_id
    join app.assistant_participants p on p.enterprise_id=c.enterprise_id and p.conversation_id=c.conversation_id and p.principal_kind='user'
    join app.assistant_knowledge_assets asset on asset.enterprise_id=v.enterprise_id and asset.id=v.source_asset_id
    where c.source_kind='knowledge' order by c.id`));
  await check('0132_mapping_acl_and_publisher', async () => {
    assert.ok(stored.length >= 2);
    const { rows: [acl] } = await client.query(`select has_table_privilege(current_user,'app.assistant_platform_knowledge_library','SELECT') readable,
      array(select p from unnest(array['INSERT','UPDATE','DELETE','TRUNCATE']) p
        where has_table_privilege(current_user,'app.assistant_platform_knowledge_library',p)) AS writable`);
    assert.equal(acl.readable, true);
    assert.deepEqual(acl.writable, []);
    const mapped = await withTenantTransaction(String(stored[0].enterprise_id), tx => one(tx,
      sql`select enterprise_id::text from app.assistant_platform_knowledge_library where singleton`));
    assert.equal(mapped?.enterprise_id, corpus);
    const platform = stored.find(row => row.platform_knowledge_enterprise_id);
    assert.ok(platform);
    const publisher = await withPlatformTransaction(tx => one(tx, sql`select id::text,role from app.admin_users
      where id=${String(platform.published_by)}`));
    assert.ok(publisher && ['admin','super_admin'].includes(String(publisher.role)));
    const enterpriseStaff = (await withPlatformTransaction(tx => one(tx, sql`select id::text from app.admin_users
      where enterprise_id=${String(stored[0].enterprise_id)} and role='enterprise_admin' limit 1`)))!;
    const service = new KnowledgeService({ enterpriseId: corpus, adminId: String(enterpriseStaff.id) });
    await assert.rejects(service.execute('publish', { documentId: platform.document_id, versionId: platform.document_version_id,
      expectedVersion: 1, expectedEditVersion: 1 }, randomUUID()), refuseCode('assistant_capability_forbidden'));
    return { acl, corpus, publisher, enterprisePublish: 'denied' };
  });
  await check('0132_saved_sources_revocation_and_fk_denial', async () => {
    const org = stored.find(row => row.platform_knowledge_enterprise_id === null);
    const pub = stored.find(row => row.platform_knowledge_enterprise_id === corpus);
    assert.ok(org && pub);
    assert.equal(org.source_enterprise_id, org.enterprise_id);
    assert.equal(pub.source_enterprise_id, corpus);
    assert.notEqual(pub.enterprise_id, corpus);
    const verified = [];
    for (const row of [org,pub]) {
      assert.equal(row.source_hash, row.text_hash);
      assert.equal(row.source_hash, fingerprint(row.text));
      assert.ok(Buffer.isBuffer(row.file_bytes));
      assert.equal(row.file_hash, sha(row.file_bytes));
      assert.ok(String(row.text).includes(String(row.quote_snapshot)));
      const owned = new ConversationService(tenantActor(String(row.enterprise_id), {kind:'user',userId:String(row.user_id)}));
      const citation = await owned.citation(String(row.id), true, String(row.conversation_id));
      assert.deepEqual(citation, { id: String(row.id), available: false, reason: 'source_unavailable' });
      verified.push({ id: row.id, conversationId: row.conversation_id, citingTenant: row.enterprise_id,
        sourceTenant: row.source_enterprise_id, version: row.document_version_id, versionNumber: row.version_number,
        page: row.page, passageHash: row.source_hash, sourceFileSha256: row.file_hash, quote: row.quote_snapshot, reopen: 'source_unavailable' });
    }
    const fkFault = (constraint: string) => (error: unknown) => {
      const cause = (error as { cause?: { code?: string; constraint?: string } })?.cause;
      return cause?.code === '23503' && cause.constraint === constraint;
    };
    await assert.rejects(withTenantTransaction(String(org.enterprise_id), tx => tx.execute(sql`update app.assistant_message_citations
      set document_id=${String(pub.document_id)},document_version_id=${String(pub.document_version_id)},chunk_id=null
      where enterprise_id=${String(org.enterprise_id)} and id=${String(org.id)}`)), fkFault('assistant_citation_source_version_fk'));
    await assert.rejects(withTenantTransaction(String(org.enterprise_id), tx => tx.execute(sql`update app.assistant_message_citations
      set chunk_id=${String(pub.chunk_id)} where enterprise_id=${String(org.enterprise_id)} and id=${String(org.id)}`)),
      fkFault('assistant_citation_source_chunk_fk'));
    await client.query('begin read only');
    try {
      const { rows: [visibility] } = await client.query('select count(*)::int as visible from app.assistant_message_citations');
      assert.equal(visibility.visible, 0);
    } finally { await client.query('rollback'); }
    const elsewhere = await withTenantTransaction(corpus, tx => one(tx, sql`select count(*)::int visible from app.assistant_message_citations`));
    assert.equal(elsewhere?.visible, 0);
    return { verified, fkSqlState: '23503', noContextVisible: 0, foreignTenantVisible: 0 };
  });
}
async function run() {
  const client = new pg.Client({ connectionString: target.href, connectionTimeoutMillis: 3000, statement_timeout: 10000 });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : 'url' in input ? input.url : input.href);
    assert.equal(url.hostname, '127.0.0.1', 'Compatibility driver cannot contact external providers');
    return originalFetch(input, init);
  };
  try {
    result.before = sourceBinding();
    await client.connect();
    const safety = await check('preflight_isolated_schema_ledger', async () => {
      const { rows: [identity] } = await client.query(`select current_user as role,current_database() as database,
        current_setting('server_version_num')::int as version,shobj_description(d.oid,'pg_database') as marker,
        (select rolsuper or rolbypassrls from pg_roles where rolname=current_user) as privileged
        from pg_database d where d.datname=current_database()`);
      assert.equal(identity.database, database);
      assert.equal(identity.role, 'sfp_app');
      assert.equal(identity.privileged, false);
      assert.ok(identity.version >= 170000 && identity.version < 180000);
      assert.match(identity.marker, mode === 'business' ? /^xiaok-i7518-/u : /^xiaok-i7515-i7518-/u);
      const { rows: [lock] } = await client.query("select pg_try_advisory_lock(hashtext('assistant_isolated_acceptance')) acquired");
      assert.ok(lock.acquired, 'Another acceptance controller owns this DB');
      const { rows: [ledger] } = await client.query(`select count(*)::int count, max(id) last,
        jsonb_agg(m order by id)::text receipt from (select id,hash,created_at::text from app.__drizzle_migrations) m`);
      assert.equal(ledger.count, 129);
      assert.equal(ledger.last, 135);
      assert.equal(sha(ledger.receipt), expectedLedger);
      const state = await withPlatformTransaction(tx => one(tx, sql`select
        (select count(*)::int from app.enterprises) as tenants,(select count(*)::int from app.enterprises where id=1454) as real_tenant,
        (select count(*)::int from app.assistant_jobs where status in ('queued','running')) as active,
        (select enterprise_id::text from app.assistant_platform_knowledge_library where singleton) as platform`));
      assert.ok(state && state.real_tenant === 0);
      if (mode === 'business') assert.deepEqual(state, { tenants: 0, real_tenant: 0, active: 0, platform: null });
      else assert.ok(state.tenants === 3 && state.platform && state.active === 0);
      return { ...identity, ...state, ledger: ledger.count, ledgerSha256: expectedLedger };
    });
    if (mode === 'business') await business();
    else await citations(client, String(safety.platform));
  } catch (error) {
    if (result.checks.at(-1)?.status !== 'failed')
      result.checks.push({ id: 'execution', status: 'failed', evidence: error instanceof Error ? error.stack : String(error) });
    console.error(error);
    process.exitCode = 1;
  } finally {
    globalThis.fetch = originalFetch;
    await Promise.all([client.end(), closePostgresPool()]);
    result.after = sourceBinding();
    result.finishedAt = new Date().toISOString();
    if (result.before !== result.after) {
      result.checks.push({ id: 'source_binding', status: 'failed', evidence: 'Input bytes drifted during the run' });
      process.exitCode = 1;
    }
    writeFileSync(output, JSON.stringify(result, (_key, value) => typeof value === 'bigint' ? String(value) : value, 2) + '\n');
  }
}
void run();
