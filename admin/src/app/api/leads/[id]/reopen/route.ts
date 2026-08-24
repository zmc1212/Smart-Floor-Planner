import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { LeadLifecycleRepository } from '@/db/repositories';
import { resolveLeadAssignmentRequest, withLeadAssignmentTransaction } from '@/lib/lead-assignment-request';
import { httpErrorStatus } from '@/lib/http-error';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await resolveLeadAssignmentRequest(request);
    if (!actor?.actorStaffId || !['enterprise_admin', 'admin', 'super_admin'].includes(actor.role)) {
      return NextResponse.json({ success: false, error: '只有企业负责人可以重新激活线索' }, { status: 403 });
    }
    const body = await request.json().catch(() => ({}));
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : null;
    const { id } = await params;
    const result = await withLeadAssignmentTransaction(actor, (transaction) =>
      new LeadLifecycleRepository(transaction).reopenLost({
        leadId: parsePostgresId(id, 'lead id'),
        actorId: actor.actorStaffId!,
        reason,
      })
    );
    if (!result) return NextResponse.json({ success: false, error: '线索不存在' }, { status: 404 });
    return NextResponse.json({ success: true, data: { id, status: result.status } });
  } catch (error) {
    return NextResponse.json({ success: false, code: (error as { code?: string }).code, error: error instanceof Error ? error.message : '重新激活失败' }, { status: httpErrorStatus(error, 500) });
  }
}
