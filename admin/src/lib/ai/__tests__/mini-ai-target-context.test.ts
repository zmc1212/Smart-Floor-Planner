import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generationMatchesMiniAiTarget,
  resolveMiniAiTargetContext,
  validateMiniAiTargetIdentity,
} from '@/lib/ai/mini-ai-target-context';

function generation(overrides: Partial<{
  id: bigint;
  floorPlanId: bigint;
  operatorId: bigint;
  status: string;
  stageKey: string;
  nextRecommendedStage: string;
  isSelectedBaseline: boolean;
  roomData: Record<string, unknown>;
  output: Record<string, unknown>;
  createdAt: Date;
}> = {}) {
  return {
    id: overrides.id || BigInt(1),
    floorPlanId: overrides.floorPlanId || BigInt(157),
    operatorId: overrides.operatorId || BigInt(276),
    status: overrides.status || 'succeeded',
    stageKey: overrides.stageKey || 'perspective_upgrade',
    nextRecommendedStage: overrides.nextRecommendedStage || 'base_render',
    isSelectedBaseline: overrides.isSelectedBaseline || false,
    input: {
      roomData: overrides.roomData || { targetScope: 'whole_floor_plan' },
    },
    output: overrides.output || { imageUrl: 'https://example.com/result.png' },
    createdAt: overrides.createdAt || new Date('2026-08-10T11:00:00.000Z'),
  };
}

test('target validation rejects incomplete or contradictory room scopes', () => {
  assert.equal(
    validateMiniAiTargetIdentity({ floorPlanId: '157', targetScope: 'single_room' }),
    '单房间设计必须选择具体房间'
  );
  assert.equal(
    validateMiniAiTargetIdentity({ floorPlanId: '157', targetScope: 'whole_floor_plan', roomId: 'living' }),
    '完整户型设计不能同时指定房间'
  );
});

test('target matching never reuses whole-plan or legacy tasks for a room', () => {
  const roomTarget = { floorPlanId: '157', targetScope: 'single_room' as const, roomId: 'living' };
  assert.equal(generationMatchesMiniAiTarget(generation(), roomTarget), false);
  assert.equal(generationMatchesMiniAiTarget(generation({
    roomData: { targetScope: 'single_room', roomId: 'kitchen' },
  }), roomTarget), false);
  assert.equal(generationMatchesMiniAiTarget(generation({
    roomData: { targetScope: 'single_room', roomId: 'living' },
  }), roomTarget), true);
});

test('target context selects the exact current baseline and hides another operator task', () => {
  const selected = generation({ id: BigInt(846), isSelectedBaseline: true });
  const otherOperatorActive = generation({
    id: BigInt(847),
    operatorId: BigInt(999),
    status: 'processing',
    output: {},
    createdAt: new Date('2026-08-10T12:00:00.000Z'),
  });
  const context = resolveMiniAiTargetContext({
    generations: [otherOperatorActive, selected],
    target: { floorPlanId: '157', targetScope: 'whole_floor_plan' },
    operatorId: '276',
    selectedGenerationId: '846',
    planUpdatedAt: '2026-08-10T10:00:00.000Z',
  });

  assert.equal(context.status, 'processing');
  assert.equal(context.sourceTask?.id, BigInt(846));
  assert.equal(context.activeTask, undefined);
  assert.equal(context.busyByOther, true);
  assert.equal(context.recommendedMiniMode, 'style_transform');
});

test('target context marks results older than the formal plan as stale', () => {
  const context = resolveMiniAiTargetContext({
    generations: [generation({ createdAt: new Date('2026-08-10T09:00:00.000Z') })],
    target: { floorPlanId: '157', targetScope: 'whole_floor_plan' },
    operatorId: '276',
    planUpdatedAt: '2026-08-10T10:00:00.000Z',
  });

  assert.equal(context.status, 'stale');
  assert.equal(context.sourceTask, undefined);
  assert.equal(context.hasStaleResult, true);
});
