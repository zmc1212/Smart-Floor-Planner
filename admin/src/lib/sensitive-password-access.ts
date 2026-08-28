export const PLATFORM_SENSITIVE_PASSWORD_API = '/api/admin/sensitive-password';
export const ENTERPRISE_SENSITIVE_PASSWORD_API =
  '/api/enterprise/sensitive-password';

export function canManageSensitivePassword(role: string | null | undefined) {
  return role === 'enterprise_admin' || role === 'admin' || role === 'super_admin';
}

export function sensitivePasswordApiPath(role: string | null | undefined) {
  return role === 'admin' || role === 'super_admin'
    ? PLATFORM_SENSITIVE_PASSWORD_API
    : ENTERPRISE_SENSITIVE_PASSWORD_API;
}
