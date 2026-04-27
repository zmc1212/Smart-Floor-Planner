import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { AiGeneration } from '@/models/AiGeneration';
import { AiQuota } from '@/models/AiQuota';

/**
 * Webhook handler for Replicate
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { id, status, output, error, metrics } = body;

    console.log(`[Replicate Webhook] Task ${id} status: ${status}`);

    await dbConnect();
    const generation = await AiGeneration.findOne({ replicatePredictionId: id });

    if (!generation) {
      console.error(`[Replicate Webhook] Generation not found for prediction ID: ${id}`);
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    if (status === 'succeeded') {
      generation.status = 'succeeded';
      // Replicate output is usually an array of URLs
      generation.output.imageUrl = Array.isArray(output) ? output[0] : output;
      generation.durationMs = metrics?.predict_time ? Math.round(metrics.predict_time * 1000) : undefined;
      await generation.save();
    } 
    else if (status === 'failed' || status === 'canceled') {
      generation.status = 'failed';
      generation.errorMessage = error || 'Generation failed or was canceled';
      await generation.save();

      // 退回配额
      const quota = await AiQuota.findOne({ enterpriseId: generation.enterpriseId });
      if (quota) {
        (quota as any).refund();
        await quota.save();
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[Replicate Webhook Error]', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
