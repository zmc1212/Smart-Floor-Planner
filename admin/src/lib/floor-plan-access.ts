export interface FloorPlanAccessRecord {
  creatorId: bigint;
  staffId: bigint | null;
  enterpriseId: bigint | null;
}

export interface LinkedLeadFloorPlanAccessRecord {
  enterpriseId: bigint | null;
  assignedTo: bigint | null;
  measurerId: bigint | null;
  promoterId?: bigint | null;
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

/**
 * Mutations may be performed by the plan owner or by a staff member who is
 * currently responsible for the linked lead. This keeps PUT consistent with
 * the read/continue-survey contract after a reassignment.
 */
export function canMutateMiniProgramFloorPlan(
  plan: FloorPlanAccessRecord,
  context: MiniProgramFloorPlanAccessContext,
  linkedLead?: LinkedLeadFloorPlanAccessRecord | null
) {
  if (canAccessMiniProgramFloorPlan(plan, context)) return true;
  if (!context.staff || !linkedLead) return false;

  const staffEnterprise = staffEnterpriseId(context);
  if (!linkedLead.enterpriseId || !staffEnterprise) return false;
  if (linkedLead.enterpriseId.toString() !== staffEnterprise.toString()) return false;
  if (context.staff.role === 'enterprise_admin') return true;

  const staffId = context.staff._id;
  return [linkedLead.assignedTo, linkedLead.measurerId, linkedLead.promoterId]
    .some((id) => id != null && id.toString() === staffId);
}

export function canRecordMiniProgramFloorPlanMeasurement(
  plan: FloorPlanAccessRecord,
  context: MiniProgramFloorPlanAccessContext,
  linkedLead?: LinkedLeadFloorPlanAccessRecord | null
) {
  return canReadMiniProgramFloorPlan(plan, context, linkedLead);
}
