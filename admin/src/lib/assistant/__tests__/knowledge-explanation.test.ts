import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Evidence } from '../contracts';
import type { ModelMessage, ModelTurnOutput } from '../contracts/model';
import { knowledgeSynthesisSources, parseSynthesis, synthesisInstructions } from '../agent/synthesis';
import { sourceCitationCatalog } from '../agent/citation-catalog';
import { compileModelRequest } from '../agent/model-request';
import { synthesisQuestionPrefix } from '../agent/model-policy';
import { agentToolsForMessage, agentToolsForTurn, finalToolForMessages } from '../agent/worker';
import { answerExcerpts } from '../knowledge/answer';
import { agentChatBody } from '@/lib/ai/providers/agent-chat';
import { agentConfig, agentCapabilityFingerprint } from '../agent/config';
import { parseSourceQuestionQuery } from '../agent/source-question-coverage';
import { acceptKnowledgeExplanation, exactKnowledgeQuoteRequested, knowledgeExplanationInstructions, knowledgeExplanationProtocol,
  prepareKnowledgeExplanation, knowledgeExplanationReadTool, parseKnowledgeExplanationQuery, assertExplanationDispatchBudget, knowledgeExplanationFailure,
  knowledgeNumericFailure, knowledgeStatusFailure } from '../agent/knowledge-explanation';

const question = '我在看《精艺》，线管拐弯和穿线顺序该怎么理解？';
const coverage = parseSourceQuestionQuery({ questions: ['线管拐弯', '穿线顺序'] }, question);
const evidence: Evidence[] = [{ ref: { type: 'knowledge_chunk', id: '1', version: '1' }, hash: 'synthetic',
  text: '线管弯头采用大弯，保证抽线灵活，方便维修。\n先铺设线管后穿线，不可先穿线后铺管。' }];
const sources = knowledgeSynthesisSources(evidence);
const catalog = sourceCitationCatalog(sources[0]);
const citationId = catalog[0].citationId;
const segment = (text: string, basis = 'evidence') => ({ basis, text, citations: basis === 'evidence' ? [{ citationId }] : [] });
const raw = JSON.stringify({ kind: 'knowledge_explanation', answers: {
  Q1: [segment('按这份资料，线管拐弯需要采用大弯，方便以后抽线和维修。')],
  Q2: [segment('顺序是先铺管再穿线，不能先把线穿好再铺管。')],
} });
const context = { currentQuestion: question };
const verdict = (overrides: Record<string, unknown> = {}): ModelTurnOutput => ({ text: '', toolCalls: [{ id: 'review', name: 'final_response',
  arguments: JSON.stringify({ questionsComplete: true, checks: { Q1: { complete: true, supported: true, conditionsPreserved: true, reason: '' },
    Q2: { complete: true, supported: true, conditionsPreserved: true, reason: '' } }, ...overrides }) }],
  finishReason: 'tool_calls', providerRequestId: null, usage: { inputTokens: 100, outputTokens: 20 },
});

test('natural paraphrase is a draft until a separate complete hash-bound review accepts it', () => {
  // Reproduce1596's meaningful distinction: source validity alone cannot
  // establish semantic entailment or demand byte-identical explanatory text.
  const synthesis = JSON.stringify({ kind: 'synthesis', segments: [segment('线管拐弯需要采用大弯。')] });
  assert.throws(() => parseSynthesis(synthesis, sources, context), /ungrounded_response_scope/);
  const draft = prepareKnowledgeExplanation(raw, sources, coverage, context);
  assert.equal(draft.answer.segments.length, 2);
  assert.equal(acceptKnowledgeExplanation(draft, verdict(), draft.binding), null);
  assert.throws(() => acceptKnowledgeExplanation(draft, verdict(), 'other-answer'), /context_changed/);
  const instructions = draft.reviewMessages[0]; assert.equal(instructions.role, 'system');
  assert.match(instructions.role === 'system' && instructions.content[0].type === 'text' ? instructions.content[0].text : '', /顺序.*必须\/建议/);
  const data = draft.reviewMessages[1]; assert.equal(data.role, 'user');
  const packet = JSON.parse(data.role === 'user' && data.content[0].type === 'text' ? data.content[0].text : '{}');
  assert.equal(packet.answers.Q1[0].citations[0].sourceId, sources[0].sourceId);
  assert.equal(packet.answers.Q1[0].citations[0].quote, evidence[0].text);
});

test('omitted questions and unsupported or strengthened claims cannot pass review', () => {
  const value = JSON.parse(raw); delete value.answers.Q2;
  assert.throws(() => prepareKnowledgeExplanation(JSON.stringify(value), sources, coverage, context), /incomplete_model_answer/);
  const draft = prepareKnowledgeExplanation(raw, sources, coverage, context);
  assert.ok(acceptKnowledgeExplanation(draft, verdict({ questionsComplete: false }), draft.binding));
  for (const field of ['complete', 'supported', 'conditionsPreserved']) {
    const checks = JSON.parse(verdict().toolCalls[0].arguments).checks;
    checks.Q2[field] = false; checks.Q2.reason = '穿线顺序没有得到正确回应';
    assert.match(acceptKnowledgeExplanation(draft, verdict({ checks }), draft.binding)!.feedback, /穿线顺序/);
  }
  assert.throws(() => acceptKnowledgeExplanation(draft, verdict({ checks: { Q1: {} } }), draft.binding), /incomplete_model_answer/);
  assert.throws(() => acceptKnowledgeExplanation(draft, verdict({ questionsComplete: 'true' }), draft.binding), /invalid_model_answer/);
});

test('numeric, receipt and citation guards remain deterministic before any semantic dispatch', () => {
  for (const text of ['线管间距必须是900毫米。', '我已经验收合格，保证安全入住。']) {
    const value = JSON.parse(raw); value.answers.Q1[0].text = text;
    assert.throws(() => prepareKnowledgeExplanation(JSON.stringify(value), sources, coverage, context), /unsupported_model_commitment|ungrounded_response_scope/);
  }
  const value = JSON.parse(raw); value.answers.Q1[0].citations = [{ citationId: 'foreign-id' }];
  assert.throws(() => prepareKnowledgeExplanation(JSON.stringify(value), sources, coverage, context), /invalid_model_citation/);
  assert.throws(() => prepareKnowledgeExplanation(raw, [{ ...sources[0], text: sources[0].text + '条件更正。' }], coverage, context), /invalid_model_citation/);
  const changed = prepareKnowledgeExplanation(raw, [{ ...sources[0], evidence: { ...evidence[0], hash: 'changed-source' } }], coverage, context);
  const draft = prepareKnowledgeExplanation(raw, sources, coverage, context);
  assert.notEqual(draft.binding, changed.binding);
  const corrected = prepareKnowledgeExplanation(raw, sources, coverage, context, [{ role: 'user', content: [{ type: 'text', text: '不是整面墙，是管根。' }] }]);
  assert.notEqual(corrected.binding, draft.binding);
});

test('ordinary explanation and explicit exact quotation have distinct protocols', () => {
  assert.equal(exactKnowledgeQuoteRequested('请解释《精艺》这条要求，为什么要这样做？'), false);
  assert.equal(exactKnowledgeQuoteRequested('把这条要求逐字给我看。'), true);
  assert.equal(exactKnowledgeQuoteRequested('把管根处理的原文贴出来。'), true);
  const tools = agentToolsForMessage(question, true).map(knowledgeExplanationReadTool);
  const read = tools.find(t => t.name === 'search_knowledge')!;
  assert.equal(knowledgeExplanationReadTool(read), read);
  assert.ok(!read.description.includes('正文仍由服务端从原文渲染'));
  assert.deepEqual(read.parameters.required, ['query', 'questions']);
  const messages: ModelMessage[] = [
    { role: 'system', content: [{ type: 'text', text: synthesisInstructions + synthesisQuestionPrefix + JSON.stringify({ currentQuestion: question }) }] },
    { role: 'user', content: [{ type: 'text', text: JSON.stringify({ sourceMessageId: 'current', text: question }) }] },
    { role: 'assistant', content: '', toolCalls: [{ id: 'read', name: 'search_knowledge', arguments: JSON.stringify({ query: question, questions: coverage.questions }) }] },
    { role: 'tool', callId: 'read', content: JSON.stringify({ knowledgeStatus: 'ready', questionCoverage: coverage, evidence: answerExcerpts(evidence), synthesisSources: sources }) },
  ];
  const mode = { requiredKnowledge: true, sourceQuestionCoverage: true, knowledgeExplanation: true };
  const compiled = compileModelRequest({ question, triggerId: 'current', turn: 1, purpose: 'answer', messages, tools, ...mode,
    toolsForTurn: (q, m, t, id) => agentToolsForTurn(q, m, t, id, mode) });
  const final = compiled.dispatchTools.find(t => t.name === 'final_response')!;
  assert.deepEqual(final.parameters.required, ['kind', 'answers']);
  assert.ok(compiled.modelMessages.some(m => m.role === 'system' && m.content.some(p => p.type === 'text' && p.text.startsWith(knowledgeExplanationInstructions))));
  const legacy = finalToolForMessages(messages, question, true, true, true);
  assert.deepEqual(legacy.parameters.required, ['kind', 'selections', 'coverage']);
  const unpaired = finalToolForMessages(messages.slice(-1), question, false, true, true, true);
  assert.ok(!(unpaired.parameters.required as string[]).includes('answers'));
});

test('grounding compilation retains its own bounded schema and cannot acquire business tools', () => {
  const draft = prepareKnowledgeExplanation(raw, sources, coverage, context);
  const compiled = compileModelRequest({ question, triggerId: 'current', turn: 61, purpose: 'grounding',
    messages: draft.reviewMessages, tools: [draft.reviewTool], toolsForTurn: () => { throw Error('Do not use agent planning for review'); } });
  assert.deepEqual(compiled.dispatchTools.map(t => t.name), ['final_response']);
  assert.deepEqual(compiled.modelMessages, draft.reviewMessages);
  const wire = agentChatBody({ model: 'qwen3.7-flash', messages: compiled.modelMessages,
    tools: compiled.dispatchTools, maxTokens: 2048, requireTool: true, enableThinking: false }, 'https://dashscope.aliyuncs.com/compatible-mode/v1');
  // qwen3.7's already documented native final format supersedes tool_choice.
  // The isolated review schema must still be the only outgoing capability.
  assert.equal(wire.tools, undefined); assert.equal(wire.tool_choice, undefined);
  const format = wire.response_format as { type: string; json_schema: { name: string; strict: boolean; schema: { properties: Record<string, unknown>; additionalProperties: boolean } } };
  assert.equal(format.type, 'json_schema'); assert.equal(format.json_schema.name, 'final_response'); assert.equal(format.json_schema.strict, true);
  assert.deepEqual(Object.keys(format.json_schema.schema.properties).sort(), ['checks', 'questionsComplete']);
  assert.equal(format.json_schema.schema.additionalProperties, false);
  assert.equal(knowledgeExplanationProtocol, 'reviewed-knowledge-explanation-v1');
});

test('unaccepted explanation mode is opt-in and cannot change another run strategy', () => {
  const base = { runtime: 'langgraph-v1', providerKey: 'dashscope', model: 'qwen3.7-flash', tools: true, imageInput: true, probeVersion: 'synthetic' };
  assert.equal(agentConfig(base)?.knowledgeExplanation, undefined);
  const opted = agentConfig({ ...base, knowledgeExplanation: knowledgeExplanationProtocol });
  assert.equal(opted?.knowledgeExplanation, knowledgeExplanationProtocol);
  assert.equal(agentCapabilityFingerprint(opted), agentCapabilityFingerprint(agentConfig(base)));
  assert.throws(() => agentConfig({ ...base, knowledgeExplanation: 'unknown' }), /assistant_capability_forbidden/);
});

test('saved1606 repeated source subject is planning data, while exact-source and format guards remain', () => {
  const original = '《精艺》里，防水基层要怎么准备？管根要怎么加强？';
  const input = { query: '防水基层准备及管根加强做法', questions: ['《精艺》里，防水基层要怎么准备？', '《精艺》里，管根要怎么加强？'] };
  assert.throws(() => parseSourceQuestionQuery(input, original), /invalid_message/);
  assert.deepEqual(parseKnowledgeExplanationQuery(input).questions, input.questions);
  for (const questions of [[], ['x'], ['重复', '重复'], ['换行\n问项']])
    assert.throws(() => parseKnowledgeExplanationQuery({ questions }), /invalid_message/);
  assert.throws(() => parseKnowledgeExplanationQuery({ ...input, enterpriseId: 'other' }), /invalid_message/);
});

test('review plus one repair stays within the original token reservation and a hard dispatch ceiling', () => {
  assert.doesNotThrow(()=>assertExplanationDispatchBudget([15000,15000,15000,15000],12000,72000));
  assert.throws(()=>assertExplanationDispatchBudget([15000,15000,15000,15000],12001,72000),/assistant_quota_exceeded/);
  assert.throws(()=>assertExplanationDispatchBudget([1,1,1,1,1],1,72000),/assistant_quota_exceeded/);
  assert.throws(()=>assertExplanationDispatchBudget([NaN],100,72000),/assistant_quota_exceeded/);
});

test('ordinary explanation repair reuses precise numeric diagnostics rather than a generic rejection', () => {
  const value=JSON.parse(raw);value.answers.Q2[0].text='需要在900毫米处处理。';
  const fileSources=[{...sources[0],evidence:{...evidence[0],file:{format:'pdf' as const,kind:'paragraph' as const,name:'synthetic.pdf',page:1,
    label:'PDF第1页',parser:'xiaok-file-v1:pdf:synthetic',assetId:'1',blockId:'b1',section:[],paragraph:1,sourceHash:'a'.repeat(64)}}}];
  try {prepareKnowledgeExplanation(JSON.stringify(value),fileSources,coverage,context);assert.fail('Missing numeric source must fail');}
  catch(error){const issue=knowledgeExplanationFailure(error);assert.match(issue.feedback,/900/);assert.match(issue.feedback,/questionId/);}
});

test('numeric repair names the uncited quantity and only same-run candidates', () => {
  const original = JSON.stringify({ kind: 'knowledge_explanation', answers: { Q1: [{ basis: 'advice', text: '闭水试验一般保持24小时。', citations: [] }] } });
  const timed = knowledgeSynthesisSources([{ ref: { type: 'knowledge_chunk', id: '24h', version: '1' }, hash: 'synthetic',
    text: '闭水试验保持24小时，观察无渗漏。' }]);
  const all = [...sources, ...timed];
  const issue = knowledgeNumericFailure(original, coverage, all);
  assert.equal(issue?.code, 'unsupported_model_commitment');
  const feedback = JSON.parse(issue!.feedback);
  assert.deepEqual(feedback.gaps, [{ question: 'Q1', position: 1, numbers: ['24'], quantities: [] }]);
  assert.equal(feedback.citationCandidates[0].citationId, sourceCitationCatalog(timed[0])[0].citationId);
  const cited = JSON.stringify({ kind: 'knowledge_explanation', answers: { Q1: [{ basis: 'evidence', text: '闭水试验保持24小时。',
    citations: [{ citationId: sourceCitationCatalog(timed[0])[0].citationId }] }] } });
  assert.equal(knowledgeNumericFailure(cited, coverage, all), null);
});

test('status repair names the segment whose validity claim cites only a notice', () => {
  const notice = { sourceId: 'Wnotice', kind: 'web' as const, title: '发布公告',
    text: '现批准《建筑与市政工程防水通用规范》为国家标准，编号为GB55030-2022，自2023年4月1日起实施。本规范为强制性工程建设规范。',
    web: { standard: { id: 'GB55030-2022', kind: 'publication_notice', status: 'unknown' } } as never };
  const catalog = { sourceId: 'Wstatus', kind: 'web' as const, title: '标准目录',
    text: 'GB55030-2022：建筑与市政工程防水通用规范现行\n发布日期：2022-09-27\n实施日期：2023-04-01',
    web: { standard: { id: 'GB55030-2022', kind: 'status_catalog', status: 'current', effectiveAt: '2023-04-01' } } as never };
  const selected = (source: typeof notice) => sourceCitationCatalog(source as never)[0].citationId;
  const draft = JSON.stringify({ kind: 'knowledge_explanation', answers: { Q1: [
    { basis: 'evidence', text: '该规范现行有效。', citations: [{ citationId: selected(notice) }] },
    { basis: 'evidence', text: '公告说明自2023年4月1日起实施；目前「现行」状态由目录支持。', citations: [{ citationId: selected(notice) }] },
  ] } });
  const issue = knowledgeStatusFailure(draft, coverage, [notice, catalog] as never);
  assert.equal(issue?.code, 'standard_status_unverified');
  const feedback = JSON.parse(issue!.feedback);
  assert.deepEqual(feedback.gaps, [{ question: 'Q1', position: 1, claims: ['现行有效'] },
    { question: 'Q1', position: 2, claims: ['现行'] }]);
  assert.equal(feedback.statusCitationCandidates[0].citationId, selected(catalog));
});
