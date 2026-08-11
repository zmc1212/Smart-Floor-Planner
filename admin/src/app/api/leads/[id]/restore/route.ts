import { NextResponse } from 'next/server';
import { leadToDto, parsePostgresId } from '@/db/postgres-dto';
import { LeadLifecycleRepository, LeadRepository } from '@/db/repositories';
import { getTenantContext } from '@/lib/auth';
import { canAccessLeadForActor, canManageLeadArchive } from '@/lib/lead-lifecycle';
import { withAdminPostgresTransaction } from '@/lib/postgres-request-scope';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await getTenantContext(request);
    if (!context) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    if (!context.enterpriseId) return NextResponse.json({ success: false, error: '请先选择企业' }, { status: 400 });
    const leadId = parsePostgresId((await params).id, 'leadId');
    const actorId = parsePostgresId(context.userId, 'userId');
    const restored = await withAdminPostgresTransaction(context, async (transaction) => {
      const allowed = await canManageLeadArchive(transaction, { role: context.role, actorId, enterpriseId: BigInt(context.enterpriseId!) });
      if (!allowed) return { forbidden: true as const };
      const lifecycle = new LeadLifecycleRepository(transaction);
      await lifecycle.lockByIds([leadId]);
      const lead = await new LeadRepository(transaction).findById(leadId);
      if (!lead || !canAccessLeadForActor(lead, context.role, actorId)) return null;
      if (!lead.archivedAt) return { alreadyActive: true as const };
      await lifecycle.restore(leadId, actorId);
      const result = await new LeadRepository(transaction).findById(leadId);
      return result ? { lead: result } : null;
    });
    if (restored && 'forbidden' in restored) return NextResponse.json({ success: false, error: '无权恢复客户线索' }, { status: 403 });
    if (!restored) return NextResponse.json({ success: false, error: '线索不存在或无权访问' }, { status: 404 });
    if ('alreadyActive' in restored) return NextResponse.json({ success: false, error: '线索未归档' }, { status: 409 });
    return NextResponse.json({ success: true, data: leadToDto(restored.lead) });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '恢复失败' }, { status: 500 });
  }
}
