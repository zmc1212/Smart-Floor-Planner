import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { loadEnvConfig } from '@next/env';
import { count, eq, inArray } from 'drizzle-orm';
import {
  adminUsers,
  departments,
  enterpriseAppointmentSettings,
  enterpriseCommissionRules,
  enterpriseJoinCodeEvents,
  enterpriseJoinCodes,
  enterpriseStatusEvents,
  enterprises,
  leads,
  referrerEnterpriseMemberships,
  referrerProfiles,
  referrerPromotionCodes,
  users,
} from '@/db/schema';
import {
  AdminUserRepository,
  EnterpriseRepository,
  isTenantEnterpriseResetAllowed,
  LeadRepository,
  ReferrerNetworkRepository,
  TenantEnterpriseResetRepository,
} from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';

const runKey = `tenant-reset-${process.pid}-${Date.now()}`;
let enterpriseId: bigint;
let otherEnterpriseId: bigint;
let operatorId: bigint;
let designerId: bigint;
let otherEnterpriseStaffId: bigint;
let referrerUserId: bigint;
let customerUserId: bigint;
const enterpriseName = `${runKey}-main`;

before(async () => {
  loadEnvConfig(process.cwd());
  const url = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(
    ['localhost', '127.0.0.1'].includes(url.hostname),
    'Tenant enterprise reset tests only mutate the local database'
  );

  await withPlatformTransaction(async (transaction) => {
    const enterprisesRepository = new EnterpriseRepository(transaction);
    const staff = new AdminUserRepository(transaction);
    const network = new ReferrerNetworkRepository(transaction);

    enterpriseId = (
      await enterprisesRepository.create({
        name: enterpriseName,
        code: `${runKey}-main`,
        status: 'active',
      })
    ).id;
    otherEnterpriseId = (
      await enterprisesRepository.create({
        name: `${runKey}-other`,
        code: `${runKey}-other`,
        status: 'active',
      })
    ).id;

    operatorId = (
      await staff.create({
        enterpriseId,
        username: `${runKey}-owner`,
        passwordHash: 'test-hash',
        displayName: '内测负责人',
        role: 'enterprise_admin',
        menuPermissions: ['referrer-network-operations'],
      })
    ).id;
    designerId = (
      await staff.create({
        enterpriseId,
        username: `${runKey}-designer`,
        passwordHash: 'test-hash',
        displayName: '设计师小美',
        role: 'designer',
        menuPermissions: ['dashboard'],
      })
    ).id;
    otherEnterpriseStaffId = (
      await staff.create({
        enterpriseId: otherEnterpriseId,
        username: `${runKey}-other-staff`,
        passwordHash: 'test-hash',
        displayName: '其他企业员工',
        role: 'designer',
        menuPermissions: ['dashboard'],
      })
    ).id;

    await transaction.insert(departments).values({
      enterpriseId,
      name: `${runKey}-dept`,
    });

    await network.rotateEnterpriseJoinCode({
      enterpriseId,
      codeType: 'staff',
      actorStaffId: operatorId,
    });
    await network.rotateEnterpriseJoinCode({
      enterpriseId,
      codeType: 'referrer',
      actorStaffId: operatorId,
    });

    const [referrerUser] = await transaction
      .insert(users)
      .values({ phone: `139${String(Date.now()).slice(-8)}`, nickname: `${runKey}-referrer` })
      .returning();
    referrerUserId = referrerUser.id;
    const [profile] = await transaction
      .insert(referrerProfiles)
      .values({ userId: referrerUserId, displayName: '介绍人老周', phone: referrerUser.phone })
      .returning();
    const [membership] = await transaction
      .insert(referrerEnterpriseMemberships)
      .values({ referrerId: profile.id, enterpriseId, status: 'active' })
      .returning();
    await transaction.insert(referrerPromotionCodes).values({
      enterpriseId,
      membershipId: membership.id,
      tokenHash: `${runKey}-promo-hash`,
      status: 'active',
      version: 1,
    });

    await transaction.insert(enterpriseCommissionRules).values([
      {
        enterpriseId,
        role: 'referrer',
        calculationType: 'fixed',
        value: '100.00',
        status: 'active',
        version: 1,
        updatedBy: operatorId,
      },
      {
        enterpriseId,
        role: 'designer',
        calculationType: 'fixed',
        value: '200.00',
        status: 'active',
        version: 1,
        updatedBy: operatorId,
      },
      {
        enterpriseId,
        role: 'measurer',
        calculationType: 'fixed',
        value: '150.00',
        status: 'active',
        version: 1,
        updatedBy: operatorId,
      },
    ]);

    await transaction.insert(enterpriseAppointmentSettings).values({
      enterpriseId,
      timezone: 'Asia/Shanghai',
      weeklySchedule: {
        mon: [{ start: '09:00', end: '18:00' }],
        tue: [{ start: '09:00', end: '18:00' }],
        wed: [{ start: '09:00', end: '18:00' }],
        thu: [{ start: '09:00', end: '18:00' }],
        fri: [{ start: '09:00', end: '18:00' }],
        sat: [],
        sun: [],
      },
      defaultDurationMinutes: 120,
      slotStepMinutes: 30,
      maxAdvanceDays: 14,
      customerRescheduleCutoffHours: 2,
    });

    const [customer] = await transaction
      .insert(users)
      .values({ phone: `138${String(Date.now()).slice(-8)}`, nickname: `${runKey}-customer` })
      .returning();
    customerUserId = customer.id;
    await new LeadRepository(transaction).create({
      enterpriseId,
      assignedTo: designerId,
      customerUserId,
      name: '测试客户',
      phone: customer.phone || '13800000000',
      source: 'referrer_network',
      assignmentStatus: 'assigned',
    });
  });
});

after(async () => {
  await withPlatformTransaction(async (transaction) => {
    await transaction.delete(leads).where(inArray(leads.enterpriseId, [enterpriseId, otherEnterpriseId]));
    await transaction
      .delete(referrerPromotionCodes)
      .where(inArray(referrerPromotionCodes.enterpriseId, [enterpriseId, otherEnterpriseId]));
    await transaction
      .delete(referrerEnterpriseMemberships)
      .where(inArray(referrerEnterpriseMemberships.enterpriseId, [enterpriseId, otherEnterpriseId]));
    await transaction.delete(referrerProfiles).where(eq(referrerProfiles.userId, referrerUserId));
    await transaction
      .delete(enterpriseJoinCodeEvents)
      .where(inArray(enterpriseJoinCodeEvents.enterpriseId, [enterpriseId, otherEnterpriseId]));
    await transaction
      .delete(enterpriseJoinCodes)
      .where(inArray(enterpriseJoinCodes.enterpriseId, [enterpriseId, otherEnterpriseId]));
    await transaction
      .delete(enterpriseCommissionRules)
      .where(inArray(enterpriseCommissionRules.enterpriseId, [enterpriseId, otherEnterpriseId]));
    await transaction
      .delete(enterpriseAppointmentSettings)
      .where(inArray(enterpriseAppointmentSettings.enterpriseId, [enterpriseId, otherEnterpriseId]));
    await transaction
      .delete(departments)
      .where(inArray(departments.enterpriseId, [enterpriseId, otherEnterpriseId]));
    await transaction
      .delete(adminUsers)
      .where(inArray(adminUsers.enterpriseId, [enterpriseId, otherEnterpriseId]));
    await transaction.delete(users).where(inArray(users.id, [referrerUserId, customerUserId]));
    await transaction.delete(enterprises).where(inArray(enterprises.id, [enterpriseId, otherEnterpriseId]));
  });
  await closePostgresPool();
});

test('isTenantEnterpriseResetAllowed rejects production without explicit switch', () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousAllow = process.env.ALLOW_TENANT_ENTERPRISE_RESET;
  try {
    process.env.NODE_ENV = 'production';
    delete process.env.ALLOW_TENANT_ENTERPRISE_RESET;
    assert.equal(isTenantEnterpriseResetAllowed(), false);
    process.env.ALLOW_TENANT_ENTERPRISE_RESET = 'true';
    assert.equal(isTenantEnterpriseResetAllowed(), true);
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
    if (previousAllow === undefined) delete process.env.ALLOW_TENANT_ENTERPRISE_RESET;
    else process.env.ALLOW_TENANT_ENTERPRISE_RESET = previousAllow;
  }
});

test('tenant enterprise reset keeps operator and enterprise shell, wipes business and staff', async () => {
  await withPlatformTransaction(async (transaction) => {
    const repository = new TenantEnterpriseResetRepository(transaction);
    const preview = await repository.preview(enterpriseId, operatorId);
    assert.equal(preview.enterpriseName, enterpriseName);
    assert.equal(preview.mode, 'reset');
    assert.equal(preview.retainOperator, true);
    assert.equal(preview.retainedOperatorAdminUserId, operatorId.toString());
    assert.ok(preview.totalRows > 0);

    const result = await repository.execute(enterpriseId, operatorId);
    assert.equal(result.retainedOperatorAdminUserId, operatorId.toString());
    assert.equal(result.enterpriseDeleted, undefined);

    const [enterprise] = await transaction
      .select()
      .from(enterprises)
      .where(eq(enterprises.id, enterpriseId));
    assert.ok(enterprise);
    assert.equal(enterprise.name, enterpriseName);
    assert.equal(enterprise.status, 'active');

    const remainingStaff = await transaction
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.enterpriseId, enterpriseId));
    assert.equal(remainingStaff.length, 1);
    assert.equal(remainingStaff[0].id, operatorId);

    const [otherStaff] = await transaction
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.id, otherEnterpriseStaffId));
    assert.ok(otherStaff);

    const zeroTables = await Promise.all([
      transaction.select({ value: count() }).from(leads).where(eq(leads.enterpriseId, enterpriseId)),
      transaction
        .select({ value: count() })
        .from(enterpriseJoinCodes)
        .where(eq(enterpriseJoinCodes.enterpriseId, enterpriseId)),
      transaction
        .select({ value: count() })
        .from(referrerEnterpriseMemberships)
        .where(eq(referrerEnterpriseMemberships.enterpriseId, enterpriseId)),
      transaction
        .select({ value: count() })
        .from(enterpriseCommissionRules)
        .where(eq(enterpriseCommissionRules.enterpriseId, enterpriseId)),
      transaction
        .select({ value: count() })
        .from(enterpriseAppointmentSettings)
        .where(eq(enterpriseAppointmentSettings.enterpriseId, enterpriseId)),
      transaction
        .select({ value: count() })
        .from(departments)
        .where(eq(departments.enterpriseId, enterpriseId)),
    ]);
    for (const rows of zeroTables) {
      assert.equal(Number(rows[0]?.value || 0), 0);
    }

    const orphanProfiles = await transaction
      .select()
      .from(referrerProfiles)
      .where(eq(referrerProfiles.userId, referrerUserId));
    assert.equal(orphanProfiles.length, 0);

    const customer = await transaction.select().from(users).where(eq(users.id, customerUserId));
    assert.equal(customer.length, 1);

    const network = new ReferrerNetworkRepository(transaction);
    const staffCode = await network.rotateEnterpriseJoinCode({
      enterpriseId,
      codeType: 'staff',
      actorStaffId: operatorId,
    });
    assert.match(staffCode.token, /^ej_/);
    const referrerCode = await network.rotateEnterpriseJoinCode({
      enterpriseId,
      codeType: 'referrer',
      actorStaffId: operatorId,
    });
    assert.match(referrerCode.token, /^ej_/);
  });
});

test('tenant enterprise purge deletes shell, all staff, and status events; keeps other tenants and global users', async () => {
  const purgeKey = `${runKey}-purge`;
  let purgeEnterpriseId!: bigint;
  let purgeStaffId!: bigint;
  let purgeDesignerId!: bigint;
  let purgeLinkedUserId!: bigint;

  await withPlatformTransaction(async (transaction) => {
    const enterprisesRepository = new EnterpriseRepository(transaction);
    const staff = new AdminUserRepository(transaction);
    const network = new ReferrerNetworkRepository(transaction);

    purgeEnterpriseId = (
      await enterprisesRepository.create({
        name: `${purgeKey}-co`,
        code: `${purgeKey}-co`,
        status: 'active',
      })
    ).id;

    purgeStaffId = (
      await staff.create({
        enterpriseId: purgeEnterpriseId,
        username: `${purgeKey}-owner`,
        passwordHash: 'test-hash',
        displayName: '待删负责人',
        role: 'enterprise_admin',
        menuPermissions: ['referrer-network-operations'],
      })
    ).id;
    purgeDesignerId = (
      await staff.create({
        enterpriseId: purgeEnterpriseId,
        username: `${purgeKey}-designer`,
        passwordHash: 'test-hash',
        displayName: '待删设计师',
        role: 'designer',
        menuPermissions: ['dashboard'],
      })
    ).id;

    await network.rotateEnterpriseJoinCode({
      enterpriseId: purgeEnterpriseId,
      codeType: 'staff',
      actorStaffId: purgeStaffId,
    });

    const [customer] = await transaction
      .insert(users)
      .values({
        phone: `137${String(Date.now()).slice(-8)}`,
        nickname: `${purgeKey}-customer`,
        enterpriseId: purgeEnterpriseId,
      })
      .returning();
    purgeLinkedUserId = customer.id;

    await new LeadRepository(transaction).create({
      enterpriseId: purgeEnterpriseId,
      assignedTo: purgeDesignerId,
      customerUserId: purgeLinkedUserId,
      name: '待删客户',
      phone: customer.phone || '13700000000',
      source: 'referrer_network',
      assignmentStatus: 'assigned',
    });

    await enterprisesRepository.applyStatusAction({
      enterpriseId: purgeEnterpriseId,
      action: 'disable',
      reason: 'purge-test',
      actorAdminId: purgeStaffId,
    });
  });

  await withPlatformTransaction(async (transaction) => {
    const repository = new TenantEnterpriseResetRepository(transaction);
    const preview = await repository.previewPurge(purgeEnterpriseId);
    assert.equal(preview.mode, 'purge');
    assert.equal(preview.retainOperator, false);
    assert.equal(preview.retainedOperatorAdminUserId, null);
    assert.ok(preview.counts.some((item) => item.table === 'enterprises' && item.count === 1));
    assert.ok(preview.counts.some((item) => item.table === 'admin_users' && item.count >= 2));
    assert.ok(preview.counts.some((item) => item.table === 'enterprise_status_events' && item.count >= 1));

    const result = await repository.purge(purgeEnterpriseId);
    assert.equal(result.enterpriseDeleted, true);

    const remainingEnterprise = await transaction
      .select()
      .from(enterprises)
      .where(eq(enterprises.id, purgeEnterpriseId));
    assert.equal(remainingEnterprise.length, 0);

    const remainingStaff = await transaction
      .select()
      .from(adminUsers)
      .where(inArray(adminUsers.id, [purgeStaffId, purgeDesignerId]));
    assert.equal(remainingStaff.length, 0);

    const zeroTables = await Promise.all([
      transaction.select({ value: count() }).from(leads).where(eq(leads.enterpriseId, purgeEnterpriseId)),
      transaction
        .select({ value: count() })
        .from(enterpriseJoinCodes)
        .where(eq(enterpriseJoinCodes.enterpriseId, purgeEnterpriseId)),
      transaction
        .select({ value: count() })
        .from(enterpriseStatusEvents)
        .where(eq(enterpriseStatusEvents.enterpriseId, purgeEnterpriseId)),
    ]);
    for (const rows of zeroTables) {
      assert.equal(Number(rows[0]?.value || 0), 0);
    }

    const [otherEnterprise] = await transaction
      .select()
      .from(enterprises)
      .where(eq(enterprises.id, otherEnterpriseId));
    assert.ok(otherEnterprise);

    const [otherStaff] = await transaction
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.id, otherEnterpriseStaffId));
    assert.ok(otherStaff);

    const [linkedUser] = await transaction.select().from(users).where(eq(users.id, purgeLinkedUserId));
    assert.ok(linkedUser);
    assert.equal(linkedUser.enterpriseId, null);
  });
});
