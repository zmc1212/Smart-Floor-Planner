import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Evidence } from '../contracts';
import type { ModelTurnOutput } from '../contracts/model';
import { agentConfig, agentCapabilityFingerprint } from '../agent/config';
import { compileModelRequest } from '../agent/model-request';
import { agentChatBody } from '@/lib/ai/providers/agent-chat';
import { sourceCitationCatalog } from '../agent/citation-catalog';
import { knowledgeSynthesisSources, parseSynthesis } from '../agent/synthesis';
import { parseKnowledgeExplanationQuery, prepareKnowledgeExplanation, acceptKnowledgeExplanation,
  knowledgeExplanationProtocol, knowledgeQuantityScopeProtocol } from '../agent/knowledge-explanation';

const source: Evidence = { ref: { type: 'knowledge_chunk', id: '1', version: '1' }, hash: 'synthetic',
  text: '管根先用堵漏材料加强，并做好防水附加层。' };
const sources = knowledgeSynthesisSources([source]);
const citationId = sourceCitationCatalog(sources[0])[0].citationId;
const context = { currentQuestion: '不是整面墙，是管根。为什么还要单独处理？' };
const coverage = parseKnowledgeExplanationQuery({ questions: ['管根为什么还要单独处理？'] });
function raw(text: string) {
  return JSON.stringify({ kind: 'knowledge_explanation', answers: { Q1: [{ basis: 'evidence', text, citations: [{ citationId }] }] } });
}
function prepare(text: string) {
  return prepareKnowledgeExplanation(raw(text), sources, coverage, context, [], knowledgeQuantityScopeProtocol);
}
// Deliberately scripted reviews test enforcement, not model classification.
function verdict(assertsQuantity: boolean, supported = true): ModelTurnOutput {
  return { text: '', toolCalls: [{ id: 'review', name: 'final_response', arguments: JSON.stringify({ questionsComplete: true,
    checks: { Q1: { complete: true, supported, conditionsPreserved: true, reason: supported ? '' : '原文未建立跨条款先后顺序' } },
    quantityChecks: { S1: { assertsQuantity, reason: assertsQuantity ? '规定实际涂刷次数' : '只指代大面处理，没有规定实际遍数' } },
  }) }], finishReason: 'tool_calls', providerRequestId: null, usage: { inputTokens: 1, outputTokens: 1 } };
}

test('an unchanged incidental pass mention reaches the existing review only on its explicit bound path', () => {
  const text = '管根需要单独加强，并不是靠大面那一遍涂刷顺带覆盖。';
  assert.throws(() => prepareKnowledgeExplanation(raw(text), sources, coverage, context), /unsupported_model_commitment/);
  const draft = prepare(text);
  assert.equal(draft.answer.segments[0].text, text);
  assert.deepEqual(draft.quantityMentions, [{ segment: 0, quantities: ['一遍'] }]);
  assert.equal(acceptKnowledgeExplanation(draft, verdict(false), draft.binding), null);
  assert.throws(() => parseSynthesis(JSON.stringify(draft.answer), sources,
    { ...context, knowledgeExplanation: knowledgeExplanationProtocol }), /unsupported_model_commitment/);
});

test('real counts including negated requirements fail despite otherwise positive semantic checks', () => {
  for (const text of ['必须涂刷两遍。', '不必涂刷两遍，一遍涂刷就足够。', '不能只涂刷一遍，至少涂刷三遍。',
    '管根已经涂刷两遍。']) {
    const draft = prepare(text);
    assert.ok(acceptKnowledgeExplanation(draft, verdict(true), draft.binding));
  }
  const draft = prepare('管根不是靠那一遍涂刷顺带覆盖，再进入大面防水工序。');
  assert.match(acceptKnowledgeExplanation(draft, verdict(false, false), draft.binding)!.feedback, /跨条款/);
});

test('a coating mention cannot carry uncited digits, other word units, receipts or foreign citations into review', () => {
  for (const text of ['那一遍涂刷要等24小时。', '那一遍涂刷要等两天。', '那一遍涂刷延伸三厘米。',
    '那一遍涂刷已经验收合格。']) assert.throws(() => prepare(text), /unsupported_model_commitment/);
  const value = JSON.parse(raw('那一遍涂刷不能顺带解决管根。'));
  value.answers.Q1[0].citations[0].citationId = 'foreign-id';
  assert.throws(() => prepareKnowledgeExplanation(JSON.stringify(value), sources, coverage, context, [], knowledgeQuantityScopeProtocol), /invalid_model_citation/);
});

test('missing, extra, malformed and stale quantity reviews fail closed', () => {
  const draft = prepare('不是靠那一遍涂刷顺带覆盖。');
  for (const mutation of ['missing', 'extra', 'empty', 'type']) {
    const output = verdict(false), value = JSON.parse(output.toolCalls[0].arguments);
    if (mutation === 'missing') delete value.quantityChecks;
    if (mutation === 'extra') value.quantityChecks.S2 = value.quantityChecks.S1;
    if (mutation === 'empty') value.quantityChecks.S1.reason = '';
    if (mutation === 'type') value.quantityChecks.S1.assertsQuantity = 'false';
    output.toolCalls[0].arguments = JSON.stringify(value);
    assert.throws(() => acceptKnowledgeExplanation(draft, output, draft.binding), /incomplete_model_answer|invalid_model_answer/);
  }
  const changed = prepare('不是靠那两遍涂刷顺带覆盖。');
  assert.notEqual(changed.binding, draft.binding);
  assert.throws(() => acceptKnowledgeExplanation(changed, verdict(false), draft.binding), /context_changed/);
  const changedSource = prepareKnowledgeExplanation(draft.raw, [{ ...sources[0], evidence: { ...source, hash: 'withdrawn-version' } }], coverage,
    context, [], knowledgeQuantityScopeProtocol);
  assert.notEqual(changedSource.binding, draft.binding);
});

test('the existing grounding compiler and provider wire retain the mandatory quantity verdict with no business tools', () => {
  const draft = prepare('不是靠那一遍涂刷顺带覆盖。');
  const compiled = compileModelRequest({ question: context.currentQuestion, triggerId: 'synthetic-current', turn: 61, purpose: 'grounding',
    messages: draft.reviewMessages, tools: [draft.reviewTool], toolsForTurn: () => { throw Error('Review must not enter planning'); } });
  assert.deepEqual(compiled.dispatchTools.map(tool => tool.name), ['final_response']);
  for (const model of ['qwen3.7-flash', 'qwen3.8-flash']) {
    const wire = agentChatBody({ model, messages: compiled.modelMessages, tools: compiled.dispatchTools,
      maxTokens: 2048, requireTool: true, enableThinking: false }, 'https://dashscope.aliyuncs.com/compatible-mode/v1');
    const schema = (wire.response_format as { json_schema: { schema: { required: string[]; properties: Record<string, unknown> } } }).json_schema.schema;
    assert.deepEqual(schema.required, ['questionsComplete', 'checks', 'quantityChecks']);
    assert.ok(schema.properties.quantityChecks);
    assert.equal(wire.tools, undefined);
  }
});

test('source-supported counts need no deferred verdict and existing runs/configuration remain strict', () => {
  const supported = knowledgeSynthesisSources([{ ...source, text: '管根涂刷两遍。' }]);
  const value = JSON.parse(raw('管根涂刷两遍。'));
  value.answers.Q1[0].citations = [{ citationId: sourceCitationCatalog(supported[0])[0].citationId }];
  const strict = prepareKnowledgeExplanation(JSON.stringify(value), supported, coverage, context);
  const draft = prepareKnowledgeExplanation(JSON.stringify(value), supported, coverage, context, [], knowledgeQuantityScopeProtocol);
  assert.deepEqual(draft.quantityMentions, []);
  assert.notEqual(strict.binding, draft.binding);
  assert.deepEqual(draft.reviewTool.parameters.required, ['questionsComplete', 'checks']);
  const base = { runtime: 'langgraph-v1', providerKey: 'dashscope', model: 'qwen3.8-flash', tools: true, imageInput: true,
    probeVersion: 'synthetic', knowledgeExplanation: knowledgeExplanationProtocol };
  assert.equal(agentConfig(base)?.knowledgeQuantityScope, undefined);
  const scoped = agentConfig({ ...base, knowledgeQuantityScope: knowledgeQuantityScopeProtocol });
  assert.equal(scoped?.knowledgeQuantityScope, knowledgeQuantityScopeProtocol);
  assert.equal(agentCapabilityFingerprint(scoped), agentCapabilityFingerprint(agentConfig(base)));
  assert.throws(() => agentConfig({ ...base, knowledgeQuantityScope: 'unknown' }), /assistant_capability_forbidden/);
  assert.throws(() => agentConfig({ ...base, knowledgeExplanation: undefined, knowledgeQuantityScope: knowledgeQuantityScopeProtocol }), /assistant_capability_forbidden/);
});
