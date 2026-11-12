import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Evidence } from '../contracts';
import type { ModelMessage, ModelTurnOutput } from '../contracts/model';
import { agentChatBody } from '@/lib/ai/providers/agent-chat';
import { agentConfig, agentCapabilityFingerprint } from '../agent/config';
import { sourceCitationCatalog } from '../agent/citation-catalog';
import { knowledgeSynthesisSources, synthesisInstructions } from '../agent/synthesis';
import { synthesisQuestionPrefix } from '../agent/model-policy';
import { compileModelRequest } from '../agent/model-request';
import { buildAgentContext, agentBasePolicy } from '../agent/context';
import { agentToolsForMessage, agentToolsForTurn, finalToolForMessages, constructionReadOnlyTools } from '../agent/worker';
import { answerExcerpts } from '../knowledge/answer';
import { currentKnowledgeQuestion, naturalKnowledgeProtocol, naturalKnowledgeInstructions, naturalKnowledgeReadTool,
  knowledgeExplanationProtocol, knowledgeQuantityScopeProtocol, knowledgeExplanationFailure,
  prepareKnowledgeExplanation, acceptKnowledgeExplanation, parseNaturalKnowledgeAnswer, sourceBoundaryValidationProtocol } from '../agent/knowledge-explanation';

const question = '我刚才说得不准，是水管根部，不是整面墙。为什么这里还要单独处理？';
const evidence: Evidence[] = [{ ref: { type: 'knowledge_chunk', id: '1', version: '1' }, hash: 'synthetic',
  text: '管根先用堵漏材料加强，并做好防水附加层。' }];
const sources = knowledgeSynthesisSources(evidence);
const citationId = sourceCitationCatalog(sources[0])[0].citationId;
const raw = (text = '管根先加强，并做好防水附加层。') => JSON.stringify({ kind: 'knowledge_explanation',
  segments: [{ basis: 'evidence', text, citations: [{ citationId }] }] });
const prepare = (text: string, q = question) => prepareKnowledgeExplanation(raw(text), sources, currentKnowledgeQuestion(q),
  { currentQuestion: q }, [], knowledgeQuantityScopeProtocol, naturalKnowledgeProtocol);
function verdict(check: Record<string, unknown> = {}, assertsQuantity?: boolean): ModelTurnOutput {
  return { text: '', toolCalls: [{ id: 'review', name: 'final_response', arguments: JSON.stringify({ questionsComplete: true,
    checks: { Q1: { complete: true, supported: true, conditionsPreserved: true, reason: '', ...check } },
    ...(assertsQuantity === undefined ? {} : { quantityChecks: { S1: { assertsQuantity, reason: assertsQuantity ? '实际施工遍数要求' : '附带指代' } } }),
  }) }], finishReason: 'tool_calls', providerRequestId: null, usage: { inputTokens: 1, outputTokens: 1 } };
}
const messages: ModelMessage[] = [
  { role: 'system', content: [{ type: 'text', text: synthesisInstructions + synthesisQuestionPrefix + JSON.stringify({ currentQuestion: question }) }] },
  { role: 'user', content: [{ type: 'text', text: JSON.stringify({ sourceMessageId: 'current', text: question }) }] },
  { role: 'assistant', content: '', toolCalls: [{ id: 'read', name: 'search_knowledge', arguments: JSON.stringify({ query: '管根防水' }) }] },
  { role: 'tool', callId: 'read', content: JSON.stringify({ knowledgeStatus: 'ready', evidence: answerExcerpts(evidence),
    synthesisSources: sources.map(s => ({ ...s, citationOptions: sourceCitationCatalog(s) })) }) },
];
const mode = { requiredKnowledge: true, knowledgeExplanation: true, naturalKnowledge: true };

test('natural source turns have query-only reads and a flat answer without model-planned questions', () => {
  const tools = agentToolsForMessage(question, true).map(naturalKnowledgeReadTool);
  const read = tools.find(t => t.name === 'search_knowledge')!;
  assert.deepEqual(read.parameters.required, ['query']);
  assert.deepEqual(Object.keys(read.parameters.properties as object), ['query']);
  assert.equal(naturalKnowledgeReadTool(read), read);
  const compiled = compileModelRequest({ question, triggerId: 'current', turn: 1, purpose: 'answer', messages, tools, ...mode,
    toolsForTurn: (q, m, t, id) => agentToolsForTurn(q, m, t, id, mode) });
  const final = compiled.dispatchTools.find(t => t.name === 'final_response')!;
  assert.deepEqual(final.parameters.required, ['kind', 'segments']);
  assert.deepEqual(Object.keys(final.parameters.properties as object), ['kind', 'segments']);
  assert.ok(compiled.modelMessages.some(m => m.role === 'system' && m.content.some(p => p.type === 'text' && p.text.startsWith(naturalKnowledgeInstructions))));
  for (const model of ['qwen3.7-flash', 'qwen3.8-flash']) {
    const wire = agentChatBody({ model, messages: compiled.modelMessages, tools: [final], maxTokens: 2048,
      requireTool: true, enableThinking: false }, 'https://dashscope.aliyuncs.com/compatible-mode/v1');
    assert.equal(wire.tools, undefined);
    const format = wire.response_format as { json_schema: { schema: { properties: object } } };
    assert.deepEqual(Object.keys(format.json_schema.schema.properties), ['kind', 'segments']);
  }
});

test('a completed RAG read with no sources sends a valid uncited answer schema to Bailian', () => {
  const noMatch: ModelMessage[] = [...messages.slice(0, -2),
    { role: 'assistant', content: '', toolCalls: [{ id: 'read', name: 'knowledge_search', arguments: '{"query":"管根防水"}' }] },
    { role: 'tool', callId: 'read', content: JSON.stringify({ knowledgeStatus: 'ready', evidence: [], synthesisSources: [] }) }];
  const final = finalToolForMessages(noMatch, question, false, false, false, true, undefined, true);
  const wire = agentChatBody({ model: 'qwen3.7-flash', messages: noMatch, tools: [final], maxTokens: 2048,
    requireTool: true, enableThinking: false }, 'https://dashscope.aliyuncs.com/compatible-mode/v1');
  const schema = (wire.response_format as { json_schema: { schema: unknown } }).json_schema.schema;
  assert.doesNotMatch(JSON.stringify(schema), /"enum":\[\]/);
  assert.match(JSON.stringify(schema), /"maxItems":0/);
  assert.match(JSON.stringify(schema), /"enum":\["advice","uncertainty"\]/);
  const text = JSON.stringify({ kind: 'knowledge_explanation', segments: [
    { basis: 'uncertainty', text: '这次没有找到管根做法的企业条款。', citations: [] },
  ] });
  assert.equal(parseNaturalKnowledgeAnswer(text, [], { currentQuestion: question }).segments[0].basis, 'uncertainty');
});

test('review binds the complete correction, rejects an expanded plan, and supports the full message length', () => {
  const draft = prepare('管根先加强，并做好防水附加层。');
  const message = draft.reviewMessages.find(m => m.role === 'user')!;
  assert.equal(message.role, 'user');
  const packet = JSON.parse(message.role === 'user' && message.content[0].type === 'text' ? message.content[0].text : '{}');
  assert.equal(packet.currentQuestion, question); assert.deepEqual(packet.questions, { Q1: question });
  assert.equal(packet.protocol, naturalKnowledgeProtocol);
  assert.throws(() => prepareKnowledgeExplanation(raw(), sources, currentKnowledgeQuestion('请列出具体施工做法。'),
    { currentQuestion: question }, [], knowledgeQuantityScopeProtocol, naturalKnowledgeProtocol), /context_changed/);
  const long = '背景说明。'.repeat(220) + question;
  assert.ok(long.length > 1000); assert.doesNotThrow(() => prepare('管根先加强，并做好防水附加层。', long));
  assert.throws(() => currentKnowledgeQuestion(' '), /context_changed/);
  assert.throws(() => currentKnowledgeQuestion('问'.repeat(4001)), /context_changed/);
});

test('an omitted WHY or strengthened sequence still fails and repairs the flat answer', () => {
  const draft = prepare('管根先加强，并做好防水附加层。');
  // Scripted decisions exercise enforcement; they do not establish model quality.
  assert.equal(acceptKnowledgeExplanation(draft, verdict(), draft.binding), null);
  for (const check of [{ complete: false, reason: '没有解释为什么' }, { supported: false, reason: '原文未建立跨条款顺序' },
    { conditionsPreserved: false, reason: '仍在回答整面墙，未接住更正' }]) {
    const issue = acceptKnowledgeExplanation(draft, verdict(check), draft.binding)!;
    assert.match(issue.feedback, /knowledge_explanation\/segments/);
    assert.ok(issue.feedback.includes(check.reason));
    assert.doesNotMatch(issue.feedback, /保留全部Q编号/);
  }
});

test('read-only natural input reuses the source view without unavailable action policies or changing originals', () => {
  const history = buildAgentContext([{ id: 'current', role: 'user', text: question }], { version: 0, facts: [] });
  if (history[0].role === 'system') history[0].content.push({ type: 'text', text: synthesisInstructions + synthesisQuestionPrefix + JSON.stringify({ currentQuestion: question }) });
  const original = structuredClone(history);
  const compiled = compileModelRequest({ question, triggerId: 'current', turn: 0, purpose: 'answer', messages: history,
    tools: constructionReadOnlyTools('project_collaboration', true)!, knowledgeExplanation: true, naturalKnowledge: true,
    toolsForTurn: (q, m, t, id) => agentToolsForTurn(q, m, t, id, { knowledgeExplanation: true, naturalKnowledge: true }) });
  assert.ok(compiled.contentProjection);
  assert.ok(!compiled.modelMessages.some(m => m.role === 'system' && m.content.some(p => p.type === 'text' && p.text.startsWith(agentBasePolicy))));
  assert.deepEqual(compiled.modelMessages.filter(m => m.role === 'user'), history.filter(m => m.role === 'user'));
  assert.deepEqual(history, original);
  // Actual action-capable turns keep their own rules. The view is selected by
  // application tools and the exact trusted contract, never by user text.
  const withWrite = compileModelRequest({ question, triggerId: 'current', turn: 0, purpose: 'answer', messages: history,
    tools: [{ name: 'record_need', description: '', parameters: {} }], knowledgeExplanation: true, naturalKnowledge: true,
    toolsForTurn: (_q, _m, tools) => tools });
  assert.equal(withWrite.contentProjection, null);
});

test('causal paraphrases reach source-bound semantic review while unsupported reasons require rejection', () => {
  const original = [{ ...evidence[0], text: '先铺管后穿线，避免先穿线后铺管而无法抽动电线，便于后期维修。' }];
  const selected = knowledgeSynthesisSources(original), id = sourceCitationCatalog(selected[0])[0].citationId;
  const q = '先穿线还是先铺管，为什么？';
  const draftRaw = JSON.stringify({ kind: 'knowledge_explanation', segments: [{ basis: 'evidence',
    text: '先铺管再穿线，避免电线无法抽动，以便后期检修。', citations: [{ citationId: id }] }] });
  const draft = prepareKnowledgeExplanation(draftRaw, selected, currentKnowledgeQuestion(q), { currentQuestion: q }, [], knowledgeQuantityScopeProtocol, naturalKnowledgeProtocol);
  assert.equal(acceptKnowledgeExplanation(draft, verdict(), draft.binding), null);
  const rejected = acceptKnowledgeExplanation(draft, verdict({ supported: false, reason: '所引原文未支持这项原因' }), draft.binding);
  assert.equal(rejected?.code, 'ungrounded_response_scope');
  const grouped = JSON.stringify({ kind: 'knowledge_explanation', answers: { Q1: JSON.parse(draftRaw).segments } });
  assert.throws(() => prepareKnowledgeExplanation(grouped, selected, currentKnowledgeQuestion(q), { currentQuestion: q }, [], knowledgeQuantityScopeProtocol), /ungrounded_response_scope/);
});

test('ordinary natural answers retain strict citation, number, quantity and operation boundaries without a model verdict', () => {
  assert.equal(parseNaturalKnowledgeAnswer(raw(), sources, { currentQuestion: question }).segments.length, 1);
  for (const text of ['必须涂刷900毫米。', '管根需要涂刷三遍。', '我已经联系施工经理并安排验收。'])
    assert.throws(() => parseNaturalKnowledgeAnswer(raw(text), sources, { currentQuestion: question }), /unsupported_model_commitment/);
  assert.throws(() => parseNaturalKnowledgeAnswer(raw(), [{ ...sources[0], text: '来源已撤回或换版。' }], { currentQuestion: question }), /invalid_model_citation/);
  const changed = JSON.parse(raw()); changed.segments[0].citations = [{ citationId: 'invented' }];
  assert.throws(() => parseNaturalKnowledgeAnswer(JSON.stringify(changed), sources, { currentQuestion: question }), /invalid_model_citation/);
});

test('incidental pass counts reach the existing review while real counts and numeric hallucinations stay blocked', () => {
  const draft = prepare('管根需要单独加强，不是靠大面那一遍涂刷顺带覆盖。');
  assert.equal(acceptKnowledgeExplanation(draft, verdict({}, false), draft.binding), null);
  assert.equal(acceptKnowledgeExplanation(draft, verdict({}, true), draft.binding)?.code, 'unsupported_model_commitment');
  assert.throws(() => prepare('必须涂刷900毫米。'), /unsupported_model_commitment/);
  assert.throws(() => prepareKnowledgeExplanation(raw(), [{ ...sources[0], text: '来源已经改变。' }], currentKnowledgeQuestion(question),
    { currentQuestion: question }, [], knowledgeQuantityScopeProtocol, naturalKnowledgeProtocol), /invalid_model_citation/);
  assert.throws(() => acceptKnowledgeExplanation(draft, verdict({}, false), 'another-draft'), /context_changed/);
});

test('old grouped replies do not silently enter the natural protocol and old snapshots retain their shape', () => {
  const grouped = JSON.stringify({ kind: 'knowledge_explanation', answers: { Q1: JSON.parse(raw()).segments } });
  const coverage = currentKnowledgeQuestion(question), context = { currentQuestion: question };
  assert.doesNotThrow(() => prepareKnowledgeExplanation(grouped, sources, coverage, context, [], knowledgeQuantityScopeProtocol));
  assert.throws(() => prepareKnowledgeExplanation(grouped, sources, coverage, context, [], knowledgeQuantityScopeProtocol, naturalKnowledgeProtocol), /invalid_model_answer/);
  assert.throws(() => prepareKnowledgeExplanation(raw(), sources, coverage, context), /invalid_model_answer/);
  try { prepareKnowledgeExplanation(grouped, sources, coverage, context, [], knowledgeQuantityScopeProtocol, naturalKnowledgeProtocol); }
  catch (error) { assert.match(knowledgeExplanationFailure(error, true).feedback, /knowledge_explanation\/segments/); }
});

test('unpaired data stays untrusted while web-only reads use the same original-bound answer contract', () => {
  const unpaired = finalToolForMessages(messages.slice(-1), question, false, false, false, true, undefined, true);
  const web = structuredClone(messages);
  if (web[2].role === 'assistant') web[2].toolCalls![0].name = 'search_web';
  const webFinal = finalToolForMessages(web, question, false, false, false, true, undefined, true);
  assert.doesNotMatch(JSON.stringify(unpaired.parameters), /knowledge_explanation/);
  assert.match(JSON.stringify(webFinal.parameters), /knowledge_explanation/);
  assert.deepEqual(webFinal.parameters.required, ['kind', 'segments']);
});

test('ordinary shared questions may answer directly and public reads are entry-scoped without business writes', () => {
  const q = '卫生间做干湿分离有什么好处？';
  const tools = constructionReadOnlyTools('project_collaboration', true, false, false, true)!;
  assert.deepEqual(tools.map(t => t.name), ['search_knowledge', 'search_web']);
  assert.deepEqual(constructionReadOnlyTools('project_collaboration', true)!.map(t => t.name), ['search_knowledge']);
  assert.deepEqual(constructionReadOnlyTools('project_collaboration', false, false, false, true), []);
  const initial: ModelMessage[] = [
    { role: 'system', content: [{ type: 'text', text: synthesisInstructions + synthesisQuestionPrefix + JSON.stringify({ currentQuestion: q }) }] },
    { role: 'user', content: [{ type: 'text', text: JSON.stringify({ sourceMessageId: 'current', text: q }) }] },
  ];
  const naturalMode = { knowledgeExplanation: true, naturalKnowledge: true };
  const compiled = compileModelRequest({ question: q, triggerId: 'current', turn: 0, purpose: 'answer', messages: initial, tools, ...naturalMode,
    toolsForTurn: (question, history, available, id) => agentToolsForTurn(question, history, available, id, naturalMode) });
  assert.ok(compiled.dispatchTools.some(t => t.name === 'final_response'));
  assert.ok(compiled.dispatchTools.some(t => t.name === 'search_web'));
  assert.ok(compiled.modelMessages.some(m => m.role === 'system' && m.content.some(p => p.type === 'text' && p.text.startsWith(naturalKnowledgeInstructions))));
  assert.deepEqual(agentToolsForTurn(q, initial, tools, 'current', { requiredKnowledge: true }).map(t => t.name), ['search_knowledge']);
});

test('natural mode is explicitly selected at admission without changing capability fences', () => {
  const base = { runtime: 'langgraph-v1', providerKey: 'dashscope', model: 'qwen3.8-flash', tools: true, imageInput: true, probeVersion: 'synthetic' };
  assert.equal(agentConfig(base)?.knowledgeExplanation, undefined);
  const old = agentConfig({ ...base, knowledgeExplanation: knowledgeExplanationProtocol });
  const natural = agentConfig({ ...base, knowledgeExplanation: naturalKnowledgeProtocol });
  const direct = agentConfig({ ...base, knowledgeExplanation: naturalKnowledgeProtocol, knowledgeAnswerValidation: sourceBoundaryValidationProtocol });
  assert.equal(natural?.knowledgeExplanation, naturalKnowledgeProtocol);
  assert.equal(agentCapabilityFingerprint(old), agentCapabilityFingerprint(natural));
  assert.equal(direct?.knowledgeAnswerValidation, sourceBoundaryValidationProtocol);
  assert.equal(agentCapabilityFingerprint(natural), agentCapabilityFingerprint(direct));
  assert.throws(() => agentConfig({ ...base, knowledgeAnswerValidation: sourceBoundaryValidationProtocol }), /assistant_capability_forbidden/);
  assert.throws(() => agentConfig({ ...base, knowledgeExplanation: knowledgeExplanationProtocol, knowledgeAnswerValidation: sourceBoundaryValidationProtocol }), /assistant_capability_forbidden/);
  assert.throws(() => agentConfig({ ...base, tools: false, knowledgeExplanation: naturalKnowledgeProtocol }), /assistant_capability_forbidden/);
});
