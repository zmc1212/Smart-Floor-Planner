import { PlatformConfigRepository } from '@/db/repositories';
import {
  isMiniProgramCodeEnvironment,
  type MiniProgramCodeEnvironment,
} from '@/lib/mini-program-code-environment';
import { withPlatformTransaction } from '@/db/transaction';

export const DEFAULT_PLATFORM_MINI_PROGRAM_CODE_CONFIG = {
  environment: 'develop' as MiniProgramCodeEnvironment,
};

export type PlatformMiniProgramCodeConfig =
  typeof DEFAULT_PLATFORM_MINI_PROGRAM_CODE_CONFIG;

type StoredMiniProgramCodeConfig = Partial<PlatformMiniProgramCodeConfig>;

export function normalizePlatformMiniProgramCodeConfig(
  input?: StoredMiniProgramCodeConfig | null
): PlatformMiniProgramCodeConfig {
  return {
    environment: isMiniProgramCodeEnvironment(input?.environment)
      ? input.environment
      : DEFAULT_PLATFORM_MINI_PROGRAM_CODE_CONFIG.environment,
  };
}

export async function getPlatformMiniProgramCodeConfig(): Promise<PlatformMiniProgramCodeConfig> {
  return withPlatformTransaction(async (transaction) => {
    const config = await new PlatformConfigRepository(transaction).findByKey('default');
    return normalizePlatformMiniProgramCodeConfig(
      config?.miniProgramCodeConfig as StoredMiniProgramCodeConfig | undefined
    );
  });
}

export async function savePlatformMiniProgramCodeConfig(
  environment: unknown
): Promise<PlatformMiniProgramCodeConfig> {
  if (!isMiniProgramCodeEnvironment(environment)) {
    throw new Error('Invalid Mini Program code environment');
  }
  const config = { environment };
  await withPlatformTransaction((transaction) =>
    new PlatformConfigRepository(transaction).upsert('default', {
      miniProgramCodeConfig: config,
    })
  );
  return config;
}
