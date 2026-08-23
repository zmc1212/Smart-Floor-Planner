export function canStaffMutateLeadSurvey(input: {
  staffRole?: string | null;
  staffId?: bigint | null;
  promoterId?: bigint | null;
  assignedTo?: bigint | null;
  measurerId?: bigint | null;
}) {
  if (!input.staffId) return false;
  if (input.staffRole === 'enterprise_admin') return true;
  return (
    input.assignedTo === input.staffId ||
    input.measurerId === input.staffId ||
    input.promoterId === input.staffId
  );
}

export function canStaffCreateLeadAppointment(input: {
  staffRole?: string | null;
  staffId?: bigint | null;
  assignedTo?: bigint | null;
  measurerId?: bigint | null;
  source?: string | null;
  status?: string | null;
}) {
  if (!input.staffId || input.status === 'closed' || input.status === 'converted') return false;
  if (input.staffRole === 'enterprise_admin') return true;
  if (input.staffRole === 'designer' && input.assignedTo === input.staffId) return true;
  return (
    input.source === 'staff_activity' &&
    input.measurerId === input.staffId
  );
}

export function canStaffCreateOnSiteVisit(input: {
  staffRole?: string | null;
  staffId?: bigint | null;
  assignedTo?: bigint | null;
  measurerId?: bigint | null;
  source?: string | null;
  status?: string | null;
}) {
  if (canStaffCreateLeadAppointment(input)) return true;
  if (!input.staffId || input.status === 'closed' || input.status === 'converted') return false;
  return input.staffRole === 'measurer' && input.measurerId === input.staffId;
}
