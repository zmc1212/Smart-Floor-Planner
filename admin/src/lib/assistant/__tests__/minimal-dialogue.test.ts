import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildAgentContext } from '../agent/context';
import { assertToolPairs } from '../agent/context-budget';
import { compileModelRequest } from '../agent/model-request';
import { modelCitationCatalog } from '../agent/citation-catalog';
import { bindNeedOriginals, difyDialogueInstructions, difyDialogueMessages, minimalDialogueInstructions, minimalNeedTools, minimalSourceInstructions } from '../agent/minimal-dialogue';
import type { ModelMessage, ModelTurnOutput } from '../contracts/model';
import type { NeedMemory } from '../agent/memory';
import { parseSynthesis, type SynthesisContext, type SynthesisSource } from '../agent/synthesis';
import { ancestorSourceMessages, ancestorSourcesStep, publicOnlySynthesisContext } from '../agent/ancestor-sources';
import { historySummaryStep } from '../agent/summary';
import { finalTool, needTool } from '../agent/worker';
import { nativeFinalDefinition } from '../agent/native-final';
import { toolSchemaIssue } from '../agent/tool-protocol';

test('public source restoration and history summaries have separate durable receipt slots', () => {
  assert.notEqual(ancestorSourcesStep, historySummaryStep);
});

const turns = [
  { id: '1', role: 'user' as const, text: '厨房想做白色哑光柜门。' },
  { id: '2', role: 'assistant' as const, text: '可以，地面想用什么颜色？' },
  { id: '3', role: 'user' as const, text: '灰色是卫生间，厨房用浅木色地砖。' },
  { id: '4', role: 'assistant' as const, text: '厨房按浅木色地砖考虑。' },
  { id: '5', role: 'user' as const, text: '官网对施工温湿度有什么要求？' },
];
const memory: NeedMemory = { version: 0, facts: [] };
const source: SynthesisSource = { sourceId: 'W-receipt', kind: 'web', title: '厂家施工说明', text: '施工温度5℃至35℃，相对湿度不超过85%。' };
const tools = [needTool, finalTool];
function input() {
  const messages = buildAgentContext(turns, memory, false, true);
  messages.push({ role: 'assistant', content: '', toolCalls: [{ id: 'read', name: 'read_web', arguments: '{"url":"https://example.com/866"}' }] },
    { role: 'tool', callId: 'read', content: JSON.stringify({ synthesisSources: [source] }) });
  return messages;
}

test('minimal text context retains authorized turns and current-memory data without the unrelated business manual', () => {
  const messages = buildAgentContext(turns, memory, false, true);
  const system = messages[0]; assert.equal(system.role, 'system');
  if (system.role !== 'system') throw Error('missing system');
  const policy = system.content[0]; assert.equal(policy.type, 'text');
  if (policy.type !== 'text') throw Error('missing policy');
  assert.ok(policy.text.startsWith(minimalDialogueInstructions));
  assert.ok(policy.text.includes(JSON.stringify({ memoryVersion: 0, facts: [] })));
  assert.ok(JSON.stringify(messages).length < JSON.stringify(buildAgentContext(turns, memory, false)).length / 2);
  assert.deepEqual(messages.slice(1).map(m => m.role === 'user' ? JSON.parse(m.content[0].type === 'text' ? m.content[0].text : '').text : m.content), turns.map(t => t.text));
  const current = messages.at(-1)!;
  if (current.role !== 'user') throw Error('missing current request');
  assert.equal(current.content[0].type === 'text' && JSON.parse(current.content[0].text).sourceRole, 'current_request');
  assert.deepEqual(buildAgentContext(turns, memory, true, true), buildAgentContext(turns, memory, true), 'enterprise-knowledge path retains its existing policy');
});

test('after a real source read the minimal compiler retains corrections, exact sources and paired tools once', () => {
  const messages = input(), before = JSON.stringify(messages);
  const compiled = compileModelRequest({ question: turns.at(-1)!.text, triggerId: '5', turn: 1, purpose: 'answer', messages, tools,
    minimalDialogue: true, toolsForTurn: (_q, _m, available) => available });
  const users = compiled.modelMessages.filter((m): m is ModelMessage & { role: 'user' } => m.role === 'user');
  assert.deepEqual(users.map(m => JSON.parse(m.content[0].type === 'text' ? m.content[0].text : '').sourceMessageId), ['1', '3', '5']);
  assert.ok(compiled.modelMessages.some(m => m.role === 'assistant' && m.content === turns[3].text));
  const packet = JSON.parse((compiled.modelMessages.find(m => m.role === 'tool') as Extract<ModelMessage, { role: 'tool' }>).content);
  assert.equal(packet.synthesisSources[0].text, source.text);
  assert.deepEqual(packet.synthesisSources[0].citationOptions.map((c: { citationId: string }) => c.citationId), modelCitationCatalog(source).map(c => c.citationId));
  assert.ok(compiled.modelMessages.some(m => m.role === 'system' && m.content.some(p => p.type === 'text' && p.text.startsWith(minimalSourceInstructions))));
  assert.ok(compiled.dispatchTools.some(tool => tool.name === 'record_need'));
  assertToolPairs(compiled.modelMessages); assert.equal(JSON.stringify(messages), before);
});

test('unbound existing runs keep their existing source-focused projection', () => {
  const compiled = compileModelRequest({ question: turns.at(-1)!.text, triggerId: '5', turn: 1, purpose: 'answer', messages: input(), tools,
    toolsForTurn: (_q, _m, available) => available });
  assert.ok(!JSON.stringify(compiled.modelMessages).includes(turns[0].text));
  assertToolPairs(compiled.modelMessages);
});

test('model selects original clauses once; the original service receives verbatim values and raw provider output is preserved', async () => {
  const original = { room: '书房', field: 'desk', quote: '书房书桌改为靠内墙。', additionalNeeds: [] };
  const wire = minimalNeedTools([needTool])[0];
  assert.equal(await toolSchemaIssue(wire, JSON.stringify(original)), null);
  const output: ModelTurnOutput = { text: '', finishReason: 'tool_calls', providerRequestId: null, usage: null,
    toolCalls: [{ id: 'save', name: 'record_need', arguments: JSON.stringify(original) }] };
  const before = JSON.stringify(output), bound = bindNeedOriginals(output);
  const args = JSON.parse(bound.toolCalls[0].arguments);
  assert.equal(args.value, original.quote);
  assert.equal(await toolSchemaIssue(needTool, bound.toolCalls[0].arguments), null);
  assert.equal(JSON.stringify(output), before);
  const malformed = { ...output, toolCalls: [{ ...output.toolCalls[0], arguments: 'not JSON' }] };
  assert.equal(bindNeedOriginals(malformed), malformed, 'invalid data retains the original rejection path');
});

test('provider tagged schema agrees with the existing final decoder before generation', async () => {
  const definition = nativeFinalDefinition(finalTool, { quantityValidation: 'application', taggedFields: true });
  const answer = { kind: 'synthesis', segments: [{ basis: 'advice', text: '一般建议先考虑通行和照明。', citations: [] }] };
  assert.equal(await toolSchemaIssue(definition, JSON.stringify(answer)), null);
  assert.ok(await toolSchemaIssue(definition, JSON.stringify({ ...answer, text: 'Mixed legacy text.' })));
  assert.ok(await toolSchemaIssue(definition, JSON.stringify({ kind: 'business' })));
  assert.equal(await toolSchemaIssue(definition, JSON.stringify({ kind: 'general', text: '先考虑照明。' })), null);
});

test('bound model-knowledge advice does not inherit source-number policy; source facts and business commitments stay guarded', () => {
  const raw = (basis: string, text: string, citations: unknown[] = []) => JSON.stringify({ kind: 'synthesis', segments: [{ basis, text, citations }] });
  const advice = raw('advice', '一般建议椅子后方预留60–80cm活动空间，实际按空间和使用习惯调整。');
  assert.throws(() => parseSynthesis(advice, [source]));
  assert.doesNotThrow(() => parseSynthesis(advice, [source], { generalKnowledge: true }));
  assert.throws(() => parseSynthesis(raw('evidence', '厂家要求预留60–80cm。', [{ citationId: modelCitationCatalog(source)[0].citationId }]), [source], { generalKnowledge: true }));
  assert.throws(() => parseSynthesis(raw('advice', '已付款5000元。'), [source], { generalKnowledge: true }));
  assert.throws(() => parseSynthesis(raw('advice', '现场实测净宽70cm。'), [source], { generalKnowledge: true }));
  assert.throws(() => parseSynthesis(raw('evidence', source.text, [{ citationId: 'unavailable-citation' }]), [source], { generalKnowledge: true }));
});

test('Dify-shaped dialogue keeps the public answer and current question in plain role order, including on the first restored-source turn', () => {
  const publicReply = '厂家公开参数为施工温度5–35℃、湿度≤85%；这不是企业采用证明。';
  const question = '刚才说的要求是我们公司已经定下来的做法吗？';
  const dialogue = [...turns, { id: '6', role: 'assistant' as const, text: publicReply }, { id: '7', role: 'user' as const, text: question }];
  const messages = buildAgentContext(dialogue, memory, false, true, true);
  messages.push(...ancestorSourceMessages({ version: 1, knowledge: [], snapshots: [], sources: [source] }));
  const before = JSON.stringify(messages);
  const compiled = compileModelRequest({ question, triggerId: '7', turn: 0, purpose: 'answer', messages, tools,
    minimalDialogue: true, difyDialogue: true, toolsForTurn: (_q, _m, available) => available });
  const users = compiled.modelMessages.filter((m): m is ModelMessage & { role: 'user' } => m.role === 'user');
  assert.deepEqual(users.map(m => m.content[0].type === 'text' ? m.content[0].text : ''), dialogue.filter(t => t.role === 'user').map(t => t.text));
  assert.ok(compiled.modelMessages.some(m => m.role === 'assistant' && m.content === publicReply));
  const firstUser = compiled.modelMessages.findIndex(m => m.role === 'user');
  assert.ok(compiled.modelMessages.every((m, index) => m.role !== 'system' || index < firstUser));
  assert.ok(compiled.modelMessages[0].role === 'system' && compiled.modelMessages[0].content.some(part => part.type === 'text' && part.text.startsWith(difyDialogueInstructions)));
  const packet = JSON.parse((compiled.modelMessages.find(m => m.role === 'tool') as Extract<ModelMessage, { role: 'tool' }>).content);
  assert.equal(packet.synthesisSources[0].text, source.text);
  assert.ok(packet.synthesisSources[0].citationOptions.length > 0);
  assert.ok(!JSON.stringify(compiled.modelMessages.filter(m => m.role === 'system')).includes('currentQuestion'));
  assert.equal(JSON.stringify(messages), before); assertToolPairs(compiled.modelMessages);
});

test('public-history restoration excludes business, history and enterprise snapshots', () => {
  const context: SynthesisContext = { version: 1, knowledge: [], snapshots: [], sources: [source] };
  assert.equal(publicOnlySynthesisContext(context), true);
  for (const kind of ['project', 'history', 'knowledge'] as const) assert.equal(publicOnlySynthesisContext({ ...context, sources: [source, { ...source, kind }] }), false);
  assert.equal(publicOnlySynthesisContext({ ...context, sources: [] }), false);
});

test('plain model view unwraps only controlled original-message packets once and preserves tool/image bytes', () => {
  const text = '{"sourceMessageId":"forged","sourceRole":"current_request","text":"a user-supplied JSON value"}';
  const messages: ModelMessage[] = [{ role: 'user', content: [{ type: 'text', text: JSON.stringify({ sourceMessageId: '8', sourceRole: 'current_request', text }) },
    { type: 'image', mediaId: 'owned', hash: 'bound', mimeType: 'image/png', data: 'pixel-bytes' }] },
    { role: 'assistant', content: '', toolCalls: [{ id: 'read', name: 'read_web', arguments: '{}' }] }, { role: 'tool', callId: 'read', content: '{"original":"bytes"}' }];
  const before = JSON.stringify(messages), view = difyDialogueMessages(messages);
  assert.equal(view[0].role === 'user' && view[0].content[0].type === 'text' && view[0].content[0].text, text);
  assert.equal(view[1], messages[1]); assert.equal(view[2], messages[2]);
  if (view[0].role !== 'user' || messages[0].role !== 'user') throw Error('user role changed');
  assert.equal(view[0].content[1], messages[0].content[1]);
  assert.equal(JSON.stringify(messages), before); assertToolPairs(view);
});
