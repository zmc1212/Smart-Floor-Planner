import assert from 'node:assert/strict';
import { loadEnvConfig } from '@next/env';
import { embeddingGateway, EMBEDDING_PROFILE as profile } from '../../src/lib/assistant/infrastructure/embedding-gateway';

async function main() {
  loadEnvConfig(process.cwd());
  const url = process.env.ASSISTANT_EMBEDDING_URL!;
  const headers = { authorization: `Bearer ${process.env.ASSISTANT_EMBEDDING_API_KEY}`, 'content-type': 'application/json' };
  const post = (body: object) => fetch(new URL('/v1/embeddings', url), { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  assert.equal((await fetch(new URL('/health', url))).status, 401);
  const health = await (await fetch(new URL('/health', url), { headers })).json();
  assert.equal(health.revision, profile.revision); assert.equal(health.device, 'cuda');
  const base = { model: profile.model, input_type: 'document', input: ['水电改造'] };
  assert.equal((await post({ ...base, dimensions: 512 })).status, 422);
  assert.equal((await post({ ...base, input: Array(9).fill('水电') })).status, 422);
  assert.equal((await post({ ...base, input: ['水电改造'.repeat(600)] })).status, 422);
  assert.equal((await post({ ...base, input: ['a'.repeat(70000)] })).status, 413);
  const gateway = embeddingGateway();
  const batch = await gateway.embed(['卫生间闭水试验', '量房预约提供地址', '卫生间闭水试验'], 'document');
  assert.ok(batch.usage && batch.usage.inputTokens > 0);
  const single = await gateway.embed(['量房预约提供地址'], 'document');
  const cosine = batch.vectors[1].reduce((sum, x, i) => sum + x * single.vectors[0][i], 0);
  assert.ok(cosine > 0.999);
  assert.deepEqual(batch.vectors[0], batch.vectors[2]);
  const start = performance.now();
  const stress = await Promise.all(Array.from({ length: 48 }, () => post({ ...base, input: ['水电改造施工验收。'.repeat(35)] })));
  const statuses: Record<string, number> = {};
  for (const response of stress) {
    statuses[response.status] = (statuses[response.status] ?? 0) + 1;
    assert.ok([200, 429, 503].includes(response.status));
  }
  assert.ok((statuses[429] ?? 0) > 0, 'bounded queue must reject overload');
  const recovered = await gateway.embed(['量房预约'], 'query');
  assert.equal(recovered.vectors[0].length, 1024);
  console.log(JSON.stringify({ authenticatedHealth: health, authorization: 'passed', bounds: 'passed', batchOrderCosine: cosine,
    realUsage: batch.usage, overload: statuses, overloadMs: performance.now() - start, recovery: 'passed' }, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
