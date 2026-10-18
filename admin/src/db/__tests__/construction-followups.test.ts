import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { deleteConstructionData } from '@/db/repositories/construction-cleanup';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { ConstructionService } from '@/lib/construction/service';
import { defaultConstructionStages, type NeedFollowUp } from '@/lib/construction/stages';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { RequirementService } from '@/lib/assistant/requirements/service';
import { HandoffService } from '@/lib/assistant/handoff/service';
import { AssistantMediaService } from '@/lib/assistant/media/service';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { processAgentAnswer } from '@/lib/assistant/agent/worker';
import { readMemory } from '@/lib/assistant/agent/memory';
import type { ActorContext } from '@/lib/assistant/contracts';
import type { ModelTurnOutput } from '@/lib/assistant/contracts/model';
import { getPlatformLlmRuntimeConfig, savePlatformLlmConfig } from '@/lib/platform-llm-config';

const prefix = 'stage-needs-' + randomUUID();
let eid: string, uid: string, ownerId: string, designerId: string, workerId: string, service: ConstructionService;
let priorProvider: Awaited<ReturnType<typeof getPlatformLlmRuntimeConfig>> | undefined;
const live = process.env.CONSTRUCTION_LIVE_MODEL === '1';
const prompt: NeedFollowUp = { field: 'devices', room: '书房', question: '书房需要预留哪些设备的插座？' };
const response = (name: string, args: unknown): ModelTurnOutput => ({ text: '', toolCalls: [{ id: 'call-' + name, name, arguments: JSON.stringify(args) }],
  usage: { inputTokens: 20, outputTokens: 20 }, finishReason: 'tool_calls', providerRequestId: null });
before(async () => {
  const url = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.equal(url.port, '55432'); assert.equal(url.pathname, '/xiaok_embedding_eval');
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
    eid = String((await one(tx, sql`insert into app.enterprises(name,code,status) values(${prefix},${prefix},'active') returning id`))!.id);
    uid = String((await one(tx, sql`insert into app.users(nickname,context_version) values(${prefix},1) returning id`))!.id);
    await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${uid},${prefix})`);
    await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config)
      values(${eid},true,100,12000000,1000000000,30,'{"runtime":"langgraph-v1","providerKey":"deepseek","model":"deepseek-flash","tools":true,"imageInput":false,"probeVersion":"p2m0-synthetic-v1"}'::jsonb)`);
    const ids: string[] = [];
    for (const role of ['enterprise_admin','designer','construction_staff']) ids.push(String((await one(tx, sql`insert into app.admin_users
      (enterprise_id,username,password_hash,role,status,must_change_password,display_name)
      values(${eid},${prefix + role},'test-only',${role},'active',false,${role}) returning id`))!.id));
    [ownerId, designerId, workerId] = ids;
  });
  service = new ConstructionService({ enterpriseId: eid, adminId: ownerId });
});
after(async () => {
  try {
    if (eid) await withPlatformTransaction(async tx => {
      await deleteConstructionData(tx, BigInt(eid)); await deleteAssistantData(tx, BigInt(eid));
      await tx.execute(sql`delete from app.leads where enterprise_id=${eid}`);
      await tx.execute(sql`delete from app.admin_users where enterprise_id=${eid}`);
      await tx.execute(sql`delete from app.enterprises where id=${eid}`);
      if (uid) await tx.execute(sql`delete from app.users where id=${uid}`);
    });
  } finally { try { if (priorProvider) await savePlatformLlmConfig(priorProvider); } finally { await closePostgresPool(); } }
});
const execute = (action: string, input: Row = {}, key = randomUUID()) => service.execute(action, input, key);
const staff = (adminId: string) => new HandoffService({ enterpriseId: eid, principal: { kind: 'admin', adminId }, contextVersion: 0, capabilities: ['assistant.handoff.staff'] });
async function setup(followUps: NeedFollowUp[] = [prompt]) {
  const leadId = await withTenantTransaction(eid, async tx => String((await one(tx, sql`insert into app.leads
    (enterprise_id,customer_user_id,name,phone,source) values(${eid},${uid},'补问客户','13800000000','natural') returning id`))!.id));
  const projectId = String((await execute('create', { leadId, name: '补问新家', managerId: designerId, rooms: ['书房','客厅'] })).id);
  const actor: ActorContext = { enterpriseId: eid, principal: { kind: 'user', userId: uid }, contextVersion: 1,
    capabilities: ['assistant.chat.self'], entry: { kind: 'lead', id: leadId } };
  const chat = new ConversationService(actor), cid = String((await chat.create(randomUUID())).id);
  const settings = await execute('stages');
  await execute('saveStages', { expectedVersion: settings.version, stages: defaultConstructionStages.map(s => s.key === 'utilities' ? { ...s, followUps } : s) });
  const detail = () => execute('detail', { projectId });
  const progress = async (stageKey = 'utilities', note = '') => execute('progress', { projectId, expectedVersion: Number(((await detail()).project as Row).version), stageKey, note, sendReminder: false });
  const messages = async () => (await chat.messages(cid)).items as Row[];
  const notices = () => withTenantTransaction(eid, tx => rows(tx, sql`select m.* from app.assistant_messages m join app.domain_event_outbox e on e.enterprise_id=m.enterprise_id and e.id=m.source_event_id
    where m.enterprise_id=${eid} and m.purpose='construction.followup' and e.payload->>'projectId'=${projectId} order by m.id`));
  const answer = async (text: string, model: NonNullable<Parameters<typeof processAgentAnswer>[1]>['model'] = async () => response('final_response', { kind: 'general', text: '我们可以继续聊您关心的事。' })) => {
    const sent = await chat.send(cid, randomUUID(), { version: 1, blocks: [{ type: 'text', text }] });
    const lease = await claimJob(); assert.ok(lease); assert.equal(lease.runId, sent.runId);
    await processAgentAnswer(lease, { model });
    return { sent, run: await chat.run(String(sent.runId)) };
  };
  return { leadId, projectId, actor, chat, cid, detail, progress, messages, notices, answer };
}

test('a real stage selects one missing need, skips known uncertainty and stays deduplicated across reentry and other chats', async () => {
  const x = await setup([{ field: 'budget', room: '', question: '预算有什么想法？' }, prompt, { ...prompt, room: '客厅', question: '客厅需要哪些设备？' }]);
  assert.equal((await x.answer('预算暂时没定，先聊书房。')).run.status, 'succeeded');
  await x.progress();
  assert.equal((await x.notices()).length, 1);
  assert.match(JSON.stringify((await x.notices())[0].content), /书房需要预留/);
  assert.doesNotMatch(JSON.stringify((await x.notices())[0].content), /预算有什么想法/);
  const [visible] = await Promise.all([x.messages(), x.messages()]);
  const questionId = String((await x.notices())[0].id), question = visible.find(m => m.id === questionId)!;
  assert.equal(question.constructionFollowUp, true); assert.equal(question.constructionReminder, false);
  assert.deepEqual(question.constructionContacts, []);
  const other = String((await x.chat.create(randomUUID())).id); await x.chat.messages(other);
  await x.progress(); await x.messages();
  assert.equal((await x.notices()).length, 1);
  assert.equal((await withTenantTransaction(eid, tx => rows(tx, sql`select id from app.assistant_messages where enterprise_id=${eid} and conversation_id=${x.cid} and purpose='construction.stage'`))).length, 0);
});
test('an explicit reply reaches durable sourced memory and the original staff review flow without formal approval', async () => {
  const x = await setup(); await x.progress();
  const text = '书房需要电脑和打印机的插座';
  const { sent, run } = await x.answer(text, async (messages, tools, turn) => {
    assert.match(JSON.stringify(messages), /书房需要预留哪些设备/);
    if (turn === 0) {
      assert.ok(tools.some(t => t.name === 'record_need'));
      return response('record_need', { room: '书房', field: 'devices', quote: text, value: '需要电脑和打印机的插座' });
    }
    return response('final_response', { kind: 'general', text: '已记录书房的设备需求，后续由设计师核对。' });
  });
  assert.equal(run.status, 'succeeded', JSON.stringify(run));
  const memory = readMemory((await withTenantTransaction(eid, tx => one(tx, sql`select entry_snapshot from app.assistant_conversations where enterprise_id=${eid} and id=${x.cid}`)))!.entry_snapshot);
  assert.equal(memory.facts[0].sourceMessageId, sent.messageId); assert.equal(memory.facts[0].room, '书房');
  await new HandoffService(x.actor).customerWrite(x.cid, randomUUID(), { action: 'request', recipientId: designerId });
  const designer = staff(designerId); await designer.staffWrite(x.cid, randomUUID(), { action: 'claim' });
  const packet = await designer.staffRead(x.cid);
  assert.match(JSON.stringify(packet), /电脑和打印机/);
  await designer.staffWrite(x.cid, randomUUID(), { action: 'correct', field: 'devices', text, sourceMessageId: sent.messageId, expectedVersion: packet.version });
  assert.match(JSON.stringify(await designer.staffRead(x.cid)), /corrections/);
  assert.equal(Number((await withTenantTransaction(eid, tx => one(tx, sql`select count(*) n from app.assistant_requirement_summaries where enterprise_id=${eid} and conversation_id=${x.cid} and status='confirmed'`)))!.n), 0);
  await assert.rejects(staff(workerId).staffRead(x.cid), /forbidden|not_found/);
  await new HandoffService(x.actor).customerWrite(x.cid, randomUUID(), { action: 'end' });
  await assert.rejects(designer.staffRead(x.cid), /context_changed|not_found/);
});
test('okay and direct photos remain unapproved working material, with consent-scoped staff access', async () => {
  const x = await setup(); await x.progress();
  assert.equal((await x.answer('可以，先聊别的。')).run.status, 'succeeded');
  assert.equal((await new RequirementService(x.actor).read(x.cid)).confirmed, null);
  const bytes = await sharp({ create: { width: 80, height: 80, channels: 3, background: '#eeeeee' } }).png().toBuffer();
  const media = await new AssistantMediaService(x.actor).upload(x.cid, randomUUID(), bytes, 'image', '');
  assert.ok(media.id);
  await new HandoffService(x.actor).customerWrite(x.cid, randomUUID(), { action: 'request', recipientId: designerId });
  await staff(designerId).staffWrite(x.cid, randomUUID(), { action: 'claim' });
  const staffActor: ActorContext = { enterpriseId: eid, principal: { kind: 'admin', adminId: designerId }, contextVersion: 0, capabilities: ['assistant.handoff.staff'] };
  assert.ok((await new AssistantMediaService(staffActor).read(x.cid, String(media.id))).data.length);
  await new HandoffService(x.actor).customerWrite(x.cid, randomUUID(), { action: 'end' });
  await assert.rejects(new AssistantMediaService(staffActor).read(x.cid, String(media.id)), /not_found/);
});
test('waiting/human conversations are not interrupted, and latest-stage followups survive return to AI', async () => {
  const x = await setup(); const customer = new HandoffService(x.actor);
  await customer.customerWrite(x.cid, randomUUID(), { action: 'request', recipientId: designerId });
  await x.progress(); assert.equal((await x.notices()).length, 0);
  await staff(designerId).staffWrite(x.cid, randomUUID(), { action: 'claim' });
  await x.messages(); assert.equal((await x.notices()).length, 0);
  await customer.customerWrite(x.cid, randomUUID(), { action: 'end' });
  await x.messages(); await x.messages(); assert.equal((await x.notices()).length, 1);
});
test('a generic multi-home chat neither guesses a project nor consumes its later scoped question', async () => {
  const x = await setup(); await x.chat.archive(x.cid, Number((await x.chat.detail(x.cid)).version), randomUUID());
  const generic = new ConversationService({ ...x.actor, entry: undefined }), cid = String((await generic.create(randomUUID())).id);
  await x.progress(); await generic.messages(cid); assert.equal((await x.notices()).length, 0);
  const scoped = String((await x.chat.create(randomUUID())).id); await x.chat.messages(scoped);
  assert.equal((await x.notices()).length, 1);
});
test('source changes during a model call fence late replies and invalidate derived history', async () => {
  const x = await setup(); await x.progress();
  const first = await x.answer('我再想想。'); assert.equal(first.run.status, 'succeeded');
  const { run } = await x.answer('还在想。', async () => {
    await x.progress('painting');
    return response('final_response', { kind: 'general', text: '我们接着聊。' });
  });
  assert.equal(run.status, 'failed');
  const messages = await x.messages();
  assert.equal(messages.find(m => m.id === first.run.outputMessageId)?.available, false);
  const notice = (await x.notices())[0]; assert.equal(messages.find(m => m.id === String(notice.id))?.available, false);
  await x.progress('utilities'); await x.messages(); assert.equal((await x.notices()).length, 1);
});
test('paused or revoked projects and foreign tenants cannot read a current followup', async () => {
  const x = await setup(); await x.progress();
  const notice = (await x.notices())[0];
  const update = async (status: string, customerAccess: boolean) => execute('update', { projectId: x.projectId, expectedVersion: Number(((await x.detail()).project as Row).version), name: '补问新家', status, customerAccess });
  await update('paused', true); assert.equal((await x.messages()).find(m => m.id === String(notice.id))?.available, false);
  await update('active', false); assert.equal((await x.messages()).find(m => m.id === String(notice.id))?.available, false);
  await assert.rejects(new ConversationService({ ...x.actor, enterpriseId: '1' }).messages(x.cid), /not_found|identity|enterprise|disabled/);
});
test('only actual project rooms are questioned and room/configuration changes revoke prior sources', async () => {
  const x = await setup([{ ...prompt, room: '不存在房间', question: '不存在房间需要哪些设备？' }, prompt]); await x.progress();
  const notice = (await x.notices())[0]; assert.ok(notice); assert.match(JSON.stringify(notice.content), /书房需要预留/);
  const detail = await x.detail(), room = (detail.rooms as Row[]).find(r => r.name === '书房')!;
  await execute('room', { projectId: x.projectId, expectedVersion: Number((detail.project as Row).version), roomId: String(room.id), name: '工作间' });
  assert.equal((await x.messages()).find(m => m.id === String(notice.id))?.available, false);
  const settings = await execute('stages');
  await execute('saveStages', { expectedVersion: settings.version, stages: defaultConstructionStages });
  await x.messages(); assert.equal((await x.notices()).length, 1);
});
test('configured DeepSeek continues the real stage question and records only explicit working needs', { skip: !live }, async () => {
  const x = await setup(); await x.progress();
  for (const text of ['请记住，书房需要电脑和打印机的插座。', '这不代表我同意增加费用，先聊别的。']) {
    const sent = await x.chat.send(x.cid, randomUUID(), { version: 1, blocks: [{ type: 'text', text }] });
    const lease = await claimJob(); assert.ok(lease); assert.equal(lease.runId, sent.runId);
    await processAgentAnswer(lease);
    const run = await x.chat.run(String(sent.runId)); assert.equal(run.status, 'succeeded', JSON.stringify(run));
  }
  const memory = readMemory((await withTenantTransaction(eid, tx => one(tx, sql`select entry_snapshot from app.assistant_conversations where enterprise_id=${eid} and id=${x.cid}`)))!.entry_snapshot);
  assert.ok(memory.facts.some(f => f.room === '书房' && /电脑|打印机/.test(f.value)));
  assert.equal((await new RequirementService(x.actor).read(x.cid)).confirmed, null);
  assert.equal((await x.notices()).length, 1);
});
