import { NextResponse } from 'next/server';
import { resolveMiniAiContext } from '@/lib/ai/mini-ai-auth';
import { listPostgresMiniAiTasks, serializePostgresMiniAiTask } from '@/lib/ai/postgres-mini-ai-tasks';
import { reconcilePostgresCreationTasks } from '@/lib/ai/postgres-creation-runtime';

export async function GET(request: Request) {
  try {
    const context = await resolveMiniAiContext(request);
    if (!context) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get('page') || 1));
    const limit = Math.min(30, Math.max(1, Number(url.searchParams.get('limit') || 12)));
    const result = await listPostgresMiniAiTasks(context, page, limit);
    if (result.rows.some((row) => row.status === 'processing')) {
      await reconcilePostgresCreationTasks(context.enterpriseId, 4).catch((error) => console.error('[Mini AI History Reconcile]', error));
    }
    const refreshed = await listPostgresMiniAiTasks(context, page, limit);
    return NextResponse.json({ success: true, data: refreshed.rows.map((item) => serializePostgresMiniAiTask(item, request)), pagination: { page, limit, total: refreshed.total, totalPages: Math.ceil(refreshed.total / limit) } });
  } catch (error) {
    console.error('[Mini AI History]', error);
    return NextResponse.json({ success: false, error: '读取历史失败' }, { status: 500 });
  }
}
