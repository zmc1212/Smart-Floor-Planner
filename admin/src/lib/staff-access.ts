import { DEFAULT_PERMISSIONS } from '@/models/AdminUser';
import { SystemRole } from '@/models/SystemRole';
import dbConnect from '@/lib/mongodb';

export async function getEffectivePermissions(role: string, _menuPermissions?: string[]) {
  try {
    await dbConnect();
    const roleConfig = await SystemRole.findOne({ roleKey: role }).lean();
    if (roleConfig && roleConfig.menuKeys) {
      return Array.from(roleConfig.menuKeys);
    }
  } catch (err) {
    console.error('Failed to fetch role permissions from DB:', err);
  }

  // Fallback to hardcoded defaults
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
