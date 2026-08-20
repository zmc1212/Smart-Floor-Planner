import { NextResponse } from 'next/server';
import { withTenantRoute } from '@/lib/tenant-route';
import { parsePostgresId } from '@/db/postgres-dto';
import { AiCreationRepository, CustomerProjectRepository, LeadRepository } from '@/db/repositories';
import { withTenantTransaction } from '@/db/transaction';

function canManageWorkflow(role: string, assignedTo: bigint | null, staffId: bigint) {
  return role === 'enterprise_admin' || (role === 'designer' && assignedTo === staffId);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; workflowId: string; generationId: string }> }) {
  try {
    return await withTenantRoute(request, { requireEnterprise: true, roles: ['designer', 'enterprise_admin'] }, async (context) => {
      const { id, workflowId: workflowIdText, generationId: generationIdText } = await params;
      const leadId = parsePostgresId(id, 'lead id');
      const workflowId = parsePostgresId(workflowIdText, 'workflow id');
      const generationId = parsePostgresId(generationIdText, 'generation id');
      const enterpriseId = parsePostgresId(context.enterpriseId!, 'enterpriseId');
      const staffId = parsePostgresId(context.userId, 'staff id');

      return withTenantTransaction(enterpriseId, async (transaction) => {
        const lead = await new LeadRepository(transaction).findById(leadId);
        if (!lead) return NextResponse.json({ success: false, error: '线索不存在' }, { status: 404 });
        if (lead.archivedAt) return NextResponse.json({ success: false, code: 'LEAD_ARCHIVED', error: '该客户线索已归档' }, { status: 409 });
        if (!canManageWorkflow(context.role, lead.assignedTo, staffId)) {
          return NextResponse.json({ success: false, error: '无权撤回该方案' }, { status: 403 });
        }

        const generation = await new AiCreationRepository(transaction).findGenerationForUpdate(generationId);
        if (!generation || generation.enterpriseId !== enterpriseId || generation.leadId !== leadId || generation.workflowId !== workflowId) {
          return NextResponse.json({ success: false, error: '轮次生成不存在或无权操作' }, { status: 404 });
        }

        const withdrawn = await new CustomerProjectRepository(transaction).withdraw({
          enterpriseId,
          leadId,
          generationId,
          withdrawnBy: staffId,
        });

        if (withdrawn.kind === 'publication_not_found') {
          // No active publication is fine; still treat as successfully withdrawn.
        }

        return NextResponse.json({ success: true, data: { workflowId: workflowId.toString(), generationId: generationId.toString() } });
      });
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '撤回轮次失败' }, { status: 400 });
  }
}

