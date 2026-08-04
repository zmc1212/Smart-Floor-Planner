import { NextResponse } from 'next/server';
import { resolveMiniAiContext } from '@/lib/ai/mini-ai-auth';
import { getPostgresMiniAiTask, serializePostgresMiniAiTask } from '@/lib/ai/postgres-mini-ai-tasks';
import { reconcilePostgresCreationTasks } from '@/lib/ai/postgres-creation-runtime';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await resolveMiniAiContext(request);
    if (!context) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;
    const generation = await getPostgresMiniAiTask(id, context);
    if (!generation) return NextResponse.json({ success: false, error: '任务不存在' }, { status: 404 });
    if (generation.status === 'processing') {
      try { await reconcilePostgresCreationTasks(context.enterpriseId, 4); } catch (error) { console.error('[Mini AI Task Reconcile]', error); }
    }
    const current = await getPostgresMiniAiTask(id, context);
    if (!current) return NextResponse.json({ success: false, error: '任务不存在' }, { status: 404 });
    return NextResponse.json({ success: true, data: serializePostgresMiniAiTask(current, request) });
  } catch (error) {
    console.error('[Mini AI Task Detail]', error);
    return NextResponse.json({ success: false, error: '读取 AI 任务失败' }, { status: 500 });
  }
}
