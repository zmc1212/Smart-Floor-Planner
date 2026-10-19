import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AssistantMutations, AssistantRequestError } from '../../../components/assistant/client';
import { KnowledgeBatchPreparationClient } from '../../../components/assistant/knowledge-batch-client';

const path = 'knowledge/operations/batches';
const body = { cases: [{ caseId: 'synthetic-case', expectedVersion: 2 }] };
const unknown = (error: unknown) => error instanceof AssistantRequestError && error.uncertain;
const keyOf = (init: RequestInit) => new Headers(init.headers).get('Idempotency-Key')!;
const receipt = (key: string) => Response.json({ success: true, data: { key } });
function deferred() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>(done => { resolve = done; });
  return { promise, resolve };
}

test('an unknown account A operation cannot replace account B explicit original key', async t => {
  const keys: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    keys.push(keyOf(init));
    if (keys.length < 3) throw Error('synthetic lost response');
    return receipt(keyOf(init));
  });
  const writer = new AssistantMutations();
  await assert.rejects(writer.write(path, body, 'POST', 'synthetic-account-a-original'), unknown);
  await assert.rejects(writer.write(path, body, 'POST', 'synthetic-account-b-original'), unknown);
  assert.deepEqual(await writer.write(path, body, 'POST', 'synthetic-account-b-original'), { key: 'synthetic-account-b-original' });
  assert.deepEqual(keys, ['synthetic-account-a-original', 'synthetic-account-b-original', 'synthetic-account-b-original']);
});

test('explicit journals and the legacy implicit retry cache cannot donate keys to each other', async t => {
  const keys: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    keys.push(keyOf(init));
    if (keys.length < 3) throw Error('synthetic lost response');
    return receipt(keyOf(init));
  });
  const writer = new AssistantMutations();
  await assert.rejects(writer.write(path, body, 'POST', 'synthetic-explicit-original'), unknown);
  await assert.rejects(writer.write(path, body), unknown);
  await writer.write(path, body);
  assert.notEqual(keys[0], keys[1]); assert.equal(keys[1], keys[2]);
});

test('an explicit operation preserves an outstanding implicit original receipt', async t => {
  const keys: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    const key = keyOf(init); keys.push(key);
    if (keys.length === 1) throw Error('synthetic lost response');
    return receipt(key);
  });
  const writer = new AssistantMutations();
  await assert.rejects(writer.write(path, body), unknown);
  await writer.write(path, body, 'POST', 'synthetic-explicit-other');
  await writer.write(path, body);
  assert.equal(keys[1], 'synthetic-explicit-other'); assert.equal(keys[0], keys[2]);
});

for (const outcome of ['success', 'refusal'] as const) {
  test(`a late implicit ${outcome} cannot clear a newer unknown operation`, async t => {
    const first = deferred(), late = deferred(), keys: string[] = [];
    t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
      const key = keyOf(init); keys.push(key);
      if (keys.length === 1) return first.promise;
      if (keys.length === 2) return late.promise;
      if (keys.length === 3) throw Error('new synthetic operation lost response');
      return receipt(key);
    });
    const writer = new AssistantMutations();
    const earlier = writer.write(path, body), delayed = writer.write(path, body);
    const lateResult = outcome === 'refusal'
      ? assert.rejects(delayed, error => error instanceof AssistantRequestError && error.status === 403 && !error.uncertain)
      : delayed;
    first.resolve(receipt(keys[0])); await earlier;
    await assert.rejects(writer.write(path, body), unknown);
    assert.notEqual(keys[0], keys[2]);
    late.resolve(outcome === 'success' ? receipt(keys[1]) : Response.json({ success: false, error: 'assistant_capability_forbidden' }, { status: 403 }));
    await lateResult; await writer.write(path, body);
    assert.deepEqual(keys, [keys[0], keys[0], keys[2], keys[2]]);
  });
}

test('a late explicit receipt leaves an independent implicit retry key intact', async t => {
  const late = deferred(), keys: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    const key = keyOf(init); keys.push(key);
    if (keys.length === 1) return late.promise;
    if (keys.length === 2) throw Error('synthetic lost response');
    return receipt(key);
  });
  const writer = new AssistantMutations();
  const explicit = writer.write(path, body, 'POST', 'synthetic-explicit-delayed');
  await assert.rejects(writer.write(path, body), unknown);
  late.resolve(receipt(keys[0])); await explicit;
  await writer.write(path, body);
  assert.notEqual(keys[0], keys[1]); assert.equal(keys[1], keys[2]);
});

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
const ownerA = { enterpriseId: '10', adminId: '20' };
const cases = [{ caseId: '30', expectedVersion: 2 }];
const batchReceipt = (key: string, owner: typeof ownerA) => Response.json({ success: true,
  data: { batchId: key, ...owner, knowledgeEpoch: 1, profileId: '1', profileHash: 'a'.repeat(64), policyVersion: 1, items: [] } });

for (const ownerB of [{ enterpriseId: '10', adminId: '21' }, { enterpriseId: '11', adminId: '20' }]) {
  test(`actual knowledge journal preserves B original key across account/tenant reentry ${ownerB.enterpriseId}/${ownerB.adminId}`, async t => {
    const keys: string[] = [], saved = storage(), writer = new AssistantMutations();
    t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
      const key = keyOf(init); keys.push(key);
      assert.deepEqual(JSON.parse(String(init.body)), { cases });
      if (keys.length < 3) throw Error('synthetic lost response');
      return batchReceipt(key, ownerB);
    });
    const client = new KnowledgeBatchPreparationClient(saved, writer);
    await assert.rejects(client.prepare(ownerA, cases), unknown);
    const a = client.pending(ownerA)!;
    await assert.rejects(client.prepare(ownerB, cases), unknown);
    const b = client.pending(ownerB)!;
    const reentered = new KnowledgeBatchPreparationClient(saved, writer);
    const result = await reentered.retry(ownerB);
    assert.equal(result.batchId, b.requestKey);
    assert.deepEqual(keys, [a.requestKey, b.requestKey, b.requestKey]);
    assert.notEqual(a.requestKey, b.requestKey);
    assert.equal(reentered.pending(ownerB), null); assert.equal(reentered.pending(ownerA)?.requestKey, a.requestKey);
  });
}

test('a confirmed B receipt clears only B journal and cannot dispatch an unnecessary recovery', async t => {
  const keys: string[] = [], ownerB = { enterpriseId: '10', adminId: '21' };
  const client = new KnowledgeBatchPreparationClient(storage(), new AssistantMutations());
  let expectedB: string | undefined;
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    const key = keyOf(init); keys.push(key);
    if (keys.length === 1) throw Error('synthetic lost response');
    expectedB = client.pending(ownerB)?.requestKey;
    return batchReceipt(key, ownerB);
  });
  await assert.rejects(client.prepare(ownerA, cases), unknown);
  const a = client.pending(ownerA)!;
  const result = await client.prepare(ownerB, cases);
  assert.equal(result.batchId, expectedB); assert.notEqual(result.batchId, a.requestKey);
  assert.deepEqual(keys, [a.requestKey, expectedB]);
  assert.equal(client.pending(ownerB), null); assert.equal(client.pending(ownerA)?.requestKey, a.requestKey);
  await assert.rejects(client.retry(ownerB)); assert.equal(keys.length, 2);
});
