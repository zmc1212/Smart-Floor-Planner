import { NextResponse } from 'next/server';
import {
  AiCreationModelProfileRepository,
  AiModelCreditPriceRepository,
} from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import { withPlatformTransaction } from '@/db/transaction';
import { withTenantRoute } from '@/lib/tenant-route';
import {
  ensurePostgresGrsImageModelCatalog,
  listPostgresImageModelPrices,
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
        return NextResponse.json({ success: false, error: 'Missing image model price settings' }, { status: 400 });
      }
      const items = body.items;
      const profiles = await withPlatformTransaction((transaction) =>
        new AiCreationModelProfileRepository(transaction).list({ sourceType: 'grs_catalog' })
      );
      const profileByKey = new Map(profiles.map((profile) => [profile.key, profile]));
      for (const item of items) {
        const profile = profileByKey.get(item.modelProfileKey);
        const credits = Math.trunc(Number(item.credits));
        const resolutionTiers = Array.isArray(profile?.capabilities?.resolutionTiers)
          ? profile.capabilities.resolutionTiers
          : [];
        if (!profile || !resolutionTiers.includes(item.resolutionTier) || credits < 1 || credits > 100000) {
          return NextResponse.json({ success: false, error: 'Invalid image model price settings' }, { status: 400 });
        }
      }
      await withPlatformTransaction(async (transaction) => {
        const prices = new AiModelCreditPriceRepository(transaction);
        for (const item of items) {
          await prices.update(item.modelProfileKey, item.resolutionTier, {
            credits: BigInt(Math.trunc(Number(item.credits))),
            enabled: Boolean(item.enabled),
            updatedBy: parsePostgresId(context.userId, 'userId'),
          });
        }
      });
      const prices = await listPostgresImageModelPrices();
      return NextResponse.json({ success: true, data: prices.map(serializeImageModelPrice) });
    });
  } catch (error) {
    console.error('[AI Image Model Prices PATCH]', error);
    return NextResponse.json({ success: false, error: 'Failed to save image model prices' }, { status: 400 });
  }
}
