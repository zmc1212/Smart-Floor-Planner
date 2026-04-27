import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { AiGeneration } from '@/models/AiGeneration';
import { getTenantContext } from '@/lib/auth';

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
