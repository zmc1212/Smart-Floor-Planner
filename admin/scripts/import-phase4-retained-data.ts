import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import sharp from 'sharp';
import { and, count, eq, ne } from 'drizzle-orm';
import { loadEnvConfig } from '@next/env';
import {
  aiPromptCategories,
  aiPromptLibraryRevisions,
  aiPromptParameterTemplates,
  aiPromptSourceModels,
  aiPromptTemplateAssets,
  aiPromptTemplates,
  mediaStorageConfigs,
  migrationCheckpoints,
  platformConfigs,
} from '../src/db/schema';
import { withPlatformTransaction } from '../src/db/transaction';
import { decryptMediaStorageSecret, encryptMediaStorageSecret, maskSecret } from '../src/lib/crypto';
import { LocalMediaStorageProvider } from '../src/lib/media-storage/local-provider';
import { testMediaStorageProvider } from '../src/lib/media-storage/config-service';
import {
  normalizePromptLibrarySnapshot,
  sha256Value,
  validatePromptLibrary,
} from '../src/lib/ai/prompt-library';
import type { PromptLibrarySnapshot, StagedPromptAsset } from '../src/lib/ai/prompt-library-types';

loadEnvConfig(process.cwd());

const EXECUTE = process.argv.includes('--execute');
const PHASE4_CHECKPOINT_KEY = 'phase4-retained-data';
const LEGACY_MONGODB_URI =
  process.env.PHASE4_LEGACY_MONGODB_URI?.trim() ||
  'mongodb://127.0.0.1:27017/fastMeasure';

type StoredPromptAsset = StagedPromptAsset & {
  storageProvider: string;
  storageKey: string;
  storageBucket: string | null;
};

type LegacyMediaStorageConfig = {
  key?: unknown;
  name?: unknown;
  driver?: unknown;
  accessKeyEncrypted?: unknown;
  accessKeyMasked?: unknown;
  secretKeyEncrypted?: unknown;
  secretKeyMasked?: unknown;
  bucket?: unknown;
  region?: unknown;
  domain?: unknown;
  objectPrefix?: unknown;
  status?: unknown;
  lastTestedAt?: unknown;
  lastTestOk?: unknown;
  lastTestMessage?: unknown;
};

type LegacyPlatformConfig = {
  key?: unknown;
  mediaStorage?: {
    activeProviderKey?: unknown;
    activatedAt?: unknown;
    persistGrsAiOutputs?: unknown;
  };
};

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalText(value: unknown) {
  return text(value) || null;
}

function date(value: unknown) {
  return value instanceof Date && !Number.isNaN(value.getTime())
    ? value
    : null;
}

function sha256(buffer: Buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function extensionForMime(mimeType: string) {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/gif') return 'gif';
  if (mimeType === 'image/avif') return 'avif';
  throw new Error(`Unsupported prompt preview MIME: ${mimeType}`);
}

function batches<T>(items: T[], batchSize = 100) {
  const result: T[][] = [];
  for (let start = 0; start < items.length; start += batchSize) {
    result.push(items.slice(start, start + batchSize));
  }
  return result;
}

function resolveSnapshotDirectory() {
  const configured = process.env.PHASE4_ROOMI_SNAPSHOT_DIR?.trim();
  if (configured) return path.resolve(configured);

  const root = path.resolve(process.cwd(), '.roomi-import');
  return fs.readdir(root, { withFileTypes: true }).then(async (entries) => {
    const candidates = [] as string[];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const directory = path.join(root, entry.name);
      try {
        await Promise.all([
          fs.access(path.join(directory, 'snapshot.json')),
          fs.access(path.join(directory, 'manifest.json')),
          fs.access(path.join(directory, 'assets', 'index.json')),
        ]);
        candidates.push(directory);
      } catch {
        // Not a complete import snapshot.
      }
    }
    if (candidates.length !== 1) {
      throw new Error(
        `Expected exactly one complete Roomi snapshot under .roomi-import; found ${candidates.length}. Set PHASE4_ROOMI_SNAPSHOT_DIR explicitly.`
      );
    }
    return candidates[0];
  });
}

async function readJson<T>(filePath: string) {
  return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
}

async function stagePromptAssets(
  snapshotDirectory: string,
  assets: StagedPromptAsset[]
) {
  const provider = new LocalMediaStorageProvider();
  const stored: StoredPromptAsset[] = new Array(assets.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(4, assets.length) }, async () => {
    while (nextIndex < assets.length) {
      const index = nextIndex;
      nextIndex += 1;
      const asset = assets[index];
      const filePath = path.isAbsolute(asset.filePath)
        ? asset.filePath
        : path.resolve(snapshotDirectory, asset.filePath);
      const buffer = await fs.readFile(filePath);
      if (buffer.length !== asset.size) {
        throw new Error(`Preview size mismatch: ${path.basename(filePath)}`);
      }
      if (sha256(buffer) !== asset.checksumSha256) {
        throw new Error(`Preview SHA-256 mismatch: ${path.basename(filePath)}`);
      }
      const metadata = await sharp(buffer, { animated: false }).metadata();
      if (metadata.width !== asset.width || metadata.height !== asset.height) {
        throw new Error(`Preview dimensions mismatch: ${path.basename(filePath)}`);
      }

      const extension = extensionForMime(asset.mimeType);
      // PostgreSQL keeps one asset row per template, while the target schema
      // intentionally makes storage locations unique. Keep the SHA-256 in the
      // key for traceability and add the template source ID for duplicate files.
      const storageKey = `prompt-library/${asset.checksumSha256.slice(0, 2)}/${asset.templateSourceId}-${asset.checksumSha256}.${extension}`;
      let alreadyStored = false;
      try {
        const existing = await provider.getObject({ objectKey: storageKey });
        alreadyStored = existing.length === buffer.length && sha256(existing) === asset.checksumSha256;
      } catch {
        alreadyStored = false;
      }
      if (!alreadyStored) {
        await provider.putObject({
          objectKey: storageKey,
          buffer,
          contentType: asset.mimeType,
        });
      }
      stored[index] = {
        ...asset,
        storageProvider: provider.key,
        storageKey,
        storageBucket: null,
      };
    }
  });

  await Promise.all(workers);
  return stored;
}

async function readLegacyMediaConfiguration() {
  const connection = await mongoose
    .createConnection(LEGACY_MONGODB_URI, { serverSelectionTimeoutMS: 10_000 })
    .asPromise();
  try {
    if (!connection.db) throw new Error('Legacy MongoDB connection has no database handle');
    const database = connection.db;
    const [mediaConfig, platformConfig] = await Promise.all([
      database
        .collection<LegacyMediaStorageConfig>('mediastorageconfigs')
        .findOne({ status: 'active' }),
      database
        .collection<LegacyPlatformConfig>('platformconfigs')
        .findOne({ key: 'default' }),
    ]);
    if (!mediaConfig) throw new Error('No active legacy Qiniu media-storage configuration was found');
    return { mediaConfig, platformConfig };
  } finally {
    await connection.close();
  }
}

async function importRetainedData(input: {
  snapshotDirectory: string;
  manifest: Record<string, unknown>;
  library: ReturnType<typeof normalizePromptLibrarySnapshot>;
  assets: StoredPromptAsset[];
  legacyMedia: Awaited<ReturnType<typeof readLegacyMediaConfiguration>>;
}) {
  const validation = validatePromptLibrary(input.library, input.assets);
  if (!validation.valid) {
    throw new Error(`Roomi snapshot validation failed: ${validation.errors.join('; ')}`);
  }
  const revisionKey = text(input.manifest.revisionKey);
  const manifestHash = text(input.manifest.manifestHash);
  const contentHash = text(input.manifest.contentHash);
  if (!revisionKey || !manifestHash || !contentHash) {
    throw new Error('Roomi manifest is missing revision identity hashes');
  }

  const legacy = input.legacyMedia.mediaConfig;
  const providerKey = text(legacy.key).toLowerCase();
  const accessKey = decryptMediaStorageSecret(text(legacy.accessKeyEncrypted));
  const secretKey = decryptMediaStorageSecret(text(legacy.secretKeyEncrypted));
  if (!accessKey || !secretKey) throw new Error('Legacy Qiniu credentials could not be decrypted');
  if (
    maskSecret(accessKey) !== text(legacy.accessKeyMasked) ||
    maskSecret(secretKey) !== text(legacy.secretKeyMasked)
  ) {
    throw new Error('Legacy Qiniu credential integrity check failed');
  }

  return withPlatformTransaction(async (transaction) => {
    const existingRevisions = await transaction
      .select()
      .from(aiPromptLibraryRevisions)
      .where(eq(aiPromptLibraryRevisions.revisionKey, revisionKey))
      .limit(1);
    const existingRevision = existingRevisions[0];
    if (existingRevision) {
      const [categoryCount, templateCount, parameterCount, modelCount, assetCount] = await Promise.all([
        transaction.select({ value: count() }).from(aiPromptCategories).where(eq(aiPromptCategories.importRevisionId, existingRevision.id)),
        transaction.select({ value: count() }).from(aiPromptTemplates).where(eq(aiPromptTemplates.importRevisionId, existingRevision.id)),
        transaction.select({ value: count() }).from(aiPromptParameterTemplates).where(eq(aiPromptParameterTemplates.importRevisionId, existingRevision.id)),
        transaction.select({ value: count() }).from(aiPromptSourceModels).where(eq(aiPromptSourceModels.importRevisionId, existingRevision.id)),
        transaction.select({ value: count() }).from(aiPromptTemplateAssets).where(eq(aiPromptTemplateAssets.importRevisionId, existingRevision.id)),
      ]);
      const actual = [categoryCount, templateCount, parameterCount, modelCount, assetCount].map((rows) => Number(rows[0]?.value ?? 0));
      const expected = [validation.counts.categories, validation.counts.templates, validation.counts.parameterTemplates, validation.counts.models, validation.counts.previewAssets];
      if (existingRevision.status !== 'active' || actual.some((value, index) => value !== expected[index])) {
        throw new Error(`Existing Roomi revision ${revisionKey} is incomplete and requires operator review`);
      }
      return {
        revisionId: existingRevision.id.toString(),
        providerKey,
        idempotent: true,
        counts: validation.counts,
      };
    }

    const importedAt = new Date();
    const [revision] = await transaction
      .insert(aiPromptLibraryRevisions)
      .values({
        source: 'roomi',
        revisionKey,
        status: 'staging',
        manifestHash,
        contentHash,
        snapshotPath: input.snapshotDirectory,
        counts: validation.counts,
        validationErrors: [],
        validationWarnings: validation.warnings,
      })
      .returning();

    const categories = await transaction
      .insert(aiPromptCategories)
      .values(
        input.library.categories.map((item) => ({
          importRevisionId: revision.id,
          parentCategoryId: null,
          source: 'roomi',
          sourceId: item.sourceId,
          parentSourceId: item.parentSourceId ?? null,
          sourcePayload: item.sourcePayload,
          sourceHash: item.sourceHash,
          importedAt,
          level: item.level,
          name: item.name,
          weight: item.weight,
          enabled: item.enabled,
        }))
      )
      .returning({ id: aiPromptCategories.id, sourceId: aiPromptCategories.sourceId, parentSourceId: aiPromptCategories.parentSourceId });
    const categoryIds = new Map(categories.map((item) => [item.sourceId, item.id]));
    for (const category of categories) {
      if (!category.parentSourceId) continue;
      const parentId = categoryIds.get(category.parentSourceId);
      if (!parentId) throw new Error(`Missing imported parent category ${category.parentSourceId}`);
      await transaction
        .update(aiPromptCategories)
        .set({ parentCategoryId: parentId })
        .where(eq(aiPromptCategories.id, category.id));
    }

    const parameterTemplates = await transaction
      .insert(aiPromptParameterTemplates)
      .values(
        input.library.parameterTemplates.map((item) => ({
          importRevisionId: revision.id,
          source: 'roomi',
          sourceId: item.sourceId,
          sourcePayload: item.sourcePayload,
          sourceHash: item.sourceHash,
          importedAt,
          name: item.name,
          adaptationModel: item.adaptationModel,
          parameters: item.parameters,
          weight: item.weight,
          enabled: item.enabled,
        }))
      )
      .returning({ id: aiPromptParameterTemplates.id, sourceId: aiPromptParameterTemplates.sourceId });
    const parameterTemplateIds = new Map(parameterTemplates.map((item) => [item.sourceId, item.id]));

    const sourceModels = await transaction
      .insert(aiPromptSourceModels)
      .values(
        input.library.models.map((item) => ({
          importRevisionId: revision.id,
          source: 'roomi',
          sourceId: item.sourceId,
          sourcePayload: item.sourcePayload,
          sourceHash: item.sourceHash,
          importedAt,
          name: item.name,
          modelCode: item.modelCode ?? null,
          capabilities: item.capabilities,
          weight: item.weight,
          enabled: item.enabled,
        }))
      )
      .returning({ id: aiPromptSourceModels.id, sourceId: aiPromptSourceModels.sourceId });
    const sourceModelIds = new Map(sourceModels.map((item) => [item.sourceId, item.id]));

    const templateAssets: Array<{ id: bigint; templateSourceId: string }> = [];
    for (const assetBatch of batches(input.assets)) {
      const created = await transaction
        .insert(aiPromptTemplateAssets)
        .values(
          assetBatch.map((asset) => ({
          importRevisionId: revision.id,
          source: 'roomi',
          sourceId: `${asset.templateSourceId}:styleImage`,
          templateSourceId: asset.templateSourceId,
          sourcePayload: { templateSourceId: asset.templateSourceId, sourceUrl: asset.sourceUrl },
          sourceHash: sha256Value({
            templateSourceId: asset.templateSourceId,
            sourceUrl: asset.sourceUrl,
            checksum: asset.checksumSha256,
          }),
          importedAt,
          sourceUrl: asset.sourceUrl,
          mimeType: asset.mimeType,
          size: BigInt(asset.size),
          width: asset.width,
          height: asset.height,
          checksumSha256: asset.checksumSha256,
          storageProvider: asset.storageProvider,
          storageKey: asset.storageKey,
          storageBucket: asset.storageBucket,
          }))
        )
        .returning({ id: aiPromptTemplateAssets.id, templateSourceId: aiPromptTemplateAssets.templateSourceId });
      templateAssets.push(...created);
    }
    const templateAssetIds = new Map(templateAssets.map((item) => [item.templateSourceId, item.id]));

    for (const templateBatch of batches(input.library.templates)) {
      await transaction.insert(aiPromptTemplates).values(
        templateBatch.map((item) => {
        const categoryId = categoryIds.get(item.categorySourceId);
        const previewAssetId = templateAssetIds.get(item.sourceId);
        if (!categoryId || !previewAssetId) {
          throw new Error(`Template ${item.sourceId} has unresolved imported relations`);
        }
        return {
          importRevisionId: revision.id,
          categoryId,
          sourceModelId: item.bestModelSourceId ? sourceModelIds.get(item.bestModelSourceId) ?? null : null,
          parameterTemplateId: item.parameterTemplateSourceId ? parameterTemplateIds.get(item.parameterTemplateSourceId) ?? null : null,
          previewAssetId,
          source: 'roomi',
          sourceId: item.sourceId,
          sourcePayload: item.sourcePayload,
          sourceHash: item.sourceHash,
          importedAt,
          name: item.name,
          promptContent: item.promptContent,
          categorySourceId: item.categorySourceId,
          bestModelSourceId: item.bestModelSourceId ?? null,
          parameterTemplateSourceId: item.parameterTemplateSourceId ?? null,
          adaptationModel: item.adaptationModel,
          weight: item.weight,
          enabled: item.enabled,
        };
        })
      );
    }

    await transaction
      .update(aiPromptLibraryRevisions)
      .set({ status: 'superseded', supersededAt: importedAt, updatedAt: importedAt })
      .where(
        and(
          eq(aiPromptLibraryRevisions.source, 'roomi'),
          eq(aiPromptLibraryRevisions.status, 'active'),
          ne(aiPromptLibraryRevisions.id, revision.id)
        )
      );
    await transaction
      .update(aiPromptLibraryRevisions)
      .set({ status: 'active', publishedAt: importedAt, updatedAt: importedAt })
      .where(eq(aiPromptLibraryRevisions.id, revision.id));

    const mediaRows = await transaction
      .select()
      .from(mediaStorageConfigs)
      .where(eq(mediaStorageConfigs.key, providerKey))
      .limit(1);
    let mediaConfig = mediaRows[0];
    if (!mediaConfig) {
      const [created] = await transaction
        .insert(mediaStorageConfigs)
        .values({
          key: providerKey,
          name: text(legacy.name) || providerKey,
          driver: text(legacy.driver) || 'qiniu',
          accessKeyEncrypted: encryptMediaStorageSecret(accessKey),
          accessKeyMasked: maskSecret(accessKey),
          secretKeyEncrypted: encryptMediaStorageSecret(secretKey),
          secretKeyMasked: maskSecret(secretKey),
          bucket: text(legacy.bucket),
          region: text(legacy.region),
          domain: text(legacy.domain),
          objectPrefix: text(legacy.objectPrefix),
          status: legacy.status === 'archived' ? 'archived' : 'active',
          lastTestedAt: date(legacy.lastTestedAt),
          lastTestOk: typeof legacy.lastTestOk === 'boolean' ? legacy.lastTestOk : null,
          lastTestMessage: optionalText(legacy.lastTestMessage),
          createdBy: null,
          updatedBy: null,
        })
        .returning();
      mediaConfig = created;
    }

    const legacyPlatform = input.legacyMedia.platformConfig;
    const legacyState = legacyPlatform?.mediaStorage;
    const currentPlatformRows = await transaction
      .select()
      .from(platformConfigs)
      .where(eq(platformConfigs.key, 'default'))
      .limit(1);
    const currentPlatform = currentPlatformRows[0];
    const mediaStorage = {
      ...(currentPlatform?.mediaStorage ?? {}),
      activeProviderKey: text(legacyState?.activeProviderKey) || mediaConfig.key,
      activatedAt: date(legacyState?.activatedAt)?.toISOString() ?? null,
      activatedBy: null,
      persistGrsAiOutputs: legacyState?.persistGrsAiOutputs === true,
    };
    await transaction
      .insert(platformConfigs)
      .values({ key: 'default', mediaStorage, promotionConfig: currentPlatform?.promotionConfig ?? {} })
      .onConflictDoUpdate({
        target: platformConfigs.key,
        set: { mediaStorage, updatedAt: importedAt },
      });

    await transaction
      .insert(migrationCheckpoints)
      .values({
        key: PHASE4_CHECKPOINT_KEY,
        phase: 'phase4',
        status: 'imported',
        details: {
          revisionKey,
          manifestHash,
          contentHash,
          counts: validation.counts,
          mediaProviderKey: mediaConfig.key,
          qiniuProbe: 'pending',
        },
      })
      .onConflictDoUpdate({
        target: migrationCheckpoints.key,
        set: {
          phase: 'phase4',
          status: 'imported',
          details: {
            revisionKey,
            manifestHash,
            contentHash,
            counts: validation.counts,
            mediaProviderKey: mediaConfig.key,
            qiniuProbe: 'pending',
          },
          updatedAt: importedAt,
        },
      });

    return {
      revisionId: revision.id.toString(),
      providerKey: mediaConfig.key,
      idempotent: false,
      counts: validation.counts,
    };
  });
}

async function verifyStoredAssets(assets: StoredPromptAsset[]) {
  const provider = new LocalMediaStorageProvider();
  for (const asset of assets) {
    const buffer = await provider.getObject({ objectKey: asset.storageKey });
    if (buffer.length !== asset.size || sha256(buffer) !== asset.checksumSha256) {
      throw new Error(`Stored preview verification failed: ${asset.templateSourceId}`);
    }
  }
}

async function markQiniuProbePassed() {
  await withPlatformTransaction(async (transaction) => {
    const rows = await transaction
      .select()
      .from(migrationCheckpoints)
      .where(eq(migrationCheckpoints.key, PHASE4_CHECKPOINT_KEY))
      .limit(1);
    if (!rows[0]) throw new Error('Phase 4 checkpoint is missing');
    await transaction
      .update(migrationCheckpoints)
      .set({
        status: 'codex_verified',
        details: { ...rows[0].details, qiniuProbe: 'passed' },
        updatedAt: new Date(),
      })
      .where(eq(migrationCheckpoints.key, PHASE4_CHECKPOINT_KEY));
  });
}

async function runAndRecordQiniuProbe(providerKey: string) {
  const result = await testMediaStorageProvider(providerKey);
  await withPlatformTransaction(async (transaction) => {
    await transaction
      .update(mediaStorageConfigs)
      .set({
        lastTestedAt: new Date(),
        lastTestOk: true,
        lastTestMessage: result.message,
        updatedAt: new Date(),
      })
      .where(eq(mediaStorageConfigs.key, providerKey));
  });
}

async function main() {
  if (!EXECUTE) {
    throw new Error('Refusing to mutate data without --execute');
  }

  const snapshotDirectory = await resolveSnapshotDirectory();
  const [manifest, snapshot, stagedAssets] = await Promise.all([
    readJson<Record<string, unknown>>(path.join(snapshotDirectory, 'manifest.json')),
    readJson<PromptLibrarySnapshot>(path.join(snapshotDirectory, 'snapshot.json')),
    readJson<StagedPromptAsset[]>(path.join(snapshotDirectory, 'assets', 'index.json')),
  ]);
  const library = normalizePromptLibrarySnapshot(snapshot);
  const storedAssets = await stagePromptAssets(snapshotDirectory, stagedAssets);
  const legacyMedia = await readLegacyMediaConfiguration();
  const result = await importRetainedData({
    snapshotDirectory,
    manifest,
    library,
    assets: storedAssets,
    legacyMedia,
  });
  await verifyStoredAssets(storedAssets);
  await runAndRecordQiniuProbe(result.providerKey);
  await markQiniuProbePassed();
  console.log(JSON.stringify({ success: true, ...result, verifiedAssets: storedAssets.length }, null, 2));
}

main().catch((error) => {
  const cause = error && typeof error === 'object' && 'cause' in error
    ? (error as { cause?: { message?: unknown; code?: unknown; detail?: unknown } }).cause
    : undefined;
  console.error('[Phase 4 Import]', JSON.stringify({
    message: (error instanceof Error ? error.message : String(error)).slice(0, 500),
    cause: cause?.message,
    code: cause?.code,
    detail: cause?.detail,
  }));
  process.exitCode = 1;
});
