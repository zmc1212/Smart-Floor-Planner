import { getWorkflowStageDefinition } from './workflow-stages';

type GenerationLike = {
  _id: unknown;
  leadId?: unknown;
  workflowId?: unknown;
  parentGenerationId?: unknown;
  type: string;
  stageKey?: string;
  sourceAssetRole?: string;
  isSelectedBaseline?: boolean;
  nextRecommendedStage?: string;
  status: string;
  input?: unknown;
  output?: unknown;
  errorMessage?: string;
  provider?: string;
  durationMs?: number;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type WorkflowLike = {
  _id: unknown;
  leadId?: unknown;
  title: string;
  workflowLabel?: string;
  isPrimary?: boolean;
  status: string;
  sourceImage?: string;
  sourceFloorPlanId?: unknown;
  sourceAssetRole?: string;
  currentStageKey?: string;
  selectedGenerationId?: unknown;
  lastGenerationId?: unknown;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export function serializeAiGeneration(generation: GenerationLike) {
  const stageDefinition = getWorkflowStageDefinition(String(generation.stageKey || ''));

  return {
    id: String(generation._id),
    leadId: generation.leadId ? String(generation.leadId) : undefined,
    workflowId: generation.workflowId ? String(generation.workflowId) : undefined,
    parentGenerationId: generation.parentGenerationId
      ? String(generation.parentGenerationId)
      : undefined,
    type: generation.type,
    stageKey: generation.stageKey,
    stageLabel: stageDefinition?.name,
    sourceAssetRole: generation.sourceAssetRole,
    isSelectedBaseline: Boolean(generation.isSelectedBaseline),
    nextRecommendedStage: generation.nextRecommendedStage,
    status: generation.status,
    input: generation.input,
    output: generation.output,
    errorMessage: generation.errorMessage,
    provider: generation.provider,
    durationMs: generation.durationMs,
    createdAt:
      generation.createdAt instanceof Date
        ? generation.createdAt.toISOString()
        : String(generation.createdAt),
    updatedAt:
      generation.updatedAt instanceof Date
        ? generation.updatedAt.toISOString()
        : String(generation.updatedAt),
  };
}

export function serializeAiWorkflow(workflow: WorkflowLike) {
  const stageDefinition = getWorkflowStageDefinition(String(workflow.currentStageKey || ''));

  return {
    id: String(workflow._id),
    leadId: workflow.leadId ? String(workflow.leadId) : undefined,
    title: workflow.title,
    workflowLabel: workflow.workflowLabel,
    isPrimary: Boolean(workflow.isPrimary),
    status: workflow.status,
    sourceImage: workflow.sourceImage,
    sourceFloorPlanId: workflow.sourceFloorPlanId ? String(workflow.sourceFloorPlanId) : undefined,
    sourceAssetRole: workflow.sourceAssetRole,
    currentStageKey: workflow.currentStageKey,
    currentStageLabel: stageDefinition?.name,
    selectedGenerationId: workflow.selectedGenerationId
      ? String(workflow.selectedGenerationId)
      : undefined,
    lastGenerationId: workflow.lastGenerationId ? String(workflow.lastGenerationId) : undefined,
    createdAt:
      workflow.createdAt instanceof Date
        ? workflow.createdAt.toISOString()
        : String(workflow.createdAt),
    updatedAt:
      workflow.updatedAt instanceof Date
        ? workflow.updatedAt.toISOString()
        : String(workflow.updatedAt),
  };
}
