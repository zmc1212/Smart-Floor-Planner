import {
  AiCreationModelProfileRepository,
  AiModelCreditPriceRepository,
  type AiCreationModelProfileRecord,
} from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import { getAiCreditPrice } from '@/lib/ai/credits';
import {
  GRS_IMAGE_CATALOG_VERSION,
  GRS_IMAGE_MODEL_CATALOG,
  getGrsAspectRatiosForTier,
  type GrsResolutionTier,
} from '@/lib/ai/grs-image-models';

const DEFAULT_MODEL = 'gpt-image-2';

export async function ensurePostgresGrsImageModelCatalog() {
  const basePrice = await getAiCreditPrice('image.free_create');
  const defaultCredits = Math.max(1, Number(basePrice.credits || 10));
  await withPlatformTransaction(async (transaction) => {
    const profiles = new AiCreationModelProfileRepository(transaction);
    const prices = new AiModelCreditPriceRepository(transaction);
    await profiles.ensureCatalogProfiles(
      GRS_IMAGE_MODEL_CATALOG.map((definition, index) => ({
        key: `grs-${definition.model}`,
        name: definition.name,
        description: `GRSAI ${definition.model}`,
        sourceModelSourceIds: [],
        sourceType: 'grs_catalog',
        adapterType: 'grs',
        remoteModel: definition.model,
        family: definition.family,
        catalogVersion: GRS_IMAGE_CATALOG_VERSION,
        generateLogicalModelKey: 'image.generate.standard',
        editLogicalModelKey: 'image.edit.standard',
        capabilities: {
          supportsReferenceImages: true,
          maxReferenceImages: definition.maxReferenceImages,
          aspectRatios: definition.aspectRatios,
          resolutionTiers: definition.resolutionTiers,
          supportsCustomSize: definition.supportsCustomSize,
        },
        defaults: {
          aspectRatio: definition.defaultAspectRatio,
          size: definition.defaultResolutionTier,
          quality: '',
          resolutionTier: definition.defaultResolutionTier,
        },
        weight: GRS_IMAGE_MODEL_CATALOG.length - index,
      }))
    );
    for (const definition of GRS_IMAGE_MODEL_CATALOG) {
      for (const tier of definition.resolutionTiers) {
        await prices.ensureDefault({
          actionKey: 'image.free_create',
          modelProfileKey: `grs-${definition.model}`,
          resolutionTier: tier,
          label: `${definition.name} ${tier}`,
          credits: BigInt(defaultCredits),
          enabled: definition.model === DEFAULT_MODEL && tier === '1K',
        });
      }
    }
    await profiles.ensureDefaultCatalogProfile(`grs-${DEFAULT_MODEL}`);
  });
}

export async function listPostgresImageModelPrices() {
  await ensurePostgresGrsImageModelCatalog();
  return withPlatformTransaction((transaction) =>
    new AiModelCreditPriceRepository(transaction).list({ actionKey: 'image.free_create' })
  );
}

export async function getPostgresImageModelPrice(
  modelProfileKey: string,
  resolutionTier: GrsResolutionTier
) {
  await ensurePostgresGrsImageModelCatalog();
  const price = await withPlatformTransaction((transaction) =>
    new AiModelCreditPriceRepository(transaction).findEnabled(modelProfileKey, resolutionTier)
  );
  if (!price) throw new Error('The selected model resolution is not enabled');
  return price;
}

export async function listPostgresExecutableImageModelProfiles() {
  await ensurePostgresGrsImageModelCatalog();
  const [profiles, prices] = await Promise.all([
    withPlatformTransaction((transaction) =>
      new AiCreationModelProfileRepository(transaction).list({
        sourceType: 'grs_catalog',
        enabledOnly: true,
      })
    ),
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
  id: bigint | string;
  actionKey: string;
  modelProfileKey: string;
  resolutionTier: string;
  label: string;
  credits: number | bigint;
  enabled: boolean;
}) {
  return {
    id: String(price.id),
    actionKey: price.actionKey,
    modelProfileKey: price.modelProfileKey,
    resolutionTier: price.resolutionTier,
    label: price.label,
    credits: Number(price.credits),
    enabled: Boolean(price.enabled),
  };
}

export function serializePostgresCatalogProfile(profile: AiCreationModelProfileRecord) {
  const capabilities = profile.capabilities || {};
  const defaults = profile.defaults || {};
  const remoteModel = profile.remoteModel || '';
  const resolutionTiers = (capabilities.resolutionTiers || []) as GrsResolutionTier[];
  return {
    id: profile.id.toString(),
    key: profile.key,
    name: profile.name,
    description: profile.description || '',
    sourceModelSourceIds: profile.sourceModelSourceIds || [],
    sourceType: profile.sourceType,
    adapterType: profile.adapterType,
    remoteModel,
    family: profile.family,
    catalogVersion: profile.catalogVersion,
    supportsReferenceImages: Boolean(capabilities.supportsReferenceImages),
    maxReferenceImages: Number(capabilities.maxReferenceImages || 0),
    aspectRatios: (capabilities.aspectRatios || []) as string[],
    resolutionTiers,
    aspectRatiosByResolutionTier: Object.fromEntries(
      resolutionTiers.map((tier) => [tier, getGrsAspectRatiosForTier(remoteModel, tier)])
    ),
    sizes: resolutionTiers,
    qualities: [],
    supportsCustomSize: Boolean(capabilities.supportsCustomSize),
    defaults: {
      aspectRatio: String(defaults.aspectRatio || '1:1'),
      size: String(defaults.size || defaults.resolutionTier || '1K'),
      quality: String(defaults.quality || ''),
      resolutionTier: String(defaults.resolutionTier || defaults.size || '1K'),
    },
    defaultAspectRatio: String(defaults.aspectRatio || '1:1'),
    defaultResolutionTier: String(defaults.resolutionTier || defaults.size || '1K'),
    enabled: profile.enabled,
    isDefault: profile.isDefault,
    weight: profile.weight,
    executable: true,
  };
}
