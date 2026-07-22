import { promises as fs } from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import sharp from 'sharp';
import { MediaAsset, type IMediaAsset } from '@/models/MediaAsset';
import { AiGeneration } from '@/models/AiGeneration';
import { AiWorkflow } from '@/models/AiWorkflow';

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
};

const INTERNAL_ASSET_URL_RE = /^\/api\/ai\/assets\/([a-f0-9]{24})\/image/i;
const INTERNAL_GENERATION_URL_RE = /^\/api\/ai\/generations\/([a-f0-9]{24})\/image/i;
const INTERNAL_WORKFLOW_SOURCE_URL_RE = /^\/api\/ai\/workflows\/([a-f0-9]{24})\/source-image/i;

function resolveStoragePath(storageKey: string) {
  if (process.env.AI_ASSET_STORAGE_DIR) {
    return path.join(process.env.AI_ASSET_STORAGE_DIR, storageKey);
  }

  return path.join(/* turbopackIgnore: true */ process.cwd(), 'uploads', 'ai-assets', storageKey);
}

function toObjectId(value?: string | mongoose.Types.ObjectId) {
  if (!value) return undefined;
  return typeof value === 'string' ? new mongoose.Types.ObjectId(value) : value;
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
  const enterpriseId = toObjectId(input.enterpriseId);
  if (!enterpriseId) {
    throw new Error('Missing enterpriseId');
  }

  const storageKey = [
    String(enterpriseId),
    new Date().getFullYear().toString(),
    `${assetId}.${getExtension(input.mimeType)}`,
  ].join('/');
  const fullPath = resolveStoragePath(storageKey);

  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, input.buffer);

  let width = Number(input.width) || undefined;
  let height = Number(input.height) || undefined;
  if (!width || !height) {
    const metadata = await sharp(input.buffer).metadata().catch(() => null);
    width = Number(metadata?.width) || undefined;
    height = Number(metadata?.height) || undefined;
  }

  const asset = await MediaAsset.create({
    _id: assetId,
    enterpriseId,
    ownerType: input.ownerType,
    ownerId: toObjectId(input.ownerId),
    mimeType: input.mimeType,
    size: input.buffer.length,
    width,
    height,
    storageProvider: 'local',
    storageKey,
    originalUrl: input.originalUrl,
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
}) {
  const parsed = parseImageDataUri(input.dataUri);
  return storeMediaBuffer({
    enterpriseId: input.enterpriseId,
    ownerType: input.ownerType,
    ownerId: input.ownerId,
    mimeType: parsed.mimeType,
    buffer: parsed.buffer,
  });
}

export async function storeImageUrl(input: {
  enterpriseId: string | mongoose.Types.ObjectId;
  ownerType: MediaOwnerType;
  ownerId?: string | mongoose.Types.ObjectId;
  imageUrl: string;
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
  });
}

export async function persistImageReference(input: {
  enterpriseId: string | mongoose.Types.ObjectId;
  ownerType: MediaOwnerType;
  ownerId?: string | mongoose.Types.ObjectId;
  image?: string;
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
    });
    return imageUrl;
  }

  if (/^https?:\/\//i.test(image)) {
    const { imageUrl } = await storeImageUrl({
      enterpriseId: input.enterpriseId,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      imageUrl: image,
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

export async function readMediaAssetBuffer(asset: Pick<IMediaAsset, 'storageProvider' | 'storageKey'>) {
  if (asset.storageProvider !== 'local') {
    throw new Error('Unsupported storage provider');
  }

  return fs.readFile(resolveStoragePath(asset.storageKey));
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
    enterpriseId: toObjectId(enterpriseId),
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
    const generation = await AiGeneration.findOne({ _id: generationId, enterpriseId: toObjectId(enterpriseId) })
      .select('output.imageUrl')
      .lean();
    if (!generation?.output?.imageUrl) throw new Error('Generation image asset not found or inaccessible');
    return resolveAiProviderImageInput(generation.output.imageUrl, enterpriseId);
  }

  const workflowId = image.match(INTERNAL_WORKFLOW_SOURCE_URL_RE)?.[1];
  if (workflowId) {
    const workflow = await AiWorkflow.findOne({ _id: workflowId, enterpriseId: toObjectId(enterpriseId) })
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
