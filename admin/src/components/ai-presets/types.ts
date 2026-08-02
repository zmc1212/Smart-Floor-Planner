import type { AiPresetType, PollinationsImageConfig } from '@/lib/ai/preset-definitions';
import type {
  AiWorkflowCategory,
  AiWorkflowSourceAssetRole,
  AiWorkflowStageKey,
} from '@/lib/ai/workflow-stages';

export type AiPreset = {
  _id: string;
  key: string;
  type: AiPresetType;
  name: string;
  description: string;
  icon: string;
  previewClassName: string;
  mockImageUrl?: string;
  promptTemplate: string;
  promptTemplateSecondStage?: string;
  negativePrompt: string;
  provider?: string;
  image: PollinationsImageConfig;
  workflowCategory?: AiWorkflowCategory;
  workflowStage?: AiWorkflowStageKey;
  sourceAssetRole?: AiWorkflowSourceAssetRole;
  nextRecommendedStage?: AiWorkflowStageKey;
  enabled: boolean;
  sortOrder: number;
  createdAt?: string;
  updatedAt?: string;
};

export const AI_PRESET_TYPE_OPTIONS = [
  { value: 'floor_plan_style', label: 'AI 室内平面' },
  { value: 'furnishing_style', label: 'AI 风格设计' },
  { value: 'scenario', label: 'AI 设计工作流' },
] as const;

export const AI_PRESET_TYPE_LABELS = Object.fromEntries(
  AI_PRESET_TYPE_OPTIONS.map((option) => [option.value, option.label]),
) as Record<AiPresetType, string>;

export function resolveLogicalModel(preset: AiPreset) {
  return preset.image.logicalModelKey
    || (preset.image.mode === 'generation' ? 'image.generate.standard' : 'image.edit.standard');
}
