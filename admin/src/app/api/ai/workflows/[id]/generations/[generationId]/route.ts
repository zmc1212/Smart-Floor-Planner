import { NextResponse } from 'next/server';
import { withTenantRoute } from '@/lib/tenant-route';
import { parsePostgresId } from '@/db/postgres-dto';
import { AiCreationRepository, AiWorkflowRepository, CustomerProjectRepository, LeadRepository } from '@/db/repositories';
import { withTenantTransaction } from '@/db/transaction';

const DISALLOWED_STATUSES_FOR_DELETE = ['created', 'pending', 'processing'] as const;

function canManageWorkflow(role: string, assignedTo: bigint | null, staffId: bigint) {
  return role === 'enterprise_admin' || (role === 'designer' && assignedTo === staffId);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; generationId: string }> }) {
  try {
    return await withTenantRoute(request, { requireEnterprise: true, roles: ['designer', 'enterprise_admin'] }, async (context) => {
      const { id, generationId: generationIdText } = await params;
      const workflowId = parsePostgresId(id, 'workflowId');
      const generationId = parsePostgresId(generationIdText, 'generationId');
      const enterpriseId = parsePostgresId(context.enterpriseId!, 'enterpriseId');
      const staffId = parsePostgresId(context.userId, 'staff id');

      const now = new Date();

      return withTenantTransaction(enterpriseId, async (transaction) => {
        const workflow = await new AiWorkflowRepository(transaction).findById(workflowId);
        if (!workflow || workflow.status !== 'active') {
          return NextResponse.json({ success: false, error: '方案会话不存在或无权访问' }, { status: 404 });
        }

        const generation = await new AiCreationRepository(transaction).findGenerationForUpdate(generationId);
        if (!generation || generation.enterpriseId !== enterpriseId || generation.workflowId !== workflowId || generation.leadId === null) {
          return NextResponse.json({ success: false, error: '轮次生成不存在或无权操作' }, { status: 404 });
        }

        if (DISALLOWED_STATUSES_FOR_DELETE.includes(generation.status as typeof DISALLOWED_STATUSES_FOR_DELETE[number])) {
          return NextResponse.json({ success: false, error: '请等待该轮次任务结束后再删除' }, { status: 409 });
        }

        const lead = await new LeadRepository(transaction).findById(generation.leadId);
        if (!lead) return NextResponse.json({ success: false, error: '线索不存在' }, { status: 404 });
        if (lead.archivedAt) return NextResponse.json({ success: false, code: 'LEAD_ARCHIVED', error: '该客户线索已归档' }, { status: 409 });

        if (!canManageWorkflow(context.role, lead.assignedTo, staffId)) {
          return NextResponse.json({ success: false, error: '无权删除该方案轮次' }, { status: 403 });
        }

        await new AiCreationRepository(transaction).updateGeneration(generationId, { deletedAt: now });
        await new CustomerProjectRepository(transaction).withdraw({ enterpriseId, leadId: generation.leadId, generationId, withdrawnBy: staffId });

        // Keep workflow baseline pointers valid after deletion.
        const updateValues: { selectedGenerationId?: bigint | null; lastGenerationId?: bigint | null } = {};
        if (workflow.selectedGenerationId === generationId) updateValues.selectedGenerationId = null;
        if (workflow.lastGenerationId === generationId) updateValues.lastGenerationId = null;
        if (Object.keys(updateValues).length) {
          await new AiWorkflowRepository(transaction).update(workflowId, updateValues);
        }

        return NextResponse.json({ success: true, data: { workflowId: workflowId.toString(), generationId: generationId.toString() } });
      });
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '删除轮次失败' }, { status: 400 });
  }
}

