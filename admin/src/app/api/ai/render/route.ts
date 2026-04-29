import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { AiGeneration } from '@/models/AiGeneration';
import { AiQuota } from '@/models/AiQuota';
import Replicate from 'replicate';
import { withTenantRoute } from '@/lib/tenant-route';
import { ensureDefaultAiStylePresets, getAiStylePresetByKey } from '@/lib/ai/presets';

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN || '',
});

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

      // Fetch generation record
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

      // Fetch and consume quota
      const quota = await AiQuota.findOne({ enterpriseId: context.enterpriseId });
      if (!quota) {
        return NextResponse.json({ success: false, error: 'Quota not found' }, { status: 404 });
      }

      if (!(quota as any).consume()) {
        return NextResponse.json({ success: false, error: 'Insufficient AI Quota' }, { status: 429 });
      }
      await quota.save();

      try {
        if (process.env.MOCK_AI === 'true') {
          const presetType = generation.type === 'furnishing_render' ? 'furnishing_render' : 'floor_plan_style';
          const preset = await getAiStylePresetByKey(presetType, generation.input.style);
          await new Promise((resolve) => setTimeout(resolve, 2000));
          const mockImageUrl = preset?.mockImageUrl || '/colorful.png';
          generation.status = 'succeeded';
          generation.output.imageUrl = mockImageUrl;
          await generation.save();
          return NextResponse.json({ success: true, data: { id: generation._id } });
        }

        const aiPlatform = process.env.AI_PLATFORM || 'replicate';

        if (aiPlatform === 'tensor') {
          const { createTensorJob } = await import('@/lib/ai/tensor');
          const presetType = generation.type === 'furnishing_render' ? 'furnishing_render' : 'floor_plan_style';
          const preset = await getAiStylePresetByKey(presetType, generation.input.style);
          try {
            const job = await createTensorJob({
              prompt: prompt || generation.output.promptUsed || generation.input.customPrompt || '',
              negativePrompt: negativePrompt || preset?.negativePrompt,
              image,
              width: preset?.tensor.width,
              height: preset?.tensor.height,
              tensorConfig: preset?.tensor,
            });

            generation.status = 'processing';
            generation.provider = 'tensor';
            generation.externalJobId = job.id;
            await generation.save();

            return NextResponse.json({ success: true, data: { id: generation._id } });
          } catch (err: any) {
            console.error('[Tensor Render Error]', err);
            (quota as any).refund();
            await quota.save();

            generation.status = 'failed';
            generation.errorMessage = err.message || 'Tensor render initiation failed';
            await generation.save();

            return NextResponse.json({ success: false, error: 'Failed to initiate Tensor render' }, { status: 500 });
          }
        }

        const webhookUrl = process.env.REPLICATE_WEBHOOK_URL;
        if (!webhookUrl) {
          throw new Error('REPLICATE_WEBHOOK_URL is not set');
        }

        // Jagilley ControlNet MLSD model for architectural floor plans
        // Uses MLSD to find straight lines in the image and render on top
        const modelVersion = "854e8727697a057c525cdb45ab037f64ecca770a1769cc52287c2e56472a247b"; // jagilley/controlnet-mlsd
        
        const prediction = await replicate.predictions.create({
          version: modelVersion,
          input: {
            image, // Base64 data URI
            prompt: prompt || generation.input.customPrompt,
            a_prompt: 'best quality, extremely detailed', // positive prompt suffix
            n_prompt: negativePrompt || 'longbody, lowres, bad anatomy, bad hands, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality', // negative prompt
            num_samples: 1,
            image_resolution: 512,
            ddim_steps: 20,
            scale: 9,
            eta: 0.0,
            value_threshold: 0.1,
            distance_threshold: 0.1
          },
          webhook: webhookUrl,
          webhook_events_filter: ['completed'], // 'start', 'output', 'logs', 'completed'
        });

        generation.status = 'processing';
        generation.provider = 'replicate';
        generation.replicatePredictionId = prediction.id;
        generation.externalJobId = prediction.id;
        await generation.save();

        return NextResponse.json({ success: true, data: { id: generation._id } });
      } catch (err: any) {
        console.error('[AI Render Error]', err);
        
        // Refund quota on failure
        (quota as any).refund();
        await quota.save();

        generation.status = 'failed';
        generation.errorMessage = err.message || 'Render initiation failed';
        await generation.save();

        return NextResponse.json({ success: false, error: 'Failed to initiate render' }, { status: 500 });
      }
    });
  } catch (error: any) {
    console.error('[AI Render Server Error]', error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}
