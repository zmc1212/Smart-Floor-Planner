import { NextResponse } from 'next/server';
import { AiCreditPriceRepository } from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import { withPlatformTransaction } from '@/db/transaction';
import { withTenantRoute } from '@/lib/tenant-route';
import { type AiActionKey } from '@/lib/ai/provider-types';
import { ensureDefaultAiCreditPrices, listAiCreditPrices, normalizePlatformCreditAmount, selectPlatformCreditPriceUpdates } from '@/lib/ai/credits';

export async function GET(request: Request) {
  try {
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async () =>
      NextResponse.json({ success: true, data: await listAiCreditPrices() })
    );
  } catch (error) {
    console.error('[AI Credit Prices GET]', error);
    return NextResponse.json({ success: false, error: '读取价格失败' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async (context) => {
      const body = (await request.json()) as { items?: Array<{ actionKey: AiActionKey; credits: number; enabled: boolean }> };
      if (!Array.isArray(body.items) || !body.items.length) return NextResponse.json({ success: false, error: '缺少价格配置' }, { status: 400 });
      const items = selectPlatformCreditPriceUpdates(body.items);
      if (!items.length) return NextResponse.json({ success: false, error: '缺少价格配置' }, { status: 400 });
      await ensureDefaultAiCreditPrices();
      await withPlatformTransaction(async (transaction) => {
        const prices = new AiCreditPriceRepository(transaction);
        for (const item of items) {
          const credits = normalizePlatformCreditAmount(item.credits);
          await prices.updateByActionKey(item.actionKey, {
            credits: BigInt(credits),
            enabled: Boolean(item.enabled),
            updatedBy: parsePostgresId(context.userId, 'userId'),
          });
        }
      });
      return NextResponse.json({ success: true, data: await listAiCreditPrices() });
    });
  } catch (error) {
    console.error('[AI Credit Prices PATCH]', error);
    return NextResponse.json({ success: false, error: '保存价格失败' }, { status: 500 });
  }
}
