import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { resolveMiniAiContext } from '@/lib/ai/mini-ai-auth';
import { ensureAiCreditAccount, listAiCreditPrices, serializeAiCreditAccount } from '@/lib/ai/credits';
import { ensureDefaultAiStylePresets, listAiStylePresets } from '@/lib/ai/presets';
import { listProviderRuntimes } from '@/lib/ai/provider-registry';
import { getEnterpriseAiPolicy } from '@/lib/ai/enterprise-policy';
import { listAiDesignActions } from '@/lib/ai/design-actions';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await dbConnect();
    const context = await resolveMiniAiContext(request);
    if (!context) {
      return NextResponse.json({ success: false, error: '仅企业员工可以使用 AI 设计' }, { status: 403 });
    }

    await ensureDefaultAiStylePresets(String(context.operatorId));
    const [account, prices, styles, editRuntimes, generateRuntimes, policy] = await Promise.all([
      ensureAiCreditAccount(context.enterpriseId),
      listAiCreditPrices(),
      listAiStylePresets('furnishing_style'),
      listProviderRuntimes('image.edit', 'image.edit.standard').catch(() => []),
      listProviderRuntimes('image.generate', 'image.generate.standard').catch(() => []),
      getEnterpriseAiPolicy(context.enterpriseId),
    ]);

    const providerState = {
      available: editRuntimes.length > 0 || generateRuntimes.length > 0,
      provider: editRuntimes[0]?.key || generateRuntimes[0]?.key || '',
      supportsEdit: editRuntimes.length > 0,
      supportsGenerate: generateRuntimes.length > 0,
      error: editRuntimes.length || generateRuntimes.length ? '' : 'AI 图片服务未配置',
      allowedModels: [] as string[],
    };

    return NextResponse.json({
      success: true,
      data: {
        account: serializeAiCreditAccount(account),
        modes: listAiDesignActions('miniprogram').map((action) => {
          const price = prices.find((item) => item.actionKey === action.actionKey);
          const providerReady = action.capability === 'image.edit' ? providerState.supportsEdit : providerState.supportsGenerate;
          return {
            key: action.miniMode,
            label: action.label,
            description: action.shortDescription,
            resultBoundary: action.resultBoundary,
            requiredInputs: action.requiredInputs,
            credits: Number(price?.credits || 0),
            enabled: Boolean(price?.enabled) && policy.enabledActionKeys.includes(action.actionKey) && providerReady,
          };
        }),
        styles: styles.map((style) => ({
          key: style.key,
          name: style.name,
          description: style.description,
          icon: style.icon,
        })),
        provider: providerState,
        logicalModelTier: policy.logicalModelTier,
        storage: {
          persistent: process.env.NODE_ENV !== 'production' || Boolean(process.env.AI_ASSET_STORAGE_DIR),
          warning:
            process.env.NODE_ENV === 'production' && !process.env.AI_ASSET_STORAGE_DIR
              ? '生产环境尚未配置共享 AI_ASSET_STORAGE_DIR'
              : '',
        },
      },
    });
  } catch (error) {
    console.error('[Mini AI Capabilities]', error);
    return NextResponse.json({ success: false, error: '加载 AI 能力失败' }, { status: 500 });
  }
}
