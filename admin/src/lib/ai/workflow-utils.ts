import { getWorkflowStageDefinition } from './workflow-stages';

type GenerationLike = {
  _id: unknown;
  leadId?: unknown;
  workflowId?: unknown;
  parentGenerationId?: unknown;
  type: string;
  channel?: string | null;
  stageKey?: string | null;
  sourceAssetRole?: string | null;
  isSelectedBaseline?: boolean;
  nextRecommendedStage?: string | null;
  status: string;
  published?: boolean | null;
  publicationId?: unknown;
  input?: unknown;
  output?: unknown;
  errorMessage?: string | null;
  provider?: string | null;
  durationMs?: number | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type WorkflowLike = {
  _id: unknown;
  leadId?: unknown;
  title: string;
  workflowLabel?: string | null;
  isPrimary?: boolean;
  status: string;
  sourceImage?: string | null;
  sourceFloorPlanId?: unknown;
  sourceAssetRole?: string | null;
  currentStageKey?: string | null;
  selectedGenerationId?: unknown;
  lastGenerationId?: unknown;
  createdAt: Date | string;
  updatedAt: Date | string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function getGenerationImageUrl(
  generation: {
    status?: unknown;
    imageUrl?: unknown;
    resultImageUrl?: unknown;
    output?: unknown;
  } | null | undefined,
  options?: { requireSucceeded?: boolean },
): string | undefined {
  if (!generation) return undefined;
  if (options?.requireSucceeded && generation.status && generation.status !== 'succeeded') {
    return undefined;
  }
  const candidates = [
    generation.imageUrl,
    generation.resultImageUrl,
    isRecord(generation.output) ? generation.output.imageUrl : undefined,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return undefined;
}

function sanitizeGenerationOutput(generationId: string, output: unknown) {
  if (!isRecord(output)) {
    return output;
  }

  const imageUrl = typeof output.imageUrl === 'string' ? output.imageUrl : undefined;
  return {
    ...output,
    ...(imageUrl?.startsWith('data:image')
      ? { imageUrl: `/api/ai/generations/${generationId}/image` }
      : {}),
  };
}

function sanitizeGenerationInput(input: unknown) {
  if (!isRecord(input)) {
    return input;
  }

  return {
    ...input,
    ...(typeof input.sourceImage === 'string' && input.sourceImage.startsWith('data:image')
      ? { sourceImage: 'data-uri' }
      : {}),
    ...(typeof input.styleReferenceImage === 'string' && input.styleReferenceImage.startsWith('data:image')
      ? { styleReferenceImage: 'data-uri' }
      : {}),
  };
}

export function serializeAiGeneration(generation: GenerationLike) {
  const stageDefinition = getWorkflowStageDefinition(String(generation.stageKey || ''));
  const id = String(generation._id);

  return {
    id,
    leadId: generation.leadId ? String(generation.leadId) : undefined,
    workflowId: generation.workflowId ? String(generation.workflowId) : undefined,
    parentGenerationId: generation.parentGenerationId
      ? String(generation.parentGenerationId)
      : undefined,
    type: generation.type,
    channel: generation.channel || 'admin',
    hasCustomerContext: Boolean(generation.leadId),
    syncedToWorkflow: Boolean(generation.workflowId),
    stageKey: generation.stageKey,
    stageLabel: stageDefinition?.name,
    sourceAssetRole: generation.sourceAssetRole,
    isSelectedBaseline: Boolean(generation.isSelectedBaseline),
    selectionStatus: generation.isSelectedBaseline
      ? 'selected'
      : generation.status === 'succeeded' && ['base_render', 'soft_furnishing'].includes(String(generation.stageKey || ''))
        ? 'candidate'
        : 'not_applicable',
    nextRecommendedStage: generation.nextRecommendedStage,
    recommendedAction: generation.nextRecommendedStage,
    status: generation.status,
    input: sanitizeGenerationInput(generation.input),
    output: sanitizeGenerationOutput(id, generation.output),
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
    published: generation.published === undefined ? undefined : Boolean(generation.published),
  };
}

export function serializeAiWorkflow(workflow: WorkflowLike) {
  const stageDefinition = getWorkflowStageDefinition(String(workflow.currentStageKey || ''));
  const id = String(workflow._id);

  return {
    id,
    leadId: workflow.leadId ? String(workflow.leadId) : undefined,
    title: workflow.title,
    workflowLabel: workflow.workflowLabel,
    isPrimary: Boolean(workflow.isPrimary),
    status: workflow.status,
    sourceImage:
      typeof workflow.sourceImage === 'string' && workflow.sourceImage.startsWith('data:image')
        ? `/api/ai/workflows/${id}/source-image`
        : workflow.sourceImage,
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
