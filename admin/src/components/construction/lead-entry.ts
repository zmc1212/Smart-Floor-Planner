import type { CurrentUser } from '@/lib/current-user';
import { isEnterpriseManagementRole } from '@/lib/admin-user-roles';
import { canOperateLead } from '@/lib/lead-status';

export function constructionLeadEntry(user: CurrentUser | null, lead: { _id: string; status: string; archivedAt?: string | null } | null) {
  if (!lead || !/^[1-9]\d*$/.test(lead._id) || !canOperateLead(lead.status, lead.archivedAt)
    || !isEnterpriseManagementRole(user?.role) || !user?.effectivePermissions?.includes('construction-projects')) return null;
  return '/construction-projects?leadId=' + encodeURIComponent(lead._id);
}
