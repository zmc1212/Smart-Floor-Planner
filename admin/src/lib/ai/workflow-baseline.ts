import { AiGeneration, type IAiGeneration } from '@/models/AiGeneration';
import { AiWorkflow, type IAiWorkflow } from '@/models/AiWorkflow';
import { getNextWorkflowStage } from '@/lib/ai/workflow-stages';
import { decideWorkflowBaselineUpdate } from '@/lib/ai/workflow-baseline-policy';

export async function applySuccessfulGenerationToWorkflow(
  workflow: IAiWorkflow,
  generation: IAiGeneration
) {
  workflow.lastGenerationId = generation._id;

  const isBaselineStage = generation.stageKey === 'base_render' || generation.stageKey === 'soft_furnishing';
  if (!isBaselineStage) {
    workflow.currentStageKey =
      generation.nextRecommendedStage || getNextWorkflowStage(generation.stageKey) || workflow.currentStageKey;
    await workflow.save();
    return { selected: false, advanced: true };
  }

  const earlierStageSuccess = await AiGeneration.exists({
    workflowId: workflow._id,
    stageKey: generation.stageKey,
    status: 'succeeded',
    _id: { $ne: generation._id },
  });
  const decision = decideWorkflowBaselineUpdate({
    stageKey: generation.stageKey,
    hasEarlierStageSuccess: Boolean(earlierStageSuccess),
  });

  if (decision.selectGeneration) {
    await AiGeneration.updateMany(
      { workflowId: workflow._id, isSelectedBaseline: true, _id: { $ne: generation._id } },
      { $set: { isSelectedBaseline: false } }
    );
    generation.isSelectedBaseline = true;
    await generation.save();
    workflow.selectedGenerationId = generation._id;
    workflow.currentStageKey =
      generation.nextRecommendedStage || getNextWorkflowStage(generation.stageKey) || workflow.currentStageKey;
    await workflow.save();
    return { selected: true, advanced: true };
  }

  generation.isSelectedBaseline = false;
  await generation.save();
  await workflow.save();
  return { selected: false, advanced: false };
}

export async function syncSuccessfulGenerationToWorkflow(generation: IAiGeneration) {
  if (generation.status !== 'succeeded' || !generation.workflowId) return { selected: false, advanced: false };
  const workflow = await AiWorkflow.findOne({
    _id: generation.workflowId,
    enterpriseId: generation.enterpriseId,
  });
  if (!workflow) return { selected: false, advanced: false };
  if (String(workflow.lastGenerationId || '') === String(generation._id)) {
    return { selected: Boolean(generation.isSelectedBaseline), advanced: false };
  }
  if (workflow.lastGenerationId) {
    const currentLast = await AiGeneration.findById(workflow.lastGenerationId).select('createdAt').lean();
    if (currentLast?.createdAt && new Date(currentLast.createdAt).getTime() >= new Date(generation.createdAt).getTime()) {
      return { selected: false, advanced: false };
    }
  }
  return applySuccessfulGenerationToWorkflow(workflow, generation);
}
