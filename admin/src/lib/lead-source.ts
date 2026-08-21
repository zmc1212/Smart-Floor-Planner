export const LEAD_COMMISSION_SOURCES = [
  'referrer_network',
  'staff_activity',
  'manual_entry',
] as const;

export type LeadCommissionSource = (typeof LEAD_COMMISSION_SOURCES)[number];

export function isLeadCommissionSource(source: string | null | undefined): source is LeadCommissionSource {
  return Boolean(source && (LEAD_COMMISSION_SOURCES as readonly string[]).includes(source));
}

export function isTwoRoleCommissionSource(source: string | null | undefined) {
  return source === 'staff_activity' || source === 'manual_entry';
}

export function shouldSnapshotLeadCommissions(lead: {
  source?: string | null;
  referrerMembershipId?: bigint | null;
  measurerId?: bigint | null;
}) {
  return Boolean(
    isTwoRoleCommissionSource(lead.source) ||
      lead.referrerMembershipId ||
      lead.measurerId
  );
}
