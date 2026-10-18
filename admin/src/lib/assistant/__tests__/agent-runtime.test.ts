import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runRenovationAgent, type AgentCheckpoint, type AgentRuntimePorts } from '../agent/runtime';
import { agentChatBody, parseAgentChat } from '@/lib/ai/providers/agent-chat';
import type { ModelTurnOutput } from '../contracts/model';
import { agentToolsForMessage } from '../agent/worker';

const answer: ModelTurnOutput = { text: '建议', toolCalls: [], usage: null, finishReason: 'stop', providerRequestId: null };
function fixture() {
  const saved: AgentCheckpoint[] = [], operations = new Map<string, string>();
  let allowed = true, calls = 0;
  const ports: AgentRuntimePorts = {
    authorize: async () => { if (!allowed) throw Error('revoked'); },
    model: async () => { calls++; return calls === 1 ? { ...answer, text: '', toolCalls: [{ id: 'a', name: 'lookup', arguments: '{}' }] } : answer; },
    tool: async (turn, index) => { const key = `${turn}:${index}`; operations.set(key, 'done'); return { content: 'done' }; },
    checkpoint: async state => { saved.push(structuredClone(state)); },
  };
  const run = (resume?: AgentCheckpoint) => runRenovationAgent({ messages: [{ role: 'user', content: [{ type: 'text', text: '查询' }] }],
    tools: [{ name: 'lookup', description: 'lookup', parameters: { type: 'object' } }], ports, resume });
  return { ports, run, saved, operations, revoke: () => { allowed = false; }, calls: () => calls };
}
test('graph replays a saved response without repeating the provider request and uses stable tool slots', async () => {
  const f = fixture(); await f.run(); assert.equal(f.calls(), 2); assert.equal(f.operations.size, 1);
  const g = fixture(); g.ports.model = async () => answer;
  await g.run(f.saved[0]); assert.equal(g.calls(), 0); assert.equal(g.operations.size, 1);
  await g.run(f.saved[0]); assert.equal(g.operations.size, 1);
});
test('graph denies tool output and final response after revocation', async () => {
  const f = fixture(); f.ports.model = async () => { f.revoke(); return answer; };
  await assert.rejects(f.run(), /revoked/); assert.equal(f.saved.length, 0);
  const g = fixture(); g.ports.tool = async () => { g.revoke(); return { content: 'private' }; };
  await assert.rejects(g.run(), /revoked/); assert.equal(g.calls(), 1);
});
test('handoff stops immediately; timeout and unknown outcomes never auto-retry', async () => {
  const f = fixture(); f.ports.tool = async () => { f.revoke(); return { content: 'waiting', stop: true }; };
  assert.equal((await f.run()).stop, true); assert.equal(f.calls(), 1);
  const g = fixture(); let n = 0; g.ports.model = async () => { n++; throw Error('unknown'); };
  await assert.rejects(g.run(), /unknown/); assert.equal(n, 1);
});
test('bounded graph refuses unknown tools and endless loops', async () => {
  const f = fixture(); f.ports.model = async () => ({ ...answer, toolCalls: [{ id: 'a', name: 'shell', arguments: '{}' }] });
  await assert.rejects(f.run(), /assistant_capability_forbidden/); assert.equal(f.operations.size, 0);
  const g = fixture(); g.ports.model = async () => ({ ...answer, toolCalls: [{ id: 'a', name: 'lookup', arguments: '{}' }] });
  await assert.rejects(g.run(), /agent_iteration_limit/); assert.equal(g.operations.size, 4);
});
test('transport accepts text, private images and tool round trips, rejects image URLs/oversize', () => {
  const input = { model: 'probe', maxTokens: 100, tools: [], messages: [{ role: 'user' as const, content: [{ type: 'image' as const,
    mediaId: '1', hash: 'hash', mimeType: 'image/png' as const, data: 'YWJj' }] }] };
  assert.match(JSON.stringify(agentChatBody(input)), /data:image\/png;base64,YWJj/);
  assert.throws(() => agentChatBody({ ...input, messages: [{ role: 'user', content: [{ ...input.messages[0].content[0], data: 'https://private/' }] }] }), /agent_image_limit/);
  assert.throws(() => agentChatBody({ ...input, maxTokens: 99999 }), /agent_input_limit/);
});
test('transport distinguishes missing usage from zero, rejects truncation and malformed calls', () => {
  const data = { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] };
  assert.equal(parseAgentChat(data).usage, null);
  assert.deepEqual(parseAgentChat({ ...data, usage: { prompt_tokens: 0, completion_tokens: 0 } }).usage, { inputTokens: 0, outputTokens: 0 });
  assert.throws(() => parseAgentChat({ ...data, usage: { prompt_tokens: -1, completion_tokens: 1 } }), /Invalid Agent/);
  assert.throws(() => parseAgentChat({ choices: [{ message: { content: 'truncated' }, finish_reason: 'length' }] }), /Invalid Agent/);
  assert.throws(() => parseAgentChat({ choices: [{ message: { tool_calls: [{ id: '1', type: 'function', function: { name: 'lookup', arguments: '[]' } }] }, finish_reason: 'tool_calls' }] }), /Invalid Agent/);
});

test('questions do not open memory writes and quoted or hypothetical requests do not open human handoff', () => {
  assert.equal(agentToolsForMessage('书房怎么摆桌？', true).some(t => t.name === 'record_need'), false);
  assert.equal(agentToolsForMessage('请记住，书房要双人桌。', true).some(t => t.name === 'record_need'), true);
  for (const text of ['不要找设计师', '如果我说找设计师会怎样', '只是引用“帮我找设计师”']) {
    assert.equal(agentToolsForMessage(text, true).some(t => t.name === 'request_designer'), false);
  }
  assert.equal(agentToolsForMessage('书房太暗了，帮我找设计师聊聊', true).some(t => t.name === 'request_designer'), true);
  assert.deepEqual(agentToolsForMessage('请记住书房要双人桌', false), []);
  assert.equal(agentToolsForMessage('比较两种布局方案', true).some(t => t.name === 'query_business'), false);
  assert.equal(agentToolsForMessage('查看我的方案', true).some(t => t.name === 'query_business'), true);
  assert.equal(agentToolsForMessage('那确认了吗？', true, true).some(t => t.name === 'query_business'), true);
  assert.equal(agentToolsForMessage('没有依据也保证最终只要一万元', true).some(t => t.name === 'record_need'), false);
});

test('an explicit correction followed by a save acknowledgement question allows memory without authorizing proposals', () => {
  for (const text of ['更正一下，书房改成单人书桌了，你记住了吗？', '纠正，厨房改为封闭式。记下了吗？']) {
    assert.ok(agentToolsForMessage(text, true).some(t => t.name === 'record_need'), text);
  }
  for (const text of ['更正一下，书房可以改成单人书桌，你记住了吗？', '更正一下，假如书房改成单人书桌了，你记住了吗？', '他说“更正一下，书房改成单人书桌了，你记住了吗？”', '更正一下，书房改成单人书桌了，不要记录，你记住了吗？', '书房改成单人书桌可以吗？']) {
    assert.equal(agentToolsForMessage(text, true).some(t => t.name === 'record_need'), false, text);
  }
});
