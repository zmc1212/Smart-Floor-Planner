import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reportFinalOutputTokenLimit, type ModelMessage, type ModelTurnInput } from '../contracts/model';
import { boundReportBodyFactCoverage, boundReportBodyFinal, boundReportBodyWire, boundReportFinalOutput, boundReportGuidanceInput, boundReportGuidanceReview, reportBodyFinalAdmission, reportBodyFinalPolicy,
  reportBodyCitationListProtocol, reportBodyFinalProtocol, reportBodyFlatSegmentsProtocol, reportBodyProjectSlotsProtocol,
  reportBodyQuotedSegmentsProtocol, reportFinalFunctionCarrier, reportGuidanceInputProtocol, reportGuidanceOriginalProtocol, reportGuidanceReviewProtocol, reportGuidanceSelectionProtocol, reportGuidanceTaskProtocol, reportNativeRuntimeBudget, reportPendingGuidanceProtocol, scheduledReportFactCoverageProtocol } from '../agent/report-native-final';
import { agentRequestBudget, fitAgentContext, imageContextBudgetPolicy } from '../agent/context-budget';
import type { AgentConfig } from '../agent/config';
import { reportFinalTool } from '@/lib/construction/report-composition';
import { compileModelRequest } from '../agent/model-request';
import { nativeFinalDefinition, nativeImageFinalMessages, explicitNativeObjectRoot } from '../agent/native-final';
import { reportAnswerFinalTool } from '../agent/report-final';
import { finalTool } from '../agent/worker';
import { agentChatBody } from '@/lib/ai/providers/agent-chat';
import { synthesisInstructions } from '../agent/synthesis';
import { synthesisQuestionPrefix } from '../agent/model-policy';

const question = '客厅还需要核对什么？周五能装灯吗？';
const tool = explicitNativeObjectRoot(nativeFinalDefinition(reportAnswerFinalTool(finalTool, question, ['Cknown'])));
const endpoint = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const input: ModelTurnInput = { model: 'qwen3.7-flash', messages: [{ role: 'user', content: [{ type: 'text', text: question }] }],
  tools: [tool], maxTokens: reportFinalOutputTokenLimit, requireTool: true, outputMode: 'json_schema', reportFinalOutputTokens: reportFinalOutputTokenLimit };

test('new run output allocation is explicit; old run snapshots retain2048 and mismatched policies fail before dispatch', () => {
  assert.equal(boundReportFinalOutput(undefined, true), undefined);
  assert.equal(boundReportFinalOutput(undefined, false), undefined);
  assert.equal(boundReportFinalOutput(4096, true), 4096);
  for (const value of [2048, 8192, '4096', null]) assert.throws(() => boundReportFinalOutput(value, true), /context_changed/);
  assert.throws(() => boundReportFinalOutput(4096, false), /context_changed/);
  assert.equal(agentRequestBudget().maxOutputTokens, 2048);
});

test('larger final share fits the same16000 request envelope and four-call72000 reservation, without auxiliary/image opt-ins', () => {
  const budget = agentRequestBudget({ purpose: 'answer', reportFinalOutputTokens: 4096 });
  assert.equal(budget.inputBudget, 16000); assert.equal(budget.maxOutputTokens, 4096);
  assert.ok(4 * budget.inputBudget <= 72000);
  const turns = reportNativeRuntimeBudget({ summaries: 1, perceptions: 0 });
  assert.equal(turns.primaryModelTurns + turns.reservedValidationRepairs + turns.auxiliaryCalls, 4);
  for (const purpose of ['summary', 'grounding', 'vision'] as const)
    assert.throws(() => agentRequestBudget({ purpose, reportFinalOutputTokens: 4096 }), /agent_input_limit/);
  assert.throws(() => agentRequestBudget({ purpose: 'answer', reportFinalOutputTokens: 4096, imageContextBudget: imageContextBudgetPolicy.version }), /agent_input_limit/);
});

test('provider wire accepts the bound final allocation only for native final-only official requests; ordinary calls remain2048', () => {
  const body = agentChatBody(input, endpoint);
  assert.equal(body.max_tokens, 4096); assert.equal(body.response_format?.type, 'json_schema'); assert.equal(body.tools, undefined);
  assert.equal(JSON.stringify(body).includes('reportFinalOutputTokens'), false);
  assert.throws(() => agentChatBody({ ...input, reportFinalOutputTokens: undefined }, endpoint), /agent_input_limit/);
  assert.throws(() => agentChatBody({ ...input, outputMode: 'json_object' }, endpoint), /agent_input_limit/);
  assert.throws(() => agentChatBody({ ...input, tools: [tool, { name: 'query_followups', description: 'Read', parameters: {} }] }, endpoint));
  assert.throws(() => agentChatBody(input, 'https://example.com/v1'), /agent_input_limit/);
  assert.equal(agentChatBody({ ...input, reportFinalOutputTokens: undefined, maxTokens: 2048 }, endpoint).max_tokens, 2048);
});

test('new scheduled report bodies allocate4096 on the same schema while historical and unsupported bindings retain their limits', () => {
  const config: AgentConfig = { runtime: 'langgraph-v1', providerKey: 'dashscope', model: 'qwen3.7-flash',
    probeVersion: 'test', imageInput: true, tools: true };
  assert.equal(reportBodyFinalAdmission(config), true);
  assert.deepEqual(reportBodyFinalPolicy(config), { reportBodyFinal: reportBodyFinalProtocol, reportBodyFinalCarrier: reportFinalFunctionCarrier,
    reportBodyProjectSlots: reportBodyCitationListProtocol, reportBodyFactCoverage: scheduledReportFactCoverageProtocol,
    reportGuidanceInput: reportGuidanceOriginalProtocol });
  assert.equal(boundReportGuidanceReview(undefined, 'citation-list'), false);
  assert.equal(boundReportGuidanceReview(reportGuidanceReviewProtocol, 'citation-list'), true);
  assert.throws(() => boundReportGuidanceReview(reportGuidanceReviewProtocol, 'quoted'), /context_changed/);
  assert.equal(boundReportGuidanceInput(undefined, true), undefined);
  assert.equal(boundReportGuidanceInput(reportGuidanceInputProtocol, true), reportGuidanceInputProtocol);
  assert.equal(boundReportGuidanceInput(reportPendingGuidanceProtocol, true), reportPendingGuidanceProtocol);
  assert.equal(boundReportGuidanceInput(reportGuidanceTaskProtocol, true), reportGuidanceTaskProtocol);
  assert.equal(boundReportGuidanceInput(reportGuidanceSelectionProtocol, false, 'citation-list'), reportGuidanceSelectionProtocol);
  assert.equal(boundReportGuidanceInput(reportGuidanceOriginalProtocol, false, 'citation-list'), reportGuidanceOriginalProtocol);
  assert.throws(() => boundReportGuidanceInput(reportGuidanceSelectionProtocol, false, 'flat'), /context_changed/);
  assert.throws(() => boundReportGuidanceInput(reportGuidanceSelectionProtocol, true, 'citation-list'), /context_changed/);
  assert.throws(() => boundReportGuidanceInput(reportGuidanceInputProtocol, false), /context_changed/);
  assert.equal(boundReportBodyFactCoverage(undefined, 4096), false);
  assert.equal(boundReportBodyFactCoverage(scheduledReportFactCoverageProtocol, 4096), true);
  assert.throws(() => boundReportBodyFactCoverage(scheduledReportFactCoverageProtocol, undefined), /context_changed/);
  assert.equal(boundReportBodyWire(undefined, reportFinalFunctionCarrier), 'legacy');
  assert.equal(boundReportBodyWire(reportBodyProjectSlotsProtocol, reportFinalFunctionCarrier), 'slots');
  assert.equal(boundReportBodyWire(reportBodyFlatSegmentsProtocol, reportFinalFunctionCarrier), 'flat');
  assert.equal(boundReportBodyWire(reportBodyQuotedSegmentsProtocol, reportFinalFunctionCarrier), 'quoted');
  assert.equal(boundReportBodyWire(reportBodyCitationListProtocol, reportFinalFunctionCarrier), 'citation-list');
  assert.throws(() => boundReportBodyWire(reportBodyFlatSegmentsProtocol, undefined), /context_changed/);
  const unsupported = { ...config, providerKey: 'siliconflow' };
  assert.equal(reportBodyFinalAdmission(unsupported), false);
  assert.deepEqual(reportBodyFinalPolicy(unsupported), {});
  assert.throws(() => boundReportBodyFinal(reportBodyFinalProtocol, unsupported), /context_changed/);
  assert.throws(() => boundReportBodyFinal('unexpected', config), /context_changed/);
  const tool = reportFinalTool(['9', '10']);
  const legacy = agentChatBody({ ...input, tools: [tool], maxTokens: 2048, reportFinalOutputTokens: boundReportBodyFinal(undefined, config) }, endpoint);
  const tokens = boundReportBodyFinal(reportBodyFinalProtocol, config)!;
  const body = agentChatBody({ ...input, tools: [tool], maxTokens: tokens, reportFinalOutputTokens: tokens }, endpoint);
  assert.equal(legacy.max_tokens, 2048);
  assert.equal(body.max_tokens, 4096);
  assert.deepEqual(body.response_format, legacy.response_format);
  const terminal = agentChatBody({ ...input, tools: [tool], maxTokens: tokens, reportFinalOutputTokens: tokens, outputMode: 'function_call' }, endpoint);
  assert.equal(terminal.response_format, undefined);
  assert.deepEqual(terminal.tools?.[0].function, tool);
  assert.deepEqual(terminal.tool_choice, { type: 'function', function: { name: 'final_response' } });
  assert.equal(terminal.max_tokens, body.max_tokens);
  const estimate = fitAgentContext(input.messages, [tool], { purpose: 'answer', reportFinalOutputTokens: tokens }).diagnostic.after.estimatedTokens;
  assert.ok(estimate <= 16000 && 4 * estimate <= 72000);
});

test('actual compiler reserves the extra output inside the original estimate and preserves image bytes, schema and question', () => {
  const image = { type: 'image' as const, mediaId: 'synthetic', hash: 'original', mimeType: 'image/png' as const, data: 'aW1hZ2U=' };
  const messages: ModelMessage[] = [{ role: 'system', content: [{ type: 'text', text: synthesisInstructions + synthesisQuestionPrefix + JSON.stringify({ currentQuestion: question }) }] },
    { role: 'user', content: [{ type: 'text', text: question }, image] }];
  const request = { question, triggerId: 'current', turn: 2, purpose: 'answer' as const, messages, tools: [],
    toolsForTurn: () => [tool], wireProjection: nativeImageFinalMessages };
  const before = JSON.stringify(messages), old = compileModelRequest(request), current = compileModelRequest({ ...request, reportFinalOutputTokens: 4096 });
  assert.equal(current.bounded.diagnostic.after.estimatedTokens - old.bounded.diagnostic.after.estimatedTokens, 2048);
  assert.ok(current.bounded.diagnostic.after.estimatedTokens <= 16000);
  assert.deepEqual(current.dispatchTools, old.dispatchTools);
  assert.ok(current.modelMessages.some(m => m.role === 'user' && m.content.some(p => p.type === 'image' && p.data === image.data && p.hash === image.hash)));
  assert.equal(JSON.stringify(messages), before);
});
