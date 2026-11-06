import test from 'node:test';
import assert from 'node:assert/strict';
import { FastGPTNativeKnowledge, nativeKnowledgeProtocol, nativeKnowledgeModelMessages } from '../fastgpt/native-knowledge';
import { sourceCitationCatalog } from '../agent/citation-catalog';
import { parseSynthesis, type SynthesisSource } from '../agent/synthesis';
import type { ModelMessage, ModelTurnOutput } from '../contracts/model';
import type { AgentCheckpoint, AgentRuntimePorts } from '../agent/runtime';
import { runRenovationAgent } from '../agent/runtime';

const config = { baseUrl: 'http://127.0.0.1:18300', appId: 'native-fixture', apiKey: 'fixture',
  model: 'qwen3.7-flash', bridgeKey: 'fixture-transport-key-32-characters-long', record: () => {} };
const messages: ModelMessage[] = [{ role: 'system', content: [{ type: 'text', text: '原有权限与来源规则' }] },
  { role: 'user', content: [{ type: 'text', text: '结合我家的水电进度，接下来注意什么？' }] }];
const modelOutput = (name: string, payload: unknown): ModelTurnOutput => ({ text: '',
  toolCalls: [{ id: 'provider-call-' + name, name, arguments: JSON.stringify({ payload }) }],
  finishReason: 'tool_calls', providerRequestId: 'provider-' + name, usage: { inputTokens: 100, outputTokens: 20 } });
const definition = { name: 'query_business', description: '读取本人获权施工进度',
  parameters: { type: 'object', properties: { domain: { type: 'string' } }, required: ['domain'], additionalProperties: false } };
const query = { domain: 'construction' };
test('native HTTP results supply the existing exact citation catalog; a source ID never becomes a citation ID', () => {
  const source: SynthesisSource = { sourceId: 'H93991', kind: 'history', title: '本咨询客户历史原话',
    text: '卧室墙面摸着掉粉，想重新刷漆，通常先处理什么？', history: { messageId: '93991', hash: 'a'.repeat(64), memoryVersion: 0, seq: '1' } };
  const receipt = { synthesisSources: [source] };
  const original: ModelMessage[] = [{ role: 'assistant', content: '', toolCalls: [{ id: 'history', name: 'recall_history', arguments: '{}' }] },
    { role: 'tool', callId: 'history', content: JSON.stringify({ result: JSON.stringify(receipt) }) }];
  const before = JSON.stringify(original), view = nativeKnowledgeModelMessages(original);
  const exposed = JSON.parse((view[1] as { content: string }).content).synthesisSources[0];
  assert.equal(exposed.text, source.text);
  assert.deepEqual(exposed.citationOptions.map((c: { citationId: string }) => c.citationId), sourceCitationCatalog(source).map(c => c.citationId));
  assert.ok(exposed.citationOptions.every((c: { citationId: string }) => c.citationId !== source.sourceId));
  assert.equal(JSON.stringify(original), before, 'Provider/tool originals are never rewritten');
  const raw = JSON.stringify({ kind: 'synthesis', segments: [{ basis: 'evidence', text: source.text, citations: [{ citationId: source.sourceId }] }] });
  assert.throws(() => parseSynthesis(raw, [source]));
  const selected = JSON.parse(raw); selected.segments[0].citations[0].citationId = exposed.citationOptions[0].citationId;
  assert.doesNotThrow(() => parseSynthesis(JSON.stringify(selected), [source]));
});
const final = { kind: 'general', text: '测试正文，仅用于桥接工程检查。' };
const request = (pathname: string, token: string, body?: unknown) => new Request('http://localhost' + pathname, {
  method: body === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
function ports(overrides: Partial<AgentRuntimePorts> = {}): AgentRuntimePorts {
  return { authorize: async () => {}, model: async () => modelOutput('final_response', final),
    checkpoint: async () => {}, tool: async () => ({ content: '{"stage":"水电"}' }), ...overrides };
}

test('one native controller calls original guarded reads once, keeps raw provider drafts, and checkpoints the validated final', async () => {
  const previous = globalThis.fetch, audits: unknown[] = [], saved: AgentCheckpoint[] = [];
  const adapter = new FastGPTNativeKnowledge({ ...config, record: value => audits.push(value) });
  let modelCalls = 0, toolCalls = 0, expired = '';
  try {
    globalThis.fetch = async (_url, options) => {
      const dispatch = JSON.parse(String(options?.body));
      assert.equal(dispatch.chatId, undefined, 'The original XiaoK conversation is the only persistent user session');
      expired = dispatch.variables.workflowTicket;
      const input = await (await adapter.handle(request('/native-input', expired))).json();
      assert.ok(input.input.includes('水电进度'));
      const nativeModel = () => adapter.handle(request('/native-model/v1/chat/completions', config.bridgeKey, {
        model: config.model, stream: false, messages: [{ role: 'system', content: input.instructions }, { role: 'user', content: input.input }],
        tools: [definition, { name: 'final_response' }, { name: 'read_files' }].map(t => ({ type: 'function', function: { name: t.name } })),
      }));
      const first = await nativeModel(); assert.equal(first.status, 200);
      const read = () => adapter.handle(request('/native-tool/query_business', expired, query));
      const results = await Promise.all([read(), read()]);
      assert.equal(results[0].status, 200); assert.equal(results[1].status, 200); assert.equal(toolCalls, 1);
      assert.equal((await adapter.handle(request('/native-tool/query_business', expired, { domain: 'foreign' }))).status, 403);
      assert.equal((await nativeModel()).status, 200);
      assert.equal((await adapter.handle(request('/native-tool/final_response', expired, final))).status, 200);
      return Response.json({ responseData: [], choices: [{ message: { content: '' } }] });
    };
    const result = await adapter.run({ messages, tools: [definition], ports: ports({
      model: async (_turn, actual, tools) => {
        assert.ok(!JSON.stringify(actual).includes('XIAOK_NATIVE_TRANSPORT_TICKET'), 'Transport credentials never reach the actual provider');
        assert.ok(!tools.some(t => t.name === 'read_files'), 'The file capability is disabled for this text-only authorized pilot');
        return modelOutput(modelCalls++ ? 'final_response' : 'query_business', modelCalls === 1 ? query : final);
      }, tool: async (_turn, _index, name, args) => { toolCalls++; assert.equal(name, 'query_business'); assert.deepEqual(JSON.parse(args), query); return { content: '{"stage":"水电"}' }; },
      checkpoint: async state => { saved.push(structuredClone(state)); }, validateFinal: async raw => { assert.deepEqual(JSON.parse(raw), final); return null; },
    }) });
    assert.equal(result.output.text, JSON.stringify(final)); assert.equal(modelCalls, 2);
    assert.equal(saved.at(-1)?.nativeWorkflow, nativeKnowledgeProtocol); assert.equal(saved.at(-1)?.output?.text, result.output.text);
    assert.ok(audits.length >= 3);
    assert.equal((await adapter.handle(request('/native-input', expired))).status, 404);
  } finally { globalThis.fetch = previous; }
});

test('an ambiguous native provider outcome is never replayed, including callback repeats and worker recovery', async () => {
  const previous = globalThis.fetch, adapter = new FastGPTNativeKnowledge(config); let calls = 0; let saved: AgentCheckpoint | undefined;
  try {
    globalThis.fetch = async (_url, options) => {
      const id = JSON.parse(String(options?.body)).variables.workflowTicket;
      const input = await (await adapter.handle(request('/native-input', id))).json();
      const invoke = () => adapter.handle(request('/native-model/v1/chat/completions', config.bridgeKey, {
        model: config.model, messages: [{ role: 'system', content: input.instructions }], tools: [],
      }));
      assert.equal((await invoke()).status, 502); assert.equal((await invoke()).status, 502);
      return Response.json({ error: 'provider_outcome_unknown' });
    };
    const hooks = ports({ model: async () => { calls++; throw Error('unknown transport'); }, checkpoint: async state => { saved = structuredClone(state); } });
    await assert.rejects(() => adapter.run({ messages, tools: [], ports: hooks })); assert.equal(calls, 1);
    await assert.rejects(() => adapter.run({ messages, tools: [], ports: hooks, resume: saved }), /provider_outcome_unknown/);
    await assert.rejects(() => runRenovationAgent({ messages, tools: [], ports: hooks, resume: saved }), /context_changed/);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = previous; }
});

test('source validation rejects the original final without a prompt repair or a hidden model retry', async () => {
  const previous = globalThis.fetch, audits: unknown[] = [];
  const adapter = new FastGPTNativeKnowledge({ ...config, record: value => audits.push(value) }); let calls = 0;
  try {
    globalThis.fetch = async (_url, options) => {
      const id = JSON.parse(String(options?.body)).variables.workflowTicket;
      const input = await (await adapter.handle(request('/native-input', id))).json();
      assert.equal((await adapter.handle(request('/native-model/v1/chat/completions', config.bridgeKey, {
        model: config.model, stream: true, messages: [{ role: 'system', content: input.instructions }],
        tools: [{ type: 'function', function: { name: 'final_response' } }],
      }))).status, 200);
      assert.equal((await adapter.handle(request('/native-tool/final_response', id, final))).status, 422);
      const afterFailure = await adapter.handle(request('/native-model/v1/chat/completions', config.bridgeKey, {
        model: config.model, messages: [{ role: 'system', content: input.instructions }], tools: [],
      }));
      assert.equal((await afterFailure.json()).error.message, 'invalid_model_citation', 'A platform recovery callback preserves the original rejection instead of relabelling it context_changed');
      return Response.json({ error: 'source_rejected' });
    };
    await assert.rejects(() => adapter.run({ messages, tools: [], ports: ports({ model: async () => { calls++; return modelOutput('final_response', final); },
      validateFinal: async () => ({ code: 'invalid_model_citation', feedback: '原有来源校验拒绝' }) }) }), /invalid_model_citation/);
    assert.equal(calls, 1); assert.ok(JSON.stringify(audits).includes(JSON.stringify(final).replaceAll('"', '\\"')));
  } finally { globalThis.fetch = previous; }
});

test('revocation blocks a completed native result before the final callback can publish it', async () => {
  const previous = globalThis.fetch, adapter = new FastGPTNativeKnowledge(config); let revoked = false, calls = 0;
  try {
    globalThis.fetch = async (_url, options) => {
      const id = JSON.parse(String(options?.body)).variables.workflowTicket;
      const input = await (await adapter.handle(request('/native-input', id))).json();
      await adapter.handle(request('/native-model/v1/chat/completions', config.bridgeKey, {
        model: config.model, messages: [{ role: 'system', content: input.instructions }], tools: [{ function: { name: 'final_response' } }],
      }));
      assert.equal((await adapter.handle(request('/native-tool/final_response', id, final))).status, 409);
      return Response.json({});
    };
    await assert.rejects(() => adapter.run({ messages, tools: [], ports: ports({ authorize: async () => { if (revoked) throw Error('revoked'); },
      model: async () => { calls++; revoked = true; return modelOutput('final_response', final); } }) })); assert.equal(calls, 1);
  } finally { globalThis.fetch = previous; }
});
