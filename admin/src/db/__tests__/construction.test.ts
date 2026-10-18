import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { deleteConstructionData } from '@/db/repositories/construction-cleanup';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { ConstructionService } from '@/lib/construction/service';
import { constructionNoticeAvailable } from '@/lib/construction/customer';
import { defaultConstructionStages, type ConstructionStage } from '@/lib/construction/stages';
import { queryBusiness, businessSnapshotAvailable } from '@/lib/assistant/agent/business-tools';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { processAgentAnswer } from '@/lib/assistant/agent/worker';
import type { ActorContext } from '@/lib/assistant/contracts';
import type { ModelTurnOutput } from '@/lib/assistant/contracts/model';
import { GET, POST, PATCH } from '@/app/api/construction/[[...path]]/route';
import { getPlatformLlmRuntimeConfig, savePlatformLlmConfig } from '@/lib/platform-llm-config';
import { TenantEnterpriseResetRepository } from '@/db/repositories/tenant-enterprise-reset-repository';

const prefix = 'construction-' + randomUUID(), tenants: string[] = [], users: string[] = [], leads: string[] = [], admins: string[][] = [], actors: ActorContext[] = [], chats: string[] = [];
const services: ConstructionService[] = [];
let projectId: string, noticeId: string, noticeChat: string, originalDesignerMenus: string[] | undefined;
let priorProvider: Awaited<ReturnType<typeof getPlatformLlmRuntimeConfig>> | undefined;
const live = process.env.CONSTRUCTION_LIVE_MODEL === '1';
const configured = (stage: ConstructionStage) => ({ ...stage, visitReminder: true, visitReason: '请到现场与施工人员核对本阶段关注事项。', watchPoints: '核对插座使用位置。\n保留成品保护，按现场人员引导通行。' });
before(async () => {
  const url = new URL(resolvePostgresRuntimeConfig().connectionString); assert.equal(url.port, '55432'); assert.equal(url.pathname, '/xiaok_embedding_eval');
  if (live) {
    const primary = new URL(process.env.CONSTRUCTION_PRIMARY_DATABASE_URL || '');
    assert.ok(['localhost','127.0.0.1'].includes(primary.hostname)); assert.equal(primary.port, '5432'); assert.equal(primary.pathname, '/smart_floor_planner');
    const evaluation = process.env.DATABASE_URL; await closePostgresPool();
    let provider: Awaited<ReturnType<typeof getPlatformLlmRuntimeConfig>>;
    try { process.env.DATABASE_URL = primary.toString(); provider = await getPlatformLlmRuntimeConfig(); }
    finally { await closePostgresPool(); process.env.DATABASE_URL = evaluation; }
    assert.equal(provider.providerKey, 'deepseek'); assert.equal(new URL(provider.baseUrl).origin, 'https://api.deepseek.com');
    priorProvider = await getPlatformLlmRuntimeConfig();
    await savePlatformLlmConfig({ enabled: true, providerKey: 'deepseek', baseUrl: provider.baseUrl, model: 'deepseek-flash', apiKey: provider.apiKey });
  }
  await withPlatformTransaction(async tx => {
    const role = await one(tx, sql`select menu_keys from app.system_roles where role_key='designer'`); originalDesignerMenus = role?.menu_keys as string[] | undefined;
    if (role) await tx.execute(sql`update app.system_roles set menu_keys=array_append(menu_keys,'construction-projects') where role_key='designer' and not ('construction-projects'=any(menu_keys))`);
    for (let i = 0; i < 2; i++) {
      const e = (await one(tx, sql`insert into app.enterprises(name,code,status) values(${prefix+i},${prefix+i},'active') returning id`))!; const eid = String(e.id); tenants.push(eid); admins.push([]);
      await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config)
        values(${eid},true,100,12000000,1000000000,30,'{"runtime":"langgraph-v1","providerKey":"deepseek","model":"deepseek-flash","tools":true,"imageInput":false,"probeVersion":"p2m0-synthetic-v1"}'::jsonb)`);
      const u = (await one(tx, sql`insert into app.users(nickname,context_version) values(${prefix+i},1) returning id`))!; users.push(String(u.id));
      await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${String(u.id)},${prefix+i})`);
      actors.push({ enterpriseId: eid, principal: { kind: 'user', userId: String(u.id) }, contextVersion: 1, capabilities: ['assistant.chat.self'] });
      const lead = (await one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source) values(${eid},${String(u.id)},'隔离施工客户','13800000000','natural') returning id`))!; leads.push(String(lead.id));
      for (let j = 0; j < 3; j++) {
        const a = (await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password,display_name)
          values(${eid},${prefix+i+j},'test-only',${j === 0 ? 'enterprise_admin' : 'designer'},'active',false,${'隔离员工'+j}) returning id`))!; admins[i].push(String(a.id));
      }
      services.push(new ConstructionService({ enterpriseId: eid, adminId: admins[i][0] }));
    }
  });
  for (const actor of actors) chats.push(String((await new ConversationService(actor).create(randomUUID())).id));
});
after(async () => {
  try {
    await withPlatformTransaction(async tx => {
      if (originalDesignerMenus) await tx.execute(sql`update app.system_roles set menu_keys=ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(originalDesignerMenus)}::jsonb)) where role_key='designer'`);
      for (const eid of tenants) {
        await deleteConstructionData(tx, BigInt(eid)); await deleteAssistantData(tx, BigInt(eid));
        await tx.execute(sql`delete from app.leads where enterprise_id=${eid}`);
        await tx.execute(sql`delete from app.admin_users where enterprise_id=${eid}`); await tx.execute(sql`delete from app.enterprises where id=${eid}`);
      }
      for (const uid of users) await tx.execute(sql`delete from app.users where id=${uid}`);
    });
  } finally { try { if (priorProvider) await savePlatformLlmConfig(priorProvider); } finally { await closePostgresPool(); } }
});
const exec = (action: string, body: Row = {}, requestKey = randomUUID(), tenant = 0) => services[tenant].execute(action, body, requestKey);
const detail = () => exec('detail', { projectId });
const projectVersion = async () => Number(((await detail()).project as Row).version);
const read = () => withTenantTransaction(tenants[0], tx => queryBusiness(tx, actors[0], { domain: 'construction', leadId: '' }));
const history = () => new ConversationService(actors[0]).messages(chats[0]);
const phone = (mid = noticeId) => new ConversationService(actors[0]).constructionContact(noticeChat || chats[0], projectId, mid);
const progress = async (stageKey: string, sendReminder = false, note = '') => exec('progress', { projectId, expectedVersion: await projectVersion(), stageKey, note, sendReminder });
const contact = async (stageKey: string, contactName: string, contactPhone: string) => {
  const aid = stageKey === 'utilities' ? admins[0][2] : admins[0][0];
  if (contactPhone) {
    await withPlatformTransaction(tx => tx.execute(sql`update app.admin_users set display_name=${contactName},phone=${contactPhone} where id=${aid}`));
    if (!(await detail()).members || !((await detail()).members as Row[]).some(m => m.admin_id === aid && m.active)) {
      await exec('member', { projectId, expectedVersion: await projectVersion(), adminId: aid, role: 'worker', active: true });
    }
  }
  return exec('contact', { projectId, expectedVersion: await projectVersion(), stageKey, staffIds: contactPhone ? [aid] : [], primaryStaffId: null });
};

test('project tenant/member scope, concurrent creation and foreign keys retain their existing boundaries', async () => {
  const body = { leadId: leads[0], name: '城西新家', managerId: admins[0][1], rooms: ['客厅','书房'] }, requestKey = randomUUID();
  const [a,b] = await Promise.all([exec('create', body, requestKey), exec('create', body, requestKey)]); assert.deepEqual(a,b); projectId = String(a.id);
  assert.equal(((await detail()).rooms as Row[]).length, 2);
  assert.equal((await new ConstructionService({ enterpriseId: tenants[0], adminId: admins[0][1] }).execute('detail', { projectId })).manage, true);
  await assert.rejects(new ConstructionService({ enterpriseId: tenants[0], adminId: admins[0][2] }).execute('detail', { projectId }), /not_found/);
  await assert.rejects(exec('detail', { projectId }, randomUUID(), 1), /not_found/);
  await assert.rejects(exec('create', { ...body, leadId: leads[1] }), /lead_unavailable/);
  await assert.rejects(exec('create', { ...body, managerId: admins[1][0] }), /staff_unavailable/);
  await assert.rejects(withPlatformTransaction(tx => tx.execute(sql`insert into app.construction_projects(enterprise_id,lead_id,name) values(${tenants[1]},${leads[0]},'bad')`)), (error: unknown) => (error as { cause?: { code?: string } }).cause?.code === '23503');
  assert.equal((await withTenantTransaction(tenants[1], tx => rows(tx, sql`select id from app.construction_projects where id=${projectId}`))).length, 0);
});
test('ten default stages are configurable by the tenant owner, with explicit reminder contents and optimistic versions', async () => {
  const initial = await exec('stages'); assert.equal((initial.stages as Row[]).length, 10);
  const stages = defaultConstructionStages.map(s => s.key === 'utilities' ? configured(s) : s);
  const body = { expectedVersion: initial.version, stages }, requestKey = randomUUID();
  const first = await exec('saveStages', body, requestKey); assert.deepEqual(await exec('saveStages', body, requestKey), first);
  await assert.rejects(exec('saveStages', body), /version_conflict/);
  await assert.rejects(new ConstructionService({ enterpriseId: tenants[0], adminId: admins[0][1] }).execute('saveStages', { ...body, expectedVersion: first.version }, randomUUID()), /forbidden/);
  await assert.rejects(exec('saveStages', { expectedVersion: first.version, stages: [{ ...stages[0], visitReminder: true }] }), /invalid_construction/);
  await contact('utilities', '水电王师傅', '13800000001'); await contact('painting', '油漆李师傅', '13800000002');
  const result = await read(); assert.match(result.displayText, /尚未标记/); assert.doesNotMatch(JSON.stringify(result), /1380000000/);
});
test('actual progress proactively produces one durable reminder, even without an earlier construction query', async () => {
  const body = { projectId, expectedVersion: await projectVersion(), stageKey: 'utilities', note: '当前进行水电施工。', sendReminder: false }, requestKey = randomUUID();
  const [a,b] = await Promise.all([exec('progress', body, requestKey), exec('progress', body, requestKey)]); assert.deepEqual(a,b);
  const messages = (await history()).items as Row[];
  const notice = messages.find(m => m.constructionReminder); assert.ok(notice); noticeId = String(notice.id);
  assert.match(JSON.stringify(notice.content), /水电阶段.*|核对插座使用位置/);
  assert.equal((notice.constructionContacts as Row[])[0].projectId, projectId);
  assert.equal((await phone()).phone, '13800000001');
  await progress('utilities', false, '当前进行水电施工。'); await history();
  assert.equal(Number((await withTenantTransaction(tenants[0], tx => one(tx, sql`select count(*) n from app.assistant_messages where enterprise_id=${tenants[0]} and purpose='construction.stage'`)))!.n), 1);
  await assert.rejects(exec('saveStages', { expectedVersion: (await exec('stages')).version, stages: defaultConstructionStages.filter(s => s.key !== 'utilities') }), /stage_in_use/);
});
test('the real worker serves visit requests and cancellations as stage/telephone queries, without booking writes', async () => {
  const chat = new ConversationService(actors[0]), cid = String((await chat.create(randomUUID())).id);
  for (const quote of ['周六想去看看', '取消到场安排']) {
    const sent = await chat.send(cid, randomUUID(), { version: 1, blocks: [{ type: 'text', text: quote }] });
    const lease = await claimJob(); assert.ok(lease); assert.equal(lease.runId, sent.runId);
    const response = (name: string, args: unknown): ModelTurnOutput => ({ text: '', toolCalls: [{ id: 'call-'+name, name, arguments: JSON.stringify(args) }], usage: { inputTokens: 10, outputTokens: 10 }, finishReason: 'tool_calls', providerRequestId: null });
    await processAgentAnswer(lease, { model: async (messages, tools, turn) => {
      assert.ok(!tools.some(t => t.name === 'request_visit')); assert.ok(tools.some(t => t.name === 'query_business'));
      if (turn === 0) return response('query_business', { domain: 'construction', leadId: '' });
      const result = JSON.parse(String(messages[messages.length-1].content));
      return response('final_response', { kind: 'business', resultKey: result.resultKey });
    } });
    const run = await chat.run(String(sent.runId)); assert.equal(run.status, 'succeeded', JSON.stringify(run));
    const answer = ((await chat.messages(cid)).items as Row[]).find(m => m.id === run.outputMessageId)!;
    assert.match(JSON.stringify(answer.content), /电话沟通/); assert.doesNotMatch(JSON.stringify(answer.content), /待团队确认|意向已记录|已取消/);
    assert.equal((await chat.constructionContact(cid, projectId, String(answer.id))).phone, '13800000001');
  }
  for (const table of ['construction_visits', 'measurement_appointments']) assert.equal(Number((await withTenantTransaction(tenants[0], tx => one(tx, sql`select count(*) n from ${sql.raw('app.'+table)} where enterprise_id=${tenants[0]}`)))!.n), 0);
});
test('configured DeepSeek model returns current nodes and phone contact for visit requests/cancellations', { skip: !live }, async () => {
  const chat = new ConversationService(actors[0]), cid = String((await chat.create(randomUUID())).id);
  for (const quote of ['现在工地到哪个节点了？', '我周日想去现场看看', '取消到场安排']) {
    const sent = await chat.send(cid, randomUUID(), { version: 1, blocks: [{ type: 'text', text: quote }] });
    const lease = await claimJob(); assert.ok(lease); assert.equal(lease.runId, sent.runId); await processAgentAnswer(lease);
    const run = await chat.run(String(sent.runId));
    const steps = await withTenantTransaction(tenants[0], tx => rows(tx, sql`select step_seq,capability_name,status from app.assistant_run_steps where enterprise_id=${tenants[0]} and run_id=${String(sent.runId)} order by step_seq`));
    assert.equal(run.status, 'succeeded', JSON.stringify({ run, steps }));
    const answer = ((await chat.messages(cid)).items as Row[]).find(m => m.id === run.outputMessageId)!;
    assert.match(JSON.stringify(answer.content), /水电|电话沟通/);
    assert.doesNotMatch(JSON.stringify(answer.content), /待团队确认|意向已记录|已取消/);
  }
  assert.equal(Number((await withTenantTransaction(tenants[0], tx => one(tx, sql`select count(*) n from app.construction_visits where enterprise_id=${tenants[0]}`)))!.n), 0);
});
test('phone changes resolve live; moving stages invalidates old reminders and configuration changes require explicit resend', async () => {
  const old = await read(); await contact('utilities', '水电张师傅', '13800000003');
  assert.equal((await phone()).phone, '13800000003');
  assert.equal(await withTenantTransaction(tenants[0], tx => businessSnapshotAvailable(tx, tenants[0], old)), false);
  await progress('painting'); await assert.rejects(phone(), /contact_unavailable/);
  assert.equal(await withTenantTransaction(tenants[0], tx => constructionNoticeAvailable(tx, tenants[0], chats[0], noticeId)), false);
  const settings = await exec('stages'); const stages = (settings.stages as ConstructionStage[]).map(s => s.key === 'painting' ? configured(s) : s);
  await exec('saveStages', { expectedVersion: settings.version, stages });
  await progress('painting', true, '当前进行油漆施工。');
  const destination = await withTenantTransaction(tenants[0], tx => one(tx, sql`select id,conversation_id from app.assistant_messages where enterprise_id=${tenants[0]} and purpose='construction.stage' order by id desc limit 1`));
  assert.ok(destination); noticeChat = String(destination.conversation_id);
  const latest = ((await new ConversationService(actors[0]).messages(noticeChat)).items as Row[]).find(m => m.id === String(destination.id)); assert.ok(latest?.constructionReminder); noticeId = String(latest.id);
  assert.equal((await phone()).phone, '13800000002');
  await contact('painting', '', ''); await assert.rejects(phone(), /contact_unavailable/);
  await contact('painting', '油漆李师傅', '13800000002');
});
test('paused projects, revoked access, member removal and lead reassignment prevent historical phone/data access', async () => {
  const set = async (status: string, customerAccess: boolean) => exec('update', { projectId, expectedVersion: await projectVersion(), name: '城西新家', status, customerAccess });
  await set('paused', true); await assert.rejects(phone(), /contact_unavailable/); await assert.rejects(progress('utilities'), /inactive/);
  await set('active', false); await assert.rejects(phone(), /contact_unavailable/); assert.match((await read()).displayText, /没有查到/);
  await set('active', true);
  await exec('member', { projectId, expectedVersion: await projectVersion(), adminId: admins[0][0], role: 'manager', active: true });
  await exec('member', { projectId, expectedVersion: await projectVersion(), adminId: admins[0][1], role: 'manager', active: false });
  await assert.rejects(new ConstructionService({ enterpriseId: tenants[0], adminId: admins[0][1] }).execute('detail', { projectId }), /not_found/);
  await assert.rejects(new ConversationService(actors[1]).constructionContact(chats[0], projectId, noticeId), /not_found/);
  await withPlatformTransaction(tx => tx.execute(sql`update app.leads set customer_user_id=${users[1]} where enterprise_id=${tenants[0]} and id=${leads[0]}`));
  await assert.rejects(phone(), /contact_unavailable/); assert.match((await read()).displayText, /没有查到/);
  await withPlatformTransaction(tx => tx.execute(sql`update app.leads set customer_user_id=${users[0]} where enterprise_id=${tenants[0]} and id=${leads[0]}`));
});
test('reminders persist without an open chat and are delivered once when the customer returns', async () => {
  const chat = new ConversationService(actors[1]); const c = await chat.detail(chats[1]); await chat.archive(chats[1], Number(c.version), randomUUID());
  const create = await exec('create', { leadId: leads[1], name: '隔离新家', managerId: admins[1][0], rooms: [] }, randomUUID(), 1);
  const pid = String(create.id), settings = await exec('stages', {}, randomUUID(), 1);
  await exec('saveStages', { expectedVersion: settings.version, stages: defaultConstructionStages.map(s => s.key === 'utilities' ? configured(s) : s) }, randomUUID(), 1);
  await withPlatformTransaction(tx => tx.execute(sql`update app.admin_users set phone='13800000009' where id=${admins[1][0]}`));
  await exec('contact', { projectId: pid, expectedVersion: 1, stageKey: 'utilities', staffIds: [admins[1][0]], primaryStaffId: null }, randomUUID(), 1);
  await exec('progress', { projectId: pid, expectedVersion: 2, stageKey: 'utilities', note: '', sendReminder: false }, randomUUID(), 1);
  assert.equal(((await chat.messages(chats[1])).items as Row[]).filter(m => m.constructionReminder).length, 0);
  const cid = String((await chat.create(randomUUID())).id);
  assert.equal(((await chat.messages(cid)).items as Row[]).filter(m => m.constructionReminder).length, 1);
  assert.equal(((await chat.messages(cid)).items as Row[]).filter(m => m.constructionReminder).length, 1);
  const other = String((await chat.create(randomUUID())).id); assert.equal(((await chat.messages(other)).items as Row[]).filter(m => m.constructionReminder).length, 0);
});
test('HTTP retires booking/plan writes, rejects scope injection and rechecks current cookie roles', async () => {
  const token = await new SignJWT({ id: admins[0][0], role: 'enterprise_admin', enterpriseId: tenants[0], permissions: ['construction-projects'], mustChangePassword: false }).setProtectedHeader({ alg: 'HS256' }).setSubject(admins[0][0]).setIssuedAt().setExpirationTime('10m').sign(new TextEncoder().encode(process.env.JWT_SECRET));
  const headers = { cookie: 'auth_token='+token }, url = 'http://localhost:3006/api/construction/';
  const response = await GET(new NextRequest(url+'projects/'+projectId, { headers }), { params: Promise.resolve({ path: ['projects',projectId] }) }); assert.equal(response.status, 200);
  for (const action of ['visit', 'plan']) {
    const retired = await POST(new NextRequest(url+'projects/'+projectId+'/'+action, { method: 'POST', headers, body: '{}' }), { params: Promise.resolve({ path: ['projects',projectId,action] }) }); assert.equal(retired.status, 404);
    await assert.rejects(exec(action, { projectId }), /not_found/);
  }
  const injection = await PATCH(new NextRequest(url+'stages', { method: 'PATCH', headers: { ...headers, 'Idempotency-Key': randomUUID() }, body: JSON.stringify({ enterpriseId: tenants[1] }) }), { params: Promise.resolve({ path: ['stages'] }) }); assert.equal(injection.status, 422);
  await withPlatformTransaction(tx => tx.execute(sql`update app.admin_users set status='disabled' where id=${admins[0][0]}`));
  const denied = await GET(new NextRequest(url+'projects/'+projectId, { headers }), { params: Promise.resolve({ path: ['projects',projectId] }) }); assert.equal(denied.status, 403);
  await withPlatformTransaction(tx => tx.execute(sql`update app.admin_users set status='active' where id=${admins[0][0]}`));
});
test('enterprise reset and purge include stage configuration and preserve the other tenant', async () => {
  await withPlatformTransaction(async tx => {
    const repository = new TenantEnterpriseResetRepository(tx), preview = await repository.preview(BigInt(tenants[1]), BigInt(admins[1][0]));
    assert.ok(preview.counts.some(c => c.table === 'construction_projects' && c.count === 1));
    assert.ok(preview.counts.some(c => c.table === 'construction_stage_settings' && c.count === 1));
    await repository.execute(BigInt(tenants[1]), BigInt(admins[1][0]));
    assert.equal((await rows(tx, sql`select enterprise_id from app.construction_stage_settings where enterprise_id=${tenants[1]}`)).length, 0);
    assert.ok(await one(tx, sql`select id from app.construction_projects where enterprise_id=${tenants[0]} and id=${projectId}`));
    assert.equal((await repository.purge(BigInt(tenants[1]))).enterpriseDeleted, true);
  });
});
