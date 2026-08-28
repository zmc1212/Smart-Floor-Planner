import { PlatformConfigRepository } from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';

export const DEFAULT_PLATFORM_PROMOTION_CONFIG = {
  protectionPeriodDays: 30,
  protectionExtendDays: 15,
  maxProtectionExtends: 3,
  commissionTiers: [
    { label: '基础套餐', amount: 500 },
    { label: '标准套餐', amount: 1000 },
    { label: '高级套餐', amount: 2000 },
  ] as Array<{ label: string; amount: number }>,
  defaultCommissionAmount: 500,
  poolClaimRequiresApproval: false,
  referrerMembershipLimit: 3,
};

export type PlatformPromotionConfig = typeof DEFAULT_PLATFORM_PROMOTION_CONFIG;

type PromotionConfigInput = Partial<
  Pick<
    PlatformPromotionConfig,
    'protectionPeriodDays' | 'protectionExtendDays' | 'maxProtectionExtends' | 'poolClaimRequiresApproval' | 'referrerMembershipLimit'
  >
>;

function toBoundedInt(
  value: unknown,
  fallback: number,
  minimum: number
) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}

function toBoolean(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback;
}

function pickDefined<T extends object>(input?: T | null): Partial<T> {
  if (!input) return {};
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined)
  ) as Partial<T>;
}

export function normalizePlatformPromotionConfig(
  input?: Record<string, unknown> | null
): PlatformPromotionConfig {
  const defaults = DEFAULT_PLATFORM_PROMOTION_CONFIG;
  return {
    ...defaults,
    protectionPeriodDays: toBoundedInt(
      input?.protectionPeriodDays ?? defaults.protectionPeriodDays,
      defaults.protectionPeriodDays,
      1
    ),
    protectionExtendDays: toBoundedInt(
      input?.protectionExtendDays ?? defaults.protectionExtendDays,
      defaults.protectionExtendDays,
      1
    ),
    maxProtectionExtends: toBoundedInt(
      input?.maxProtectionExtends ?? defaults.maxProtectionExtends,
      defaults.maxProtectionExtends,
      0
    ),
    poolClaimRequiresApproval: toBoolean(
      input?.poolClaimRequiresApproval,
      defaults.poolClaimRequiresApproval
    ),
    referrerMembershipLimit: toBoundedInt(
      input?.referrerMembershipLimit ?? defaults.referrerMembershipLimit,
      defaults.referrerMembershipLimit,
      1
    ),
  };
}

export function mergePlatformPromotionConfig(
  stored?: Record<string, unknown> | null,
  patch?: PromotionConfigInput | null
): PlatformPromotionConfig {
  return normalizePlatformPromotionConfig({
    ...normalizePlatformPromotionConfig(stored),
    ...pickDefined(patch),
  });
}

export async function getPlatformPromotionConfig(): Promise<PlatformPromotionConfig> {
  return withPlatformTransaction(async (transaction) => {
    const config = await new PlatformConfigRepository(transaction).findByKey(
      'default'
    );
    return normalizePlatformPromotionConfig(config?.promotionConfig);
  });
}

export async function savePlatformPromotionConfig(input?: PromotionConfigInput | null) {
  return withPlatformTransaction(async (transaction) => {
    const repository = new PlatformConfigRepository(transaction);
    const existing = await repository.ensureForUpdate('default');
    const stored = existing?.promotionConfig ?? {};
    const normalized = mergePlatformPromotionConfig(stored, input);
    const promotionConfig = {
      ...stored,
      protectionPeriodDays: normalized.protectionPeriodDays,
      protectionExtendDays: normalized.protectionExtendDays,
      maxProtectionExtends: normalized.maxProtectionExtends,
      poolClaimRequiresApproval: normalized.poolClaimRequiresApproval,
      referrerMembershipLimit: normalized.referrerMembershipLimit,
    };
    await repository.update('default', { promotionConfig });
    return normalized;
  });
}
