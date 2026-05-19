export type ChatAction =
  | {
      label: string;
      kind: 'prompt' | 'navigate';
      value: string;
      displayText?: string;
      hiddenContext?: string;
      variant?: 'primary' | 'secondary';
    }
  | {
      label: string;
      kind: 'confirm_tool';
      actionName:
        | 'run_workflow_stage'
        | 'select_generation_baseline'
        | 'refresh_workflow_detail'
        | 'create_workflow';
      arguments: Record<string, string>;
      needsUpload?: boolean;
      needsFloorPlanSelection?: boolean;
      confirmTitle: string;
      confirmDescription: string;
      variant?: 'primary' | 'secondary';
    };

export type ChatFloorPlanOption = {
  id: string;
  name?: string;
  createdAt?: string;
  status?: string;
};

export type ChatWorkflowDetail = {
  lead?: {
    name?: string;
    communityName?: string;
    status?: string;
  };
  progress?: {
    completedStageCount: number;
    availableStageCount: number;
    generationCount: number;
  };
  latestGeneration?: {
    stageLabel?: string;
    status?: string;
    createdAt?: string;
    imageUrl?: string;
  };
  recommendedNextAction?: {
    stageKey?: string;
    stageLabel?: string;
    reason?: string;
  };
  timeline?: Array<{
    id: string;
    stageLabel?: string;
    status?: string;
    isSelectedBaseline?: boolean;
    createdAt?: string;
    imageUrl?: string;
  }>;
  blockedReasons?: string[];
};

export type ChatCard =
  | {
      type: 'lead';
      id: string;
      title: string;
      subtitle?: string;
      meta?: string[];
      actions: ChatAction[];
    }
  | {
      type: 'workflow';
      id: string;
      title: string;
      subtitle?: string;
      meta?: string[];
      badge?: string;
      detail?: ChatWorkflowDetail;
      actions: ChatAction[];
    }
  | {
      type: 'workflow_empty';
      id: string;
      title: string;
      subtitle?: string;
      meta?: string[];
      floorPlans?: ChatFloorPlanOption[];
      actions: ChatAction[];
    };

export type ChatUiPayload = {
  cards?: ChatCard[];
  actions?: ChatAction[];
};

export function mergeChatUiPayload(
  ...payloads: Array<ChatUiPayload | undefined>
): ChatUiPayload | undefined {
  const cards = payloads.flatMap((payload) => payload?.cards || []);
  const actions = payloads.flatMap((payload) => payload?.actions || []);

  if (cards.length === 0 && actions.length === 0) {
    return undefined;
  }

  return {
    ...(cards.length > 0 ? { cards } : {}),
    ...(actions.length > 0 ? { actions } : {}),
  };
}
