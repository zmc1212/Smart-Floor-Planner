import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMiniAiTargetGenerationFilter,
  generationMatchesMiniAiTarget,
  normalizeMiniAiTargetIdentity,
  resolveMiniAiTargetContext,
  validateMiniAiTargetIdentity,
  type MiniAiTargetGeneration,
} from '@/lib/ai/mini-ai-target-context';

type TestGenerationInput = {
  _id: string;
  floorPlanId?: string;
  operatorId?: string;
  status?: MiniAiTargetGeneration['status'];
  stageKey?: MiniAiTargetGeneration['stageKey'];
  nextRecommendedStage?: MiniAiTargetGeneration['nextRecommendedStage'];
  isSelectedBaseline?: boolean;
  input?: Record<string, unknown>;
  output?: { imageUrl?: string };
  createdAt?: Date;
};

function generation(input: TestGenerationInput): MiniAiTargetGeneration {
  return {
    _id: input._id,
    floorPlanId: input.floorPlanId,
    operatorId: input.operatorId || 'operator-a',
    status: input.status || 'succeeded',
    stageKey: input.stageKey || 'perspective_upgrade',
    nextRecommendedStage: input.nextRecommendedStage || 'base_render',
    isSelectedBaseline: Boolean(input.isSelectedBaseline),
    input: { style: 'test', ...(input.input || {}) },
    output: input.output || { imageUrl: `/api/ai/assets/${input._id}` },
    createdAt: input.createdAt || new Date('2026-07-20T00:00:00.000Z'),
  } as unknown as MiniAiTargetGeneration;
}

const kitchenTarget = {
  floorPlanId: 'plan-1',
  targetScope: 'single_room' as const,
  roomId: 'kitchen',
};

test('target identity validates whole-plan and single-room parameter combinations', () => {
  assert.deepEqual(normalizeMiniAiTargetIdentity({ floorPlanId: 'plan-1', roomId: 'kitchen' }), kitchenTarget);
  assert.equal(validateMiniAiTargetIdentity(kitchenTarget), '');
  assert.equal(validateMiniAiTargetIdentity({ floorPlanId: 'plan-1', targetScope: 'single_room' }), '单房间设计必须选择具体房间');
  assert.equal(validateMiniAiTargetIdentity({ floorPlanId: 'plan-1', targetScope: 'whole_floor_plan', roomId: 'kitchen' }), '完整户型设计不能同时指定房间');
});

test('generation matching separates kitchen, living room, whole plan, and legacy records', () => {
  const kitchen = generation({
    _id: 'kitchen',
    floorPlanId: 'plan-1',
    input: { roomData: { targetScope: 'single_room', roomId: 'kitchen' } },
  });
  const living = generation({
    _id: 'living',
    floorPlanId: 'plan-1',
    input: { roomData: { targetScope: 'single_room', roomId: 'living' } },
  });
  const whole = generation({
    _id: 'whole',
    floorPlanId: 'plan-1',
    input: { roomData: { targetScope: 'whole_floor_plan' } },
  });
  const legacy = generation({
    _id: 'legacy',
    floorPlanId: 'plan-1',
    input: { roomData: { summary: '旧厨房摘要' } },
  });

  assert.equal(generationMatchesMiniAiTarget(kitchen, kitchenTarget), true);
  assert.equal(generationMatchesMiniAiTarget(living, kitchenTarget), false);
  assert.equal(generationMatchesMiniAiTarget(whole, kitchenTarget), false);
  assert.equal(generationMatchesMiniAiTarget(legacy, kitchenTarget), false);
  assert.equal(generationMatchesMiniAiTarget(whole, { floorPlanId: 'plan-1', targetScope: 'whole_floor_plan' }), true);
});

test('current exact adopted result wins, otherwise the newest exact result is used', () => {
  const newestCandidate = generation({
    _id: 'newest',
    floorPlanId: 'plan-1',
    input: { roomData: kitchenTarget },
    createdAt: new Date('2026-07-22T00:00:00.000Z'),
  });
  const adopted = generation({
    _id: 'adopted',
    floorPlanId: 'plan-1',
    input: { roomData: kitchenTarget },
    createdAt: new Date('2026-07-21T00:00:00.000Z'),
  });
  const baselineMarker = generation({
    _id: 'marker',
    floorPlanId: 'plan-1',
    input: { roomData: kitchenTarget },
    isSelectedBaseline: true,
    createdAt: new Date('2026-07-23T00:00:00.000Z'),
  });

  const adoptedContext = resolveMiniAiTargetContext({
    generations: [newestCandidate, adopted, baselineMarker],
    target: kitchenTarget,
    operatorId: 'operator-a',
    selectedGenerationId: 'adopted',
  });
  assert.equal(String(adoptedContext.sourceTask?._id), 'adopted');
  assert.equal(adoptedContext.status, 'ready');
  assert.equal(adoptedContext.stageKey, 'base_render');
  assert.equal(adoptedContext.recommendedMiniMode, 'style_transform');

  const newestContext = resolveMiniAiTargetContext({
    generations: [adopted, newestCandidate],
    target: kitchenTarget,
    operatorId: 'operator-a',
  });
  assert.equal(String(newestContext.sourceTask?._id), 'newest');
});

test('results older than the floor-plan update are stale and never auto-continue', () => {
  const stale = generation({
    _id: 'stale',
    floorPlanId: 'plan-1',
    input: { roomData: kitchenTarget },
    createdAt: new Date('2026-07-20T00:00:00.000Z'),
  });
  const context = resolveMiniAiTargetContext({
    generations: [stale],
    target: kitchenTarget,
    operatorId: 'operator-a',
    planUpdatedAt: new Date('2026-07-21T00:00:00.000Z'),
  });

  assert.equal(context.status, 'stale');
  assert.equal(context.sourceTask, undefined);
  assert.equal(context.hasStaleResult, true);
});

test('active task details are exposed only to its operator while other staff see busy state', () => {
  const active = generation({
    _id: 'active',
    floorPlanId: 'plan-1',
    operatorId: 'operator-a',
    status: 'processing',
    output: {},
    input: { roomData: kitchenTarget },
  });
  const ownerContext = resolveMiniAiTargetContext({
    generations: [active], target: kitchenTarget, operatorId: 'operator-a',
  });
  assert.equal(ownerContext.status, 'processing');
  assert.equal(String(ownerContext.activeTask?._id), 'active');
  assert.equal(ownerContext.busyByOther, false);

  const coworkerContext = resolveMiniAiTargetContext({
    generations: [active], target: kitchenTarget, operatorId: 'operator-b',
  });
  assert.equal(coworkerContext.status, 'processing');
  assert.equal(coworkerContext.activeTask, undefined);
  assert.equal(coworkerContext.busyByOther, true);
});

test('active-task filters are scoped by workflow, stage, floor plan, scope, and room', () => {
  assert.deepEqual(buildMiniAiTargetGenerationFilter(kitchenTarget), {
    floorPlanId: 'plan-1',
    'input.roomData.targetScope': 'single_room',
    'input.roomData.roomId': 'kitchen',
  });
  assert.deepEqual(buildMiniAiTargetGenerationFilter({
    floorPlanId: 'plan-1', targetScope: 'whole_floor_plan',
  }), {
    floorPlanId: 'plan-1',
    'input.roomData.targetScope': 'whole_floor_plan',
    'input.roomData.roomId': { $exists: false },
  });
});
