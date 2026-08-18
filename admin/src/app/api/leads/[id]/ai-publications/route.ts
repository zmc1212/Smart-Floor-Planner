import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { CustomerProjectRepository, LeadRepository } from '@/db/repositories';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';

function canPublish(role: string, assignedTo: bigint | null, staffId: bigint) {
  return role === 'enterprise_admin' || (role === 'designer' && assignedTo === staffId);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await resolveMiniProgramContext(request);
    if (!context?.enterpriseId || context.mode !== 'staff' || !context.staff || !['designer', 'enterprise_admin'].includes(context.staff.role)) {
      return NextResponse.json({ success: false, error: '仅负责设计师或企业负责人可发布方案' }, { status: 403 });
    }
    const body = await request.json();
    const enterpriseId = parsePostgresId(context.enterpriseId, 'enterprise id');
    const leadId = parsePostgresId((await params).id, 'lead id');
    const generationId = parsePostgresId(body.generationId, 'generation id');
    const staffId = parsePostgresId(context.staff._id, 'staff id');
    const result = await withMiniProgramPostgresTransaction(context, async (transaction) => {
      const lead = await new LeadRepository(transaction).findById(leadId);
      if (!lead || !canPublish(context.staff!.role, lead.assignedTo, staffId)) {
        return { kind: 'forbidden' as const };
      }
      const repository = new CustomerProjectRepository(transaction);
      return repository.publish({ enterpriseId, leadId, generationId, publishedBy: staffId });
    });
    if (result.kind === 'lead_not_found') return NextResponse.json({ success: false, error: '线索不存在' }, { status: 404 });
    if (result.kind === 'lead_archived') return NextResponse.json({ success: false, code: 'LEAD_ARCHIVED', error: '该客户线索已归档' }, { status: 409 });
    if (result.kind === 'generation_not_publishable') return NextResponse.json({ success: false, error: '方案未完成、已删除或不属于该客户项目' }, { status: 409 });
    if (result.kind === 'forbidden') return NextResponse.json({ success: false, error: '无权发布该客户项目的方案' }, { status: 403 });
    return NextResponse.json({ success: true, data: { id: result.publication?.publication.id.toString(), generationId: generationId.toString() } }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '发布方案失败' }, { status: 400 });
  }
}
