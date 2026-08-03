import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { AiModelCreditPriceRepository } from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import { withPlatformTransaction } from '@/db/transaction';
import { withTenantRoute } from '@/lib/tenant-route';
import {
  ensureGrsImageModelCatalog,
  listImageModelPrices,
  serializeImageModelPrice,
} from '@/lib/ai/image-model-catalog';
import { AiCreationModelProfile } from '@/models/AiCreationModelProfile';
import type { GrsResolutionTier } from '@/lib/ai/grs-image-models';

export async function GET(request: Request) {
  try {
    await dbConnect();
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async () => {
      const prices = await listImageModelPrices();
      return NextResponse.json({ success: true, data: prices.map(serializeImageModelPrice) });
    });
  } catch (error) {
    console.error('[AI Image Model Prices GET]', error);
    return NextResponse.json({ success: false, error: '读取模型点数价格失败' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    await dbConnect();
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async (context) => {
      await ensureGrsImageModelCatalog();
      const body = await request.json() as {
        items?: Array<{
          modelProfileKey: string;
          resolutionTier: GrsResolutionTier;
          credits: number;
          enabled: boolean;
        }>;
      };
      if (!Array.isArray(body.items) || !body.items.length) {
        return NextResponse.json({ success: false, error: '缺少模型价格配置' }, { status: 400 });
      }
      const items = body.items;
      const profiles = await AiCreationModelProfile.find({
        key: { $in: items.map((item) => item.modelProfileKey) },
        sourceType: 'grs_catalog',
      }).lean();
      const profileByKey = new Map(profiles.map((profile) => [profile.key, profile]));
      for (const item of items) {
        const profile = profileByKey.get(item.modelProfileKey);
        const credits = Math.trunc(Number(item.credits));
        if (
          !profile
          || !profile.resolutionTiers.includes(item.resolutionTier)
          || credits < 1
          || credits > 100000
        ) {
          return NextResponse.json({ success: false, error: '模型价格配置无效' }, { status: 400 });
        }
      }
      await withPlatformTransaction(async (transaction) => {
        const prices = new AiModelCreditPriceRepository(transaction);
        for (const item of items) {
          const credits = Math.trunc(Number(item.credits));
          await prices.update(
            item.modelProfileKey,
            item.resolutionTier,
            {
              credits: BigInt(credits),
              enabled: Boolean(item.enabled),
              updatedBy: parsePostgresId(context.userId, 'userId'),
            }
          );
        }
      });
      const prices = await listImageModelPrices();
      return NextResponse.json({ success: true, data: prices.map(serializeImageModelPrice) });
    });
  } catch (error) {
    console.error('[AI Image Model Prices PATCH]', error);
    return NextResponse.json({ success: false, error: '保存模型点数价格失败' }, { status: 400 });
  }
}
