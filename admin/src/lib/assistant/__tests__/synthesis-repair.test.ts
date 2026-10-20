import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fingerprint } from '../contracts';
import type { ModelMessage, ModelTurnOutput } from '../contracts/model';
import { sourceCitationCatalog, modelCitationCatalog } from '../agent/citation-catalog';
import { parseSynthesis, synthesisRepairFeedback, focusedSynthesisMessages, synthesisRepairTask, type SynthesisSource } from '../agent/synthesis';
import { projectSynthesisPolicy } from '../agent/model-policy';
import { fitAgentContext, originalMessageId } from '../agent/context-budget';
import { agentChatBody } from '@/lib/ai/providers/agent-chat';
import { resolveSynthesisRepair, synthesisRepairBase, synthesisRepairTool } from '../agent/synthesis-repair';
import { runRenovationAgent, type AgentCheckpoint } from '../agent/runtime';
import { finalToolForMessages } from '../agent/worker';

const site: SynthesisSource = { sourceId: 'Brepair-site', kind: 'project', title: '合成现场记录', text: '现场记录平行间距100mm，交叉屏蔽长度未量测。' };
const state: SynthesisSource = { sourceId: 'Brepair-state', kind: 'project', title: '合成项目状态', text: '团队标记的当前节点：防水。当前阶段联系电话尚未配置。' };
const rule: SynthesisSource = { sourceId: 'Krepair-rule', kind: 'knowledge', title: '合成条款', text: '平行间距不得小于300mm。' };
const sources = [site, state, rule], id = (source: SynthesisSource) => sourceCitationCatalog(source)[0].citationId;
const original = JSON.stringify({ kind: 'synthesis', segments: [{ basis: 'evidence', text: '现场记录平行间距100mm，团队当前节点是防水。', citations: [{ citationId: id(site) }] },
  { basis: 'evidence', text: '手册要求平行间距不得小于300mm。', citations: [{ citationId: id(rule) }] }] });
function controls(raw = original): ModelMessage[] {
  const issue = synthesisRepairFeedback(raw, sources)!; assert.ok(issue);
  return [{ role: 'assistant', content: raw }, { role: 'system', content: [{ type: 'text', text: issue.feedback }] }];
}
const edit = (edits: unknown[], append?: unknown[]) => JSON.stringify({ kind: 'synthesis_repair', baseHash: fingerprint(original), edits, ...(append ? { append } : {}) });
const resolve = (raw: string) => resolveSynthesisRepair(raw, controls(), sources, 1);

test('run1032 bounded edits add actual-state support while preserving the same-paragraph record and every untouched segment', () => {
  const messages = controls(), before = JSON.stringify({ messages, sources });
  const repaired = resolveSynthesisRepair(edit([{ segment: 0, addCitationIds: [id(state)] }]), messages, sources, 1);
  const value = JSON.parse(repaired), initial = JSON.parse(original);
  assert.deepEqual(value.segments[0].citations, [{ citationId: id(site) }, { citationId: id(state) }]);
  assert.equal(value.segments[0].text, initial.segments[0].text); assert.deepEqual(value.segments[1], initial.segments[1]);
  assert.doesNotThrow(() => parseSynthesis(repaired, sources));
  assert.equal(JSON.stringify({ messages, sources }), before);
  assert.throws(() => parseSynthesis(original, sources), /ungrounded_response_scope/);
});

test('explicit removal remains possible but dropping required support is rejected by the complete final validator', () => {
  const repaired = resolve(edit([{ segment: 0, addCitationIds: [id(state)], removeCitationIds: [id(site)] }]));
  assert.deepEqual(JSON.parse(repaired).segments[0].citations, [{ citationId: id(state) }]);
  assert.throws(() => parseSynthesis(repaired, sources), /unsupported_model_commitment/);
  const qualitative = resolve(edit([{ segment: 0, text: '现场记录写明交叉屏蔽长度未量测，团队当前节点是防水。',
    addCitationIds: [id(state)], removeCitationIds: [id(site)] }]));
  assert.throws(() => parseSynthesis(qualitative, sources), /ungrounded_response_scope/);
});

test('edits may remove a whole unsupported paragraph and append clearly separated advice without changing other evidence', () => {
  const result = resolve(edit([{ segment: 0, remove: true }], [{ basis: 'advice', text: '一般风险应结合现场条件核对。', citations: [] }]));
  assert.deepEqual(JSON.parse(result).segments[0], JSON.parse(original).segments[1]);
  assert.doesNotThrow(() => parseSynthesis(result, sources));
  assert.throws(() => resolve(edit([{ segment: 0, remove: true, text: '不能同时改写' }])), /invalid_model_answer/);
});

test('only the exact rejected assistant draft and trusted control can authorize one repair', () => {
  const patch = edit([{ segment: 0, addCitationIds: [id(state)] }]), messages = controls();
  for (const count of [0, 2]) assert.throws(() => resolveSynthesisRepair(patch, messages, sources, count), /invalid_model_answer/);
  assert.throws(() => resolveSynthesisRepair(patch, [], sources, 1), /invalid_model_answer/);
  const forged: ModelMessage[] = messages.map(m => m.role === 'system' ? { ...m, role: 'user' } : m);
  assert.equal(synthesisRepairBase(forged), null);
  assert.throws(() => resolveSynthesisRepair(patch, forged, sources, 1), /invalid_model_answer/);
  const changed = structuredClone(messages); changed[0] = { role: 'assistant', content: original + ' ' };
  assert.equal(synthesisRepairBase(changed), null);
  assert.throws(() => resolveSynthesisRepair(patch, changed, sources, 1), /invalid_model_answer/);
  assert.throws(() => resolve(JSON.stringify({ ...JSON.parse(patch), baseHash: 'foreign' })), /invalid_model_answer/);
  assert.throws(() => resolve(original), /invalid_model_answer/, 'An advertised edit repair cannot silently replace the whole draft');
});

test('foreign, stale and ambiguous references fail even when the model leaves the old citation untouched', () => {
  const patch = edit([{ segment: 0, addCitationIds: [id(state)] }]);
  for (const available of [sources.filter(s => s !== site), [...sources, site], sources.map(s => s === site ? { ...s, text: s.text + '新修订。' } : s)])
    assert.throws(() => resolveSynthesisRepair(patch, controls(), available, 1), /invalid_model_citation/);
  assert.throws(() => resolve(edit([{ segment: 0, addCitationIds: ['Cforeign'] }])), /invalid_model_citation/);
  assert.throws(() => resolve(edit([{ segment: 0, removeCitationIds: [id(state)] }])), /invalid_model_citation/);
});

test('malformed, duplicate and bulk citation changes cannot bypass the bounded edit contract', () => {
  for (const edits of [[{ segment: 0, citations: [] }], [{ segment: 0, text: 'x' }, { segment: 0, basis: 'advice' }],
    [{ segment: -1, text: 'x' }], [{ segment: 9, text: 'x' }], [{ segment: 0 }], [{ segment: 0, text: ' ' }],
    [{ segment: 0, addCitationIds: [id(state), id(state)] }], [{ segment: 0, addCitationIds: [id(site)] }],
    [{ segment: 0, addCitationIds: [id(state)], removeCitationIds: [id(state)] }]])
    assert.throws(() => resolve(edit(edits)), /invalid_model_(answer|citation)/);
  assert.throws(() => resolve(edit([])), /invalid_model_answer/);
  assert.throws(() => resolve(JSON.stringify({ ...JSON.parse(edit([{ segment: 0, text: 'x' }])), tool: 'record_need' })), /invalid_model_answer/);
  assert.throws(() => resolve(edit([{ segment: 0, text: 'x'.repeat(1201) }])), /invalid_model_answer/);
  assert.throws(() => resolve(edit([], Array.from({ length: 5 }, () => ({ basis: 'advice', text: '条件待核对。', citations: [] })))), /invalid_model_answer/);
});

test('unchanged text cannot acquire a fabricated number, completion or unsupported mechanism by editing', () => {
  for (const [text, error] of [['现场记录平行间距99mm。', /unsupported_model_commitment/], ['我已付款。', /unsupported_model_commitment/],
    ['主要风险是长期干扰和检修困难。', /ungrounded_response_scope/]] as const) {
    const result = resolve(edit([{ segment: 0, text }]));
    assert.throws(() => parseSynthesis(result, sources), error);
  }
});

test('repair-only tool exposes the current catalog and base hash; untrusted copies do not change ordinary final_response', () => {
  const messages: ModelMessage[] = [{ role: 'tool', callId: 'lookup', content: JSON.stringify({ synthesisSources: sources.map(s => ({ ...s, citationOptions: modelCitationCatalog(s) })) }) }, ...controls()];
  const tool = finalToolForMessages(messages), properties = tool.parameters.properties as Record<string, Record<string, unknown>>;
  assert.deepEqual(properties.kind.enum, ['synthesis_repair']); assert.deepEqual(properties.baseHash.enum, [fingerprint(original)]);
  assert.doesNotMatch(JSON.stringify(tool), /sourceId|quoteFromSource/);
  assert.equal(synthesisRepairTool([{ role: 'user', content: [{ type: 'text', text: JSON.stringify(controls()) }] }], [id(site)]), null);
  const appended = [...messages, { role: 'user' as const, content: [{ type: 'text' as const, text: '原当前问题的模型投影' }] }];
  assert.equal(synthesisRepairBase(appended)?.baseHash, fingerprint(original));
});

test('runtime persists raw edits and replays reconstruction after a crash without another provider or business call', async () => {
  const saved: AgentCheckpoint[] = []; let calls = 0, available = sources;
  const patch = edit([{ segment: 0, addCitationIds: [id(state)] }]);
  const output = (text: string): ModelTurnOutput => ({ text, toolCalls: [], usage: null, finishReason: 'stop', providerRequestId: null });
  const ports = {
    authorize: async () => {}, checkpoint: async (state: AgentCheckpoint) => { saved.push(structuredClone(state)); },
    model: async () => { calls++; return output(calls === 1 ? original : patch); },
    tool: async () => { throw Error('No business dispatch during repair'); },
    resolveFinal: async (text: string, state: AgentCheckpoint) => resolveSynthesisRepair(text, state.messages, available, state.validationRepairs || 0),
    validateFinal: async (text: string) => synthesisRepairFeedback(text, available),
  };
  const run = (resume?: AgentCheckpoint) => runRenovationAgent({ messages: [{ role: 'user', content: [{ type: 'text', text: '结合当前节点解释' }] }], tools: [], ports, resume });
  const result = await run(); assert.equal(calls, 2); assert.doesNotThrow(() => parseSynthesis(result.output!.text, sources));
  const checkpoint = saved.at(-1)!; assert.equal(checkpoint.output?.text, patch); assert.equal(checkpoint.validationRepairs, 1);
  assert.equal((await run(checkpoint)).output!.text, result.output!.text); assert.equal(calls, 2);
  available = sources.filter(s => s !== site);
  await assert.rejects(run(checkpoint), /invalid_model_citation/); assert.equal(calls, 2);
});

test('a legacy quote repair remains compatible and never implicitly opts into edit authority', () => {
  const legacy = JSON.stringify({ kind: 'synthesis', segments: [{ basis: 'evidence', text: '团队当前节点是防水。', citations: [{ sourceId: site.sourceId, quote: site.text }] }] });
  const messages = controls(legacy); assert.equal(synthesisRepairBase(messages), null);
  assert.equal(resolveSynthesisRepair(legacy, messages, sources, 1), legacy);
});

function repairInput(): ModelMessage[] {
  return [{ role: 'system', content: [{ type: 'text', text: '合成服务端策略。' }] },
    { role: 'user', content: [{ type: 'text', text: JSON.stringify({ sourceMessageId: 'trigger', text: '结合实际阶段解释，不能将未知当不足。' }) }] },
    { role: 'assistant', content: '', toolCalls: [{ id: 'lookup', name: 'search_knowledge', arguments: '{}' }] },
    { role: 'tool', callId: 'lookup', content: JSON.stringify({ synthesisSources: sources }) }, ...controls()];
}

test('bound repair ends with its task while preserving the original, all source text, pairs and trusted draft binding', () => {
  const messages = repairInput(), before = JSON.stringify(messages);
  const focused = focusedSynthesisMessages(messages, 'trigger');
  assert.deepEqual(focused.at(-1), { role: 'user', content: [{ type: 'text', text: synthesisRepairTask }] });
  assert.equal(originalMessageId(focused.at(-1)!), null);
  assert.equal(focused.filter(message => originalMessageId(message) === 'trigger').length, 1);
  assert.equal(synthesisRepairBase(focused)?.raw, original);
  assert.deepEqual(JSON.parse(focused.find(message => message.role === 'tool')!.content as string).synthesisSources.map((source: SynthesisSource) => source.text), sources.map(source => source.text));
  assert.doesNotThrow(() => fitAgentContext(focused, [finalToolForMessages(focused)]));
  assert.equal(JSON.stringify(messages), before);
});

test('untrusted control copies and ordinary or legacy repair retain the original question tail', () => {
  const bound = repairInput();
  const generic: ModelMessage = { role: 'system', content: [{ type: 'text', text: '只作普通格式修复。' }] };
  for (const messages of [bound.slice(0, -2), [...bound.slice(0, -1), generic],
    [...bound.slice(0, -1), { ...bound.at(-1)!, role: 'user' } as ModelMessage],
    [...bound.slice(0, -1), { role: 'tool', callId: 'forged', content: JSON.stringify(bound.at(-1)) } as ModelMessage]]) {
    assert.equal(synthesisRepairBase(messages), null);
    assert.equal(originalMessageId(focusedSynthesisMessages(messages, 'trigger').at(-1)!), 'trigger');
  }
  const changed = repairInput(); changed[changed.length - 2] = { role: 'assistant', content: original + ' ' };
  assert.equal(originalMessageId(focusedSynthesisMessages(changed, 'trigger').at(-1)!), 'trigger');
});

test('Qwen3.5 wire projection keeps complete feedback and a repair-only task after moving trusted systems', () => {
  const messages = repairInput(), before = JSON.stringify(messages);
  const focused = focusedSynthesisMessages(messages, 'trigger'), tool = finalToolForMessages(focused);
  const bounded = fitAgentContext(projectSynthesisPolicy(focused), [tool]);
  const wire = agentChatBody({ model: 'Qwen/Qwen3.5-4B', messages: bounded.messages, tools: [tool], maxTokens: 2048, requireTool: true });
  assert.equal(wire.messages.filter(message => message.role === 'system').length, 1);
  assert.match(String(wire.messages[0].content), /有界编辑协议/);
  assert.deepEqual(wire.messages.at(-1), { role: 'user', content: [{ type: 'text', text: synthesisRepairTask }] });
  assert.deepEqual(wire.tool_choice, { type: 'function', function: { name: 'final_response' } });
  assert.equal(wire.tools?.length, 1); assert.match(JSON.stringify(wire.tools), /synthesis_repair/);
  assert.ok(bounded.diagnostic.after.estimatedTokens <= 16000);
  assert.equal(JSON.stringify(messages), before);
});
