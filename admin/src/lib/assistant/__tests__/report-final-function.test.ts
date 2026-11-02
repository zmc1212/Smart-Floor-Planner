import assert from 'node:assert/strict';
import { test } from 'node:test';
import { boundReportFinalCarrier, reportFinalFunctionCarrier, reportNativeRuntimeBudget } from '../agent/report-native-final';
import { assertNativeFinalOutput, explicitNativeObjectRoot, nativeFinalDefinition, nativeImageFinalMessages } from '../agent/native-final';
import { reportAnswerFinalTool, reportAnswerSynthesis, reportQuestionCoverage, reportCoverageFailure } from '../agent/report-final';
import { finalTool, constructionReadOnlyTools } from '../agent/worker';
import { projectFinalToolOutput } from '../agent/final-output';
import { toolSchemaIssue } from '../agent/tool-protocol';
import { runRenovationAgent } from '../agent/runtime';
import type { ModelTurnInput, ModelTurnOutput } from '../contracts/model';
import { agentChatBody, agentChatRequestDiagnostic, executeAgentChat } from '@/lib/ai/providers/agent-chat';
import { AiProviderError, type AiProviderRuntimeConfig } from '@/lib/ai/provider-types';
import { reportFinalTool } from '@/lib/construction/report-composition';

const question = '刚才说错了，我问的是客厅，不是卧室。要是周五要装灯，现在还缺哪一步？';
const definition = explicitNativeObjectRoot(nativeFinalDefinition(reportAnswerFinalTool(finalTool, question, ['Cknown'])));
const answer = { kind: 'report_answer', answers: {
  Q1: [{ basis: 'uncertainty', text: '当前报告未标明房间，不能确认是否对应客厅。', citations: [] }],
  Q2: [{ basis: 'advice', text: '建议先核对客厅照明回路与现场安排。', citations: [] }],
} };
const input: ModelTurnInput = { model: 'qwen3.7-flash', enableThinking: false, messages: [{ role: 'user', content: [{ type: 'text', text: question }] }],
  tools: [definition], requireTool: true, maxTokens: 4096, reportFinalOutputTokens: 4096, outputMode: 'function_call' };
const runtime: AiProviderRuntimeConfig = { id: 'synthetic', key: 'dashscope', name: 'synthetic', adapterType: 'openai_compatible',
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKey: 'synthetic', capabilities: ['chat'], modelMappings: {}, timeoutMs: 1000 };
const packet = (value: unknown = answer) => ({ id: 'synthetic', choices: [{ finish_reason: 'tool_calls', message: { content: null,
  tool_calls: [{ id: 'terminal', type: 'function', function: { name: 'final_response', arguments: JSON.stringify(value) } }] } }],
  usage: { prompt_tokens: 200, completion_tokens: 50 } });

test('new carrier is durable and explicit; absent old policies stay JSON and malformed combinations fail closed', () => {
  assert.equal(boundReportFinalCarrier(undefined, true, 2048), undefined);
  assert.equal(boundReportFinalCarrier(undefined, true, 4096), undefined);
  assert.equal(boundReportFinalCarrier(reportFinalFunctionCarrier, true, 4096), reportFinalFunctionCarrier);
  for (const value of [null, 'json_schema', 'unknown']) assert.throws(() => boundReportFinalCarrier(value, true, 4096), /context_changed/);
  assert.throws(() => boundReportFinalCarrier(reportFinalFunctionCarrier, false, 4096), /context_changed/);
  assert.throws(() => boundReportFinalCarrier(reportFinalFunctionCarrier, true, 2048), /context_changed/);
});

test('same final schema/catalog is sent as one forced function; truthful diagnostics have no provider response_format', () => {
  const before = JSON.stringify(definition), body = agentChatBody(input, runtime.baseUrl), diagnostic = agentChatRequestDiagnostic(body);
  assert.deepEqual(body.tools?.map(t => t.function), [definition]);
  assert.deepEqual(body.tool_choice, { type: 'function', function: { name: 'final_response' } });
  assert.equal(body.parallel_tool_calls, false); assert.equal(body.response_format, undefined); assert.equal(body.max_tokens, 4096);
  assert.equal(diagnostic.responseFormat, null); assert.equal(diagnostic.nativeOutputSchemaHash, null);
  assert.deepEqual(diagnostic.tools, ['final_response']); assert.equal(diagnostic.toolChoice, 'named_function');
  assert.equal(JSON.stringify(body).includes('reportFinalOutputTokens'), false); assert.equal(JSON.stringify(definition), before);
  for (const patch of [{ requireTool: false }, { model: 'unprobed' }, { tools: [...input.tools, { name: 'query_followups', description: '', parameters: {} }] }])
    assert.throws(() => agentChatBody({ ...input, ...patch }, runtime.baseUrl));
  assert.throws(() => agentChatBody(input, 'https://example.com/v1'));
});

test('old JSON/default finals, ordinary multi-tool calls and report body transport retain their original channels', () => {
  const old = { ...input, reportFinalOutputTokens: undefined, maxTokens: 2048, outputMode: undefined };
  assert.equal(agentChatBody(old, runtime.baseUrl).response_format?.type, 'json_schema');
  assert.equal(agentChatBody({ ...input, outputMode: 'json_schema' }, runtime.baseUrl).response_format?.type, 'json_schema');
  const ordinary = agentChatBody({ ...old, tools: [...old.tools, { name: 'search_knowledge', description: '', parameters: {} }] }, runtime.baseUrl);
  assert.equal(ordinary.response_format, undefined); assert.equal(ordinary.tools?.length, 2);
  assert.equal(agentChatBody({ ...old, tools: [reportFinalTool(['9'])] }, runtime.baseUrl).response_format?.type, 'json_schema');
});

test('native pixels and quoted roles survive the function carrier inside the existing image limits', () => {
  const image = { type: 'image' as const, mediaId: 'synthetic', hash: 'original', mimeType: 'image/png' as const, data: 'aW1hZ2U=' };
  const original = [{ role: 'user' as const, content: [{ type: 'text' as const, text: question }, image] }], before = JSON.stringify(original);
  const body = agentChatBody({ ...input, messages: nativeImageFinalMessages(original) }, runtime.baseUrl);
  assert.match(JSON.stringify(body.messages), /data:image\/png;base64,aW1hZ2U=/);
  assert.equal(body.response_format, undefined); assert.equal(JSON.stringify(original), before);
  assert.throws(() => agentChatBody({ ...input, messages: [{ role: 'user', content: Array.from({ length: 5 }, () => image) }] }, runtime.baseUrl), /agent_input_limit/);
});

test('one terminal HTTP call uses existing application validation and projection, preserving raw arguments and usage', async () => {
  const original = globalThis.fetch; let calls = 0;
  try {
    globalThis.fetch = async (_url, init) => { calls++; const body = JSON.parse(String(init?.body));
      assert.equal(body.response_format, undefined); assert.equal(body.tools.length, 1);
      return new Response(JSON.stringify(packet()), { status: 200 }); };
    const raw = await executeAgentChat(runtime, input), projected = projectFinalToolOutput(raw);
    assert.equal(calls, 1); assert.equal(raw.toolCalls[0].arguments, JSON.stringify(answer)); assert.equal(raw.text, '');
    assert.deepEqual(raw.observation?.format, { mode: 'function_call', jsonValid: true, schemaValid: true, schemaValidation: 'application' });
    assertNativeFinalOutput(projected, 'function_call'); assert.throws(() => assertNativeFinalOutput(projected), /native_schema_unverified/);
    assert.equal(projected.text, raw.toolCalls[0].arguments); assert.deepEqual(projected.toolCalls, []);
    assert.deepEqual(projected.usage, { inputTokens: 200, outputTokens: 50 });
  } finally { globalThis.fetch = original; }
});

test('missing groups, citation strings, foreign catalogs, unsupported numbers and nonterminal frames cannot become valid finals', async () => {
  const original = globalThis.fetch;
  const missing = { ...answer, answers: { Q1: answer.answers.Q1 } };
  const stringCitation = { ...answer, answers: { ...answer.answers, Q1: [{ basis: 'evidence', text: '仍待核对。', citations: ['Cknown'] }] } };
  const foreign = { ...answer, answers: { ...answer.answers, Q1: [{ basis: 'evidence', text: '仍待核对。', citations: [{ citationId: 'Cforeign' }] }] } };
  const number = { ...answer, answers: { ...answer.answers, Q2: [{ basis: 'advice', text: '明天8点安装。', citations: [] }] } };
  const noCall = packet(); Object.assign(noCall.choices[0].message, { content: JSON.stringify(answer), tool_calls: [] });
  const mixed = packet(); mixed.choices[0].message.tool_calls.push({ id: 'read', type: 'function', function: { name: 'query_followups', arguments: '{}' } });
  try {
    for (const payload of [packet(missing), packet(stringCitation), packet(foreign), packet(number), noCall, mixed]) {
      globalThis.fetch = async () => new Response(JSON.stringify(payload), { status: 200 });
      const output = await executeAgentChat(runtime, input);
      assert.equal(output.observation?.format?.schemaValid, false);
      assert.throws(() => assertNativeFinalOutput(projectFinalToolOutput(output), 'function_call'), /native_schema_unverified/);
    }
    assert.equal(await toolSchemaIssue(definition, JSON.stringify(answer)), null);
  } finally { globalThis.fetch = original; }
});

test('truncated/repeated JSON and malformed function arguments retain unknown raw evidence with no normalization or retry', async () => {
  const original = globalThis.fetch; let calls = 0;
  try {
    const extraBrace = packet(); extraBrace.choices[0].message.tool_calls[0].function.arguments += '}';
    const truncated = { ...packet(), choices: [{ finish_reason: 'length', message: { content: JSON.stringify(answer).repeat(2), tool_calls: null } }] };
    for (const payload of [extraBrace, truncated]) {
      const start = calls; globalThis.fetch = async () => { calls++; return new Response(JSON.stringify(payload), { status: 200 }); };
      await assert.rejects(executeAgentChat(runtime, input), e => e instanceof AiProviderError && e.disposition === 'unknown'
        && e.privateResponse?.protocol === 'invalid-provider-frame-v1');
      assert.equal(calls - start, 1);
    }
  } finally { globalThis.fetch = original; }
});

test('existing graph consumes a projected terminal with zero business dispatch and keeps one repair inside four calls', async () => {
  let calls = 0, reads = 0;
  const response = (value: unknown): ModelTurnOutput => projectFinalToolOutput({ text: '', toolCalls: [{ id: 'terminal', name: 'final_response', arguments: JSON.stringify(value) }],
    finishReason: 'tool_calls', usage: null, providerRequestId: null });
  const result = await runRenovationAgent({ messages: [], tools: constructionReadOnlyTools('construction_followup', true)!,
    nativeFinalization: true, ...reportNativeRuntimeBudget({ summaries: 0, perceptions: 0 }), ports: {
      authorize: async () => {}, checkpoint: async () => {},
      tool: async name => { assert.notEqual(name, 'final_response'); reads++; return { content: '{}' }; },
      model: async (turn, _messages, available) => { calls++;
        if (turn < 2) return { text: '', toolCalls: [{ id: 'read-' + turn, name: turn ? 'search_knowledge' : 'query_followups', arguments: turn ? '{"query":"照明回路"}' : '{}' }],
          finishReason: 'tool_calls', usage: null, providerRequestId: null };
        assert.deepEqual(available, []); return response(turn === 2 ? { ...answer, answers: { Q1: answer.answers.Q1 } } : answer); },
      validateFinal: async raw => { try { reportAnswerSynthesis(raw, reportQuestionCoverage(question)); return null; } catch (e) { return reportCoverageFailure(e); } },
    } });
  assert.equal(calls, 4); assert.equal(reads, 2); assert.equal(result.output!.text, JSON.stringify(answer));
});
