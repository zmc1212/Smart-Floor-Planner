import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { AiGeneration } from '@/models/AiGeneration';
import { AiQuota } from '@/models/AiQuota';

/**
 * Webhook handler for Tensor.art
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    // Tensor.art TAMS webhook payload structure: { jobId, status, successInfo, failedInfo }
    const jobId = body.jobId;
    if (!jobId) {
      return NextResponse.json({ success: false, error: 'Invalid payload' }, { status: 400 });
    }

    const { status, successInfo, failedInfo } = body;
    console.log(`[Tensor.art Webhook] Job ${jobId} status: ${status}`);

    await dbConnect();
    // 同时支持旧字段和新字段查询
    const generation = await AiGeneration.findOne({ 
      $or: [
        { externalJobId: jobId },
        { replicatePredictionId: jobId }
      ]
    });

    if (!generation) {
      console.error(`[Tensor.art Webhook] Generation not found for ID: ${jobId}`);
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    // Tensor.art TAMS status: SUCCESS
    if (status === 'SUCCESS') {
      generation.status = 'succeeded';
      
      // 提取输出图片 URL
      const imageUrl = successInfo?.images?.[0]?.url;
      
      if (imageUrl) {
        generation.output.imageUrl = imageUrl;
      }
      await generation.save();
    } 
    else if (['FAILED', 'CANCELED'].includes(status)) {
      generation.status = 'failed';
      generation.errorMessage = failedInfo?.reason || 'Generation failed on Tensor.art';
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
    console.error('[Tensor.art Webhook Error]', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
