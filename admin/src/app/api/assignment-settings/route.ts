import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { AssignmentRacingRepository } from '@/db/repositories';
import { resolveLeadAssignmentRequest, withLeadAssignmentTransaction } from '@/lib/lead-assignment-request';

const MANAGER_ROLES = new Set(['enterprise_admin', 'admin', 'super_admin']);

function enterpriseIdForActor(actor: NonNullable<Awaited<ReturnType<typeof resolveLeadAssignmentRequest>>>) {
  const value = actor.kind === 'mini' ? actor.mini.enterpriseId : actor.admin.enterpriseId;
  return value ? parsePostgresId(value, 'enterprise id') : null;
}

function integer(value: unknown, min: number, max: number, label: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw Object.assign(new Error(`${label}范围应为 ${min}–${max}`), { status: 400 });
  }
  return parsed;
}

function serialize(row: NonNullable<Awaited<ReturnType<AssignmentRacingRepository['getCurrentSettings']>>>) {
  return {
    id: row.id.toString(), version: row.version, claimEnabled: row.claimEnabled,
    claimDurationSeconds: row.claimDurationSeconds,
    highPerformanceTrafficPercent: row.highPerformanceTrafficPercent,
    performanceRateThresholdPercent: row.performanceRateThresholdPercent,
    performanceWindowDays: row.performanceWindowDays,
    minimumEffectiveSamples: row.minimumEffectiveSamples,
    defaultDesignerCapacity: row.defaultDesignerCapacity,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function GET(request: Request) {
  try {
    const actor = await resolveLeadAssignmentRequest(request);
    if (!actor || !MANAGER_ROLES.has(actor.role)) return NextResponse.json({ success: false, error: '无权查看派单设置' }, { status: 403 });
    const enterpriseId = enterpriseIdForActor(actor);
    if (!enterpriseId) return NextResponse.json({ success: false, error: '请先选择企业' }, { status: 400 });
    const row = await withLeadAssignmentTransaction(actor, (transaction) =>
      new AssignmentRacingRepository(transaction).getCurrentSettings(enterpriseId)
    );
    return NextResponse.json({ success: true, data: row ? serialize(row) : null });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '读取派单设置失败' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const actor = await resolveLeadAssignmentRequest(request);
    if (!actor || !MANAGER_ROLES.has(actor.role)) return NextResponse.json({ success: false, error: '无权修改派单设置' }, { status: 403 });
    const enterpriseId = enterpriseIdForActor(actor);
    if (!enterpriseId) return NextResponse.json({ success: false, error: '请先选择企业' }, { status: 400 });
    const body = await request.json();
    const row = await withLeadAssignmentTransaction(actor, (transaction) =>
      new AssignmentRacingRepository(transaction).createSettingsVersion({
        enterpriseId,
        actorStaffId: actor.actorStaffId,
        claimEnabled: Boolean(body.claimEnabled),
        claimDurationSeconds: integer(body.claimDurationSeconds, 5, 3600, '抢单时长'),
        highPerformanceTrafficPercent: integer(body.highPerformanceTrafficPercent, 0, 100, '高绩效流量比例'),
        performanceRateThresholdPercent: integer(body.performanceRateThresholdPercent, 0, 100, '签单率门槛'),
        performanceWindowDays: integer(body.performanceWindowDays, 1, 3650, '统计周期'),
        minimumEffectiveSamples: integer(body.minimumEffectiveSamples, 1, 100000, '最低有效样本'),
        defaultDesignerCapacity: integer(body.defaultDesignerCapacity, 1, 100000, '默认设计师容量'),
      })
    );
    return NextResponse.json({ success: true, data: serialize(row) });
  } catch (error) {
    const status = (error as { status?: number }).status || 500;
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '保存派单设置失败' }, { status });
  }
}
