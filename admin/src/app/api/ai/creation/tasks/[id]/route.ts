import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { AiCreationRepository } from '@/db/repositories';
import { withTenantTransaction } from '@/db/transaction';
import { withTenantRoute } from '@/lib/tenant-route';

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return await withTenantRoute(request, { requireEnterprise: true }, async (context) => {
      const { id } = await params;
      const task = await withTenantTransaction(
        parsePostgresId(context.enterpriseId!, 'enterpriseId'),
        (transaction) => new AiCreationRepository(transaction).archiveTask(parsePostgresId(id, 'taskId'))
      );
      if (!task) return NextResponse.json({ success: false, error: '创作任务不存在' }, { status: 404 });
      return NextResponse.json({ success: true });
    });
  } catch (error) {
    console.error('[AI Creation Task DELETE]', error);
    return NextResponse.json({ success: false, error: '删除创作任务失败' }, { status: 500 });
  }
}
