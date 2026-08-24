import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { loadEnvConfig } from '@next/env';
import { eq, inArray, isNull } from 'drizzle-orm';
import {
  adminUsers,
  customerAttributionLocks,
  enterprises,
  leadAssignmentEvents,
  leadClaimWindows,
  leadOutcomeSnapshots,
  leadLifecycleEvents,
  leads,
  measurementAppointmentEvents,
  measurementAppointments,
  mediaAssets,
  promotionScanAudits,
  referrerEnterpriseMemberships,
  referrerProfiles,
  referrerPromotionCodes,
  staffActivityCodes,
  staffUnavailabilityPeriods,
  users,
} from '@/db/schema';
import {
  AdminUserRepository,
  AiCreationRepository,
  AppointmentRepository,
  EnterpriseRepository,
  LeadRepository,
  ReferralLeadRepository,
  ReferrerNetworkRepository,
  AssignmentRacingRepository,
  hashClaimIdempotencyKey,
  LeadLifecycleRepository,
} from '@/db/repositories';
import {
  withPlatformTransaction,
  withTenantTransaction,
} from '@/db/transaction';
import {
  closePostgresPool,
  resolvePostgresRuntimeConfig,
} from '@/lib/postgresql';
import { localDateInTimeZone, zonedDateTimeToUtc } from '@/lib/appointment-scheduling';

const runKey = `referral-lead-${process.pid}-${Date.now()}`;
const enterpriseIds: bigint[] = [];
const userIds: bigint[] = [];

type Source = {
  promotionCodeId: bigint;
  membershipId: bigint;
  version: number;
  expired: boolean;
};

async function createSource(enterpriseId: bigint, suffix: string) {
  return withPlatformTransaction(async (transaction) => {
    const [referrerUser] = await transaction
      .insert(users)
      .values({
        phone: `13${String(Date.now() + userIds.length).slice(-9)}`,
        nickname: `${runKey}-${suffix}-referrer`,
      })
      .returning();
    userIds.push(referrerUser.id);
    const [profile] = await transaction
      .insert(referrerProfiles)
      .values({
        userId: referrerUser.id,
        displayName: `${runKey}-${suffix}-referrer`,
      })
      .returning();
    const [membership] = await transaction
      .insert(referrerEnterpriseMemberships)
      .values({ referrerId: profile.id, enterpriseId })
      .returning();
    const code = await new ReferrerNetworkRepository(
      transaction
    ).getReferrerPromotionCode(referrerUser.id, membership.id);
    assert.ok(code);
    return {
      promotionCodeId: code!.code.id,
      membershipId: membership.id,
      version: code!.code.version,
      expired: false,
    } satisfies Source;
  });
}

async function createCustomer(suffix: string) {
  return withPlatformTransaction(async (transaction) => {
    const [user] = await transaction
      .insert(users)
      .values({
        phone: `15${String(Date.now() + userIds.length).slice(-9)}`,
        nickname: `${runKey}-${suffix}`,
      })
      .returning();
    userIds.push(user.id);
    return user;
  });
}

async function createAssignmentStaff(
  enterpriseId: bigint,
  role: 'designer' | 'measurer',
  suffix: string,
  userId?: bigint
) {
  return withTenantTransaction(enterpriseId, async (transaction) => {
    let qrAssetId: bigint | null = null;
    if (role === 'designer') {
      const asset = await new AiCreationRepository(transaction).createMediaAsset({
        enterpriseId,
        ownerType: 'staff_wechat_qr',
        mimeType: 'image/png',
        size: BigInt(1),
        storageKey: `${runKey}-${suffix}.png`,
      });
      qrAssetId = asset.id;
    }
    const staff = await new AdminUserRepository(transaction).create({
      enterpriseId,
      userId: userId ?? null,
      username: `${runKey}-${suffix}`,
      passwordHash: 'test-only',
      displayName: `${role}-${suffix}`,
      role,
      status: 'active',
      assignmentPaused: false,
      wechatId: role === 'designer' ? `wx-${suffix}` : null,
      wechatQrAssetId: qrAssetId,
    });
    if (qrAssetId) {
      await new AiCreationRepository(transaction).updateMediaAsset(qrAssetId, {
        ownerId: staff.id,
      });
    }
    return staff;
  });
}

before(async () => {
  loadEnvConfig(process.cwd());
  const url = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(
    ['localhost', '127.0.0.1'].includes(url.hostname),
    'Referral lead integration tests only mutate the local database'
  );

  await withPlatformTransaction(async (transaction) => {
    const repository = new EnterpriseRepository(transaction);
    for (const suffix of ['balanced', 'pending']) {
      const enterprise = await repository.create({
        name: `${runKey}-${suffix}`,
        code: `${runKey}-${suffix}`,
        status: 'active',
      });
      enterpriseIds.push(enterprise.id);
    }
  });
});

after(async () => {
  if (enterpriseIds.length) {
    await withPlatformTransaction(async (transaction) => {
      await transaction
        .delete(promotionScanAudits)
        .where(inArray(promotionScanAudits.enterpriseId, enterpriseIds));
      await transaction
        .delete(customerAttributionLocks)
        .where(inArray(customerAttributionLocks.enterpriseId, enterpriseIds));
      await transaction
        .delete(leadAssignmentEvents)
        .where(inArray(leadAssignmentEvents.enterpriseId, enterpriseIds));
      await transaction
        .delete(leadLifecycleEvents)
        .where(inArray(leadLifecycleEvents.enterpriseId, enterpriseIds));
      await transaction
        .delete(measurementAppointmentEvents)
        .where(inArray(measurementAppointmentEvents.enterpriseId, enterpriseIds));
      await transaction
        .delete(measurementAppointments)
        .where(inArray(measurementAppointments.enterpriseId, enterpriseIds));
      await transaction
        .delete(staffUnavailabilityPeriods)
        .where(inArray(staffUnavailabilityPeriods.enterpriseId, enterpriseIds));
      await transaction
        .delete(leads)
        .where(inArray(leads.enterpriseId, enterpriseIds));
      await transaction
        .delete(staffActivityCodes)
        .where(inArray(staffActivityCodes.enterpriseId, enterpriseIds));
      await transaction
        .delete(referrerPromotionCodes)
        .where(inArray(referrerPromotionCodes.enterpriseId, enterpriseIds));
      await transaction
        .delete(referrerEnterpriseMemberships)
        .where(inArray(referrerEnterpriseMemberships.enterpriseId, enterpriseIds));
      if (userIds.length) {
        await transaction
          .delete(referrerProfiles)
          .where(inArray(referrerProfiles.userId, userIds));
      }
      await transaction
        .delete(adminUsers)
        .where(inArray(adminUsers.enterpriseId, enterpriseIds));
      await transaction
        .delete(mediaAssets)
        .where(inArray(mediaAssets.enterpriseId, enterpriseIds));
      if (userIds.length) {
        await transaction.delete(users).where(inArray(users.id, userIds));
      }
      await transaction
        .delete(enterprises)
        .where(inArray(enterprises.id, enterpriseIds));
    });
  }
  await closePostgresPool();
});

test('atomic attribution uses stable lowest-load assignment and tenant isolation', async () => {
  const enterpriseId = enterpriseIds[0];
  const source = await createSource(enterpriseId, 'balanced');
  const designerA = await createAssignmentStaff(enterpriseId, 'designer', 'designer-a');
  const designerB = await createAssignmentStaff(enterpriseId, 'designer', 'designer-b');
  const measurerA = await createAssignmentStaff(enterpriseId, 'measurer', 'measurer-a');
  const measurerB = await createAssignmentStaff(enterpriseId, 'measurer', 'measurer-b');
  const customerA = await createCustomer('customer-a');
  const customerB = await createCustomer('customer-b');

  const first = await withPlatformTransaction((transaction) =>
    new ReferralLeadRepository(transaction).authorizeAndCreateLead({
      source,
      customerUserId: customerA.id,
      idempotencyKeyHash: `${runKey}-claim-a`,
    })
  );
  assert.equal(first.kind, 'created');
  assert.equal(first.lead.assignedTo, designerA.id);
  assert.equal(first.lead.measurerId, measurerA.id);
  assert.equal(first.lead.assignmentStatus, 'assigned');

  const second = await withPlatformTransaction((transaction) =>
    new ReferralLeadRepository(transaction).authorizeAndCreateLead({
      source,
      customerUserId: customerB.id,
      idempotencyKeyHash: `${runKey}-claim-b`,
    })
  );
  assert.equal(second.lead.assignedTo, designerB.id);
  assert.equal(second.lead.measurerId, measurerB.id);

  const tenantBRows = await withTenantTransaction(enterpriseIds[1], (transaction) =>
    Promise.all([
      transaction.select().from(leads).where(eq(leads.id, first.lead.id)),
      transaction
        .select()
        .from(customerAttributionLocks)
        .where(eq(customerAttributionLocks.leadId, first.lead.id)),
      transaction
        .select()
        .from(leadAssignmentEvents)
        .where(eq(leadAssignmentEvents.leadId, first.lead.id)),
    ])
  );
  assert.deepEqual(tenantBRows.map((rows) => rows.length), [0, 0, 0]);
});

test('concurrent authorization creates one active attribution and retry survives closure', async () => {
  const enterpriseId = enterpriseIds[0];
  const source = await createSource(enterpriseId, 'concurrent');
  const customer = await createCustomer('concurrent-customer');

  const [first, second] = await Promise.all([
    withPlatformTransaction((transaction) =>
      new ReferralLeadRepository(transaction).authorizeAndCreateLead({
        source,
        customerUserId: customer.id,
        idempotencyKeyHash: `${runKey}-concurrent-a`,
      })
    ),
    withPlatformTransaction((transaction) =>
      new ReferralLeadRepository(transaction).authorizeAndCreateLead({
        source,
        customerUserId: customer.id,
        idempotencyKeyHash: `${runKey}-concurrent-b`,
      })
    ),
  ]);
  assert.equal(first.lead.id, second.lead.id);
  assert.deepEqual(new Set([first.kind, second.kind]), new Set(['created', 'existing_attribution']));

  const counts = await withPlatformTransaction(async (transaction) => ({
    leads: await transaction
      .select()
      .from(leads)
      .where(eq(leads.customerUserId, customer.id)),
    locks: await transaction
      .select()
      .from(customerAttributionLocks)
      .where(
        eq(customerAttributionLocks.customerUserId, customer.id)
      ),
  }));
  assert.equal(counts.leads.length, 1);
  assert.equal(counts.locks.filter((lock) => lock.releasedAt === null).length, 1);

  await withTenantTransaction(enterpriseId, (transaction) =>
    new LeadRepository(transaction).update(first.lead.id, { status: 'closed' })
  );
  const released = await withPlatformTransaction((transaction) =>
    transaction
      .select()
      .from(customerAttributionLocks)
      .where(eq(customerAttributionLocks.leadId, first.lead.id))
  );
  assert.ok(released[0]?.releasedAt);

  const idempotent = await withPlatformTransaction((transaction) =>
    new ReferralLeadRepository(transaction).authorizeAndCreateLead({
      source,
      customerUserId: customer.id,
      idempotencyKeyHash: `${runKey}-concurrent-a`,
    })
  );
  assert.equal(idempotent.kind, 'idempotent');
  assert.equal(idempotent.lead.id, first.lead.id);

  const reusedKey = `${runKey}-concurrent-b`;
  const reusedIdempotent = await withPlatformTransaction((transaction) =>
    new ReferralLeadRepository(transaction).authorizeAndCreateLead({
      source,
      customerUserId: customer.id,
      idempotencyKeyHash: reusedKey,
    })
  );
  assert.equal(reusedIdempotent.kind, 'idempotent');
  assert.equal(reusedIdempotent.lead.id, first.lead.id);

  const replacement = await withPlatformTransaction((transaction) =>
    new ReferralLeadRepository(transaction).authorizeAndCreateLead({
      source,
      customerUserId: customer.id,
      idempotencyKeyHash: `${runKey}-replacement`,
    })
  );
  assert.equal(replacement.kind, 'created');
  assert.notEqual(replacement.lead.id, first.lead.id);
});

test('an archived lead does not block a later claim', async () => {
  const enterpriseId = enterpriseIds[0];
  const source = await createSource(enterpriseId, 'archive-reclaim');
  const customer = await createCustomer('archive-reclaim');
  const first = await withPlatformTransaction((transaction) =>
    new ReferralLeadRepository(transaction).authorizeAndCreateLead({
      source,
      customerUserId: customer.id,
      idempotencyKeyHash: `${runKey}-archive-first`,
    })
  );
  assert.equal(first.kind, 'created');

  await withTenantTransaction(enterpriseId, (transaction) =>
    transaction
      .update(leads)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(eq(leads.id, first.lead.id))
  );

  const second = await withPlatformTransaction((transaction) =>
    new ReferralLeadRepository(transaction).authorizeAndCreateLead({
      source,
      customerUserId: customer.id,
      idempotencyKeyHash: `${runKey}-archive-second`,
    })
  );
  assert.equal(second.kind, 'created');
  assert.notEqual(second.lead.id, first.lead.id);

  const locks = await withPlatformTransaction((transaction) =>
    transaction
      .select()
      .from(customerAttributionLocks)
      .where(eq(customerAttributionLocks.customerUserId, customer.id))
  );
  assert.equal(locks.filter((lock) => lock.releasedAt === null).length, 1);
  assert.equal(
    locks.find((lock) => lock.releasedAt === null)?.leadId,
    second.lead.id
  );
});

test('no candidates preserve the lead and a later retry fills both roles', async () => {
  const enterpriseId = enterpriseIds[1];
  const source = await createSource(enterpriseId, 'pending');
  const customer = await createCustomer('pending-customer');
  const pending = await withPlatformTransaction((transaction) =>
    new ReferralLeadRepository(transaction).authorizeAndCreateLead({
      source,
      customerUserId: customer.id,
      idempotencyKeyHash: `${runKey}-pending`,
    })
  );
  assert.equal(pending.kind, 'created');
  assert.equal(pending.lead.assignmentStatus, 'assignment_pending');
  assert.equal(
    pending.lead.assignmentErrorCode,
    'designer_unavailable'
  );

  const designer = await createAssignmentStaff(enterpriseId, 'designer', 'retry-designer');
  const measurer = await createAssignmentStaff(enterpriseId, 'measurer', 'retry-measurer');
  const retried = await withTenantTransaction(enterpriseId, (transaction) =>
    new ReferralLeadRepository(transaction).retryLeadAssignment({
      leadId: pending.lead.id,
      reason: 'staff_pool_changed',
    })
  );
  assert.ok(retried);
  assert.equal(retried?.kind, 'assigned');
  assert.equal(retried?.lead.assignedTo, designer.id);
  assert.equal(retried?.lead.measurerId, measurer.id);
  assert.equal(retried?.lead.assignmentErrorCode, null);

  const retryAgain = await withTenantTransaction(enterpriseId, (transaction) =>
    new ReferralLeadRepository(transaction).retryLeadAssignment({
      leadId: pending.lead.id,
      reason: 'duplicate_retry',
    })
  );
  assert.equal(retryAgain?.kind, 'already_assigned');

  const activeLock = await withTenantTransaction(enterpriseId, (transaction) =>
    transaction
      .select()
      .from(customerAttributionLocks)
      .where(
        eq(customerAttributionLocks.customerUserId, customer.id)
      )
  );
  assert.equal(activeLock.filter((row) => row.releasedAt === null).length, 1);

  const pendingRows = await withTenantTransaction(enterpriseId, (transaction) =>
    transaction
      .select()
      .from(leads)
      .where(
        isNull(leads.assignmentErrorCode)
      )
  );
  assert.equal(pendingRows.some((lead) => lead.id === pending.lead.id), true);
});

test('manual assign fills missing roles and can overwrite bound staff', async () => {
  const enterprise = await withPlatformTransaction(async (transaction) =>
    new EnterpriseRepository(transaction).create({
      name: `${runKey}-manual-assign`,
      code: `${runKey}-manual-assign`,
      status: 'active',
    })
  );
  enterpriseIds.push(enterprise.id);
  const enterpriseId = enterprise.id;
  const source = await createSource(enterpriseId, 'manual-assign');
  const customer = await createCustomer('manual-assign-customer');
  const pending = await withPlatformTransaction((transaction) =>
    new ReferralLeadRepository(transaction).authorizeAndCreateLead({
      source,
      customerUserId: customer.id,
      idempotencyKeyHash: `${runKey}-manual-assign`,
    })
  );
  assert.equal(pending.kind, 'created');
  assert.equal(pending.lead.assignmentStatus, 'assignment_pending');

  const designer = await createAssignmentStaff(enterpriseId, 'designer', 'overwrite-designer');
  const replacementDesigner = await createAssignmentStaff(enterpriseId, 'designer', 'overwrite-designer-b');
  const measurer = await createAssignmentStaff(enterpriseId, 'measurer', 'overwrite-measurer');
  const replacementMeasurer = await createAssignmentStaff(enterpriseId, 'measurer', 'overwrite-measurer-b');

  const partial = await withTenantTransaction(enterpriseId, (transaction) =>
    new ReferralLeadRepository(transaction).assignStaff({
      leadId: pending.lead.id,
      actorStaffId: designer.id,
      actorRole: 'enterprise_admin',
      designerId: designer.id,
    })
  );
  assert.ok(partial);
  assert.equal(partial?.kind, 'pending');
  assert.equal(partial?.lead.assignedTo, designer.id);
  assert.equal(partial?.lead.measurerId, null);
  assert.equal(partial?.lead.assignmentErrorCode, 'measurer_unavailable');

  const assigned = await withTenantTransaction(enterpriseId, (transaction) =>
    new ReferralLeadRepository(transaction).assignStaff({
      leadId: pending.lead.id,
      actorStaffId: designer.id,
      actorRole: 'enterprise_admin',
      measurerId: measurer.id,
    })
  );
  assert.ok(assigned);
  assert.equal(assigned?.kind, 'assigned');
  assert.equal(assigned?.lead.assignedTo, designer.id);
  assert.equal(assigned?.lead.measurerId, measurer.id);
  assert.equal(assigned?.lead.assignmentErrorCode, null);

  await assert.rejects(
    () =>
      withTenantTransaction(enterpriseId, (transaction) =>
        new ReferralLeadRepository(transaction).assignStaff({
          leadId: pending.lead.id,
          actorStaffId: designer.id,
          actorRole: 'enterprise_admin',
          designerId: designer.id,
        })
      ),
    /已是当前绑定人员/
  );

  const overwritten = await withTenantTransaction(enterpriseId, (transaction) =>
    new ReferralLeadRepository(transaction).assignStaff({
      leadId: pending.lead.id,
      actorStaffId: designer.id,
      actorRole: 'enterprise_admin',
      designerId: replacementDesigner.id,
      measurerId: replacementMeasurer.id,
    })
  );
  assert.ok(overwritten);
  assert.equal(overwritten?.kind, 'assigned');
  assert.equal(overwritten?.lead.assignedTo, replacementDesigner.id);
  assert.equal(overwritten?.lead.measurerId, replacementMeasurer.id);

  await assert.rejects(
    () =>
      withTenantTransaction(enterpriseId, (transaction) =>
        new ReferralLeadRepository(transaction).assignStaff({
          leadId: overwritten!.lead.id,
          actorStaffId: replacementDesigner.id,
          actorRole: 'designer',
          designerId: designer.id,
        })
      ),
    /无权更换设计师/
  );

  const designerChangesMeasurer = await withTenantTransaction(enterpriseId, (transaction) =>
    new ReferralLeadRepository(transaction).assignStaff({
      leadId: overwritten!.lead.id,
      actorStaffId: replacementDesigner.id,
      actorRole: 'designer',
      measurerId: measurer.id,
    })
  );
  assert.equal(designerChangesMeasurer?.lead.assignedTo, replacementDesigner.id);
  assert.equal(designerChangesMeasurer?.lead.measurerId, measurer.id);

  await assert.rejects(
    () =>
      withTenantTransaction(enterpriseId, (transaction) =>
        new ReferralLeadRepository(transaction).assignStaff({
          leadId: overwritten!.lead.id,
          actorStaffId: measurer.id,
          actorRole: 'measurer',
          measurerId: replacementMeasurer.id,
        })
      ),
    /无权分配或更换测量员/
  );
});

test('staff activity claims lock the presenter as measurer and skip referrer commission source', async () => {
  const enterprise = await withPlatformTransaction(async (transaction) =>
    new EnterpriseRepository(transaction).create({
      name: `${runKey}-activity`,
      code: `${runKey}-activity`,
      status: 'active',
    })
  );
  enterpriseIds.push(enterprise.id);
  const enterpriseId = enterprise.id;
  const designerUser = await createCustomer('activity-designer-user');
  const measurerUser = await createCustomer('activity-measurer-user');
  const designer = await createAssignmentStaff(enterpriseId, 'designer', 'activity-designer', designerUser.id);
  const measurer = await createAssignmentStaff(enterpriseId, 'measurer', 'activity-measurer', measurerUser.id);
  const dualSource = await withPlatformTransaction(async (transaction) => {
    const activity = await new ReferrerNetworkRepository(transaction).getStaffActivityCode(
      designerUser.id,
      designer.id
    );
    assert.equal(activity.ok, true);
    if (!activity.ok) throw new Error('activity code missing');
    return {
      kind: 'staff_activity' as const,
      activityCodeId: activity.code.id,
      staffId: designer.id,
      enterpriseId,
      version: activity.code.version,
      expired: false,
    };
  });
  const dualCustomer = await createCustomer('activity-dual');
  const dual = await withPlatformTransaction((transaction) =>
    new ReferralLeadRepository(transaction).authorizeAndCreateLead({
      source: dualSource,
      customerUserId: dualCustomer.id,
      idempotencyKeyHash: `${runKey}-activity-dual`,
    })
  );
  assert.equal(dual.kind, 'created');
  assert.equal(dual.lead.source, 'staff_activity');
  assert.equal(dual.lead.referrerMembershipId, null);
  assert.equal(dual.lead.measurerId, designer.id);
  assert.equal(dual.lead.assignedTo, designer.id);
  assert.equal(dual.lead.promoterId, designer.id);

  const measurerSource = await withPlatformTransaction(async (transaction) => {
    const activity = await new ReferrerNetworkRepository(transaction).getStaffActivityCode(
      measurerUser.id,
      measurer.id
    );
    assert.equal(activity.ok, true);
    if (!activity.ok) throw new Error('activity code missing');
    return {
      kind: 'staff_activity' as const,
      activityCodeId: activity.code.id,
      staffId: measurer.id,
      enterpriseId,
      version: activity.code.version,
      expired: false,
    };
  });
  const measurerCustomer = await createCustomer('activity-measurer-customer');
  const presented = await withPlatformTransaction((transaction) =>
    new ReferralLeadRepository(transaction).authorizeAndCreateLead({
      source: measurerSource,
      customerUserId: measurerCustomer.id,
      idempotencyKeyHash: `${runKey}-activity-measurer`,
    })
  );
  assert.equal(presented.kind, 'created');
  assert.equal(presented.lead.source, 'staff_activity');
  assert.equal(presented.lead.measurerId, measurer.id);
  assert.equal(presented.lead.assignedTo, designer.id);

  const reused = await withPlatformTransaction((transaction) =>
    new ReferralLeadRepository(transaction).authorizeAndCreateLead({
      source: measurerSource,
      customerUserId: dualCustomer.id,
      idempotencyKeyHash: `${runKey}-activity-preserve`,
    })
  );
  assert.equal(reused.kind, 'existing_attribution');
  assert.equal(reused.lead.id, dual.lead.id);

  const lockedRetry = await withTenantTransaction(enterpriseId, (transaction) =>
    new ReferralLeadRepository(transaction).retryLeadAssignment({
      leadId: presented.lead.id,
      reason: 'staff_pool_changed',
    })
  );
  assert.equal(lockedRetry?.lead.measurerId, measurer.id);
});

test('staff activity retry assigns a presenter who was paused at claim time', async () => {
  const enterprise = await withPlatformTransaction(async (transaction) =>
    new EnterpriseRepository(transaction).create({
      name: `${runKey}-paused-activity`,
      code: `${runKey}-paused-activity`,
      status: 'active',
    })
  );
  enterpriseIds.push(enterprise.id);
  const enterpriseId = enterprise.id;
  const designerUser = await createCustomer('paused-activity-designer-user');
  const measurerUser = await createCustomer('paused-activity-measurer-user');
  const designer = await createAssignmentStaff(
    enterpriseId,
    'designer',
    'paused-activity-designer',
    designerUser.id
  );
  const measurer = await createAssignmentStaff(
    enterpriseId,
    'measurer',
    'paused-activity-measurer',
    measurerUser.id
  );
  await withTenantTransaction(enterpriseId, (transaction) =>
    new AdminUserRepository(transaction).update(measurer.id, {
      assignmentPaused: true,
    })
  );
  const source = await withPlatformTransaction(async (transaction) => {
    const activity = await new ReferrerNetworkRepository(transaction).getStaffActivityCode(
      measurerUser.id,
      measurer.id
    );
    assert.equal(activity.ok, true);
    if (!activity.ok) throw new Error('activity code missing');
    return {
      kind: 'staff_activity' as const,
      activityCodeId: activity.code.id,
      staffId: measurer.id,
      enterpriseId,
      version: activity.code.version,
      expired: false,
    };
  });
  const customer = await createCustomer('paused-activity-customer');
  const pending = await withPlatformTransaction((transaction) =>
    new ReferralLeadRepository(transaction).authorizeAndCreateLead({
      source,
      customerUserId: customer.id,
      idempotencyKeyHash: `${runKey}-paused-activity`,
    })
  );
  assert.equal(pending.kind, 'created');
  assert.equal(pending.lead.assignedTo, designer.id);
  assert.equal(pending.lead.measurerId, null);
  assert.equal(pending.lead.promoterId, measurer.id);
  assert.equal(pending.lead.assignmentErrorCode, 'measurer_unavailable');

  await withTenantTransaction(enterpriseId, (transaction) =>
    new AdminUserRepository(transaction).update(measurer.id, {
      assignmentPaused: false,
    })
  );
  const retried = await withTenantTransaction(enterpriseId, (transaction) =>
    new ReferralLeadRepository(transaction).retryLeadAssignment({
      leadId: pending.lead.id,
      reason: 'presenter_unpaused',
    })
  );
  assert.equal(retried?.kind, 'assigned');
  assert.equal(retried?.lead.assignedTo, designer.id);
  assert.equal(retried?.lead.measurerId, measurer.id);
  assert.equal(retried?.lead.assignmentErrorCode, null);
});

test('manual entry assigns the staff pool and never binds a customer WeChat user', async () => {
  const enterprise = await withPlatformTransaction(async (transaction) =>
    new EnterpriseRepository(transaction).create({
      name: `${runKey}-manual`,
      code: `${runKey}-manual`,
      status: 'active',
    })
  );
  enterpriseIds.push(enterprise.id);
  const ownerUser = await createCustomer('manual-owner-user');
  const owner = await withTenantTransaction(enterprise.id, (transaction) =>
    new AdminUserRepository(transaction).create({
      enterpriseId: enterprise.id,
      userId: ownerUser.id,
      username: `${runKey}-manual-owner`,
      passwordHash: 'test-only',
      displayName: 'enterprise-admin-owner',
      role: 'enterprise_admin',
      status: 'active',
      assignmentPaused: false,
    })
  );
  const designer = await createAssignmentStaff(enterprise.id, 'designer', 'manual-designer');
  const measurer = await createAssignmentStaff(enterprise.id, 'measurer', 'manual-measurer');
  const created = await withTenantTransaction(enterprise.id, (transaction) =>
    new ReferralLeadRepository(transaction).createManualEntryLead({
      enterpriseId: enterprise.id,
      actorStaffId: owner.id,
      actorUserId: ownerUser.id,
      name: '手工客户',
      phone: `16${String(Date.now()).slice(-9)}`,
      communityName: '测试小区',
    })
  );
  assert.equal(created.lead.source, 'manual_entry');
  assert.equal(created.lead.customerUserId, null);
  assert.equal(created.lead.referrerMembershipId, null);
  assert.equal(created.lead.promoterId, owner.id);
  assert.equal(created.lead.assignedTo, designer.id);
  assert.equal(created.lead.measurerId, measurer.id);
  assert.equal(created.lead.assignmentStatus, 'assigned');
  assert.notEqual(created.lead.assignedTo, owner.id);
});

test('claiming a code attaches to the same-enterprise manual lead with the same phone', async () => {
  const enterprise = await withPlatformTransaction(async (transaction) =>
    new EnterpriseRepository(transaction).create({
      name: `${runKey}-phone-claim`,
      code: `${runKey}-phone-claim`,
      status: 'active',
    })
  );
  enterpriseIds.push(enterprise.id);
  await createAssignmentStaff(enterprise.id, 'designer', 'phone-claim-designer');
  await createAssignmentStaff(enterprise.id, 'measurer', 'phone-claim-measurer');
  const phone = `181${String(Date.now()).slice(-8)}`;
  const customer = await withPlatformTransaction(async (transaction) => {
    const [user] = await transaction
      .insert(users)
      .values({ phone, nickname: '微信客户' })
      .returning();
    userIds.push(user.id);
    return user;
  });
  const source = await createSource(enterprise.id, 'phone-claim');
  const manual = await withTenantTransaction(enterprise.id, (transaction) =>
    new ReferralLeadRepository(transaction).createManualEntryLead({
      enterpriseId: enterprise.id,
      actorStaffId: null,
      actorUserId: null,
      name: '1111',
      phone,
      communityName: '西陵小区',
    })
  );
  const claimed = await withPlatformTransaction((transaction) =>
    new ReferralLeadRepository(transaction).authorizeAndCreateLead({
      source,
      customerUserId: customer.id,
      idempotencyKeyHash: `${runKey}-phone-claim`,
    })
  );
  assert.equal(claimed.kind, 'existing_attribution');
  assert.equal(claimed.lead.id, manual.lead.id);
  assert.equal(claimed.lead.customerUserId, customer.id);
  assert.equal(claimed.lead.name, '1111');
  assert.equal(claimed.lead.source, 'manual_entry');
  const rows = await withTenantTransaction(enterprise.id, (transaction) =>
    transaction.select().from(leads).where(eq(leads.enterpriseId, enterprise.id))
  );
  assert.equal(rows.length, 1);
});

test('manual entry reuses the scanned lead with the same phone and fills staff profile', async () => {
  const enterprise = await withPlatformTransaction(async (transaction) =>
    new EnterpriseRepository(transaction).create({
      name: `${runKey}-phone-manual`,
      code: `${runKey}-phone-manual`,
      status: 'active',
    })
  );
  enterpriseIds.push(enterprise.id);
  await createAssignmentStaff(enterprise.id, 'designer', 'phone-manual-designer');
  await createAssignmentStaff(enterprise.id, 'measurer', 'phone-manual-measurer');
  const phone = `182${String(Date.now()).slice(-8)}`;
  const customer = await withPlatformTransaction(async (transaction) => {
    const [user] = await transaction
      .insert(users)
      .values({ phone, nickname: '微信客户' })
      .returning();
    userIds.push(user.id);
    return user;
  });
  const source = await createSource(enterprise.id, 'phone-manual');
  const claimed = await withPlatformTransaction((transaction) =>
    new ReferralLeadRepository(transaction).authorizeAndCreateLead({
      source,
      customerUserId: customer.id,
      idempotencyKeyHash: `${runKey}-phone-manual`,
    })
  );
  assert.equal(claimed.kind, 'created');
  assert.equal(claimed.lead.name, '微信客户');
  const merged = await withTenantTransaction(enterprise.id, (transaction) =>
    new ReferralLeadRepository(transaction).createManualEntryLead({
      enterpriseId: enterprise.id,
      actorStaffId: null,
      actorUserId: null,
      name: '1111',
      phone,
      communityName: '西陵小区',
      area: '120',
      stylePreference: '工业风',
    })
  );
  assert.equal(merged.created, false);
  assert.equal(merged.lead.id, claimed.lead.id);
  assert.equal(merged.lead.name, '1111');
  assert.equal(merged.lead.communityName, '西陵小区');
  assert.equal(Number(merged.lead.area), 120);
  assert.equal(merged.lead.stylePreference, '工业风');
  assert.equal(merged.lead.customerUserId, customer.id);
  const rows = await withTenantTransaction(enterprise.id, (transaction) =>
    transaction.select().from(leads).where(eq(leads.enterpriseId, enterprise.id))
  );
  assert.equal(rows.length, 1);
});

test('manual entry matches a WeChat 86-prefixed phone already stored on the scanned lead', async () => {
  const enterprise = await withPlatformTransaction(async (transaction) =>
    new EnterpriseRepository(transaction).create({
      name: `${runKey}-phone-86`,
      code: `${runKey}-phone-86`,
      status: 'active',
    })
  );
  enterpriseIds.push(enterprise.id);
  const designer = await createAssignmentStaff(enterprise.id, 'designer', 'phone-86-designer');
  const measurer = await createAssignmentStaff(enterprise.id, 'measurer', 'phone-86-measurer');
  const localPhone = `183${String(Date.now()).slice(-8)}`;
  const wechatPhone = `86${localPhone}`;
  const customer = await withPlatformTransaction(async (transaction) => {
    const [user] = await transaction
      .insert(users)
      .values({ phone: wechatPhone, nickname: '微信客户' })
      .returning();
    userIds.push(user.id);
    return user;
  });
  const scanned = await withTenantTransaction(enterprise.id, async (transaction) => {
    const [lead] = await transaction
      .insert(leads)
      .values({
        enterpriseId: enterprise.id,
        customerUserId: customer.id,
        assignedTo: designer.id,
        measurerId: measurer.id,
        assignedAt: new Date(),
        assignmentStatus: 'assigned',
        name: '微信客户',
        phone: wechatPhone,
        source: 'referrer_network',
        status: 'new',
        followUpRecords: [],
      })
      .returning();
    return lead;
  });
  const merged = await withTenantTransaction(enterprise.id, (transaction) =>
    new ReferralLeadRepository(transaction).createManualEntryLead({
      enterpriseId: enterprise.id,
      actorStaffId: null,
      actorUserId: null,
      name: '李女士',
      phone: localPhone,
    })
  );
  assert.equal(merged.created, false);
  assert.equal(merged.lead.id, scanned.id);
  assert.equal(merged.lead.name, '李女士');
  assert.equal(merged.lead.phone, localPhone);
});

test('manual entry stays pending without a pool and retry fills both roles', async () => {
  const enterprise = await withPlatformTransaction(async (transaction) =>
    new EnterpriseRepository(transaction).create({
      name: `${runKey}-manual-pending`,
      code: `${runKey}-manual-pending`,
      status: 'active',
    })
  );
  enterpriseIds.push(enterprise.id);
  const pending = await withTenantTransaction(enterprise.id, (transaction) =>
    new ReferralLeadRepository(transaction).createManualEntryLead({
      enterpriseId: enterprise.id,
      actorStaffId: null,
      actorUserId: null,
      name: '待派手工客户',
      phone: `17${String(Date.now()).slice(-9)}`,
    })
  );
  assert.equal(pending.lead.source, 'manual_entry');
  assert.equal(pending.lead.assignmentStatus, 'assignment_pending');
  assert.equal(pending.lead.assignmentErrorCode, 'designer_unavailable');
  assert.equal(pending.lead.assignedTo, null);
  assert.equal(pending.lead.measurerId, null);

  const designer = await createAssignmentStaff(enterprise.id, 'designer', 'manual-retry-designer');
  const measurer = await createAssignmentStaff(enterprise.id, 'measurer', 'manual-retry-measurer');
  const retried = await withTenantTransaction(enterprise.id, (transaction) =>
    new ReferralLeadRepository(transaction).retryLeadAssignment({
      leadId: pending.lead.id,
      reason: 'manual_entry_pool_ready',
    })
  );
  assert.equal(retried?.kind, 'assigned');
  assert.equal(retried?.lead.assignedTo, designer.id);
  assert.equal(retried?.lead.measurerId, measurer.id);
  assert.equal(retried?.lead.source, 'manual_entry');
});

function nextBookableSlot(hour: string) {
  const localToday = localDateInTimeZone(new Date(), 'Asia/Shanghai');
  const date = new Date(`${localToday}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  const localDate = date.toISOString().slice(0, 10);
  const startAt = zonedDateTimeToUtc(localDate, hour, 'Asia/Shanghai');
  return { startAt, endAt: new Date(startAt.getTime() + 120 * 60_000) };
}

test('manual reassign rewrites the active appointment and rejects a busy measurer', async () => {
  const enterprise = await withPlatformTransaction(async (transaction) =>
    new EnterpriseRepository(transaction).create({
      name: `${runKey}-reassign-appt`,
      code: `${runKey}-reassign-appt`,
      status: 'active',
    })
  );
  enterpriseIds.push(enterprise.id);
  const actor = await createCustomer('reassign-appt-actor');
  const designer = await createAssignmentStaff(enterprise.id, 'designer', 'reassign-designer-a');
  const designerB = await createAssignmentStaff(enterprise.id, 'designer', 'reassign-designer-b');
  const measurerA = await createAssignmentStaff(enterprise.id, 'measurer', 'reassign-measurer-a');
  const measurerB = await createAssignmentStaff(enterprise.id, 'measurer', 'reassign-measurer-b');
  const measurerC = await createAssignmentStaff(enterprise.id, 'measurer', 'reassign-measurer-c');

  const [leadA, leadB] = await withTenantTransaction(enterprise.id, async (transaction) => {
    const leadsRepo = new LeadRepository(transaction);
    const first = await leadsRepo.create({
      enterpriseId: enterprise.id,
      assignedTo: designer.id,
      measurerId: measurerA.id,
      customerUserId: actor.id,
      name: '改派预约客户甲',
      phone: `17${String(Date.now()).slice(-9)}`,
      source: 'reassign-test',
      assignmentStatus: 'assigned',
    });
    const second = await leadsRepo.create({
      enterpriseId: enterprise.id,
      assignedTo: designer.id,
      measurerId: measurerB.id,
      customerUserId: actor.id,
      name: '改派预约客户乙',
      phone: `18${String(Date.now()).slice(-9)}`,
      source: 'reassign-test',
      assignmentStatus: 'assigned',
    });
    return [first, second];
  });

  const slot = nextBookableSlot('10:00');
  const original = await withTenantTransaction(enterprise.id, (transaction) =>
    new AppointmentRepository(transaction).create({
      enterpriseId: enterprise.id,
      leadId: leadA.id,
      startAt: slot.startAt,
      endAt: slot.endAt,
      address: '改派测试小区 1 号',
      actorUserId: actor.id,
      eventKey: `${runKey}-reassign-create-a`,
    })
  );
  await withTenantTransaction(enterprise.id, (transaction) =>
    new AppointmentRepository(transaction).create({
      enterpriseId: enterprise.id,
      leadId: leadB.id,
      startAt: slot.startAt,
      endAt: slot.endAt,
      address: '改派测试小区 2 号',
      actorUserId: actor.id,
      eventKey: `${runKey}-reassign-create-b`,
    })
  );

  const designerRewrite = await withTenantTransaction(enterprise.id, (transaction) =>
    new ReferralLeadRepository(transaction).assignStaff({
      leadId: leadA.id,
      actorStaffId: designer.id,
      actorRole: 'enterprise_admin',
      designerId: designerB.id,
    })
  );
  assert.equal(designerRewrite?.lead.assignedTo, designerB.id);
  assert.equal(designerRewrite?.rewrittenAppointment?.designerId, designerB.id);
  assert.equal(designerRewrite?.rewrittenAppointment?.measurerId, original.measurerId);
  assert.equal(designerRewrite?.rewrittenAppointment?.version, original.version + 1);

  await assert.rejects(
    () =>
      withTenantTransaction(enterprise.id, (transaction) =>
        new ReferralLeadRepository(transaction).assignStaff({
          leadId: leadA.id,
          actorStaffId: designerB.id,
          actorRole: 'enterprise_admin',
          measurerId: measurerB.id,
        })
      ),
    /新测量员该时段不可用/
  );

  const measurerRewrite = await withTenantTransaction(enterprise.id, (transaction) =>
    new ReferralLeadRepository(transaction).assignStaff({
      leadId: leadA.id,
      actorStaffId: designerB.id,
      actorRole: 'enterprise_admin',
      measurerId: measurerC.id,
    })
  );
  assert.equal(measurerRewrite?.lead.measurerId, measurerC.id);
  assert.equal(measurerRewrite?.rewrittenAppointment?.measurerId, measurerC.id);
  assert.equal(measurerRewrite?.rewrittenAppointment?.designerId, designerB.id);

  const events = await withTenantTransaction(enterprise.id, (transaction) =>
    transaction
      .select()
      .from(measurementAppointmentEvents)
      .where(eq(measurementAppointmentEvents.appointmentId, original.id))
  );
  assert.ok(events.some((event) => event.eventType === 'staff_reassigned'));
});

test('claim window concurrency, deadline fallback, capacity and outcome snapshots stay transactional', async () => {
  const enterprise = await withPlatformTransaction((transaction) =>
    new EnterpriseRepository(transaction).create({
      name: `${runKey}-claim-racing`, code: `${runKey}-claim-racing`, status: 'active',
    })
  );
  enterpriseIds.push(enterprise.id);
  const designerA = await createAssignmentStaff(enterprise.id, 'designer', 'claim-racing-a');
  const designerB = await createAssignmentStaff(enterprise.id, 'designer', 'claim-racing-b');
  await createAssignmentStaff(enterprise.id, 'measurer', 'claim-racing-measurer');
  await withTenantTransaction(enterprise.id, (transaction) =>
    new AssignmentRacingRepository(transaction).createSettingsVersion({
      enterpriseId: enterprise.id,
      actorStaffId: null,
      claimEnabled: true,
      claimDurationSeconds: 5,
      highPerformanceTrafficPercent: 70,
      performanceRateThresholdPercent: 30,
      performanceWindowDays: 180,
      minimumEffectiveSamples: 10,
      defaultDesignerCapacity: 1,
    })
  );

  const source = await createSource(enterprise.id, 'claim-racing');
  const firstCustomer = await createCustomer('claim-racing-first');
  const created = await withPlatformTransaction((transaction) =>
    new ReferralLeadRepository(transaction).authorizeAndCreateLead({
      source, customerUserId: firstCustomer.id, idempotencyKeyHash: `${runKey}-claim-racing-create`,
    })
  );
  assert.equal(created.lead.assignmentStatus, 'claim_open');
  assert.equal(created.lead.assignedTo, null);

  const [left, right] = await Promise.all([
    withTenantTransaction(enterprise.id, (transaction) =>
      new AssignmentRacingRepository(transaction).claimLead({
        leadId: created.lead.id, designerId: designerA.id, actorUserId: null,
        idempotencyKeyHash: hashClaimIdempotencyKey('race-a'),
      })
    ),
    withTenantTransaction(enterprise.id, (transaction) =>
      new AssignmentRacingRepository(transaction).claimLead({
        leadId: created.lead.id, designerId: designerB.id, actorUserId: null,
        idempotencyKeyHash: hashClaimIdempotencyKey('race-b'),
      })
    ),
  ]);
  assert.equal([left.kind, right.kind].filter((kind) => kind === 'claimed').length, 1);
  assert.equal([left.kind, right.kind].filter((kind) => kind === 'already_claimed').length, 1);
  const winnerId = left.kind === 'claimed' ? designerA.id : designerB.id;
  const capacityState = await withTenantTransaction(enterprise.id, async (transaction) => {
    const repository = new AssignmentRacingRepository(transaction);
    const settings = await repository.getCurrentSettings(enterprise.id);
    return repository.listDesignerPerformance(enterprise.id, settings || undefined);
  });
  const winnerCapacity = capacityState.find((item) => item.staff.id === winnerId);
  assert.equal(winnerCapacity?.openLeadCount, 1);
  assert.equal(winnerCapacity?.capacity, 1);
  assert.equal(winnerCapacity?.eligibleForAssignment, false);
  const crossTenantWindows = await withTenantTransaction(enterpriseIds[0], (transaction) =>
    transaction.select().from(leadClaimWindows).where(eq(leadClaimWindows.enterpriseId, enterprise.id))
  );
  assert.deepEqual(crossTenantWindows, []);

  const closed = await withTenantTransaction(enterprise.id, (transaction) =>
    new LeadLifecycleRepository(transaction).closeLost({
      leadId: created.lead.id,
      actorId: winnerId,
      reason: 'budget_mismatch',
      performanceEligible: true,
    })
  );
  assert.equal(closed?.status, 'closed');
  const snapshot = await withTenantTransaction(enterprise.id, async (transaction) =>
    (await transaction.select().from(leadOutcomeSnapshots).where(eq(leadOutcomeSnapshots.leadId, created.lead.id)))[0]
  );
  assert.equal(snapshot.designerId, winnerId);
  assert.equal(snapshot.performanceEligible, true);

  const secondCustomer = await createCustomer('claim-racing-expired');
  const second = await withPlatformTransaction((transaction) =>
    new ReferralLeadRepository(transaction).authorizeAndCreateLead({
      source, customerUserId: secondCustomer.id, idempotencyKeyHash: `${runKey}-claim-racing-expired`,
    })
  );
  const window = await withTenantTransaction(enterprise.id, async (transaction) =>
    (await transaction.select().from(leadClaimWindows).where(eq(leadClaimWindows.leadId, second.lead.id)))[0]
  );
  assert.equal((window.ruleSnapshot as { claimDurationSeconds?: number }).claimDurationSeconds, 5);
  const expired = await withTenantTransaction(enterprise.id, (transaction) =>
    new AssignmentRacingRepository(transaction).claimLead({
      leadId: second.lead.id,
      designerId: designerA.id,
      actorUserId: null,
      idempotencyKeyHash: hashClaimIdempotencyKey('expired'),
      now: window.expiresAt,
    })
  );
  assert.equal(expired.kind, 'expired');
  const resolvedWindow = await withTenantTransaction(enterprise.id, async (transaction) =>
    (await transaction.select().from(leadClaimWindows).where(eq(leadClaimWindows.id, window.id)))[0]
  );
  assert.notEqual(resolvedWindow.status, 'open');

  const thirdCustomer = await createCustomer('claim-racing-closed-window');
  const third = await withPlatformTransaction((transaction) =>
    new ReferralLeadRepository(transaction).authorizeAndCreateLead({
      source, customerUserId: thirdCustomer.id, idempotencyKeyHash: `${runKey}-claim-racing-closed-window`,
    })
  );
  await withTenantTransaction(enterprise.id, (transaction) =>
    new LeadLifecycleRepository(transaction).closeLost({
      leadId: third.lead.id,
      actorId: designerA.id,
      reason: 'invalid_contact',
      performanceEligible: false,
    })
  );
  const closedWindow = await withTenantTransaction(enterprise.id, async (transaction) =>
    (await transaction.select().from(leadClaimWindows).where(eq(leadClaimWindows.leadId, third.lead.id)))[0]
  );
  assert.equal(closedWindow.status, 'cancelled');
  assert.equal(closedWindow.resolutionReason, 'lead_closed_lost');
  const claimAfterClose = await withTenantTransaction(enterprise.id, (transaction) =>
    new AssignmentRacingRepository(transaction).claimLead({
      leadId: third.lead.id,
      designerId: designerB.id,
      actorUserId: null,
      idempotencyKeyHash: hashClaimIdempotencyKey('closed-window'),
    })
  );
  assert.equal(claimAfterClose.kind, 'not_assignable');
  const reopened = await withTenantTransaction(enterprise.id, (transaction) =>
    new LeadLifecycleRepository(transaction).reopenLost({
      leadId: third.lead.id,
      actorId: designerA.id,
    })
  );
  assert.equal(reopened?.status, 'new');
  assert.equal(reopened?.assignmentStatus, 'assignment_pending');
});
