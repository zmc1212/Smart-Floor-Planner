import test from 'node:test';
import assert from 'node:assert/strict';
import type { ModelMessage, ModelTool, ModelTurnOutput } from '../contracts/model';
import type { AgentCheckpoint, AgentRuntimePorts } from '../agent/runtime';
import { runRenovationAgent } from '../agent/runtime';
import { projectLegacyBusinessToolMessages } from '../agent/native-checkpoint-projection';

const businessReceipt = {
  status: 'ready',
  text: '您的项目目前在施工阶段。',
  resultKey: 'snapshot-v7-3566-4f2a',
  snapshot: { leadId: 3566, stage: 'construction' },
};
const userMessage: ModelMessage = { role: 'user', content: [{ type: 'text', text: '我家现在什么阶段？' }] };
const businessAssistant: ModelMessage = { role: 'assistant', content: '',
  toolCalls: [{ id: 'call-business', name: 'query_business', arguments: '{"domain":"project"}' }] };
const businessTool: ModelMessage = { role: 'tool', callId: 'call-business', content: JSON.stringify(businessReceipt) };

test('legacy query_business tool messages are projected to status/text without touching other messages', () => {
  const messages: ModelMessage[] = [userMessage, businessAssistant, businessTool];
  const before = JSON.stringify(messages);
  const projected = projectLegacyBusinessToolMessages(messages);
  assert.notEqual(projected, messages);
  assert.equal(projected.length, 3);
  assert.equal(projected[0], userMessage); assert.equal(projected[1], businessAssistant);
  const tool = projected[2];
  assert.equal(tool.role, 'tool'); if (tool.role !== 'tool') return;
  assert.equal(tool.callId, 'call-business');
  assert.deepEqual(JSON.parse(tool.content), { status: businessReceipt.status, text: businessReceipt.text });
  assert.equal(tool.content.includes('resultKey'), false);
  // The saved receipt and the input array are never mutated.
  assert.equal(JSON.stringify(messages), before);
  assert.equal(businessTool.content.includes('resultKey'), true);
});

test('non-business tool calls, receipts without resultKey and unparsable content stay verbatim', () => {
  const otherAssistant: ModelMessage = { role: 'assistant', content: '',
    toolCalls: [{ id: 'call-search', name: 'search_enterprise', arguments: '{"query":"铺贴"}' }] };
  const otherTool: ModelMessage = { role: 'tool', callId: 'call-search',
    content: JSON.stringify({ ...businessReceipt, hits: [] }) };
  const noKey: ModelMessage = { role: 'tool', callId: 'call-business', content: '{"status":"ready","text":"施工阶段"}' };
  const invalid: ModelMessage = { role: 'tool', callId: 'call-business', content: '{"status":' };
  const messages: ModelMessage[] = [otherAssistant, otherTool, businessAssistant, noKey, invalid];
  const projected = projectLegacyBusinessToolMessages(messages);
  assert.equal(projected.length, messages.length);
  for (const [index, message] of projected.entries()) assert.equal(message, messages[index]);
  assert.equal(otherTool.content.includes('resultKey'), true);
});

test('a resumed run sees the projected receipt and never re-dispatches the executed tool', async () => {
  const saved: AgentCheckpoint = { version: 1, turn: 1,
    messages: [userMessage, businessAssistant, businessTool], output: null };
  const tools: ModelTool[] = [{ name: 'query_business', description: '', parameters: { type: 'object' } }];
  const seen: ModelMessage[][] = [];
  let toolCalls = 0;
  const finalTurn: ModelTurnOutput = { text: '您家目前在施工阶段。', toolCalls: [], finishReason: 'stop', providerRequestId: null, usage: null };
  const ports: AgentRuntimePorts = {
    authorize: async () => undefined,
    model: async (_turn, messages) => { seen.push(messages); return finalTurn; },
    tool: async () => { toolCalls++; return { content: '{}' }; },
    checkpoint: async () => undefined,
  };
  const result = await runRenovationAgent({ messages: [userMessage], tools,
    resume: { ...saved, messages: projectLegacyBusinessToolMessages(saved.messages) }, ports });
  assert.equal(result.output?.text, finalTurn.text);
  assert.equal(toolCalls, 0);
  assert.equal(seen.length, 1);
  const tool = seen[0].find((message): message is Extract<ModelMessage, { role: 'tool' }> => message.role === 'tool');
  assert.ok(tool);
  assert.deepEqual(JSON.parse(tool.content), { status: businessReceipt.status, text: businessReceipt.text });
  assert.equal(JSON.stringify(seen[0]).includes('resultKey'), false);
  // The checkpoint's own saved messages and repair counters are untouched.
  assert.equal(saved.turn, 1); assert.equal(saved.validationRepairs, undefined);
  assert.equal(JSON.stringify(saved.messages).includes('resultKey'), true);
});
