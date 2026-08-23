export type LeadAssignmentActions = {
  canAssignDesigner: boolean;
  canAssignMeasurer: boolean;
};

export type LeadAssignmentActorLead = {
  assignedTo: bigint | null;
  archivedAt: Date | null;
  status: string;
};

const MANAGER_ROLES = new Set(['enterprise_admin', 'admin', 'super_admin']);

export function getLeadAssignmentActions(
  lead: LeadAssignmentActorLead,
  role: string,
  actorId: bigint | null
): LeadAssignmentActions {
  if (!actorId || lead.archivedAt || lead.status === 'closed') {
    return { canAssignDesigner: false, canAssignMeasurer: false };
  }
  if (MANAGER_ROLES.has(role)) {
    return { canAssignDesigner: true, canAssignMeasurer: true };
  }
  if (role === 'designer' && lead.assignedTo === actorId) {
    return { canAssignDesigner: false, canAssignMeasurer: true };
  }
  return { canAssignDesigner: false, canAssignMeasurer: false };
}

export function canAccessLeadForStaffAssign(
  lead: { assignedTo: bigint | null; measurerId: bigint | null },
  role: string,
  actorId: bigint | null
) {
  if (!actorId) return false;
  if (MANAGER_ROLES.has(role)) return true;
  if (role === 'designer') return lead.assignedTo === actorId;
  if (role === 'measurer') return lead.measurerId === actorId;
  return false;
}

export function assertCanAssignLeadStaff(input: {
  lead: LeadAssignmentActorLead;
  role: string;
  actorId: bigint | null;
  designerId?: bigint | null;
  measurerId?: bigint | null;
}) {
  const actions = getLeadAssignmentActions(input.lead, input.role, input.actorId);
  if (input.designerId && !actions.canAssignDesigner) {
    throw Object.assign(new Error('无权更换设计师'), {
      status: 403,
      code: 'assign_designer_forbidden',
    });
  }
  if (input.measurerId && !actions.canAssignMeasurer) {
    throw Object.assign(new Error('无权分配或更换测量员'), {
      status: 403,
      code: 'assign_measurer_forbidden',
    });
  }
  if (!actions.canAssignDesigner && !actions.canAssignMeasurer) {
    throw Object.assign(new Error('无权改派线索人员'), {
      status: 403,
      code: 'assign_staff_forbidden',
    });
  }
}

export function attachLeadAssignmentActions<T extends object>(
  dto: T,
  lead: LeadAssignmentActorLead,
  role: string,
  actorId: bigint | null
): T & { assignmentActions: LeadAssignmentActions } {
  return {
    ...dto,
    assignmentActions: getLeadAssignmentActions(lead, role, actorId),
  };
}
