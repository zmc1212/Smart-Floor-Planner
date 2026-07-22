import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import { AiGeneration } from '@/models/AiGeneration';

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
