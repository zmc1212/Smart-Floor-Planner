import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { CustomerProjectRepository, LeadRepository } from '@/db/repositories';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; generationId: string }> }) {
  try {
    const context = await resolveMiniProgramContext(request);
    if (!context?.enterpriseId || context.mode !== 'staff' || !context.staff || !['designer', 'enterprise_admin'].includes(context.staff.role)) {
      return NextResponse.json({ success: false, error: '仅负责设计师或企业负责人可撤回方案' }, { status: 403 });
    }
    const { id, generationId: generationIdText } = await params;
    const enterpriseId = parsePostgresId(context.enterpriseId, 'enterprise id');
    const leadId = parsePostgresId(id, 'lead id');
    const generationId = parsePostgresId(generationIdText, 'generation id');
    const staffId = parsePostgresId(context.staff._id, 'staff id');
    const result = await withMiniProgramPostgresTransaction(context, async (transaction) => {
      const lead = await new LeadRepository(transaction).findById(leadId);
      if (!lead || (context.staff!.role !== 'enterprise_admin' && lead.assignedTo !== staffId)) {
        return { kind: 'forbidden' as const };
      }
      const repository = new CustomerProjectRepository(transaction);
      return repository.withdraw({ enterpriseId, leadId, generationId, withdrawnBy: staffId });
    });
    if (result.kind === 'lead_not_found') return NextResponse.json({ success: false, error: '线索不存在' }, { status: 404 });
    if (result.kind === 'lead_archived') return NextResponse.json({ success: false, code: 'LEAD_ARCHIVED', error: '该客户线索已归档' }, { status: 409 });
    if (result.kind === 'publication_not_found') return NextResponse.json({ success: false, error: '未找到当前已发布方案' }, { status: 404 });
    if (result.kind === 'forbidden') return NextResponse.json({ success: false, error: '无权撤回该客户项目的方案' }, { status: 403 });
    return NextResponse.json({ success: true, data: { id: result.publication!.id.toString(), generationId: generationId.toString() } });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '撤回方案失败' }, { status: 400 });
  }
}
