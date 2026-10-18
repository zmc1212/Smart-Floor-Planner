import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assistantPermissions, hasAssistantKnowledgeAccess } from '../access';
import { DEFAULT_PERMISSIONS } from '../../admin-user-roles';
import { AssistantMutations, AssistantRequestError, assistantRequest, runIsActive } from '../../../components/assistant/client';

test('platform administrators manage knowledge while enterprise and operations grants remain explicit', () => {
  for (const role of ['designer', 'measurer', 'salesperson', 'viewer', undefined]) {
    assert.equal(hasAssistantKnowledgeAccess(role, ['assistant-knowledge']), false);
  }
  assert.equal(hasAssistantKnowledgeAccess('enterprise_admin', []), false);
  assert.equal(hasAssistantKnowledgeAccess('enterprise_admin', ['assistant-knowledge']), true);
  for (const role of ['admin', 'super_admin']) {
    assert.equal(hasAssistantKnowledgeAccess(role), true);
    assert.deepEqual(assistantPermissions(role, ['assistant-usage', 'assistant-retention']), ['assistant-knowledge']);
  }
  assert.deepEqual(assistantPermissions('enterprise_admin', ['dashboard', 'assistant-usage']), ['assistant-usage']);
  for (const defaults of Object.values(DEFAULT_PERMISSIONS)) assert.ok(!defaults.some(key => key.startsWith('assistant-')));
});

test('unknown network result retries identical mutations with the same key, but successful intentional repeats get new keys', async t => {
  const requests: RequestInit[] = [];
  t.mock.method(globalThis, 'fetch', async (_: string, init: RequestInit) => {
    requests.push(init);
    if (requests.length === 1) throw new Error('connection lost after commit');
    return Response.json({ success: true, data: { id: '123' } });
  });
  const writer = new AssistantMutations();
  await assert.rejects(writer.write('knowledge/documents', { title: 'service' }), (error: unknown) => error instanceof AssistantRequestError && error.uncertain);
  await writer.write('knowledge/documents', { title: 'service' });
  await writer.write('knowledge/documents', { title: 'service' });
  const keys = requests.map(init => new Headers(init.headers).get('Idempotency-Key'));
  assert.equal(keys[0], keys[1]); assert.notEqual(keys[1], keys[2]);
  assert.equal(requests[0].body, requests[1].body);
});

test('message retry preserves clientMessageId/header identity and unknown 503 results', async t => {
  const keys: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_: string, init: RequestInit) => {
    const key = new Headers(init.headers).get('Idempotency-Key')!; keys.push(key);
    assert.equal(JSON.parse(String(init.body)).clientMessageId, key);
    return keys.length === 1 ? Response.json({ success: false, error: 'assistant_unavailable' }, { status: 503 }) : Response.json({ success: true, data: { runId: '45' } });
  });
  const writer = new AssistantMutations(); const body = { clientMessageId: 'question-1', content: { version: 1, blocks: [{ type: 'text', text: '服务范围？' }] } };
  await assert.rejects(writer.write('preview/conversations/1/messages', body, 'POST', 'question-1'));
  assert.deepEqual(await writer.write('preview/conversations/1/messages', body, 'POST', 'question-1'), { runId: '45' });
  assert.deepEqual(keys, ['question-1', 'question-1']);
});

test('permission and version failures are localized and not treated as unknown submissions', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ success: false, error: 'version_conflict' }, { status: 409 }));
  await assert.rejects(assistantRequest('knowledge/documents/1'), (error: unknown) => error instanceof AssistantRequestError && !error.uncertain && error.message.includes('输入仍保留'));
});

test('malformed success response stays uncertain; active polling never includes indeterminate or terminal runs', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('<html>gateway</html>', { status: 200 }));
  await assert.rejects(assistantRequest('preview/conversations'), (error: unknown) => error instanceof AssistantRequestError && error.uncertain);
  for (const status of ['failed', 'cancelled', 'succeeded', 'indeterminate']) assert.equal(runIsActive({ status }), false);
  for (const status of ['queued', 'running']) assert.equal(runIsActive({ status }), true);
});
