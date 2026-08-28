export const REFERRER_ADDITIONAL_ENTERPRISE_LIMIT_MAX = 99;

export function isPlatformAdminRole(role: string | null | undefined) {
  return role === 'super_admin' || role === 'admin';
}

export function parseReferrerAdditionalEnterpriseLimit(
  value: unknown
): { ok: true; value: number | null } | { ok: false } {
  if (value === null) return { ok: true, value: null };
  const parsed = Math.floor(Number(value));
  if (
    !Number.isInteger(parsed) ||
    parsed < 0 ||
    parsed > REFERRER_ADDITIONAL_ENTERPRISE_LIMIT_MAX
  ) {
    return { ok: false };
  }
  return { ok: true, value: parsed };
}

export function isReferrerProtectionLimitReached(input: {
  activeCount: number;
  limits: Array<number | null | undefined>;
}) {
  return input.limits.some(
    (limit) => limit != null && input.activeCount > limit
  );
}
