import { promises as fs } from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { AiPromptCategory } from '@/models/AiPromptCategory';
import { AiPromptLibraryRevision, type IAiPromptLibraryRevision } from '@/models/AiPromptLibraryRevision';
import { AiPromptParameterTemplate } from '@/models/AiPromptParameterTemplate';
import { AiPromptSourceModel } from '@/models/AiPromptSourceModel';
import { AiPromptTemplate } from '@/models/AiPromptTemplate';
import { AiPromptTemplateAsset } from '@/models/AiPromptTemplateAsset';
import { getMediaStorageProvider } from '@/lib/media-storage/registry';
import { sha256Hex } from '@/lib/media-storage/operations';
import { sha256Value, stableJson, validatePromptLibrary } from './prompt-library';
import type { NormalizedPromptLibrary, StagedPromptAsset } from './prompt-library-types';

function extensionForMime(mimeType: string) {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/gif') return 'gif';
  if (mimeType === 'image/avif') return 'avif';
  throw new Error(`Unsupported prompt preview MIME: ${mimeType}`);
}

export function createPromptLibraryRevisionIdentity(
  library: NormalizedPromptLibrary,
  assets: StagedPromptAsset[]
) {
  const manifest = {
    source: 'roomi',
    categories: library.categories.map((item) => [item.sourceId, item.sourceHash]),
    templates: library.templates.map((item) => [item.sourceId, item.sourceHash]),
    parameterTemplates: library.parameterTemplates.map((item) => [item.sourceId, item.sourceHash]),
    models: library.models.map((item) => [item.sourceId, item.sourceHash]),
    assets: assets.map((item) => [item.templateSourceId, item.checksumSha256]),
    skippedTemplates: library.skippedTemplates,
  };
  const manifestHash = sha256Value(manifest);
  return {
    manifest,
    manifestHash,
    contentHash: sha256Value({ library, assets: manifest.assets }),
    revisionKey: `roomi-${manifestHash}`,
  };
}

async function ensureStoredAsset(input: {
  filePath: string;
  checksumSha256: string;
  mimeType: string;
  mediaProviderKey: string;
}) {
  const provider = await getMediaStorageProvider(input.mediaProviderKey);
  const buffer = await fs.readFile(input.filePath);
  if (sha256Hex(buffer) !== input.checksumSha256) {
    throw new Error(`Staged prompt preview checksum changed: ${path.basename(input.filePath)}`);
  }
  const logicalKey = `prompt-library/${input.checksumSha256.slice(0, 2)}/${input.checksumSha256}.${extensionForMime(input.mimeType)}`;
  const storageKey = provider.buildObjectKey?.(logicalKey) || logicalKey;
  let alreadyStored = false;
  try {
    const stat = await provider.statObject?.({ objectKey: storageKey });
    if (stat?.size === buffer.length) {
      // Object keys are content-addressed by the validated SHA-256. Matching size
      // is sufficient to resume a previous interrupted upload without downloading it.
      alreadyStored = true;
    }
  } catch {
    alreadyStored = false;
  }
  const stored = alreadyStored
    ? { checksumSha256: input.checksumSha256 }
    : await provider.putObject({ objectKey: storageKey, buffer, contentType: input.mimeType });
  return {
    storageProvider: provider.key,
    storageKey,
    storageBucket: stored.bucket,
  };
}

async function publishRevision(revision: IAiPromptLibraryRevision) {
  const publishedAt = new Date();
  await AiPromptLibraryRevision.updateOne(
    { _id: revision._id },
    { $set: { status: 'active', publishedAt }, $unset: { rolledBackAt: 1, failedAt: 1 } }
  );
  await AiPromptLibraryRevision.updateMany(
    { _id: { $ne: revision._id }, source: 'roomi', status: 'active' },
    { $set: { status: 'superseded', supersededAt: publishedAt } }
  );
  return AiPromptLibraryRevision.findById(revision._id).orFail();
}

export async function getActivePromptLibraryRevision() {
  return AiPromptLibraryRevision.findOne({ source: 'roomi', status: 'active' })
    .sort({ publishedAt: -1, createdAt: -1 });
}

export async function rollbackPromptLibraryRevision(revisionId: string) {
  const revision = await AiPromptLibraryRevision.findById(revisionId);
  if (!revision || revision.status === 'failed' || revision.status === 'staging') {
    throw new Error('Prompt library revision cannot be activated');
  }
  const current = await getActivePromptLibraryRevision();
  const activated = await publishRevision(revision);
  if (current && String(current._id) !== String(revision._id)) {
    await AiPromptLibraryRevision.updateOne(
      { _id: current._id },
      { $set: { status: 'rolled_back', rolledBackAt: new Date() } }
    );
  }
  return activated;
}

export async function importPromptLibraryRevision(input: {
  library: NormalizedPromptLibrary;
  assets: StagedPromptAsset[];
  snapshotPath?: string;
  mediaProviderKey?: string;
  onAssetProgress?: (completed: number, total: number) => void;
}) {
  const validation = validatePromptLibrary(input.library, input.assets);
  if (!validation.valid) {
    throw new Error(`Prompt library validation failed:\n${validation.errors.join('\n')}`);
  }

  const identity = createPromptLibraryRevisionIdentity(input.library, input.assets);
  const existing = await AiPromptLibraryRevision.findOne({ revisionKey: identity.revisionKey });
  if (existing) {
    const counts = await Promise.all([
      AiPromptCategory.countDocuments({ importRevision: existing._id }),
      AiPromptTemplate.countDocuments({ importRevision: existing._id }),
      AiPromptParameterTemplate.countDocuments({ importRevision: existing._id }),
      AiPromptSourceModel.countDocuments({ importRevision: existing._id }),
      AiPromptTemplateAsset.countDocuments({ importRevision: existing._id }),
    ]);
    const expected = Object.values(validation.counts);
    if (counts.every((count, index) => count === expected[index])) {
      return {
        revision: existing.status === 'active' ? existing : await publishRevision(existing),
        idempotent: true,
      };
    }
    if (existing.status !== 'staging' && existing.status !== 'failed') {
      throw new Error(`Existing prompt revision ${existing.revisionKey} is incomplete and requires operator cleanup`);
    }
    await Promise.all([
      AiPromptCategory.deleteMany({ importRevision: existing._id }),
      AiPromptTemplate.deleteMany({ importRevision: existing._id }),
      AiPromptParameterTemplate.deleteMany({ importRevision: existing._id }),
      AiPromptSourceModel.deleteMany({ importRevision: existing._id }),
      AiPromptTemplateAsset.deleteMany({ importRevision: existing._id }),
    ]);
    await AiPromptLibraryRevision.deleteOne({ _id: existing._id });
  }

  const revision = await AiPromptLibraryRevision.create({
    source: 'roomi',
    revisionKey: identity.revisionKey,
    status: 'staging',
    manifestHash: identity.manifestHash,
    contentHash: identity.contentHash,
    snapshotPath: input.snapshotPath,
    counts: validation.counts,
    validationErrors: [],
    validationWarnings: validation.warnings,
  });

  try {
    const importedAt = new Date();
    const categoryIdBySource = new Map(input.library.categories.map((item) => [item.sourceId, new mongoose.Types.ObjectId()]));
    const parameterIdBySource = new Map(input.library.parameterTemplates.map((item) => [item.sourceId, new mongoose.Types.ObjectId()]));
    const modelIdBySource = new Map(input.library.models.map((item) => [item.sourceId, new mongoose.Types.ObjectId()]));
    const assetIdByTemplate = new Map(input.assets.map((item) => [item.templateSourceId, new mongoose.Types.ObjectId()]));

    await Promise.all([
      AiPromptCategory.insertMany(input.library.categories.map((item) => ({
        _id: categoryIdBySource.get(item.sourceId),
        source: 'roomi', sourceId: item.sourceId, sourcePayload: item.sourcePayload, sourceHash: item.sourceHash,
        importRevision: revision._id, importedAt, parentSourceId: item.parentSourceId,
        parentCategoryId: item.parentSourceId ? categoryIdBySource.get(item.parentSourceId) : undefined,
        level: item.level, name: item.name, weight: item.weight, enabled: item.enabled,
      }))),
      AiPromptParameterTemplate.insertMany(input.library.parameterTemplates.map((item) => ({
        _id: parameterIdBySource.get(item.sourceId),
        source: 'roomi', sourceId: item.sourceId, sourcePayload: item.sourcePayload, sourceHash: item.sourceHash,
        importRevision: revision._id, importedAt, name: item.name, adaptationModel: item.adaptationModel,
        parameters: item.parameters, weight: item.weight, enabled: item.enabled,
      }))),
      AiPromptSourceModel.insertMany(input.library.models.map((item) => ({
        _id: modelIdBySource.get(item.sourceId),
        source: 'roomi', sourceId: item.sourceId, sourcePayload: item.sourcePayload, sourceHash: item.sourceHash,
        importRevision: revision._id, importedAt, name: item.name, modelCode: item.modelCode,
        capabilities: item.capabilities, weight: item.weight, enabled: item.enabled,
      }))),
    ]);

    const storedAssets: Array<{
      asset: StagedPromptAsset;
      storage: Awaited<ReturnType<typeof ensureStoredAsset>>;
    }> = new Array(input.assets.length);
    let nextAssetIndex = 0;
    let completedAssets = 0;
    const workers = Array.from({ length: Math.min(4, input.assets.length) }, async () => {
      while (nextAssetIndex < input.assets.length) {
        const index = nextAssetIndex;
        nextAssetIndex += 1;
        const asset = input.assets[index];
        storedAssets[index] = {
          asset,
          storage: await ensureStoredAsset({
            ...asset,
            mediaProviderKey: input.mediaProviderKey || 'local',
          }),
        };
        completedAssets += 1;
        input.onAssetProgress?.(completedAssets, input.assets.length);
      }
    });
    await Promise.all(workers);
    await AiPromptTemplateAsset.insertMany(storedAssets.map(({ asset, storage }) => ({
      _id: assetIdByTemplate.get(asset.templateSourceId),
      source: 'roomi', sourceId: `${asset.templateSourceId}:styleImage`,
      sourcePayload: { templateSourceId: asset.templateSourceId, sourceUrl: asset.sourceUrl },
      sourceHash: sha256Value({ templateSourceId: asset.templateSourceId, sourceUrl: asset.sourceUrl, checksum: asset.checksumSha256 }),
      importRevision: revision._id, importedAt, templateSourceId: asset.templateSourceId, sourceUrl: asset.sourceUrl,
      mimeType: asset.mimeType, size: asset.size, width: asset.width, height: asset.height,
      checksumSha256: asset.checksumSha256, ...storage,
    })));

    await AiPromptTemplate.insertMany(input.library.templates.map((item) => ({
      source: 'roomi', sourceId: item.sourceId, sourcePayload: item.sourcePayload, sourceHash: item.sourceHash,
      importRevision: revision._id, importedAt, name: item.name, promptContent: item.promptContent,
      categorySourceId: item.categorySourceId, categoryId: categoryIdBySource.get(item.categorySourceId),
      bestModelSourceId: item.bestModelSourceId, sourceModelId: item.bestModelSourceId ? modelIdBySource.get(item.bestModelSourceId) : undefined,
      parameterTemplateSourceId: item.parameterTemplateSourceId,
      parameterTemplateId: item.parameterTemplateSourceId ? parameterIdBySource.get(item.parameterTemplateSourceId) : undefined,
      adaptationModel: item.adaptationModel, previewAssetId: assetIdByTemplate.get(item.sourceId),
      weight: item.weight, enabled: item.enabled,
    })));

    const actualCounts = await Promise.all([
      AiPromptCategory.countDocuments({ importRevision: revision._id }),
      AiPromptTemplate.countDocuments({ importRevision: revision._id }),
      AiPromptParameterTemplate.countDocuments({ importRevision: revision._id }),
      AiPromptSourceModel.countDocuments({ importRevision: revision._id }),
      AiPromptTemplateAsset.countDocuments({ importRevision: revision._id }),
    ]);
    if (stableJson(actualCounts) !== stableJson(Object.values(validation.counts))) {
      throw new Error(`Imported prompt library counts do not match manifest: ${actualCounts.join(', ')}`);
    }

    return { revision: await publishRevision(revision), idempotent: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await AiPromptLibraryRevision.updateOne(
      { _id: revision._id },
      { $set: { status: 'failed', failedAt: new Date(), validationErrors: [message] } }
    );
    await Promise.all([
      AiPromptCategory.deleteMany({ importRevision: revision._id }),
      AiPromptTemplate.deleteMany({ importRevision: revision._id }),
      AiPromptParameterTemplate.deleteMany({ importRevision: revision._id }),
      AiPromptSourceModel.deleteMany({ importRevision: revision._id }),
      AiPromptTemplateAsset.deleteMany({ importRevision: revision._id }),
    ]);
    throw error;
  }
}
