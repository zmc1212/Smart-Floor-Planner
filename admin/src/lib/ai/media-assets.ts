import { promises as fs } from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { MediaAsset, type IMediaAsset } from '@/models/MediaAsset';
import { AiGeneration } from '@/models/AiGeneration';
import { AiWorkflow } from '@/models/AiWorkflow';
import { uploadMedia } from '@/lib/ai/pollinations';

type MediaOwnerType = IMediaAsset['ownerType'];

type StoreMediaInput = {
  enterpriseId: string | mongoose.Types.ObjectId;
  ownerType: MediaOwnerType;
  ownerId?: string | mongoose.Types.ObjectId;
  mimeType: string;
  buffer: Buffer;
  originalUrl?: string;
};

const INTERNAL_ASSET_URL_RE = /^\/api\/ai\/assets\/([a-f0-9]{24})\/image/i;
const INTERNAL_GENERATION_URL_RE = /^\/api\/ai\/generations\/([a-f0-9]{24})\/image/i;
const INTERNAL_WORKFLOW_SOURCE_URL_RE = /^\/api\/ai\/workflows\/([a-f0-9]{24})\/source-image/i;

function getStorageRoot() {
  return process.env.AI_ASSET_STORAGE_DIR || path.join(process.cwd(), 'uploads', 'ai-assets');
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
  const fullPath = path.join(getStorageRoot(), storageKey);

  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, input.buffer);

  const asset = await MediaAsset.create({
    _id: assetId,
    enterpriseId,
    ownerType: input.ownerType,
    ownerId: toObjectId(input.ownerId),
    mimeType: input.mimeType,
    size: input.buffer.length,
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

  return fs.readFile(path.join(getStorageRoot(), asset.storageKey));
}

export async function readInternalAssetAsDataUri(imageUrl: string, enterpriseId: string | mongoose.Types.ObjectId) {
  const assetId = getAssetIdFromImageUrl(imageUrl);
  if (!assetId) return undefined;

  const asset = await MediaAsset.findOne({ _id: assetId, enterpriseId: toObjectId(enterpriseId) });
  if (!asset) return undefined;

  const buffer = await readMediaAssetBuffer(asset);
  return `data:${asset.mimeType};base64,${buffer.toString('base64')}`;
}

export async function ensureModelAccessibleImageUrl(
  image: string,
  enterpriseId: string | mongoose.Types.ObjectId,
  apiKey?: string
) {
  const generationId = image.match(INTERNAL_GENERATION_URL_RE)?.[1];
  if (generationId) {
    const generation = await AiGeneration.findOne({ _id: generationId, enterpriseId: toObjectId(enterpriseId) })
      .select('output.imageUrl')
      .lean();
    if (!generation?.output?.imageUrl) {
      throw new Error('Generation image asset not found or inaccessible');
    }
    return ensureModelAccessibleImageUrl(generation.output.imageUrl, enterpriseId, apiKey);
  }

  const workflowId = image.match(INTERNAL_WORKFLOW_SOURCE_URL_RE)?.[1];
  if (workflowId) {
    const workflow = await AiWorkflow.findOne({ _id: workflowId, enterpriseId: toObjectId(enterpriseId) })
      .select('sourceImage')
      .lean();
    if (!workflow?.sourceImage) {
      throw new Error('Workflow source image not found or inaccessible');
    }
    return ensureModelAccessibleImageUrl(workflow.sourceImage, enterpriseId, apiKey);
  }

  if (isInternalAssetImageUrl(image)) {
    const dataUri = await readInternalAssetAsDataUri(image, enterpriseId);
    if (!dataUri) {
      throw new Error('Image asset not found or inaccessible');
    }
    return uploadMedia(dataUri, apiKey);
  }

  if (image.startsWith('data:image')) {
    return uploadMedia(image, apiKey);
  }

  return image;
}
