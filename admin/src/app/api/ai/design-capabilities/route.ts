import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { withTenantRoute } from '@/lib/tenant-route';
import { ensureAiCreditAccount, listAiCreditPrices, serializeAiCreditAccount } from '@/lib/ai/credits';
import { listProviderRuntimes } from '@/lib/ai/provider-registry';
import { getEnterpriseAiPolicy } from '@/lib/ai/enterprise-policy';
import { listAiDesignActions } from '@/lib/ai/design-actions';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await dbConnect();
    return await withTenantRoute(request, { requireEnterprise: true }, async (context) => {
      const enterpriseId = context.enterpriseId || '';
      const [account, prices, editRuntimes, generateRuntimes, policy] = await Promise.all([
        ensureAiCreditAccount(enterpriseId),
        listAiCreditPrices(),
        listProviderRuntimes('image.edit', 'image.edit.standard').catch(() => []),
        listProviderRuntimes('image.generate', 'image.generate.standard').catch(() => []),
        getEnterpriseAiPolicy(enterpriseId),
      ]);
      const priceByAction = new Map(prices.map((price) => [price.actionKey, price]));
      const actions = [...listAiDesignActions('admin_workflow'), ...listAiDesignActions('admin_quick')]
        .map((action) => {
          const price = priceByAction.get(action.actionKey);
          const providerReady = action.capability === 'image.edit' ? editRuntimes.length > 0 : generateRuntimes.length > 0;
          return {
            ...action,
            credits: Number(price?.credits || 0),
            enabled: Boolean(price?.enabled) && policy.enabledActionKeys.includes(action.actionKey) && providerReady,
            disabledReason: !price?.enabled
              ? '当前 AI 功能未开放'
              : !policy.enabledActionKeys.includes(action.actionKey)
                ? '当前企业未开放该功能'
                : !providerReady
                  ? '所需 AI 图片能力未配置'
                  : '',
          };
        });

      return NextResponse.json({
        success: true,
        data: {
          account: serializeAiCreditAccount(account),
          provider: {
            available: editRuntimes.length > 0 || generateRuntimes.length > 0,
            supportsEdit: editRuntimes.length > 0,
            supportsGenerate: generateRuntimes.length > 0,
          },
          actions,
        },
      });
    });
  } catch (error) {
    console.error('[AI Design Capabilities]', error);
    return NextResponse.json({ success: false, error: '加载 AI 设计能力失败' }, { status: 500 });
  }
}
