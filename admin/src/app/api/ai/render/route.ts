import { NextResponse } from 'next/server';
import Replicate from "replicate";
import dbConnect from '@/lib/mongodb';
import { AiGeneration } from '@/models/AiGeneration';
import { AiQuota } from '@/models/AiQuota';
import { getTenantContext } from '@/lib/auth';

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

// Default ControlNet model version (MLSD for floor plans)
const CONTROLNET_MLSD_VERSION = "854e8727697a0a60b9c14857a8ca3d2a02b66708316acc091563f135003b5d27";

/**
 * Handle Replicate AI Rendering (Asynchronous)
 */
export async function POST(req: Request) {
  try {
    await dbConnect();
    const ctx = await getTenantContext(req);
    if (!ctx || !ctx.enterpriseId) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { generationId, image, prompt, negativePrompt } = await req.json();

    if (!generationId || !image || !prompt) {
      return NextResponse.json({ success: false, error: 'Missing required parameters' }, { status: 400 });
    }

    const generation = await AiGeneration.findById(generationId);
    if (!generation) {
      return NextResponse.json({ success: false, error: 'Generation record not found' }, { status: 404 });
    }

    // --- 扣减配额 (预扣) ---
    const quota = await AiQuota.findOne({ enterpriseId: ctx.enterpriseId });
    if (!quota || !(quota as any).consume()) {
      return NextResponse.json({ success: false, error: 'Insufficient quota' }, { status: 429 });
    }
    await quota.save();

    // --- 调用 Replicate 发起异步任务 ---
    try {
      let predictionId = '';
      if (process.env.MOCK_AI === 'true') {
        predictionId = 'mock_prediction_' + Date.now();
        await new Promise(resolve => setTimeout(resolve, 500));
      } else {
        if (!process.env.REPLICATE_API_TOKEN) {
          throw new Error('REPLICATE_API_TOKEN is not configured in .env.local');
        }
        if (!process.env.REPLICATE_WEBHOOK_URL || !process.env.REPLICATE_WEBHOOK_URL.startsWith('http')) {
          throw new Error('REPLICATE_WEBHOOK_URL is not configured correctly. It must be a valid http/https URL (e.g., from ngrok).');
        }

        const prediction = await replicate.predictions.create({
          version: CONTROLNET_MLSD_VERSION,
          input: {
            image: image, // Base64 image
            prompt: prompt,
            negative_prompt: negativePrompt || "low quality, bad resolution, text, watermark, blurry",
            num_samples: 1,
            image_resolution: "512", // Initial resolution for speed
            ddim_steps: 20,
            scale: 9,
          },
          webhook: process.env.REPLICATE_WEBHOOK_URL,
          webhook_events_filter: ["completed"]
        });
        predictionId = prediction.id;
      }

      // 更新生成记录
      generation.replicatePredictionId = predictionId;
      generation.status = 'processing';
      await generation.save();

      return NextResponse.json({ 
        success: true, 
        predictionId: predictionId,
        status: 'processing'
      });

    } catch (replicateError: any) {
      console.error('[Replicate API Error]', replicateError);
      
      // 失败则退回配额
      (quota as any).refund();
      await quota.save();

      generation.status = 'failed';
      generation.errorMessage = replicateError.message || 'Replicate submission failed';
      await generation.save();

      return NextResponse.json({ success: false, error: 'AI 渲染请求提交失败' }, { status: 502 });
    }

  } catch (error: any) {
    console.error('[AI Render]', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
