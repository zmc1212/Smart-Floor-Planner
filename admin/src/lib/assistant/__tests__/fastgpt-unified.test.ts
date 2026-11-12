import test from 'node:test';
import assert from 'node:assert/strict';
import { FastGPTNativeKnowledge } from '../fastgpt/native-knowledge';
import { unifiedTools } from '../fastgpt/unified-tools';
import type { ModelTurnOutput } from '../contracts/model';
import { AiProviderError } from '@/lib/ai/provider-types';
import { nativeCites } from '../fastgpt/native-cites';
import { sourceCitationCatalog } from '../agent/citation-catalog';
import { ragAnswerParts } from '../fastgpt/native-rag';
import { fingerprint } from '../contracts';

const config = { baseUrl: 'http://127.0.0.1:18300', appId: 'fixture', apiKey: 'fixture', model: 'fixture-unified',
  bridgeKey: 'fixture-transport-key-32-characters-long', plainAnswers: true, routePrefix: '/unified' as const, record: () => {} };
const req = (route: string, key: string, body?: unknown) => new Request('http://localhost' + route, {
  method: body === undefined ? 'GET' : 'POST', headers: { authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const output: ModelTurnOutput = { text: '按获权原文说明。[fixture](CITE)', toolCalls: [], finishReason: 'stop',
  providerRequestId: 'fixture-answer', usage: { inputTokens: 200, outputTokens: 30 } };

test('native citation presentation uses the existing exact web catalog; no-source answers receive no citation instruction', () => {
  assert.deepEqual(nativeCites([]), {});
  const text = '重涂墙面应先去除不牢固漆膜和粉化物，确保基面牢固、干燥、清洁。';
  const evidence = { ref: { type: 'web_page' as const, id: '999:1210:0', version: 'fixture' }, text, hash: fingerprint(text) };
  const source = { sourceId: 'W999:1210:0', kind: 'web' as const, title: '原厂页面', text, evidence };
  const catalog = sourceCitationCatalog(source), packet = nativeCites(catalog.map(c => ({ id: c.citationId, sourceName: source.title, content: c.quote })));
  assert.equal(packet.cites![0].content, text);
  // The stock prompt's literal example ids are not in cites; a model that
  // copies one fails the final citation check. A bare placeholder is copied
  // literally too, so the examples must carry this receipt's own first id.
  assert.ok(packet.prompt && !/\[[0-9a-f]{24}\]\(CITE\)/.test(packet.prompt), 'Example ids must not be copyable foreign tokens');
  assert.match(packet.prompt, new RegExp('\\[' + packet.cites![0].id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\]\\(CITE\\)'));
  assert.match(packet.prompt, /不要把示例作为知识点/);
  const parts = ragAnswerParts('先处理粉化层。[' + packet.cites![0].id + '](CITE)', catalog.map(c => ({ nativeId: c.citationId, evidence, quote: c.quote })));
  assert.deepEqual(parts, [{ text: '先处理粉化层。' }, { source: { nativeId: catalog[0].citationId, evidence, quote: text } }]);
  assert.throws(() => ragAnswerParts('原回答。[citationId:' + catalog[0].citationId + '](CITE)', [{ nativeId: catalog[0].citationId, evidence }]));
});

test('plain native ToolCall preserves real history and original answer; transport and tool retries perform one operation', async () => {
  const adapter = new FastGPTNativeKnowledge(config), previous = globalThis.fetch;
  let models = 0, reads = 0;
  try {
    globalThis.fetch = async (_url, options) => {
      const wire = JSON.parse(String(options?.body)), key = wire.variables.workflowTicket;
      assert.equal(wire.chatId, 'NO_RECORD_HISTORIES');
      assert.deepEqual(wire.messages.map((m: { role: string }) => m.role), ['user', 'assistant', 'user']);
      assert.equal(wire.messages.at(-1).content, '改成哑光吧，你们怎么铺？');
      const input = await (await adapter.handle(req('/unified-input', key))).json();
      assert.equal(input.input, undefined);
      const body = { model: config.model, messages: [{ role: 'system', content: input.instructions }, ...wire.messages],
        tools: unifiedTools.map(t => ({ type: 'function', function: { ...t, parameters: { type: 'object', properties: { payload: t.parameters }, required: ['payload'] } } })) };
      const first = () => adapter.handle(req('/unified-model/v1/chat/completions', config.bridgeKey, body));
      const responses = await Promise.all([first(), first()]);
      assert.ok(responses.every(r => r.status === 200)); assert.equal(models, 1);
      const call = (await responses[0].json()).choices[0].message.tool_calls[0];
      const tool = () => adapter.handle(req('/unified-tool/search_enterprise', key, { query: '铺砖排版' }));
      assert.equal((await adapter.handle(req('/unified-tool/read_web', key, { candidateId: 'P1:1200:0' }))).status, 403);
      const results = await Promise.all([tool(), tool()]); assert.equal(reads, 1);
      const second = { ...body, messages: [...body.messages, { role: 'assistant', content: '', tool_calls: [call] },
        { role: 'tool', tool_call_id: call.id, content: JSON.stringify(await results[0].json()) }] };
      assert.equal((await adapter.handle(req('/unified-model/v1/chat/completions', config.bridgeKey, second))).status, 200);
      assert.equal((await first()).status, 200, 'Retry of a prior tool-producing turn cannot execute a new turn');
      assert.equal(models, 2); return Response.json({ choices: [{ message: { content: output.text } }] });
    };
    const result = await adapter.run({ messages: [{ role: 'system', content: [{ type: 'text', text: '规则' }] },
      { role: 'user', content: [{ type: 'text', text: '我想选亮面。' }] }, { role: 'assistant', content: '先看打理和光线。' },
      { role: 'user', content: [{ type: 'text', text: '改成哑光吧，你们怎么铺？' }] }], tools: unifiedTools,
      ports: { authorize: async () => {}, checkpoint: async () => {}, model: async (_turn, messages, tools) => {
        models++;
        assert.ok(!('payload' in (tools[0].parameters.properties as object)));
        if (models === 2) { assert.equal(messages.at(-1)?.role, 'tool'); return output; }
        return { ...output, text: '', finishReason: 'tool_calls', toolCalls: [{ id: 'call-1', name: 'search_enterprise', arguments: JSON.stringify({ query: '铺砖排版' }) }] };
      }, tool: async () => { reads++; return { content: JSON.stringify({ sources: [{ citationId: 'fixture', text: '获权原文' }] }) }; } } });
    assert.equal(result.output.text, output.text); assert.equal(models, 2); assert.equal(reads, 1);
  } finally { globalThis.fetch = previous; }
});

test('unknown native model outcome remains unknown and the repeated HTTP request never dispatches again', async () => {
  const adapter = new FastGPTNativeKnowledge(config), previous = globalThis.fetch; let calls = 0;
  try {
    globalThis.fetch = async (_url, options) => {
      const key = JSON.parse(String(options?.body)).variables.workflowTicket;
      const input = await (await adapter.handle(req('/unified-input', key))).json();
      const body = { model: config.model, messages: [{ role: 'system', content: input.instructions }, { role: 'user', content: '一般怎么打理？' }], tools: [] };
      for (let i = 0; i < 2; i++) assert.equal((await adapter.handle(req('/unified-model/v1/chat/completions', config.bridgeKey, body))).status, 502);
      return Response.json({ error: 'upstream_error' });
    };
    await assert.rejects(adapter.run({ messages: [{ role: 'user', content: [{ type: 'text', text: '一般怎么打理？' }] }], tools: unifiedTools,
      ports: { authorize: async () => {}, checkpoint: async () => {}, tool: async () => { throw Error('No tool should run'); },
        model: async () => { calls++; throw new AiProviderError('Unknown outcome', 'provider_outcome_unknown', 'unknown'); } } }),
      (error: unknown) => error instanceof AiProviderError && error.disposition === 'unknown');
    assert.equal(calls, 1);
  } finally { globalThis.fetch = previous; }
});

test('the observed malformed domains type produces one existing schema feedback, with no search or guessed-domain coercion', async () => {
  const adapter = new FastGPTNativeKnowledge(config), previous = globalThis.fetch; let models = 0, reads = 0;
  try {
    globalThis.fetch = async (_url, options) => {
      const key = JSON.parse(String(options?.body)).variables.workflowTicket;
      const input = await (await adapter.handle(req('/unified-input', key))).json();
      const messages: Array<Record<string, unknown>> = [{ role: 'system', content: input.instructions }, { role: 'user', content: '查一下底漆官网。' }];
      for (let turn = 0; turn < 3; turn++) {
        const response = await adapter.handle(req('/unified-model/v1/chat/completions', config.bridgeKey, { model: config.model, messages,
          tools: unifiedTools.map(t => ({ type: 'function', function: t })) }));
        assert.equal(response.status, 200);
        const m = (await response.json()).choices[0].message; messages.push(m);
        if (m.tool_calls?.length) {
          const c = m.tool_calls[0], callback = await adapter.handle(req('/unified-tool/search_web', key, JSON.parse(c.function.arguments).payload));
          assert.equal(callback.status, 200);
          const packet = await callback.json();
          if (turn === 0) { assert.equal(JSON.parse(packet.result).status, 'invalid_arguments'); assert.equal(reads, 0); }
          messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(packet) });
        }
      }
      return Response.json({ choices: [{ message: { content: output.text } }] });
    };
    await adapter.run({ messages: [{ role: 'user', content: [{ type: 'text', text: '查一下底漆官网。' }] }], tools: unifiedTools,
      ports: { authorize: async () => {}, checkpoint: async () => {}, model: async () => {
        models++;
        return models === 3 ? output : { ...output, text: '', finishReason: 'tool_calls', toolCalls: [{ id: 'call-' + models, name: 'search_web',
          arguments: JSON.stringify({ query: '立邦 底漆', domains: models === 1 ? '[]' : [] }) }] };
      }, tool: async (_turn, _index, _name, args) => { assert.deepEqual(JSON.parse(args).domains, []); reads++; return { content: '{"status":"empty"}' }; } } });
    assert.equal(reads, 1); assert.equal(models, 3);
  } finally { globalThis.fetch = previous; }
});
