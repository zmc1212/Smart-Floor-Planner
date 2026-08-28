export const LEAD_STATUS_LABELS = {
  new: '新线索',
  measuring: '量房中',
  designing: '方案设计',
  converted: '已签约',
  closed: '已关闭',
} as const;

export const LEAD_WORKFLOW_STEPS = [
  '新线索',
  '量房中',
  '方案设计',
  '已签约',
] as const;

export type CanonicalLeadStatus = keyof typeof LEAD_STATUS_LABELS;

const STATUS_GROUPS: Record<CanonicalLeadStatus, string[]> = {
  new: ['new', 'contacted', 'acquired'],
  measuring: ['measuring'],
  designing: ['measured', 'assigned', 'designing', 'quoting'],
  converted: ['converted'],
  closed: ['closed'],
};

export function getLeadStatusVariants(status: string) {
  return STATUS_GROUPS[status as CanonicalLeadStatus] || [status];
}

export function normalizeLeadStatus(status: string): CanonicalLeadStatus | string {
  const entry = (Object.entries(STATUS_GROUPS) as Array<[CanonicalLeadStatus, string[]]>).find(([, values]) => values.includes(status));
  return entry ? entry[0] : status;
}

export function getLeadStatusLabel(status: string) {
  const normalized = normalizeLeadStatus(status);
  return LEAD_STATUS_LABELS[normalized as CanonicalLeadStatus] || status;
}

export function getLeadWorkflowStep(status: string) {
  const normalized = normalizeLeadStatus(status);
  if (normalized === 'measuring') return 1;
  if (normalized === 'designing') return 2;
  if (normalized === 'converted') return 3;
  return 0;
}

export function getLeadNextAction(status: string) {
  const normalized = normalizeLeadStatus(status);
  if (normalized === 'new') return '安排正式量房';
  if (normalized === 'measuring') return '完成墙图后进入方案设计';
  if (normalized === 'designing') return '等待方案沟通或客户确认';
  if (normalized === 'converted') return '已签约，无需继续推进';
  if (normalized === 'closed') return '该线索已关闭';
  return '';
}

export function canOperateLead(status: string, archivedAt?: string | Date | null) {
  if (archivedAt) return false;
  return normalizeLeadStatus(status) !== 'closed';
}

export function canDeleteLeadFloorPlan(status: string) {
  const normalized = normalizeLeadStatus(status);
  return !['designing', 'converted', 'closed'].includes(normalized);
}

export function resolveLeadStatusAfterFloorPlan(
  currentStatus: string,
  planStatus: string,
  requestedStatus?: string
) {
  const current = normalizeLeadStatus(currentStatus);
  if (current === 'converted') return current;
  if (requestedStatus) return normalizeLeadStatus(requestedStatus);
  void planStatus;

  if (current === 'new') return 'measuring';
  return current;
}

export function resolveLeadStatusAfterAppointmentComplete(currentStatus: string) {
  const current = normalizeLeadStatus(currentStatus);
  if (current === 'converted' || current === 'closed') return current;
  return 'designing';
}

/** First customer-visible scheme send. Draft generation must not call this. */
export function resolveLeadStatusAfterDesignPublished(currentStatus: string) {
  const current = normalizeLeadStatus(currentStatus);
  if (current === 'converted' || current === 'closed') return current;
  if (current === 'new' || current === 'measuring') return 'designing';
  return current;
}
