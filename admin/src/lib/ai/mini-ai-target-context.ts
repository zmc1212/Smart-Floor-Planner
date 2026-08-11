import type { MiniAiTargetScope } from '@/lib/ai/mini-ai-floorplan';

export type MiniAiTargetIdentity = {
  floorPlanId?: string;
  targetScope?: MiniAiTargetScope;
  roomId?: string;
};

export type MiniAiTargetGeneration = {
  id: bigint;
  floorPlanId?: bigint | null;
  operatorId: bigint;
  status: string;
  stageKey?: string | null;
  nextRecommendedStage?: string | null;
  isSelectedBaseline?: boolean;
  input?: unknown;
  output?: unknown;
  createdAt: Date | string;
};

export type MiniAiTargetContextStatus =
  | 'missing'
  | 'processing'
  | 'ready'
  | 'stale'
  | 'admin_handoff';

function stringId(value: unknown) {
  return value === undefined || value === null ? '' : String(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function timestamp(value: Date | string) {
  const result = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(result) ? result : 0;
}

function roomDataFromGeneration(generation: MiniAiTargetGeneration) {
  return asRecord(asRecord(generation.input).roomData);
}

function hasOutputImage(generation: MiniAiTargetGeneration) {
  return typeof asRecord(generation.output).imageUrl === 'string'
    && Boolean(String(asRecord(generation.output).imageUrl).trim());
}

export function normalizeMiniAiTargetIdentity(
  input: MiniAiTargetIdentity
): MiniAiTargetIdentity {
  const floorPlanId = stringId(input.floorPlanId).trim();
  if (!floorPlanId) return {};

  const targetScope = input.targetScope
    || (input.roomId ? 'single_room' : 'whole_floor_plan');
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
  if (input.targetScope
    && !['whole_floor_plan', 'single_room'].includes(String(input.targetScope))) {
    return '不支持的户型设计范围';
  }
  const target = normalizeMiniAiTargetIdentity(input);
  if (!target.floorPlanId) {
    return input.targetScope || input.roomId ? '设计范围必须关联正式户型' : '';
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
  const roomData = roomDataFromGeneration(generation);
  const generationScope = stringId(roomData.targetScope);
  const generationRoomId = stringId(roomData.roomId);

  if (!target.floorPlanId) {
    return !generation.floorPlanId && !generationScope && !generationRoomId;
  }
  if (stringId(generation.floorPlanId) !== target.floorPlanId) return false;
  if (generationScope !== target.targetScope) return false;
  if (target.targetScope === 'single_room') {
    return generationRoomId === target.roomId;
  }
  return !generationRoomId;
}

export function miniModeForNextStage(stageKey?: string | null) {
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
    .sort((left, right) => timestamp(right.createdAt) - timestamp(left.createdAt));
  const active = exact.find((generation) => (
    ['created', 'pending', 'processing'].includes(generation.status)
  ));
  const currentSucceeded = exact.filter((generation) => (
    generation.status === 'succeeded'
    && hasOutputImage(generation)
    && (!input.planUpdatedAt || timestamp(generation.createdAt) >= timestamp(input.planUpdatedAt))
  ));
  const selectedTask = input.selectedGenerationId
    ? currentSucceeded.find((generation) => (
        stringId(generation.id) === stringId(input.selectedGenerationId)
      ))
    : undefined;
  const sourceTask = selectedTask
    || currentSucceeded.find((generation) => generation.isSelectedBaseline)
    || currentSucceeded[0];
  const hasStaleResult = exact.some((generation) => (
    generation.status === 'succeeded'
    && hasOutputImage(generation)
    && Boolean(input.planUpdatedAt)
    && timestamp(generation.createdAt) < timestamp(input.planUpdatedAt!)
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
    stageKey: sourceTask?.nextRecommendedStage
      || sourceTask?.stageKey
      || active?.stageKey
      || 'direction',
    recommendedMiniMode,
    hasStaleResult,
  };
}
