import mongoose from 'mongoose';
import sharp from 'sharp';
import { MediaAsset, type IMediaAsset } from '@/models/MediaAsset';
import { AiGeneration } from '@/models/AiGeneration';
import { AiWorkflow } from '@/models/AiWorkflow';
import { persistMediaObject, resolveMediaObjectDelivery } from '@/lib/media-storage/operations';
import { getDefaultMediaStorageProvider, getMediaStorageProvider } from '@/lib/media-storage/registry';

type MediaOwnerType = IMediaAsset['ownerType'];

type StoreMediaInput = {
  enterpriseId: string | mongoose.Types.ObjectId;
  ownerType: MediaOwnerType;
  ownerId?: string | mongoose.Types.ObjectId;
  mimeType: string;
  buffer: Buffer;
  originalUrl?: string;
  width?: number;
  height?: number;
  storageProviderKey?: string;
};

const INTERNAL_ASSET_URL_RE = /^\/api\/ai\/assets\/([a-f0-9]{24})\/image/i;
const INTERNAL_GENERATION_URL_RE = /^\/api\/ai\/generations\/([a-f0-9]{24})\/image/i;
const INTERNAL_WORKFLOW_SOURCE_URL_RE = /^\/api\/ai\/workflows\/([a-f0-9]{24})\/source-image/i;

function toObjectId(value?: string | mongoose.Types.ObjectId) {
  if (!value) return undefined;
  return typeof value === 'string' ? new mongoose.Types.ObjectId(value) : value;
}

function asEnterpriseId(value?: string | mongoose.Types.ObjectId) {
  if (!value) return undefined;
  return value;
}

function getExtension(mimeType: string) {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/gif') return 'gif';
  return 'bin';
}

export function isInternalAssetImageUrl(value?: string | null) {
  return Boolean(value && INTERNAL_ASSET_URL_RE.test(value));
}

export function getMediaAssetImageUrl(assetId: string, variant?: 'thumb' | 'original') {
  const suffix = variant ? `?variant=${variant}` : '';
  return `/api/ai/assets/${assetId}/image${suffix}`;
}

export function getAssetIdFromImageUrl(value?: string | null) {
  const match = value?.match(INTERNAL_ASSET_URL_RE);
  return match?.[1];
}

export function parseImageDataUri(dataUri: string) {
  const match = dataUri.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    throw new Error('Only image data URIs are supported.');
  }

  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], 'base64'),
  };
}

export async function storeMediaBuffer(input: StoreMediaInput) {
  const assetId = new mongoose.Types.ObjectId();
  const enterpriseId = asEnterpriseId(input.enterpriseId);
  if (!enterpriseId) {
    throw new Error('Missing enterpriseId');
  }

  const logicalStorageKey = [
    String(enterpriseId),
    new Date().getFullYear().toString(),
    `${assetId}.${getExtension(input.mimeType)}`,
  ].join('/');
  const provider = input.storageProviderKey
    ? await getMediaStorageProvider(input.storageProviderKey)
    : await getDefaultMediaStorageProvider();
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
    commit: (stored) => MediaAsset.create({
      _id: assetId,
      enterpriseId,
      ownerType: input.ownerType,
      ownerId: toObjectId(input.ownerId),
      mimeType: input.mimeType,
      size: input.buffer.length,
      width,
      height,
      storageProvider: provider.key,
      storageKey,
      storageBucket: stored.bucket,
      checksumSha256: stored.checksumSha256,
      originalUrl: input.originalUrl,
    }),
  });

  return {
    asset,
    imageUrl: getMediaAssetImageUrl(String(asset._id)),
  };
}

export async function storeImageDataUri(input: {
  enterpriseId: string | mongoose.Types.ObjectId;
  ownerType: MediaOwnerType;
  ownerId?: string | mongoose.Types.ObjectId;
  dataUri: string;
  storageProviderKey?: string;
}) {
  const parsed = parseImageDataUri(input.dataUri);
  return storeMediaBuffer({
    enterpriseId: input.enterpriseId,
    ownerType: input.ownerType,
    ownerId: input.ownerId,
    mimeType: parsed.mimeType,
    buffer: parsed.buffer,
    storageProviderKey: input.storageProviderKey,
  });
}

export async function storeImageUrl(input: {
  enterpriseId: string | mongoose.Types.ObjectId;
  ownerType: MediaOwnerType;
  ownerId?: string | mongoose.Types.ObjectId;
  imageUrl: string;
  storageProviderKey?: string;
}) {
  const response = await fetch(input.imageUrl, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to persist image asset (${response.status})`);
  }

  const contentType = response.headers.get('content-type')?.split(';')[0] || 'image/png';
  if (!contentType.startsWith('image/')) {
    throw new Error('Remote asset is not an image');
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return storeMediaBuffer({
    enterpriseId: input.enterpriseId,
    ownerType: input.ownerType,
    ownerId: input.ownerId,
    mimeType: contentType,
    buffer,
    originalUrl: input.imageUrl,
    storageProviderKey: input.storageProviderKey,
  });
}

export async function persistImageReference(input: {
  enterpriseId: string | mongoose.Types.ObjectId;
  ownerType: MediaOwnerType;
  ownerId?: string | mongoose.Types.ObjectId;
  image?: string;
  storageProviderKey?: string;
}) {
  const image = input.image?.trim();
  if (!image || isInternalAssetImageUrl(image) || image.startsWith('/')) {
    return image;
  }

  if (image.startsWith('data:image')) {
    const { imageUrl } = await storeImageDataUri({
      enterpriseId: input.enterpriseId,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      dataUri: image,
      storageProviderKey: input.storageProviderKey,
    });
    return imageUrl;
  }

  if (/^https?:\/\//i.test(image)) {
    const { imageUrl } = await storeImageUrl({
      enterpriseId: input.enterpriseId,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      imageUrl: image,
      storageProviderKey: input.storageProviderKey,
    });
    return imageUrl;
  }

  return image;
}

export async function updateMediaAssetOwner(imageUrl: string | undefined, ownerId: string | mongoose.Types.ObjectId) {
  const assetId = getAssetIdFromImageUrl(imageUrl);
  if (!assetId) return;
  await MediaAsset.updateOne({ _id: assetId }, { $set: { ownerId: toObjectId(ownerId) } });
}

export async function readMediaAssetBuffer(
  asset: Pick<IMediaAsset, 'storageProvider' | 'storageKey' | 'storageBucket'>
) {
  const provider = await getMediaStorageProvider(asset.storageProvider || 'local');
  return provider.getObject({ objectKey: asset.storageKey, bucket: asset.storageBucket });
}

function signedReadTtlSeconds() {
  const configured = Number(process.env.MEDIA_ASSET_SIGNED_URL_TTL_SECONDS || 3600);
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 3600;
}

export async function resolveMediaAssetDelivery(
  asset: Pick<IMediaAsset, 'storageProvider' | 'storageKey' | 'storageBucket'>
) {
  const provider = await getMediaStorageProvider(asset.storageProvider || 'local');
  return resolveMediaObjectDelivery({
    provider,
    location: { objectKey: asset.storageKey, bucket: asset.storageBucket },
    expiresInSeconds: signedReadTtlSeconds(),
  });
}

export async function ensureMediaAssetDimensions(asset: IMediaAsset | null | undefined) {
  if (!asset) return undefined;
  const storedWidth = Number(asset.width);
  const storedHeight = Number(asset.height);
  if (storedWidth > 0 && storedHeight > 0) {
    return { width: storedWidth, height: storedHeight };
  }

  const metadata = await sharp(await readMediaAssetBuffer(asset)).metadata().catch(() => null);
  const width = Number(metadata?.width);
  const height = Number(metadata?.height);
  if (!(width > 0 && height > 0)) return undefined;
  await MediaAsset.updateOne({ _id: asset._id }, { $set: { width, height } });
  asset.width = width;
  asset.height = height;
  return { width, height };
}

export async function readInternalAssetAsDataUri(imageUrl: string, enterpriseId: string | mongoose.Types.ObjectId) {
  const assetId = getAssetIdFromImageUrl(imageUrl);
  if (!assetId) return undefined;

  const asset = await MediaAsset.findOne({
    _id: assetId,
    enterpriseId: asEnterpriseId(enterpriseId),
    deletedAt: { $exists: false },
  });
  if (!asset) return undefined;

  const buffer = await readMediaAssetBuffer(asset);
  return `data:${asset.mimeType};base64,${buffer.toString('base64')}`;
}

export async function resolveAiProviderImageInput(
  image: string,
  enterpriseId: string | mongoose.Types.ObjectId
): Promise<string> {
  const generationId = image.match(INTERNAL_GENERATION_URL_RE)?.[1];
  if (generationId) {
    const generation = await AiGeneration.findOne({ _id: generationId, enterpriseId: asEnterpriseId(enterpriseId) })
      .select('output.imageUrl')
      .lean();
    if (!generation?.output?.imageUrl) throw new Error('Generation image asset not found or inaccessible');
    return resolveAiProviderImageInput(generation.output.imageUrl, enterpriseId);
  }

  const workflowId = image.match(INTERNAL_WORKFLOW_SOURCE_URL_RE)?.[1];
  if (workflowId) {
    const workflow = await AiWorkflow.findOne({ _id: workflowId, enterpriseId: asEnterpriseId(enterpriseId) })
      .select('sourceImage')
      .lean();
    if (!workflow?.sourceImage) throw new Error('Workflow source image not found or inaccessible');
    return resolveAiProviderImageInput(workflow.sourceImage, enterpriseId);
  }

  if (isInternalAssetImageUrl(image)) {
    const dataUri = await readInternalAssetAsDataUri(image, enterpriseId);
    if (!dataUri) throw new Error('Image asset not found or inaccessible');
    return dataUri;
  }
  return image;
}
