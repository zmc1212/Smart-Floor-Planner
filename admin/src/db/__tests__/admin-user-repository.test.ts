import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { loadEnvConfig } from '@next/env';
import { eq } from 'drizzle-orm';
import {
  adminUsers,
  enterprises,
  leads,
  measurementAppointments,
  staffActivityCodes,
  users,
} from '@/db/schema';
import { AdminUserRepository, EnterpriseRepository, LeadRepository } from '@/db/repositories';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { httpErrorStatus } from '@/lib/http-error';

const runKey = `staff-delete-${process.pid}-${Date.now()}`;
let enterpriseId: bigint;
let customerUserId: bigint;

before(async () => {
  loadEnvConfig(process.cwd());
  const databaseUrl = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(
    ['localhost', '127.0.0.1'].includes(databaseUrl.hostname),
    'Staff delete tests only mutate the local database'
  );

  await withPlatformTransaction(async (transaction) => {
    enterpriseId = (
      await new EnterpriseRepository(transaction).create({
        name: `${runKey}-main`,
        code: `${runKey}-main`,
        status: 'active',
      })
    ).id;
    const [customer] = await transaction
      .insert(users)
      .values({ phone: `13${String(Date.now()).slice(-9)}`, nickname: `${runKey}-customer` })
      .returning();
    customerUserId = customer.id;
  });
});

after(async () => {
  await withPlatformTransaction(async (transaction) => {
    if (enterpriseId) {
      await transaction.delete(measurementAppointments).where(eq(measurementAppointments.enterpriseId, enterpriseId));
      await transaction.delete(leads).where(eq(leads.enterpriseId, enterpriseId));
      await transaction.delete(staffActivityCodes).where(eq(staffActivityCodes.enterpriseId, enterpriseId));
      await transaction.delete(adminUsers).where(eq(adminUsers.enterpriseId, enterpriseId));
      await transaction.delete(enterprises).where(eq(enterprises.id, enterpriseId));
    }
    if (customerUserId) await transaction.delete(users).where(eq(users.id, customerUserId));
  });
  await closePostgresPool();
});

async function createStaff(role: 'designer' | 'measurer', suffix: string) {
  return withTenantTransaction(enterpriseId, async (transaction) => {
    return new AdminUserRepository(transaction).create({
      enterpriseId,
      username: `${runKey}-${suffix}`,
      passwordHash: 'test-only',
      displayName: suffix,
      role,
      status: 'active',
      assignmentPaused: false,
    });
  });
}

test('delete removes a designer who only has a Mini Program activity code', async () => {
  const staff = await createStaff('designer', 'activity');
  await withTenantTransaction(enterpriseId, async (transaction) => {
    await transaction.insert(staffActivityCodes).values({
      enterpriseId,
      staffId: staff.id,
      tokenHash: `${runKey}-activity-${staff.id}`,
      status: 'active',
      version: 1,
    });
  });

  const deleted = await withTenantTransaction(enterpriseId, (transaction) =>
    new AdminUserRepository(transaction).delete(staff.id)
  );
  assert.equal(deleted?.id, staff.id);

  const leftover = await withPlatformTransaction(async (transaction) => ({
    staff: await transaction.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.id, staff.id)),
    codes: await transaction
      .select({ id: staffActivityCodes.id })
      .from(staffActivityCodes)
      .where(eq(staffActivityCodes.staffId, staff.id)),
  }));
  assert.equal(leftover.staff.length, 0);
  assert.equal(leftover.codes.length, 0);
});

test('delete unassigns leads and still removes the staff row', async () => {
  const designer = await createStaff('designer', 'assigned');
  const leadId = await withTenantTransaction(enterpriseId, async (transaction) => {
    const lead = await new LeadRepository(transaction).create({
      enterpriseId,
      assignedTo: designer.id,
      customerUserId,
      name: '待改派客户',
      phone: `15${String(Date.now()).slice(-9)}`,
      source: 'staff-delete-test',
      assignmentStatus: 'assigned',
    });
    return lead.id;
  });

  await withTenantTransaction(enterpriseId, (transaction) =>
    new AdminUserRepository(transaction).delete(designer.id)
  );

  const remainingLead = await withPlatformTransaction(async (transaction) => {
    const [row] = await transaction
      .select({ assignedTo: leads.assignedTo })
      .from(leads)
      .where(eq(leads.id, leadId));
    return row;
  });
  assert.equal(remainingLead?.assignedTo, null);
});

test('delete refuses staff who still own a measurement appointment', async () => {
  const designer = await createStaff('designer', 'booked-designer');
  const measurer = await createStaff('measurer', 'booked-measurer');
  const leadId = await withTenantTransaction(enterpriseId, async (transaction) => {
    const lead = await new LeadRepository(transaction).create({
      enterpriseId,
      assignedTo: designer.id,
      measurerId: measurer.id,
      customerUserId,
      name: '已预约客户',
      phone: `16${String(Date.now()).slice(-9)}`,
      source: 'staff-delete-test',
      assignmentStatus: 'assigned',
    });
    return lead.id;
  });
  await withTenantTransaction(enterpriseId, async (transaction) => {
    await transaction.insert(measurementAppointments).values({
      enterpriseId,
      leadId,
      designerId: designer.id,
      measurerId: measurer.id,
      address: '测试小区 1 号',
      timeRange: '[2026-08-24T01:00:00.000Z,2026-08-24T03:00:00.000Z)',
      status: 'confirmed',
    });
  });

  await assert.rejects(
    () =>
      withTenantTransaction(enterpriseId, (transaction) =>
        new AdminUserRepository(transaction).delete(designer.id)
      ),
    (error: unknown) => {
      assert.equal(httpErrorStatus(error, 500), 409);
      assert.match((error as Error).message, /量房预约/);
      return true;
    }
  );

  const stillThere = await withPlatformTransaction(async (transaction) => {
    const [row] = await transaction.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.id, designer.id));
    return row;
  });
  assert.equal(stillThere?.id, designer.id);
});
