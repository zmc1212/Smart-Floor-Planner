import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { AiGeneration } from '@/models/AiGeneration';
import { resolveMiniAiContext } from '@/lib/ai/mini-ai-auth';
import { executeMiniAiTask, serializeMiniAiTask } from '@/lib/ai/mini-ai-tasks';

export const maxDuration = 120;

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
    if (generation.status !== 'created') {
      return NextResponse.json({ success: true, data: serializeMiniAiTask(generation, request) });
    }
    const result = await executeMiniAiTask(generation, context);
    return NextResponse.json({ success: true, data: serializeMiniAiTask(result, request) });
  } catch (error) {
    console.error('[Mini AI Task Run]', error);
    const status = (error as { status?: number })?.status || 502;
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'AI 生成失败' },
      { status }
    );
  }
}
