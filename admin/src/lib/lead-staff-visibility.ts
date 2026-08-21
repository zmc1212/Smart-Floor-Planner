import type { LeadListOptions } from '@/db/repositories';

/**
 * Mini Program / shared staff lead-list scope.
 * Measurers must use `measurerId` (same as workbench), not designer `assignedTo`.
 */
export function resolveStaffLeadListOptions(
  role: string,
  staffId: bigint
): LeadListOptions {
  if (role === 'enterprise_admin') return {};
  if (role === 'measurer') {
    return { staffId, staffVisibility: 'measurer' };
  }
  return { staffId, staffVisibility: 'promoted-or-assigned' };
}
