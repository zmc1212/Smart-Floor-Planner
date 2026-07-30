import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { withTenantRoute } from '@/lib/tenant-route';
import { storeMediaBuffer } from '@/lib/ai/media-assets';
import { validateAiImage } from '@/lib/ai/image-validation';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    await dbConnect();
    return await withTenantRoute(request, { requireEnterprise: true }, async (context) => {
      const formData = await request.formData();
      const file = formData.get('file');
      if (!(file instanceof File)) {
        return NextResponse.json({ success: false, error: '请选择要上传的图片' }, { status: 400 });
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      const image = validateAiImage({ buffer });
      const stored = await storeMediaBuffer({
        enterpriseId: String(context.enterpriseId),
        ownerType: 'manual_upload',
        mimeType: image.mimeType,
        buffer,
        width: image.width,
        height: image.height,
        storageProviderKey: 'local',
      });
      return NextResponse.json({
        success: true,
        data: {
          id: String(stored.asset._id),
          previewUrl: stored.imageUrl,
          mimeType: image.mimeType,
          size: buffer.length,
          width: image.width,
          height: image.height,
        },
      });
    });
  } catch (error) {
    console.error('[AI Creation Asset Upload]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '图片上传失败' },
      { status: 400 }
    );
  }
}
