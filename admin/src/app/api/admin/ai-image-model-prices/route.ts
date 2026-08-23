import { NextResponse } from 'next/server';
import {
  AiCreationModelProfileRepository,
  AiModelCreditPriceRepository,
} from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import { withPlatformTransaction } from '@/db/transaction';
import { withTenantRoute } from '@/lib/tenant-route';
import { normalizePlatformCreditAmount } from '@/lib/ai/credits';
import {
  catalogResolutionTiersForPrice,
  ensurePostgresGrsImageModelCatalog,
  listPostgresImageModelPrices,
  selectCatalogImageModelPrices,
  serializeImageModelPrice,
} from '@/lib/ai/image-model-catalog';
import type { GrsResolutionTier } from '@/lib/ai/grs-image-models';

export async function GET(request: Request) {
  try {
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async () => {
      const prices = await listPostgresImageModelPrices();
      return NextResponse.json({ success: true, data: prices.map(serializeImageModelPrice) });
    });
  } catch (error) {
    console.error('[AI Image Model Prices GET]', error);
    return NextResponse.json({ success: false, error: 'Failed to load image model prices' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async (context) => {
      await ensurePostgresGrsImageModelCatalog();
      const body = await request.json() as {
        items?: Array<{
          modelProfileKey: string;
          resolutionTier: GrsResolutionTier;
          credits: number;
          enabled: boolean;
        }>;
      };
      if (!Array.isArray(body.items) || !body.items.length) {
        return NextResponse.json({ success: false, error: '缺少价格配置' }, { status: 400 });
      }
      const profiles = await withPlatformTransaction((transaction) =>
        new AiCreationModelProfileRepository(transaction).list({ sourceType: 'grs_catalog' })
      );
      const profileByKey = new Map(profiles.map((profile) => [profile.key, profile]));
      const items = selectCatalogImageModelPrices(body.items, [...profileByKey.keys()]);
      if (!items.length) {
        return NextResponse.json({ success: false, error: '缺少价格配置' }, { status: 400 });
      }
      for (const item of items) {
        const profile = profileByKey.get(item.modelProfileKey);
        const resolutionTiers = catalogResolutionTiersForPrice(profile || {});
        if (!profile || !resolutionTiers.includes(item.resolutionTier)) {
          return NextResponse.json({
            success: false,
            error: `价格配置无效：${item.modelProfileKey} ${item.resolutionTier}`,
          }, { status: 400 });
        }
      }
      await withPlatformTransaction(async (transaction) => {
        const prices = new AiModelCreditPriceRepository(transaction);
        const profiles = new AiCreationModelProfileRepository(transaction);
        for (const item of items) {
          await prices.update(item.modelProfileKey, item.resolutionTier, {
            credits: BigInt(normalizePlatformCreditAmount(item.credits)),
            enabled: Boolean(item.enabled),
            updatedBy: parsePostgresId(context.userId, 'userId'),
          });
        }
        await profiles.enableCatalogProfilesByKeys(
          items.filter((item) => item.enabled).map((item) => item.modelProfileKey)
        );
      });
      const prices = await listPostgresImageModelPrices();
      return NextResponse.json({ success: true, data: prices.map(serializeImageModelPrice) });
    });
  } catch (error) {
    console.error('[AI Image Model Prices PATCH]', error);
    return NextResponse.json({ success: false, error: '保存价格失败' }, { status: 400 });
  }
}
