import { PlatformConfigRepository } from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import {
  DEFAULT_FLOOR_PLAN_CONSTRAINT_PROMPT,
  normalizeFloorPlanConstraintPrompt,
  validateFloorPlanConstraintPrompt,
} from '@/lib/ai/floor-plan-constraint-prompt';

export type PlatformAiPromptConfig = {
  floorPlanConstraintPrompt: string;
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
  };
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

export async function savePlatformAiPromptConfig(
  floorPlanConstraintPrompt: unknown
): Promise<PlatformAiPromptConfig> {
  const config = {
    floorPlanConstraintPrompt: validateFloorPlanConstraintPrompt(
      floorPlanConstraintPrompt
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

export function platformAiPromptConfigDto(config: PlatformAiPromptConfig) {
  return {
    ...config,
    defaultFloorPlanConstraintPrompt: DEFAULT_FLOOR_PLAN_CONSTRAINT_PROMPT,
    isDefault:
      config.floorPlanConstraintPrompt === DEFAULT_FLOOR_PLAN_CONSTRAINT_PROMPT,
  };
}
