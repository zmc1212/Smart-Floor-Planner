import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveProviderCostEstimate } from '@/lib/ai/provider-cost';
import type { AiProviderRuntimeConfig } from '@/lib/ai/provider-types';

test('provider cost selects the most specific remote model and resolution rule', () => {
  const runtime = {
    costRules: [
      { logicalModelKey: 'image.generate.standard', currency: 'CNY', estimatedMicros: 100 },
      { logicalModelKey: 'image.generate.standard', resolutionTier: '4K', currency: 'CNY', estimatedMicros: 200 },
      { logicalModelKey: 'image.generate.standard', remoteModel: 'nano-banana-2', currency: 'CNY', estimatedMicros: 300 },
      { logicalModelKey: 'image.generate.standard', remoteModel: 'nano-banana-2', resolutionTier: '4K', currency: 'CNY', estimatedMicros: 400 },
    ],
  } as AiProviderRuntimeConfig;

  assert.deepEqual(resolveProviderCostEstimate(runtime, 'image.generate.standard', 'nano-banana-2', '4K'), { currency: 'CNY', micros: 400 });
  assert.deepEqual(resolveProviderCostEstimate(runtime, 'image.generate.standard', 'gpt-image-2-vip', '4K'), { currency: 'CNY', micros: 200 });
  assert.deepEqual(resolveProviderCostEstimate(runtime, 'image.generate.standard', 'nano-banana-2', '2K'), { currency: 'CNY', micros: 300 });
});
