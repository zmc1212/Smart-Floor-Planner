export const STAFF_REFERRER_ROSTER_ROLES = ['designer', 'measurer'] as const;

export type StaffReferrerRosterRole = (typeof STAFF_REFERRER_ROSTER_ROLES)[number];

export function isStaffReferrerRosterRole(
  role: string | undefined
): role is StaffReferrerRosterRole {
  return STAFF_REFERRER_ROSTER_ROLES.includes(role as StaffReferrerRosterRole);
}

export function hasReferrersMenuPermission(permissions: string[] | undefined) {
  return Boolean(
    permissions?.includes('referrers') ||
    permissions?.includes('referrer-network-operations')
  );
}
