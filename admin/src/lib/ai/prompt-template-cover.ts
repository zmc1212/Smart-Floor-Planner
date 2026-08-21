import { parsePostgresId } from '@/db/postgres-dto';
import { detectAiImageMimeType } from '@/lib/ai/image-validation';
import { storePostgresMediaBuffer } from '@/lib/ai/postgres-media-assets';
import { getActivePromptTemplateAsset } from '@/lib/ai/prompt-library-query';
import { getMediaStorageProvider } from '@/lib/media-storage/registry';
import sharp from 'sharp';

export async function normalizeLibraryCoverForCreation(buffer: Buffer) {
  const detected = detectAiImageMimeType(buffer);
  if (detected) {
    const metadata = await sharp(buffer).metadata();
    return {
      buffer,
      mimeType: detected,
      width: Number(metadata.width) || 0,
      height: Number(metadata.height) || 0,
    };
  }
  const converted = await sharp(buffer).png().toBuffer({ resolveWithObject: true });
  return {
    buffer: converted.data,
    mimeType: 'image/png' as const,
    width: converted.info.width,
    height: converted.info.height,
  };
}

export async function cloneActivePromptTemplateCover(input: {
  enterpriseId: string;
  templateId: string;
}) {
  const asset = await getActivePromptTemplateAsset(input.templateId);
  if (!asset) {
    throw Object.assign(new Error('该模板没有参考图'), { status: 404 });
  }
  const provider = await getMediaStorageProvider(asset.storageProvider);
  let raw: Buffer;
  try {
    raw = await provider.getObject({
      objectKey: asset.storageKey,
      bucket: asset.storageBucket ?? undefined,
    });
  } catch (error) {
    console.error('[prompt-template-cover] failed to read library cover', error);
    throw Object.assign(new Error('无法读取模板参考图'), { status: 502 });
  }
  let image;
  try {
    image = await normalizeLibraryCoverForCreation(raw);
  } catch (error) {
    console.error('[prompt-template-cover] unsupported library cover', error);
    throw Object.assign(new Error('模板参考图格式不受支持'), { status: 400 });
  }
  if (!image.width || !image.height) {
    throw Object.assign(new Error('模板参考图格式不受支持'), { status: 400 });
  }
  const stored = await storePostgresMediaBuffer({
    enterpriseId: parsePostgresId(input.enterpriseId, 'enterpriseId'),
    ownerType: 'manual_upload',
    mimeType: image.mimeType,
    buffer: image.buffer,
    width: image.width,
    height: image.height,
  });
  return {
    id: stored.asset.id.toString(),
    previewUrl: stored.imageUrl,
    mimeType: image.mimeType,
    width: image.width,
    height: image.height,
  };
}
