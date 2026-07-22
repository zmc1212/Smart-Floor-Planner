import assert from 'node:assert/strict';
import test from 'node:test';
import { grsAdapter } from '@/lib/ai/providers/grs';
import { openAiCompatibleAdapter } from '@/lib/ai/providers/openai-compatible';
import { AiProviderError, actionKeyForGenerationType, classifyImageSubmissionError, isSafeProviderFallback, type AiProviderRuntimeConfig } from '@/lib/ai/provider-types';
import { serializeProviderConfig } from '@/lib/ai/provider-admin';

const runtime: AiProviderRuntimeConfig = {
  id: 'provider-id', key: 'grs-primary', name: 'GRS AI', adapterType: 'grs',
  baseUrl: 'https://grs.example', apiKey: 'secret-key',
  capabilities: ['chat', 'vision', 'image.generate', 'image.edit'],
  modelMappings: {
    'chat.general': 'gemini-3.1-pro', 'vision.reference_analysis': 'gemini-3.1-pro',
    'image.generate.standard': 'gpt-image-2', 'image.edit.standard': 'gpt-image-2',
  }, timeoutMs: 5000,
};

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => handler(String(input), init)) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

test('GRS chat uses OpenAI-compatible endpoint and parses content', async () => {
  const restore = mockFetch((url, init) => {
    assert.equal(url, 'https://grs.example/v1/chat/completions');
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer secret-key');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, 'gemini-3.1-pro');
    return Response.json({ choices: [{ message: { content: 'ok' } }] });
  });
  try {
    const result = await grsAdapter.chat(runtime, { model: 'gemini-3.1-pro', messages: [{ role: 'user', content: 'hello' }] });
    assert.equal(result, 'ok');
  } finally { restore(); }
});

test('GRS image submit follows the documented async generation protocol', async () => {
  const restore = mockFetch((url, init) => {
    assert.equal(url, 'https://grs.example/v1/api/generate');
    assert.equal(init?.method, 'POST');
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer secret-key');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, 'gpt-image-2');
    assert.equal(body.replyType, 'async');
    assert.equal(body.aspectRatio, '1024x1024');
    assert.deepEqual(body.images, ['data:image/png;base64,abc']);
    assert.equal('webHook' in body, false);
    return Response.json({ id: 'remote-123', status: 'running' });
  });
  try {
    const result = await grsAdapter.submitImage(runtime, { model: 'gpt-image-2', prompt: 'room', images: ['data:image/png;base64,abc'] });
    assert.deepEqual(result, { status: 'processing', remoteTaskId: 'remote-123', remoteStatus: 'running', nextPollMs: 5000 });
  } finally { restore(); }
});

test('GRS standard image model prefers an explicit aspect ratio over pixel size', async () => {
  const restore = mockFetch((_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.aspectRatio, '16:9');
    return Response.json({ id: 'remote-wide', status: 'running' });
  });
  try {
    await grsAdapter.submitImage(runtime, {
      model: 'gpt-image-2',
      prompt: 'room',
      size: '1672x941',
      aspectRatio: '16:9',
    });
  } finally { restore(); }
});

test('GRS VIP image model uses the documented custom pixel size', async () => {
  const restore = mockFetch((_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.aspectRatio, '1376x768');
    return Response.json({ id: 'remote-vip', status: 'running' });
  });
  try {
    await grsAdapter.submitImage(runtime, {
      model: 'gpt-image-2-vip',
      prompt: 'room',
      size: '1376x768',
      aspectRatio: '16:9',
    });
  } finally { restore(); }
});

test('OpenAI-compatible fallback normalizes a wide provider specification', async () => {
  const restore = mockFetch((_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.size, '1536x1024');
    return Response.json({ data: [{ url: 'https://temp.example/wide.png' }] });
  });
  try {
    await openAiCompatibleAdapter.submitImage(runtime, {
      model: 'gpt-image-1',
      prompt: 'room',
      size: '1672x941',
      aspectRatio: '16:9',
    });
  } finally { restore(); }
});

test('GRS result polling parses success and refunded failure', async () => {
  let response: Record<string, unknown> = { id: 'remote-123', status: 'succeeded', results: [{ url: 'https://temp.example/result.png' }] };
  const restore = mockFetch((url, init) => {
    assert.equal(url, 'https://grs.example/v1/api/result?id=remote-123');
    assert.equal(init?.method, 'GET');
    assert.equal(init?.body, undefined);
    return Response.json(response);
  });
  try {
    assert.deepEqual(await grsAdapter.pollImage(runtime, 'remote-123'), {
      status: 'succeeded', image: 'https://temp.example/result.png', remoteTaskId: 'remote-123', remoteStatus: 'succeeded',
    });
    response = { id: 'remote-123', status: 'violation', error: 'policy rejected' };
    assert.deepEqual(await grsAdapter.pollImage(runtime, 'remote-123'), {
      status: 'failed', remoteTaskId: 'remote-123', remoteStatus: 'violation', error: 'policy rejected', refunded: true,
    });
    response = { id: 'remote-123', status: 'failed', message: 'render failed' };
    assert.deepEqual(await grsAdapter.pollImage(runtime, 'remote-123'), {
      status: 'failed', remoteTaskId: 'remote-123', remoteStatus: 'failed', error: 'render failed', refunded: true,
    });
  } finally { restore(); }
});

test('GRS image submit accepts an immediate documented success response', async () => {
  const restore = mockFetch(() => Response.json({
    id: 'remote-456', status: 'succeeded', results: [{ url: 'https://temp.example/immediate.png' }],
  }));
  try {
    assert.deepEqual(await grsAdapter.submitImage(runtime, { model: 'gpt-image-2', prompt: 'room' }), {
      status: 'succeeded', image: 'https://temp.example/immediate.png', remoteTaskId: 'remote-456', remoteStatus: 'succeeded',
    });
  } finally { restore(); }
});

test('GRS nano-banana converts pixel sizes to documented aspect ratios', async () => {
  const restore = mockFetch((_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.aspectRatio, '3:2');
    assert.equal(body.imageSize, '2K');
    return Response.json({ id: 'remote-nano', status: 'running' });
  });
  try {
    await grsAdapter.submitImage(runtime, { model: 'nano-banana-2', prompt: 'room', size: '1536x1024', quality: '2k' });
  } finally { restore(); }
});

test('GRS balance queries API Key credits without exposing the key in the result', async () => {
  const restore = mockFetch((url, init) => {
    assert.equal(url, 'https://grs.example/client/openapi/getAPIKeyCredits');
    assert.equal(init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(init?.body)), { apiKey: 'secret-key' });
    return Response.json({ code: 0, data: { credits: 12345 }, msg: 'success' });
  });
  try {
    const result = await grsAdapter.getBalance!(runtime);
    assert.deepEqual(result, { balance: 12345, unit: 'GRS 积分' });
    assert.equal(JSON.stringify(result).includes(runtime.apiKey), false);
  } finally { restore(); }
});

test('GRS balance rejects provider-level errors returned with HTTP 200', async () => {
  const restore = mockFetch(() => Response.json({ code: -1, data: null, msg: 'apikey不存在' }));
  try {
    await assert.rejects(
      () => grsAdapter.getBalance!(runtime),
      (error: unknown) => error instanceof AiProviderError && error.code === 'GRS_BALANCE_QUERY_FAILED'
    );
  } finally { restore(); }
});

test('GRS connectivity test validates the API Key through the balance endpoint', async () => {
  const restore = mockFetch((url, init) => {
    assert.equal(url, 'https://grs.example/client/openapi/getAPIKeyCredits');
    assert.deepEqual(JSON.parse(String(init?.body)), { apiKey: 'secret-key' });
    return Response.json({ code: 0, data: { credits: 8000 }, msg: 'success' });
  });
  try {
    const result = await grsAdapter.testConnection(runtime);
    assert.equal(result.ok, true);
    assert.match(result.message, /8000 GRS 积分/);
  } finally { restore(); }
});

test('GRS model sync falls back to configured mappings when /v1/models is unsupported', async () => {
  const restore = mockFetch((url) => {
    assert.equal(url, 'https://grs.example/v1/models');
    return new Response('404 page not found', { status: 404 });
  });
  try {
    assert.deepEqual(await grsAdapter.listModels(runtime), ['gemini-3.1-pro', 'gpt-image-2']);
  } finally { restore(); }
});

test('explicit unaccepted HTTP error is safe to fallback', async () => {
  const restore = mockFetch(() => new Response('invalid model', { status: 400 }));
  try {
    await assert.rejects(
      () => grsAdapter.submitImage(runtime, { model: 'bad', prompt: 'x' }),
      (error: unknown) => error instanceof AiProviderError && error.disposition === 'safe_fallback'
    );
  } finally { restore(); }
});

test('invalid JSON response includes safe diagnostics without exposing its body', async () => {
  const restore = mockFetch(() => new Response('<html>gateway error secret-token</html>', {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
  }));
  try {
    await assert.rejects(
      () => grsAdapter.submitImage(runtime, { model: 'gpt-image-2', prompt: 'x' }),
      (error: unknown) => {
        assert.ok(error instanceof AiProviderError);
        assert.equal(error.code, 'INVALID_PROVIDER_RESPONSE');
        assert.match(error.message, /text\/html/);
        assert.match(error.message, /bytes/);
        assert.equal(error.message.includes('secret-token'), false);
        return true;
      }
    );
  } finally { restore(); }
});

test('provider API serialization never exposes encrypted or plaintext keys', () => {
  const serialized = serializeProviderConfig({
    _id: '1', key: 'grs', name: 'GRS', adapterType: 'grs', baseUrl: 'https://example',
    apiKeyEncrypted: 'encrypted-secret', apiKeyMasked: 'sk-***1234', capabilities: [], modelMappings: {},
    priority: 1, timeoutMs: 1000, enabled: true, costRules: [], discoveredModels: [],
  });
  assert.equal(serialized.apiKeyMasked, 'sk-***1234');
  assert.equal('apiKeyEncrypted' in serialized, false);
  assert.equal('apiKey' in serialized, false);
});

test('legacy generation types map to stable action keys', () => {
  assert.equal(actionKeyForGenerationType('reference_recreate'), 'image.reference_recreate');
  assert.equal(actionKeyForGenerationType('advice'), 'text.design_advice');
});

test('accepted timeout and unknown status never allow a second upstream task', () => {
  assert.equal(isSafeProviderFallback(new AiProviderError('connect failed', 'CONNECT', 'safe_fallback')), true);
  assert.equal(isSafeProviderFallback(new AiProviderError('timed out', 'TIMEOUT', 'unknown')), false);
  assert.equal(isSafeProviderFallback(new AiProviderError('accepted', 'ACCEPTED', 'definitive_failure')), false);
});

test('image submission errors only remain pending when a remote task id is available', () => {
  const unknown = new AiProviderError('invalid response', 'INVALID_PROVIDER_RESPONSE', 'unknown');
  assert.deepEqual(classifyImageSubmissionError(unknown), {
    attemptStatus: 'failed', accepted: false, action: 'fail_untrackable',
  });
  assert.deepEqual(classifyImageSubmissionError(unknown, 'remote-123'), {
    attemptStatus: 'unknown', accepted: true, action: 'wait',
  });
  assert.deepEqual(classifyImageSubmissionError(
    new AiProviderError('connection failed', 'CONNECTION', 'safe_fallback')
  ), {
    attemptStatus: 'failed', accepted: false, action: 'fallback',
  });
});
