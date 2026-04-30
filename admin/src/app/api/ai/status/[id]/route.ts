import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { AiGeneration } from '@/models/AiGeneration';
import { getTenantContext } from '@/lib/auth';

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

    if (generation.enterpriseId.toString() !== ctx.enterpriseId?.toString()) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const progress =
      generation.status === 'succeeded'
        ? 100
        : generation.status === 'failed'
          ? 100
          : generation.status === 'processing'
            ? 65
            : 0;

    return NextResponse.json({
      success: true,
      data: {
        id: generation._id,
        type: generation.type,
        status: generation.status,
        progress,
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
