import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { withTenantRoute } from '@/lib/tenant-route';
import { AiQuota, TIER_LIMITS } from '@/models/AiQuota';
import { AiGeneration } from '@/models/AiGeneration';
import {
  buildSoftFurnishingPrompt,
  createSoftFurnishingPreview,
  FurnitureSelection,
  SOFT_FURNISHING_NEGATIVE,
} from '@/lib/ai/soft-furnishing';

interface SoftFurnishingBody {
  image?: string;
  furnitureItems?: FurnitureSelection[];
  resolution?: '1k' | '2k';
  placementGuideImage?: string;
}

interface QuotaWithActions {
  checkAndResetPeriod: () => void;
  consume: () => boolean;
  refund: () => void;
  save: () => Promise<unknown>;
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

      const preview = createSoftFurnishingPreview(image, furnitureItems);
      const placementGuideImage =
        typeof body.placementGuideImage === 'string' && body.placementGuideImage.startsWith('data:image')
          ? body.placementGuideImage
          : preview.placementGuideImage;

      const enterpriseId = context.enterpriseId ?? undefined;
      let quota = await AiQuota.findOne({ enterpriseId });
      if (!quota) {
        quota = await AiQuota.create({
          enterpriseId,
          tier: 'free',
          monthlyLimit: TIER_LIMITS.free,
        });
      }

      const quotaWithActions = quota as typeof quota & QuotaWithActions;
      quotaWithActions.checkAndResetPeriod();
      if (!quotaWithActions.consume()) {
        return NextResponse.json({ success: false, error: 'AI 配额不足' }, { status: 429 });
      }
      await quotaWithActions.save();

      const prompt = buildSoftFurnishingPrompt(
        preview.sceneAnalysis,
        preview.placementPlan,
        furnitureItems,
        resolution
      );

      const generation = await AiGeneration.create({
        enterpriseId,
        operatorId: context.userId,
        type: 'soft_furnishing_render',
        input: {
          style: 'soft_furnishing',
          roomType: preview.sceneAnalysis.roomKind,
          roomName: preview.sceneAnalysis.roomKind === 'bedroom' ? '卧室软装' : '客厅软装',
          mode: 'photo_furniture_staging_auto_type_v1',
          sourceImage: image,
          furnitureItems,
          sceneAnalysis: preview.sceneAnalysis,
          placementPlan: preview.placementPlan,
          placementGuideImage,
          customPrompt: prompt,
        },
        output: {
          promptUsed: prompt,
        },
        provider: process.env.AI_PLATFORM === 'tensor' ? 'tensor' : 'replicate',
        status: 'processing',
      });

      try {
        if (process.env.MOCK_AI === 'true') {
          await new Promise((resolve) => setTimeout(resolve, 1200));
          generation.status = 'succeeded';
          generation.provider = 'tensor';
          generation.output.imageUrl = '/soft-furnishing-result.png';
          generation.durationMs = 1200;
          await generation.save();

          return NextResponse.json({
            success: true,
            data: { id: generation._id, imageUrl: generation.output.imageUrl },
          });
        }

        const { createTensorJob } = await import('@/lib/ai/tensor');
        const width = resolution === '2k' ? 1344 : 1024;
        const height = resolution === '2k' ? 768 : 576;
        const steps = resolution === '2k' ? 30 : 24;

        const job = await createTensorJob({
          prompt,
          negativePrompt: SOFT_FURNISHING_NEGATIVE,
          image: placementGuideImage,
          width,
          height,
          tensorConfig: {
            modelId: '701982267016309424',
            sampler: 'Euler',
            steps,
            cfgScale: 6.5,
            width,
            height,
            vae: 'vae-ft-mse-840000-ema-pruned.ckpt',
            clipSkip: 2,
            denoisingStrength: 0.28,
            controlnet: {
              enabled: true,
              preprocessor: 'canny',
              model: 'control_v11p_sd15_canny',
              weight: 0.9,
              guidanceStart: 0,
              guidanceEnd: 1,
            },
          },
        });

        generation.provider = 'tensor';
        generation.externalJobId = job.id;
        generation.input.controlImageResourceId = job.resourceId;
        await generation.save();

        return NextResponse.json({ success: true, data: { id: generation._id } });
      } catch (error) {
        quotaWithActions.refund();
        await quotaWithActions.save();

        generation.status = 'failed';
        generation.errorMessage = error instanceof Error ? error.message : 'Soft furnishing render failed';
        await generation.save();

        return NextResponse.json({ success: false, error: '提交软装渲染失败' }, { status: 500 });
      }
    });
  } catch (error) {
    console.error('[AI Soft Furnishing Render]', error);
    const message = error instanceof Error ? error.message : '服务器内部错误';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
