import { NextResponse } from 'next/server';
import { AiCreditPriceRepository } from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import { withPlatformTransaction } from '@/db/transaction';
import { withTenantRoute } from '@/lib/tenant-route';
import { AI_ACTION_KEYS, type AiActionKey } from '@/lib/ai/provider-types';
import { ensureDefaultAiCreditPrices, listAiCreditPrices } from '@/lib/ai/credits';

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
      for (const item of body.items) {
        const credits = Math.trunc(Number(item.credits));
        if (!AI_ACTION_KEYS.includes(item.actionKey) || credits < 1 || credits > 100000) {
          return NextResponse.json({ success: false, error: '价格配置无效' }, { status: 400 });
        }
      }
      await ensureDefaultAiCreditPrices();
      for (const item of body.items) {
        const credits = Math.trunc(Number(item.credits));
        await withPlatformTransaction((transaction) =>
          new AiCreditPriceRepository(transaction).updateByActionKey(item.actionKey, {
            credits: BigInt(credits),
            enabled: Boolean(item.enabled),
            updatedBy: parsePostgresId(context.userId, 'userId'),
          })
        );
      }
      return NextResponse.json({ success: true, data: await listAiCreditPrices() });
    });
  } catch (error) {
    console.error('[AI Credit Prices PATCH]', error);
    return NextResponse.json({ success: false, error: '保存价格失败' }, { status: 500 });
  }
}
