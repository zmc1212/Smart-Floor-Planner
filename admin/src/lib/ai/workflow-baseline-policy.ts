import type { AiWorkflowStageKey } from '@/lib/ai/workflow-stages';

const BASELINE_STAGES = new Set<AiWorkflowStageKey>(['base_render', 'soft_furnishing']);

export type WorkflowBaselineDecision = {
  selectGeneration: boolean;
  advanceWorkflow: boolean;
};

export function decideWorkflowBaselineUpdate(input: {
  stageKey?: AiWorkflowStageKey;
  hasEarlierStageSuccess: boolean;
}): WorkflowBaselineDecision {
  if (!input.stageKey || !BASELINE_STAGES.has(input.stageKey)) {
    return { selectGeneration: false, advanceWorkflow: true };
  }
  if (!input.hasEarlierStageSuccess) {
    return { selectGeneration: true, advanceWorkflow: true };
  }
  return { selectGeneration: false, advanceWorkflow: false };
}
