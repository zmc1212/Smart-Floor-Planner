import { DEFAULT_PERMISSIONS } from '@/models/AdminUser';

export function getEffectivePermissions(role: string, menuPermissions?: string[]) {
  if (menuPermissions && menuPermissions.length > 0) {
    return menuPermissions;
  }

  return DEFAULT_PERMISSIONS[role] || [];
}

export function getWorkbenchType(role?: string) {
  switch (role) {
    case 'salesperson':
      return 'sales';
    case 'measurer':
      return 'measurement';
    case 'designer':
      return 'design';
    case 'enterprise_admin':
      return 'enterprise_admin';
    default:
      return 'general';
  }
}
