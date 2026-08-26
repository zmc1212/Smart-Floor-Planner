import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { CustomerProjectRepository, LeadRepository } from '@/db/repositories';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { getTenantContext } from '@/lib/auth';
import { withAdminPostgresTransaction, withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';

function canPublish(role: string, assignedTo: bigint | null, staffId: bigint) {
  return role === 'enterprise_admin' || (role === 'designer' && assignedTo === staffId);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; workflowId: string }> },
) {
  try {
    const { id, workflowId: workflowIdText } = await params;
    const leadId = parsePostgresId(id, 'lead id');
    const workflowId = parsePostgresId(workflowIdText, 'workflow id');

    const miniContext = await resolveMiniProgramContext(request);
    if (miniContext) {
      if (!miniContext.enterpriseId || miniContext.mode !== 'staff' || !miniContext.staff || !['designer', 'enterprise_admin'].includes(miniContext.staff.role)) {
        return NextResponse.json({ success: false, error: '仅负责家装设计顾问或企业负责人可定稿方案' }, { status: 403 });
      }
      const enterpriseId = parsePostgresId(miniContext.enterpriseId, 'enterprise id');
      const staffId = parsePostgresId(miniContext.staff._id, 'staff id');
      const result = await withMiniProgramPostgresTransaction(miniContext, async (transaction) => {
        const lead = await new LeadRepository(transaction).findById(leadId);
        if (!lead || !canPublish(miniContext.staff!.role, lead.assignedTo, staffId)) return { kind: 'forbidden' as const };
        return new CustomerProjectRepository(transaction).finalizeScheme({
          enterpriseId,
          leadId,
          workflowId,
          finalizedBy: staffId,
        });
      });
      if (result.kind === 'lead_not_found') return NextResponse.json({ success: false, error: '线索不存在' }, { status: 404 });
      if (result.kind === 'lead_archived') return NextResponse.json({ success: false, code: 'LEAD_ARCHIVED', error: '该客户线索已归档' }, { status: 409 });
      if (result.kind === 'workflow_not_found') return NextResponse.json({ success: false, error: '方案对话不存在或不属于该客户' }, { status: 404 });
      if (result.kind === 'publication_not_found') return NextResponse.json({ success: false, error: '该方案尚未发送给客户，无法定稿' }, { status: 409 });
      if (result.kind === 'forbidden') return NextResponse.json({ success: false, error: '无权定稿该客户项目的方案' }, { status: 403 });
      return NextResponse.json({ success: true, data: { workflowId: workflowId.toString() } });
    }

    const admin = await getTenantContext(request);
    if (!admin?.enterpriseId || !['designer', 'enterprise_admin'].includes(admin.role)) {
      return NextResponse.json({ success: false, error: '仅负责家装设计顾问或企业负责人可定稿方案' }, { status: admin ? 403 : 401 });
    }
    const enterpriseId = parsePostgresId(admin.enterpriseId, 'enterprise id');
    const staffId = parsePostgresId(admin.userId, 'user id');
    const result = await withAdminPostgresTransaction(admin, async (transaction) => {
      const lead = await new LeadRepository(transaction).findById(leadId);
      if (!lead || !canPublish(admin.role, lead.assignedTo, staffId)) return { kind: 'forbidden' as const };
      return new CustomerProjectRepository(transaction).finalizeScheme({
        enterpriseId,
        leadId,
        workflowId,
        finalizedBy: staffId,
      });
    });
    if (result.kind === 'lead_not_found') return NextResponse.json({ success: false, error: '线索不存在' }, { status: 404 });
    if (result.kind === 'lead_archived') return NextResponse.json({ success: false, code: 'LEAD_ARCHIVED', error: '该客户线索已归档' }, { status: 409 });
    if (result.kind === 'workflow_not_found') return NextResponse.json({ success: false, error: '方案对话不存在或不属于该客户' }, { status: 404 });
    if (result.kind === 'publication_not_found') return NextResponse.json({ success: false, error: '该方案尚未发送给客户，无法定稿' }, { status: 409 });
    if (result.kind === 'forbidden') return NextResponse.json({ success: false, error: '无权定稿该客户项目的方案' }, { status: 403 });
    return NextResponse.json({ success: true, data: { workflowId: workflowId.toString() } });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '定稿方案失败' }, { status: 400 });
  }
}
