import { AiCreationModelProfile, type IAiCreationModelProfile } from '@/models/AiCreationModelProfile';
import { AiCreditPrice } from '@/models/AiCreditPrice';
import { AiModelCreditPrice } from '@/models/AiModelCreditPrice';
import {
  GRS_IMAGE_CATALOG_VERSION,
  GRS_IMAGE_MODEL_CATALOG,
  getGrsAspectRatiosForTier,
  type GrsResolutionTier,
} from '@/lib/ai/grs-image-models';

const DEFAULT_MODEL = 'gpt-image-2';

export async function ensureGrsImageModelCatalog() {
  const basePrice = await AiCreditPrice.findOne({ actionKey: 'image.free_create' }).lean();
  const defaultCredits = Math.max(1, Number(basePrice?.credits || 10));

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
      await AiModelCreditPrice.updateOne(
        {
          actionKey: 'image.free_create',
          modelProfileKey: key,
          resolutionTier: tier,
        },
        {
          $setOnInsert: {
            label: `${definition.name} ${tier}`,
            credits: defaultCredits,
            enabled: definition.model === DEFAULT_MODEL && tier === '1K',
          },
        },
        { upsert: true }
      );
    }
  }

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
    await AiModelCreditPrice.updateOne(
      {
        actionKey: 'image.free_create',
        modelProfileKey: defaultKey,
        resolutionTier: '1K',
      },
      { $set: { enabled: true } }
    );
  }
}

export async function listImageModelPrices() {
  await ensureGrsImageModelCatalog();
  return AiModelCreditPrice.find({ actionKey: 'image.free_create' })
    .sort({ modelProfileKey: 1, resolutionTier: 1 })
    .lean();
}

export async function getImageModelPrice(modelProfileKey: string, resolutionTier: GrsResolutionTier) {
  await ensureGrsImageModelCatalog();
  const price = await AiModelCreditPrice.findOne({
    actionKey: 'image.free_create',
    modelProfileKey,
    resolutionTier,
    enabled: true,
  }).lean();
  if (!price) throw new Error('所选模型分辨率尚未开放或未配置点数');
  return price;
}

export async function listExecutableImageModelProfiles() {
  await ensureGrsImageModelCatalog();
  const [profiles, prices] = await Promise.all([
    AiCreationModelProfile.find({ sourceType: 'grs_catalog', enabled: true })
      .sort({ isDefault: -1, weight: -1, name: 1 }),
    AiModelCreditPrice.find({ actionKey: 'image.free_create', enabled: true }).lean(),
  ]);
  const pricedKeys = new Set(prices.map((price) => price.modelProfileKey));
  return profiles.filter((profile) => pricedKeys.has(profile.key));
}

export function serializeImageModelPrice(price: {
  _id?: unknown;
  actionKey: string;
  modelProfileKey: string;
  resolutionTier: GrsResolutionTier;
  label: string;
  credits: number;
  enabled: boolean;
}) {
  return {
    id: price._id ? String(price._id) : undefined,
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
