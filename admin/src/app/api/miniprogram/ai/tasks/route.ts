import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { resolveMiniAiContext } from '@/lib/ai/mini-ai-auth';
import { createMiniAiTask, serializeMiniAiTask, type CreateMiniAiTaskInput } from '@/lib/ai/mini-ai-tasks';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    await dbConnect();
    const context = await resolveMiniAiContext(request);
    if (!context) {
      return NextResponse.json({ success: false, error: '仅企业员工可以创建 AI 任务' }, { status: 403 });
    }
    const body = (await request.json()) as CreateMiniAiTaskInput;
    const generation = await createMiniAiTask(body, context);
    return NextResponse.json({ success: true, data: serializeMiniAiTask(generation, request) });
  } catch (error) {
    console.error('[Mini AI Task Create]', error);
    const status = (error as { status?: number })?.status || 400;
    const existingTaskId = (error as { existingTaskId?: string })?.existingTaskId;
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'AI 任务创建失败',
        code: (error as { code?: string })?.code,
        existingTaskId,
      },
      { status: status >= 400 && status < 600 ? status : 400 }
    );
  }
}
