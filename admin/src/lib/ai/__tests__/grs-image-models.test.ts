import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GRS_IMAGE_MODEL_CATALOG,
  getGrsAspectRatiosForTier,
  resolveGrsImageParameters,
  validateVipCustomSize,
} from '@/lib/ai/grs-image-models';
import { grsAdapter } from '@/lib/ai/providers/grs';
import type { AiProviderRuntimeConfig } from '@/lib/ai/provider-types';

const runtime: AiProviderRuntimeConfig = {
  id: 'provider-id',
  key: 'grs-primary',
  name: 'GRS AI',
  adapterType: 'grs',
  baseUrl: 'https://grs.example',
  apiKey: 'secret-key',
  capabilities: ['image.generate', 'image.edit'],
  modelMappings: {
    'image.generate.standard': 'gpt-image-2',
    'image.edit.standard': 'gpt-image-2',
  },
  timeoutMs: 5000,
};

function mockFetch(handler: (init?: RequestInit) => Response) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => handler(init)) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

for (const definition of GRS_IMAGE_MODEL_CATALOG) {
  test(`${definition.model} submits only its documented async parameters`, async () => {
    const restore = mockFetch((init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, definition.model);
      assert.equal(body.replyType, 'async');
      assert.equal(body.aspectRatio, definition.family === 'gpt-image-2-vip' ? '1024x1024' : '1:1');
      assert.equal('quality' in body, false);
      assert.equal('output_format' in body, false);
      if (definition.family.startsWith('nano-banana')) {
        assert.equal(body.imageSize, '1K');
      } else {
        assert.equal('imageSize' in body, false);
      }
      return Response.json({ id: `task-${definition.model}`, status: 'running' });
    });
    try {
      const result = await grsAdapter.submitImage(runtime, {
        model: definition.model,
        prompt: 'room',
        aspectRatio: '1:1',
        resolutionTier: '1K',
      });
      assert.equal(result.status, 'processing');
    } finally {
      restore();
    }
  });
}

test('GPT Image 2 accepts documented 1K pixel values without rewriting them', () => {
  assert.deepEqual(resolveGrsImageParameters({
    model: 'gpt-image-2',
    aspectRatio: '1672x941',
  }), {
    aspectRatio: '1672x941',
    resolutionTier: '1K',
  });
});

test('GPT Image 2 VIP maps ratio and resolution presets to documented pixels', () => {
  assert.deepEqual(resolveGrsImageParameters({
    model: 'gpt-image-2-vip',
    aspectRatio: '16:9',
    resolutionTier: '4K',
  }), {
    aspectRatio: '3840x2160',
    resolutionTier: '4K',
    selectedAspectRatio: '16:9',
  });
});

test('GPT Image 2 VIP exposes only ratios available for each preset tier', () => {
  assert.equal(getGrsAspectRatiosForTier('gpt-image-2-vip', '1K').includes('1:3'), false);
  assert.equal(getGrsAspectRatiosForTier('gpt-image-2-vip', '2K').includes('1:3'), true);
  assert.deepEqual(getGrsAspectRatiosForTier('gpt-image-2-vip', 'CUSTOM'), []);
});

test('GPT Image 2 VIP custom dimensions enforce all documented boundaries', () => {
  assert.equal(validateVipCustomSize(1280, 768), '1280x768');
  assert.equal(validateVipCustomSize(3840, 1280), '3840x1280');
  assert.throws(() => validateVipCustomSize(1025, 1024), /16 的倍数/);
  assert.throws(() => validateVipCustomSize(3840, 1024), /3:1/);
  assert.throws(() => validateVipCustomSize(512, 512), /总像素/);
  assert.throws(() => validateVipCustomSize(3840, 3840), /总像素/);
});

test('Nano Banana 2 supports extended panorama ratios and uses imageSize', () => {
  assert.deepEqual(resolveGrsImageParameters({
    model: 'nano-banana-2',
    aspectRatio: '8:1',
    resolutionTier: '4K',
  }), {
    aspectRatio: '8:1',
    imageSize: '4K',
    resolutionTier: '4K',
  });
});
