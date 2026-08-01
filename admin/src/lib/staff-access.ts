import { DEFAULT_PERMISSIONS } from '@/models/AdminUser';
import { SystemRoleRepository } from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';

const LEGACY_AI_EXECUTION_PERMISSIONS = [
  'ai-designer',
  'ai-floorplan',
  'ai-furnishing',
  'ai-soft-furnishing',
];

export function normalizeMenuPermissions(permissions: string[]) {
  const normalized = new Set(permissions);
  if (
    normalized.has('ai-scenarios') ||
    LEGACY_AI_EXECUTION_PERMISSIONS.some((permission) => normalized.has(permission))
  ) {
    normalized.add('ai-scenarios');
  }
  return Array.from(normalized);
}

export async function getRolePermissionMap() {
  try {
    const roles = await withPlatformTransaction((transaction) =>
      new SystemRoleRepository(transaction).list()
    );
    return Object.fromEntries(
      roles.map((role) => [
        role.roleKey,
        normalizeMenuPermissions(role.menuKeys),
      ])
    );
  } catch (err) {
    console.error('Failed to fetch role permissions from PostgreSQL:', err);
    return {};
  }
}

export async function getEffectivePermissions(role: string, _menuPermissions?: string[]) {
  void _menuPermissions;
  try {
    const roleConfig = await withPlatformTransaction((transaction) =>
      new SystemRoleRepository(transaction).findByRoleKey(role)
    );
    if (roleConfig) {
      return normalizeMenuPermissions(roleConfig.menuKeys);
    }
  } catch (err) {
    console.error('Failed to fetch role permissions from PostgreSQL:', err);
  }

  // Fallback to hardcoded defaults
  return normalizeMenuPermissions(DEFAULT_PERMISSIONS[role] || []);
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
