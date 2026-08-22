import bcrypt from 'bcryptjs';
import type { AdminUserRepository } from '@/db/repositories';
import type { MiniProgramIdentityRepository } from '@/db/repositories';
import type { EnterpriseRecord } from '@/db/repositories';
import { DEFAULT_PERMISSIONS } from '@/lib/admin-user-roles';

export const ENTERPRISE_ADMIN_INITIAL_PASSWORD = '123456';

export function hashEnterpriseAdminInitialPassword() {
  return bcrypt.hash(ENTERPRISE_ADMIN_INITIAL_PASSWORD, 10);
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
      username: phone,
      passwordHash: await hashEnterpriseAdminInitialPassword(),
      displayName: typeof contact.name === 'string' ? contact.name : '',
      role: 'enterprise_admin',
      enterpriseId: enterprise.id,
      phone,
      menuPermissions: DEFAULT_PERMISSIONS.enterprise_admin,
      status: 'active',
    }));

  await identities.ensureStaffUser(staff);
}
