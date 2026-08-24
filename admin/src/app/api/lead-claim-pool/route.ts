import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { AssignmentRacingRepository } from '@/db/repositories';
import { resolveLeadAssignmentRequest, withLeadAssignmentTransaction } from '@/lib/lead-assignment-request';
import { getLeadSourceLabel } from '@/lib/lead-source-labels';

export const dynamic = 'force-dynamic';

function enterpriseIdForActor(actor: NonNullable<Awaited<ReturnType<typeof resolveLeadAssignmentRequest>>>) {
  const value = actor.kind === 'mini' ? actor.mini.enterpriseId : actor.admin.enterpriseId;
  return value ? parsePostgresId(value, 'enterprise id') : null;
}

export async function GET(request: Request) {
  try {
    const actor = await resolveLeadAssignmentRequest(request);
    if (!actor || !['designer', 'enterprise_admin', 'admin', 'super_admin'].includes(actor.role)) {
      return NextResponse.json({ success: false, error: '无权查看抢单池' }, { status: 403 });
    }
    const enterpriseId = enterpriseIdForActor(actor);
    if (!enterpriseId) {
      return NextResponse.json({ success: false, error: '请先选择企业' }, { status: 400 });
    }
    const managerView = ['enterprise_admin', 'admin', 'super_admin'].includes(actor.role);
    const result = await withLeadAssignmentTransaction(actor, async (transaction) => {
      const repository = new AssignmentRacingRepository(transaction);
      const setting = await repository.getCurrentSettings(enterpriseId);
      const [rows, performance] = await Promise.all([
        repository.listClaimPool({ enterpriseId, managerView }),
        repository.listDesignerPerformance(enterpriseId, setting || undefined),
      ]);
      return { rows, setting, performance };
    });
    const current = result.performance.find((item) => item.staff.id === actor.actorStaffId);
    const serverNow = new Date();
    return NextResponse.json({
      success: true,
      serverNow: serverNow.toISOString(),
      data: result.rows.map(({ window, lead }) => ({
        id: lead.id.toString(),
        claimWindowId: window.id.toString(),
        status: window.status,
        canClaim: !managerView
          && Boolean(current?.eligibleForAssignment)
          && window.status === 'open'
          && window.expiresAt.getTime() > serverNow.getTime(),
        expiresAt: window.expiresAt.toISOString(),
        remainingSeconds: Math.max(0, Math.ceil((window.expiresAt.getTime() - serverNow.getTime()) / 1000)),
        city: lead.city || null,
        communityArea: lead.communityName || null,
        area: lead.area ? Number(lead.area) : null,
        stylePreference: lead.stylePreference || null,
        source: lead.source,
        sourceLabel: getLeadSourceLabel(lead.source),
        claimedByStaffId: managerView ? window.claimedByStaffId?.toString() || null : undefined,
        assignmentGroup: managerView ? window.assignmentGroup : undefined,
        resolutionReason: managerView ? window.resolutionReason : undefined,
      })),
      capacity: current ? {
        current: current.openLeadCount,
        limit: current.capacity,
        available: current.eligibleForAssignment,
      } : null,
      settings: result.setting ? {
        claimEnabled: result.setting.claimEnabled,
        claimDurationSeconds: result.setting.claimDurationSeconds,
      } : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '读取抢单池失败';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
