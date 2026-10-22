import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { ConversationService, appendMessage } from '@/lib/assistant/core/conversation';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { processAgentAnswer } from '@/lib/assistant/agent/worker';
import { persistNeedWrites } from '@/lib/assistant/agent/memory-store';
import { readMemory, type NeedFact } from '@/lib/assistant/agent/memory';
import { availableNeedMemory, unavailableNeedMessageIds, needRunSourcesAvailable } from '@/lib/assistant/agent/memory-sources';
import { recallHistory, historyRefsAvailable } from '@/lib/assistant/agent/history';
import { summaryInput } from '@/lib/assistant/agent/summary';
import { fingerprint, safeText, type ActorContext } from '@/lib/assistant/contracts';
import type { ModelTurnOutput } from '@/lib/assistant/contracts/model';
import { currentSynthesisContext, synthesisContextAvailable } from '@/lib/assistant/agent/synthesis-sources';

const prefix = 'synthetic-memory-' + (process.env.ASSISTANT_TEST_RUN_ID || randomUUID());
const enterprises: string[] = [], users: string[] = [];
let actor: ActorContext, other: ActorContext;
const chat = () => new ConversationService(actor);
const response = (text = '已按你的更正记录工作需求，正式方案仍需按版本核对。'): ModelTurnOutput => ({
  text: JSON.stringify({ kind: 'general', text }), toolCalls: [], usage: { inputTokens: 50, outputTokens: 10 }, finishReason: 'stop', providerRequestId: null });

before(async () => {
  const target = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname)); assert.equal(target.port, '55432'); assert.equal(target.pathname, '/xiaok_embedding_eval');
  await withPlatformTransaction(async tx => {
    for (let i = 0; i < 2; i++) {
      enterprises.push(String((await one(tx, sql`insert into app.enterprises(name,code,status) values(${prefix + i},${prefix + i},'active') returning id`))!.id));
      users.push(String((await one(tx, sql`insert into app.users(nickname,context_version) values(${prefix + i},1) returning id`))!.id));
      await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${users[i]},${prefix + i})`);
      await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config)
        values(${enterprises[i]},true,1000,12000000,1000000000,30,
          '{"runtime":"langgraph-v1","model":"deepseek-flash","providerKey":"deepseek","tools":true,"imageInput":false,"probeVersion":"synthetic-memory-v1"}'::jsonb)`);
    }
  });
  actor = { enterpriseId: enterprises[0], principal: { kind: 'user', userId: users[0] }, contextVersion: 1, capabilities: ['assistant.chat.self'] };
  other = { ...actor, enterpriseId: enterprises[1], principal: { kind: 'user', userId: users[1] } };
});
after(async () => {
  try { await withPlatformTransaction(async tx => {
    for (const id of enterprises) { await deleteAssistantData(tx, BigInt(id)); await tx.execute(sql`delete from app.enterprises where id=${id}`); }
    for (const id of users) await tx.execute(sql`delete from app.users where id=${id}`);
  }); } finally { await closePostgresPool(); }
});

async function fixture() {
  const id = String((await chat().create(randomUUID())).id);
  const facts = await withTenantTransaction(actor.enterpriseId, async tx => {
    const current = await one(tx, sql`update app.assistant_conversations set last_seq=last_seq+300,version=version+1
      where enterprise_id=${actor.enterpriseId} and id=${id} returning last_seq`);
    const originals = await rows(tx, sql`insert into app.assistant_messages(enterprise_id,conversation_id,seq,author_kind,user_id,content,purpose)
      select ${actor.enterpriseId},${id},${String(current!.last_seq)}::bigint-300+n,'user',${users[0]},
        jsonb_build_object('version',1,'blocks',jsonb_build_array(jsonb_build_object('type','text','text',
          case when n=1 then '厨房保留冰箱。' else '书房书桌靠窗，历史版本' || n || '。' end))),'synthetic.memory'
      from generate_series(1,300) n returning id::text,seq::text,content`);
    originals.sort((a, b) => BigInt(String(a.seq)) < BigInt(String(b.seq)) ? -1 : 1);
    const facts: NeedFact[] = originals.map((m, i) => ({ id: 'synthetic:' + m.id, room: i ? '书房' : '厨房', field: i ? 'desk' : 'devices', value: i ? '靠窗' : '冰箱',
      quote: safeText(m.content as Parameters<typeof safeText>[0]), sourceMessageId: String(m.id), provenance: 'customer_statement',
      status: i === 0 || i === 299 ? 'current' : 'superseded', supersedes: i > 1 ? 'synthetic:' + originals[i - 1].id : null, createdAt: '2026-10-19T00:00:00Z' }));
    await tx.execute(sql`update app.assistant_conversations set entry_snapshot=jsonb_set(entry_snapshot,'{agentMemory}',${JSON.stringify({ version: 300, facts })}::jsonb)
      where enterprise_id=${actor.enterpriseId} and id=${id}`);
    return facts;
  });
  return { id, facts };
}
const conversation = (id: string) => withTenantTransaction(actor.enterpriseId,
  tx => one(tx, sql`select * from app.assistant_conversations where enterprise_id=${actor.enterpriseId} and id=${id}`));
async function write(id: string, text: string, input: unknown, reply?: string) {
  const sent = await chat().send(id, randomUUID(), { version: 1, blocks: [{ type: 'text', text }] });
  const lease = await claimJob(); assert.ok(lease); assert.equal(lease.runId, sent.runId);
  await processAgentAnswer(lease, { model: async (_messages, _tools, turn) => turn ? response(reply) : {
    ...response(), text: '', toolCalls: [{ id: 'need', name: 'record_need', arguments: JSON.stringify(input) }] } });
  return { sent, run: await chat().run(String(sent.runId)) };
}
const input = { room: '书房', field: 'desk', value: '靠门', quote: '书房书桌改为靠门',
  additionalNeeds: [{ room: '书房', field: 'devices', value: '电脑和台灯', quote: '书房设备保留电脑和台灯' }] };
const text = '请记录：书房书桌改为靠门；书房设备保留电脑和台灯。';

const mixedText = '更正一下，书房改为单人办公，书房书桌改为靠内墙，另外如果厨房加洗碗机，水电要怎么核对？';
const mixedInput = { room: '书房', field: 'use', value: '单人办公', quote: '书房改为单人办公',
  additionalNeeds: [{ room: '书房', field: 'desk', value: '靠内墙', quote: '书房书桌改为靠内墙' }] };

test('AG02: duplicate room-field diagnostics preserve atomic rollback, one recovered write, replay and source withdrawal', async () => {
  const id = String((await chat().create(randomUUID())).id), key = randomUUID();
  const original = '请记下：先不确定装修日期，不要替我定日期。';
  const valid = { room: '', field: 'timeline', value: '先不确定装修日期', quote: '请记下：先不确定装修日期' };
  const duplicate = { ...valid, additionalNeeds: [{ room: '', field: 'timeline', value: '不要替我定日期', quote: '不要替我定日期' }] };
  const body = { version: 1 as const, blocks: [{ type: 'text' as const, text: original }] };
  const sent = await chat().send(id, key, body), lease = await claimJob();
  assert.ok(lease); assert.equal(lease.runId, sent.runId);
  let calls = 0;
  await processAgentAnswer(lease, { model: async (messages, _tools, turn) => {
    calls++;
    if (turn === 1) {
      const feedback = JSON.parse(String(messages.findLast(message => message.role === 'tool')?.content));
      assert.equal(feedback.diagnosticProtocol, 'need-batch-conflicts-v1');
      assert.deepEqual(feedback.batchConflicts, [{ reason: 'duplicate_room_field', room: '', field: 'timeline', indices: [0, 1] }]);
      assert.equal(feedback.batchCommitted, false);
      assert.equal(readMemory((await conversation(id))!.entry_snapshot).version, 0, 'Rejected batch cannot partially save');
      return { ...response(), text: '', toolCalls: [{ id: 'corrected', name: 'record_need', arguments: JSON.stringify(valid) }] };
    }
    return turn === 0 ? { ...response(), text: '', toolCalls: [{ id: 'conflict', name: 'record_need', arguments: JSON.stringify(duplicate) }] }
      : response('已记录装修日期暂不确定，不会替你设定日期。');
  } });
  assert.equal((await chat().run(String(sent.runId))).status, 'succeeded');
  assert.equal(calls, 2, 'One rejected call and one recovered write use the existing receipt fast path');
  const saved = readMemory((await conversation(id))!.entry_snapshot);
  assert.equal(saved.version, 1); assert.equal(saved.facts.length, 1);
  assert.equal(saved.facts[0].value, valid.value); assert.equal(saved.facts[0].sourceMessageId, String(sent.messageId));
  const writes = await withTenantTransaction(actor.enterpriseId, tx => rows(tx, sql`select id from app.assistant_run_steps
    where enterprise_id=${actor.enterpriseId} and run_id=${String(sent.runId)} and kind='agent_need_write'`));
  assert.equal(writes.length, 1);
  assert.equal(String((await chat().send(id, key, body)).runId), String(sent.runId));
  assert.equal(readMemory((await conversation(id))!.entry_snapshot).version, 1);
  const outputId = String((await chat().run(String(sent.runId))).outputMessageId);
  assert.ok((await chat().messages(id)).items.some(message => message.id === outputId && message.available));
  await assert.rejects(new ConversationService({ ...actor, principal: other.principal }).messages(id));
  await assert.rejects(new ConversationService(other).messages(id));
  await withTenantTransaction(actor.enterpriseId, tx => tx.execute(sql`update app.assistant_messages
    set content='{"version":1,"blocks":[{"type":"text","text":"合成撤回：日期原话已移除"}]}'::jsonb
    where enterprise_id=${actor.enterpriseId} and conversation_id=${id} and id=${String(sent.messageId)}`));
  assert.equal((await chat().messages(id)).items.find(message => message.id === outputId)?.available, false);
});

test('AG04: a comma-delimited follow-up preserves one atomic explicit correction, independent needs and persisted replay', async () => {
  const a = await fixture(), result = await write(a.id, mixedText, mixedInput);
  assert.equal(result.run.status, 'succeeded');
  const stored = (await conversation(a.id))!, memory = readMemory(stored.entry_snapshot);
  assert.equal(memory.version, 302);
  assert.deepEqual(memory.facts.filter(f => f.status === 'current').map(f => [f.room, f.field, f.value]),
    [['厨房', 'devices', '冰箱'], ['书房', 'use', '单人办公'], ['书房', 'desk', '靠内墙']]);
  const receipt = await withTenantTransaction(actor.enterpriseId, tx => persistNeedWrites(tx, actor, stored,
    { runId: String(result.sent.runId), turn: 0, index: 0, sourceMessageId: String(result.sent.messageId) }, mixedInput));
  assert.deepEqual(JSON.parse(receipt.content).savedFacts.map((f: NeedFact) => f.value), ['单人办公', '靠内墙']);
  const sources = await withTenantTransaction(actor.enterpriseId, tx => currentSynthesisContext(tx, actor, stored, String(result.sent.runId)));
  assert.equal(sources.sources.length, 1);
  assert.equal(sources.sources[0].history?.messageId, String(result.sent.messageId));
  assert.equal(sources.sources[0].text, mixedText, 'keep the full original, including the hypothetical question as a question');
  assert.equal(sources.sources[0].title, '本轮已记录需求的客户原话');
  assert.deepEqual(readMemory((await conversation(a.id))!.entry_snapshot), memory);
  assert.ok((await chat().messages(a.id)).items.some(m => m.available && safeText(m.content as Parameters<typeof safeText>[0]).includes('已按你的更正记录')));
});

test('AG04: same-turn originals require the committed receipt, exact participant/run/conversation and live source hash', async () => {
  const a = await fixture(), result = await write(a.id, mixedText, mixedInput);
  assert.equal(result.run.status, 'succeeded');
  const stored = (await conversation(a.id))!;
  const sources = await withTenantTransaction(actor.enterpriseId, tx => currentSynthesisContext(tx, actor, stored, String(result.sent.runId)));
  assert.equal(await withTenantTransaction(actor.enterpriseId, tx => synthesisContextAvailable(tx, actor, stored, sources)), true);
  await assert.rejects(withTenantTransaction(actor.enterpriseId, tx => currentSynthesisContext(tx,
    { ...actor, principal: other.principal }, stored, String(result.sent.runId))), /context_changed/);
  await assert.rejects(withTenantTransaction(actor.enterpriseId, tx => currentSynthesisContext(tx, actor,
    { ...stored, id: String((BigInt(a.id) + BigInt(1000000))) }, String(result.sent.runId))), /context_changed/);
  assert.deepEqual((await withTenantTransaction(other.enterpriseId, tx => currentSynthesisContext(tx, other, stored, String(result.sent.runId)))).sources, []);
  await withTenantTransaction(actor.enterpriseId, tx => tx.execute(sql`update app.assistant_messages set content='{"version":1,"blocks":[{"type":"text","text":"合成撤回"}]}'::jsonb
    where enterprise_id=${actor.enterpriseId} and conversation_id=${a.id} and id=${String(result.sent.messageId)}`));
  assert.equal(await withTenantTransaction(actor.enterpriseId, tx => synthesisContextAvailable(tx, actor, stored, sources)), false);
  await assert.rejects(withTenantTransaction(actor.enterpriseId, tx => currentSynthesisContext(tx, actor, stored, String(result.sent.runId))), /context_changed/);
});

test('AG04: accidentally including the hypothetical follow-up rolls back every field and emits no false save receipt', async () => {
  const a = await fixture(), before = readMemory((await conversation(a.id))!.entry_snapshot);
  const result = await write(a.id, mixedText, { ...mixedInput, additionalNeeds: [
    ...mixedInput.additionalNeeds, { room: '厨房', field: 'devices', value: '洗碗机', quote: '厨房加洗碗机' },
  ] });
  assert.equal(result.run.status, 'failed');
  assert.deepEqual(readMemory((await conversation(a.id))!.entry_snapshot), before);
  const count = await withTenantTransaction(actor.enterpriseId, tx => one(tx, sql`select count(*)::int n from app.assistant_run_steps
    where enterprise_id=${actor.enterpriseId} and run_id=${String(result.sent.runId)} and kind='agent_need_write'`));
  assert.equal(count!.n, 0);
  assert.ok(!(await chat().messages(a.id)).items.some(m => m.authorKind === 'assistant' && m.available
    && /已按你的更正记录/.test(safeText(m.content as Parameters<typeof safeText>[0]))));
  assert.equal((await write(a.id, mixedText, mixedInput)).run.status, 'succeeded');
  assert.equal(readMemory((await conversation(a.id))!.entry_snapshot).version, 302);
});

test('AG02: real Worker crosses 300, atomically archives complete superseded assertions and retains independent needs on reentry', async () => {
  const a = await fixture(), result = await write(a.id, text, input); assert.equal(result.run.status, 'succeeded');
  const memory = readMemory((await conversation(a.id))!.entry_snapshot);
  assert.equal(memory.version, 302); assert.equal(memory.facts.length, 3);
  assert.deepEqual(memory.facts.map(f => f.value), ['冰箱', '靠门', '电脑和台灯']);
  assert.equal(memory.facts[1].supersedes, a.facts[299].id);
  const step = await withTenantTransaction(actor.enterpriseId, tx => one(tx, sql`select private_checkpoint,input_summary from app.assistant_run_steps
    where enterprise_id=${actor.enterpriseId} and run_id=${String(result.sent.runId)} and kind='agent_need_write'`));
  const archive = (step!.private_checkpoint as { archivedFacts: NeedFact[] }).archivedFacts;
  assert.equal(archive.length, 299);
  assert.deepEqual(archive, a.facts.slice(1).map(f => ({ ...f, status: 'superseded' })));
  assert.equal((step!.input_summary as Row).archivedCount, 299);
  const history = await chat().messages(a.id);
  assert.ok(history.items.some(m => m.id === result.run.outputMessageId && m.available
    && safeText(m.content as Parameters<typeof safeText>[0]).includes('靠门')
    && safeText(m.content as Parameters<typeof safeText>[0]).includes('电脑和台灯')));
  assert.deepEqual(readMemory((await conversation(a.id))!.entry_snapshot), memory);
});

test('AG05: tool replay returns its original persisted receipt without another archive or memory revision', async () => {
  const a = await fixture(), result = await write(a.id, text, input);
  assert.equal(result.run.status, 'succeeded'); const before = (await conversation(a.id))!;
  const receipt = await withTenantTransaction(actor.enterpriseId, tx => persistNeedWrites(tx, actor, before,
    { runId: String(result.sent.runId), turn: 0, index: 0, sourceMessageId: String(result.sent.messageId) }, input));
  assert.equal(JSON.parse(receipt.content).memoryVersion, 302);
  assert.deepEqual((await conversation(a.id))!.entry_snapshot, before.entry_snapshot);
  assert.equal(String((await conversation(a.id))!.version), String(before.version));
  const count = await withTenantTransaction(actor.enterpriseId, tx => one(tx, sql`select count(*)::int n from app.assistant_run_steps
    where enterprise_id=${actor.enterpriseId} and run_id=${String(result.sent.runId)} and kind='agent_need_write'`));
  assert.equal(count!.n, 1);
  await assert.rejects(withTenantTransaction(actor.enterpriseId, tx => persistNeedWrites(tx, actor, before,
    { runId: String(result.sent.runId), turn: 0, index: 0, sourceMessageId: String(result.sent.messageId) }, { ...input, value: '书桌' })), /context_changed/);
});

test('AG05: invalid later field rolls back the whole batch and archive, then a valid retry succeeds', async () => {
  const a = await fixture(), before = readMemory((await conversation(a.id))!.entry_snapshot);
  const result = await write(a.id, text, { ...input, additionalNeeds: [{ ...input.additionalNeeds[0], value: '不存在的设备' }] }, '本次尚未保存，请核对原话。');
  assert.equal(result.run.status, 'succeeded');
  assert.deepEqual(readMemory((await conversation(a.id))!.entry_snapshot), before);
  const count = await withTenantTransaction(actor.enterpriseId, tx => one(tx, sql`select count(*)::int n from app.assistant_run_steps
    where enterprise_id=${actor.enterpriseId} and run_id=${String(result.sent.runId)} and kind='agent_need_write'`));
  assert.equal(count!.n, 0);
  assert.equal((await write(a.id, text, input)).run.status, 'succeeded');
  assert.equal(readMemory((await conversation(a.id))!.entry_snapshot).version, 302);
});

test('AG07: withdrawn current correction blocks archived originals in recall, summaries and persisted history refs without reviving old values', async () => {
  const a = await fixture(), result = await write(a.id, text, input); assert.equal(result.run.status, 'succeeded');
  const prior = a.facts[298];
  await withTenantTransaction(actor.enterpriseId, async tx => {
    const c = (await one(tx, sql`select * from app.assistant_conversations where enterprise_id=${actor.enterpriseId} and id=${a.id}`))!;
    const original = await one(tx, sql`select content from app.assistant_messages where enterprise_id=${actor.enterpriseId} and id=${prior.sourceMessageId}`);
    const refs = [{ messageId: prior.sourceMessageId, hash: fingerprint(original!.content), memoryVersion: 302 }];
    assert.equal(await historyRefsAvailable(tx, actor.enterpriseId, a.id, refs), true);
    await tx.execute(sql`update app.assistant_messages set content='{"version":1,"blocks":[{"type":"text","text":"合成撤回"}]}'::jsonb
      where enterprise_id=${actor.enterpriseId} and conversation_id=${a.id} and id=${String(result.sent.messageId)}`);
    const visible = await availableNeedMemory(tx, actor.enterpriseId, a.id, c.entry_snapshot);
    assert.deepEqual(visible.facts.map(f => f.value), ['冰箱']);
    const blocked = await unavailableNeedMessageIds(tx, actor.enterpriseId, a.id, c.entry_snapshot, visible);
    assert.equal(blocked.size, 300); assert.ok(blocked.has(prior.sourceMessageId)); assert.ok(!blocked.has(a.facts[0].sourceMessageId));
    assert.equal(await historyRefsAvailable(tx, actor.enterpriseId, a.id, refs), false);
    assert.deepEqual((await recallHistory(tx, actor, c, '1000000', '书房书桌')).sources, []);
    const cutoff = await appendMessage(tx, actor, a.id, { author: 'user', content: { version: 1, blocks: [{ type: 'text', text: '接续讨论。' }] } });
    assert.equal(await summaryInput(tx, actor, c, String(cutoff.id), '1000000'), null);
    const step = await one(tx, sql`select private_checkpoint from app.assistant_run_steps where enterprise_id=${actor.enterpriseId}
      and run_id=${String(result.sent.runId)} and kind='agent_need_write'`);
    assert.equal((step!.private_checkpoint as { archivedFacts: NeedFact[] }).archivedFacts.length, 299, 'audit stays immutable and private');
  });
});

test('AG07: archive is consultation-scoped, RLS isolated and inaccessible to another customer or enterprise', async () => {
  const a = await fixture(), result = await write(a.id, text, input); assert.equal(result.run.status, 'succeeded');
  const c = (await conversation(a.id))!;
  await assert.rejects(withTenantTransaction(actor.enterpriseId, tx => persistNeedWrites(tx, { ...actor, principal: { kind: 'user', userId: users[1] } }, c,
    { runId: String(result.sent.runId), turn: 0, index: 0, sourceMessageId: String(result.sent.messageId) }, input)), /assistant_resource_not_found/);
  const cross = await withTenantTransaction(other.enterpriseId, tx => rows(tx, sql`select private_checkpoint from app.assistant_run_steps where run_id=${String(result.sent.runId)}`));
  assert.deepEqual(cross, []);
  const freshId = String((await chat().create(randomUUID())).id), fresh = (await conversation(freshId))!;
  const blocked = await withTenantTransaction(actor.enterpriseId, tx => unavailableNeedMessageIds(tx, actor.enterpriseId, freshId, fresh.entry_snapshot, { version: 0, facts: [] }));
  assert.equal(blocked.size, 0);
  await assert.rejects(chat().messages(freshId).then(() => new ConversationService(other).messages(a.id)));
});

test('AG07: memory-derived plain replies hide after withdrawal and legacy assistant prose cannot reenter model context', async () => {
  const a = await fixture(), saved = await write(a.id, text, input, '已记录：书房书桌靠门，设备为电脑和台灯。');
  assert.equal(saved.run.status, 'succeeded');
  const ask = async (question: string, answer: string, inspect?: (messages: unknown) => void) => {
    const sent = await chat().send(a.id, randomUUID(), { version: 1, blocks: [{ type: 'text', text: question }] });
    const lease = await claimJob(); assert.ok(lease); assert.equal(lease.runId, sent.runId);
    await processAgentAnswer(lease, { model: async messages => { inspect?.(messages); return response(answer); } });
    const run = await chat().run(String(sent.runId)); assert.equal(run.status, 'succeeded'); return run;
  };
  const plain = await ask('书房目前情况怎样？先聊，不重新记录。', '当前书房书桌靠门，设备为电脑和台灯。');
  const daylight = await write(a.id, '请记录：书房采光好。', { room: '书房', field: 'daylight', value: '采光好', quote: '书房采光好' }, '已记录书房采光好，原书桌靠门的需求继续沿用。');
  assert.equal(daylight.run.status, 'succeeded');
  await withTenantTransaction(actor.enterpriseId, async tx => {
    await tx.execute(sql`update app.assistant_messages set content='{"version":1,"blocks":[{"type":"text","text":"合成撤回"}]}'::jsonb
      where enterprise_id=${actor.enterpriseId} and conversation_id=${a.id} and id=${String(saved.sent.messageId)}`);
    assert.equal(await needRunSourcesAvailable(tx, actor.enterpriseId, a.id, String(plain.id)), false);
    const c = await one(tx, sql`update app.assistant_conversations set last_seq=last_seq+1,version=version+1 where enterprise_id=${actor.enterpriseId} and id=${a.id} returning last_seq`);
    await tx.execute(sql`insert into app.assistant_messages(enterprise_id,conversation_id,seq,author_kind,content,purpose)
      values(${actor.enterpriseId},${a.id},${String(c!.last_seq)},'assistant','{"version":1,"blocks":[{"type":"text","text":"旧版回复：书房书桌靠门"}]}'::jsonb,'synthetic.legacy')`);
  });
  const history = await chat().messages(a.id);
  for (const run of [saved.run, plain, daylight.run]) assert.equal(history.items.find(m => m.id === run.outputMessageId)?.available, false);
  let inspected = false;
  await ask('书房书桌现在的位置还能确认吗？只讨论，不重新记录。', '当前书桌位置无法确认。', messages => {
    inspected = true; assert.doesNotMatch(JSON.stringify(messages), /靠门|历史版本/);
  });
  assert.equal(inspected, true);
  assert.equal(readMemory((await conversation(a.id))!.entry_snapshot).version, 303);
});

test('AG07: changing a current need source during the provider call blocks plain reply delivery and retains the durable source guard', async () => {
  const a = await fixture(), saved = await write(a.id, text, input); assert.equal(saved.run.status, 'succeeded');
  const sent = await chat().send(a.id, randomUUID(), { version: 1, blocks: [{ type: 'text', text: '书房目前情况怎样？只讨论。' }] });
  const lease = await claimJob(); assert.ok(lease); assert.equal(lease.runId, sent.runId);
  let calls = 0;
  await processAgentAnswer(lease, { model: async () => {
    calls++;
    await withTenantTransaction(actor.enterpriseId, tx => tx.execute(sql`update app.assistant_messages set content='{"version":1,"blocks":[{"type":"text","text":"合成撤回"}]}'::jsonb
      where enterprise_id=${actor.enterpriseId} and conversation_id=${a.id} and id=${String(saved.sent.messageId)}`));
    return response('书房书桌靠门。');
  } });
  const run = await chat().run(String(sent.runId));
  assert.equal(calls, 1); assert.equal(run.status, 'failed'); assert.equal(run.errorCode, 'context_changed'); assert.equal(run.outputMessageId, null);
  assert.equal(await withTenantTransaction(actor.enterpriseId, tx => needRunSourcesAvailable(tx, actor.enterpriseId, a.id, String(sent.runId))), false);
});
