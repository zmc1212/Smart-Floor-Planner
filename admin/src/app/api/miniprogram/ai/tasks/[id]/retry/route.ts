import { NextResponse } from 'next/server';
import { resolveMiniAiContext } from '@/lib/ai/mini-ai-auth';
import { retryPostgresMiniAiTask, serializePostgresMiniAiTask } from '@/lib/ai/postgres-mini-ai-tasks';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await resolveMiniAiContext(request);
    if (!context) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;
    const retried = await retryPostgresMiniAiTask(id, context);
    if (!retried) return NextResponse.json({ success: false, error: '任务不存在' }, { status: 404 });
    return NextResponse.json({ success: true, data: serializePostgresMiniAiTask(retried, request) });
  } catch (error) {
    console.error('[Mini AI Task Retry]', error);
    const status = (error as { status?: number })?.status || 400;
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '重试失败' }, { status });
  }
}
