import { AiStylePreset, IAiStylePreset } from '@/models/AiStylePreset';
import {
  AiPresetType,
  DEFAULT_AI_STYLE_PRESETS,
  DefaultAiStylePreset,
  TensorProviderConfig,
} from './preset-definitions';

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
  negativePrompt: string;
  provider: 'tensor';
  tensor: TensorProviderConfig;
  enabled: boolean;
  sortOrder: number;
  createdAt?: string;
  updatedAt?: string;
}

export async function ensureDefaultAiStylePresets(userId?: string) {
  await Promise.all(
    DEFAULT_AI_STYLE_PRESETS.map((preset) =>
      AiStylePreset.updateOne(
        { type: preset.type, key: preset.key },
        {
          $setOnInsert: {
            ...preset,
            createdBy: userId,
            updatedBy: userId,
          },
        },
        { upsert: true }
      )
    )
  );
}

export function serializeAiStylePreset(
  preset: Pick<
    IAiStylePreset,
    | '_id'
    | 'key'
    | 'type'
    | 'name'
    | 'description'
    | 'icon'
    | 'previewClassName'
    | 'mockImageUrl'
    | 'promptTemplate'
    | 'negativePrompt'
    | 'provider'
    | 'tensor'
    | 'enabled'
    | 'sortOrder'
    | 'createdAt'
    | 'updatedAt'
  >
): SerializedAiStylePreset {
  return {
    _id: String(preset._id),
    key: preset.key,
    type: preset.type,
    name: preset.name,
    description: preset.description,
    icon: preset.icon,
    previewClassName: preset.previewClassName,
    mockImageUrl: preset.mockImageUrl,
    promptTemplate: preset.promptTemplate,
    negativePrompt: preset.negativePrompt,
    provider: preset.provider,
    tensor: preset.tensor,
    enabled: preset.enabled,
    sortOrder: preset.sortOrder,
    createdAt: preset.createdAt?.toISOString(),
    updatedAt: preset.updatedAt?.toISOString(),
  };
}

export async function listAiStylePresets(type?: AiPresetType, includeDisabled = false) {
  const query: Record<string, unknown> = {};
  if (type) query.type = type;
  if (!includeDisabled) query.enabled = true;

  const presets = await AiStylePreset.find(query).sort({ sortOrder: 1, createdAt: 1 });
  return presets.map(serializeAiStylePreset);
}

export async function getAiStylePresetByKey(type: AiPresetType, key: string) {
  return AiStylePreset.findOne({ type, key, enabled: true });
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
