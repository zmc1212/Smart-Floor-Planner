import { AiCreationModelProfile, type IAiCreationModelProfile } from '@/models/AiCreationModelProfile';
import { AiModelCreditPriceRepository } from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import { getAiCreditPrice } from '@/lib/ai/credits';
import {
  GRS_IMAGE_CATALOG_VERSION,
  GRS_IMAGE_MODEL_CATALOG,
  getGrsAspectRatiosForTier,
  type GrsResolutionTier,
} from '@/lib/ai/grs-image-models';

const DEFAULT_MODEL = 'gpt-image-2';

export async function ensureGrsImageModelCatalog() {
  const basePrice = await getAiCreditPrice('image.free_create');
  const defaultCredits = Math.max(1, Number(basePrice.credits || 10));
  const priceDefaults: Array<Parameters<AiModelCreditPriceRepository['ensureDefault']>[0]> = [];

  await AiCreationModelProfile.updateMany(
    { sourceType: { $exists: false } },
    { $set: { sourceType: 'roomi_legacy', enabled: false, isDefault: false } }
  );

  for (const [index, definition] of GRS_IMAGE_MODEL_CATALOG.entries()) {
    const key = `grs-${definition.model}`;
    await AiCreationModelProfile.updateOne(
      { key },
      {
        $set: {
          name: definition.name,
          description: `GRSAI ${definition.model}`,
          sourceType: 'grs_catalog',
          adapterType: 'grs',
          remoteModel: definition.model,
          family: definition.family,
          catalogVersion: GRS_IMAGE_CATALOG_VERSION,
          generateLogicalModelKey: 'image.generate.standard',
          editLogicalModelKey: 'image.edit.standard',
          supportsReferenceImages: true,
          aspectRatios: definition.aspectRatios,
          sizes: definition.resolutionTiers,
          qualities: [],
          resolutionTiers: definition.resolutionTiers,
          supportsCustomSize: definition.supportsCustomSize,
          defaultAspectRatio: definition.defaultAspectRatio,
          defaultSize: definition.defaultResolutionTier,
          defaultQuality: '',
          defaultResolutionTier: definition.defaultResolutionTier,
          weight: GRS_IMAGE_MODEL_CATALOG.length - index,
        },
        $setOnInsert: {
          sourceModelSourceIds: [],
          maxReferenceImages: definition.maxReferenceImages,
          enabled: definition.model === DEFAULT_MODEL,
          isDefault: definition.model === DEFAULT_MODEL,
        },
      },
      { upsert: true }
    );

    for (const tier of definition.resolutionTiers) {
      priceDefaults.push({
        actionKey: 'image.free_create',
        modelProfileKey: key,
        resolutionTier: tier,
        label: `${definition.name} ${tier}`,
        credits: BigInt(defaultCredits),
        enabled: definition.model === DEFAULT_MODEL && tier === '1K',
      });
    }
  }

  await withPlatformTransaction(async (transaction) => {
    const prices = new AiModelCreditPriceRepository(transaction);
    for (const price of priceDefaults) await prices.ensureDefault(price);
  });

  const activeDefault = await AiCreationModelProfile.exists({
    sourceType: 'grs_catalog',
    enabled: true,
    isDefault: true,
  });
  if (!activeDefault) {
    const defaultKey = `grs-${DEFAULT_MODEL}`;
    await AiCreationModelProfile.updateMany(
      { sourceType: 'grs_catalog' },
      { $set: { isDefault: false } }
    );
    await AiCreationModelProfile.updateOne(
      { key: defaultKey, sourceType: 'grs_catalog' },
      { $set: { enabled: true, isDefault: true } }
    );
    await withPlatformTransaction((transaction) =>
      new AiModelCreditPriceRepository(transaction).update(defaultKey, '1K', {
        credits: BigInt(defaultCredits),
        enabled: true,
        updatedBy: null,
      })
    );
  }

}

export async function listImageModelPrices() {
  await ensureGrsImageModelCatalog();
  return withPlatformTransaction((transaction) =>
    new AiModelCreditPriceRepository(transaction).list({ actionKey: 'image.free_create' })
  );
}

export async function getImageModelPrice(modelProfileKey: string, resolutionTier: GrsResolutionTier) {
  await ensureGrsImageModelCatalog();
  const price = await withPlatformTransaction((transaction) =>
    new AiModelCreditPriceRepository(transaction).findEnabled(modelProfileKey, resolutionTier)
  );
  if (!price) throw new Error('所选模型分辨率尚未开放或未配置点数');
  return price;
}

export async function listExecutableImageModelProfiles() {
  await ensureGrsImageModelCatalog();
  const [profiles, prices] = await Promise.all([
    AiCreationModelProfile.find({ sourceType: 'grs_catalog', enabled: true })
      .sort({ isDefault: -1, weight: -1, name: 1 }),
    withPlatformTransaction((transaction) =>
      new AiModelCreditPriceRepository(transaction).list({
        actionKey: 'image.free_create',
        enabledOnly: true,
      })
    ),
  ]);
  const pricedKeys = new Set(prices.map((price) => price.modelProfileKey));
  return profiles.filter((profile) => pricedKeys.has(profile.key));
}

export function serializeImageModelPrice(price: {
  id?: bigint | string;
  _id?: unknown;
  actionKey: string;
  modelProfileKey: string;
  resolutionTier: string;
  label: string;
  credits: number | bigint;
  enabled: boolean;
}) {
  return {
    id: price.id !== undefined ? String(price.id) : price._id ? String(price._id) : undefined,
    actionKey: price.actionKey,
    modelProfileKey: price.modelProfileKey,
    resolutionTier: price.resolutionTier,
    label: price.label,
    credits: Number(price.credits),
    enabled: Boolean(price.enabled),
  };
}

export function serializeCatalogProfile(profile: IAiCreationModelProfile | Record<string, unknown>) {
  const remoteModel = String(profile.remoteModel || '');
  const resolutionTiers = (profile.resolutionTiers || []) as GrsResolutionTier[];
  return {
    id: String(profile._id),
    key: String(profile.key),
    name: String(profile.name),
    description: String(profile.description || ''),
    sourceType: profile.sourceType,
    adapterType: profile.adapterType,
    remoteModel,
    family: profile.family,
    catalogVersion: profile.catalogVersion,
    supportsReferenceImages: Boolean(profile.supportsReferenceImages),
    maxReferenceImages: Number(profile.maxReferenceImages || 0),
    aspectRatios: profile.aspectRatios || [],
    resolutionTiers,
    aspectRatiosByResolutionTier: Object.fromEntries(
      resolutionTiers.map((tier) => [tier, getGrsAspectRatiosForTier(remoteModel, tier)])
    ),
    supportsCustomSize: Boolean(profile.supportsCustomSize),
    defaultAspectRatio: profile.defaultAspectRatio,
    defaultResolutionTier: profile.defaultResolutionTier,
    enabled: Boolean(profile.enabled),
    isDefault: Boolean(profile.isDefault),
    weight: Number(profile.weight || 0),
    executable: true,
  };
}
