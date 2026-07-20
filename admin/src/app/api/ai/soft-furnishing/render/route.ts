import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { withTenantRoute } from '@/lib/tenant-route';
import { AiGeneration } from '@/models/AiGeneration';
import {
  buildDirectSoftFurnishingPrompt,
  FurnitureSelection,
  SOFT_FURNISHING_NEGATIVE,
} from '@/lib/ai/soft-furnishing';
import { persistImageReference, updateMediaAssetOwner } from '@/lib/ai/media-assets';
import { executeGenerationImage } from '@/lib/ai/execution-service';

interface SoftFurnishingBody {
  image?: string;
  furnitureItems?: FurnitureSelection[];
  resolution?: '1k' | '2k';
}

function parseUpstreamStatus(error: unknown) {
  const maybe = error as Error & { status?: number };
  return maybe?.status || 500;
}

export async function POST(req: Request) {
  try {
    await dbConnect();

    return await withTenantRoute(req, { requireEnterprise: true }, async (context) => {
      let body: SoftFurnishingBody;
      try {
        body = (await req.json()) as SoftFurnishingBody;
      } catch {
        return NextResponse.json(
          { success: false, error: '图片数据过大或请求内容不完整，请压缩现场图后重试' },
          { status: 413 }
        );
      }

      const image = body.image;
      const resolution = body.resolution === '2k' ? '2k' : '1k';
      const furnitureItems = Array.isArray(body.furnitureItems) ? body.furnitureItems.slice(0, 8) : [];

      if (!image || !image.startsWith('data:image')) {
        return NextResponse.json({ success: false, error: '请先上传现场图片' }, { status: 400 });
      }

      if (furnitureItems.length === 0) {
        return NextResponse.json({ success: false, error: '请至少选择一件家具类型' }, { status: 400 });
      }

      const prompt = buildDirectSoftFurnishingPrompt(furnitureItems, resolution);
      const roomType = furnitureItems.some((item) => item.placementRole === 'sleeping') ? 'bedroom' : 'living_room';

      const persistedSourceImage = await persistImageReference({
        enterpriseId: String(context.enterpriseId),
        ownerType: 'ai_generation_input',
        image,
      });

      const generation = await AiGeneration.create({
        enterpriseId: context.enterpriseId!,
        operatorId: context.userId,
        type: 'soft_furnishing_render',
        actionKey: 'image.soft_furnishing_render',
        capability: 'image.edit',
        logicalModelKey: 'image.edit.standard',
        input: {
          style: 'soft_furnishing',
          roomType,
          roomName: roomType === 'bedroom' ? '卧室软装' : '客厅软装',
          mode: 'photo_furniture_staging_v2',
          sourceImage: persistedSourceImage,
          furnitureItems,
          customPrompt: prompt,
        },
        output: {
          promptUsed: prompt,
        },
        status: 'processing',
      });
      await updateMediaAssetOwner(persistedSourceImage, generation._id);

      try {
        const completed = await executeGenerationImage(generation, {
          logicalModelKey: 'image.edit.standard',
          prompt,
          negativePrompt: SOFT_FURNISHING_NEGATIVE,
          images: [persistedSourceImage || image],
          size: resolution === '2k' ? '1536x1024' : '1024x1024',
          quality: resolution === '2k' ? 'high' : 'medium',
          user: String(context.userId),
        });
        return NextResponse.json({ success: true, data: { id: completed._id, status: completed.status, imageUrl: completed.output.imageUrl } });
      } catch (error) {
        if (generation.status !== 'processing') generation.status = 'failed';
        generation.errorMessage =
          error instanceof Error ? error.message : 'Soft furnishing render failed';
        await generation.save();

        const status = parseUpstreamStatus(error);
        const readableMessage = status === 402
          ? '当前企业 AI 点数不足，请联系平台管理员调整。'
          : error instanceof Error ? error.message : '提交软装渲染失败';

        return NextResponse.json({ success: false, error: readableMessage }, { status: status >= 400 ? status : 500 });
      }
    });
  } catch (error) {
    console.error('[AI Soft Furnishing Render]', error);
    const message = error instanceof Error ? error.message : '服务端内部错误';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
