import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { LeadLifecycleRepository, LeadRepository } from '@/db/repositories';
import { getTenantContext } from '@/lib/auth';
import { canAccessLeadForActor, canPurgeLeads, serializeLeadLifecycleImpact } from '@/lib/lead-lifecycle';
import { withAdminPostgresTransaction } from '@/lib/postgres-request-scope';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await getTenantContext(request);
    if (!context) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    if (!context.enterpriseId) return NextResponse.json({ success: false, error: '请先选择企业' }, { status: 400 });
    if (!canPurgeLeads(context.role)) return NextResponse.json({ success: false, error: '无权永久删除客户线索' }, { status: 403 });
    const leadId = parsePostgresId((await params).id, 'leadId');
    const actorId = parsePostgresId(context.userId, 'userId');
    const data = await withAdminPostgresTransaction(context, async (transaction) => {
      const lead = await new LeadRepository(transaction).findById(leadId);
      if (!lead || !canAccessLeadForActor(lead, context.role, actorId)) return null;
      const impact = (await new LeadLifecycleRepository(transaction).impacts([leadId]))[0];
      return impact ? serializeLeadLifecycleImpact(impact) : null;
    });
    if (!data) return NextResponse.json({ success: false, error: '线索不存在或无权访问' }, { status: 404 });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '删除预检失败' }, { status: 500 });
  }
}
