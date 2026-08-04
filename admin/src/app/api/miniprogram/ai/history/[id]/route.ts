import { NextResponse } from 'next/server';
import { resolveMiniAiContext } from '@/lib/ai/mini-ai-auth';
import { deletePostgresMiniAiTask } from '@/lib/ai/postgres-mini-ai-tasks';

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await resolveMiniAiContext(request);
    if (!context) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;
    const deleted = await deletePostgresMiniAiTask(id, context);
    if (!deleted) return NextResponse.json({ success: false, error: '记录不存在' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Mini AI History Delete]', error);
    const status = (error as { status?: number })?.status || 500;
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '删除历史失败' }, { status });
  }
}
