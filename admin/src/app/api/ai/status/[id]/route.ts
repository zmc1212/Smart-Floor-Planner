import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { AiGeneration } from '@/models/AiGeneration';
import { getTenantContext } from '@/lib/auth';
import { getTensorJobStatus } from '@/lib/ai/tensor';
import { AiQuota } from '@/models/AiQuota';

/**
 * Poll AI Generation Status
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await dbConnect();
    const ctx = await getTenantContext(req);
    if (!ctx) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const generation = await AiGeneration.findById(id);

    if (!generation) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    // Security check: ensure the user belongs to the same enterprise
    if (generation.enterpriseId.toString() !== ctx.enterpriseId?.toString()) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    // --- 被动轮询补全逻辑 (针对 Tensor.art 等可能丢失 Webhook 的情况) ---
    if (generation.status === 'processing' && generation.provider === 'tensor' && generation.externalJobId) {
      try {
        const tensorStatus = await getTensorJobStatus(generation.externalJobId);
        const task = tensorStatus.data?.task;

        if (task) {
          if (task.status === 'SUCCESS' || task.status === 'FINISH') {
            const outputs = task.outputs || [];
            // 兼容多种输出格式: {type: 'FILE', url: '...'} 或 {type: 'STRING', value: '...'}
            const imageUrl = outputs.find((o: any) => 
              (o.type === 'FILE' && o.url) || 
              (o.type === 'STRING' && o.value && o.value.startsWith('http'))
            )?.url || outputs.find((o: any) => o.type === 'STRING')?.value;
            
            if (imageUrl) {
              generation.status = 'succeeded';
              generation.output.imageUrl = imageUrl;
              await generation.save();
            } else {
              // 如果没有图片但已完成，标记为失败
              generation.status = 'failed';
              generation.errorMessage = 'No output image found in completed task';
              await generation.save();
            }
          } else if (['FAILED', 'ERROR', 'EXCEPTION', 'CANCELED'].includes(task.status)) {
            generation.status = 'failed';
            generation.errorMessage = task.msg || 'Generation failed on Tensor.art';
            await generation.save();

            // 退回配额
            const quota = await AiQuota.findOne({ enterpriseId: generation.enterpriseId });
            if (quota) {
              (quota as any).refund();
              await quota.save();
            }
          } else {
            // Handle timeout if waiting for too long (e.g., over 5 minutes)
            const timeElapsed = Date.now() - new Date(generation.updatedAt).getTime();
            if (timeElapsed > 5 * 60 * 1000) {
              generation.status = 'failed';
              generation.errorMessage = 'Generation timed out (waited for over 5 minutes)';
              await generation.save();

              const quota = await AiQuota.findOne({ enterpriseId: generation.enterpriseId });
              if (quota) {
                (quota as any).refund();
                await quota.save();
              }
            }
          }
        }
      } catch (pollError) {
        console.error('[Status Polling Error]', pollError);
      }
    }

    // --- Mock 模式自动完成逻辑 ---
    if (process.env.MOCK_AI === 'true' && generation.status === 'processing') {
      const timeElapsed = Date.now() - new Date(generation.updatedAt).getTime();
      if (timeElapsed > 15000) { // 模拟 15 秒生图时间
        generation.status = 'succeeded';
        generation.output.imageUrl = 'https://picsum.photos/800/600?random=1'; // 模拟的最终图片
        generation.durationMs = 15000;
        await generation.save();
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        id: generation._id,
        status: generation.status,
        imageUrl: generation.output?.imageUrl,
        error: generation.errorMessage,
        duration: generation.durationMs,
      }
    });

  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
