import crypto from 'node:crypto';
import sharp from 'sharp';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { parsePostgresId } from '@/db/postgres-dto';
import {
  aiCreationBatchReferenceAssets,
  aiCreationTaskReferenceAssets,
  aiGenerations,
  aiWorkflows,
} from '@/db/schema';
import {
  AiCreationRepository,
  type MediaAssetRecord,
} from '@/db/repositories';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { getSignedMiniAiAssetUrl } from '@/lib/ai/mini-ai-assets';
import {
  alignedSignedUrlExpiresInSeconds,
  persistMediaObject,
  resolveMediaObjectDelivery,
} from '@/lib/media-storage/operations';
import {
  getDefaultMediaStorageProvider,
  getMediaStorageProvider,
} from '@/lib/media-storage/registry';
import {
  getDirectQiniuDisplayUrlsEnabled,
  shouldUseDirectQiniuDisplayUrl,
} from '@/lib/media-storage/config-service';
import type { MediaStorageProvider } from '@/lib/media-storage/types';

export type PostgresMediaOwnerType =
  | 'ai_workflow_source'
  | 'ai_generation_output'
  | 'ai_generation_input'
  | 'manual_upload'
  | 'lead_site_photo'
  | 'enterprise_logo'
  | 'staff_wechat_qr'
  | 'floor_plan_preview';

type StorePostgresMediaInput = {
  enterpriseId: bigint;
  ownerType: PostgresMediaOwnerType;
  ownerId?: bigint;
  mimeType: string;
  buffer: Buffer;
  originalUrl?: string;
  width?: number;
  height?: number;
  storageProviderKey?: string;
  provider?: MediaStorageProvider;
};

const POSTGRES_ASSET_IMAGE_RE = /\/api\/(?:ai|miniprogram\/ai)\/assets\/([1-9]\d*)\/image/i;
const DEFAULT_DISPLAY_URL_TTL_SECONDS = 7 * 24 * 3600;

export function parseImageDataUri(value: string) {
  const match = value.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) throw new Error('Unsupported image data URI');
  return { mimeType: match[1], buffer: Buffer.from(match[2], 'base64') };
}

function getExtension(mimeType: string) {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/gif') return 'gif';
  return 'bin';
}

function signedReadTtlSeconds() {
  const configured = Number(process.env.MEDIA_ASSET_SIGNED_URL_TTL_SECONDS || 3600);
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 3600;
}

/** Aligned display TTL for Mini Program / CDN image URLs (default 7 days). */
export function mediaAssetDisplayUrlTtlSeconds() {
  const configured = Number(process.env.MEDIA_ASSET_DISPLAY_URL_TTL_SECONDS || DEFAULT_DISPLAY_URL_TTL_SECONDS);
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : DEFAULT_DISPLAY_URL_TTL_SECONDS;
}

export function getPostgresMediaAssetImageUrl(assetId: bigint | string, variant?: 'thumb' | 'original') {
  const suffix = variant ? `?variant=${variant}` : '';
  return `/api/ai/assets/${assetId.toString()}/image${suffix}`;
}

export function getPostgresAssetIdFromImageUrl(value?: string | null) {
  const match = value?.match(POSTGRES_ASSET_IMAGE_RE);
  return match ? BigInt(match[1]) : undefined;
}

export function collectPostgresAssetIdsFromImageUrls(values: Array<string | null | undefined>) {
  const ids = new Set<string>();
  for (const value of values) {
    const assetId = getPostgresAssetIdFromImageUrl(value);
    if (assetId) ids.add(assetId.toString());
  }
  return [...ids].map((id) => BigInt(id));
}

/**
 * Batch-resolve media assets to stable display URLs.
 * When the platform `directQiniuDisplayUrls` switch is on (default), use a Qiniu
 * private download URL with an aligned deadline; otherwise (or for local storage)
 * use an aligned Mini Program signed API URL.
 */
export async function resolveMediaAssetDisplayUrls(input: {
  request: Request;
  enterpriseId: string | bigint;
  assetIds: Array<string | bigint>;
  ttlSeconds?: number;
  directQiniuDisplayUrls?: boolean;
}): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const uniqueIds = [...new Set(
    input.assetIds
      .map((id) => String(id || '').trim())
      .filter((id) => /^[1-9]\d*$/.test(id))
  )];
  if (!uniqueIds.length) return result;

  const enterpriseId = typeof input.enterpriseId === 'bigint'
    ? input.enterpriseId
    : parsePostgresId(String(input.enterpriseId), 'enterpriseId');
  const enterpriseIdText = enterpriseId.toString();
  const ttlSeconds = input.ttlSeconds ?? mediaAssetDisplayUrlTtlSeconds();
  let directQiniuDisplayUrls = input.directQiniuDisplayUrls;
  if (directQiniuDisplayUrls === undefined) {
    if (!process.env.DATABASE_URL) {
      directQiniuDisplayUrls = true;
    } else {
      try {
        directQiniuDisplayUrls = await getDirectQiniuDisplayUrlsEnabled();
      } catch (error) {
        console.error('[Media Asset Display URL] platform switch lookup failed', error);
        directQiniuDisplayUrls = true;
      }
    }
  }

  const signedApiUrl = (assetId: string) => getSignedMiniAiAssetUrl({
    request: input.request,
    assetId,
    enterpriseId: enterpriseIdText,
    ttlSeconds,
    alignDeadline: true,
  });

  if (!directQiniuDisplayUrls) {
    for (const assetId of uniqueIds) result.set(assetId, signedApiUrl(assetId));
    return result;
  }

  let assets: MediaAssetRecord[] = [];
  try {
    assets = await withTenantTransaction(enterpriseId, (transaction) =>
      new AiCreationRepository(transaction).findMediaAssets(uniqueIds.map((id) => BigInt(id)))
    );
  } catch (error) {
    console.error('[Media Asset Display URL] lookup failed', error);
  }
  const byId = new Map(assets.map((asset) => [asset.id.toString(), asset]));

  await Promise.all(uniqueIds.map(async (assetId) => {
    const fallbackUrl = signedApiUrl(assetId);
    const asset = byId.get(assetId);
    if (!asset) {
      result.set(assetId, fallbackUrl);
      return;
    }
    try {
      const provider = await getMediaStorageProvider(asset.storageProvider || 'local');
      if (shouldUseDirectQiniuDisplayUrl({
        directQiniuDisplayUrls,
        hasSignedReadUrl: Boolean(provider.createSignedReadUrl),
      }) && provider.createSignedReadUrl) {
        const url = await provider.createSignedReadUrl({
          objectKey: asset.storageKey,
          bucket: asset.storageBucket || undefined,
          expiresInSeconds: alignedSignedUrlExpiresInSeconds(ttlSeconds),
        });
        result.set(assetId, url);
        return;
      }
    } catch (error) {
      console.error('[Media Asset Display URL]', error);
    }
    result.set(assetId, fallbackUrl);
  }));

  return result;
}

/**
 * Storage I/O completes before the short RLS transaction that records its
 * metadata. `persistMediaObject` deletes the uploaded object when that commit
 * fails, so a failed database write does not leave a deliverable orphan.
 */
export async function storePostgresMediaBuffer(input: StorePostgresMediaInput) {
  const assetToken = crypto.randomUUID();
  const logicalStorageKey = [
    input.enterpriseId.toString(),
    new Date().getFullYear().toString(),
    `${assetToken}.${getExtension(input.mimeType)}`,
  ].join('/');
  const provider = input.provider || (input.storageProviderKey
    ? await getMediaStorageProvider(input.storageProviderKey)
    : await getDefaultMediaStorageProvider());
  const storageKey = provider.buildObjectKey?.(logicalStorageKey) || logicalStorageKey;

  let width = Number(input.width) || undefined;
  let height = Number(input.height) || undefined;
  if (!width || !height) {
    const metadata = await sharp(input.buffer).metadata().catch(() => null);
    width = Number(metadata?.width) || undefined;
    height = Number(metadata?.height) || undefined;
  }

  const { value: asset } = await persistMediaObject({
    provider,
    objectKey: storageKey,
    buffer: input.buffer,
    contentType: input.mimeType,
    commit: (stored) => withTenantTransaction(input.enterpriseId, (transaction) =>
      new AiCreationRepository(transaction).createMediaAsset({
        enterpriseId: input.enterpriseId,
        ownerType: input.ownerType,
        ownerId: input.ownerId ?? null,
        mimeType: input.mimeType,
        size: BigInt(input.buffer.length),
        width,
        height,
        storageProvider: provider.key,
        storageKey,
        storageBucket: stored.bucket,
        checksumSha256: stored.checksumSha256,
        originalUrl: input.originalUrl,
      })
    ),
  });

  return { asset, imageUrl: getPostgresMediaAssetImageUrl(asset.id) };
}

export async function readPostgresMediaAssetBuffer(
  asset: Pick<MediaAssetRecord, 'storageProvider' | 'storageKey' | 'storageBucket'>
) {
  const provider = await getMediaStorageProvider(asset.storageProvider || 'local');
  return provider.getObject({ objectKey: asset.storageKey, bucket: asset.storageBucket || undefined });
}

export async function resolvePostgresMediaAssetDelivery(
  asset: Pick<MediaAssetRecord, 'storageProvider' | 'storageKey' | 'storageBucket'>
) {
  const provider = await getMediaStorageProvider(asset.storageProvider || 'local');
  return resolveMediaObjectDelivery({
    provider,
    location: { objectKey: asset.storageKey, bucket: asset.storageBucket || undefined },
    expiresInSeconds: signedReadTtlSeconds(),
  });
}

export async function updatePostgresMediaAssetOwner(
  enterpriseId: bigint,
  imageUrl: string | undefined,
  ownerId: bigint
) {
  const assetId = getPostgresAssetIdFromImageUrl(imageUrl);
  if (!assetId) return;
  await withTenantTransaction(enterpriseId, (transaction) =>
    new AiCreationRepository(transaction).updateMediaAsset(assetId, { ownerId })
  );
}

/** Deep-collects media asset ids referenced by synthetic image URLs inside a JSON record. */
export function collectAssetIdsFromMediaRecord(value: unknown): bigint[] {
  const ids = new Set<string>();
  const visit = (node: unknown) => {
    if (typeof node === 'string') {
      const assetId = getPostgresAssetIdFromImageUrl(node);
      if (assetId) ids.add(assetId.toString());
    } else if (Array.isArray(node)) {
      node.forEach(visit);
    } else if (node && typeof node === 'object') {
      Object.values(node).forEach(visit);
    }
  };
  visit(value);
  return [...ids].map((id) => BigInt(id));
}

/**
 * Soft-deletes the media assets produced by a deleted generation so the purge
 * runner can reclaim their storage objects later. The generation row must
 * already carry `deleted_at` inside this transaction, so the live-generation
 * check below naturally skips it. An asset is kept (not marked) while any of
 * these still references it:
 * - another live generation's input/output JSON (cross-round reference URLs)
 * - a workflow's `source_image` URL
 * - a hard reference row in `ai_creation_task_reference_assets` /
 *   `ai_creation_batch_reference_assets` (legacy creation pipeline inputs)
 *
 * Returns the asset ids that were actually marked.
 */
export async function softDeleteGenerationMediaAssetsInTransaction(
  transaction: PostgresTransaction,
  input: { enterpriseId: bigint; generationId: bigint; output: unknown }
) {
  const candidateIds = collectAssetIdsFromMediaRecord(input.output);
  if (!candidateIds.length) return [];

  const patterns = candidateIds.map((id) => `%/api/ai/assets/${id.toString()}/image%`);
  const referenced = new Set<string>();
  const scanRecord = (value: unknown) => {
    for (const assetId of collectAssetIdsFromMediaRecord(value)) {
      const key = assetId.toString();
      if (candidateIds.some((candidate) => candidate.toString() === key)) referenced.add(key);
    }
  };

  const generationHaystacks = await transaction
    .select({ input: aiGenerations.input, output: aiGenerations.output })
    .from(aiGenerations)
    .where(and(
      eq(aiGenerations.enterpriseId, input.enterpriseId),
      sql`${aiGenerations.deletedAt} is null`,
      or(...patterns.map((pattern) => sql`concat(${aiGenerations.input}::text, ' ', ${aiGenerations.output}::text) like ${pattern}`))
    ));
  generationHaystacks.forEach((row) => {
    scanRecord(row.input);
    scanRecord(row.output);
  });

  const workflowSources = await transaction
    .select({ sourceImage: aiWorkflows.sourceImage })
    .from(aiWorkflows)
    .where(and(
      eq(aiWorkflows.enterpriseId, input.enterpriseId),
      or(...patterns.map((pattern) => sql`${aiWorkflows.sourceImage} like ${pattern}`))
    ));
  workflowSources.forEach((row) => scanRecord(row.sourceImage));

  const taskReferenceHits = await transaction
    .select({ assetId: aiCreationTaskReferenceAssets.assetId })
    .from(aiCreationTaskReferenceAssets)
    .where(inArray(aiCreationTaskReferenceAssets.assetId, candidateIds));
  taskReferenceHits.forEach((row) => referenced.add(row.assetId.toString()));

  const batchReferenceHits = await transaction
    .select({ assetId: aiCreationBatchReferenceAssets.assetId })
    .from(aiCreationBatchReferenceAssets)
    .where(inArray(aiCreationBatchReferenceAssets.assetId, candidateIds));
  batchReferenceHits.forEach((row) => referenced.add(row.assetId.toString()));

  const eligibleIds = candidateIds.filter((id) => !referenced.has(id.toString()));
  if (!eligibleIds.length) return [];
  const marked = await new AiCreationRepository(transaction).markMediaAssetsDeleted(eligibleIds);
  return marked.map((row) => row.id);
}
