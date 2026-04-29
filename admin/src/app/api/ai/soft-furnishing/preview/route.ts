import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { withTenantRoute } from '@/lib/tenant-route';
import {
  createSoftFurnishingPreview,
  FurnitureSelection,
} from '@/lib/ai/soft-furnishing';

interface SoftFurnishingPreviewBody {
  image?: string;
  furnitureItems?: FurnitureSelection[];
}

export async function POST(req: Request) {
  try {
    await dbConnect();

    return await withTenantRoute(req, { requireEnterprise: true }, async () => {
      let body: SoftFurnishingPreviewBody;
      try {
        body = (await req.json()) as SoftFurnishingPreviewBody;
      } catch {
        return NextResponse.json(
          { success: false, error: '图片数据过大或请求内容不完整，请压缩现场图后重试' },
          { status: 413 }
        );
      }
      const image = body.image;
      const furnitureItems = Array.isArray(body.furnitureItems) ? body.furnitureItems.slice(0, 8) : [];

      if (!image || !image.startsWith('data:image')) {
        return NextResponse.json({ success: false, error: '请先上传现场图片' }, { status: 400 });
      }

      if (furnitureItems.length === 0) {
        return NextResponse.json({ success: false, error: '请至少选择一件家具类型' }, { status: 400 });
      }

      const preview = createSoftFurnishingPreview(image, furnitureItems);

      return NextResponse.json({
        success: true,
        data: preview,
      });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '生成摆位预览失败';
    console.error('[AI Soft Furnishing Preview]', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
