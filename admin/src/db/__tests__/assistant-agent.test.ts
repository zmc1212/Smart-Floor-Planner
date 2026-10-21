import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { ConversationService, appendMessage } from '@/lib/assistant/core/conversation';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { processAgentAnswer, agentNeedBatchProtocol } from '@/lib/assistant/agent/worker';
import { HandoffService } from '@/lib/assistant/handoff/service';
import type { ActorContext } from '@/lib/assistant/contracts';
import type { ModelTurnOutput } from '@/lib/assistant/contracts/model';
import { readMemory, type NeedFact, type NeedMemory } from '@/lib/assistant/agent/memory';
import sharp from 'sharp';
import { AssistantMediaService } from '@/lib/assistant/media/service';
import { getPlatformLlmRuntimeConfig, savePlatformLlmConfig } from '@/lib/platform-llm-config';

const prefix = 'p2m-' + randomUUID(), tenants: string[] = [], users: string[] = [];
let actor: ActorContext, stranger: ActorContext;
const deepseekLive = process.env.ASSISTANT_P2M_DEEPSEEK_PROBE === '1' && process.env.ASSISTANT_P2M_LIVE === '1';
const config = { runtime: 'langgraph-v1', model: deepseekLive ? 'deepseek-flash' : 'Qwen/Qwen3.5-4B', providerKey: deepseekLive ? 'deepseek' : 'siliconflow', imageInput: true, tools: true, probeVersion: 'p2m0-synthetic-v1' };
let priorProvider: Awaited<ReturnType<typeof getPlatformLlmRuntimeConfig>> | undefined;
const response = (text = '可以先考虑靠窗摆桌，并保留走道。'): ModelTurnOutput => ({ text: JSON.stringify({ kind: 'general', text }), toolCalls: [], usage: { inputTokens: 100, outputTokens: 20 }, finishReason: 'stop', providerRequestId: null });
before(async () => {
  const url = new URL(resolvePostgresRuntimeConfig().connectionString); assert.equal(url.port, '55432'); assert.equal(url.pathname, '/xiaok_embedding_eval');
  if (deepseekLive) {
    const primary = new URL(process.env.ASSISTANT_P2M_PRIMARY_DATABASE_URL || '');
    assert.ok(['localhost','127.0.0.1'].includes(primary.hostname)); assert.equal(primary.port, '5432'); assert.equal(primary.pathname, '/smart_floor_planner');
    const evaluationUrl = process.env.DATABASE_URL;
    await closePostgresPool();
    let provider: Awaited<ReturnType<typeof getPlatformLlmRuntimeConfig>>;
    try { process.env.DATABASE_URL = primary.toString(); provider = await getPlatformLlmRuntimeConfig(); }
    finally { await closePostgresPool(); process.env.DATABASE_URL = evaluationUrl; }
    assert.equal(provider.providerKey, 'deepseek'); assert.equal(new URL(provider.baseUrl).origin, 'https://api.deepseek.com');
    priorProvider = await getPlatformLlmRuntimeConfig();
    await savePlatformLlmConfig({ enabled: true, providerKey: 'deepseek', baseUrl: provider.baseUrl, model: 'deepseek-flash', apiKey: provider.apiKey });
  }
  await withPlatformTransaction(async tx => {
    for (let i = 0; i < 2; i++) {
      const e = (await one(tx, sql`insert into app.enterprises(name,code,status) values(${prefix+i},${prefix+i},'active') returning id`))!; tenants.push(String(e.id));
      await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config)
        values(${tenants[i]},true,1000,12000000,1000000000,30,${JSON.stringify(config)}::jsonb)`);
      const u = (await one(tx, sql`insert into app.users(nickname,context_version) values(${prefix+i},1) returning id`))!; users.push(String(u.id));
      await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${users[i]},${prefix+i})`);
    }
  });
  actor = { enterpriseId: tenants[0], principal: { kind: 'user', userId: users[0] }, contextVersion: 1, capabilities: ['assistant.chat.self'] };
  stranger = { ...actor, enterpriseId: tenants[1], principal: { kind: 'user', userId: users[1] } };
});
after(async () => {
  try { await withPlatformTransaction(async tx => { for (const t of tenants) { await deleteAssistantData(tx, BigInt(t)); await tx.execute(sql`delete from app.enterprises where id=${t}`); }
    for (const u of users) await tx.execute(sql`delete from app.users where id=${u}`); });
  } finally { try { if (priorProvider) await savePlatformLlmConfig(priorProvider); } finally { await closePostgresPool(); } }
});
async function start(text = '小书房怎样摆桌？', conversationId?: string) {
  const chat = new ConversationService(actor), c = conversationId || String((await chat.create(randomUUID())).id);
  const sent = await chat.send(c, randomUUID(), { version: 1, blocks: [{ type: 'text', text }] });
  const lease = await claimJob(); assert.ok(lease); assert.equal(lease.runId, sent.runId);
  return { chat, c, sent, lease };
}
async function diagnostic(runId: string) {
  return withTenantTransaction(actor.enterpriseId, tx => rows(tx, sql`select kind,status,private_checkpoint->'text' as output,private_checkpoint->'toolCalls' as calls
    from app.assistant_run_steps where run_id=${runId} and kind='agent_model' order by step_seq`));
}
test('named original bypass drafts are blocked before delivery and a real empty read closes once without writes', async () => {
  const question = '合成点位说明第二节如何区分方案同意和关闭？';
  for (const text of [
    '方案同意和关闭是两个不同的阶段：方案同意是客户对团队提供的具体版本（如V3、V4）表示认可，但并不意味着现场已落实或事项已解决；关闭则是团队正式回传该事项已解决、有现场落实证据或客户已明确决定，并通知客户可以关闭。方案同意不等于现场落实，现场落实不等于正式关闭。',
    '方案同意和关闭是两个不同的业务状态：\n\n1. 方案同意：客户对某个版本（如V3或V4）表示认可，但这仅代表客户对方案内容的认可，并不代表该方案已经实施或验收通过。\n\n2. 关闭：通常指某个事项或阶段已经按照既定流程完成，包括现场落实、验收通过、费用结算等。关闭意味着该事项或阶段已经正式结束，不再需要进一步跟进。\n\n在实际操作中，方案同意并不等同于关闭，需要按照既定流程进行后续操作，如现场落实、验收等，才能正式关闭。',
  ]) for (const mode of ['text', 'final_tool', 'unoffered_read']) {
    const a = await start(question); let calls = 0;
    await processAgentAnswer(a.lease, { model: async (_messages, _tools, _turn, dispatch) => {
      calls++; assert.deepEqual(dispatch!.map(t => t.name), ['search_knowledge']);
      if (mode === 'text') return response(text);
      return { ...response(), text: '', toolCalls: [{ id: 'bypass', name: mode === 'final_tool' ? 'final_response' : 'query_materials',
        arguments: mode === 'final_tool' ? JSON.stringify({ kind: 'general', text }) : '{"leadId":"","room":""}' }] };
    } });
    const run = await a.chat.run(a.lease.runId);
    assert.equal(run.status, 'failed'); assert.equal(calls, 1);
    assert.equal(run.outputMessageId, null);
    const steps = await diagnostic(a.lease.runId); assert.equal(steps.length, 1);
    const stored = await withTenantTransaction(actor.enterpriseId, tx => one(tx, sql`select error_code from app.assistant_runs where id=${a.lease.runId}`));
    assert.equal(stored?.error_code, 'source_read_required');
    assert.ok(!(await a.chat.messages(a.c)).items.some(m => m.authorKind === 'assistant'));
    const effects = await withTenantTransaction(actor.enterpriseId, tx => rows(tx, sql`select kind from app.assistant_run_steps where enterprise_id=${actor.enterpriseId} and run_id=${a.lease.runId} and kind in ('retrieval','agent_business','agent_need_write','agent_validation')`));
    assert.deepEqual(effects, []);
  }
  const a = await start(question); let calls = 0;
  await processAgentAnswer(a.lease, { model: async (messages, _tools, _turn, dispatch) => {
    if (++calls === 1) {
      assert.deepEqual(dispatch!.map(t => t.name), ['search_knowledge']);
      return { ...response(), text: '', toolCalls: [{ id: 'original-read', name: 'search_knowledge', arguments: '{"query":"合成点位说明 第二节 方案同意 关闭"}' }] };
    }
    assert.ok(dispatch!.some(t => t.name === 'final_response'));
    const packet = JSON.parse((messages.findLast(m => m.role === 'tool') as {content:string}).content);
    assert.equal(packet.knowledgeStatus, 'not_ready'); assert.deepEqual(packet.synthesisSources, []);
    return { ...response(), text: JSON.stringify({ kind: 'synthesis', segments: [{ basis: 'uncertainty', text: '本次尚未取得这份说明的可用原文，无法据此区分两种状态。', citations: [] }] }) };
  } });
  assert.equal((await a.chat.run(a.lease.runId)).status, 'succeeded'); assert.equal(calls, 2);
  const reentry = await new ConversationService(actor).messages(a.c);
  assert.ok(reentry.items.some(m => m.authorKind === 'assistant'));
  const effects = await withTenantTransaction(actor.enterpriseId, tx => rows(tx, sql`select kind,count(*)::int count from app.assistant_run_steps where enterprise_id=${actor.enterpriseId} and run_id=${a.lease.runId} and kind in ('retrieval','agent_need_write','agent_validation') group by kind`));
  assert.deepEqual(effects.map(e => [e.kind,e.count]), [['retrieval',1]]);
  const stored = await withTenantTransaction(actor.enterpriseId, tx => one(tx, sql`select entry_snapshot from app.assistant_conversations where id=${a.c}`));
  assert.equal(readMemory(stored?.entry_snapshot).facts.length, 0);
  await assert.rejects(new ConversationService(stranger).messages(a.c), /assistant_resource_not_found/);
  // The source-read gate must not redirect an unrelated current-budget read
  // into enterprise knowledge or resurrect a withdrawn saved original.
  const saved = await start('请记录：全屋预算18万元。');
  await processAgentAnswer(saved.lease, { model: async () => ({ ...response(), text: '', toolCalls: [{ id: 'budget-save', name: 'record_need',
    arguments: '{"room":"全屋","field":"budget","value":"18万元","quote":"全屋预算18万元","additionalNeeds":[]}' }] }) });
  assert.equal((await saved.chat.run(saved.lease.runId)).status, 'succeeded');
  const questionBudget = '只回顾聊天原话：现在记住的预算是多少？';
  const recap = await start(questionBudget, saved.c);
  await processAgentAnswer(recap.lease, { model: async (_messages, tools, _turn, dispatch) => {
    assert.deepEqual(tools.map(t => t.name), ['recall_history']);
    assert.ok(dispatch!.some(t => t.name === 'final_response'));
    return response('当前记住的预算是18万元。');
  } });
  const recapRun = await saved.chat.run(recap.lease.runId); assert.equal(recapRun.status, 'succeeded');
  await withTenantTransaction(actor.enterpriseId, tx => tx.execute(sql`update app.assistant_messages set content='{"version":1,"blocks":[{"type":"text","text":"合成预算原话撤回"}]}'::jsonb where enterprise_id=${actor.enterpriseId} and conversation_id=${saved.c} and id=${saved.sent.messageId}`));
  assert.equal((await saved.chat.messages(saved.c)).items.find(m => m.id === recapRun.outputMessageId)!.available, false);
  const withdrawn = await start(questionBudget, saved.c);
  await processAgentAnswer(withdrawn.lease, { model: async (messages, tools, _turn, dispatch) => {
    assert.deepEqual(tools.map(t => t.name), ['recall_history']); assert.doesNotMatch(JSON.stringify(messages), /18万元/);
    assert.ok(dispatch!.some(t => t.name === 'final_response'));
    return response('本次无法确认当前预算。');
  } });
  assert.equal((await saved.chat.run(withdrawn.lease.runId)).status, 'succeeded');
  const writes = await withTenantTransaction(actor.enterpriseId, tx => rows(tx, sql`select kind from app.assistant_run_steps where enterprise_id=${actor.enterpriseId} and run_id in (${recap.lease.runId},${withdrawn.lease.runId}) and kind in ('agent_need_write','retrieval')`));
  assert.deepEqual(writes, []);
});
test('ordinary inquiry and explicit no-change remain read-only through service writes and persisted reentry', async () => {
  const saved = await start('请记下：书房书桌靠窗');
  await processAgentAnswer(saved.lease, { model: async () => ({ ...response(), text: '', toolCalls: [{ id: 'initial-need', name: 'record_need',
    arguments: JSON.stringify({ room: '书房', field: 'desk', value: '靠窗', quote: '书房书桌靠窗' }) }] }) });
  assert.equal((await saved.chat.run(saved.lease.runId)).status, 'succeeded');
  const getMemory = () => withTenantTransaction(actor.enterpriseId, async tx => readMemory((await one(tx,
    sql`select entry_snapshot from app.assistant_conversations where enterprise_id=${actor.enterpriseId} and id=${saved.c}`))?.entry_snapshot));
  const before = await getMemory(); assert.equal(before.facts.length, 1);
  for (const text of ['手测追问03：关于书桌收纳分类，请给一个一般选择建议。这是独立问题，不新增或修改我的需求。', '我想问客厅阅读灯的选择']) {
    const a = await start(text, saved.c);
    await processAgentAnswer(a.lease, { model: async (_messages, tools) => {
      assert.ok(!tools.some(t => t.name === 'record_need'));
      return response('一般可以按用途比较，并结合日常使用习惯选择。');
    } });
    assert.equal((await a.chat.run(a.lease.runId)).status, 'succeeded');
    assert.deepEqual(await getMemory(), before);
    const reentry = await new ConversationService(actor).messages(saved.c);
    assert.ok(reentry.items.some(m => m.id === a.sent.messageId));
    const writes = await withTenantTransaction(actor.enterpriseId, tx => rows(tx,
      sql`select id from app.assistant_run_steps where enterprise_id=${actor.enterpriseId} and run_id=${a.lease.runId} and kind='agent_need_write'`));
    assert.equal(writes.length, 0);
  }
  await assert.rejects(new ConversationService(stranger).messages(saved.c), /assistant_resource_not_found/);
});

test('durable need storage rejects no-change and inquiry even when called with a selected quote', async () => {
  const { persistNeedWrites } = await import('@/lib/assistant/agent/memory-store');
  for (const [text, room, value] of [
    ['书房需要收纳；不要新增或修改我的需求。', '书房', '收纳'],
    ['我想问客厅阅读灯的选择', '客厅', '阅读灯'],
  ]) {
    const a = await start(text);
    await assert.rejects(withTenantTransaction(actor.enterpriseId, async tx => {
      const conversation = (await one(tx, sql`select * from app.assistant_conversations where enterprise_id=${actor.enterpriseId} and id=${a.c}`))!;
      await persistNeedWrites(tx, actor, conversation,
        { runId: a.lease.runId, turn: 0, index: 0, sourceMessageId: String(a.sent.messageId) },
        { room, field: 'devices', value, quote: value });
    }), /need_source_mismatch/);
    await processAgentAnswer(a.lease, { model: async () => response('可以先比较使用方式。') });
    assert.equal((await a.chat.run(a.lease.runId)).status, 'succeeded');
    const persisted = await withTenantTransaction(actor.enterpriseId, tx => one(tx,
      sql`select entry_snapshot from app.assistant_conversations where enterprise_id=${actor.enterpriseId} and id=${a.c}`));
    assert.deepEqual(readMemory(persisted?.entry_snapshot), { version: 0, facts: [] });
  }
});
async function legacyDeskFixture(unavailableCorrection = false) {
  const chat = new ConversationService(actor), c = String((await chat.create(randomUUID())).id);
  const originals = ['请记下：书房书桌靠窗，书房需要收纳。', '客厅不做开放柜，全屋预算28万元。', '更正：书房书桌改为靠内墙；全屋预算改为18万元。其他需求保持原样。'];
  const memory = await withTenantTransaction(actor.enterpriseId, async tx => {
    const ids: string[] = [];
    for (const text of originals) ids.push(String((await appendMessage(tx, actor, c, { author: 'user', purpose: 'synthetic.legacy-original', content: { version: 1, blocks: [{ type: 'text', text }] } })).id));
    const fact = (id: string, room: string, field: NeedFact['field'], value: string, index: number): NeedFact => ({ id, room, field, value, quote: originals[index], sourceMessageId: ids[index], provenance: 'customer_statement', status: 'current', supersedes: null, createdAt: new Date().toISOString() });
    const stored: NeedMemory = { version: 5, facts: [fact('synthetic-v95-old','', 'other', '书房书桌靠窗，书房需要收纳。',0), fact('synthetic-v95-living','客厅','storage','不做开放柜',1), { ...fact('synthetic-v95-old-budget','','budget','28万元',1), status: 'superseded' }, fact('synthetic-v95-position','书房','style','靠内墙',2), { ...fact('synthetic-v95-budget','','budget','18万元',2), supersedes: 'synthetic-v95-old-budget' }] };
    await tx.execute(sql`update app.assistant_conversations set entry_snapshot=jsonb_set(entry_snapshot,'{agentMemory}',${JSON.stringify(stored)}::jsonb) where enterprise_id=${actor.enterpriseId} and id=${c}`);
    if (unavailableCorrection) await tx.execute(sql`update app.assistant_messages set content=${JSON.stringify({ version: 1, blocks: [{ type: 'text', text: '合成fixture：该更正原话当前不可用。' }] })}::jsonb where enterprise_id=${actor.enterpriseId} and id=${ids[2]}`);
    return stored;
  });
  return { c, chat, memory };
}
test('legacy desk position current recap repairs stale assertions without rewriting originals or querying business domains', async () => {
  const fixture = await legacyDeskFixture(), a = await start('只回顾这次聊天里的原话：书房、客厅和预算现在分别是什么？不要查工地或企业资料。', fixture.c); let calls = 0;
  await processAgentAnswer(a.lease, { model: async (messages, tools, turn) => {
    calls++; assert.match(JSON.stringify(messages), /effectiveDeskPositions/);
    if (turn === 0) { assert.deepEqual(tools.map(t => t.name), ['recall_history']); return { ...response(), text: '', toolCalls: [{ id: 'history', name: 'recall_history', arguments: JSON.stringify({ query: '书房 客厅 预算' }) }] }; }
    if (turn === 1) {
      const result = messages.filter(m => m.role === 'tool').at(-1)!; assert.ok(result.role === 'tool');
      const view = JSON.parse(result.content).currentNeedView;
      assert.equal(view.facts.find((f: { id: string }) => f.id === 'synthetic-v95-old').value, '书房需要收纳');
      assert.equal(view.facts.find((f: { id: string }) => f.id === 'synthetic-v95-position').field, 'desk');
      assert.match(JSON.stringify(view.historicalFacts), /书房书桌靠窗，书房需要收纳/);
      return response('书房书桌现在仍靠窗，书房需要收纳。');
    }
    assert.equal(turn, 2); assert.equal(tools.length, 0);
    return response('书房书桌当前靠内墙，收纳保留；客厅不做开放柜，预算为18万元。书房旧原话是书桌靠窗。');
  } });
  assert.equal((await a.chat.run(String(a.sent.runId))).status, 'succeeded'); assert.equal(calls, 3);
  const reply = JSON.stringify((await new ConversationService(actor).messages(a.c)).items.filter(m => m.authorKind === 'assistant').at(-1)!.content); assert.match(reply, /靠内墙/); assert.match(reply, /收纳保留/);
  const stored = await withTenantTransaction(actor.enterpriseId, tx => one(tx, sql`select entry_snapshot from app.assistant_conversations where enterprise_id=${actor.enterpriseId} and id=${a.c}`)); assert.deepEqual(readMemory(stored?.entry_snapshot), fixture.memory);
  const forbidden = await withTenantTransaction(actor.enterpriseId, tx => rows(tx, sql`select id from app.assistant_run_steps where enterprise_id=${actor.enterpriseId} and run_id=${String(a.sent.runId)} and (kind='agent_need_write' or capability_name in ('query_materials','query_business','query_followups','knowledge.search.v1'))`)); assert.equal(forbidden.length, 0);
  await assert.rejects(new ConversationService(stranger).messages(a.c), /assistant_resource_not_found/);
});
test('legacy desk position unavailable correction reconstructs its supported partial read while retaining the rejected model draft', async () => {
  const fixture = await legacyDeskFixture(true), a = await start('只回顾本次聊天原话，书房书桌现在的位置和仍可沿用的要求是什么？', fixture.c); let calls = 0;
  await processAgentAnswer(a.lease, { model: async (messages, _tools, turn) => {
    calls++; assert.doesNotMatch(JSON.stringify(messages), /靠内墙|18万元/);
    assert.equal(turn, 0); return response('书房书桌当前靠窗。');
  } });
  assert.equal((await a.chat.run(String(a.sent.runId))).status, 'succeeded'); assert.equal(calls, 1);
  const reply = JSON.stringify((await new ConversationService(actor).messages(a.c)).items.filter(m => m.authorKind === 'assistant').at(-1)!.content); assert.doesNotMatch(reply, /靠窗|靠内墙|18万元/); assert.match(reply, /无法确认/); assert.match(reply, /收纳/);
  const audit = await withTenantTransaction(actor.enterpriseId, tx => rows(tx, sql`select kind,private_checkpoint from app.assistant_run_steps where enterprise_id=${actor.enterpriseId} and run_id=${String(a.sent.runId)} and kind in ('agent_model','agent_need_unavailable_reply')`));
  assert.match(JSON.stringify(audit.find(s => s.kind === 'agent_model')!.private_checkpoint), /书房书桌当前靠窗/);
  assert.equal(audit.filter(s => s.kind === 'agent_need_unavailable_reply').length, 1);
  const stored = await withTenantTransaction(actor.enterpriseId, tx => one(tx, sql`select entry_snapshot from app.assistant_conversations where enterprise_id=${actor.enterpriseId} and id=${a.c}`)); assert.deepEqual(readMemory(stored?.entry_snapshot), fixture.memory);
});
test('legacy desk position mixed read and final envelope retains the provider packet and waits for authorized originals', async () => {
  const fixture = await legacyDeskFixture(), a = await start('只回顾本次聊天原话，书房书桌现在在哪里？', fixture.c); let calls = 0;
  const premature = 'premature-v95-unread-final';
  await processAgentAnswer(a.lease, { model: async (messages, _tools, turn) => {
    calls++;
    if (!turn) return { ...response(), text: '', toolCalls: [{ id: 'read', name: 'recall_history', arguments: JSON.stringify({ query: '书房 书桌' }) }, { id: 'final', name: 'final_response', arguments: JSON.stringify({ kind: 'general', text: premature }) }] };
    assert.equal(turn, 1); assert.match(JSON.stringify(messages), /提前回答未交付/); assert.doesNotMatch(JSON.stringify(messages), /premature-v95-unread-final/);
    return response('书房书桌当前靠内墙，收纳要求仍保留；旧原话中书桌靠窗。');
  } });
  assert.equal((await a.chat.run(String(a.sent.runId))).status, 'succeeded'); assert.equal(calls, 2);
  const model = await withTenantTransaction(actor.enterpriseId, tx => one(tx, sql`select private_checkpoint from app.assistant_run_steps where enterprise_id=${actor.enterpriseId} and run_id=${String(a.sent.runId)} and step_seq=1100`));
  const stored = model?.private_checkpoint as { toolCalls: unknown[]; providerOutput: { toolCalls: unknown[] } };
  assert.equal(stored.toolCalls.length, 1); assert.equal(stored.providerOutput.toolCalls.length, 2); assert.match(JSON.stringify(stored.providerOutput), /premature-v95-unread-final/);
  assert.doesNotMatch(JSON.stringify((await new ConversationService(actor).messages(a.c)).items.filter(m => m.authorKind === 'assistant')), /premature-v95-unread-final/);
});
test('natural conversation persists/reenters without knowledge and includes both sides of history', async () => {
  const a = await start(); await processAgentAnswer(a.lease, { model: async () => response() });
  assert.equal((await a.chat.run(String(a.sent.runId))).status, 'succeeded');
  const b = await start('那如果要两个人用呢？', a.c);
  await processAgentAnswer(b.lease, { model: async messages => { assert.ok(messages.some(m => m.role === 'assistant')); assert.match(JSON.stringify(messages), /小书房怎样摆桌/); return response('可以比较一张长桌和两张独立桌。'); } });
  const reentry = await new ConversationService(actor).messages(a.c); assert.equal(reentry.items.length, 4);
  await assert.rejects(new ConversationService(stranger).messages(a.c), /assistant_resource_not_found/);
});
test('source-linked semantic memory writes once, survives reentry and preserves room facts', async () => {
  let c: string | undefined;
  for (const [room, field, value] of [['书房','daylight','采光好'],['书房','desk','双人桌'],['次卧','use','客房']]) {
    const a = await start(room+'要'+value, c); c = a.c;
    await processAgentAnswer(a.lease, { model: async (_messages, _tools, turn) => turn === 0 ? { ...response(), text: '', toolCalls: [{ id: 'need', name: 'record_need',
      arguments: JSON.stringify({ room, field, value, quote: room+'要'+value }) }] } : response('记下了，可以继续聊。') });
    assert.equal((await a.chat.run(String(a.sent.runId))).status, 'succeeded');
  }
  const stored = await withTenantTransaction(actor.enterpriseId, tx => one(tx, sql`select entry_snapshot from app.assistant_conversations where id=${c!}`));
  assert.equal(readMemory(stored?.entry_snapshot).facts.filter(f => f.status === 'current').length, 3);
});
test('explicit record-only missing independent need is corrected before one atomic durable batch', async () => {
  const a = await start('请记下：书房书桌靠窗，书房需要收纳'); let calls = 0;
  await processAgentAnswer(a.lease, { model: async (messages) => {
    calls++;
    if (calls === 1) return { ...response(), text: '', toolCalls: [{ id: 'need', name: 'record_need', arguments: JSON.stringify({ room: '书房', field: 'desk', value: '书桌靠窗', quote: '书房书桌靠窗' }) }] };
    const feedback = JSON.parse((messages.at(-1) as { content: string }).content);
    assert.equal(feedback.status, 'not_saved'); assert.equal(feedback.error, 'need_write_incomplete');
    assert.equal(feedback.batchCommitted, false); assert.deepEqual(feedback.missingStatements, ['书房需要收纳']);
    const before = await withTenantTransaction(actor.enterpriseId, tx => one(tx, sql`select entry_snapshot from app.assistant_conversations where enterprise_id=${actor.enterpriseId} and id=${a.c}`));
    assert.equal(readMemory(before?.entry_snapshot).facts.length, 0, 'The rejected batch cannot partially persist');
    return { ...response(), text: '', toolCalls: [
      { id: 'complete-desk', name: 'record_need', arguments: JSON.stringify({ room: '书房', field: 'desk', value: '书桌靠窗', quote: '书房书桌靠窗' }) },
      { id: 'complete-storage', name: 'record_need', arguments: JSON.stringify({ room: '书房', field: 'storage', value: '需要收纳', quote: '书房需要收纳' }) },
    ] };
  } });
  assert.equal((await a.chat.run(String(a.sent.runId))).status, 'succeeded');
  const items = (await new ConversationService(actor).messages(a.c)).items;
  const reply = items.filter(m => m.authorKind === 'assistant').at(-1)!;
  const serialized = JSON.stringify(reply.content);
  assert.match(serialized, /本次实际保存/); assert.match(serialized, /书桌靠窗/); assert.match(serialized, /需要收纳/);
  assert.match(serialized, /未列出的内容不视为已保存/); assert.equal(calls, 2);
  const saved = await withTenantTransaction(actor.enterpriseId, tx => one(tx, sql`select entry_snapshot from app.assistant_conversations where enterprise_id=${actor.enterpriseId} and id=${a.c}`));
  assert.equal(readMemory(saved?.entry_snapshot).facts.filter(f => f.status === 'current').length, 2);
  const steps = await withTenantTransaction(actor.enterpriseId, tx => rows(tx, sql`select kind,private_checkpoint from app.assistant_run_steps where enterprise_id=${actor.enterpriseId} and run_id=${String(a.sent.runId)} and kind='agent_need_receipt'`));
  assert.equal(steps.length, 1);
  const writes = await withTenantTransaction(actor.enterpriseId, tx => rows(tx, sql`select id from app.assistant_run_steps where enterprise_id=${actor.enterpriseId} and run_id=${String(a.sent.runId)} and kind='agent_need_write'`));
  assert.equal(writes.length, 1);
  await assert.rejects(new ConversationService(stranger).messages(a.c), /assistant_resource_not_found/);
});
test('explicit record-only parallel inputs retain source checks and never persist a partial foreign quote', async () => {
  const a = await start('请记下：书房书桌靠窗，书房需要收纳。'); let calls = 0;
  await processAgentAnswer(a.lease, { model: async messages => {
    if (++calls === 1) return { ...response(), text: '', toolCalls: [
      { id: 'desk', name: 'record_need', arguments: JSON.stringify({ room: '书房', field: 'desk', value: '靠窗', quote: '书房书桌靠窗' }) },
      { id: 'storage', name: 'record_need', arguments: JSON.stringify({ room: '书房', field: 'storage', value: '需要收纳', quote: '另一个客户的书房需要收纳' }) },
    ] };
    const feedback = JSON.parse((messages.at(-1) as { content: string }).content);
    assert.equal(feedback.status, 'not_saved'); assert.equal(feedback.error, 'need_source_mismatch');
    return response('这两项需求暂未保存，请核对本次原话。');
  } });
  assert.equal((await a.chat.run(String(a.sent.runId))).status, 'succeeded'); assert.equal(calls, 2);
  const state = await withTenantTransaction(actor.enterpriseId, tx => one(tx, sql`select entry_snapshot from app.assistant_conversations where enterprise_id=${actor.enterpriseId} and id=${a.c}`));
  assert.deepEqual(readMemory(state!.entry_snapshot), { version: 0, facts: [] });
  const steps = await withTenantTransaction(actor.enterpriseId, tx => rows(tx, sql`select kind,input_summary,private_checkpoint from app.assistant_run_steps where enterprise_id=${actor.enterpriseId} and run_id=${String(a.sent.runId)}`));
  assert.equal(steps.filter(s => ['agent_need_write','agent_need_receipt'].includes(String(s.kind))).length, 0);
  const model = steps.find(s => (s.input_summary as Row)?.needBatchProtocol === agentNeedBatchProtocol)!;
  assert.ok(model); assert.deepEqual((model.input_summary as Row).needBatchCallIds, ['desk','storage']);
  const packet = model.private_checkpoint as { providerOutput: { toolCalls: unknown[] }; toolCalls: unknown[] };
  assert.equal(packet.providerOutput.toolCalls.length, 2); assert.equal(packet.toolCalls.length, 1);
});

test('explicit record-only rejected incomplete batch cannot be acknowledged or leave a partial memory', async () => {
  const a = await start('请记下：书房书桌靠窗，书房需要收纳'); let calls = 0;
  await processAgentAnswer(a.lease, { model: async () => {
    calls++;
    return calls === 1 ? { ...response(), text: '', toolCalls: [{ id: 'partial', name: 'record_need', arguments: JSON.stringify({ room: '书房', field: 'desk', value: '书桌靠窗', quote: '书房书桌靠窗，书房需要收纳' }) }] }
      : response('已记录书桌靠窗和书房需要收纳。');
  } });
  const run = await a.chat.run(String(a.sent.runId));assert.equal(run.status, 'failed');assert.equal(run.errorCode, 'unsupported_model_commitment');assert.equal(calls, 2);
  const saved = await withTenantTransaction(actor.enterpriseId, tx => one(tx, sql`select entry_snapshot from app.assistant_conversations where enterprise_id=${actor.enterpriseId} and id=${a.c}`));
  assert.equal(readMemory(saved?.entry_snapshot).facts.length, 0);
  assert.equal((await a.chat.messages(a.c)).items.filter(m => m.authorKind === 'assistant').length, 0);
  const writes = await withTenantTransaction(actor.enterpriseId, tx => rows(tx, sql`select id from app.assistant_run_steps where enterprise_id=${actor.enterpriseId} and run_id=${String(a.sent.runId)} and kind in ('agent_need_write','agent_need_receipt')`));assert.equal(writes.length, 0);
});

test('explicit record-only atomic batch confirms each durable field once and retains its own operation evidence', async () => {
  const a = await start('请记下：书房书桌靠窗，书房需要收纳'); let calls = 0;
  await processAgentAnswer(a.lease, { model: async (_messages, tools) => {
    calls++; assert.deepEqual(tools.map(t => t.name), ['record_need']);
    return { ...response(), text: '', toolCalls: [{ id: 'need', name: 'record_need', arguments: JSON.stringify({ room: '书房', field: 'desk', value: '书桌靠窗', quote: '书房书桌靠窗', additionalNeeds: [{ room: '书房', field: 'storage', value: '需要收纳', quote: '书房需要收纳' }] }) }] };
  } });
  assert.equal((await a.chat.run(String(a.sent.runId))).status, 'succeeded'); assert.equal(calls, 1);
  const items = (await new ConversationService(actor).messages(a.c)).items;
  const reply = JSON.stringify(items.filter(m => m.authorKind === 'assistant').at(-1)!.content);
  assert.match(reply, /书桌靠窗/); assert.match(reply, /需要收纳/);
  const stored = await withTenantTransaction(actor.enterpriseId, tx => one(tx, sql`select entry_snapshot from app.assistant_conversations where enterprise_id=${actor.enterpriseId} and id=${a.c}`));
  const facts = readMemory(stored?.entry_snapshot).facts; assert.equal(facts.length, 2);
  assert.ok(facts.every(f => f.id.startsWith(String(a.sent.runId) + ':')));
  const steps = await withTenantTransaction(actor.enterpriseId, tx => rows(tx, sql`select kind from app.assistant_run_steps where enterprise_id=${actor.enterpriseId} and run_id=${String(a.sent.runId)} and kind in ('agent_model','agent_need_write','agent_need_receipt')`));
  assert.equal(steps.filter(s => s.kind === 'agent_model').length, 1); assert.equal(steps.filter(s => s.kind === 'agent_need_write').length, 1); assert.equal(steps.filter(s => s.kind === 'agent_need_receipt').length, 1);
});
test('mixed explicit correction and professional question retains the existing model answer path', async () => {
  const a = await start('更正：书房书桌改为靠内墙，另外插座怎么确定？'); let calls = 0;
  await processAgentAnswer(a.lease, { model: async (_messages, _tools, turn) => {
    calls++;
    return turn === 0 ? { ...response(), text: '', toolCalls: [{ id: 'need', name: 'record_need', arguments: JSON.stringify({ room: '书房', field: 'desk', value: '书桌改为靠内墙', quote: '书房书桌改为靠内墙' }) }] }
      : response('已记录书桌改为靠内墙；插座位置仍需结合设备与现场尺寸核对。');
  } });
  assert.equal((await a.chat.run(String(a.sent.runId))).status, 'succeeded'); assert.equal(calls, 2);
  const steps = await withTenantTransaction(actor.enterpriseId, tx => rows(tx, sql`select id from app.assistant_run_steps where enterprise_id=${actor.enterpriseId} and run_id=${String(a.sent.runId)} and kind='agent_need_receipt'`)); assert.equal(steps.length, 0);
});
test('takeover during provider call suppresses late AI and checkpoint; usage remains auditable', async () => {
  const a = await start();
  await processAgentAnswer(a.lease, { model: async () => { await new HandoffService(actor).customerWrite(a.c, randomUUID(), { action: 'request' }); return response(); } });
  assert.equal((await a.chat.detail(a.c)).mode, 'handoff_requested');
  assert.equal((await a.chat.messages(a.c)).items.filter(m => m.authorKind === 'assistant').length, 0);
  assert.equal((await withTenantTransaction(actor.enterpriseId, tx => rows(tx, sql`select id from app.assistant_usage_records where run_id=${String(a.sent.runId)}`))).length, 1);
});
test('unknown provider outcome is indeterminate and cannot silently retry', async () => {
  const a = await start(); let calls = 0;
  await processAgentAnswer(a.lease, { model: async () => { calls++; throw Error('network lost'); } });
  assert.equal((await a.chat.run(String(a.sent.runId))).status, 'indeterminate'); assert.equal(calls, 1);
  await assert.rejects(a.chat.run(String(a.sent.runId), 'retry', randomUUID()), /context_changed|run_not_retryable/);
});
test('first image schedules one recoverable run; withdrawal hides derived answers and excludes private image bytes from checkpoints', async () => {
  const chat = new ConversationService(actor), c = String((await chat.create(randomUUID())).id), media = new AssistantMediaService(actor);
  const bytes = await sharp({ create: { width: 256, height: 256, channels: 3, background: '#cc1122' } }).png().toBuffer();
  const request = randomUUID(), uploaded = await media.upload(c, request, bytes, 'image', '');
  assert.deepEqual(await media.upload(c, request, bytes, 'image', ''), uploaded);
  const lease = await claimJob(); assert.ok(lease);
  await processAgentAnswer(lease, { model: async messages => {
    assert.match(JSON.stringify(messages), /image\/jpeg/);
    assert.ok(messages.some(m => m.role === 'user' && m.content.some(p => p.type === 'image' && p.data.length > 100)));
    return { ...response(), text: JSON.stringify({ kind: 'vision', text: '图中可见一片红色，暂时看不到房间细节。你想咨询哪部分？' }) };
  } });
  const imageRun = await chat.run(lease.runId);
  assert.equal(imageRun.status, 'succeeded', JSON.stringify(imageRun));
  const saved = await withTenantTransaction(actor.enterpriseId, tx => one(tx, sql`select private_checkpoint from app.assistant_run_steps where run_id=${lease.runId} and kind='agent_checkpoint'`));
  assert.match(JSON.stringify(saved), /"data":""/);
  const handoff = new HandoffService(actor);
  await handoff.customerWrite(c, randomUUID(), { action: 'request' });
  await media.remove(c, String(uploaded.id));
  assert.doesNotMatch(JSON.stringify(await handoff.customerRead(c)), /一片红色/);
  await handoff.customerWrite(c, randomUUID(), { action: 'cancel' });
  const messages = await chat.messages(c);
  assert.equal(messages.items.find(m => m.authorKind === 'assistant')?.available, false);
  const a = await start('刚才图片有什么？', c);
  await processAgentAnswer(a.lease, { model: async messages => { assert.doesNotMatch(JSON.stringify(messages), /一片红色/); return response('图片已经不可用，请重新发送。'); } });
});

test('expired lease resumes a durable completed provider step without another model call', async () => {
  const a = await start();
  await withTenantTransaction(actor.enterpriseId, async tx => {
    await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,status,private_checkpoint)
      values(${actor.enterpriseId},${a.lease.runId},1100,'agent_model','succeeded',${JSON.stringify(response())}::jsonb)`);
    await tx.execute(sql`update app.assistant_jobs set provider_started_at=now(),lease_expires_at=now()-interval '1 second'
      where enterprise_id=${actor.enterpriseId} and id=${a.lease.jobId}`);
  });
  const recovered = await claimJob(); assert.ok(recovered); assert.equal(recovered.runId, a.lease.runId);
  let calls = 0;
  await processAgentAnswer(recovered, { model: async () => { calls++; return response(); } });
  assert.equal(calls, 0);
  assert.equal((await a.chat.run(a.lease.runId)).status, 'succeeded');
  assert.equal((await a.chat.messages(a.c)).items.filter(m => m.authorKind === 'assistant').length, 1);
});

test('controlled business query renders the stored result and rejects foreign resource IDs', async () => {
  const a = await start('查询我的预约');
  await processAgentAnswer(a.lease, { model: async (_messages, _tools, turn) => turn === 0
    ? { ...response(), text: '', toolCalls: [{ id: 'query', name: 'query_business', arguments: JSON.stringify({ domain: 'appointments', leadId: '' }) }] }
    : { ...response(), text: JSON.stringify({ kind: 'business', resultKey: `${a.lease.runId}:0:0` }) } });
  assert.equal((await a.chat.run(a.lease.runId)).status, 'succeeded');
  assert.match(JSON.stringify(await a.chat.messages(a.c)), /目前没有查到/);
  const b = await start('查询另外一个预约');
  await processAgentAnswer(b.lease, { model: async () => ({ ...response(), text: '', toolCalls: [{ id: 'query', name: 'query_business', arguments: JSON.stringify({ domain: 'appointments', leadId: '999999999999' }) }] }) });
  assert.notEqual((await b.chat.run(b.lease.runId)).status, 'succeeded');
  assert.equal((await b.chat.messages(b.c)).items.filter(m => m.authorKind === 'assistant').length, 0);
});

test('model cannot rewrite business tool results as invented prose', async () => {
  const a = await start('我的预约确认了吗');
  await processAgentAnswer(a.lease, { model: async (_messages, _tools, turn) => turn === 0
    ? { ...response(), text: '', toolCalls: [{ id: 'query', name: 'query_business', arguments: JSON.stringify({ domain: 'appointments', leadId: '' }) }] }
    : response('预约已经确认。') });
  assert.notEqual((await a.chat.run(a.lease.runId)).status, 'succeeded');
  assert.equal((await a.chat.messages(a.c)).items.filter(m => m.authorKind === 'assistant').length, 0);
});

test('a claimed save without a successful memory write never becomes a customer answer', async () => {
  const a = await start('书房要双人桌');
  await processAgentAnswer(a.lease, { model: async () => response('已记录书房需求。') });
  assert.notEqual((await a.chat.run(a.lease.runId)).status, 'succeeded');
  assert.equal((await a.chat.messages(a.c)).items.filter(m => m.authorKind === 'assistant').length, 0);
});

test('invalid memory extraction receives bounded feedback and writes only the corrected quote', async () => {
  const a = await start('书房要双人桌');
  await processAgentAnswer(a.lease, { model: async (_messages, _tools, turn) => turn < 2 ? { ...response(), text: '', toolCalls: [{ id: 'need', name: 'record_need',
    arguments: JSON.stringify({ room: '书房', field: 'desk', value: turn === 0 ? '四人桌' : '双人桌', quote: '书房要双人桌' }) }] } : response('已记录书房的双人桌需求。') });
  assert.equal((await a.chat.run(a.lease.runId)).status, 'succeeded');
  const c = await withTenantTransaction(actor.enterpriseId, tx => one(tx, sql`select entry_snapshot from app.assistant_conversations where id=${a.c}`));
  assert.deepEqual(readMemory(c?.entry_snapshot).facts.map(f => f.value), ['双人桌']);
});

test('conditional recording clarification persists unchanged without a save while an independent completion remains blocked', async () => {
  const text = "把另一间的书桌也改一下，先确认具体房间再记录", clarification = "您提到需要修改另一间的书桌，但尚未明确具体是哪一间。请先告诉我具体是哪一间房间的书桌需要修改，我才能帮您记录需求。";
  const a = await start(text); let calls = 0;
  await processAgentAnswer(a.lease, { model: async () => { calls++; return response(clarification); } });
  const run = await a.chat.run(a.lease.runId);
  assert.equal(run.status, 'succeeded', JSON.stringify(run)); assert.equal(calls, 1);
  const persisted = await new ConversationService(actor).messages(a.c);
  const answer = persisted.items.find(m => m.id === run.outputMessageId);
  assert.ok(answer?.available); assert.ok(JSON.stringify(answer.content).includes(clarification));
  const row = await withTenantTransaction(actor.enterpriseId, tx => one(tx, sql`select entry_snapshot from app.assistant_conversations where enterprise_id=${actor.enterpriseId} and id=${a.c}`));
  assert.deepEqual(readMemory(row?.entry_snapshot), { version: 0, facts: [] });
  const writes = await withTenantTransaction(actor.enterpriseId, tx => rows(tx, sql`select id from app.assistant_run_steps where enterprise_id=${actor.enterpriseId} and run_id=${a.lease.runId} and kind in ('agent_need_write','agent_validation')`));
  assert.equal(writes.length, 0);
  await assert.rejects(new ConversationService(stranger).messages(a.c), /assistant_resource_not_found/);
  const b = await start(text);
  await processAgentAnswer(b.lease, { model: async () => response(clarification + '我已记录预算。') });
  const blocked = await b.chat.run(b.lease.runId);
  assert.equal(blocked.status, 'failed'); assert.equal(blocked.errorCode, 'unsupported_model_commitment'); assert.equal(blocked.outputMessageId, null);
});
test('conditional recording transition wording is delivered without a save or extra model repair', async () => {
  const text = '请先确认具体是哪一间房间的书桌需要改动，然后我们可以帮您记录需求。';
  const a = await start('把另一间的书桌也改一下，先确认具体房间再记录'); let calls = 0;
  await processAgentAnswer(a.lease, { model: async () => { calls++; return response(text); } });
  const run = await a.chat.run(a.lease.runId);
  assert.equal(run.status, 'succeeded', JSON.stringify(run)); assert.equal(calls, 1);
  const answer = (await new ConversationService(actor).messages(a.c)).items.find(m => m.id === run.outputMessageId);
  assert.ok(answer?.available); assert.ok(JSON.stringify(answer.content).includes(text));
  const row = await withTenantTransaction(actor.enterpriseId, tx => one(tx, sql`select entry_snapshot from app.assistant_conversations where enterprise_id=${actor.enterpriseId} and id=${a.c}`));
  assert.deepEqual(readMemory(row?.entry_snapshot), { version: 0, facts: [] });
});
test('conditional recording clarification follows an actually rejected ambiguous write without saving or repair', async () => {
  const text = "把另一间的书桌也改一下，先确认具体房间再记录", clarification = "您提到需要修改另一间的书桌，但尚未明确具体是哪一间。请先告诉我具体是哪一间房间的书桌需要修改，我才能帮您记录需求。";
  const a = await start(text); let calls = 0;
  await processAgentAnswer(a.lease, { model: async (messages, _tools, turn) => {
    calls++; if (!turn) return { ...response(), text: '', toolCalls: [{ id: 'ambiguous', name: 'record_need',
      arguments: JSON.stringify({ room: '', field: 'desk', value: '书桌', quote: text }) }] };
    assert.equal(turn, 1); assert.match(JSON.stringify(messages), /need_room_ambiguous/); return response(clarification);
  } });
  const run = await a.chat.run(a.lease.runId);
  assert.equal(run.status, 'succeeded', JSON.stringify(run)); assert.equal(calls, 2);
  const row = await withTenantTransaction(actor.enterpriseId, tx => one(tx, sql`select entry_snapshot from app.assistant_conversations where enterprise_id=${actor.enterpriseId} and id=${a.c}`));
  assert.deepEqual(readMemory(row?.entry_snapshot), { version: 0, facts: [] });
  const answer = (await new ConversationService(actor).messages(a.c)).items.find(m => m.id === run.outputMessageId);
  assert.ok(answer?.available); assert.ok(JSON.stringify(answer.content).includes(clarification));
});
test('ambiguous room write is rejected without mutation and clarification is delivered', async () => {
  const a = await start('那间房改成三人书桌，请记录。');
  await processAgentAnswer(a.lease, { model: async (messages,_tools,turn) => {
    if (!turn) return { ...response(),text:'',toolCalls:[{id:'need',name:'record_need',arguments:JSON.stringify({room:'',field:'desk',value:'三人书桌',quote:'那间房改成三人书桌，请记录。'})}] };
    assert.match(JSON.stringify(messages),/need_room_ambiguous/);
    return response('请确认具体是哪间房间，我再记录。');
  } });
  assert.equal((await a.chat.run(a.lease.runId)).status,'succeeded');
  const row = await withTenantTransaction(actor.enterpriseId,tx=>one(tx,sql`select entry_snapshot from app.assistant_conversations where id=${a.c}`));
  assert.equal(readMemory(row?.entry_snapshot).facts.length,0);
});

test('opt-in extended live ambiguous room is clarified before persistence', { skip: !deepseekLive || process.env.ASSISTANT_P2M_EXTENDED !== '1' }, async () => {
  let c: string | undefined;
  for (const text of ['请记住，书房需要双人书桌。','请记住，次卧需要单人书桌。']) {
    const a=await start(text,c); c=a.c; await processAgentAnswer(a.lease);
    assert.equal((await a.chat.run(a.lease.runId)).status,'succeeded');
  }
  const read=async()=>readMemory((await withTenantTransaction(actor.enterpriseId,tx=>one(tx,sql`select entry_snapshot from app.assistant_conversations where id=${c!}`)))?.entry_snapshot);
  const before=await read();
  const a=await start('那间房改成三人书桌，请记录。',c); await processAgentAnswer(a.lease);
  assert.equal((await a.chat.run(a.lease.runId)).status,'succeeded',JSON.stringify(await diagnostic(a.lease.runId)));
  assert.deepEqual(await read(),before);
  const reply=(await a.chat.messages(a.c)).items.filter(m=>m.authorKind==='assistant').sort((a,b)=>Number(b.seq)-Number(a.seq))[0];
  assert.match(JSON.stringify(reply),/哪|书房.*还是.*次卧|次卧.*还是.*书房/);
  const b=await start('我说的是次卧，次卧改成三人书桌，请记录。',c);await processAgentAnswer(b.lease);
  assert.equal((await b.chat.run(b.lease.runId)).status,'succeeded');
  const current=(await read()).facts.filter(f=>f.status==='current');
  assert.ok(current.some(f=>f.room==='次卧'&&f.value.includes('三人')));
  assert.ok(current.some(f=>f.room==='书房'&&f.value.includes('双人')));
  assert.ok(current.every(f=>f.room));
});

test('opt-in live model completes a synthetic natural conversation through the durable worker', { skip: process.env.ASSISTANT_P2M_LIVE !== '1' }, async () => {
  const a = await start('只讨论通用思路：小书房两个人办公，怎样兼顾采光？暂时不用记录需求。');
  await processAgentAnswer(a.lease);
  const run = await a.chat.run(a.lease.runId);
  const steps = run.status === 'succeeded' ? [] : await diagnostic(a.lease.runId);
  assert.equal(run.status, 'succeeded', JSON.stringify({ run, steps }));
  assert.equal((await a.chat.messages(a.c)).items.filter(m => m.authorKind === 'assistant').length, 1);
  const usage = await withTenantTransaction(actor.enterpriseId, tx => rows(tx, sql`select measurement_kind,input_tokens,output_tokens from app.assistant_usage_records where run_id=${a.lease.runId}`));
  assert.ok(usage.some(u => u.measurement_kind === 'observed' && Number(u.input_tokens) > 0));
});

test('opt-in live model sees a first synthetic picture', { skip: process.env.ASSISTANT_P2M_LIVE !== '1' }, async () => {
  const chat = new ConversationService(actor), c = String((await chat.create(randomUUID())).id);
  const bytes = await sharp({ create: { width: 320, height: 320, channels: 3, background: '#dd2233' } }).png().toBuffer();
  await new AssistantMediaService(actor).upload(c, randomUUID(), bytes, 'image', '');
  const stored = await withTenantTransaction(actor.enterpriseId, tx => one(tx, sql`select data from app.assistant_media where conversation_id=${c}`));
  const pixels = await sharp(stored!.data as Buffer).stats();
  assert.ok(pixels.channels[0].mean > 180 && pixels.channels[1].mean < 80 && pixels.channels[2].mean < 100, 'stored normalized image must remain red');
  const lease = await claimJob(); assert.ok(lease);
  await processAgentAnswer(lease);
  assert.equal((await chat.run(lease.runId)).status, 'succeeded', JSON.stringify({ run: await chat.run(lease.runId), steps: await diagnostic(lease.runId) }));
  assert.match(JSON.stringify(await chat.messages(c)), /红/);
  if (deepseekLive) {
    const steps = await withTenantTransaction(actor.enterpriseId, tx => rows(tx, sql`select step_seq,status,private_checkpoint from app.assistant_run_steps where run_id=${lease.runId} and kind='agent_model' order by step_seq`));
    assert.deepEqual(steps.map(s => Number(s.step_seq)), [1090,1100]);
    assert.ok(steps.every(s => s.status === 'succeeded'));
    assert.ok(!JSON.stringify(steps).includes('data:image'));
    const usage = await withTenantTransaction(actor.enterpriseId, tx => rows(tx, sql`select operation_key from app.assistant_usage_records where run_id=${lease.runId} and category='tokens'`));
    assert.equal(usage.length, 2);
  }
});

test('withdrawal during perception prevents the subsequent Agent call and hides any reply', async () => {
  await withTenantTransaction(actor.enterpriseId, tx => tx.execute(sql`update app.assistant_enterprise_settings set agent_config=${JSON.stringify({ ...config, providerKey: 'deepseek', model: 'deepseek-flash' })}::jsonb where enterprise_id=${actor.enterpriseId}`));
  try {
    const chat = new ConversationService(actor), c = String((await chat.create(randomUUID())).id);
    const media = new AssistantMediaService(actor);
    const bytes = await sharp({ create: { width: 320, height: 320, channels: 3, background: '#dd2233' } }).png().toBuffer();
    await media.upload(c, randomUUID(), bytes, 'image', '');
    const stored = await withTenantTransaction(actor.enterpriseId, tx => one(tx, sql`select id from app.assistant_media where conversation_id=${c}`));
    const lease = await claimJob(); assert.ok(lease);
    let reasoningCalls = 0;
    await processAgentAnswer(lease, {
      vision: async () => { await media.remove(c, String(stored!.id)); return { ...response(), text: '来源图片是红色。' }; },
      model: async () => { reasoningCalls++; return response(); },
    });
    assert.equal(reasoningCalls, 0);
    assert.equal((await chat.messages(c)).items.filter(m => m.authorKind === 'assistant').length, 0);
  } finally {
    await withTenantTransaction(actor.enterpriseId, tx => tx.execute(sql`update app.assistant_enterprise_settings set agent_config=${JSON.stringify(config)}::jsonb where enterprise_id=${actor.enterpriseId}`));
  }
});

test('opt-in live model uses an authorized business tool', { skip: process.env.ASSISTANT_P2M_LIVE !== '1' }, async () => {
  const a = await start('请查询我目前在本企业的预约记录。');
  await processAgentAnswer(a.lease);
  const run = await a.chat.run(a.lease.runId);
  assert.equal(run.status, 'succeeded', JSON.stringify(run));
  const results = await withTenantTransaction(actor.enterpriseId, tx => rows(tx, sql`select id from app.assistant_run_steps where run_id=${a.lease.runId} and kind='agent_business_result'`));
  assert.equal(results.length, 1, JSON.stringify(await diagnostic(a.lease.runId)));
});

test('opt-in live model writes explicitly requested synthetic memory', { skip: process.env.ASSISTANT_P2M_LIVE !== '1' }, async () => {
  const a = await start('请记住，书房要双人桌。');
  await processAgentAnswer(a.lease);
  const run = await a.chat.run(a.lease.runId);
  assert.equal(run.status, 'succeeded', JSON.stringify(run));
  const c = await withTenantTransaction(actor.enterpriseId, tx => one(tx, sql`select entry_snapshot from app.assistant_conversations where id=${a.c}`));
  assert.ok(readMemory(c?.entry_snapshot).facts.some(f => f.room === '书房' && f.value.includes('双人桌')), JSON.stringify(await diagnostic(a.lease.runId)));
});

test('opt-in extended live correction survives reentry without replacing another room', { skip: !deepseekLive || process.env.ASSISTANT_P2M_EXTENDED !== '1' }, async () => {
  let conversationId: string | undefined;
  for (const text of ['请记住，书房需要双人书桌。', '请记住，次卧用作客房。', '更正一下，书房改成单人书桌，请记录。']) {
    const a = await start(text, conversationId); conversationId = a.c;
    await processAgentAnswer(a.lease);
    assert.equal((await a.chat.run(a.lease.runId)).status, 'succeeded', JSON.stringify(await diagnostic(a.lease.runId)));
  }
  const stored = await withTenantTransaction(actor.enterpriseId, tx => one(tx, sql`select entry_snapshot from app.assistant_conversations where id=${conversationId!}`));
  const memory = readMemory(stored?.entry_snapshot);
  const current = memory.facts.filter(f => f.status === 'current');
  assert.ok(current.some(f => f.room === '书房' && f.field === 'desk' && f.value.includes('单人')));
  assert.ok(current.some(f => f.room === '次卧' && f.field === 'use' && f.value.includes('客房')));
  const prior = memory.facts.find(f => f.room === '书房' && f.value.includes('双人'));
  assert.equal(prior?.status, 'superseded');
  assert.equal(current.find(f => f.room === '书房' && f.field === 'desk')?.supersedes, prior?.id);
  const a = await start('回顾书房和次卧需求，不要新增记录。', conversationId);
  await processAgentAnswer(a.lease);
  assert.equal((await a.chat.run(a.lease.runId)).status, 'succeeded', JSON.stringify(await diagnostic(a.lease.runId)));
  const reentry = await new ConversationService(actor).messages(a.c);
  const last = reentry.items.filter(m => m.authorKind === 'assistant').sort((a,b) => Number(b.seq)-Number(a.seq))[0];
  assert.match(JSON.stringify(last), /单人/); assert.match(JSON.stringify(last), /客房/);
  const after = await withTenantTransaction(actor.enterpriseId, tx => one(tx, sql`select entry_snapshot from app.assistant_conversations where id=${a.c}`));
  assert.deepEqual(readMemory(after?.entry_snapshot), memory);
});

test('opt-in extended live public renovation photo survives upload and followup then revokes', { skip: !deepseekLive || process.env.ASSISTANT_P2M_EXTENDED !== '1' }, async () => {
  const chat = new ConversationService(actor), c = String((await chat.create(randomUUID())).id);
  const media = new AssistantMediaService(actor);
  const bytes = fs.readFileSync(path.resolve('../tmp/xiaok-vector/renovation-photos/demolition.jpg'));
  const uploaded = await media.upload(c, randomUUID(), bytes, 'image', '');
  const lease = await claimJob(); assert.ok(lease);
  await processAgentAnswer(lease);
  assert.equal((await chat.run(lease.runId)).status, 'succeeded', JSON.stringify(await diagnostic(lease.runId)));
  assert.match(JSON.stringify((await chat.messages(c)).items.filter(m => m.authorKind === 'assistant')), /梯/);
  const a = await start('仅凭刚才的照片能确定墙可以拆吗？', c);
  await processAgentAnswer(a.lease);
  assert.equal((await chat.run(a.lease.runId)).status, 'succeeded', JSON.stringify(await diagnostic(a.lease.runId)));
  const last = (await new ConversationService(actor).messages(c)).items.filter(m => m.authorKind === 'assistant').sort((a,b) => Number(b.seq)-Number(a.seq))[0];
  assert.match(JSON.stringify(last), /不能|无法|不足以|不可以/);
  const stored = await withTenantTransaction(actor.enterpriseId, tx => one(tx, sql`select entry_snapshot from app.assistant_conversations where id=${c}`));
  assert.equal(readMemory(stored?.entry_snapshot).facts.length, 0);
  await media.remove(c, String(uploaded.id));
  assert.ok((await chat.messages(c)).items.filter(m => m.authorKind === 'assistant').every(m => !m.available));
});
