import assert from 'node:assert/strict';
import { test } from 'node:test';
import { embeddingGateway, EMBEDDING_PROFILE } from '../infrastructure/embedding-gateway';

const unit = () => [1, ...Array<number>(1023).fill(0)];
function response(rows = [{ index: 0, embedding: unit() }], extra = {}) {
  return new Response(JSON.stringify({ model: EMBEDDING_PROFILE.model, revision: EMBEDDING_PROFILE.revision,
    profile: EMBEDDING_PROFILE.id, data: rows, usage: { prompt_tokens: 12 }, ...extra }));
}
test('embedding query instruction, plain documents, order and measured usage', async () => {
  const calls: Record<string, unknown>[] = [];
  const gateway = embeddingGateway({ url: 'http://127.0.0.1:8089', apiKey: 'test', fetch: async (_, init) => {
    calls.push(JSON.parse(String(init?.body)));
    return response([{ index: 1, embedding: unit().map(v => -v) }, { index: 0, embedding: unit() }]);
  } });
  const result = await gateway.embed(['水电改造', '施工验收'], 'query');
  assert.equal(result.vectors[0][0], 1); assert.equal(result.vectors[1][0], -1);
  assert.equal(result.usage?.inputTokens, 12);
  assert.match(String((calls[0].input as string[])[0]), /^Instruct: .*\nQuery:水电改造$/);
  await gateway.embed(['水电改造', '施工验收'], 'document');
  assert.deepEqual(calls[1].input, ['水电改造', '施工验收']);
});
test('embedding rejects wrong profiles, dimensions, norms, duplicate indices and malformed values', async () => {
  const invalid = [
    () => response(undefined, { revision: 'other' }),
    () => response(undefined, { profile: 'same-dimension-other-model' }),
    () => response([{ index: 0, embedding: [1] }]),
    () => response([{ index: 0, embedding: unit().map(() => 0) }]),
    () => response([{ index: 2, embedding: unit() }]),
    () => response([{ index: 0, embedding: unit() }, { index: 0, embedding: unit() }]),
  ];
  for (const factory of invalid) {
    const gateway = embeddingGateway({ url: 'http://localhost:8089', apiKey: 'test', fetch: async () => factory() });
    await assert.rejects(gateway.embed(['水电'], 'query'), /retrieval_unavailable/);
  }
});
test('embedding unknown usage remains null; provider failure is not retried', async () => {
  let calls = 0;
  const gateway = embeddingGateway({ url: 'http://localhost:8089', apiKey: 'test', fetch: async () => {
    calls++; if (calls === 1) return response(undefined, { usage: {} }); throw new Error('timeout');
  } });
  assert.equal((await gateway.embed(['水电'], 'document')).usage, null);
  await assert.rejects(gateway.embed(['水电'], 'query'), /retrieval_unavailable/);
  assert.equal(calls, 2);
  await assert.rejects(gateway.embed([], 'query'), /invalid_embedding_input/);
  assert.throws(() => embeddingGateway({ url: 'http://192.168.10.54:8089', apiKey: 'test' }), /retrieval_unavailable/);
});
