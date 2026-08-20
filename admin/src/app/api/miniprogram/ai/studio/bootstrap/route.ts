import { NextResponse } from 'next/server';
import { ensureAiCreditAccount, getAiCreditPrice, serializeAiCreditAccount } from '@/lib/ai/credits';
import { getEnterpriseAiPolicy } from '@/lib/ai/enterprise-policy';
import {
  listPostgresExecutableImageModelProfiles,
  listPostgresImageModelPrices,
  serializeImageModelPrice,
  serializePostgresCatalogProfile,
} from '@/lib/ai/image-model-catalog';
import { listProviderRuntimes } from '@/lib/ai/provider-registry';
import { isMiniStudioContext, requireMiniStudioContext } from '@/lib/ai/mini-ai-studio';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await requireMiniStudioContext(request);
    if (!isMiniStudioContext(context)) return context;
    const enterpriseId = context.enterpriseId;
    const profilesPromise = listPostgresExecutableImageModelProfiles();
    const modelPricesPromise = profilesPromise.then(() => listPostgresImageModelPrices());
    const [profiles, modelPrices, account, price, generateProviders, editProviders, policy] = await Promise.all([
      profilesPromise,
      modelPricesPromise,
      ensureAiCreditAccount(enterpriseId),
      getAiCreditPrice('image.free_create'),
      listProviderRuntimes('image.generate', 'image.generate.standard').catch(() => []),
      listProviderRuntimes('image.edit', 'image.edit.standard').catch(() => []),
      getEnterpriseAiPolicy(enterpriseId),
    ]);
    return NextResponse.json({
      success: true,
      data: {
        account: serializeAiCreditAccount(account),
        price: { actionKey: price.actionKey, label: price.label, credits: price.credits },
        provider: {
          actionEnabled: policy.enabledActionKeys.includes('image.free_create'),
          supportsGenerate: generateProviders.length > 0,
          supportsEdit: editProviders.length > 0,
        },
        models: profiles
          .filter((profile) => profile.enabled)
          .sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name))
          .map((profile) => {
            const enabledPrices = modelPrices.filter((item) => item.enabled && item.modelProfileKey === profile.key);
            const serialized = serializePostgresCatalogProfile(profile);
            const defaultResolutionTier = enabledPrices.some(
              (item) => item.resolutionTier === serialized.defaults.resolutionTier,
            )
              ? serialized.defaults.resolutionTier
              : enabledPrices[0]?.resolutionTier || serialized.defaults.resolutionTier;
            return {
              ...serialized,
              resolutionTiers: enabledPrices.map((item) => item.resolutionTier),
              defaults: { ...serialized.defaults, resolutionTier: defaultResolutionTier },
              prices: enabledPrices.map(serializeImageModelPrice),
            };
          }),
      },
    });
  } catch (error) {
    console.error('[Mini AI Studio Bootstrap]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '加载创作台失败' },
      { status: 500 },
    );
  }
}
