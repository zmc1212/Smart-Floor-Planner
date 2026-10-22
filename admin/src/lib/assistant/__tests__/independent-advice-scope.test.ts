import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fingerprint } from '../contracts';
import type { ModelMessage } from '../contracts/model';
import { sourceCitationCatalog, modelCitationCatalog } from '../agent/citation-catalog';
import { independentAdviceRequested } from '../agent/read-tool-input';
import { focusedSynthesisMessages, parseSynthesis, synthesisRepairFeedback, type SynthesisSource } from '../agent/synthesis';
import { resolveSynthesisRepair } from '../agent/synthesis-repair';
import { agentToolsForMessage, agentToolsForTurn, finalToolForMessages } from '../agent/worker';
import { independentAdviceView } from '../agent/independent-advice-context';

const question = '手测追问01：关于书房柔和照明，请给一个一般选择建议。这是独立问题，不新增或修改我的需求。';
// Retained run1388 prose and original customer quotes; these are fixtures, not
// an assertion that the stored needs imply any lighting technique.
const text = '书房柔和照明的一般选择建议包括使用LED灯泡、安装可调光灯具以及合理布局光源。';
const sources: SynthesisSource[] = ['请记下：书房需要收纳。', '请记下：客厅保留阅读角。', '更正：书房书桌改为靠内墙。', '更正：全屋预算改为18万元。']
  .map((text, i) => ({ sourceId: 'H-advice-' + i, kind: 'history', title: '客户当时原话', text }));
const knowledge: SynthesisSource = { sourceId: 'K-advice', kind: 'knowledge', title: '合成使用说明', text: '本示例建议避开屏幕反光，实际布置仍须现场核对。' };
const cite = (source: SynthesisSource) => ({ citationId: sourceCitationCatalog(source)[0].citationId });
const raw = (text: string, refs = sources, basis = 'advice') => JSON.stringify({ kind: 'synthesis', segments: [{ basis, text, citations: refs.map(cite) }] });
const messages = (q = question, selected = sources): ModelMessage[] => [
  { role: 'user', content: [{ type: 'text', text: JSON.stringify({ sourceMessageId: 'current', sourceRole: 'current_request', text: q }) }] },
  { role: 'assistant', content: '', toolCalls: [{ id: 'read', name: 'search_knowledge', arguments: '{"query":"模型自选查询"}' }] },
  { role: 'tool', callId: 'read', content: JSON.stringify({ knowledgeStatus: 'ready', evidence: [], boundProjectContext: { retained: true }, currentNeedView: { retained: true },
    synthesisSources: selected.map(s => ({ ...s, citationOptions: modelCitationCatalog(s) })) }) },
];
const segmentSchema = (input: ModelMessage[]) => {
  const tool = finalToolForMessages(input, question);
  const properties = tool.parameters.properties as Record<string, Record<string, unknown>>;
  assert.deepEqual(properties.kind.enum, ['synthesis']);
  return (properties.segments.items as Record<string, unknown>).properties as Record<string, Record<string, unknown>>;
};

test('independent advice is an explicit source scope, never a topic or generic advice ban', () => {
  for (const q of [question, '单独问，给一个通用建议：收纳如何选择？', '不结合我的项目，给一个一般建议：怎么安排阅读照明？']) assert.equal(independentAdviceRequested(q), true, q);
  for (const q of ['书房柔和照明怎么选？', '这是独立问题，请结合我家书桌靠内墙的条件给一般建议。',
    '独立提问，假如书桌靠内墙，请给一般建议。', '根据我之前的原话给一般建议，这是独立问题。',
    '更正：书房改为单人办公。另外独立问一个一般建议。', '请解释《使用说明》原文，再单独给一个一般建议。',
    '独立问题，给一般建议，同时转人工。']) assert.equal(independentAdviceRequested(q), false, q);
});

test('standalone advice offers knowledge reads without unrelated project, history or mutation tools', () => {
  const tools = agentToolsForMessage(question, true, true);
  assert.deepEqual(tools.map(tool => tool.name), ['search_knowledge']);
  const broad = agentToolsForMessage('查询正式户型和施工进度？', true, true);
  assert.ok(broad.some(tool => tool.name === 'query_business'));
  assert.deepEqual(agentToolsForTurn(question, messages().slice(0, 1), broad, 'current').map(tool => tool.name), ['search_knowledge', 'final_response']);
  assert.deepEqual(agentToolsForTurn(question, messages().slice(0, 1), [], 'current').map(tool => tool.name), ['final_response']);
});

test('standalone advice projects task instructions from the first call without changing durable originals or supplied images', () => {
  const input: ModelMessage[] = [
    { role: 'system', content: [{ type: 'text', text: '旧综合业务规则、预算18万元、run1398。' }] },
    { role: 'user', content: [{ type: 'text', text: JSON.stringify({ sourceMessageId: 'old', text: '书桌靠窗。' }) }] },
    ...messages(question, [...sources, knowledge]),
  ];
  const original = input[2]; assert.equal(original.role, 'user');
  const image = { type: 'image' as const, mediaId: 'synthetic-image', hash: 'synthetic-hash', mimeType: 'image/png' as const, data: 'c3ludGhldGlj' };
  if (original.role === 'user') original.content.push(image);
  const before = structuredClone(input), first = independentAdviceView(input.slice(0, 3), 'current', question);
  assert.equal(first[1].role, 'user');
  if (first[1].role === 'user') assert.deepEqual(first[1].content, [{ type: 'text', text: question }, image]);
  assert.doesNotMatch(JSON.stringify(first), /旧综合业务规则|18万元|run1398|书桌靠窗/);
  const afterRead = independentAdviceView(input, 'current', question);
  const packet = JSON.parse((afterRead.find(m => m.role === 'tool') as Extract<ModelMessage, { role: 'tool' }>).content);
  assert.deepEqual(packet.synthesisSources.map((s: SynthesisSource) => s.sourceId), [knowledge.sourceId]);
  assert.equal(packet.synthesisSources[0].text, knowledge.text);
  assert.deepEqual(input, before);
  assert.equal(independentAdviceView(input, 'current', '结合我家书桌位置给建议。'), input);
  assert.throws(() => independentAdviceView(input, 'missing', question), /context_changed/);
  assert.throws(() => independentAdviceView(input, 'current', question.replace('柔和照明', '自然采光')), /context_changed/);
});

test('saved1388 attribution is rejected under every basis; an uncited general suggestion is still accepted', () => {
  for (const basis of ['advice', 'evidence', 'uncertainty']) assert.throws(() => parseSynthesis(raw(text, sources, basis), sources, { currentQuestion: question }), /ungrounded_response_scope/);
  assert.doesNotThrow(() => parseSynthesis(raw(text, []), sources, { currentQuestion: question }));
  assert.throws(() => parseSynthesis(raw('建议用3000K光源。', []), sources, { currentQuestion: question }), /unsupported_model_commitment/);
  assert.throws(() => parseSynthesis(raw(text), [], { currentQuestion: question }), /invalid_model_citation/);
});

test('explicit factual premises and genuine knowledge still support their own scoped suggestions', () => {
  const conditioned = '按你原话中“书房书桌改为靠内墙”的位置意向，建议布置时检查屏幕反光。';
  assert.doesNotThrow(() => parseSynthesis(raw(conditioned, [sources[2]]), sources, { currentQuestion: '请结合我书桌的位置意向给建议。' }));
  assert.doesNotThrow(() => parseSynthesis(raw('结合示例的反光注意事项，一般可先检查光线方向。', [knowledge]), [knowledge], { currentQuestion: question }));
});

test('model projection removes only unsolicited personal sources and keeps durable inputs plus knowledge conditions intact', () => {
  const original = messages(question, [...sources, knowledge]), before = structuredClone(original);
  const projected = focusedSynthesisMessages(original, 'current');
  const packet = JSON.parse((projected.find(m => m.role === 'tool') as Extract<ModelMessage, { role: 'tool' }>).content);
  assert.deepEqual(packet.synthesisSources.map((s: SynthesisSource) => s.sourceId), [knowledge.sourceId]);
  assert.equal(packet.synthesisSources[0].text, knowledge.text);
  assert.equal(packet.boundProjectContext, undefined); assert.equal(packet.currentNeedView, undefined);
  assert.deepEqual(original, before);
  const personal = focusedSynthesisMessages(messages('结合我家实际位置给一般建议。'), 'current');
  const actual = JSON.parse((personal.find(m => m.role === 'tool') as Extract<ModelMessage, { role: 'tool' }>).content);
  assert.equal(actual.synthesisSources.length, sources.length);
});

test('final schema and final validation share the same independent-advice source boundary', () => {
  for (const input of [messages(), focusedSynthesisMessages(messages(), 'current'), messages().slice(0, 1)]) {
    const segment = segmentSchema(input);
    assert.deepEqual(segment.basis.enum, ['advice', 'uncertainty']); assert.equal(segment.citations.maxItems, 0);
  }
  const segment = segmentSchema(messages(question, [...sources, knowledge]));
  const ids = ((segment.citations.items as Record<string, unknown>).properties as Record<string, Record<string, unknown>>).citationId.enum;
  assert.deepEqual(ids, sourceCitationCatalog(knowledge).map(c => c.citationId));
});

test('the one bound repair can remove rejected personal citations even after their model catalog is scoped away', () => {
  const bad = raw(text), feedback = synthesisRepairFeedback(bad, sources, { currentQuestion: question });
  assert.match(feedback!.feedback, /independent_advice_scope/);
  const input: ModelMessage[] = [...messages(), { role: 'assistant', content: bad }, { role: 'system', content: [{ type: 'text', text: feedback!.feedback }] }];
  const tool = finalToolForMessages(focusedSynthesisMessages(input, 'current'), question);
  const properties = tool.parameters.properties as Record<string, Record<string, unknown>>;
  const edit = (properties.edits.items as Record<string, unknown>).properties as Record<string, Record<string, unknown>>;
  assert.deepEqual((edit.addCitationIds.items as Record<string, unknown>).enum, []);
  assert.deepEqual((edit.removeCitationIds.items as Record<string, unknown>).enum, sources.map(s => cite(s).citationId));
  const repair = JSON.stringify({ kind: 'synthesis_repair', baseHash: fingerprint(bad), edits: [{ segment: 0, removeCitationIds: sources.map(s => cite(s).citationId) }] });
  const restored = resolveSynthesisRepair(repair, input, sources, 1);
  assert.equal(parseSynthesis(restored, sources, { currentQuestion: question }).segments[0].text, text);
  assert.throws(() => parseSynthesis(resolveSynthesisRepair(JSON.stringify({ kind: 'synthesis_repair', baseHash: fingerprint(bad), edits: [{ segment: 0, basis: 'uncertainty' }] }), input, sources, 1), sources, { currentQuestion: question }), /ungrounded_response_scope/);
  assert.throws(() => resolveSynthesisRepair(repair, input, [], 1), /invalid_model_citation/);
  assert.throws(() => resolveSynthesisRepair(repair, input, sources, 2), /invalid_model_answer/);
});
