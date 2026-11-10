import test from 'node:test';
import assert from 'node:assert/strict';
import { FastGPTNativeRag, ragAnswerParts, ragHistoryText, ragSources } from '../fastgpt/native-rag';
import { fastGPTRagProtocol, type RagConfiguration, type RagSource } from '../fastgpt/rag-config';
import { AssistantError } from '../contracts';
import { AiProviderError } from '@/lib/ai/provider-types';
import { agentChatBody } from '@/lib/ai/providers/agent-chat';

const source: RagSource = { nativeId: 'a'.repeat(24), datasetId: 'b'.repeat(24), collectionId: 'c'.repeat(24), q: 'PPT19\n先排版再铺贴。', a: '',
  evidence: { ref: { type: 'knowledge_chunk', id: '42', version: '9' }, hash: 'original-hash', text: '先排版再铺贴。' } };
const other = { ...source, nativeId: 'd'.repeat(24), evidence: { ...source.evidence, ref: { ...source.evidence.ref, id: '43' } } };
const config: RagConfiguration & { baseUrl: string; apiKey: string; record: () => void } = {
  protocol: fastGPTRagProtocol, enterpriseId: '1454', appId: 'e'.repeat(24), transportModel: 'rag-transport', bridgeKey: 'x'.repeat(40),
  model: 'qwen3.7-flash', embeddingModel: 'text-embedding-v4', sources: [source, other], baseUrl: 'http://fixture', apiKey: 'fixture', record: () => {} };
const quote = (s = source) => ({ id: s.nativeId, datasetId: s.datasetId, collectionId: s.collectionId, q: s.q });
const answer = '师傅会先排版，再铺贴。[' + source.nativeId + '](CITE)\n\n方向可以先沟通。';
const request = (path: string, key: string, body: unknown) => new Request('http://fixture' + path,
  { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('stray malformed CITE tokens are removed instead of leaking into prose', () => {
  const answer = '限值相当于E0级[A](CITE)(B)(CITE)。';
  const parts = ragAnswerParts(answer, [{ nativeId: 'A' }, { nativeId: 'B' }] as any);
  assert.equal(parts.filter(p => 'text' in p).map(p => 'text' in p && p.text).join(''), '限值相当于E0级。');
  assert.deepEqual(parts.filter(p => 'source' in p).map(p => 'source' in p && p.source.nativeId), ['A']);
  assert.equal(parts.filter(p => 'text' in p).some(p => 'text' in p && p.text.includes('(CITE)')), false);
});

test('only native selected CITE IDs are mapped, prose is unchanged and unused candidates are not citations', () => {
  const parts = ragAnswerParts(answer, [source, other]);
  assert.deepEqual(parts.filter(p => 'source' in p).map(p => 'source' in p && p.source.nativeId), [source.nativeId]);
  assert.equal(parts.filter(p => 'text' in p).map(p => 'text' in p && p.text).join(''), answer.replace('[' + source.nativeId + '](CITE)', ''));
  assert.throws(() => ragAnswerParts(answer, [other]), /invalid_model_citation/);
  assert.equal(ragAnswerParts('说明没有等待时长。', []).length, 1);
});
test('candidate authorization rejects foreign datasets, edited originals, duplicate/unknown hits', () => {
  assert.deepEqual(ragSources([quote()], [source]), [source]);
  for (const changed of [{ ...quote(), datasetId: 'f'.repeat(24) }, { ...quote(), q: source.q + '等待48小时' }, { ...quote(), id: 'f'.repeat(24) }])
    assert.throws(() => ragSources([changed], [source]), /invalid_model_citation/);
  assert.throws(() => ragSources([quote(), quote()], [source, other]), /invalid_model_citation/);
});
test('saved original history keeps native CITE and never feeds UI fallback labels to the model', () => {
  const content = { version: 1 as const, blocks: [{ type: 'text' as const, text: '先排版' },
    { type: 'citation' as const, citationId: '1414', fallbackText: '知识来源' }, { type: 'text' as const, text: '。' }] };
  assert.equal(ragHistoryText(content), '先排版。');
  assert.equal(ragHistoryText(content, answer), answer);
  const raw = '先排版[' + source.nativeId + '](CITE)。\n\n再铺贴。';
  assert.deepEqual(ragAnswerParts(raw, [source]), [{ text: '先排版。\n\n' }, { source }, { text: '再铺贴。' }]);
});
test('explicit native temperature survives the original gateway, ordinary Agent remains at zero', () => {
  const input = { model: 'qwen3.7-flash', messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: '先怎么铺？' }] }], tools: [], maxTokens: 1950 };
  assert.equal(agentChatBody(input, 'https://dashscope.aliyuncs.com').temperature, 0);
  assert.equal(agentChatBody({ ...input, temperature: 0.3 }, 'https://dashscope.aliyuncs.com').temperature, 0.3);
});
test('native workflow uses authorized history, no secondary chat/title, guarded sources and exactly one paid attempt despite duplicate callbacks', async () => {
  const original = globalThis.fetch, adapter = new FastGPTNativeRag(config);
  let modelCalls = 0, authorizations = 0, checkpoints = 0, savedKey = '';
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(String(options?.body)); savedKey = body.variables.workflowTicket;
    assert.equal(body.chatId, 'NO_RECORD_HISTORIES'); assert.equal(body.retainDatasetCite, true);
    assert.equal(body.messages.length, 3);
    const guard = await adapter.handle(request('/rag-sources', savedKey, [quote(), quote(other)]));
    assert.equal(guard.status, 200);
    const input = { model: config.transportModel, max_tokens: 1950, temperature: 0.3,
      messages: [{ role: 'system', content: '原生引用提示\n' + (await guard.json()).instructions }, { role: 'user', content: '那怎么安排？' }] };
    const outputs = await Promise.all([0, 1].map(() => adapter.handle(request('/rag-model/v1/chat/completions', config.bridgeKey, input))));
    for (const output of outputs) assert.equal(output.status, 200);
    return Response.json({ choices: [{ message: { content: answer } }], responseData: [{ moduleType: 'datasetSearchNode', embeddingTokens: 12 }] });
  };
  try {
    const result = await adapter.run([{ role: 'user', content: '我想换地砖' }, { role: 'assistant', content: '你想怎么铺？' }, { role: 'user', content: '那怎么安排？' }], {
      authorize: async () => { authorizations++; }, sources: async sources => { assert.equal(sources.length, 2); },
      model: async input => { modelCalls++; assert.ok(!JSON.stringify(input).includes(savedKey));
        return { text: answer, toolCalls: [], finishReason: 'stop', providerRequestId: 'p1', usage: { inputTokens: 100, outputTokens: 20 } }; },
      checkpoint: async () => { checkpoints++; },
    });
    assert.equal(result.embeddingTokens, 12); assert.equal(result.sources.length, 2); assert.equal(modelCalls, 1); assert.equal(checkpoints, 1);
    assert.ok(authorizations >= 4);
    assert.equal((await adapter.handle(request('/rag-sources', savedKey, [quote()]))).status, 409);
  } finally { globalThis.fetch = original; }
});
for (const mode of ['foreign-hit', 'revoked-before-model', 'unknown-model'] as const) test(mode + ' stops without substitute answers or a second provider call', async () => {
  const original = globalThis.fetch, adapter = new FastGPTNativeRag(config);
  let calls = 0, revoked = false;
  globalThis.fetch = async (_url, options) => {
    const id = JSON.parse(String(options?.body)).variables.workflowTicket;
    const guard = await adapter.handle(request('/rag-sources', id, [{ ...quote(), ...(mode === 'foreign-hit' ? { datasetId: 'foreign' } : {}) }]));
    if (mode !== 'foreign-hit') {
      const instructions = (await guard.json()).instructions;
      revoked = mode === 'revoked-before-model';
      const body = { model: config.transportModel, max_tokens: 1950, temperature: 0.3, messages: [{ role: 'system', content: instructions }] };
      for (let i = 0; i < 2; i++) assert.notEqual((await adapter.handle(request('/rag-model/v1/chat/completions', config.bridgeKey, body))).status, 200);
    } else assert.equal(guard.status, 502);
    return Response.json({ error: { message: 'workflow failed' } });
  };
  try {
    await assert.rejects(() => adapter.run([{ role: 'user', content: '多久能铺完？' }], {
      authorize: async () => { if (revoked) throw new AssistantError('context_changed', 409); }, sources: async () => {},
      model: async () => { calls++; throw new AiProviderError('timeout', 'provider_outcome_unknown', 'unknown'); }, checkpoint: async () => {},
    }));
    assert.equal(calls, mode === 'unknown-model' ? 1 : 0);
  } finally { globalThis.fetch = original; }
});
