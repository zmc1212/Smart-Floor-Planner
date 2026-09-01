export interface FloorPlanAccessRecord {
  creatorId: bigint;
  staffId: bigint | null;
  enterpriseId: bigint | null;
}

export interface LinkedLeadFloorPlanAccessRecord {
  enterpriseId: bigint | null;
  assignedTo: bigint | null;
  measurerId: bigint | null;
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

function staffEnterpriseId(context: MiniProgramFloorPlanAccessContext) {
  return context.staff?.enterpriseId || context.enterpriseId || '';
}

function linkedLeadMatchesStaffEnterprise(
  lead: LinkedLeadFloorPlanAccessRecord,
  context: MiniProgramFloorPlanAccessContext
) {
  const staffEnterprise = staffEnterpriseId(context);
  if (!lead.enterpriseId || !staffEnterprise) return false;
  return lead.enterpriseId.toString() === staffEnterprise;
}

export function canReadMiniProgramFloorPlan(
  plan: FloorPlanAccessRecord,
  context: MiniProgramFloorPlanAccessContext,
  linkedLead?: LinkedLeadFloorPlanAccessRecord | null
) {
  if (canAccessMiniProgramFloorPlan(plan, context)) return true;
  if (!context.staff || !linkedLead) return false;
  if (!linkedLeadMatchesStaffEnterprise(linkedLead, context)) return false;

  if (context.staff.role === 'enterprise_admin') {
    return true;
  }

  const staffId = context.staff._id;
  return (
    linkedLead.assignedTo?.toString() === staffId ||
    linkedLead.measurerId?.toString() === staffId
  );
}

export function canRecordMiniProgramFloorPlanMeasurement(
  plan: FloorPlanAccessRecord,
  context: MiniProgramFloorPlanAccessContext,
  linkedLead?: LinkedLeadFloorPlanAccessRecord | null
) {
  return canReadMiniProgramFloorPlan(plan, context, linkedLead);
}
