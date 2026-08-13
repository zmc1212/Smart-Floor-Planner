import assert from 'node:assert/strict';
import test from 'node:test';
import { apiNebulaAdapter } from '@/lib/ai/providers/apinebula';
import { AiProviderError, type AiProviderRuntimeConfig } from '@/lib/ai/provider-types';

const runtime: AiProviderRuntimeConfig = {
  id: 'nebula-id',
  key: 'apinebula-fallback',
  name: 'API Nebula',
  adapterType: 'apinebula',
  baseUrl: 'https://apinebula.example/v1',
  apiKey: 'nebula-secret',
  capabilities: ['chat', 'vision', 'image.generate', 'image.edit'],
  modelMappings: {
    'chat.general': 'gpt-5.6-sol',
    'vision.reference_analysis': 'gpt-5.6-sol',
    'image.generate.standard': 'gpt-image-2',
    'image.edit.standard': 'gpt-image-2',
  },
  timeoutMs: 5000,
};

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => handler(String(input), init)) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

test('API Nebula submits asynchronous image generation without duplicating /v1', async () => {
  const restore = mockFetch((url, init) => {
    assert.equal(url, 'https://apinebula.example/v1/image-tasks/generations');
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer nebula-secret');
    assert.deepEqual(JSON.parse(String(init?.body)), {
      model: 'gpt-image-2',
      prompt: 'room',
      quality: 'high',
      response_format: 'url',
    });
    return Response.json({ id: 'task-1', task_id: 'task-1', status: 'queued' });
  });
  try {
    assert.deepEqual(await apiNebulaAdapter.submitImage(runtime, { model: 'gpt-image-2', prompt: 'room' }), {
      status: 'processing',
      remoteTaskId: 'task-1',
      remoteStatus: 'queued',
      nextPollMs: 5000,
    });
  } finally { restore(); }
});

test('API Nebula sends all edit references in the documented image_url shape', async () => {
  const restore = mockFetch((url, init) => {
    assert.equal(url, 'https://apinebula.example/v1/image-tasks/edits');
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.images, [
      { image_url: 'data:image/png;base64,abc' },
      { image_url: 'https://assets.example/reference.png' },
    ]);
    return Response.json({ task_id: 'task-edit', status: 'in_progress' });
  });
  try {
    const result = await apiNebulaAdapter.submitImage(runtime, {
      model: 'gpt-image-2',
      prompt: 'edit room',
      images: ['data:image/png;base64,abc', 'https://assets.example/reference.png'],
    });
    assert.equal(result.status, 'processing');
  } finally { restore(); }
});

test('API Nebula polling extracts completed downloads and refunded failures', async () => {
  let payload: Record<string, unknown> = {
    id: 'task-1',
    status: 'completed',
    detail: { data: [{ download_url: 'https://cdn.example/result.png' }] },
  };
  const restore = mockFetch((url) => {
    assert.equal(url, 'https://apinebula.example/v1/image-tasks/task-1?detail=true');
    return Response.json(payload);
  });
  try {
    assert.deepEqual(await apiNebulaAdapter.pollImage(runtime, 'task-1'), {
      status: 'succeeded',
      image: 'https://cdn.example/result.png',
      remoteTaskId: 'task-1',
      remoteStatus: 'completed',
    });
    payload = { id: 'task-1', status: 'failed', error: { message: 'upstream failed' } };
    assert.deepEqual(await apiNebulaAdapter.pollImage(runtime, 'task-1'), {
      status: 'failed',
      remoteTaskId: 'task-1',
      remoteStatus: 'failed',
      error: 'upstream failed',
      refunded: true,
    });
  } finally { restore(); }
});

test('explicit 503 response is safe for the provider router to fallback', async () => {
  const restore = mockFetch(() => new Response('temporarily unavailable', { status: 503 }));
  try {
    await assert.rejects(
      () => apiNebulaAdapter.submitImage(runtime, { model: 'gpt-image-2', prompt: 'room' }),
      (error: unknown) => error instanceof AiProviderError && error.disposition === 'safe_fallback'
    );
  } finally { restore(); }
});

test('ambiguous 502 response is not safe to resubmit to another provider', async () => {
  const restore = mockFetch(() => new Response('bad gateway after submission', { status: 502 }));
  try {
    await assert.rejects(
      () => apiNebulaAdapter.submitImage(runtime, { model: 'gpt-image-2', prompt: 'room' }),
      (error: unknown) => error instanceof AiProviderError && error.disposition === 'unknown'
    );
  } finally { restore(); }
});
