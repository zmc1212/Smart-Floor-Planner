import { getWorkflowFloorPlanEligibility } from '@/lib/ai/workflow-floorplan';

export type MiniAiProjectUiState =
  | 'generating'
  | 'continue'
  | 'retry'
  | 'stale'
  | 'ready'
  | 'needs_survey';

export type MiniAiProjectGroupKey = 'in_progress' | 'ready' | 'needs_survey';

type ProjectPlan = {
  status?: unknown;
  layoutData?: unknown;
  updatedAt: Date | string;
};

type ProjectWorkflow = {
  id: bigint;
  selectedGenerationId?: bigint | null;
};

type ProjectGeneration = {
  id: bigint;
  status: string;
  isSelectedBaseline?: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
};

const ACTIVE_GENERATION_STATUSES = new Set(['pending', 'created', 'processing']);

function timestamp(value: Date | string) {
  const result = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(result) ? result : 0;
}

export function deriveMiniAiProjectState<TGeneration extends ProjectGeneration = ProjectGeneration>(input: {
  plan: ProjectPlan;
  activeWorkflow?: ProjectWorkflow | null;
  generations?: TGeneration[];
}) {
  const eligibility = getWorkflowFloorPlanEligibility(input.plan);
  const generations = [...(input.generations || [])]
    .sort((left, right) => timestamp(right.createdAt) - timestamp(left.createdAt));
  const latestGeneration = generations[0];
  const activeGeneration = generations.find((item) => ACTIVE_GENERATION_STATUSES.has(item.status));
  const selectedBaseline = input.activeWorkflow?.selectedGenerationId
    ? generations.find((item) => item.id === input.activeWorkflow?.selectedGenerationId)
    : generations.find((item) => item.isSelectedBaseline);
  const latestSucceeded = generations.find((item) => item.status === 'succeeded');
  const baseline = selectedBaseline || latestSucceeded;

  let uiState: MiniAiProjectUiState;
  let groupKey: MiniAiProjectGroupKey;
  if (input.activeWorkflow) {
    groupKey = 'in_progress';
    if (activeGeneration) uiState = 'generating';
    else if (latestGeneration?.status === 'failed') uiState = 'retry';
    else if (baseline && timestamp(input.plan.updatedAt) > timestamp(baseline.createdAt)) uiState = 'stale';
    else uiState = 'continue';
  } else if (eligibility.eligible) {
    groupKey = 'ready';
    uiState = 'ready';
  } else {
    groupKey = 'needs_survey';
    uiState = 'needs_survey';
  }

  return {
    eligibility,
    groupKey,
    uiState,
    latestGeneration,
    activeGeneration,
    baselineGeneration: baseline,
  };
}
