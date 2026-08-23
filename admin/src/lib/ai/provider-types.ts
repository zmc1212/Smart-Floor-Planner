export const AI_CAPABILITIES = ['chat', 'vision', 'image.generate', 'image.edit'] as const;
export type AiCapability = (typeof AI_CAPABILITIES)[number];

export const LOGICAL_MODEL_KEYS = [
  'chat.general',
  'vision.reference_analysis',
  'image.generate.standard',
  'image.edit.standard',
] as const;
export type AiLogicalModelKey = (typeof LOGICAL_MODEL_KEYS)[number];

export const AI_ACTION_KEYS = [
  'image.free_create',
  'image.reference_recreate',
  'image.style_transform',
  'image.floor_plan_style',
  'image.furnishing_render',
  'image.soft_furnishing_render',
  'image.scenario',
  'text.design_advice',
] as const;
export type AiActionKey = (typeof AI_ACTION_KEYS)[number];

export function isPlatformAiActionKey(value: string): value is AiActionKey {
  return (AI_ACTION_KEYS as readonly string[]).includes(value);
}

export type AiProviderAdapterType = 'grs' | 'apinebula' | 'pollinations' | 'openai_compatible';
export type AiProviderAttemptStatus =
  | 'created'
  | 'submitted'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'unknown';

export type AiChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content:
    | string
    | Array<{
        type: 'text' | 'image_url';
        text?: string;
        image_url?: { url: string; detail?: 'low' | 'high' | 'auto' };
      }>;
};

export type AiProviderRuntimeConfig = {
  id: string;
  key: string;
  name: string;
  adapterType: AiProviderAdapterType;
  baseUrl: string;
  apiKey: string;
  adapterConfig?: Record<string, string | number | boolean>;
  capabilities: AiCapability[];
  modelMappings: Partial<Record<AiLogicalModelKey, string>>;
  timeoutMs: number;
  costRules?: Array<{
    logicalModelKey: AiLogicalModelKey;
    remoteModel?: string;
    resolutionTier?: string;
    currency: string;
    estimatedMicros: number;
  }>;
};

export type AiImageSubmitInput = {
  model: string;
  prompt: string;
  negativePrompt?: string;
  size?: string;
  aspectRatio?: string;
  quality?: string;
  resolutionTier?: string;
  width?: number;
  height?: number;
  images?: string[];
  user?: string;
};

export type AiImageProviderResult =
  | { status: 'succeeded'; image: string; remoteTaskId?: string; remoteStatus?: string }
  | { status: 'processing'; remoteTaskId: string; remoteStatus?: string; nextPollMs?: number }
  | { status: 'failed'; remoteTaskId?: string; remoteStatus?: string; error: string; refunded?: boolean }
  | { status: 'unknown'; remoteTaskId?: string; remoteStatus?: string; error: string };

export type AiProviderBalanceResult = {
  balance: number;
  unit: string;
};

export interface AiProviderAdapter {
  type: AiProviderAdapterType;
  chat(
    runtime: AiProviderRuntimeConfig,
    input: { model: string; messages: AiChatMessage[]; temperature?: number; maxTokens?: number }
  ): Promise<string>;
  submitImage(runtime: AiProviderRuntimeConfig, input: AiImageSubmitInput): Promise<AiImageProviderResult>;
  pollImage(runtime: AiProviderRuntimeConfig, remoteTaskId: string): Promise<AiImageProviderResult>;
  testConnection(runtime: AiProviderRuntimeConfig): Promise<{ ok: boolean; message: string; latencyMs: number }>;
  listModels(runtime: AiProviderRuntimeConfig): Promise<string[]>;
  getBalance?(runtime: AiProviderRuntimeConfig): Promise<AiProviderBalanceResult>;
}

export class AiProviderError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly disposition: 'safe_fallback' | 'definitive_failure' | 'unknown',
    public readonly status?: number
  ) {
    super(message);
  }
}

export function isSafeProviderFallback(error: unknown) {
  return error instanceof AiProviderError && error.disposition === 'safe_fallback';
}

export function classifyImageSubmissionError(error: unknown, remoteTaskId?: string) {
  if (isSafeProviderFallback(error)) {
    return { attemptStatus: 'failed', accepted: false, action: 'fallback' } as const;
  }
  if (remoteTaskId) {
    return { attemptStatus: 'unknown', accepted: true, action: 'wait' } as const;
  }
  return { attemptStatus: 'failed', accepted: false, action: 'fail_untrackable' } as const;
}

export function capabilityForLogicalModel(key: AiLogicalModelKey): AiCapability {
  if (key === 'chat.general') return 'chat';
  if (key === 'vision.reference_analysis') return 'vision';
  if (key === 'image.generate.standard') return 'image.generate';
  return 'image.edit';
}

export function actionKeyForGenerationType(type: string): AiActionKey {
  const map: Record<string, AiActionKey> = {
    reference_recreate: 'image.reference_recreate',
    free_create: 'image.free_create',
    style_transform: 'image.style_transform',
    floor_plan_style: 'image.floor_plan_style',
    furnishing_render: 'image.furnishing_render',
    soft_furnishing_render: 'image.soft_furnishing_render',
    scenario: 'image.scenario',
    advice: 'text.design_advice',
  };
  return map[type] || 'image.furnishing_render';
}

export function normalizeModelMappings(value: unknown): Partial<Record<AiLogicalModelKey, string>> {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const nested = (path: string[]) => {
    let current: unknown = raw;
    for (const key of path) {
      if (!current || typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[key];
    }
    return current;
  };
  const result: Partial<Record<AiLogicalModelKey, string>> = {};
  const sources: Array<[AiLogicalModelKey, unknown]> = [
    ['chat.general', raw['chat.general'] ?? nested(['chat', 'general'])],
    ['vision.reference_analysis', raw['vision.reference_analysis'] ?? nested(['vision', 'reference_analysis'])],
    ['image.generate.standard', raw['image.generate.standard'] ?? nested(['image', 'generate', 'standard'])],
    ['image.edit.standard', raw['image.edit.standard'] ?? nested(['image', 'edit', 'standard'])],
  ];
  for (const [key, model] of sources) if (typeof model === 'string' && model.trim()) result[key] = model.trim();
  return result;
}

export function toStoredModelMappings(value: unknown) {
  const flat = normalizeModelMappings(value);
  return {
    chat: { general: flat['chat.general'] || '' },
    vision: { reference_analysis: flat['vision.reference_analysis'] || '' },
    image: {
      generate: { standard: flat['image.generate.standard'] || '' },
      edit: { standard: flat['image.edit.standard'] || '' },
    },
  };
}
