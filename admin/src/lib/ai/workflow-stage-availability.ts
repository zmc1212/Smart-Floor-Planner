import {
  ADVANCED_WORKFLOW_TOOLS,
  MAIN_WORKFLOW_STAGES,
  type AiWorkflowSourceAssetRole,
  type AiWorkflowStageKey,
} from '@/lib/ai/workflow-stages';

export type WorkflowStageState = {
  sourceImage?: unknown;
  sourceFloorPlanId?: unknown;
  selectedGenerationId?: unknown;
  currentStageKey?: unknown;
};

export type WorkflowStageGeneration = {
  stageKey?: AiWorkflowStageKey;
  isSelectedBaseline?: boolean;
  _id?: unknown;
};

function getLatestGenerationForStage(
  generations: WorkflowStageGeneration[],
  stageKey: AiWorkflowStageKey
) {
  return generations.find((generation) => generation.stageKey === stageKey);
}

function resolveParentGenerationIdFromGenerations(
  stageKey: AiWorkflowStageKey | undefined,
  workflow: Pick<WorkflowStageState, 'selectedGenerationId'>,
  generations: WorkflowStageGeneration[]
) {
  if (!stageKey) return undefined;
  if (stageKey === 'direction' || stageKey === 'premium_board' || stageKey === 'perspective_upgrade') {
    return undefined;
  }

  const selectedBaseline =
    generations.find((generation) => generation.isSelectedBaseline) ||
    (workflow.selectedGenerationId
      ? generations.find((generation) => String(generation._id) === String(workflow.selectedGenerationId))
      : undefined);

  if (stageKey === 'base_render') {
    return getLatestGenerationForStage(generations, 'direction')?._id;
  }

  if (stageKey === 'soft_furnishing') {
    return selectedBaseline?._id || getLatestGenerationForStage(generations, 'base_render')?._id;
  }

  return (
    selectedBaseline?._id ||
    getLatestGenerationForStage(generations, 'soft_furnishing')?._id ||
    getLatestGenerationForStage(generations, 'base_render')?._id
  );
}

export function canRunStageFromState(input: {
  stageKey?: AiWorkflowStageKey;
  sourceAssetRole?: AiWorkflowSourceAssetRole;
  workflow: Pick<WorkflowStageState, 'sourceImage' | 'sourceFloorPlanId' | 'selectedGenerationId'>;
  generations: WorkflowStageGeneration[];
}) {
  const { stageKey, sourceAssetRole, workflow, generations } = input;

  if (!stageKey) return { available: false, reason: '缺少阶段标识' };

  if (stageKey === 'direction' || stageKey === 'base_render') {
    return workflow.sourceImage || workflow.sourceFloorPlanId
      ? { available: true }
      : { available: false, reason: '需要先提供起点素材或户型图' };
  }

  if (stageKey === 'premium_board') {
    return (workflow.sourceImage || workflow.sourceFloorPlanId) && sourceAssetRole === 'concept_element'
      ? { available: true }
      : { available: false, reason: '高端提案工具需要概念元素图作为起点素材' };
  }

  if (stageKey === 'perspective_upgrade') {
    return workflow.sourceImage || workflow.sourceFloorPlanId
      ? { available: true }
      : { available: false, reason: '彩平转透视需要先提供户型图或彩平素材' };
  }

  const parentGenerationId = resolveParentGenerationIdFromGenerations(stageKey, workflow, generations);
  return parentGenerationId
    ? { available: true, parentGenerationId: String(parentGenerationId) }
    : { available: false, reason: '当前步骤缺少上一阶段产物，请先完成前一阶段或设为当前定稿' };
}

export function getAiWorkflowStageAvailabilityFromDocs(
  workflow: WorkflowStageState,
  generations: WorkflowStageGeneration[]
) {
  const stages = [...MAIN_WORKFLOW_STAGES, ...ADVANCED_WORKFLOW_TOOLS];
  const completedStages = Array.from(
    new Set(generations.filter((generation) => generation.stageKey).map((generation) => generation.stageKey as string))
  );

  const stageStates = stages.map((stage) => {
    const result = canRunStageFromState({
      stageKey: stage.key,
      sourceAssetRole: stage.key === 'premium_board' ? 'concept_element' : undefined,
      workflow,
      generations,
    });
    return {
      key: stage.key,
      name: stage.name,
      available: result.available,
      reason: result.reason,
      parentGenerationId: result.parentGenerationId,
    };
  });

  const recommendedStage =
    stageStates.find((stage) => stage.key === workflow.currentStageKey && stage.available) ||
    stageStates.find((stage) => stage.available && !completedStages.includes(stage.key));

  return {
    completedStages,
    availableStages: stageStates.filter((stage) => stage.available).map((stage) => stage.key),
    blockedStages: stageStates.filter((stage) => !stage.available),
    recommendedNextAction: recommendedStage
      ? {
          stageKey: recommendedStage.key,
          stageLabel: recommendedStage.name,
          reason:
            recommendedStage.key === workflow.currentStageKey
              ? '这是当前方案会话推荐推进的阶段'
              : '这是当前素材条件下可执行的下一步',
        }
      : undefined,
  };
}
