import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { LeadLifecycleRepository, LeadRepository, INVALID_LOST_REASONS, NORMAL_LOST_REASONS } from '@/db/repositories';
import { resolveLeadAssignmentRequest, withLeadAssignmentTransaction } from '@/lib/lead-assignment-request';
import { httpErrorStatus } from '@/lib/http-error';

const MANAGER_ROLES = new Set(['enterprise_admin', 'admin', 'super_admin']);

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await resolveLeadAssignmentRequest(request);
    if (!actor?.actorStaffId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const body = await request.json();
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : null;
    const normal = (NORMAL_LOST_REASONS as readonly string[]).includes(reason);
    const invalid = (INVALID_LOST_REASONS as readonly string[]).includes(reason);
    if (!normal && !invalid) return NextResponse.json({ success: false, error: '请选择有效的结案原因' }, { status: 400 });
    if (reason === 'other' && !note) return NextResponse.json({ success: false, error: '选择“其他”时必须填写备注' }, { status: 400 });
    if (invalid && !MANAGER_ROLES.has(actor.role)) {
      return NextResponse.json({ success: false, error: '只有企业负责人可以标记无效、重复或误录线索' }, { status: 403 });
    }
    const { id } = await params;
    const leadId = parsePostgresId(id, 'lead id');
    const result = await withLeadAssignmentTransaction(actor, async (transaction) => {
      const lead = await new LeadRepository(transaction).findById(leadId);
      if (!lead) return { kind: 'not_found' as const };
      const allowed = MANAGER_ROLES.has(actor.role)
        || (actor.role === 'designer' && lead.assignedTo === actor.actorStaffId);
      if (!allowed) return { kind: 'forbidden' as const };
      const closed = await new LeadLifecycleRepository(transaction).closeLost({
        leadId,
        actorId: actor.actorStaffId!,
        reason,
        note,
        performanceEligible: normal,
      });
      return { kind: 'closed' as const, closed };
    });
    if (result.kind === 'not_found') return NextResponse.json({ success: false, error: '线索不存在' }, { status: 404 });
    if (result.kind === 'forbidden') return NextResponse.json({ success: false, error: '无权结案该线索' }, { status: 403 });
    return NextResponse.json({ success: true, data: { id, status: result.closed?.status, reason, performanceEligible: normal } });
  } catch (error) {
    return NextResponse.json({ success: false, code: (error as { code?: string }).code, error: error instanceof Error ? error.message : '结案失败' }, { status: httpErrorStatus(error, 500) });
  }
}
