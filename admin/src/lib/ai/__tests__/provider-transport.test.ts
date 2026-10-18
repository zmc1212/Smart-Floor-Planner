import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AiProviderError, classifyImageSubmissionError, isSafeProviderFallback } from '../provider-types';
import { parseJson, providerFetch } from '../providers/http';

test('a rejected fetch without a response cannot authorize another provider request', async t => {
  for (const error of [new TypeError('fetch failed'), Object.assign(new Error('connection reset'), { code: 'ECONNRESET' })]) {
    let calls = 0;
    const mocked = t.mock.method(globalThis, 'fetch', async () => { calls++; throw error; });
    try {
      await assert.rejects(providerFetch('https://synthetic.invalid/v1/chat/completions', { method: 'POST', body: '{}' }, 1000, 'Synthetic'), rejected => {
        assert.ok(rejected instanceof AiProviderError);
        assert.equal(rejected.code, 'PROVIDER_CONNECTION_FAILED');
        assert.equal(rejected.disposition, 'unknown');
        assert.equal(isSafeProviderFallback(rejected), false);
        assert.equal(classifyImageSubmissionError(rejected).action, 'fail_untrackable');
        assert.equal(classifyImageSubmissionError(rejected, 'synthetic-task').action, 'wait');
        return true;
      });
      assert.equal(calls, 1);
    } finally { mocked.mock.restore(); }
  }
});

test('explicit response rejection retains its existing bounded fallback classification', async t => {
  for (const status of [401, 429, 503]) {
    const mocked = t.mock.method(globalThis, 'fetch', async () => new Response('synthetic rejection', { status }));
    try {
      await assert.rejects(providerFetch('https://synthetic.invalid/request', { method: 'POST' }, 1000, 'Synthetic'), error => {
        assert.ok(error instanceof AiProviderError);
        assert.equal(error.code, 'HTTP_' + status);
        assert.equal(isSafeProviderFallback(error), true);
        return true;
      });
    } finally { mocked.mock.restore(); }
  }
});

test('timeouts and ambiguous server responses remain unknown without a transport retry', async t => {
  for (const failure of [new DOMException('synthetic timeout', 'TimeoutError'), new Response('synthetic failure', { status: 504 })]) {
    let calls = 0;
    const mocked = t.mock.method(globalThis, 'fetch', async () => { calls++; if (failure instanceof Error) throw failure; return failure; });
    try {
      await assert.rejects(providerFetch('https://synthetic.invalid/request', {}, 1000, 'Synthetic'), error => {
        assert.ok(error instanceof AiProviderError);
        assert.equal(error.disposition, 'unknown');
        assert.equal(isSafeProviderFallback(error), false);
        return true;
      });
      assert.equal(calls, 1);
    } finally { mocked.mock.restore(); }
  }
});

test('a body failure after headers does not become proof of nonacceptance', async t => {
  const response = new Response('synthetic');
  t.mock.method(response, 'text', async () => { throw new TypeError('synthetic response interrupted'); });
  t.mock.method(globalThis, 'fetch', async () => response);
  const headers = await providerFetch('https://synthetic.invalid/request', {}, 1000, 'Synthetic');
  await assert.rejects(parseJson(headers, 'Synthetic'), error => {
    assert.equal(isSafeProviderFallback(error), false);
    return true;
  });
});
