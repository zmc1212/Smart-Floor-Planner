import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { AssignmentRacingRepository } from '@/db/repositories';
import { resolveLeadAssignmentRequest, withLeadAssignmentTransaction } from '@/lib/lead-assignment-request';

export async function GET(request: Request) {
  try {
    const actor = await resolveLeadAssignmentRequest(request);
    if (!actor || !['enterprise_admin', 'admin', 'super_admin'].includes(actor.role)) {
      return NextResponse.json({ success: false, error: '无权查看派单绩效' }, { status: 403 });
    }
    const value = actor.kind === 'mini' ? actor.mini.enterpriseId : actor.admin.enterpriseId;
    if (!value) return NextResponse.json({ success: false, error: '请先选择企业' }, { status: 400 });
    const enterpriseId = parsePostgresId(value, 'enterprise id');
    const result = await withLeadAssignmentTransaction(actor, async (transaction) => {
      const repo = new AssignmentRacingRepository(transaction);
      const setting = await repo.getCurrentSettings(enterpriseId);
      const [rows, counter] = await Promise.all([
        repo.listDesignerPerformance(enterpriseId, setting || undefined),
        setting ? repo.listDistribution(enterpriseId, setting.id) : Promise.resolve({ highCount: 0, standardCount: 0 }),
      ]);
      return { setting, rows, counter };
    });
    const total = result.counter.highCount + result.counter.standardCount;
    return NextResponse.json({
      success: true,
      data: result.rows.map((item) => ({
        staffId: item.staff.id.toString(),
        name: item.staff.displayName || item.staff.username,
        effectiveSamples: item.effectiveSamples,
        signedCount: item.signedCount,
        signingRate: Number((item.signingRate * 100).toFixed(2)),
        group: item.group,
        openLeadCount: item.openLeadCount,
        capacity: item.capacity,
        capacityOverride: item.staff.leadCapacityOverride,
        assignmentPaused: item.staff.assignmentPaused,
        eligibleForAssignment: item.eligibleForAssignment,
      })),
      distribution: {
        highCount: result.counter.highCount,
        standardCount: result.counter.standardCount,
        highActualPercent: total ? Number((result.counter.highCount / total * 100).toFixed(2)) : 0,
        targetPercent: result.setting?.highPerformanceTrafficPercent ?? 70,
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '读取派单绩效失败' }, { status: 500 });
  }
}
