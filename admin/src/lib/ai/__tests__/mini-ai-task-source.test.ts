import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import mongoose from 'mongoose';
import type { IAiGeneration } from '@/models/AiGeneration';
import {
  materializeSourceResultAsInput,
  validateMiniAiSourceResultTask,
} from '@/lib/ai/mini-ai-tasks';

const enterpriseId = new mongoose.Types.ObjectId();
const ownerId = new mongoose.Types.ObjectId();
const workflowId = new mongoose.Types.ObjectId();

function sourceTask(overrides: Partial<IAiGeneration> = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    enterpriseId,
    operatorId: new mongoose.Types.ObjectId(),
    workflowId,
    floorPlanId: new mongoose.Types.ObjectId('111111111111111111111111'),
    status: 'succeeded',
    stageKey: 'perspective_upgrade',
    nextRecommendedStage: 'base_render',
    input: {
      roomData: { targetScope: 'single_room', roomId: 'kitchen' },
    },
    output: { imageUrl: 'https://provider.example/kitchen.png' },
    createdAt: new Date('2026-07-25T00:00:00.000Z'),
    ...overrides,
  } as IAiGeneration;
}

const kitchenTarget = {
  floorPlanId: '111111111111111111111111',
  targetScope: 'single_room' as const,
  roomId: 'kitchen',
};

test('source-result validation rejects cross-room, stale, and cross-workflow continuations', () => {
  const task = sourceTask();
  assert.equal(validateMiniAiSourceResultTask({
    sourceTask: task,
    target: kitchenTarget,
    workflowId: String(workflowId),
    planUpdatedAt: new Date('2026-07-24T00:00:00.000Z'),
  }), '');
  assert.equal(validateMiniAiSourceResultTask({
    sourceTask: task,
    target: { ...kitchenTarget, roomId: 'living' },
    workflowId: String(workflowId),
  }), '来源成果与当前设计房间不一致');
  assert.equal(validateMiniAiSourceResultTask({
    sourceTask: task,
    target: kitchenTarget,
    workflowId: String(workflowId),
    planUpdatedAt: new Date('2026-07-26T00:00:00.000Z'),
  }), '来源成果早于户型最新版本，请先重新生成当前空间');
  assert.equal(validateMiniAiSourceResultTask({
    sourceTask: task,
    target: kitchenTarget,
    workflowId: String(new mongoose.Types.ObjectId()),
  }), '来源成果不属于当前客户方案');
});

test('internal result assets are copied into a new generation-owned input asset', async () => {
  const outputAssetId = new mongoose.Types.ObjectId();
  const copiedAsset = { _id: new mongoose.Types.ObjectId(), ownerType: 'ai_generation_input' };
  let storedInput: Record<string, unknown> | undefined;
  const result = await materializeSourceResultAsInput({
    sourceTask: sourceTask({ output: { imageUrl: `/api/ai/assets/${outputAssetId}/image` } }),
    enterpriseId,
    ownerId,
    deps: {
      findAsset: (async (assetId: string) => ({ _id: assetId, mimeType: 'image/png' })) as never,
      readAssetBuffer: (async () => Buffer.from('image')) as never,
      storeBuffer: (async (input: Record<string, unknown>) => {
        storedInput = input;
        return { asset: copiedAsset };
      }) as never,
      persistReference: (async () => { throw new Error('unexpected external persistence'); }) as never,
    },
  });

  assert.equal(result, copiedAsset);
  assert.equal(storedInput?.ownerType, 'ai_generation_input');
  assert.equal(String(storedInput?.ownerId), String(ownerId));
  assert.equal(storedInput?.originalUrl, `/api/ai/assets/${outputAssetId}/image`);
});

test('external provider URLs are persisted as generation-owned input assets', async () => {
  const persistedAssetId = new mongoose.Types.ObjectId();
  const persistedAsset = { _id: persistedAssetId, ownerType: 'ai_generation_input' };
  let persistInput: Record<string, unknown> | undefined;
  const result = await materializeSourceResultAsInput({
    sourceTask: sourceTask(),
    enterpriseId,
    ownerId,
    deps: {
      findAsset: (async (assetId: string) => (
        assetId === String(persistedAssetId) ? persistedAsset : null
      )) as never,
      readAssetBuffer: (async () => { throw new Error('unexpected internal read'); }) as never,
      storeBuffer: (async () => { throw new Error('unexpected direct store'); }) as never,
      persistReference: (async (input: Record<string, unknown>) => {
        persistInput = input;
        return `/api/ai/assets/${persistedAssetId}/image`;
      }) as never,
    },
  });

  assert.equal(result, persistedAsset);
  assert.equal(persistInput?.ownerType, 'ai_generation_input');
  assert.equal(String(persistInput?.ownerId), String(ownerId));
  assert.equal(persistInput?.image, 'https://provider.example/kitchen.png');
});

test('source materialization and lineage happen before any credit hold', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'src/lib/ai/mini-ai-tasks.ts'), 'utf8');
  const createStart = source.indexOf('export async function createMiniAiTask');
  const materializeAt = source.indexOf('materializeSourceResultAsInput({', createStart);
  const parentAt = source.indexOf('parentGenerationId: sourceResultTask?._id', createStart);
  const creditHoldAt = source.indexOf('await ensureGenerationCreditHold(generation)', createStart);

  assert.ok(materializeAt > createStart && materializeAt < creditHoldAt);
  assert.ok(parentAt > materializeAt && parentAt < creditHoldAt);
  assert.match(source.slice(createStart, materializeAt), /spaceAssetId && input\.sourceResultTaskId/);
});
