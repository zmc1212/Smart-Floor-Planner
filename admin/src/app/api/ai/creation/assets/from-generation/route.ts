import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { AiCreationRepository } from '@/db/repositories';
import { withTenantTransaction } from '@/db/transaction';
import { withTenantRoute } from '@/lib/tenant-route';
import {
  getPostgresAssetIdFromImageUrl,
  getPostgresMediaAssetImageUrl,
  storePostgresMediaBuffer,
} from '@/lib/ai/postgres-media-assets';
import { validateAiImage } from '@/lib/ai/image-validation';

export const runtime = 'nodejs';

function outputImageUrl(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const imageUrl = (value as Record<string, unknown>).imageUrl;
  return typeof imageUrl === 'string' ? imageUrl.trim() : '';
}

export async function POST(request: Request) {
  try {
    return await withTenantRoute(request, { requireEnterprise: true }, async (context) => {
      const body = await request.json() as { generationId?: string };
      const generationId = String(body.generationId || '').trim();
      if (!/^[1-9]\d*$/.test(generationId)) {
        return NextResponse.json({ success: false, error: '生成结果不存在' }, { status: 404 });
      }

      const enterpriseId = parsePostgresId(context.enterpriseId!, 'enterpriseId');
      const generation = await withTenantTransaction(enterpriseId, (transaction) =>
        new AiCreationRepository(transaction).findGeneration(parsePostgresId(generationId, 'generationId'))
      );
      const imageUrl = generation?.status === 'succeeded' ? outputImageUrl(generation.output) : '';
      if (!imageUrl) {
        return NextResponse.json({ success: false, error: '该生成结果暂不可作为参考图' }, { status: 400 });
      }

      const existingAssetId = getPostgresAssetIdFromImageUrl(imageUrl);
      if (existingAssetId) {
        const asset = await withTenantTransaction(enterpriseId, (transaction) =>
          new AiCreationRepository(transaction).findMediaAsset(existingAssetId)
        );
        if (!asset) {
          return NextResponse.json({ success: false, error: '生成结果图片不存在或无权访问' }, { status: 404 });
        }
        return NextResponse.json({
          success: true,
          data: {
            id: asset.id.toString(),
            previewUrl: getPostgresMediaAssetImageUrl(asset.id),
            mimeType: asset.mimeType,
            size: Number(asset.size),
            width: asset.width || undefined,
            height: asset.height || undefined,
          },
        });
      }

      if (!/^https?:\/\//i.test(imageUrl)) {
        return NextResponse.json({ success: false, error: '生成结果图片地址无效' }, { status: 400 });
      }
      const response = await fetch(imageUrl, { cache: 'no-store', signal: AbortSignal.timeout(30_000) });
      if (!response.ok) {
        throw new Error(`无法读取生成结果（${response.status}）`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      const image = validateAiImage({ buffer });
      const stored = await storePostgresMediaBuffer({
        enterpriseId,
        ownerType: 'ai_generation_input',
        mimeType: image.mimeType,
        buffer,
        width: image.width,
        height: image.height,
        originalUrl: imageUrl,
      });
      return NextResponse.json({
        success: true,
        data: {
          id: stored.asset.id.toString(),
          previewUrl: stored.imageUrl,
          mimeType: image.mimeType,
          size: buffer.length,
          width: image.width,
          height: image.height,
        },
      });
    });
  } catch (error) {
    console.error('[AI Creation Generation Reference]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '引用生成结果失败' },
      { status: 400 }
    );
  }
}
