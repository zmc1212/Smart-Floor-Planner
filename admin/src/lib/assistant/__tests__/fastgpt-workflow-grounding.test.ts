import test from 'node:test';
import assert from 'node:assert/strict';
import { FastGPTNativeKnowledge } from '../fastgpt/native-knowledge';
import { unifiedTools, knowledgeQuestionClasses, nativeKnowledgeTextQuery } from '../fastgpt/unified-tools';
import { ragSources } from '../fastgpt/native-rag';
import { nativeCites } from '../fastgpt/native-cites';
import { fail } from '../contracts';
import type { RagSource } from '../fastgpt/rag-config';

const config = { baseUrl: 'http://127.0.0.1:18300', appId: 'fixture', apiKey: 'fixture', model: 'fixture-unified',
  bridgeKey: 'fixture-transport-key-32-characters-long', plainAnswers: true, routePrefix: '/unified' as const, record: () => {} };
const source: RagSource = { nativeId: '6aeebd1a093915ea6cf2dab8', datasetId: 'fixture-dataset', collectionId: 'fixture-collection',
  q: '先排版再铺贴，设计师与铺贴师傅核对。', a: '', evidence: { ref: { type: 'knowledge_chunk', id: '1', version: '1' },
    hash: 'fixture', text: '先排版再铺贴，设计师与铺贴师傅核对。' } };
const quote = { id: source.nativeId, datasetId: source.datasetId, collectionId: source.collectionId, q: source.q, a: source.a };
const tools = unifiedTools.filter(t => t.name !== 'search_enterprise');
const request = (route: string, key: string, body?: unknown) => new Request('http://localhost' + route, {
  method: body === undefined ? 'GET' : 'POST', headers: { authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

test('enterprise query text cannot enter the upstream automatic HTTP/data file loader', () => {
  for (const text of ['https://127.0.0.1/private', 'data:image/png;base64,AAAA', '  https://example.com/file.pdf', '你们铺贴前怎么排版？']) {
    const encoded = nativeKnowledgeTextQuery(text);
    assert.equal(JSON.parse(encoded), text);
    assert.equal(/^(?:https?:\/\/|data:)/i.test(encoded.trim()), false, 'Native normalizeDatasetSearchInput must treat it as text');
  }
});

for (const category of knowledgeQuestionClasses) test(`native classification controls retrieval without becoming the saved answer: ${category.key}`, async () => {
  const adapter = new FastGPTNativeKnowledge(config), oldFetch = globalThis.fetch; let classifications = 0, answers = 0;
  const enterprise = category.key === 'enterprise';
  const output = (text: string) => ({ text, toolCalls: [], usage: { inputTokens: 10, outputTokens: 2 }, finishReason: 'stop' as const, providerRequestId: 'fixture' });
  try {
    globalThis.fetch = async (_url, options) => {
      const key = JSON.parse(String(options?.body)).variables.workflowTicket;
      const input = await (await adapter.handle(request('/unified-input', key))).json();
      assert.equal(input.knowledgeQuery, undefined);
      const classification = await adapter.handle(request('/unified-model/v1/chat/completions', config.bridgeKey, {
        model: config.model, messages: [{ role: 'system', content: input.classifierMarker }, { role: 'user', content: '原问题' }],
      }));
      assert.equal(classification.status, 200);
      assert.equal((await classification.json()).choices[0].message.content, category.key);
      const selected = await (await adapter.handle(request('/unified-query', key, { selection: category.value }))).json();
      assert.equal(selected.knowledgeQuery, enterprise ? '原问题' : '');
      const prepared = await (await adapter.handle(request('/unified-sources', key, enterprise ? [quote] : []))).json();
      const answer = await adapter.handle(request('/unified-model/v1/chat/completions', config.bridgeKey, {
        model: config.model, messages: [{ role: 'system', content: prepared.instructions }, { role: 'user', content: '原问题' }],
        tools: tools.map(t => ({ type: 'function', function: t })),
      }));
      assert.equal(answer.status, 200); return Response.json({ choices: (await answer.json()).choices });
    };
    const result = await adapter.run({ messages: [{ role: 'user', content: [{ type: 'text', text: '原问题' }] }], tools,
      grounding: { classifications: knowledgeQuestionClasses,
        classify: async () => { classifications++; return output(category.key); },
        query: async selection => { assert.equal(selection, category.value); return enterprise ? '原问题' : ''; },
        sources: async quotes => JSON.stringify(nativeCites(ragSources(quotes, [source]).map(s => ({ id: s.nativeId, sourceName: 'PPT19', content: s.q })))) },
      ports: { authorize: async () => {}, checkpoint: async () => {}, tool: async () => { throw Error('No tool'); },
        model: async (turn, messages) => { answers++; assert.equal(turn, 1); assert.equal(JSON.stringify(messages).includes(source.q), enterprise); return output('实际回答'); } } });
    assert.equal(result.output.text, '实际回答'); assert.equal(classifications, 1); assert.equal(answers, 1);
  } finally { globalThis.fetch = oldFetch; }
});

test('unknown native classification stops before retrieval instead of silently taking its default branch', async () => {
  const adapter = new FastGPTNativeKnowledge(config), oldFetch = globalThis.fetch; let answers = 0, queries = 0;
  try {
    globalThis.fetch = async (_url, options) => {
      const key = JSON.parse(String(options?.body)).variables.workflowTicket;
      const input = await (await adapter.handle(request('/unified-input', key))).json();
      const response = await adapter.handle(request('/unified-model/v1/chat/completions', config.bridgeKey, {
        model: config.model, messages: [{ role: 'system', content: input.classifierMarker }, { role: 'user', content: '原问题' }],
      }));
      assert.equal(response.status, 502); return Response.json({ error: 'blocked' });
    };
    await assert.rejects(adapter.run({ messages: [{ role: 'user', content: [{ type: 'text', text: '原问题' }] }], tools,
      grounding: { classifications: knowledgeQuestionClasses, query: async () => { queries++; return '原问题'; }, sources: async () => '',
        classify: async () => ({ text: 'unrecognized', toolCalls: [], usage: null, finishReason: 'stop', providerRequestId: 'fixture' }) },
      ports: { authorize: async () => {}, checkpoint: async () => {}, tool: async () => { throw Error('No tool'); },
        model: async () => { answers++; throw Error('No answer'); } } }));
    assert.equal(queries, 0); assert.equal(answers, 0);
  } finally { globalThis.fetch = oldFetch; }
});

for (const enabled of [true, false]) test(`ordered native dataset supplies authorized originals before the first model; enabled=${enabled}`, async () => {
  const adapter = new FastGPTNativeKnowledge(config), oldFetch = globalThis.fetch;
  let sourceCallbacks = 0, queryCallbacks = 0, models = 0;
  try {
    globalThis.fetch = async (_url, options) => {
      const key = JSON.parse(String(options?.body)).variables.workflowTicket;
      for (let i = 0; i < 2; i++) {
        const input = await (await adapter.handle(request('/unified-input', key))).json();
        assert.equal(input.knowledgeQuery, enabled ? '你们铺之前怎么排版，谁来核对？' : '');
      }
      const responses = await Promise.all([0, 1].map(() => adapter.handle(request('/unified-sources', key, enabled ? [quote] : []))));
      assert.ok(responses.every(r => r.status === 200));
      const prepared = await responses[0].json();
      assert.equal(sourceCallbacks, 1); assert.equal(queryCallbacks, 1);
      const response = await adapter.handle(request('/unified-model/v1/chat/completions', config.bridgeKey, {
        model: config.model, messages: [{ role: 'system', content: prepared.instructions }, { role: 'user', content: '你们铺之前怎么排版，谁来核对？' }],
        tools: tools.map(t => ({ type: 'function', function: t })),
      }));
      assert.equal(response.status, 200);
      return Response.json({ choices: (await response.json()).choices,
        responseData: [{ moduleType: 'datasetSearchNode', ...(enabled ? { embeddingTokens: 20 } : {}) }] });
    };
    const result = await adapter.run({ messages: [{ role: 'user', content: [{ type: 'text', text: '你们铺之前怎么排版，谁来核对？' }] }], tools,
      grounding: { query: async () => { queryCallbacks++; return enabled ? '你们铺之前怎么排版，谁来核对？' : ''; },
        sources: async quotes => { sourceCallbacks++; const found = ragSources(quotes, [source]);
          assert.equal(found.length, enabled ? 1 : 0);
          return JSON.stringify(nativeCites(found.map(s => ({ id: s.nativeId, sourceName: 'PPT19', content: s.q })))); } },
      ports: { authorize: async () => {}, checkpoint: async () => {}, tool: async () => { throw Error('No optional enterprise tool'); },
        model: async (_turn, messages, definitions) => {
          models++; assert.ok(!definitions.some(t => t.name === 'search_enterprise'));
          assert.equal(JSON.stringify(messages).includes(source.q), enabled);
          return { text: '原答', toolCalls: [], usage: { inputTokens: 10, outputTokens: 2 }, finishReason: 'stop', providerRequestId: 'fixture' };
        } } });
    assert.equal(models, 1); assert.equal(result.embeddingTokens, enabled ? 20 : null);
  } finally { globalThis.fetch = oldFetch; }
});

for (const failure of ['missing-source-step', 'foreign-source', 'revoked-after-source']) test(`ordered native grounding denies ${failure} before a model call`, async () => {
  const adapter = new FastGPTNativeKnowledge(config), oldFetch = globalThis.fetch; let revoked = false, models = 0;
  try {
    globalThis.fetch = async (_url, options) => {
      const key = JSON.parse(String(options?.body)).variables.workflowTicket;
      const input = await (await adapter.handle(request('/unified-input', key))).json();
      let prepared = input;
      if (failure !== 'missing-source-step') {
        const response = await adapter.handle(request('/unified-sources', key, [{ ...quote, id: failure === 'foreign-source' ? 'foreign' : quote.id }]));
        if (failure === 'foreign-source') assert.equal(response.status, 409);
        else { assert.equal(response.status, 200); prepared = await response.json(); revoked = true; }
      }
      const response = await adapter.handle(request('/unified-model/v1/chat/completions', config.bridgeKey, {
        model: config.model, messages: [{ role: 'system', content: prepared.instructions }, { role: 'user', content: '怎么铺？' }], tools: [],
      }));
      assert.notEqual(response.status, 200); return Response.json({ error: 'blocked' });
    };
    await assert.rejects(adapter.run({ messages: [{ role: 'user', content: [{ type: 'text', text: '怎么铺？' }] }], tools,
      grounding: { query: async () => '怎么铺？', sources: async quotes => JSON.stringify(ragSources(quotes, [source])) },
      ports: { authorize: async () => { if (revoked) fail('context_changed'); }, checkpoint: async () => {},
        tool: async () => { throw Error('No tool'); }, model: async () => { models++; throw Error('Must not dispatch'); } } }));
    assert.equal(models, 0);
  } finally { globalThis.fetch = oldFetch; }
});

test('native chat quotes cannot publish the intermediate research answer', async () => {
  const adapter = new FastGPTNativeKnowledge(config), oldFetch = globalThis.fetch;
  let modelCalls = 0, quoteCalls = 0;
  try {
    globalThis.fetch = async (_url, options) => {
      const key = JSON.parse(String(options?.body)).variables.workflowTicket;
      await adapter.handle(request('/unified-input', key));
      const sources = await (await adapter.handle(request('/unified-sources', key, []))).json();
      const research = await adapter.handle(request('/unified-model/v1/chat/completions', config.bridgeKey, {
        model: config.model, messages: [{ role: 'system', content: sources.instructions }, { role: 'user', content: '帮我查官网' }],
        tools: tools.map(t => ({ type: 'function', function: t })),
      }));
      assert.equal(research.status, 200);
      // The workflow must call the quote gate and then its native chatNode.
      return Response.json({ choices: (await research.json()).choices });
    };
    await assert.rejects(adapter.run({ messages: [{ role: 'user', content: [{ type: 'text', text: '帮我查官网' }] }], tools,
      grounding: { query: async () => '', sources: async () => [], quoteAnswer: {
        needsWeb: () => true, researchInstructions: 'read', enterpriseInstructions: '',
        context: () => { quoteCalls++; return { quotes: [], enterprise: false }; },
      } },
      ports: { authorize: async () => {}, checkpoint: async () => {}, tool: async () => { throw Error('No tools'); },
        model: async () => { modelCalls++; return { text: '取证阶段文本', toolCalls: [], usage: null, finishReason: 'stop', providerRequestId: 'fixture' }; } } }));
    assert.equal(modelCalls, 1);
    assert.equal(quoteCalls, 0);
  } finally { globalThis.fetch = oldFetch; }
});
