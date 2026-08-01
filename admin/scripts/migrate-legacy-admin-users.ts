import mongoose from 'mongoose';
import { loadEnvConfig } from '@next/env';
import { AdminUser, DEFAULT_PERMISSIONS } from '../src/models/AdminUser';
import { AdminUserRepository } from '../src/db/repositories';
import { withPlatformTransaction } from '../src/db/transaction';

loadEnvConfig(process.cwd());

const ADMIN_ROLES = new Set([
  'super_admin',
  'admin',
  'enterprise_admin',
  'designer',
  'salesperson',
  'measurer',
  'viewer',
]);

type LegacyAdminUser = {
  username?: unknown;
  passwordHash?: unknown;
  displayName?: unknown;
  role?: unknown;
  wecomUserId?: unknown;
  openid?: unknown;
  phone?: unknown;
  menuPermissions?: unknown;
  status?: unknown;
  enterpriseId?: unknown;
  lastLoginAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalString(value: unknown) {
  const normalized = stringValue(value);
  return normalized || null;
}

function optionalDate(value: unknown) {
  return value instanceof Date && !Number.isNaN(value.getTime())
    ? value
    : undefined;
}

async function main() {
  const { default: dbConnect } = await import('../src/lib/mongodb');
  await dbConnect();

  try {
    const legacyUsers = (await AdminUser.collection
      .find({})
      .toArray()) as LegacyAdminUser[];
    const skipped = {
      existing: [] as string[],
      invalid: [] as string[],
      tenantScoped: [] as string[],
    };
    const imported: string[] = [];

    await withPlatformTransaction(async (transaction) => {
      const repository = new AdminUserRepository(transaction);

      for (const legacyUser of legacyUsers) {
        const username = stringValue(legacyUser.username);
        const passwordHash = stringValue(legacyUser.passwordHash);
        if (!username || !passwordHash) {
          skipped.invalid.push(username || '(missing username)');
          continue;
        }
        if (legacyUser.enterpriseId) {
          skipped.tenantScoped.push(username);
          continue;
        }

        const phone = optionalString(legacyUser.phone);
        const existing =
          (await repository.findByUsernameOrPhone(username)) ??
          (phone
            ? await repository.findByUsernameOrPhone(phone)
            : null);
        if (existing) {
          skipped.existing.push(username);
          continue;
        }

        const legacyRole = stringValue(legacyUser.role);
        const role = ADMIN_ROLES.has(legacyRole) ? legacyRole : 'admin';
        const legacyPermissions = Array.isArray(legacyUser.menuPermissions)
          ? legacyUser.menuPermissions.filter(
              (permission): permission is string =>
                typeof permission === 'string' && permission.length > 0
            )
          : [];

        await repository.create({
          username,
          passwordHash,
          displayName: stringValue(legacyUser.displayName),
          role,
          wecomUserId: optionalString(legacyUser.wecomUserId),
          openid: optionalString(legacyUser.openid),
          phone,
          menuPermissions:
            legacyPermissions.length > 0
              ? legacyPermissions
              : DEFAULT_PERMISSIONS[role] ?? [],
          status: legacyUser.status === 'disabled' ? 'disabled' : 'active',
          lastLoginAt: optionalDate(legacyUser.lastLoginAt),
          createdAt: optionalDate(legacyUser.createdAt),
          updatedAt: optionalDate(legacyUser.updatedAt),
        });
        imported.push(username);
      }
    });

    console.log(
      JSON.stringify(
        {
          imported,
          skipped,
          totalLegacyUsers: legacyUsers.length,
        },
        null,
        2
      )
    );
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exitCode = 1;
});
