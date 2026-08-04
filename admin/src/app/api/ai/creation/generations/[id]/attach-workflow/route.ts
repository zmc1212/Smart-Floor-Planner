import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { AiWorkflowRepository } from '@/db/repositories';
import { withTenantTransaction } from '@/db/transaction';
import { withTenantRoute } from '@/lib/tenant-route';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return await withTenantRoute(request, { requireEnterprise: true }, async (context) => {
      const { id } = await params;
      const body = await request.json() as { workflowId?: string };
      if (!body.workflowId) {
        return NextResponse.json({ success: false, error: '请选择客户方案' }, { status: 400 });
      }
      const attached = await withTenantTransaction(
        parsePostgresId(context.enterpriseId!, 'enterpriseId'),
        (transaction) => new AiWorkflowRepository(transaction).attachSucceededFreeCreationGeneration(
          parsePostgresId(body.workflowId, 'workflowId'),
          parsePostgresId(id, 'generationId')
        )
      );
      if (!attached) return NextResponse.json({ success: false, error: '生成结果或客户方案不存在' }, { status: 404 });
      return NextResponse.json({
        success: true,
        data: {
          generationId: attached.generation.id.toString(),
          workflowId: attached.workflow.id.toString(),
        },
      });
    });
  } catch (error) {
    console.error('[AI Creation Attach Workflow]', error);
    return NextResponse.json({ success: false, error: '归入客户方案失败' }, { status: 500 });
  }
}
