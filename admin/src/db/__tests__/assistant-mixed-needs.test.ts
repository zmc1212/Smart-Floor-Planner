import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { AssistantRepository, one, rows, type Row } from '@/db/repositories/assistant-repository';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { processAgentAnswer, agentNeedBatchProtocol, agentNeedQuoteProtocol, agentNeedInputProtocol } from '@/lib/assistant/agent/worker';
import { agentChatBody } from '@/lib/ai/providers/agent-chat';
import { synthesisRepairBase } from '@/lib/assistant/agent/synthesis-repair';
import { persistNeedWrites } from '@/lib/assistant/agent/memory-store';
import { readMemory } from '@/lib/assistant/agent/memory';
import type { ActorContext } from '@/lib/assistant/contracts';
import type { ModelTurnOutput } from '@/lib/assistant/contracts/model';

const prefix = 'synthetic-mixed-needs-' + randomUUID(), tenants: string[] = [], users: string[] = [];
let actor: ActorContext, stranger: ActorContext;
const text = '更正：书房书桌改为靠内墙；预算改为18万元。另外，如果仍靠窗会有哪些取舍？后面是假设，不要保存。';
const desk = { room: '书房', field: 'desk', value: '书桌改为靠内墙', quote: '书房书桌改为靠内墙' };
const budget = { room: '', field: 'budget', value: '18万元', quote: '预算改为18万元' };
const complete = { ...desk, additionalNeeds: [budget] };
const answer = (): ModelTurnOutput => ({ text: JSON.stringify({ kind: 'general', text: '本次已记录书桌改为靠内墙和预算18万元。关于假设仍靠窗的取舍，一般建议考虑自然光与屏幕反光，具体布置仍需核对现场尺寸。' }),
  toolCalls: [], usage: { inputTokens: 100, outputTokens: 20 }, finishReason: 'stop', providerRequestId: null });
const call = (args: unknown, id = 'need') => ({ ...answer(), text: '', toolCalls: [{ id, name: 'record_need', arguments: JSON.stringify(args) }] });
before(async () => {
  const url = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.equal(url.port, '55432'); assert.equal(url.pathname, '/xiaok_embedding_eval');
  await withPlatformTransaction(async tx => {
    for (let i = 0; i < 2; i++) {
      const e = (await one(tx, sql`insert into app.enterprises(name,code,status) values(${prefix+i},${prefix+i},'active') returning id`))!; tenants.push(String(e.id));
      await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config)
        values(${tenants[i]},true,1000,12000000,1000000000,30,${JSON.stringify({ runtime: 'langgraph-v1', model: 'Qwen/Qwen3.5-4B', providerKey: 'siliconflow', imageInput: true, tools: true, probeVersion: 'p2m0-synthetic-v1' })}::jsonb)`);
      const u = (await one(tx, sql`insert into app.users(nickname,context_version) values(${prefix+i},1) returning id`))!; users.push(String(u.id));
      await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${users[i]},${prefix+i})`);
    }
  });
  actor = { enterpriseId: tenants[0], principal: { kind: 'user', userId: users[0] }, contextVersion: 1, capabilities: ['assistant.chat.self'] };
  stranger = { ...actor, enterpriseId: tenants[1], principal: { kind: 'user', userId: users[1] } };
});
after(async () => {
  try { await withPlatformTransaction(async tx => {
    for (const t of tenants) { await deleteAssistantData(tx, BigInt(t)); await tx.execute(sql`delete from app.enterprises where id=${t}`); }
    for (const u of users) await tx.execute(sql`delete from app.users where id=${u}`);
  }); } finally { await closePostgresPool(); }
});
async function start(question = text) {
  const chat = new ConversationService(actor), c = String((await chat.create(randomUUID())).id);
  const sent = await chat.send(c, randomUUID(), { version: 1, blocks: [{ type: 'text', text: question }] });
  const lease = await claimJob(); assert.ok(lease); assert.equal(lease.runId, sent.runId);
  return { chat, c, sent, lease };
}
async function memory(c: string) {
  return readMemory((await withTenantTransaction(actor.enterpriseId, tx => one(tx, sql`select entry_snapshot from app.assistant_conversations where enterprise_id=${actor.enterpriseId} and id=${c}`)))?.entry_snapshot);
}
async function writes(runId: string) {
  return withTenantTransaction(actor.enterpriseId, tx => rows(tx, sql`select step_seq,input_summary,private_checkpoint from app.assistant_run_steps
    where enterprise_id=${actor.enterpriseId} and run_id=${runId} and kind='agent_need_write' order by step_seq`));
}
const finalText = (text: string): ModelTurnOutput => ({ ...answer(), text: JSON.stringify({ kind: 'general', text }) });
async function validations(runId: string) {
  return withTenantTransaction(actor.enterpriseId, tx => rows(tx, sql`select input_summary from app.assistant_run_steps
    where enterprise_id=${actor.enterpriseId} and run_id=${runId} and kind='agent_validation' order by step_seq`));
}

test('mixed correction incomplete proposals roll back then save one complete batch before answering the separate question', async () => {
  const a = await start(); let calls = 0;
  await processAgentAnswer(a.lease, { model: async (messages, tools) => {
    calls++;
    if (calls === 1) return call(desk);
    if (calls === 2) {
      const feedback = JSON.parse((messages.at(-1) as { content: string }).content);
      assert.equal(feedback.error, 'need_write_incomplete'); assert.equal(feedback.batchCommitted, false);
      assert.deepEqual(feedback.missingStatements, ['预算改为18万元']); assert.deepEqual(await memory(a.c), { version: 0, facts: [] });
      return call(complete, 'complete');
    }
    assert.equal(tools.some(t => t.name === 'record_need'), false, 'A completed bounded statement no longer offers a repeated save');
    return answer();
  } });
  assert.equal((await a.chat.run(String(a.sent.runId))).status, 'succeeded'); assert.equal(calls, 3);
  const state = await memory(a.c); assert.equal(state.version, 2); assert.equal(state.facts.length, 2);
  assert.deepEqual(state.facts.map(f => [f.room, f.field, f.value]), [['书房','desk','书桌改为靠内墙'],['','budget','18万元']]);
  assert.equal((await writes(String(a.sent.runId))).length, 1);
  const reply = (await new ConversationService(actor).messages(a.c)).items.filter(m => m.authorKind === 'assistant').at(-1)!;
  assert.equal(reply.available, true); assert.match(JSON.stringify(reply.content), /取舍|反光/);
  assert.equal(state.facts.some(f => f.value === '靠窗'), false);
});

test('mixed correction atomic envelope retains paired errors and requires complete resubmission after alternating rejections', async () => {
  const a = await start(); let calls = 0;
  await processAgentAnswer(a.lease, { model: async (messages, _tools, _turn, dispatch) => {
    calls++;
    if (calls === 4) { assert.equal(dispatch!.some(t => t.name === 'record_need'), false); return answer(); }
    const wire = agentChatBody({ model: 'Qwen/Qwen3.5-4B', messages, tools: dispatch!, maxTokens: 100 });
    const schema = wire.tools!.find(t => t.function.name === 'record_need')!.function.parameters as {
      required: string[]; properties: { additionalNeeds: { minItems: number; maxItems: number } };
    };
    assert.ok(schema.required.includes('additionalNeeds'));
    assert.equal(schema.properties.additionalNeeds.minItems, calls === 1 ? 0 : 1);
    assert.equal(schema.properties.additionalNeeds.maxItems, 3);
    assert.deepEqual(await memory(a.c), { version: 0, facts: [] }, 'Two rejected rounds must never be accumulated into a save');
    if (calls > 1) {
      const results = messages.filter(m => m.role === 'tool');
      const latest = results.at(-1)!; assert.equal(latest.role, 'tool');
      const feedback = JSON.parse(latest.content);
      assert.equal(feedback.error, 'need_write_incomplete'); assert.equal(feedback.batchCommitted, false);
      assert.deepEqual(feedback.missingStatements, [calls === 2 ? '预算改为18万元' : '书房书桌改为靠内墙']);
      const serialized = wire.messages.find(m => m.role === 'tool' && 'tool_call_id' in m && m.tool_call_id === latest.callId)!;
      assert.equal(serialized.content, latest.content, 'Actual provider transport retains the paired error verbatim');
    }
    return call(calls === 1 ? desk : calls === 2 ? budget : complete, 'batch-' + calls);
  } });
  assert.equal((await a.chat.run(String(a.sent.runId))).status, 'succeeded'); assert.equal(calls, 4);
  assert.equal((await memory(a.c)).version, 2); assert.equal((await writes(String(a.sent.runId))).length, 1);
  const steps = await withTenantTransaction(actor.enterpriseId, tx => rows(tx, sql`select input_summary,private_checkpoint from app.assistant_run_steps
    where enterprise_id=${actor.enterpriseId} and run_id=${String(a.sent.runId)} and kind='agent_model' order by step_seq`));
  assert.ok(steps.slice(0, 3).every(s => (s.input_summary as Row).needInputProtocol === agentNeedInputProtocol));
  assert.equal((steps[3].input_summary as Row).needInputProtocol, null);
  const firstRaw = (steps[0].private_checkpoint as { providerOutput: ModelTurnOutput }).providerOutput;
  assert.deepEqual(JSON.parse(firstRaw.toolCalls[0].arguments), desk, 'The original omitted array is retained, never server-filled');
});

test('mixed correction parallel model-selected needs become one atomic batch and keep the complete raw provider packet', async () => {
  const a = await start(); let calls = 0;
  await processAgentAnswer(a.lease, { model: async () => {
    calls++;
    return calls === 1 ? { ...answer(), text: '', toolCalls: [...call(desk, 'desk').toolCalls, ...call(budget, 'budget').toolCalls] } : answer();
  } });
  assert.equal((await a.chat.run(String(a.sent.runId))).status, 'succeeded'); assert.equal(calls, 2);
  assert.equal((await memory(a.c)).version, 2); assert.equal((await writes(String(a.sent.runId))).length, 1);
  const steps = await withTenantTransaction(actor.enterpriseId, tx => rows(tx, sql`select kind,input_summary,private_checkpoint from app.assistant_run_steps
    where enterprise_id=${actor.enterpriseId} and run_id=${String(a.sent.runId)}`));
  const model = steps.find(s => (s.input_summary as Row)?.needBatchProtocol === agentNeedBatchProtocol)!;
  assert.ok(model); assert.deepEqual((model.input_summary as Row).needBatchCallIds, ['desk','budget']);
  const packet = model.private_checkpoint as { providerOutput: { toolCalls: unknown[] }; toolCalls: unknown[] };
  assert.equal(packet.providerOutput.toolCalls.length, 2); assert.equal(packet.toolCalls.length, 1);
  assert.equal(steps.filter(s => s.kind === 'agent_need_receipt').length, 0, 'Mixed questions retain the model answer path');
});

test('mixed correction rejects an unrelated budget room before committing any field and retains tenant isolation', async () => {
  const a = await start();
  await assert.rejects(withTenantTransaction(actor.enterpriseId, async tx => {
    const conversation = await new AssistantRepository(tx, actor).conversation(a.c);
    await persistNeedWrites(tx, actor, conversation, { runId: String(a.sent.runId), turn: 0, index: 0, sourceMessageId: String(a.sent.messageId) },
      { ...desk, additionalNeeds: [{ ...budget, room: '书房' }] });
  }), /need_source_mismatch/);
  assert.deepEqual(await memory(a.c), { version: 0, facts: [] });
  await assert.rejects(new ConversationService(stranger).messages(a.c), /not_found/);
  let calls = 0;
  await processAgentAnswer(a.lease, { model: async () => ++calls === 1 ? call(complete) : answer() });
  assert.equal((await a.chat.run(String(a.sent.runId))).status, 'succeeded'); assert.equal((await memory(a.c)).version, 2);
});

test('mixed correction repeated calls reuse current facts across turns and original-key replay without advancing versions', async () => {
  const a = await start();
  const persist = (turn: number) => withTenantTransaction(actor.enterpriseId, async tx => {
    const conversation = await new AssistantRepository(tx, actor).conversation(a.c);
    return persistNeedWrites(tx, actor, conversation, { runId: String(a.sent.runId), turn, index: 0, sourceMessageId: String(a.sent.messageId) }, complete);
  });
  const first = JSON.parse((await persist(0)).content), second = JSON.parse((await persist(1)).content);
  assert.deepEqual(second, first); assert.deepEqual(JSON.parse((await persist(1)).content), first);
  const state = await memory(a.c); assert.equal(state.version, 2); assert.equal(state.facts.length, 2);
  const saved = await writes(String(a.sent.runId)); assert.equal(saved.length, 2);
  assert.equal((saved[1].input_summary as Row).fromVersion, 2); assert.equal((saved[1].input_summary as Row).toVersion, 2);
  await withTenantTransaction(actor.enterpriseId, tx => tx.execute(sql`update app.assistant_messages set content='{"version":1,"blocks":[{"type":"text","text":"合成来源已撤回"}]}'::jsonb
    where enterprise_id=${actor.enterpriseId} and id=${String(a.sent.messageId)}`));
  await assert.rejects(persist(2), /need_source_mismatch/);
  await processAgentAnswer(a.lease, { model: async () => answer() });
  assert.notEqual((await a.chat.run(String(a.sent.runId))).status, 'succeeded');
  assert.equal((await new ConversationService(actor).messages(a.c)).items.filter(m => m.authorKind === 'assistant' && m.available).length, 0);
});

test('mixed correction a saved receipt alone receives one final repair that must answer the independent hypothesis', async () => {
  const a = await start(); let calls = 0;
  await processAgentAnswer(a.lease, { model: async (messages, tools) => {
    calls++;
    if (calls === 1) return call(complete);
    if (calls === 2) return finalText('本次已记录书桌改为靠内墙和预算18万元。后面的假设不保存。');
    assert.equal(tools.length, 0);
    const feedback = messages.flatMap(m => m.role === 'system' ? m.content.filter(p => p.type === 'text').map(p => p.text) : []).join('\n');
    assert.match(feedback, /不取消回答/); assert.match(feedback, /savedFacts/);
    return answer();
  } });
  const result = await new ConversationService(actor).run(String(a.sent.runId));
  assert.equal(result.status, 'succeeded'); assert.equal(calls, 3);
  assert.equal((await memory(a.c)).version, 2); assert.equal((await writes(String(a.sent.runId))).length, 1);
  assert.equal((await validations(String(a.sent.runId))).length, 1);
  const reply = (await new ConversationService(actor).messages(a.c)).items.find(m => m.id === result.outputMessageId)!;
  assert.equal(reply.available, true); assert.match(JSON.stringify(reply.content), /自然光与屏幕反光/);
});

test('mixed correction current original numeric recovery repairs only the answer after one committed batch', async () => {
  for (const mode of ['cite', 'remove', 'still-invalid', 'withdrawn-source']) {
    const a = await start(); let calls = 0;
    const first = { kind: 'synthesis', segments: [{ basis: 'advice', text: '如果仍靠窗，一般可利用自然光，但要注意屏幕反光，具体布置仍需核对现场。', citations: [] },
      { basis: 'advice', text: '预算从20万元调整为18万元，建议优先保证基础质量。', citations: [] }] };
    await processAgentAnswer(a.lease, { model: async (messages, tools, _turn, dispatch) => {
      calls++;
      if (calls === 1) return call(complete);
      if (calls === 2) return { ...answer(), text: JSON.stringify(first) };
      assert.equal(calls, 3); assert.equal(tools.length, 0);
      const base = synthesisRepairBase(messages); assert.ok(base);
      const feedback = messages.flatMap(m => m.role === 'system' ? m.content.filter(p => p.type === 'text').map(p => p.text) : []).join('\n');
      assert.match(feedback, /currentOriginalNumericPaths/);
      assert.ok(dispatch?.every(t => t.name === 'final_response'));
      const source = messages.flatMap(m => m.role === 'tool' ? [JSON.parse(m.content)] : [])
        .flatMap(packet => Array.isArray(packet.synthesisSources) ? packet.synthesisSources : [])
        .find((s: Row) => s.sourceId === 'H' + a.sent.messageId);
      assert.ok(source?.citationOptions?.length);
      if (mode === 'withdrawn-source') await withTenantTransaction(actor.enterpriseId, tx => tx.execute(sql`update app.assistant_messages
        set content='{"version":1,"blocks":[{"type":"text","text":"合成原话撤回"}]}'::jsonb
        where enterprise_id=${actor.enterpriseId} and conversation_id=${a.c} and id=${String(a.sent.messageId)}`));
      const edit = mode === 'remove' ? { segment: 1, remove: true } : { segment: 1,
        text: mode === 'still-invalid' ? '预算从20万元调整为18万元。' : '本轮客户原话把预算更正为18万元。',
        addCitationIds: [source.citationOptions[0].citationId] };
      return { ...answer(), text: JSON.stringify({ kind: 'synthesis_repair', baseHash: base.baseHash, edits: [edit] }) };
    } });
    const result = await new ConversationService(actor).run(String(a.sent.runId));
    assert.equal(calls, 3); assert.equal((await writes(String(a.sent.runId))).length, 1);
    const state = await memory(a.c); assert.equal(state.version, 2); assert.equal(state.facts.length, 2);
    assert.equal((await validations(String(a.sent.runId))).length, 1);
    const reentry = await new ConversationService(actor).messages(a.c);
    if (mode === 'cite' || mode === 'remove') {
      assert.equal(result.status, 'succeeded');
      const reply = reentry.items.find(m => m.id === result.outputMessageId)!; assert.equal(reply.available, true);
      assert.match(JSON.stringify(reply.content), /自然光.*屏幕反光/); assert.doesNotMatch(JSON.stringify(reply.content), /20万元/);
      await assert.rejects(new ConversationService(stranger).messages(a.c), /not_found/);
      if (mode === 'cite') {
        await withTenantTransaction(actor.enterpriseId, tx => tx.execute(sql`update app.assistant_messages
          set content='{"version":1,"blocks":[{"type":"text","text":"合成原话撤回"}]}'::jsonb
          where enterprise_id=${actor.enterpriseId} and conversation_id=${a.c} and id=${String(a.sent.messageId)}`));
        assert.equal((await new ConversationService(actor).messages(a.c)).items.find(m => m.id === result.outputMessageId)!.available, false);
      }
    } else {
      assert.equal(result.status, 'failed'); assert.equal(result.outputMessageId, null);
      assert.equal(result.errorCode, mode === 'still-invalid' ? 'unsupported_model_commitment' : 'context_changed');
    }
    assert.deepEqual(await memory(a.c), state);
  }
});

test('mixed correction exact original and budget scope diagnostics recover the full atomic batch', async () => {
  const a = await start(); let calls = 0;
  await processAgentAnswer(a.lease, { model: async (messages) => {
    calls++;
    if (calls === 1) return call({ ...desk, quote: '书房书桌改为靠内墙。预算改为18万元', additionalNeeds: [{ ...budget, room: '书房' }] });
    if (calls === 2) {
      const feedback = JSON.parse((messages.at(-1) as { content: string }).content);
      assert.equal(feedback.batchCommitted, false); assert.equal(feedback.assertionText, '更正：书房书桌改为靠内墙；预算改为18万元');
      assert.deepEqual(feedback.submittedWrites.map((w: Row) => [w.quoteIsOriginal,w.validationError]), [[false,'need_source_mismatch'],[true,'need_source_mismatch']]);
      assert.deepEqual(await memory(a.c), { version: 0, facts: [] });
      return call(complete);
    }
    return answer();
  } });
  assert.equal((await a.chat.run(String(a.sent.runId))).status, 'succeeded'); assert.equal(calls, 3);
  assert.equal((await memory(a.c)).version, 2); assert.equal((await writes(String(a.sent.runId))).length, 1);
});

test('mixed correction original quote catalog reaches dispatch and recovers rejected raw proposals without server-filled needs', async () => {
  for (const injectBadQuote of [false, true]) {
    const a = await start(); let calls = 0;
    const bad = { ...desk, quote: '更正：书房书桌改为靠内墙。', additionalNeeds: [{ ...budget, quote: '更正：预算改为18万元。' }] };
    await processAgentAnswer(a.lease, { model: async (messages, tools, _turn, dispatch) => {
      calls++;
      const active = tools.find(t => t.name === 'record_need');
      if (calls === (injectBadQuote ? 3 : 2)) { assert.equal(active, undefined); return answer(); }
      const schema = dispatch!.find(t => t.name === 'record_need')!.parameters as {
        properties: { quote: { enum: string[] }; additionalNeeds: { items: { properties: { quote: { enum: string[] } } } } };
      };
      const options = schema.properties.quote.enum;
      assert.deepEqual(options, ['更正：书房书桌改为靠内墙', '预算改为18万元']);
      assert.deepEqual(schema.properties.additionalNeeds.items.properties.quote.enum, options);
      if (injectBadQuote && calls === 1) return call(bad, 'bad-original');
      assert.deepEqual(await memory(a.c), { version: 0, facts: [] });
      if (injectBadQuote) {
        const result = messages.find(m => m.role === 'tool' && m.callId === 'bad-original');
        assert.ok(result && result.role === 'tool');
        const feedback = JSON.parse(result.content);
        assert.equal(feedback.batchCommitted, false); assert.deepEqual(feedback.quoteOptions, options);
        assert.ok(feedback.submittedWrites.every((w: Row) => w.quoteIsOriginal === false && w.validationError === 'need_source_mismatch'));
      }
      return call({ ...desk, quote: options[0], additionalNeeds: [{ ...budget, quote: options[1] }] }, 'selected-originals');
    } });
    const result = await new ConversationService(actor).run(String(a.sent.runId));
    assert.equal(result.status, 'succeeded'); assert.equal(calls, injectBadQuote ? 3 : 2);
    const state = await memory(a.c); assert.equal(state.version, 2); assert.equal(state.facts.length, 2);
    assert.deepEqual(state.facts.map(f => [f.room, f.field, f.value, f.quote]), [
      ['书房','desk',desk.value,'更正：书房书桌改为靠内墙'], ['', 'budget', '18万元', '预算改为18万元'],
    ]);
    assert.equal((await writes(String(a.sent.runId))).length, 1);
    const steps = await withTenantTransaction(actor.enterpriseId, tx => rows(tx, sql`select kind,input_summary,private_checkpoint from app.assistant_run_steps
      where enterprise_id=${actor.enterpriseId} and run_id=${String(a.sent.runId)} order by step_seq`));
    assert.ok(steps.filter(s => s.kind === 'agent_model').some(s => (s.input_summary as Row).needQuoteProtocol === agentNeedQuoteProtocol));
    if (injectBadQuote) {
      const original = steps.find(s => s.kind === 'agent_model')!.private_checkpoint as { toolCalls: Array<{ arguments: string }> };
      assert.deepEqual(JSON.parse(original.toolCalls[0].arguments), bad, 'Invalid raw parameters are retained, never rewritten');
    }
    const reentry = await new ConversationService(actor).messages(a.c);
    const reply = reentry.items.find(m => m.id === result.outputMessageId)!;
    assert.equal(reply.available, true); assert.match(JSON.stringify(reply.content), /自然光与屏幕反光/);
    await assert.rejects(new ConversationService(stranger).messages(a.c), /not_found/);
    assert.deepEqual(await memory(a.c), state);
  }
});

test('mixed correction failed arguments cannot acknowledge completed updates and the final repair never saves them', async () => {
  const a = await start(); let calls = 0;
  await processAgentAnswer(a.lease, { model: async (messages, tools) => {
    calls++;
    if (calls === 1) return call({ ...complete, quote: '书房书桌改为靠内墙。预算改为18万元' });
    if (calls === 2) return finalText('书桌位置已更改为靠内墙，预算也调整为18万元。后面是假设，不保存。');
    assert.equal(tools.length, 0); assert.match(JSON.stringify(messages.at(-1)), /\\"savedFacts\\":\[\]/);
    assert.deepEqual(await memory(a.c), { version: 0, facts: [] });
    return finalText('本次没有保存成功。一般建议：靠窗能利用自然采光，但直射光容易造成屏幕反光，也要留出开窗空间。');
  } });
  const result = await a.chat.run(String(a.sent.runId)); assert.equal(result.status, 'succeeded'); assert.equal(calls, 3);
  assert.deepEqual(await memory(a.c), { version: 0, facts: [] }); assert.equal((await writes(String(a.sent.runId))).length, 0);
  const failed = await validations(String(a.sent.runId)); assert.equal((failed[0].input_summary as Row).code, 'unsupported_model_commitment');
  const reply = (await new ConversationService(actor).messages(a.c)).items.find(m => m.id === result.outputMessageId)!;
  assert.match(JSON.stringify(reply.content), /没有保存成功/); assert.doesNotMatch(JSON.stringify(reply.content), /已更改|调整为18/);
});

test('mixed correction repeated receipt-only replies fail after the single repair without an extra model loop', async () => {
  const a = await start(); let calls = 0;
  await processAgentAnswer(a.lease, { model: async () => {
    calls++; return calls === 1 ? call(complete) : finalText('已记录书桌和预算。后面的假设不保存。');
  } });
  const result = await a.chat.run(String(a.sent.runId)); assert.equal(result.status, 'failed'); assert.equal(result.errorCode, 'ungrounded_response_scope');
  assert.equal(calls, 3); assert.equal(result.outputMessageId, null); assert.equal((await memory(a.c)).version, 2);
  assert.equal((await writes(String(a.sent.runId))).length, 1); assert.equal((await validations(String(a.sent.runId))).length, 2);
  assert.equal((await new ConversationService(actor).messages(a.c)).items.filter(m => m.authorKind === 'assistant' && m.available).length, 0);
});

test('mixed correction a later historical recap keeps the actual old update without claiming a new save', async () => {
  const a = await start(); let calls = 0;
  await processAgentAnswer(a.lease, { model: async () => ++calls === 1 ? call(complete) : answer() });
  const sent = await a.chat.send(a.c, randomUUID(), { version: 1, blocks: [{ type: 'text', text: '只回顾本次聊天原话，书桌和预算当前是什么？' }] });
  const lease = await claimJob(); assert.ok(lease); assert.equal(lease.runId, sent.runId);
  let recaps = 0;
  await processAgentAnswer(lease, { model: async () => { recaps++; return finalText('之前书桌位置已更改为靠内墙，预算也调整为18万元。当前沿用原工作记录。'); } });
  assert.equal((await a.chat.run(String(sent.runId))).status, 'succeeded'); assert.equal(recaps, 1);
  assert.equal((await memory(a.c)).version, 2); assert.equal((await writes(String(sent.runId))).length, 0);
  assert.equal((await validations(String(sent.runId))).length, 0);
});

const recapQuestion = '只回顾本次聊天原话，书桌和预算当前是什么？';
const currentRecap = '当前工作记录：书桌位置已更改为靠内墙，预算已调整为18万元。';
async function storedConversation() {
  const a = await start(); let calls = 0;
  await processAgentAnswer(a.lease, { model: async () => ++calls === 1 ? call(complete) : answer() });
  assert.equal((await a.chat.run(String(a.sent.runId))).status, 'succeeded');
  return a;
}
async function nextRecap(a: Awaited<ReturnType<typeof start>>) {
  const sent = await a.chat.send(a.c, randomUUID(), { version: 1, blocks: [{ type: 'text', text: recapQuestion }] });
  const lease = await claimJob(); assert.ok(lease); assert.equal(lease.runId, sent.runId);
  return { sent, lease };
}

test('mixed correction an exclusive current recap passes both final submission paths with no new write', async () => {
  for (const synthesis of [false, true]) {
    const a = await storedConversation(), before = await memory(a.c), recap = await nextRecap(a); let calls = 0;
    await processAgentAnswer(recap.lease, { model: async (messages) => {
      calls++;
      if (!synthesis) return finalText(currentRecap);
      if (calls === 1) return { ...answer(), text: '', toolCalls: [{ id: 'history', name: 'recall_history', arguments: JSON.stringify({ query: '书桌 预算' }) }] };
      const source = messages.flatMap(m => m.role === 'tool' ? [JSON.parse(m.content)] : [])
        .flatMap(packet => Array.isArray(packet.synthesisSources) ? packet.synthesisSources : [])
        .find((s: Row) => s.sourceId === 'H' + a.sent.messageId);
      assert.ok(source?.citationOptions?.length);
      return { ...answer(), text: JSON.stringify({ kind: 'synthesis', segments: [{ basis: 'evidence', text: currentRecap,
        citations: [{ citationId: source.citationOptions[0].citationId }] }] }) };
    } });
    const result = await new ConversationService(actor).run(String(recap.sent.runId));
    assert.equal(result.status, 'succeeded'); assert.equal(calls, synthesis ? 2 : 1);
    assert.deepEqual(await memory(a.c), before); assert.equal((await writes(String(recap.sent.runId))).length, 0);
    assert.equal((await validations(String(recap.sent.runId))).length, 0);
    const reply = (await new ConversationService(actor).messages(a.c)).items.find(m => m.id === result.outputMessageId)!;
    assert.equal(reply.available, true); assert.match(JSON.stringify(reply.content), /预算已调整为18万元/);
    await assert.rejects(new ConversationService(stranger).messages(a.c));
  }
});

test('mixed correction exclusive current recap rejects a new acknowledgement and unavailable source at commit', async () => {
  for (const mode of ['new-action', 'withdrawn-source']) {
    const a = await storedConversation();
    if (mode === 'withdrawn-source') await withTenantTransaction(actor.enterpriseId, tx => tx.execute(sql`update app.assistant_messages
      set content='{"version":1,"blocks":[{"type":"text","text":"合成原话已撤回"}]}'::jsonb
      where enterprise_id=${actor.enterpriseId} and conversation_id=${a.c} and id=${String(a.sent.messageId)}`));
    const recap = await nextRecap(a), before = await memory(a.c); let calls = 0;
    await processAgentAnswer(recap.lease, { model: async () => { calls++; return finalText(mode === 'new-action'
      ? '本轮预算已调整为18万元。' : '当前工作记录：预算已调整为18万元。'); } });
    const result = await a.chat.run(String(recap.sent.runId));
    assert.equal(result.status, 'failed'); assert.equal(result.errorCode, 'unsupported_model_commitment');
    assert.equal(calls, 1); assert.equal(result.outputMessageId, null);
    assert.deepEqual(await memory(a.c), before); assert.equal((await writes(String(recap.sent.runId))).length, 0);
  }
});

test('mixed correction current need numeric recovery binds prior saved budget originals without another write', async () => {
  for (const mode of ['cite', 'remove', 'still-invalid', 'withdrawn-source']) {
    const a = await start('请记住：全屋预算20万元。');
    await processAgentAnswer(a.lease, { model: async () => call({ room: '', field: 'budget', value: '20万元', quote: '全屋预算20万元', additionalNeeds: [] }) });
    assert.equal((await a.chat.run(String(a.sent.runId))).status, 'succeeded');
    const changed = await a.chat.send(a.c, randomUUID(), { version: 1, blocks: [{ type: 'text', text: '更正：预算改为18万元。' }] });
    const changeLease = await claimJob(); assert.ok(changeLease); assert.equal(changeLease.runId, changed.runId);
    await processAgentAnswer(changeLease, { model: async () => call({ ...budget, additionalNeeds: [] }) });
    assert.equal((await a.chat.run(String(changed.runId))).status, 'succeeded');
    const before = await memory(a.c); assert.equal(before.version, 2);
    const sent = await a.chat.send(a.c, randomUUID(), { version: 1, blocks: [{ type: 'text', text: '我当前预算记的是多少？' }] });
    const lease = await claimJob(); assert.ok(lease); assert.equal(lease.runId, sent.runId); let calls = 0; let modelError: unknown;
    await processAgentAnswer(lease, { model: async (messages, tools, _turn, dispatch) => {
      try {
      calls++;
      if (calls === 1) return { ...answer(), text: '', toolCalls: [{ id: 'budget-history', name: 'recall_history', arguments: '{"query":"预算"}' }] };
      const sources = messages.flatMap(m => m.role === 'tool' ? [JSON.parse(m.content)] : [])
        .flatMap(packet => Array.isArray(packet.synthesisSources) ? packet.synthesisSources : []);
      const current = sources.find((s: Row) => s.sourceId === 'H' + changed.messageId), old = sources.find((s: Row) => s.sourceId === 'H' + a.sent.messageId);
      assert.ok(current?.citationOptions?.length); assert.ok(old?.citationOptions?.length);
      if (calls === 2) return { ...answer(), text: JSON.stringify({ kind: 'synthesis', segments: [
        { basis: 'evidence', text: '根据您在本咨询中的记录，当前预算为18万元。', citations: [{ citationId: current.citationOptions[0].citationId }] },
        { basis: 'advice', text: '此前曾记录过20万元预算，后已更正为18万元。', citations: [{ citationId: old.citationOptions[0].citationId }] },
      ] }) };
      assert.equal(calls, 3); assert.equal(tools.length, 0); assert.ok(dispatch?.every(t => t.name === 'final_response'));
      const base = synthesisRepairBase(messages); assert.ok(base);
      assert.match(messages.flatMap(m => m.role === 'system' ? m.content.filter(p => p.type === 'text').map(p => p.text) : []).join('\n'), /currentNeedNumericPaths/);
      if (mode === 'withdrawn-source') await withTenantTransaction(actor.enterpriseId, tx => tx.execute(sql`update app.assistant_messages
        set content='{"version":1,"blocks":[{"type":"text","text":"合成预算来源撤回"}]}'::jsonb
        where enterprise_id=${actor.enterpriseId} and conversation_id=${a.c} and id=${String(changed.messageId)}`));
      const edit = mode === 'remove' ? { segment: 1, remove: true } : mode === 'still-invalid'
        ? { segment: 1, text: '此前预算20万元，当前预算为30万元。', addCitationIds: [current.citationOptions[0].citationId] }
        : { segment: 1, addCitationIds: [current.citationOptions[0].citationId] };
      return { ...answer(), text: JSON.stringify({ kind: 'synthesis_repair', baseHash: base.baseHash, edits: [edit] }) };
      } catch (error) { modelError = error; throw error; }
    } });
    assert.equal(modelError, undefined, modelError instanceof Error ? modelError.stack : String(modelError));
    const result = await a.chat.run(String(sent.runId)); assert.equal(calls, 3);
    assert.equal((await writes(String(a.sent.runId))).length, 1); assert.equal((await writes(String(changed.runId))).length, 1);
    assert.equal((await writes(String(sent.runId))).length, 0); assert.deepEqual(await memory(a.c), before);
    assert.equal((await validations(String(sent.runId))).length, 1);
    const reentry = await a.chat.messages(a.c);
    if (mode === 'cite' || mode === 'remove') {
      assert.equal(result.status, 'succeeded');
      const reply = reentry.items.find(m => m.id === result.outputMessageId)!; assert.equal(reply.available, true);
      assert.match(JSON.stringify(reply.content), /当前预算为18万元/);
      await assert.rejects(new ConversationService(stranger).messages(a.c), /not_found/);
      if (mode === 'cite') {
        await withTenantTransaction(actor.enterpriseId, tx => tx.execute(sql`update app.assistant_messages
          set content='{"version":1,"blocks":[{"type":"text","text":"合成预算来源撤回"}]}'::jsonb
          where enterprise_id=${actor.enterpriseId} and conversation_id=${a.c} and id=${String(changed.messageId)}`));
        assert.equal((await a.chat.messages(a.c)).items.find(m => m.id === result.outputMessageId)!.available, false);
      }
    } else {
      assert.equal(result.status, 'failed'); assert.equal(result.outputMessageId, null);
      assert.equal(result.errorCode, mode === 'still-invalid' ? 'unsupported_model_commitment' : 'context_changed');
    }
  }
});
