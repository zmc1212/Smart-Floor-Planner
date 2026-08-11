import { NextResponse } from 'next/server';
import { resolveMiniAiContext } from '@/lib/ai/mini-ai-auth';
import { executePostgresMiniAiTask, getPostgresMiniAiTask, serializePostgresMiniAiTask } from '@/lib/ai/postgres-mini-ai-tasks';

export const maxDuration = 120;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await resolveMiniAiContext(request);
    if (!context) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;
    const generation = await getPostgresMiniAiTask(id, context);
    if (!generation) return NextResponse.json({ success: false, error: '任务不存在' }, { status: 404 });
    if (!['pending', 'created'].includes(generation.status)) return NextResponse.json({ success: true, data: serializePostgresMiniAiTask(generation, request) });
    const result = await executePostgresMiniAiTask(id, context);
    if (!result) throw new Error('AI 任务执行失败');
    return NextResponse.json({ success: true, data: serializePostgresMiniAiTask(result, request) });
  } catch (error) {
    console.error('[Mini AI Task Run]', error);
    const status = (error as { status?: number })?.status || 502;
    return NextResponse.json({ success: false, code: (error as { code?: string })?.code, error: error instanceof Error ? error.message : 'AI 生成失败' }, { status });
  }
}
