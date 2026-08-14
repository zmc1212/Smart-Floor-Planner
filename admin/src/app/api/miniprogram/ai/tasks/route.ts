import { NextResponse } from 'next/server';
import { resolveMiniAiContext } from '@/lib/ai/mini-ai-auth';
import { createPostgresMiniAiTask, serializePostgresMiniAiTask, type CreateMiniAiTaskInput } from '@/lib/ai/postgres-mini-ai-tasks';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const context = await resolveMiniAiContext(request);
    if (!context) {
      return NextResponse.json({ success: false, error: '仅企业员工可以创建 AI 任务' }, { status: 403 });
    }
    const body = (await request.json()) as CreateMiniAiTaskInput;
    const generation = await createPostgresMiniAiTask(body, context);
    if (!generation) throw new Error('AI 任务创建失败');
    return NextResponse.json({ success: true, data: serializePostgresMiniAiTask(generation, request) });
  } catch (error) {
    console.error('[Mini AI Task Create]', error);
    const status = (error as { status?: number })?.status || 400;
    const existingTaskId = (error as { existingTaskId?: string })?.existingTaskId;
    const workflows = (error as { workflows?: unknown[] })?.workflows;
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'AI 任务创建失败',
        code: (error as { code?: string })?.code,
        existingTaskId,
        workflows,
      },
      { status: status >= 400 && status < 600 ? status : 400 }
    );
  }
}
