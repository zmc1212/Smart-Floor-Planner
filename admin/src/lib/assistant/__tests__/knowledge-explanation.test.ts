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
  knowledgeNumericFailure, knowledgeStatusFailure, parseNaturalKnowledgeAnswer, partialNaturalSpecialistAnswer } from '../agent/knowledge-explanation';

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

test('specialist quantity fallback preserves the justified segment and keeps the original draft private', () => {
  const page = '管道穿过楼板时，应对管道与基层的交接处进行密封处理。';
  const source = { sourceId: 'W1', kind: 'web' as const, title: '规范原文', text: page, fullTextCitable: true as const };
  const selected = sourceCitationCatalog(source)[0].citationId;
  const review = { currentQuestion: '卫生间管道穿楼板时，管根防水怎么处理？', specialistAcceptance: true };
  const original = { basis: 'evidence', text: page, citations: [{ citationId: selected }] };
  const draft = JSON.stringify({ kind: 'knowledge_explanation', segments: [
    original, { basis: 'advice', text: '可以按经验上翻250 mm，墙边做30–50 mm。', citations: [] },
    { basis: 'advice', text: '师傅这个高度也可以当经验参考。', citations: [] },
  ] });
  assert.throws(() => parseNaturalKnowledgeAnswer(draft, [source], review), /unsupported_model_commitment/);
  const repair = knowledgeNumericFailure(draft, { ...coverage, questions: [coverage.questions[0]] }, [source], true, true);
  assert.match(repair!.feedback, /"position":2/);
  assert.match(repair!.feedback, /250 mm/);
  assert.match(repair!.feedback, /规范原文/);
  const projected = partialNaturalSpecialistAnswer(draft, [source], review)!;
  assert.doesNotMatch(projected, /250|30–50|经验|师傅/);
  const answer = parseNaturalKnowledgeAnswer(projected, [source], review);
  assert.equal(answer.segments[0].text, original.text);
  assert.equal(answer.segments[0].citations[0].quote, page);
  assert.equal(answer.segments[1].basis, 'uncertainty');
  assert.match(answer.segments[1].text, /这次可用的资料还不足以确认具体施工参数/);
  assert.throws(() => partialNaturalSpecialistAnswer(draft.replace(selected, 'unknown'), [source], review), /invalid_model_citation/);
});

test('a cited number with an unrelated unit does not support the specialist claim', () => {
  const source = { sourceId: 'W1', kind: 'web' as const, title: '规范原文', text: '长度为30 mm。', fullTextCitable: true as const };
  const text = (value: string) => JSON.stringify({ kind: 'synthesis', segments: [
    { basis: 'evidence', text: value, citations: [{ sourceId: source.sourceId, quote: source.text }] },
  ] });
  const specialist = { specialistAcceptance: true };
  assert.throws(() => parseSynthesis(text('长度为30 cm。'), [source], specialist), /unsupported_model_commitment/);
  assert.doesNotThrow(() => parseSynthesis(text('长度为30毫米。'), [source], specialist));
  assert.throws(() => parseSynthesis(JSON.stringify({ kind: 'synthesis', segments: [
    { basis: 'advice', text: '经验上长度30 mm。', citations: [] },
  ] }), [], { ...specialist, generalKnowledge: true }), /unsupported_model_commitment/);
});
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

test('I6.14 G status, dates, scope and quantities keep separate source roles', () => {
  const notice = { sourceId: 'Wnotice', kind: 'web' as const, title: '发布公告',
    text: '现批准《建筑与市政工程防水通用规范》为国家标准，编号为GB55030-2022，自2023年4月1日起实施。',
    web: { standard: { id: 'GB55030-2022', kind: 'publication_notice', status: 'unknown', effectiveAt: '2023-04-01' } } as never };
  const catalog = { sourceId: 'Wstatus', kind: 'web' as const, title: '标准目录',
    text: 'GB55030-2022：建筑与市政工程防水通用规范现行\n实施日期：2023-04-01',
    web: { standard: { id: 'GB55030-2022', kind: 'status_catalog', status: 'current', effectiveAt: '2023-04-01' } } as never };
  const text = { sourceId: 'Wtext', kind: 'web' as const, title: '建筑与市政工程防水通用规范.pdf',
    text: '1.0.2 建筑与市政工程防水必须执行本规范。\n6.0.12 楼、地面最小蓄水高度不应小于20mm，蓄水时间不应少于24h；\n2 有防水要求的墙面应进行淋水试验，淋水时间不应少于30min；',
    web: { standard: { id: 'GB55030-2022', kind: 'standard_text', status: 'unknown' }, document: { reviewedTextHash: 'p'.repeat(64) } } as never };
  const pick = (source: typeof notice) => sourceCitationCatalog(source as never)[0].citationId;
  const pickContaining = (source: typeof notice, value: string) => sourceCitationCatalog(source as never)
    .find(citation => citation.quote.includes(value))!.citationId;
  const fixedCoverage = parseKnowledgeExplanationQuery({ questions: ['是否有效', '实施日期', '适用范围', '施工数值'] });
  const answer = (replace: (answers: Record<string, unknown>) => void = () => {}) => {
    const answers: Record<string, unknown> = {
      Q1: [{ basis: 'evidence', text: 'GB 55030-2022 目前现行有效。', citations: [{ citationId: pick(catalog) }] }],
      Q2: [{ basis: 'evidence', text: '该规范自2023年4月1日起实施。', citations: [{ citationId: pick(notice) }] }],
      Q3: [{ basis: 'evidence', text: '建筑与市政工程防水必须执行本规范。', citations: [{ citationId: pick(text) }] }],
      Q4: [{ basis: 'evidence', text: '蓄水高度不应小于20mm，蓄水时间不应少于24h。', citations: [{ citationId: pickContaining(text, '20mm') }] },
        { basis: 'evidence', text: '有防水要求的墙面淋水时间不应少于30min。', citations: [{ citationId: pickContaining(text, '30min') }] }],
    };
    replace(answers);
    return JSON.stringify({ kind: 'knowledge_explanation', answers });
  };
  assert.doesNotThrow(() => prepareKnowledgeExplanation(answer(), [notice, catalog, text] as never, fixedCoverage, { currentQuestion: fixedCoverage.questions.join('；') }));
  assert.throws(() => prepareKnowledgeExplanation(answer(answers => {
    answers.Q1 = [{ basis: 'evidence', text: 'GB 55030-2022 目前现行有效。', citations: [{ citationId: pick(notice) }] }];
  }), [notice, catalog, text] as never, fixedCoverage, { currentQuestion: fixedCoverage.questions.join('；') }), /standard_status_unverified/);
  assert.throws(() => prepareKnowledgeExplanation(answer(answers => {
    answers.Q4 = [{ basis: 'advice', text: '闭水试验一般保持24小时。', citations: [] }];
  }), [notice, catalog, text] as never, fixedCoverage, { currentQuestion: fixedCoverage.questions.join('；') }), /unsupported_model_commitment/);
});
