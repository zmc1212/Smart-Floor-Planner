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
    // Tensor.art webhook payload structure
    const job = body.job || body.task;
    if (!job) {
      return NextResponse.json({ success: false, error: 'Invalid payload' }, { status: 400 });
    }

    const { id, status, success, msg } = job;
    console.log(`[Tensor.art Webhook] Job ${id} status: ${status}`);

    await dbConnect();
    // 同时支持旧字段和新字段查询
    const generation = await AiGeneration.findOne({ 
      $or: [
        { externalJobId: id },
        { replicatePredictionId: id }
      ]
    });

    if (!generation) {
      console.error(`[Tensor.art Webhook] Generation not found for ID: ${id}`);
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    // Tensor.art status: SUCCESS or FINISH
    if (status === 'SUCCESS' || status === 'FINISH') {
      generation.status = 'succeeded';
      
      // 提取输出图片 URL
      // Tensor.art outputs structure: [{ type: 'FILE', url: '...' }] 或 [{ type: 'STRING', value: '...' }]
      const outputs = job.outputs || [];
      const imageUrl = outputs.find((o: any) => 
        (o.type === 'FILE' && o.url) || 
        (o.type === 'STRING' && o.value && o.value.startsWith('http'))
      )?.url || outputs.find((o: any) => o.type === 'STRING')?.value;
      
      if (imageUrl) {
        generation.output.imageUrl = imageUrl;
      }
      await generation.save();
    } 
    else if (status === 'FAILED' || status === 'ERROR' || status === 'EXCEPTION' || status === 'CANCELED') {
      generation.status = 'failed';
      generation.errorMessage = msg || 'Generation failed on Tensor.art';
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
