import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { AdminUserRepository } from '@/db/repositories';
import type { MiniProgramIdentityRepository } from '@/db/repositories';
import type { EnterpriseRecord } from '@/db/repositories';
import { DEFAULT_PERMISSIONS } from '@/lib/admin-user-roles';

/** One-time credentials are generated per account and never stored in plaintext. */
export function generateInitialPassword() {
  return randomBytes(18).toString('base64url');
}

export async function hashInitialPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function createInitialPasswordCredential() {
  const password = generateInitialPassword();
  return { password, passwordHash: await hashInitialPassword(password) };
}

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

/** Compatibility helper for callers that only need a hash. */
export async function hashEnterpriseAdminInitialPassword() {
  return (await createInitialPasswordCredential()).passwordHash;
}

/** Compatibility helper for callers that only need a hash. */
export async function hashStaffInitialPassword() {
  return (await createInitialPasswordCredential()).passwordHash;
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
  if (!phone) return { initialPassword: null };

  const existingUser = await adminUsers.findByUsernameOrPhone(phone);
  if (existingUser && existingUser.enterpriseId !== enterprise.id) {
    throw Object.assign(new Error(`手机号 ${phone} 已被其他企业账号使用`), {
      code: 'ACCOUNT_CONFLICT',
    });
  }

  if (existingUser) {
    await identities.ensureStaffUser(existingUser);
    return { initialPassword: null };
  }

  const credential = await createInitialPasswordCredential();
  const staff = await adminUsers.create({
    username: buildEnterpriseAdminUsername(phone, enterprise.id),
    passwordHash: credential.passwordHash,
    mustChangePassword: true,
    displayName: typeof contact.name === 'string' ? contact.name : '',
    role: 'enterprise_admin',
    enterpriseId: enterprise.id,
    phone,
    menuPermissions: DEFAULT_PERMISSIONS.enterprise_admin,
    status: 'active',
  });

  await identities.ensureStaffUser(staff);
  return { initialPassword: credential.password };
}
