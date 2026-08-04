import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { AiCreationRepository } from '@/db/repositories';
import { withTenantTransaction } from '@/db/transaction';
import { withTenantRoute } from '@/lib/tenant-route';
import { createPostgresCreationTask } from '@/lib/ai/postgres-creation-service';
import {
  reconcilePostgresCreationTasks,
  serializePostgresCreationTask,
} from '@/lib/ai/postgres-creation-runtime';

export async function GET(request: Request) {
  try {
    return await withTenantRoute(request, { requireEnterprise: true }, async (context) => {
      const enterpriseId = parsePostgresId(context.enterpriseId!, 'enterpriseId');
      const url = new URL(request.url);
      const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
      const limit = Math.min(30, Math.max(1, Number(url.searchParams.get('limit')) || 12));
      const query = url.searchParams.get('q')?.trim();
      await reconcilePostgresCreationTasks(enterpriseId.toString()).catch((error) =>
        console.error('[AI Creation PostgreSQL Reconcile]', error)
      );
      const listed = await withTenantTransaction(enterpriseId, async (transaction) => {
        const repository = new AiCreationRepository(transaction);
        const result = await repository.listTasks({ page, limit, query });
        const views = await Promise.all(result.tasks.map((task) => repository.loadTaskView(task.id)));
        return { ...result, views: views.filter((view): view is NonNullable<typeof view> => Boolean(view)) };
      });
      return NextResponse.json({
        success: true,
        data: listed.views.map(serializePostgresCreationTask),
        pagination: {
          page: listed.page,
          limit: listed.limit,
          total: listed.total,
          totalPages: Math.ceil(listed.total / listed.limit),
        },
      });
    });
  } catch (error) {
    console.error('[AI Creation Tasks GET]', error);
    return NextResponse.json({ success: false, error: '加载创作历史失败' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    return await withTenantRoute(request, { requireEnterprise: true }, async (context) => {
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
      const enterpriseId = parsePostgresId(context.enterpriseId!, 'enterpriseId');
      const task = await createPostgresCreationTask({
        enterpriseId: enterpriseId.toString(),
        operatorId: context.userId,
        title,
        prompt,
        modelProfileId: body.modelProfileId,
        referenceAssetIds: body.referenceAssetIds,
      });
      const view = await withTenantTransaction(enterpriseId, (transaction) =>
        new AiCreationRepository(transaction).loadTaskView(task.id)
      );
      if (!view) throw new Error('创作任务创建后无法读取');
      return NextResponse.json({ success: true, data: serializePostgresCreationTask(view) });
    });
  } catch (error) {
    console.error('[AI Creation Tasks POST]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '创建任务失败' },
      { status: 400 }
    );
  }
}
