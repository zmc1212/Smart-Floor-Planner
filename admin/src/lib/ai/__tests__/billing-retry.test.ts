import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import { AiGeneration } from '@/models/AiGeneration';
import { resolveProviderCostEstimate } from '@/lib/ai/execution-service';
import type { AiProviderRuntimeConfig } from '@/lib/ai/provider-types';

test('legacy generation billing can be reset for retry without an undefined price snapshot', () => {
  const generation = new AiGeneration({
    enterpriseId: new mongoose.Types.ObjectId(),
    operatorId: new mongoose.Types.ObjectId(),
    type: 'floor_plan_style',
    channel: 'miniprogram',
    input: { style: 'modern' },
    output: {},
    status: 'failed',
    billing: { cycle: 0, status: 'released' },
  });

  generation.billing = { cycle: 1, status: 'unbilled' };

  assert.equal(generation.validateSync(), undefined);
  assert.deepEqual(generation.toObject().billing, { cycle: 1, status: 'unbilled' });
});

test('provider cost selects the most specific remote model and resolution rule', () => {
  const runtime = {
    costRules: [
      { logicalModelKey: 'image.generate.standard', currency: 'CNY', estimatedMicros: 100 },
      { logicalModelKey: 'image.generate.standard', resolutionTier: '4K', currency: 'CNY', estimatedMicros: 200 },
      { logicalModelKey: 'image.generate.standard', remoteModel: 'nano-banana-2', currency: 'CNY', estimatedMicros: 300 },
      { logicalModelKey: 'image.generate.standard', remoteModel: 'nano-banana-2', resolutionTier: '4K', currency: 'CNY', estimatedMicros: 400 },
    ],
  } as AiProviderRuntimeConfig;

  assert.deepEqual(
    resolveProviderCostEstimate(runtime, 'image.generate.standard', 'nano-banana-2', '4K'),
    { currency: 'CNY', micros: 400 }
  );
  assert.deepEqual(
    resolveProviderCostEstimate(runtime, 'image.generate.standard', 'gpt-image-2-vip', '4K'),
    { currency: 'CNY', micros: 200 }
  );
  assert.deepEqual(
    resolveProviderCostEstimate(runtime, 'image.generate.standard', 'nano-banana-2', '2K'),
    { currency: 'CNY', micros: 300 }
  );
});
