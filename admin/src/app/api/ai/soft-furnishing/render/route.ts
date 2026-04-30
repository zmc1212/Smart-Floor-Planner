import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { withTenantRoute } from '@/lib/tenant-route';
import { AiGeneration } from '@/models/AiGeneration';
import {
  buildDirectSoftFurnishingPrompt,
  FurnitureSelection,
  SOFT_FURNISHING_NEGATIVE,
} from '@/lib/ai/soft-furnishing';
import { editImage, uploadMedia } from '@/lib/ai/pollinations';
import {
  getEnterprisePollinationsRuntimeConfig,
  markEnterpriseAiSyncError,
  syncEnterprisePollinationsSnapshot,
} from '@/lib/ai/enterprise-ai';

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

      let runtimeConfig;
      try {
        runtimeConfig = await getEnterprisePollinationsRuntimeConfig(String(context.enterpriseId));
      } catch (error) {
        return NextResponse.json(
          { success: false, error: error instanceof Error ? error.message : '当前企业 AI Key 不可用' },
          { status: 400 }
        );
      }

      const prompt = buildDirectSoftFurnishingPrompt(furnitureItems, resolution);
      const roomType = furnitureItems.some((item) => item.placementRole === 'sleeping') ? 'bedroom' : 'living_room';

      const generation = await AiGeneration.create({
        enterpriseId: context.enterpriseId!,
        operatorId: context.userId,
        type: 'soft_furnishing_render',
        input: {
          style: 'soft_furnishing',
          roomType,
          roomName: roomType === 'bedroom' ? '卧室软装' : '客厅软装',
          mode: 'photo_furniture_staging_v2',
          sourceImage: image,
          furnitureItems,
          customPrompt: prompt,
        },
        output: {
          promptUsed: prompt,
        },
        provider: 'pollinations',
        status: 'processing',
        apiKeyId: runtimeConfig.keyId,
        apiKeyName: runtimeConfig.keyName,
      });

      try {
        if (process.env.MOCK_AI === 'true') {
          await new Promise((resolve) => setTimeout(resolve, 1200));
          generation.status = 'succeeded';
          generation.output.imageUrl = '/soft-furnishing-result.png';
          generation.durationMs = 1200;
          await generation.save();

          return NextResponse.json({
            success: true,
            data: { id: generation._id, imageUrl: generation.output.imageUrl },
          });
        }

        const startedAt = Date.now();
        const referenceImageUrl = await uploadMedia(image, runtimeConfig.apiKey);
        const imageUrl = await editImage({
          prompt,
          negativePrompt: SOFT_FURNISHING_NEGATIVE,
          referenceImageUrl,
          model: resolution === '2k' ? 'gptimage-large' : 'gptimage',
          size: resolution === '2k' ? '1536x1024' : '1024x1024',
          quality: resolution === '2k' ? 'high' : 'medium',
          user: String(context.userId),
          apiKey: runtimeConfig.apiKey,
        });

        generation.status = 'succeeded';
        generation.output.imageUrl = imageUrl;
        generation.durationMs = Date.now() - startedAt;
        generation.remoteModel = resolution === '2k' ? 'gptimage-large' : 'gptimage';
        await generation.save();

        await syncEnterprisePollinationsSnapshot(String(context.enterpriseId)).catch((error) =>
          markEnterpriseAiSyncError(String(context.enterpriseId), error)
        );

        return NextResponse.json({ success: true, data: { id: generation._id, imageUrl } });
      } catch (error) {
        generation.status = 'failed';
        generation.errorMessage =
          error instanceof Error ? error.message : 'Soft furnishing render failed';
        await generation.save();

        await markEnterpriseAiSyncError(String(context.enterpriseId), error).catch(() => undefined);
        await syncEnterprisePollinationsSnapshot(String(context.enterpriseId)).catch(() => undefined);

        const status = parseUpstreamStatus(error);
        const readableMessage =
          status === 402
            ? '当前企业 Pollinations 余额不足，请联系平台管理员充值。'
            : status === 403
              ? '当前企业 Pollinations Key 没有该模型权限或已失效。'
              : '提交软装渲染失败';

        return NextResponse.json({ success: false, error: readableMessage }, { status: status >= 400 ? status : 500 });
      }
    });
  } catch (error) {
    console.error('[AI Soft Furnishing Render]', error);
    const message = error instanceof Error ? error.message : '服务端内部错误';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
