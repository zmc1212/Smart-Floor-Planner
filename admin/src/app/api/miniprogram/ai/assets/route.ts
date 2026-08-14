import { NextResponse } from 'next/server';
import { resolveMiniAiContext } from '@/lib/ai/mini-ai-auth';
import { storePostgresMediaBuffer } from '@/lib/ai/postgres-media-assets';
import { validateAiImage } from '@/lib/ai/image-validation';
import { getSignedMiniAiAssetUrl } from '@/lib/ai/mini-ai-assets';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const context = await resolveMiniAiContext(request);
    if (!context) return NextResponse.json({ success: false, error: '仅企业员工可以上传 AI 图片' }, { status: 403 });
    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) return NextResponse.json({ success: false, error: '请选择要上传的图片' }, { status: 400 });
    const buffer = Buffer.from(await file.arrayBuffer());
    const dimensions = validateAiImage({ buffer });
    const stored = await storePostgresMediaBuffer({ enterpriseId: BigInt(context.enterpriseId), ownerType: 'manual_upload', mimeType: dimensions.mimeType, buffer, width: dimensions.width, height: dimensions.height });
    return NextResponse.json({ success: true, data: { id: stored.asset.id.toString(), mimeType: dimensions.mimeType, size: buffer.length, width: dimensions.width, height: dimensions.height, previewUrl: getSignedMiniAiAssetUrl({ request, assetId: stored.asset.id.toString(), enterpriseId: context.enterpriseId }) } });
  } catch (error) {
    console.error('[Mini AI Asset Upload]', error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '图片上传失败' }, { status: 400 });
  }
}
