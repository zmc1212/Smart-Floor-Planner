import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KnowledgeBatchPreparationClient } from '@/components/assistant/knowledge-batch-client';
import { AssistantRequestError } from '@/components/assistant/client';
import type { KnowledgeBatchPreparationResult } from '../knowledge/operation-batch-view';

const scope = { enterpriseId: '10', adminId: '20' };
const cases = [{ caseId: '30', expectedVersion: 2 }];
function storage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
function result(requestKey: string, actor = scope): KnowledgeBatchPreparationResult {
  return { batchId: requestKey, ...actor, knowledgeEpoch: 1, profileId: '1', profileHash: 'a'.repeat(64), policyVersion: 1, items: [] };
}

test('pending preparation is stored before sending and a lost response reopens with the original key/body', async () => {
  const saved = storage(), requests: Array<{ key: string; body: object }> = [];
  const first = new KnowledgeBatchPreparationClient(saved, { write: async (_path: string, body: object, _method?: string, requestKey?: string) => {
    assert.equal(saved.values.size, 1); requests.push({ key: requestKey!, body }); throw new AssistantRequestError('network_unknown', 0, true);
  } });
  await assert.rejects(first.prepare(scope, cases));
  const reopened = new KnowledgeBatchPreparationClient(saved, { write: async <T,>(_path: string, body: object, _method?: string, requestKey?: string) => {
    requests.push({ key: requestKey!, body }); return result(requestKey!) as T;
  } });
  await reopened.retry(scope);
  assert.equal(requests[0].key, requests[1].key); assert.deepEqual(requests[0].body, requests[1].body);
  assert.equal(reopened.pending(scope), null); assert.equal(saved.values.size, 0);
});

test('pending state is partitioned by server owner scope and contains no question, answer or credentials', async () => {
  const saved = storage(), client = new KnowledgeBatchPreparationClient(saved, { write: async () => { throw new AssistantRequestError('network_unknown', 0, true); } });
  await assert.rejects(client.prepare(scope, cases));
  assert.equal(client.pending({ ...scope, adminId: '21' }), null); assert.equal(client.pending({ ...scope, enterpriseId: '11' }), null);
  const text = [...saved.values.values()].join(''); assert.ok(!/question|answer|token|password|source/i.test(text));
});

test('another selection cannot replace an uncertain request and caller mutation cannot change its retry', async () => {
  const saved = storage(), requests: object[] = [], selection = [{ ...cases[0] }];
  const client = new KnowledgeBatchPreparationClient(saved, { write: async (_path: string, body: object) => { requests.push(body); throw new AssistantRequestError('network_unknown', 0, true); } });
  await assert.rejects(client.prepare(scope, selection)); selection[0].expectedVersion = 99;
  const pending = client.pending(scope)!; pending.cases[0].expectedVersion = 88;
  await assert.rejects(client.prepare(scope, selection), /上一笔/); assert.equal(requests.length, 1);
  assert.equal(client.pending(scope)!.cases[0].expectedVersion, 2);
});

test('authoritative refusal clears only the current owner pending record', async () => {
  const saved = storage(), other = new KnowledgeBatchPreparationClient(saved, { write: async () => { throw new AssistantRequestError('network_unknown', 0, true); } });
  await assert.rejects(other.prepare({ ...scope, adminId: '21' }, cases));
  const client = new KnowledgeBatchPreparationClient(saved, { write: async () => { throw new AssistantRequestError('version_conflict', 409); } });
  await assert.rejects(client.prepare(scope, cases)); assert.equal(client.pending(scope), null);
  assert.ok(other.pending({ ...scope, adminId: '21' }));
});

test('response scope changes remain uncertain and do not expose another actor result', async () => {
  const saved = storage(), client = new KnowledgeBatchPreparationClient(saved, { write: async <T,>(_path: string, _body: object, _method?: string, requestKey?: string) => result(requestKey!, { ...scope, adminId: '21' }) as T });
  await assert.rejects(client.prepare(scope, cases), error => error instanceof AssistantRequestError && error.uncertain);
  assert.ok(client.pending(scope));
});

test('invalid persisted metadata and invalid selections never dispatch a request', async () => {
  const saved = storage(); saved.setItem('assistant-knowledge-batch-v1:10:20', JSON.stringify({ version: 1, scope, requestKey: 'test', cases, question: 'forbidden cache' }));
  let calls = 0;
  const client = new KnowledgeBatchPreparationClient(saved, { write: async <T,>() => { calls++; return {} as T; } });
  assert.equal(client.pending(scope), null);
  saved.setItem('assistant-knowledge-batch-v1:10:20', JSON.stringify({ version: 1, scope: { ...scope, answer: 'forbidden cache' }, requestKey: 'test', cases }));
  assert.equal(client.pending(scope), null);
  await assert.rejects(client.prepare({ ...scope, answer: 'forbidden cache' } as typeof scope, cases));
  for (const selection of [[], [cases[0], cases[0]], [{ caseId: '0', expectedVersion: 1 }], [{ caseId: '30', expectedVersion: 0 }], Array(51).fill(cases[0])]) {
    await assert.rejects(client.prepare(scope, selection));
  }
  assert.equal(calls, 0);
});

test('blocked browser storage still retains the current instance original key', async () => {
  const blocked = { getItem: () => { throw Error('blocked'); }, setItem: () => { throw Error('blocked'); }, removeItem: () => { throw Error('blocked'); } };
  const keys: string[] = [], client = new KnowledgeBatchPreparationClient(blocked, { write: async (_path: string, _body: object, _method?: string, key?: string) => { keys.push(key!); throw new AssistantRequestError('network_unknown', 0, true); } });
  await assert.rejects(client.prepare(scope, cases)); await assert.rejects(client.retry(scope)); assert.equal(keys[0], keys[1]);
});
