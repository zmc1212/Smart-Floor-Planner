import bcrypt from 'bcryptjs';
import type { AdminUserRepository } from '@/db/repositories';
import type { MiniProgramIdentityRepository } from '@/db/repositories';
import type { EnterpriseRecord } from '@/db/repositories';
import { DEFAULT_PERMISSIONS } from '@/lib/admin-user-roles';

export const ENTERPRISE_ADMIN_INITIAL_PASSWORD = '123456';
export const STAFF_INITIAL_PASSWORD = ENTERPRISE_ADMIN_INITIAL_PASSWORD;

/**
 * Login still matches by phone across owner rows. Username stays globally unique:
 * the first store may use the bare phone; each additional store must suffix the
 * enterprise id so a second `enterprise_admin` row does not collide.
 */
export function buildEnterpriseAdminUsername(
  phone: string,
  enterpriseId: bigint,
  options?: { additionalStore?: boolean }
) {
  const trimmed = phone.trim();
  if (options?.additionalStore) {
    return `${trimmed}_e${enterpriseId.toString()}`;
  }
  return trimmed;
}

export function hashEnterpriseAdminInitialPassword() {
  return bcrypt.hash(ENTERPRISE_ADMIN_INITIAL_PASSWORD, 10);
}

export function hashStaffInitialPassword() {
  return bcrypt.hash(STAFF_INITIAL_PASSWORD, 10);
}

export function buildStaffUsername(phone: string, enterpriseId: bigint) {
  return `staff_e${enterpriseId.toString()}_${phone.trim()}`;
}

export async function ensureEnterpriseAdminForActiveEnterprise(
  adminUsers: AdminUserRepository,
  enterprise: EnterpriseRecord,
  identities: MiniProgramIdentityRepository
) {
  const contact = enterprise.contactPerson;
  const phone = typeof contact.phone === 'string' ? contact.phone.trim() : '';
  if (!phone) return;

  const existingUser = await adminUsers.findByUsernameOrPhone(phone);
  if (existingUser && existingUser.enterpriseId !== enterprise.id) {
    throw Object.assign(new Error(`手机号 ${phone} 已被其他企业账号使用`), {
      code: 'ACCOUNT_CONFLICT',
    });
  }

  const staff =
    existingUser ||
    (await adminUsers.create({
      username: buildEnterpriseAdminUsername(phone, enterprise.id),
      passwordHash: await hashEnterpriseAdminInitialPassword(),
      mustChangePassword: true,
      displayName: typeof contact.name === 'string' ? contact.name : '',
      role: 'enterprise_admin',
      enterpriseId: enterprise.id,
      phone,
      menuPermissions: DEFAULT_PERMISSIONS.enterprise_admin,
      status: 'active',
    }));

  await identities.ensureStaffUser(staff);
}
