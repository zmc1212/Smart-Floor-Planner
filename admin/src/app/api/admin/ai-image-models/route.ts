import { NextResponse } from 'next/server';
import {
  AiCreationModelProfileRepository,
  AiProviderConfigRepository,
} from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import { withPlatformTransaction } from '@/db/transaction';
import { withTenantRoute } from '@/lib/tenant-route';
import {
  enableDefaultResolutionPriceForProfile,
  ensurePostgresGrsImageModelCatalog,
  serializePostgresCatalogProfile,
} from '@/lib/ai/image-model-catalog';
import { getAiCreditPrice } from '@/lib/ai/credits';
import { listGrsImageModelIds } from '@/lib/ai/grs-image-models';

type CatalogSettings = {
  id: string;
  enabled: boolean;
  isDefault: boolean;
  maxReferenceImages: number;
};

async function listModels() {
  await ensurePostgresGrsImageModelCatalog();
  const { profiles, providers } = await withPlatformTransaction(async (transaction) => ({
    profiles: await new AiCreationModelProfileRepository(transaction).list({
      sourceType: 'grs_catalog',
    }),
    providers: await new AiProviderConfigRepository(transaction).listEnabled({
      adapterType: 'grs',
    }),
  }));
  const knownModels = new Set(listGrsImageModelIds());
  const unknownModels = [...new Set(
    providers.flatMap((provider) => {
      const state = provider.operationalState ?? {};
      return Array.isArray(state.discoveredModels)
        ? state.discoveredModels.filter((model): model is string => typeof model === 'string')
        : [];
    })
  )]
    .filter((model) => !knownModels.has(model))
    .sort()
    .map((model) => ({
      id: `discovered:${model}`,
      key: `discovered-${model}`,
      name: model,
      description: 'Discovered from provider synchronization; catalog capabilities are unavailable.',
      sourceType: 'discovered_unknown',
      adapterType: 'grs',
      remoteModel: model,
      family: 'unknown',
      catalogVersion: '',
      supportsReferenceImages: false,
      maxReferenceImages: 0,
      aspectRatios: [],
      resolutionTiers: [],
      supportsCustomSize: false,
      defaultAspectRatio: '',
      defaultResolutionTier: '',
      enabled: false,
      isDefault: false,
      weight: 0,
      executable: false,
    }));
  return [...profiles.map(serializePostgresCatalogProfile), ...unknownModels];
}

export async function GET(request: Request) {
  try {
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async () =>
      NextResponse.json({ success: true, data: await listModels() })
    );
  } catch (error) {
    console.error('[AI Image Models GET]', error);
    return NextResponse.json({ success: false, error: 'Failed to load image model catalog' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async (context) => {
      await ensurePostgresGrsImageModelCatalog();
      const body = await request.json() as { items?: CatalogSettings[] };
      if (!Array.isArray(body.items) || !body.items.length) {
        return NextResponse.json({ success: false, error: 'Missing model catalog settings' }, { status: 400 });
      }
      const defaults = body.items.filter((item) => item.isDefault);
      if (defaults.length !== 1 || !defaults[0].enabled) {
        return NextResponse.json({ success: false, error: 'Exactly one enabled default model is required' }, { status: 400 });
      }
      const items = body.items.map((item) => ({
        ...item,
        id: parsePostgresId(item.id, 'model profile id'),
        maxReferenceImages: Math.trunc(Number(item.maxReferenceImages)),
      }));
      if (
        new Set(items.map((item) => item.id)).size !== items.length ||
        items.some((item) => item.maxReferenceImages < 0 || item.maxReferenceImages > 10)
      ) {
        return NextResponse.json({ success: false, error: 'Invalid model catalog settings' }, { status: 400 });
      }
      const defaultCredits = Math.max(1, Number((await getAiCreditPrice('image.free_create')).credits || 10));
      const updatedBy = parsePostgresId(context.userId, 'userId');
      await withPlatformTransaction(async (transaction) => {
        const repository = new AiCreationModelProfileRepository(transaction);
        const stored = await repository.findCatalogProfilesByIds(items.map((item) => item.id));
        if (stored.length !== items.length) throw new Error('Invalid model catalog settings');
        await repository.clearCatalogDefaults();
        for (const item of items) {
          const updated = await repository.updateCatalogSettings(item);
          if (!updated) throw new Error('Invalid model catalog settings');
          if (item.enabled) {
            await enableDefaultResolutionPriceForProfile(transaction, updated, {
              defaultCredits,
              updatedBy,
            });
          }
        }
      });
      return NextResponse.json({ success: true, data: await listModels() });
    });
  } catch (error) {
    console.error('[AI Image Models PATCH]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to save image model catalog' },
      { status: 400 }
    );
  }
}
