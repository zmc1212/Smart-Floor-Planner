import { NextResponse } from 'next/server';
import { withTenantRoute } from '@/lib/tenant-route';
import {
  buildDirectSoftFurnishingPrompt,
  FurnitureSelection,
  SOFT_FURNISHING_NEGATIVE,
} from '@/lib/ai/soft-furnishing';
import { createPostgresSoftFurnishingRender } from '@/lib/ai/postgres-soft-furnishing-service';

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

      try {
        const generation = await createPostgresSoftFurnishingRender({
          enterpriseId: String(context.enterpriseId),
          operatorId: String(context.userId),
          image,
          furnitureItems,
          prompt,
          negativePrompt: SOFT_FURNISHING_NEGATIVE,
          roomType,
          resolution,
        });
        if (!generation) throw new Error('软装渲染任务不存在');
        const output = generation.output && typeof generation.output === 'object'
          ? generation.output as Record<string, unknown>
          : {};
        return NextResponse.json({
          success: true,
          data: {
            id: generation.id.toString(),
            status: generation.status,
            imageUrl: typeof output.imageUrl === 'string'
              ? `/api/ai/generations/${generation.id.toString()}/image`
              : undefined,
          },
        });
      } catch (error) {
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
