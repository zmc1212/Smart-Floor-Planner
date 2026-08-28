import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import bcrypt from 'bcryptjs';
import type {
  AdminUserRecord,
  AdminUserRepository,
} from '@/db/repositories';
import { authenticateAdminCredential } from '@/lib/admin-credential-auth';
import {
  STAFF_INITIAL_PASSWORD,
  buildStaffUsername,
  hashStaffInitialPassword,
} from '@/lib/enterprise-admin-provision';

async function candidate(
  id: number,
  username: string,
  phone: string,
  password: string
): Promise<AdminUserRecord> {
  return {
    id: BigInt(id),
    username,
    phone,
    passwordHash: await bcrypt.hash(password, 4),
    status: 'active',
  } as AdminUserRecord;
}

function repository(rows: AdminUserRecord[]): AdminUserRepository {
  return {
    listByUsernameOrPhone: async () => rows,
  } as unknown as AdminUserRepository;
}

test('staff initial credentials use the documented password and tenant-scoped username', async () => {
  assert.equal(STAFF_INITIAL_PASSWORD, '123456');
  assert.equal(buildStaffUsername('13800138000', BigInt(27)), 'staff_e27_13800138000');
  assert.equal(
    await bcrypt.compare(STAFF_INITIAL_PASSWORD, await hashStaffInitialPassword()),
    true
  );
});

test('credential authentication selects a unique phone account by password', async () => {
  const first = await candidate(1, 'staff_e1_13800138000', '13800138000', 'first-pass');
  const second = await candidate(2, 'staff_e2_13800138000', '13800138000', 'second-pass');

  const result = await authenticateAdminCredential(
    repository([first, second]),
    '13800138000',
    'second-pass'
  );

  assert.equal(result.kind, 'ok');
  if (result.kind === 'ok') assert.equal(result.admin.id, BigInt(2));
});

test('credential authentication reports invalid and ambiguous identifiers explicitly', async () => {
  const first = await candidate(1, 'wx_first', '13800138000', 'shared-pass');
  const second = await candidate(2, 'wx_second', '13800138000', 'shared-pass');

  assert.deepEqual(
    await authenticateAdminCredential(repository([first]), '13800138000', 'wrong-pass'),
    { kind: 'invalid_credentials' }
  );
  assert.deepEqual(
    await authenticateAdminCredential(repository([first, second]), '13800138000', 'shared-pass'),
    { kind: 'ambiguous_identifier' }
  );
});

test('legacy migration targets only linked wx designer and measurer accounts', async () => {
  const migration = readFileSync(
    path.resolve(process.cwd(), 'drizzle/0044_staff_initial_password.sql'),
    'utf8'
  );
  const rlsBackfillMigration = readFileSync(
    path.resolve(process.cwd(), 'drizzle/0045_backfill_staff_initial_password_rls.sql'),
    'utf8'
  );
  const hash = migration.match(/"password_hash" = '([^']+)'/)?.[1];

  assert.match(migration, /left\("username", 3\) = 'wx_'/);
  assert.match(migration, /"user_id" is not null/i);
  assert.match(migration, /"role" in \('designer', 'measurer'\)/i);
  assert.doesNotMatch(migration, /role in \([^)]*enterprise_admin/i);
  assert.ok(hash);
  assert.equal(await bcrypt.compare(STAFF_INITIAL_PASSWORD, hash), true);
  assert.match(rlsBackfillMigration, /CREATE POLICY.*admin_users_migrator_initial_password_backfill/s);
  assert.match(rlsBackfillMigration, /TO sfp_migrator/);
  assert.match(rlsBackfillMigration, /DROP POLICY.*admin_users_migrator_initial_password_backfill/s);
});

test('staff APIs preserve the initial-password and forced-change contracts', () => {
  const staffRoute = readFileSync(
    path.resolve(process.cwd(), 'src/app/api/staff/route.ts'),
    'utf8'
  );
  const resetRoute = readFileSync(
    path.resolve(process.cwd(), 'src/app/api/staff/[id]/reset-password/route.ts'),
    'utf8'
  );
  const proxy = readFileSync(path.resolve(process.cwd(), 'src/proxy.ts'), 'utf8');

  assert.match(
    staffRoute,
    /buildStaffUsername\(normalizedPhone, BigInt\(targetEnterpriseId\)\)/
  );
  assert.match(staffRoute, /mustChangePassword:\s*true/);
  assert.match(resetRoute, /hashStaffInitialPassword\(\)/);
  assert.match(resetRoute, /staffId === actorId/);
  assert.match(resetRoute, /withTenantTransaction\(\s*context\.enterpriseId!/);
  assert.match(proxy, /password_change_required/);
  assert.match(proxy, /ADMIN_PASSWORD_CHANGE_API_PATHS/);
  assert.doesNotMatch(proxy, /MINI_PROGRAM_PASSWORD_CHANGE_PATHS/);
  assert.doesNotMatch(proxy, /audience:\s*'miniprogram'/);
});
