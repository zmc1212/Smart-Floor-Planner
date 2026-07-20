import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { AiGeneration } from '@/models/AiGeneration';
import { resolveMiniAiContext } from '@/lib/ai/mini-ai-auth';
import { retryMiniAiTask, serializeMiniAiTask } from '@/lib/ai/mini-ai-tasks';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    const context = await resolveMiniAiContext(request);
    if (!context) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;
    const generation = await AiGeneration.findOne({
      _id: id,
      enterpriseId: context.enterpriseId,
      operatorId: context.operatorId,
      channel: 'miniprogram',
    });
    if (!generation) return NextResponse.json({ success: false, error: '任务不存在' }, { status: 404 });
    const retried = await retryMiniAiTask(generation, context);
    return NextResponse.json({ success: true, data: serializeMiniAiTask(retried, request) });
  } catch (error) {
    console.error('[Mini AI Task Retry]', error);
    const status = (error as { status?: number })?.status || 400;
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '重试失败' },
      { status }
    );
  }
}
