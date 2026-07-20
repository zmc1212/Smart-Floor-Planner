import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import { withTenantRoute } from '@/lib/tenant-route';
import { AiGeneration } from '@/models/AiGeneration';
import { retryMiniAiTask } from '@/lib/ai/mini-ai-tasks';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async (context) => {
      const { id } = await params;
      const generation = await AiGeneration.findOne({ _id: id, channel: 'miniprogram' });
      if (!generation) return NextResponse.json({ success: false, error: '任务不存在' }, { status: 404 });
      await retryMiniAiTask(generation, {
        enterpriseId: generation.enterpriseId,
        operatorId: new mongoose.Types.ObjectId(context.userId),
        username: context.username,
        role: context.role,
      });
      return NextResponse.json({ success: true });
    });
  } catch (error) {
    console.error('[Admin Mini AI Retry]', error);
    const status = (error as { status?: number })?.status || 400;
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '任务重试失败' },
      { status }
    );
  }
}
