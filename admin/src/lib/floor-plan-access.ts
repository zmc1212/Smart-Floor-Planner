export interface FloorPlanAccessRecord {
  creatorId: bigint;
  staffId: bigint | null;
  enterpriseId: bigint | null;
}

export interface MiniProgramFloorPlanAccessContext {
  user: { _id: string };
  enterpriseId?: string;
  staff: {
    _id: string;
    enterpriseId?: string;
    role: string;
  } | null;
}

export function canAccessMiniProgramFloorPlan(
  plan: FloorPlanAccessRecord,
  context: MiniProgramFloorPlanAccessContext
) {
  if (!context.staff) {
    return plan.creatorId.toString() === context.user._id;
  }

  if (context.staff.role !== 'enterprise_admin') {
    return plan.staffId?.toString() === context.staff._id;
  }

  return (
    plan.enterpriseId?.toString() ===
    (context.staff.enterpriseId || context.enterpriseId || '')
  );
}
