import type { IAiGeneration } from '@/models/AiGeneration';
import type { MiniAiTargetScope } from '@/lib/ai/mini-ai-floorplan';

export type MiniAiTargetIdentity = {
  floorPlanId?: string;
  targetScope?: MiniAiTargetScope;
  roomId?: string;
};

export type MiniAiTargetGeneration = Pick<
  IAiGeneration,
  | '_id'
  | 'floorPlanId'
  | 'operatorId'
  | 'status'
  | 'stageKey'
  | 'nextRecommendedStage'
  | 'isSelectedBaseline'
  | 'input'
  | 'output'
  | 'createdAt'
>;

export type MiniAiTargetContextStatus = 'missing' | 'processing' | 'ready' | 'stale' | 'admin_handoff';

function stringId(value: unknown) {
  return value ? String(value) : '';
}

function createdTime(generation: MiniAiTargetGeneration) {
  return new Date(generation.createdAt).getTime();
}

function roomDataFromGeneration(generation: MiniAiTargetGeneration) {
  const roomData = generation.input?.roomData;
  return roomData && typeof roomData === 'object' && !Array.isArray(roomData)
    ? roomData as { targetScope?: MiniAiTargetScope; roomId?: string }
    : undefined;
}

export function normalizeMiniAiTargetIdentity(input: MiniAiTargetIdentity): MiniAiTargetIdentity {
  const floorPlanId = stringId(input.floorPlanId).trim();
  if (!floorPlanId) return {};

  const targetScope = input.targetScope || (input.roomId ? 'single_room' : 'whole_floor_plan');
  if (targetScope === 'single_room') {
    return {
      floorPlanId,
      targetScope,
      roomId: stringId(input.roomId).trim(),
    };
  }
  return { floorPlanId, targetScope: 'whole_floor_plan' };
}

export function validateMiniAiTargetIdentity(input: MiniAiTargetIdentity) {
  if (input.targetScope && !['whole_floor_plan', 'single_room'].includes(String(input.targetScope))) {
    return '不支持的户型设计范围';
  }
  const target = normalizeMiniAiTargetIdentity(input);
  if (!target.floorPlanId) {
    if (input.targetScope || input.roomId) return '设计范围必须关联正式户型';
    return '';
  }
  if (target.targetScope === 'single_room' && !target.roomId) {
    return '单房间设计必须选择具体房间';
  }
  if (target.targetScope === 'whole_floor_plan' && input.roomId) {
    return '完整户型设计不能同时指定房间';
  }
  return '';
}

export function generationMatchesMiniAiTarget(
  generation: MiniAiTargetGeneration,
  input: MiniAiTargetIdentity
) {
  const target = normalizeMiniAiTargetIdentity(input);
  const generationFloorPlanId = stringId(generation.floorPlanId);
  const roomData = roomDataFromGeneration(generation);

  if (!target.floorPlanId) {
    return !generationFloorPlanId && !roomData?.targetScope && !roomData?.roomId;
  }
  if (generationFloorPlanId !== target.floorPlanId) return false;
  if (!roomData?.targetScope) return false;
  if (roomData.targetScope !== target.targetScope) return false;
  if (target.targetScope === 'single_room') return stringId(roomData.roomId) === target.roomId;
  return !roomData.roomId;
}

export function buildMiniAiTargetGenerationFilter(input: MiniAiTargetIdentity) {
  const target = normalizeMiniAiTargetIdentity(input);
  if (!target.floorPlanId) {
    return {
      floorPlanId: { $exists: false },
      'input.roomData.targetScope': { $exists: false },
      'input.roomData.roomId': { $exists: false },
    };
  }
  if (target.targetScope === 'single_room') {
    return {
      floorPlanId: target.floorPlanId,
      'input.roomData.targetScope': 'single_room',
      'input.roomData.roomId': target.roomId,
    };
  }
  return {
    floorPlanId: target.floorPlanId,
    'input.roomData.targetScope': 'whole_floor_plan',
    'input.roomData.roomId': { $exists: false },
  };
}

export function isMiniAiGenerationCurrent(
  generation: MiniAiTargetGeneration,
  planUpdatedAt?: Date | string
) {
  if (!planUpdatedAt) return true;
  return new Date(generation.createdAt).getTime() >= new Date(planUpdatedAt).getTime();
}

export function miniModeForNextStage(stageKey?: string) {
  if (stageKey === 'base_render') return 'style_transform';
  if (stageKey === 'soft_furnishing') return 'soft_furnishing';
  return undefined;
}

export function resolveMiniAiTargetContext<T extends MiniAiTargetGeneration>(input: {
  generations: T[];
  target: MiniAiTargetIdentity;
  operatorId: string;
  selectedGenerationId?: string;
  planUpdatedAt?: Date | string;
}) {
  const exact = input.generations
    .filter((generation) => generationMatchesMiniAiTarget(generation, input.target))
    .sort((left, right) => createdTime(right) - createdTime(left));
  const active = exact.find((generation) => (
    ['created', 'pending', 'processing'].includes(generation.status)
  ));
  const currentSucceeded = exact.filter((generation) => (
    generation.status === 'succeeded'
    && Boolean(generation.output?.imageUrl)
    && isMiniAiGenerationCurrent(generation, input.planUpdatedAt)
  ));
  const selectedTask = input.selectedGenerationId
    ? currentSucceeded.find((generation) => (
        stringId(generation._id) === stringId(input.selectedGenerationId)
      ))
    : undefined;
  const sourceTask = selectedTask
    || currentSucceeded.find((generation) => generation.isSelectedBaseline)
    || currentSucceeded[0];
  const hasStaleResult = exact.some((generation) => (
    generation.status === 'succeeded'
    && Boolean(generation.output?.imageUrl)
    && !isMiniAiGenerationCurrent(generation, input.planUpdatedAt)
  ));
  const activeOwnedByCurrentOperator = active
    && stringId(active.operatorId) === stringId(input.operatorId)
    ? active
    : undefined;
  const recommendedMiniMode = miniModeForNextStage(sourceTask?.nextRecommendedStage);
  let status: MiniAiTargetContextStatus = 'missing';
  if (active) status = 'processing';
  else if (sourceTask && recommendedMiniMode) status = 'ready';
  else if (sourceTask) status = 'admin_handoff';
  else if (hasStaleResult) status = 'stale';

  return {
    status,
    sourceTask,
    activeTask: activeOwnedByCurrentOperator,
    busyByOther: Boolean(active && !activeOwnedByCurrentOperator),
    stageKey: sourceTask?.nextRecommendedStage || sourceTask?.stageKey || active?.stageKey || 'direction',
    recommendedMiniMode,
    hasStaleResult,
  };
}
