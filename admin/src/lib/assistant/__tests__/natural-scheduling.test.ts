import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ModelMessage, ModelTurnOutput } from '../contracts/model';
import { runRenovationAgent, type AgentCheckpoint, type AgentRuntimePorts } from '../agent/runtime';
import { naturalKnowledgeRuntimeBudget, naturalKnowledgeReadComplete, naturalKnowledgeScheduleProtocol, assertExplanationDispatchBudget } from '../agent/knowledge-explanation';

const read = { name: 'search_knowledge', description: 'knowledge', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } };
const schedule = () => naturalKnowledgeRuntimeBudget({ policy: naturalKnowledgeScheduleProtocol, natural: true, images: 0, tools: [read] })!;
const output = (text: string): ModelTurnOutput => ({ text, toolCalls: [], finishReason: 'stop', usage: null, providerRequestId: null });
const question: ModelMessage[] = [{ role: 'user', content: [{ type: 'text', text: '先铺管还是先穿线，为什么？' }] }];

test('historical runs, images and action turns retain their existing allocation', () => {
  const input = { policy: naturalKnowledgeScheduleProtocol, natural: true, images: 0, tools: [read] };
  for (const change of [{ policy: undefined }, { natural: false }, { images: 1 }, { tools: [{ ...read, name: 'record_need' }] },
    { tools: [{ ...read, name: 'new_unregistered_read' }] }]) assert.equal(naturalKnowledgeRuntimeBudget({ ...input, ...change }), undefined);
  assert.equal(schedule().maxScheduledCalls, 5);
});

function fixture(semanticFailure = true, rejectRepair = false) {
  const calls: string[] = [], checkpoints: AgentCheckpoint[] = [], primaryCache = new Map<number, ModelTurnOutput>(), reviewCache = new Map<number, null | { code: string; feedback: string }>();
  let toolExecutions = 0, allowed = true;
  const dispatch = (purpose: string) => { assertExplanationDispatchBudget(calls.map(() => 100), 100, 72000); calls.push(purpose); };
  const ports: AgentRuntimePorts = {
    authorize: async () => { if (!allowed) throw Error('context_changed'); },
    checkpoint: async state => { checkpoints.push(structuredClone(state)); },
    model: async (turn, _messages, tools) => {
      if (primaryCache.has(turn)) return primaryCache.get(turn)!;
      dispatch('answer');
      if (turn === 0) assert.deepEqual(tools.map(t => t.name), ['search_knowledge']);
      else assert.deepEqual(tools, [], 'Neither normal final nor repair can consume its reserved slots on another lookup');
      const result = turn === 0 ? { ...output(''), toolCalls: [{ id: 'read', name: 'search_knowledge', arguments: '{"query":"布管穿线"}' }] }
        : output(turn === 1 ? 'first draft' : 'sole repair');
      primaryCache.set(turn, result); return result;
    },
    tool: async () => { toolExecutions++; return { content: '{"knowledgeStatus":"ready","synthesisSources":[]}' }; },
    validateFinal: async (_text, turn) => {
      if (reviewCache.has(turn)) return reviewCache.get(turn)!;
      const issue = { code: 'ungrounded_response_scope', feedback: '修正没有依据的机理；不读取或写入业务。' };
      if (semanticFailure || turn === 2) dispatch('grounding');
      const result = turn === 1 || rejectRepair ? issue : null;
      reviewCache.set(turn, result); return result;
    },
  };
  const run = (resume?: AgentCheckpoint) => runRenovationAgent({ messages: question, tools: [read], ports, ...schedule(), resume });
  return { ports, run, calls, checkpoints, reads: () => toolExecutions, revoke: () => { allowed = false; } };
}

test('one read, first answer, semantic rejection and sole reviewed repair fit exactly five calls', async () => {
  const f = fixture();
  assert.equal((await f.run()).output?.text, 'sole repair');
  assert.deepEqual(f.calls, ['answer', 'answer', 'grounding', 'answer', 'grounding']);
  assert.equal(f.reads(), 1);
  const repair = f.checkpoints.find(c => c.validationRepairs === 1 && !c.output)!;
  assert.equal(repair.turn, 2); assert.equal(repair.primaryModelTurns, 2);
  assert.equal((await f.run(repair)).output?.text, 'sole repair');
  assert.equal(f.calls.length, 5, 'Durable repair/review replay must not dispatch again');
  assert.equal(f.reads(), 1);
  await assert.rejects(f.run({ ...repair, primaryModelTurns: 4 }), /invalid_agent_checkpoint/);
});

test('a deterministic first-draft rejection leaves both repair and review available', async () => {
  const f = fixture(false);
  assert.equal((await f.run()).output?.text, 'sole repair');
  assert.deepEqual(f.calls, ['answer', 'answer', 'answer', 'grounding']);
});

test('a rejected sole repair stops without a sixth call and revoked evidence never reaches final dispatch', async () => {
  const f = fixture(true, true);
  await assert.rejects(f.run(), /ungrounded_response_scope/); assert.equal(f.calls.length, 5); assert.equal(f.reads(), 1);
  const revoked = fixture();
  const readPort = revoked.ports.tool;
  revoked.ports.tool = async (...args) => { const result = await readPort(...args); revoked.revoke(); return result; };
  await assert.rejects(revoked.run(), /context_changed/); assert.deepEqual(revoked.calls, ['answer']);
});

test('general knowledge can finish on its first call without an invented read or review', async () => {
  const f = fixture();
  f.ports.model = async () => output('一般解释');
  f.ports.validateFinal = async () => null;
  assert.equal((await f.run()).output?.text, '一般解释'); assert.equal(f.reads(), 0); assert.deepEqual(f.calls, []);
});

test('a paired source batch finalizes even with an unused action candidate, without confusing tool availability with intent', async () => {
  const initial: ModelMessage[] = [{ role: 'user', content: [{ type: 'text', text: '{"sourceMessageId":"current","text":"帮我查一下卫生间通风建议，告诉我出处。"}' }] }];
  const call = { id: 'web', name: 'search_web', arguments: '{"query":"卫生间通风"}' };
  const complete: ModelMessage[] = [...initial, { role: 'assistant', content: '', toolCalls: [call] },
    { role: 'tool', callId: 'web', content: '{"synthesisSources":[]}' }];
  assert.equal(naturalKnowledgeReadComplete(complete, 'current'), true);
  assert.equal(naturalKnowledgeReadComplete(complete, 'old-message'), false);
  assert.equal(naturalKnowledgeReadComplete(complete.slice(0, -1), 'current'), false);
  for (const name of ['record_need', 'query_materials']) {
    const other = structuredClone(complete); if (other[1].role === 'assistant') other[1].toolCalls![0].name = name;
    assert.equal(naturalKnowledgeReadComplete(other, 'current'), false);
  }
  const malformed = structuredClone(complete); if (malformed[2].role === 'tool') malformed[2].content = '{"status":"invalid_arguments"}';
  assert.equal(naturalKnowledgeReadComplete(malformed, 'current'), false);
  let calls = 0, reads = 0;
  await runRenovationAgent({ messages: initial, tools: [{ ...read, name: 'search_web' }, { ...read, name: 'record_need' }], ports: {
    authorize: async () => {}, checkpoint: async () => {}, canFinalizeContext: messages => naturalKnowledgeReadComplete(messages, 'current'),
    model: async (_turn, _messages, tools) => { calls++; if (calls === 1) { assert.equal(tools.length, 2); return { ...output(''), toolCalls: [call] }; }
      assert.deepEqual(tools, []); return output('有出处的回答'); },
    tool: async () => { reads++; return { content: '{"synthesisSources":[]}' }; }, validateFinal: async () => null,
  } });
  assert.equal(calls, 2); assert.equal(reads, 1);
});
