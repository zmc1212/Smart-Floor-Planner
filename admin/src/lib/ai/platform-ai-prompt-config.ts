import { PlatformConfigRepository } from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import {
  DEFAULT_FLOOR_PLAN_CONSTRAINT_PROMPT,
  normalizeFloorPlanConstraintPrompt,
  validateFloorPlanConstraintPrompt,
} from '@/lib/ai/floor-plan-constraint-prompt';
import {
  DEFAULT_SINGLE_ROOM_FULL_SPACE_PROMPT,
  DEFAULT_SOFT_FURNISHING_ONLY_PROMPT,
} from '@/lib/ai/creation-batch-floorplan';

export type PlatformAiPromptConfig = {
  floorPlanConstraintPrompt: string;
  singleRoomFullSpacePrompt: string;
  softFurnishingOnlyPrompt: string;
};

type StoredPlatformAiPromptConfig = Partial<PlatformAiPromptConfig>;

function isPromptConfigMigrationError(error: unknown) {
  const candidate = error as { code?: string; message?: string } | null;
  const message = String(candidate?.message || error || '').toLowerCase();
  return candidate?.code === '42703'
    || candidate?.code === '42p01'
    || (message.includes('ai_prompt_config') && (message.includes('column') || message.includes('relation')));
}

export function normalizePlatformAiPromptConfig(
  input?: StoredPlatformAiPromptConfig | null
): PlatformAiPromptConfig {
  return {
    floorPlanConstraintPrompt: normalizeFloorPlanConstraintPrompt(
      input?.floorPlanConstraintPrompt
    ),
    singleRoomFullSpacePrompt: normalizePrompt(
      input?.singleRoomFullSpacePrompt,
      DEFAULT_SINGLE_ROOM_FULL_SPACE_PROMPT,
    ),
    softFurnishingOnlyPrompt: normalizePrompt(
      input?.softFurnishingOnlyPrompt,
      DEFAULT_SOFT_FURNISHING_ONLY_PROMPT,
    ),
  };
}

function normalizePrompt(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

export async function getPlatformAiPromptConfig(): Promise<PlatformAiPromptConfig> {
  try {
    return await withPlatformTransaction(async (transaction) => {
      const config = await new PlatformConfigRepository(transaction).findByKey('default');
      return normalizePlatformAiPromptConfig(
        config?.aiPromptConfig as StoredPlatformAiPromptConfig | undefined
      );
    });
  } catch (error) {
    // Keep generation usable during a rolling deploy before migration 0052 has run.
    if (isPromptConfigMigrationError(error)) return normalizePlatformAiPromptConfig(null);
    throw error;
  }
}

export async function savePlatformAiPromptConfig(input: {
  floorPlanConstraintPrompt?: unknown;
  singleRoomFullSpacePrompt?: unknown;
  softFurnishingOnlyPrompt?: unknown;
}): Promise<PlatformAiPromptConfig> {
  const config = {
    floorPlanConstraintPrompt: validateFloorPlanConstraintPrompt(
      input.floorPlanConstraintPrompt
    ),
    singleRoomFullSpacePrompt: validatePrompt(
      input.singleRoomFullSpacePrompt,
      DEFAULT_SINGLE_ROOM_FULL_SPACE_PROMPT,
      '单间全空间设计提示词',
    ),
    softFurnishingOnlyPrompt: validatePrompt(
      input.softFurnishingOnlyPrompt,
      DEFAULT_SOFT_FURNISHING_ONLY_PROMPT,
      '仅软装换搭提示词',
    ),
  };
  try {
    await withPlatformTransaction((transaction) =>
      new PlatformConfigRepository(transaction).upsert('default', {
        aiPromptConfig: config,
      })
    );
  } catch (error) {
    if (isPromptConfigMigrationError(error)) {
      throw new Error('AI 内置提示词字段尚未完成数据库迁移，请先运行 npm run db:migrate');
    }
    throw error;
  }
  return config;
}

function validatePrompt(value: unknown, fallback: string, label: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}不能为空`);
  const prompt = value.trim();
  if (prompt.length > 6000) throw new Error(`${label}不能超过 6000 个字符`);
  return prompt || fallback;
}

export function platformAiPromptConfigDto(config: PlatformAiPromptConfig) {
  return {
    ...config,
    defaultFloorPlanConstraintPrompt: DEFAULT_FLOOR_PLAN_CONSTRAINT_PROMPT,
    defaultSingleRoomFullSpacePrompt: DEFAULT_SINGLE_ROOM_FULL_SPACE_PROMPT,
    defaultSoftFurnishingOnlyPrompt: DEFAULT_SOFT_FURNISHING_ONLY_PROMPT,
    isDefault:
      config.floorPlanConstraintPrompt === DEFAULT_FLOOR_PLAN_CONSTRAINT_PROMPT,
    isSingleRoomFullSpaceDefault:
      config.singleRoomFullSpacePrompt === DEFAULT_SINGLE_ROOM_FULL_SPACE_PROMPT,
    isSoftFurnishingOnlyDefault:
      config.softFurnishingOnlyPrompt === DEFAULT_SOFT_FURNISHING_ONLY_PROMPT,
  };
}
