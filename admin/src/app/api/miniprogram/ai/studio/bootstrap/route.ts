import { NextResponse } from 'next/server';
import { ensureAiCreditAccount, getAiCreditPrice, serializeAiCreditAccount } from '@/lib/ai/credits';
import { getEnterpriseAiPolicy } from '@/lib/ai/enterprise-policy';
import { listPostgresWorkbenchImageModels } from '@/lib/ai/image-model-catalog';
import { listProviderRuntimes } from '@/lib/ai/provider-registry';
import { isMiniStudioContext, requireMiniStudioContext } from '@/lib/ai/mini-ai-studio';
import { serializeWorkbenchProviderState } from '@/lib/ai/workbench-studio';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await requireMiniStudioContext(request);
    if (!isMiniStudioContext(context)) return context;
    const enterpriseId = context.enterpriseId;
    const [models, account, price, generateProviders, editProviders, policy] = await Promise.all([
      listPostgresWorkbenchImageModels(),
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
        provider: serializeWorkbenchProviderState({
          actionEnabled: policy.enabledActionKeys.includes('image.free_create'),
          generateProviders,
          editProviders,
        }),
        models,
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
