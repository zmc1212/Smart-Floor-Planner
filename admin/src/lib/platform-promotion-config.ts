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

export function normalizePlatformPromotionConfig(
  input?: PromotionConfigInput | null
): PlatformPromotionConfig {
  const defaults = DEFAULT_PLATFORM_PROMOTION_CONFIG;
  return {
    ...defaults,
    protectionPeriodDays: Math.max(1, Number(input?.protectionPeriodDays ?? defaults.protectionPeriodDays)),
    protectionExtendDays: Math.max(1, Number(input?.protectionExtendDays ?? defaults.protectionExtendDays)),
    maxProtectionExtends: Math.max(0, Number(input?.maxProtectionExtends ?? defaults.maxProtectionExtends)),
    poolClaimRequiresApproval: input?.poolClaimRequiresApproval ?? defaults.poolClaimRequiresApproval,
    referrerMembershipLimit: Math.max(
      1,
      Math.floor(
        Number(input?.referrerMembershipLimit ?? defaults.referrerMembershipLimit)
      )
    ),
  };
}

export async function getPlatformPromotionConfig(): Promise<PlatformPromotionConfig> {
  return withPlatformTransaction(async (transaction) => {
    const config = await new PlatformConfigRepository(transaction).findByKey(
      'default'
    );
    return normalizePlatformPromotionConfig(
      config?.promotionConfig as PromotionConfigInput | undefined
    );
  });
}

export async function savePlatformPromotionConfig(input?: PromotionConfigInput | null) {
  const normalized = normalizePlatformPromotionConfig(input);
  await withPlatformTransaction((transaction) =>
    new PlatformConfigRepository(transaction).upsert('default', {
      promotionConfig: {
        protectionPeriodDays: normalized.protectionPeriodDays,
        protectionExtendDays: normalized.protectionExtendDays,
        maxProtectionExtends: normalized.maxProtectionExtends,
        poolClaimRequiresApproval: normalized.poolClaimRequiresApproval,
        referrerMembershipLimit: normalized.referrerMembershipLimit,
      },
    })
  );
  return normalized;
}
