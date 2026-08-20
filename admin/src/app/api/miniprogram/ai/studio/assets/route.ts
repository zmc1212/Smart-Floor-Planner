import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { storePostgresMediaBuffer } from '@/lib/ai/postgres-media-assets';
import { validateAiImage } from '@/lib/ai/image-validation';
import { isMiniStudioContext, requireMiniStudioContext, serializeAssetPreviewForMini } from '@/lib/ai/mini-ai-studio';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const context = await requireMiniStudioContext(request);
    if (!isMiniStudioContext(context)) return context;
    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: '请选择要上传的图片' }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const image = validateAiImage({ buffer });
    const stored = await storePostgresMediaBuffer({
      enterpriseId: parsePostgresId(context.enterpriseId, 'enterpriseId'),
      ownerType: 'manual_upload',
      mimeType: image.mimeType,
      buffer,
      width: image.width,
      height: image.height,
    });
    return NextResponse.json({
      success: true,
      data: serializeAssetPreviewForMini(request, context.enterpriseId, {
        id: stored.asset.id,
        mimeType: image.mimeType,
        size: buffer.length,
        width: image.width,
        height: image.height,
      }),
    });
  } catch (error) {
    console.error('[Mini AI Studio Asset Upload]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '图片上传失败' },
      { status: 400 },
    );
  }
}
