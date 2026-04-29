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

    let progress = 0;
    // --- 被动轮询补全逻辑 (针对 Tensor.art TAMS) ---
    if (generation.status === 'processing' && generation.provider === 'tensor' && generation.externalJobId) {
      try {
        const tensorStatus = await getTensorJobStatus(generation.externalJobId);
        console.log('tensorStatus:', JSON.stringify(tensorStatus));
        // TAMS API 返回的结构是 { jobId, status, successInfo, failedInfo }
        const task = tensorStatus; // 直接使用顶层对象，如果有包装层则调整

        if (task && task.status) {
          if (task.status === 'SUCCESS') {
            const imageUrl = task.successInfo?.images?.[0]?.url;
            
            if (imageUrl) {
              generation.status = 'succeeded';
              generation.output.imageUrl = imageUrl;
              await generation.save();
              progress = 100;
            } else {
              generation.status = 'failed';
              generation.errorMessage = 'No output image found in completed task';
              await generation.save();
            }
          } else if (['FAILED', 'CANCELED'].includes(task.status)) {
            generation.status = 'failed';
            generation.errorMessage = task.failedInfo?.reason || 'Generation failed on Tensor.art';
            await generation.save();

            // 退回配额
            const quota = await AiQuota.findOne({ enterpriseId: generation.enterpriseId });
            if (quota) {
              (quota as any).refund();
              await quota.save();
            }
          } else {
            // RUNNING 或 PENDING 状态
            progress = 50; // TAMS 没有具体的百分比进度，给个默认进度值
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
      progress = Math.min(Math.floor((timeElapsed / 15000) * 100), 99);
      if (timeElapsed > 15000) { // 模拟 15 秒生图时间
        generation.status = 'succeeded';
        generation.output.imageUrl = 'https://picsum.photos/800/600?random=1'; // 模拟的最终图片
        generation.durationMs = 15000;
        await generation.save();
        progress = 100;
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        id: generation._id,
        type: generation.type,
        status: generation.status,
        progress: progress,
        imageUrl: generation.output?.imageUrl,
        error: generation.errorMessage,
        duration: generation.durationMs,
        input: generation.input,
        createdAt: generation.createdAt,
        provider: generation.provider,
        floorPlanId: generation.floorPlanId,
      }
    });

  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
