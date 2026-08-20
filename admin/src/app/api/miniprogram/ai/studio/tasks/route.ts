import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { AiCreationRepository } from '@/db/repositories';
import { withTenantTransaction } from '@/db/transaction';
import { createPostgresCreationTask } from '@/lib/ai/postgres-creation-service';
import {
  isMiniStudioContext,
  requireMiniStudioContext,
  serializeCreationTaskForMini,
} from '@/lib/ai/mini-ai-studio';
import {
  reconcilePostgresCreationTasks,
} from '@/lib/ai/postgres-creation-runtime';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await requireMiniStudioContext(request);
    if (!isMiniStudioContext(context)) return context;
    const url = new URL(request.url);
    const workflowId = url.searchParams.get('workflowId')?.trim();
    if (!workflowId) {
      return NextResponse.json({ success: false, error: '请提供 workflowId' }, { status: 400 });
    }
    const enterpriseId = parsePostgresId(context.enterpriseId, 'enterpriseId');
    await reconcilePostgresCreationTasks(enterpriseId.toString()).catch((error) =>
      console.error('[Mini AI Studio Creation Reconcile]', error),
    );
    const view = await withTenantTransaction(enterpriseId, async (transaction) => {
      const repository = new AiCreationRepository(transaction);
      const taskId = await repository.findLatestCreationTaskIdForWorkflow(
        parsePostgresId(workflowId, 'workflowId'),
      );
      return taskId ? repository.loadTaskView(taskId) : null;
    });
    return NextResponse.json({
      success: true,
      data: view ? serializeCreationTaskForMini(request, context.enterpriseId, view) : null,
    });
  } catch (error) {
    console.error('[Mini AI Studio Tasks GET]', error);
    return NextResponse.json({ success: false, error: '加载创作任务失败' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireMiniStudioContext(request);
    if (!isMiniStudioContext(context)) return context;
    const body = await request.json() as {
      title?: string;
      prompt?: string;
      referenceAssetIds?: string[];
      modelProfileId?: string;
    };
    const prompt = String(body.prompt || '').trim();
    const title = String(body.title || prompt.slice(0, 30) || '未命名创作').trim();
    if (!prompt) return NextResponse.json({ success: false, error: '请输入提示词' }, { status: 400 });
    if (!body.modelProfileId) return NextResponse.json({ success: false, error: '请选择模型' }, { status: 400 });
    const enterpriseId = parsePostgresId(context.enterpriseId, 'enterpriseId');
    const task = await createPostgresCreationTask({
      enterpriseId: enterpriseId.toString(),
      operatorId: context.operatorId,
      title,
      prompt,
      modelProfileId: body.modelProfileId,
      referenceAssetIds: body.referenceAssetIds,
    });
    const view = await withTenantTransaction(enterpriseId, (transaction) =>
      new AiCreationRepository(transaction).loadTaskView(task.id),
    );
    if (!view) throw new Error('创作任务创建后无法读取');
    return NextResponse.json({
      success: true,
      data: serializeCreationTaskForMini(request, context.enterpriseId, view),
    });
  } catch (error) {
    console.error('[Mini AI Studio Tasks POST]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '创建任务失败' },
      { status: 400 },
    );
  }
}
