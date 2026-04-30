import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { AiGeneration } from '@/models/AiGeneration';
import { withTenantRoute } from '@/lib/tenant-route';
import { editImage, generateImage, uploadMedia } from '@/lib/ai/pollinations';
import { ensureDefaultAiStylePresets, getAiStylePresetByKey } from '@/lib/ai/presets';
import {
  getEnterprisePollinationsRuntimeConfig,
  markEnterpriseAiSyncError,
  syncEnterprisePollinationsSnapshot,
} from '@/lib/ai/enterprise-ai';

function resolvePresetType(type?: string) {
  return type === 'furnishing_render' || type === 'soft_furnishing_render'
    ? 'furnishing_style'
    : 'floor_plan_style';
}

function parseUpstreamStatus(error: unknown) {
  const maybe = error as Error & { status?: number };
  return maybe?.status || 500;
}

export async function POST(req: Request) {
  try {
    await dbConnect();

    return await withTenantRoute(req, { requireEnterprise: true }, async (context) => {
      await ensureDefaultAiStylePresets(context.userId);
      const body = await req.json();
      const { generationId, image, prompt, negativePrompt } = body;

      if (!generationId || !image) {
        return NextResponse.json({ success: false, error: 'Missing generationId or image' }, { status: 400 });
      }

      const generation = await AiGeneration.findOne({
        _id: generationId,
        enterpriseId: context.enterpriseId,
      });

      if (!generation) {
        return NextResponse.json({ success: false, error: 'Generation record not found' }, { status: 404 });
      }

      if (generation.status !== 'pending' && generation.status !== 'failed') {
        return NextResponse.json({ success: false, error: 'Generation is already in progress or completed' }, { status: 400 });
      }

      let runtimeConfig;
      try {
        runtimeConfig = await getEnterprisePollinationsRuntimeConfig(String(context.enterpriseId));
      } catch (error) {
        generation.status = 'failed';
        generation.errorMessage = error instanceof Error ? error.message : 'Enterprise AI key unavailable';
        await generation.save();
        return NextResponse.json(
          { success: false, error: generation.errorMessage },
          { status: 400 }
        );
      }

      try {
        generation.status = 'processing';
        generation.provider = 'pollinations';
        generation.apiKeyId = runtimeConfig.keyId;
        generation.apiKeyName = runtimeConfig.keyName;
        generation.input.sourceImage = typeof image === 'string' && image.startsWith('data:image') ? 'data-uri' : image;
        await generation.save();

        if (process.env.MOCK_AI === 'true') {
          const presetType = resolvePresetType(generation.type);
          const preset = await getAiStylePresetByKey(presetType, generation.input.style);
          await new Promise((resolve) => setTimeout(resolve, 2000));
          generation.status = 'succeeded';
          generation.output.imageUrl = preset?.mockImageUrl || '/colorful.png';
          generation.durationMs = 2000;
          await generation.save();
          return NextResponse.json({ success: true, data: { id: generation._id, imageUrl: generation.output.imageUrl } });
        }

        const presetType = resolvePresetType(generation.type);
        const preset = await getAiStylePresetByKey(presetType, generation.input.style);
        const referenceImageUrl = await uploadMedia(image, runtimeConfig.apiKey);
        const startedAt = Date.now();
        const requestPayload = {
          prompt: prompt || generation.output.promptUsed || generation.input.customPrompt || '',
          negativePrompt: negativePrompt || preset?.negativePrompt,
          referenceImageUrl,
          model: preset?.image.model || 'gptimage',
          size: preset?.image.size || '1024x1024',
          quality: preset?.image.quality || 'medium',
          user: String(context.userId),
          apiKey: runtimeConfig.apiKey,
        };
        const imageUrl =
          preset?.image.mode === 'generation'
            ? await generateImage(requestPayload)
            : await editImage(requestPayload);

        generation.status = 'succeeded';
        generation.output.imageUrl = imageUrl;
        generation.durationMs = Date.now() - startedAt;
        generation.remoteModel = requestPayload.model;
        await generation.save();

        await syncEnterprisePollinationsSnapshot(String(context.enterpriseId)).catch((error) =>
          markEnterpriseAiSyncError(String(context.enterpriseId), error)
        );

        return NextResponse.json({ success: true, data: { id: generation._id, imageUrl } });
      } catch (err: unknown) {
        console.error('[AI Render Error]', err);

        generation.status = 'failed';
        generation.errorMessage = err instanceof Error ? err.message : 'Render failed';
        generation.remoteModel = generation.remoteModel || undefined;
        await generation.save();

        await markEnterpriseAiSyncError(String(context.enterpriseId), err).catch(() => undefined);
        await syncEnterprisePollinationsSnapshot(String(context.enterpriseId)).catch(() => undefined);

        const status = parseUpstreamStatus(err);
        const readableMessage =
          status === 402
            ? '当前企业 Pollinations 余额不足，请联系平台管理员充值。'
            : status === 403
              ? '当前企业 Pollinations Key 没有该模型权限或已失效。'
              : 'Failed to render image';

        return NextResponse.json({ success: false, error: readableMessage }, { status: status >= 400 ? status : 500 });
      }
    });
  } catch (error: unknown) {
    console.error('[AI Render Server Error]', error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}
