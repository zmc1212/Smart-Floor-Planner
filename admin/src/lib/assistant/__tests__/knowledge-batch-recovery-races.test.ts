import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { KnowledgeBatchPreparationClient } from '@/components/assistant/knowledge-batch-client';
import { AssistantRequestError } from '@/components/assistant/client';
import type { KnowledgeBatchPreparationResult } from '../knowledge/operation-batch-view';

const scope = { enterpriseId: '10', adminId: '20' };
const cases = [{ caseId: '30', expectedVersion: 2 }];
function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
function receipt(requestKey: string, owner = scope): KnowledgeBatchPreparationResult {
  return { batchId: requestKey, ...owner, knowledgeEpoch: 1, profileId: '1', profileHash: 'a'.repeat(64), policyVersion: 1, items: [] };
}
type Request = { key: string; body: unknown; resolve(value: Response): void; reject(error: Error): void };
function deferredApi(t: TestContext) {
  const calls: Request[] = [], previous = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, '/api/assistant/knowledge/operations/batches');
    assert.equal(init?.method, 'POST');
    return new Promise<Response>((resolve, reject) => calls.push({ key: new Headers(init?.headers).get('Idempotency-Key')!, body: JSON.parse(String(init?.body)), resolve, reject }));
  };
  t.after(() => { globalThis.fetch = previous; t.diagnostic(`synthetic_local_api_fetches=${calls.length}`); });
  return calls;
}
const success = (data: KnowledgeBatchPreparationResult) => Response.json({ success: true, data });
const isUncertain = (error: unknown) => error instanceof AssistantRequestError && error.uncertain;

for (const outcome of ['success', 'refusal', 'scope_mismatch'] as const) test(`late ${outcome} from an unmounted client preserves the next operation's recovery key`, async t => {
  const saved = storage(), calls = deferredApi(t), old = new KnowledgeBatchPreparationClient(saved);
  const original = old.prepare(scope, cases).then(value => value, error => error);
  const reopened = new KnowledgeBatchPreparationClient(saved), restored = reopened.retry(scope);
  assert.equal(calls[0].key, calls[1].key);
  calls[1].resolve(success(receipt(calls[1].key))); await restored;
  const nextCases = [{ caseId: '31', expectedVersion: 1 }], next = reopened.prepare(scope, nextCases);
  const nextFailed = assert.rejects(next, isUncertain);
  calls[2].reject(Error('Synthetic local API response loss')); await nextFailed;
  const nextKey = calls[2].key;
  assert.notEqual(nextKey, calls[0].key);
  if (outcome === 'refusal') calls[0].resolve(Response.json({ success: false, code: 'Forbidden' }, { status: 403 }));
  else calls[0].resolve(success(receipt(calls[0].key, outcome === 'scope_mismatch' ? { ...scope, adminId: '21' } : scope)));
  const oldResult = await original;
  if (outcome === 'scope_mismatch') assert.ok(isUncertain(oldResult));
  else if (outcome === 'refusal') assert.ok(oldResult instanceof AssistantRequestError && !oldResult.uncertain);
  const reentered = new KnowledgeBatchPreparationClient(saved), pending = reentered.pending(scope);
  assert.equal(pending?.requestKey, nextKey);
  assert.deepEqual(pending?.cases, nextCases);
  const recovered = reentered.retry(scope);
  assert.equal(calls[3].key, nextKey); assert.deepEqual(calls[3].body, calls[2].body);
  calls[3].resolve(success(receipt(nextKey))); await recovered;
  assert.equal(reentered.pending(scope), null); assert.equal(calls.length, 4);
});

test('an authoritative refusal clears the captured owner operation without touching another owner after caller mutation', async t => {
  const saved = storage(), calls = deferredApi(t), otherScope = { ...scope, adminId: '21' };
  const other = new KnowledgeBatchPreparationClient(saved), otherCall = other.prepare(otherScope, cases);
  const otherFailed = assert.rejects(otherCall, isUncertain);
  calls[0].reject(Error('Synthetic local API response loss')); await otherFailed;
  const originalOwner = { ...scope }, client = new KnowledgeBatchPreparationClient(saved), request = client.prepare(originalOwner, cases);
  const refused = assert.rejects(request, error => error instanceof AssistantRequestError && !error.uncertain);
  originalOwner.adminId = otherScope.adminId;
  calls[1].resolve(Response.json({ success: false, code: 'Forbidden' }, { status: 403 })); await refused;
  assert.equal(client.pending(scope), null);
  assert.equal(new KnowledgeBatchPreparationClient(saved).pending(otherScope)?.requestKey, calls[0].key);
});

test('a successful response remains bound to the captured owner when the caller object changes', async t => {
  const saved = storage(), calls = deferredApi(t), originalOwner = { ...scope }, client = new KnowledgeBatchPreparationClient(saved);
  const request = client.prepare(originalOwner, cases);
  originalOwner.adminId = '21';
  calls[0].resolve(success(receipt(calls[0].key)));
  assert.deepEqual(await request, receipt(calls[0].key));
  assert.equal(client.pending(scope), null);
});

test('unavailable browser storage still permits matching in-memory cleanup after a confirmed receipt', async t => {
  const blocked = { getItem: () => { throw Error('blocked'); }, setItem: () => { throw Error('blocked'); }, removeItem: () => { throw Error('blocked'); } };
  const calls = deferredApi(t), client = new KnowledgeBatchPreparationClient(blocked), request = client.prepare(scope, cases);
  assert.equal(client.pending(scope)?.requestKey, calls[0].key);
  calls[0].resolve(success(receipt(calls[0].key))); await request;
  assert.equal(client.pending(scope), null);
});
