import { NextResponse } from 'next/server';
import { resolveMiniAiContext } from '@/lib/ai/mini-ai-auth';
import { ensureAiCreditAccount, listAiCreditPrices, serializeAiCreditAccount } from '@/lib/ai/credits';
import { ensureDefaultAiStylePresets, listAiStylePresets } from '@/lib/ai/presets';
import { listProviderRuntimes } from '@/lib/ai/provider-registry';
import { getEnterpriseAiPolicy } from '@/lib/ai/enterprise-policy';
import { listAiDesignActions } from '@/lib/ai/design-actions';
import { getDefaultMediaStorageProvider } from '@/lib/media-storage/registry';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
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
      floorPlanTargetSupport: {
        whole_floor_plan: editRuntimes.length > 0,
        single_room: generateRuntimes.length > 0,
      },
      error: editRuntimes.length || generateRuntimes.length ? '' : 'AI 图片服务未配置',
      allowedModels: [] as string[],
    };
    const configuredMediaStorageProvider = process.env.MEDIA_STORAGE_PROVIDER?.trim().toLowerCase() || 'local';
    let mediaStorageProvider = configuredMediaStorageProvider;
    let mediaStoragePersistent = false;
    let mediaStorageWarning = '';
    try {
      const storageProvider = await getDefaultMediaStorageProvider();
      mediaStorageProvider = storageProvider.key;
      mediaStoragePersistent = storageProvider.key !== 'local' || Boolean(process.env.AI_ASSET_STORAGE_DIR);
      if (process.env.NODE_ENV === 'production' && !mediaStoragePersistent) {
        mediaStorageWarning = '生产环境尚未配置共享 AI_ASSET_STORAGE_DIR';
      }
    } catch (error) {
      mediaStorageWarning = error instanceof Error ? error.message : '媒体存储配置不可用';
    }

    return NextResponse.json({
      success: true,
      data: {
        account: serializeAiCreditAccount(account),
        modes: listAiDesignActions('miniprogram').map((action) => {
          const price = prices.find((item) => item.actionKey === action.actionKey);
          const providerReady = action.miniMode === 'floor_plan_render'
            ? providerState.supportsEdit || providerState.supportsGenerate
            : action.capability === 'image.edit'
              ? providerState.supportsEdit
              : providerState.supportsGenerate;
          return {
            key: action.miniMode,
            label: action.label,
            description: action.shortDescription,
            resultBoundary: action.resultBoundary,
            requiredInputs: action.requiredInputs,
            credits: Number(price?.credits || 0),
            enabled: Boolean(price?.enabled) && policy.enabledActionKeys.includes(action.actionKey) && providerReady,
            targetSupport: action.miniMode === 'floor_plan_render'
              ? providerState.floorPlanTargetSupport
              : undefined,
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
          provider: mediaStorageProvider,
          persistent: process.env.NODE_ENV !== 'production' || mediaStoragePersistent,
          warning: mediaStorageWarning,
        },
      },
    });
  } catch (error) {
    console.error('[Mini AI Capabilities]', error);
    return NextResponse.json({ success: false, error: '加载 AI 能力失败' }, { status: 500 });
  }
}
