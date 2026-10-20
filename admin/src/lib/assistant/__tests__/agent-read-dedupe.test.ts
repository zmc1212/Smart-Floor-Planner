import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runRenovationAgent, type AgentCheckpoint, type AgentRuntimePorts } from '../agent/runtime';
import { fitAgentContext, assertToolPairs } from '../agent/context-budget';
import type { ModelToolCall, ModelTurnOutput } from '../contracts/model';

const answer: ModelTurnOutput = { text: '有据回复', toolCalls: [], usage: null, finishReason: 'stop', providerRequestId: null };
const call = (id: string, args = '{}', name = 'search_knowledge'): ModelToolCall => ({ id, name, arguments: args });
const output = (...toolCalls: ModelToolCall[]): ModelTurnOutput => ({ ...answer, text: '', toolCalls });
function fixture(names = ['search_knowledge']) {
  const saved: AgentCheckpoint[] = [], reads: string[] = [];
  const ports: AgentRuntimePorts = {
    authorize: async () => {}, model: async () => answer,
    tool: async (_turn, _index, name, args) => { reads.push(name + ':' + args); return { content: '完整原文与条件' }; },
    checkpoint: async state => { saved.push(structuredClone(state)); },
  };
  const run = (resume?: AgentCheckpoint) => runRenovationAgent({
    messages: [{ role: 'user', content: [{ type: 'text', text: '合成资料问题' }] }],
    tools: names.map(name => ({ name, description: name, parameters: { type: 'object' } })), ports, resume,
  });
  return { saved, reads, ports, run };
}

test('identical successful reads keep one complete result and pair every duplicate without input growth', async () => {
  const f = fixture();
  const original = JSON.stringify({ text: '完整条款含前提和例外。'.repeat(800), sourceId: 'Ksame', version: 'v1' });
  f.ports.tool = async () => { f.reads.push('search'); return { content: original }; };
  f.ports.model = async (turn, messages) => {
    if (!turn) return output(call('first', '{"query":"间距","room":"厨房"}'), call('same-batch', '{ "room": "厨房", "query": "间距" }'));
    if (turn === 1) return output(call('next-turn', '{"room":"厨房","query":"间距"}'));
    assertToolPairs(messages);
    const results = messages.filter(m => m.role === 'tool');
    assert.deepEqual(results.map(m => m.callId), ['first', 'same-batch', 'next-turn']);
    assert.equal(results[0].content, original);
    for (const result of results.slice(1)) {
      assert.equal(JSON.parse(result.content).status, 'already_queried');
      assert.equal(JSON.parse(result.content).previousCallId, 'first');
      assert.equal(result.content.includes('完整条款'), false);
    }
    assert.doesNotThrow(() => fitAgentContext(messages, []));
    const repeated = messages.map(m => m.role === 'tool' ? { ...m, content: original } : m);
    assert.throws(() => fitAgentContext(repeated, []), /agent_input_limit/);
    return answer;
  };
  await f.run(); assert.equal(f.reads.length, 1);
  assert.equal(f.saved.at(-1)?.readReceipts?.length, 1);
});

test('different arguments and different read tools remain independent; writes always execute and invalidate read reuse', async () => {
  const f = fixture(['search_knowledge', 'recall_history', 'record_need']);
  f.ports.model = async turn => !turn ? output(call('a', '{"query":"间距"}'), call('b', '{"query":"屏蔽"}'),
    call('c', '{"query":"间距"}', 'recall_history')) : turn === 1 ? output(
    call('write1', '{}', 'record_need'), call('read-again', '{"query":"间距"}'), call('write2', '{}', 'record_need'), call('read-after-write', '{"query":"间距"}')) : answer;
  await f.run(); assert.equal(f.reads.length, 7);
  assert.equal(f.reads.filter(s => s.startsWith('record_need:')).length, 2);
  assert.equal(f.saved.at(-1)?.readReceipts?.length, 1);
});

test('checkpoint recovery reuses the original complete read after fresh authorization without replaying a tool', async () => {
  const f = fixture(); f.ports.model = async turn => !turn ? output(call('first', '{"query":"原条款"}')) : answer;
  await f.run(); const checkpoint = f.saved.find(s => s.turn === 1 && !s.output)!;
  const g = fixture(); let authorizations = 0;
  g.ports.authorize = async () => { authorizations++; };
  g.ports.model = async (turn, messages) => {
    if (turn === 1) return output(call('recovered', '{"query":"原条款"}'));
    assert.match(JSON.stringify(messages), /already_queried/); return answer;
  };
  await g.run(checkpoint); assert.equal(g.reads.length, 0); assert.ok(authorizations >= 5);
  const denied = fixture(); denied.ports.authorize = async () => { throw Error('source_revoked'); };
  await assert.rejects(denied.run(checkpoint), /source_revoked/);
  assert.equal(denied.reads.length, 0); assert.equal(denied.saved.length, 0);
});

test('read receipts cannot point at another call, user data, a write or a forged hash', async () => {
  const f = fixture(); f.ports.model = async turn => !turn ? output(call('first')) : answer;
  await f.run(); const checkpoint = f.saved.find(s => s.turn === 1 && !s.output)!;
  const receipt = checkpoint.readReceipts![0];
  for (const readReceipts of [
    [{ ...receipt, argumentsHash: 'forged' }], [{ ...receipt, messageIndex: 0 }],
    [{ ...receipt, messageIndex: 1000 }], [{ ...receipt, name: 'record_need' }], [receipt, receipt],
    [{ ...receipt, extra: true }], [null], 'not-an-array',
  ]) {
    await assert.rejects(f.run({ ...checkpoint, readReceipts } as AgentCheckpoint), /invalid_agent_checkpoint/);
  }
  const altered = structuredClone(checkpoint);
  const request = altered.messages.find(m => m.role === 'assistant' && m.toolCalls?.length)!;
  assert.equal(request.role, 'assistant'); request.toolCalls![0].arguments = '{"different":true}';
  await assert.rejects(f.run(altered), /invalid_agent_checkpoint/);
});

test('legacy checkpoints remain readable and newly successful reads establish bounded receipts', async () => {
  const f = fixture(); f.ports.model = async turn => !turn ? output(call('original')) : answer;
  await f.run(); const checkpoint = structuredClone(f.saved.find(s => s.turn === 1 && !s.output)!);
  delete checkpoint.readReceipts;
  const g = fixture(); g.ports.model = async turn => turn === 1 ? output(call('new-read'), call('duplicate')) : answer;
  await g.run(checkpoint); assert.equal(g.reads.length, 1);
  assert.equal(g.saved.at(-1)?.readReceipts?.length, 1);
});

test('deduplication preserves the original one-repair budget and complete final reconstruction context', async () => {
  const f = fixture(); let repairs = 0;
  f.ports.model = async (turn, messages, tools) => {
    if (!turn) return output(call('first'), call('duplicate'));
    if (turn === 2) { assert.deepEqual(tools, []); assert.match(JSON.stringify(messages), /完整原文与条件/); }
    return answer;
  };
  f.ports.validateFinal = async () => ++repairs === 1 ? { code: 'invalid_model_citation', feedback: '合成一次修复' } : null;
  f.ports.resolveFinal = async (text, state) => { assert.equal(state.readReceipts?.length, 1); return text; };
  const result = await f.run(); assert.equal(result.validationRepairs, 1); assert.equal(repairs, 2); assert.equal(f.reads.length, 1);
});

test('unknown tools, failed reads and unknown provider results do not acquire reusable receipts', async () => {
  const f = fixture(['new_tool']); f.ports.model = async turn => !turn ? output(call('a', '{}', 'new_tool'), call('b', '{}', 'new_tool')) : answer;
  await f.run(); assert.equal(f.reads.length, 2); assert.deepEqual(f.saved.at(-1)?.readReceipts, []);
  const failed = fixture(); failed.ports.model = async () => output(call('failed'));
  failed.ports.tool = async () => { throw Error('provider_outcome_unknown'); };
  await assert.rejects(failed.run(), /provider_outcome_unknown/);
  assert.deepEqual(failed.saved.at(-1)?.readReceipts, []);
  assert.equal(failed.saved.at(-1)?.turn, 0);
});
