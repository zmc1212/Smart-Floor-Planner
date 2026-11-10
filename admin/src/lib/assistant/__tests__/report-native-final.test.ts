import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agentConfig } from '../agent/config';
import { reportNativeAdmission, boundReportNativeFinal, reportNativeFinalProtocol, reportNativeRuntimeBudget } from '../agent/report-native-final';
import { runQuotaReservation } from '../core/conversation';
import { nativeFinalDefinition, explicitNativeObjectRoot, nativeImageFinalMessages, nativeFinalProtocol } from '../agent/native-final';
import { finalTool, constructionReadOnlyTools } from '../agent/worker';
import { reportAnswerFinalTool, reportQuestionCoverage, reportAnswerSynthesis, reportCoverageFailure } from '../agent/report-final';
import { compileModelRequest } from '../agent/model-request';
import { toolSchemaIssue } from '../agent/tool-protocol';
import { runRenovationAgent, type AgentCheckpoint } from '../agent/runtime';
import type { ModelMessage, ModelTurnOutput } from '../contracts/model';
import { AssistantError } from '../contracts';
import { assertExplanationDispatchBudget } from '../agent/knowledge-explanation';
import { synthesisInstructions } from '../agent/synthesis';
import { synthesisQuestionPrefix } from '../agent/model-policy';

const config = agentConfig({ runtime: 'langgraph-v1', providerKey: 'dashscope', model: 'qwen3.7-flash', tools: true, imageInput: true, probeVersion: 'synthetic' })!;
const scope = { conversationPurpose: 'construction_followup', purpose: 'reply', triggerKind: 'user_message', privateFollowup: true, selected: true };
const question = '刚才说错了，我问的是客厅，不是卧室。要是周五要装灯，现在还缺哪一步？';
const answer = { kind: 'report_answer', answers: {
  Q1: [{ basis: 'uncertainty', text: '问题指客厅，当前报告没有标明对应房间，本次不能确认。', citations: [] }],
  Q2: [{ basis: 'advice', text: '建议先核实客厅照明回路是否已确认，再与现场团队核实施工安排。', citations: [] }],
} };
const response = (text: string): ModelTurnOutput => ({ text, toolCalls: [], finishReason: 'stop', providerRequestId: null, usage: null });
const tools = constructionReadOnlyTools('construction_followup', true)!;

test('new private selected report runs bind native final without changing enterprise image flags or the original hold', () => {
  const before = JSON.stringify(config);
  assert.equal(reportNativeAdmission(config, scope), true);
  for (const patch of [{ conversationPurpose: 'customer_consultation' }, { purpose: 'construction.report.compose' },
    { triggerKind: 'scheduled_task' }, { privateFollowup: false }, { selected: false }])
    assert.equal(reportNativeAdmission(config, { ...scope, ...patch }), false);
  assert.equal(reportNativeAdmission({ ...config, providerKey: 'other' }, scope), false);
  assert.equal(reportNativeAdmission({ ...config, model: 'unprobed' }, scope), false);
  assert.equal(reportNativeAdmission({ ...config, structuredFinal: nativeFinalProtocol }, scope), false);
  assert.equal(boundReportNativeFinal(undefined, config, scope), false);
  assert.equal(boundReportNativeFinal(reportNativeFinalProtocol, config, scope), true);
  assert.throws(() => boundReportNativeFinal('unknown', config, scope), /context_changed/);
  assert.throws(() => boundReportNativeFinal(reportNativeFinalProtocol, config, { ...scope, selected: false }), /context_changed/);
  assert.deepEqual(runQuotaReservation(config), { tokens: 72000, costMicros: 1000000 });
  assert.equal(JSON.stringify(config), before);
  assert.equal(config.structuredFinal, undefined); assert.equal(config.imageInput, true); assert.equal(config.imageContext, undefined);
});

test('report schedule reserves one final repair and the semantic review inside five calls, deducts auxiliary calls and refuses changed checkpoints/budgets', () => {
  const budget = reportNativeRuntimeBudget({ summaries: 0, perceptions: 0 });
  assert.equal(budget.primaryModelTurns, 3); assert.equal(budget.reservedValidationRepairs, 1); assert.equal(budget.maxScheduledCalls, 5);
  assert.equal(reportNativeRuntimeBudget({ summaries: 1, perceptions: 1 }).primaryModelTurns, 1);
  assert.throws(() => reportNativeRuntimeBudget({ summaries: 2, perceptions: 0 }), /quota/);
  assert.throws(() => reportNativeRuntimeBudget({ summaries: 0, perceptions: 0,
    resume: { version: 1, turn: 1, messages: [], output: null } }), /invalid_agent_checkpoint/);
  assert.doesNotThrow(() => assertExplanationDispatchBudget([18000, 18000, 18000], 18000, 72000));
  assert.throws(() => assertExplanationDispatchBudget([18000, 18000, 18000], 18001, 72000), /quota/);
});

test('every report Q reuses flat numeric/citation constraints with its original catalog and segment bounds', async () => {
  const base = reportAnswerFinalTool(finalTool, question, ['Cknown']), before = JSON.stringify(base);
  const native = explicitNativeObjectRoot(nativeFinalDefinition(base));
  const unsafe = structuredClone(answer); unsafe.answers.Q2[0].text = '本次不能确认2026年11月6日的施工安排。';
  assert.equal(await toolSchemaIssue(base, JSON.stringify(unsafe)), null);
  assert.ok(await toolSchemaIssue(native, JSON.stringify(unsafe)));
  assert.equal(await toolSchemaIssue(native, JSON.stringify(answer)), null);
  const cited = { ...answer, answers: { ...answer.answers, Q2: [{ basis: 'evidence', text: '截止2026年11月1日仍待核对。', citations: [{ citationId: 'Cknown' }] }] } };
  assert.equal(await toolSchemaIssue(native, JSON.stringify(cited)), null);
  cited.answers.Q2[0].citations[0].citationId = 'Cforeign';
  assert.ok(await toolSchemaIssue(native, JSON.stringify(cited)));
  const empty = nativeFinalDefinition(reportAnswerFinalTool(finalTool, question, []));
  assert.ok(await toolSchemaIssue(empty, JSON.stringify(cited)));
  assert.equal(JSON.stringify(base), before);
  const branches = native.parameters.anyOf as Array<{ properties: Record<string, { properties: Record<string, { maxItems: number }> }> }>;
  assert.equal(branches[0].properties.answers.properties.Q1.maxItems, 6);
});

test('native report compiler retains grouped policy and actual image bytes without enabling an image budget opt-in', () => {
  const image = { type: 'image' as const, mediaId: 'synthetic', hash: 'original', mimeType: 'image/png' as const, data: 'aW1hZ2U=' };
  const messages: ModelMessage[] = [{ role: 'system', content: [{ type: 'text', text: synthesisInstructions + synthesisQuestionPrefix + JSON.stringify({ currentQuestion: question }) }] },
    { role: 'user', content: [{ type: 'text', text: question }, image] }];
  const before = JSON.stringify(messages), definition = explicitNativeObjectRoot(nativeFinalDefinition(reportAnswerFinalTool(finalTool, question, ['Cknown'])));
  const compiled = compileModelRequest({ question, triggerId: 'current', turn: 2, purpose: 'answer', messages, tools: [],
    toolsForTurn: () => [definition], wireProjection: nativeImageFinalMessages });
  assert.ok(JSON.stringify(compiled.policyView).includes('kind=report_answer'));
  assert.ok(compiled.modelMessages.some(m => m.role === 'user' && m.content.some(p => p.type === 'image' && p.data === image.data && p.hash === image.hash)));
  assert.equal(compiled.dispatchTools.length, 1); assert.equal(JSON.stringify(messages), before);
});

test('two reads then native final plus one repair remain four calls; resume never replays reads or migrates an old run', async () => {
  const saved: AgentCheckpoint[] = []; let calls = 0, reads = 0;
  const ports = { authorize: async () => {}, checkpoint: async (s: AgentCheckpoint) => { saved.push(structuredClone(s)); },
    tool: async () => { reads++; return { content: '{}' }; },
    validateFinal: async (raw: string) => { try { reportAnswerSynthesis(raw, reportQuestionCoverage(question)); return null; } catch (e) { return reportCoverageFailure(e); } },
    model: async (turn: number, _messages: ModelMessage[], available: unknown[]) => {
      calls++;
      if (turn < 2) return { ...response(''), toolCalls: [{ id: 'read-' + turn, name: turn ? 'search_knowledge' : 'query_followups', arguments: turn ? '{"query":"照明回路"}' : '{}' }] };
      assert.deepEqual(available, []);
      return response(JSON.stringify(turn === 2 ? { ...answer, answers: { Q1: answer.answers.Q1 } } : answer));
    } };
  const allocation = reportNativeRuntimeBudget({ summaries: 0, perceptions: 0 });
  const result = await runRenovationAgent({ messages: [], tools, nativeFinalization: true, ...allocation, ports });
  assert.equal(calls, 4); assert.equal(reads, 2); assert.equal(result.output!.text, JSON.stringify(answer));
  const repair = saved.find(s => s.validationRepairs === 1 && !s.output)!;
  assert.ok(repair); assert.equal(repair.nativeFinalization, nativeFinalProtocol);
  assert.doesNotThrow(() => reportNativeRuntimeBudget({ summaries: 0, perceptions: 0, resume: repair }));
  calls = 0; await runRenovationAgent({ messages: [], tools, nativeFinalization: true, ...allocation, resume: repair, ports });
  assert.equal(calls, 1); assert.equal(reads, 2);
  await assert.rejects(runRenovationAgent({ messages: [], tools, ...allocation, resume: repair, ports }), /invalid_agent_checkpoint/);
  const old = { version: 1 as const, turn: 0, messages: [], output: null };
  await assert.rejects(runRenovationAgent({ messages: [], tools, nativeFinalization: true, ...allocation, resume: old, ports }), /invalid_agent_checkpoint/);
  await assert.rejects(runRenovationAgent({ messages: [], tools, nativeFinalization: true, ...allocation, resume: repair,
    ports: { ...ports, authorize: async () => { throw new AssistantError('context_changed', 409); } } }), /context_changed/);
  assert.equal(calls, 1); assert.equal(reads, 2);
});
