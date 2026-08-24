import { NextResponse } from 'next/server';
import { leadToDto, parsePostgresId } from '@/db/postgres-dto';
import { AssignmentRacingRepository, hashClaimIdempotencyKey } from '@/db/repositories';
import { resolveLeadAssignmentRequest, withLeadAssignmentTransaction } from '@/lib/lead-assignment-request';
import { httpErrorStatus } from '@/lib/http-error';
import { notifyDesignerOfAssignedLead, notifyEnterpriseAdminOfAssignmentPending } from '@/lib/wechat-notification';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await resolveLeadAssignmentRequest(request);
    if (!actor || actor.role !== 'designer' || !actor.actorStaffId) {
      return NextResponse.json({ success: false, error: '仅当前企业设计师可抢单' }, { status: 403 });
    }
    const idempotencyKey = request.headers.get('idempotency-key')?.trim();
    if (!idempotencyKey || idempotencyKey.length > 160) {
      return NextResponse.json({ success: false, error: '缺少有效的 Idempotency-Key' }, { status: 400 });
    }
    const { id } = await params;
    const result = await withLeadAssignmentTransaction(actor, (transaction) =>
      new AssignmentRacingRepository(transaction).claimLead({
        leadId: parsePostgresId(id, 'lead id'),
        designerId: actor.actorStaffId!,
        actorUserId: actor.actorUserId,
        idempotencyKeyHash: hashClaimIdempotencyKey(idempotencyKey),
      })
    );
    if (result.kind === 'not_found') {
      return NextResponse.json({ success: false, code: 'lead_not_found', error: '线索不存在' }, { status: 404 });
    }
    if (result.kind === 'already_claimed') {
      return NextResponse.json({ success: false, code: 'lead_already_claimed', error: '这条线索刚刚被抢走' }, { status: 409 });
    }
    if (result.kind === 'not_assignable') {
      return NextResponse.json({ success: false, code: 'lead_not_assignable', error: '该线索已结案、签约或归档，不能继续抢单' }, { status: 409 });
    }
    if (result.kind === 'expired') {
      const resolved = result.resolved;
      if ('lead' in resolved && resolved.lead) {
        const lead = resolved.lead;
        const notificationLead = { ...lead, enterpriseId: lead.enterpriseId?.toString() };
        if (lead.assignedTo) await notifyDesignerOfAssignedLead(notificationLead, lead.assignedTo.toString());
        if (resolved.kind === 'pending') {
          await notifyEnterpriseAdminOfAssignmentPending(notificationLead, {
            reasonCode: lead.assignmentErrorCode || 'designer_unavailable',
            eventKey: `claim-expired:${id}`,
          });
        }
      }
      return NextResponse.json({ success: false, code: 'claim_expired', error: '抢单已截止，该线索已进入自动派单' }, { status: 409 });
    }
    const lead = result.lead;
    if (!lead) return NextResponse.json({ success: false, error: '抢单结果不可用' }, { status: 500 });
    await notifyDesignerOfAssignedLead({ ...lead, enterpriseId: lead.enterpriseId?.toString() }, actor.actorStaffId.toString());
    return NextResponse.json({ success: true, idempotent: result.idempotent, data: leadToDto(lead) });
  } catch (error) {
    const typed = error as { code?: string };
    return NextResponse.json(
      { success: false, code: typed.code, error: error instanceof Error ? error.message : '抢单失败' },
      { status: httpErrorStatus(error, 500) }
    );
  }
}
