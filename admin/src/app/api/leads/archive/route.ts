import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { LeadLifecycleRepository, LeadRepository } from '@/db/repositories';
import { getTenantContext } from '@/lib/auth';
import {
  canAccessLeadForActor,
  canManageLeadArchive,
  isLeadArchiveReason,
  serializeLeadLifecycleImpact,
} from '@/lib/lead-lifecycle';
import { withAdminPostgresTransaction } from '@/lib/postgres-request-scope';

export async function POST(request: Request) {
  try {
    const context = await getTenantContext(request);
    if (!context) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    if (!context.enterpriseId) return NextResponse.json({ success: false, error: '请先选择企业' }, { status: 400 });
    const body = await request.json();
    if (!Array.isArray(body.ids) || body.ids.length < 1 || body.ids.length > 100 || !isLeadArchiveReason(body.reason)) {
      return NextResponse.json({ success: false, error: '请选择 1-100 条线索并填写有效归档原因' }, { status: 400 });
    }
    const ids: bigint[] = Array.from(
      new Set<bigint>(body.ids.map((id: unknown) => parsePostgresId(id, 'leadId'))),
    );
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : null;
    const actorId = parsePostgresId(context.userId, 'userId');
    const data = await withAdminPostgresTransaction(context, async (transaction) => {
      const allowed = await canManageLeadArchive(transaction, {
        role: context.role,
        actorId,
        enterpriseId: BigInt(context.enterpriseId!),
      });
      if (!allowed) return null;
      const lifecycle = new LeadLifecycleRepository(transaction);
      const locked = await lifecycle.lockByIds(ids);
      const relations = await new LeadRepository(transaction).findByIds(ids, { includeArchived: true });
      const relationMap = new Map(relations.map((lead) => [lead.id, lead]));
      const impacts = await lifecycle.impacts(locked.map((lead) => lead.id));
      const impactMap = new Map(impacts.map((impact) => [impact.leadId, impact]));
      const results = [];
      for (const id of ids) {
        const lead = relationMap.get(id);
        const impact = impactMap.get(id);
        if (!lead || !impact || !canAccessLeadForActor(lead, context.role, actorId)) {
          results.push({ leadId: id.toString(), status: 'unavailable' });
        } else if (impact.archived) {
          results.push({ leadId: id.toString(), status: 'already_archived' });
        } else if (impact.inFlightAiCount > 0) {
          results.push({ leadId: id.toString(), status: 'blocked', impact: serializeLeadLifecycleImpact(impact) });
        } else {
          await lifecycle.archive({ leadId: id, actorId, reason: body.reason, note, impact });
          results.push({ leadId: id.toString(), status: 'archived' });
        }
      }
      return results;
    });
    if (!data) return NextResponse.json({ success: false, error: '无权归档客户线索' }, { status: 403 });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '归档失败' }, { status: 500 });
  }
}
