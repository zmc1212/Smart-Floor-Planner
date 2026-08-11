import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { LeadLifecycleRepository, LeadRepository } from '@/db/repositories';
import { getTenantContext } from '@/lib/auth';
import {
  canAccessLeadForActor,
  canManageLeadArchive,
  serializeLeadLifecycleImpact,
} from '@/lib/lead-lifecycle';
import { withAdminPostgresTransaction } from '@/lib/postgres-request-scope';

function parseIds(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) return null;
  try {
    return [...new Set(value.map((id) => parsePostgresId(id, 'leadId')))];
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const context = await getTenantContext(request);
    if (!context) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    if (!context.enterpriseId) return NextResponse.json({ success: false, error: '请先选择企业' }, { status: 400 });
    const ids = parseIds((await request.json()).ids);
    if (!ids) return NextResponse.json({ success: false, error: '请选择 1-100 条线索' }, { status: 400 });
    const actorId = parsePostgresId(context.userId, 'userId');
    const data = await withAdminPostgresTransaction(context, async (transaction) => {
      const allowed = await canManageLeadArchive(transaction, {
        role: context.role,
        actorId,
        enterpriseId: BigInt(context.enterpriseId!),
      });
      if (!allowed) return null;
      const leads = await new LeadRepository(transaction).findByIds(ids, { includeArchived: true });
      const accessibleIds = leads
        .filter((lead) => canAccessLeadForActor(lead, context.role, actorId))
        .map((lead) => lead.id);
      const impacts = await new LeadLifecycleRepository(transaction).impacts(accessibleIds);
      const map = new Map(impacts.map((impact) => [impact.leadId, serializeLeadLifecycleImpact(impact)]));
      return ids.map((id) => map.get(id) ?? { leadId: id.toString(), unavailable: true });
    });
    if (!data) return NextResponse.json({ success: false, error: '无权归档客户线索' }, { status: 403 });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '归档预检失败' }, { status: 500 });
  }
}
