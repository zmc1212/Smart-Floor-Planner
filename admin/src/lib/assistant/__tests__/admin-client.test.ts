import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { assistantPermissions, hasAssistantKnowledgeAccess } from '../access';
import { DEFAULT_PERMISSIONS } from '../../admin-user-roles';
import { AssistantMutations, AssistantRequestError, assistantRequest, runIsActive } from '../../../components/assistant/client';

function withoutStaticAbortHelpers(t: TestContext) {
  for (const key of ['timeout', 'any'] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(AbortSignal, key);
    Object.defineProperty(AbortSignal, key, { configurable: true, value: undefined });
    t.after(() => {
      if (descriptor) Object.defineProperty(AbortSignal, key, descriptor);
      else Reflect.deleteProperty(AbortSignal, key);
    });
  }
}

function rejectOnAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

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

test('requests dispatch without static AbortSignal helpers and dispose deadline and caller listener after success', async t => {
  withoutStaticAbortHelpers(t);
  const caller = new AbortController();
  const add = t.mock.method(caller.signal, 'addEventListener');
  const remove = t.mock.method(caller.signal, 'removeEventListener');
  const schedule = t.mock.method(globalThis, 'setTimeout');
  const clear = t.mock.method(globalThis, 'clearTimeout');
  const request = t.mock.method(globalThis, 'fetch', async (_: string, init: RequestInit) => {
    assert.ok(init.signal instanceof AbortSignal);
    assert.notEqual(init.signal, caller.signal);
    assert.equal(init.cache, 'no-store');
    return Response.json({ success: true, data: { id: '123' } });
  });
  assert.deepEqual(await assistantRequest('knowledge/documents', { signal: caller.signal }), { id: '123' });
  assert.equal(request.mock.callCount(), 1);
  assert.equal(schedule.mock.callCount(), 1);
  assert.equal(schedule.mock.calls[0].arguments[1], 30000);
  assert.deepEqual(clear.mock.calls[0].arguments, [schedule.mock.calls[0].result]);
  assert.equal(add.mock.callCount(), 1);
  assert.equal(remove.mock.callCount(), 1);
  assert.equal(remove.mock.calls[0].arguments[1], add.mock.calls[0].arguments[1]);
});

test('deadline before headers remains uncertain and preserves the mutation key through retry', async t => {
  withoutStaticAbortHelpers(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const requests: RequestInit[] = [];
  t.mock.method(globalThis, 'fetch', async (_: string, init: RequestInit) => {
    requests.push(init);
    if (requests.length === 1) return rejectOnAbort(init.signal!);
    return Response.json({ success: true, data: { id: '123' } });
  });
  const writer = new AssistantMutations();
  const pending = writer.write('knowledge/documents', { title: 'same submission' });
  t.mock.timers.tick(29999);
  assert.equal(requests[0].signal!.aborted, false);
  t.mock.timers.tick(1);
  await assert.rejects(pending, (error: unknown) => error instanceof AssistantRequestError && error.code === 'network_unknown' && error.status === 0 && error.uncertain);
  assert.equal(requests[0].signal!.reason.name, 'TimeoutError');
  await writer.write('knowledge/documents', { title: 'same submission' });
  assert.equal(new Headers(requests[0].headers).get('Idempotency-Key'), new Headers(requests[1].headers).get('Idempotency-Key'));
});

test('deadline remains active through body consumption and preserves response uncertainty and mutation identity', async t => {
  withoutStaticAbortHelpers(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const requests: RequestInit[] = [];
  let reading = false;
  t.mock.method(globalThis, 'fetch', async (_: string, init: RequestInit) => {
    requests.push(init);
    if (requests.length > 1) return Response.json({ success: true, data: { id: '123' } });
    const response = new Response('', { status: 200 });
    t.mock.method(response, 'json', async () => { reading = true; return rejectOnAbort(init.signal!); });
    return response;
  });
  const writer = new AssistantMutations();
  const pending = writer.write('knowledge/documents', { title: 'slow body' });
  await Promise.resolve();
  assert.equal(reading, true);
  t.mock.timers.tick(30000);
  await assert.rejects(pending, (error: unknown) => error instanceof AssistantRequestError && error.code === 'response_unknown' && error.status === 200 && error.uncertain);
  await writer.write('knowledge/documents', { title: 'slow body' });
  assert.equal(new Headers(requests[0].headers).get('Idempotency-Key'), new Headers(requests[1].headers).get('Idempotency-Key'));
});

test('caller cancellation before headers preserves the first reason and releases its listener', async t => {
  withoutStaticAbortHelpers(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const caller = new AbortController();
  const remove = t.mock.method(caller.signal, 'removeEventListener');
  let combined: AbortSignal;
  t.mock.method(globalThis, 'fetch', async (_: string, init: RequestInit) => {
    combined = init.signal!;
    return rejectOnAbort(combined);
  });
  const pending = assistantRequest('preview/conversations', { signal: caller.signal });
  const reason = new DOMException('Caller cancelled', 'AbortError');
  caller.abort(reason);
  await assert.rejects(pending, (error: unknown) => error === reason);
  t.mock.timers.tick(30000);
  assert.equal(combined!.reason, reason);
  assert.equal(remove.mock.callCount(), 1);
});

test('already aborted caller is passed to fetch as aborted and keeps its original reason', async t => {
  withoutStaticAbortHelpers(t);
  const caller = new AbortController();
  const reason = new DOMException('Already cancelled', 'AbortError');
  caller.abort(reason);
  t.mock.method(globalThis, 'fetch', async (_: string, init: RequestInit) => {
    assert.equal(init.signal!.aborted, true);
    assert.equal(init.signal!.reason, reason);
    return rejectOnAbort(init.signal!);
  });
  await assert.rejects(assistantRequest('preview/conversations', { signal: caller.signal }), (error: unknown) => error === reason);
});

test('caller cancellation during body consumption retains existing response_unknown semantics', async t => {
  withoutStaticAbortHelpers(t);
  const caller = new AbortController();
  let reading = false;
  t.mock.method(globalThis, 'fetch', async (_: string, init: RequestInit) => {
    const response = new Response('', { status: 200 });
    t.mock.method(response, 'json', async () => { reading = true; return rejectOnAbort(init.signal!); });
    return response;
  });
  const pending = assistantRequest('preview/conversations', { signal: caller.signal });
  await Promise.resolve();
  assert.equal(reading, true);
  caller.abort();
  await assert.rejects(pending, (error: unknown) => error instanceof AssistantRequestError && error.code === 'response_unknown' && error.status === 200 && error.uncertain);
});

test('deadline and listeners are disposed after known API and malformed-body failures', async t => {
  for (const mode of ['known', 'malformed'] as const) {
    await t.test(mode, async t => {
      withoutStaticAbortHelpers(t);
      const caller = new AbortController();
      const remove = t.mock.method(caller.signal, 'removeEventListener');
      const schedule = t.mock.method(globalThis, 'setTimeout');
      const clear = t.mock.method(globalThis, 'clearTimeout');
      t.mock.method(globalThis, 'fetch', async () => mode === 'known'
        ? Response.json({ success: false, error: 'version_conflict' }, { status: 409 })
        : new Response('<html>gateway</html>', { status: 200 }));
      await assert.rejects(assistantRequest('knowledge/documents', { signal: caller.signal }), (error: unknown) => error instanceof AssistantRequestError && error.uncertain === (mode === 'malformed'));
      assert.equal(schedule.mock.callCount(), 1);
      assert.deepEqual(clear.mock.calls[0].arguments, [schedule.mock.calls[0].result]);
      assert.equal(remove.mock.callCount(), 1);
    });
  }
});
