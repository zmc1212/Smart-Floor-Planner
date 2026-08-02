import {
  AiStylePresetRepository,
  type AiStylePresetRecord,
  type NewAiStylePreset,
} from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import { parseOptionalPostgresId } from '@/db/postgres-dto';
import {
  AiPresetType,
  DEFAULT_AI_STYLE_PRESETS,
  DefaultAiStylePreset,
  PollinationsImageConfig,
} from './preset-definitions';
import type {
  AiWorkflowCategory,
  AiWorkflowSourceAssetRole,
  AiWorkflowStageKey,
} from './workflow-stages';

export interface SerializedAiStylePreset {
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
}

export async function ensureDefaultAiStylePresets(userId?: string) {
  const createdBy = parseOptionalPostgresId(userId, 'userId');
  const defaults: NewAiStylePreset[] = DEFAULT_AI_STYLE_PRESETS.map((preset) => ({
    key: preset.key,
    type: preset.type as AiPresetType,
    name: preset.name,
    description: preset.description,
    icon: preset.icon,
    previewClassName: preset.previewClassName,
    mockImageUrl: preset.mockImageUrl,
    promptTemplate: preset.promptTemplate,
    promptTemplateSecondStage: preset.promptTemplateSecondStage,
    negativePrompt: preset.negativePrompt,
    provider: preset.provider,
    image: preset.image as unknown as Record<string, unknown>,
    workflowCategory: preset.workflowCategory,
    workflowStage: preset.workflowStage,
    sourceAssetRole: preset.sourceAssetRole,
    nextRecommendedStage: preset.nextRecommendedStage,
    enabled: preset.enabled,
    sortOrder: preset.sortOrder,
    createdBy,
  }));
  await withPlatformTransaction((transaction) =>
    new AiStylePresetRepository(transaction).ensureDefaults(defaults)
  );
}

export function serializeAiStylePreset(
  preset: AiStylePresetRecord
): SerializedAiStylePreset {
  return {
    _id: String(preset.id),
    key: preset.key,
    type: preset.type as AiPresetType,
    name: preset.name,
    description: preset.description,
    icon: preset.icon,
    previewClassName: preset.previewClassName,
    mockImageUrl: preset.mockImageUrl ?? undefined,
    promptTemplate: preset.promptTemplate,
    promptTemplateSecondStage: preset.promptTemplateSecondStage ?? undefined,
    negativePrompt: preset.negativePrompt,
    provider: preset.provider ?? undefined,
    image: preset.image as unknown as PollinationsImageConfig,
    workflowCategory: preset.workflowCategory as AiWorkflowCategory | undefined,
    workflowStage: preset.workflowStage as AiWorkflowStageKey | undefined,
    sourceAssetRole: preset.sourceAssetRole as AiWorkflowSourceAssetRole | undefined,
    nextRecommendedStage: preset.nextRecommendedStage as AiWorkflowStageKey | undefined,
    enabled: preset.enabled,
    sortOrder: preset.sortOrder,
    createdAt: preset.createdAt?.toISOString(),
    updatedAt: preset.updatedAt?.toISOString(),
  };
}

export async function listAiStylePresets(type?: AiPresetType, includeDisabled = false) {
  const presets = await withPlatformTransaction((transaction) =>
    new AiStylePresetRepository(transaction).list({ type, includeDisabled })
  );
  return presets.map(serializeAiStylePreset);
}

export async function getAiStylePresetByKey(type: AiPresetType, key: string) {
  const preset = await withPlatformTransaction((transaction) =>
    new AiStylePresetRepository(transaction).findEnabledByTypeAndKey(type, key)
  );
  return preset ? serializeAiStylePreset(preset) : null;
}

export function getDefaultAiStylePresetByKey(type: AiPresetType, key: string): DefaultAiStylePreset | undefined {
  return DEFAULT_AI_STYLE_PRESETS.find((preset) => preset.type === type && preset.key === key);
}

interface PromptContext {
  roomName?: string;
  roomType?: string;
  width?: number;
  height?: number;
  roomData?: unknown;
}

function buildPlanSummary(roomData?: unknown) {
  if (!Array.isArray(roomData)) {
    return '';
  }

  const names = roomData
    .map((room) => (room && typeof room === 'object' && 'name' in room ? String((room as { name?: string }).name || '') : ''))
    .filter(Boolean);

  return names.length > 0 ? `Rooms included: ${names.join(', ')}.` : '';
}

export function buildPromptFromPreset(promptTemplate: string, context: PromptContext) {
  const widthMeters = context.width ? (context.width / 10).toFixed(2) : '';
  const heightMeters = context.height ? (context.height / 10).toFixed(2) : '';
  const extraParts = [
    context.roomName ? `Primary space: ${context.roomName}.` : '',
    context.roomType ? `Room type: ${context.roomType}.` : '',
    widthMeters && heightMeters ? `Approximate size: ${widthMeters}m x ${heightMeters}m.` : '',
    buildPlanSummary(context.roomData),
  ].filter(Boolean);

  return [promptTemplate.trim(), extraParts.join(' ')].filter(Boolean).join(' ').trim();
}
