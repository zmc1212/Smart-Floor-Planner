import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { loadEnvConfig } from '@next/env';
import { eq, inArray, isNull } from 'drizzle-orm';
import {
  adminUsers,
  customerAttributionLocks,
  enterprises,
  leadAssignmentEvents,
  leads,
  mediaAssets,
  promotionScanAudits,
  referrerEnterpriseMemberships,
  referrerProfiles,
  referrerPromotionCodes,
  users,
} from '@/db/schema';
import {
  AdminUserRepository,
  AiCreationRepository,
  EnterpriseRepository,
  LeadRepository,
  ReferralLeadRepository,
  ReferrerNetworkRepository,
} from '@/db/repositories';
import {
  withPlatformTransaction,
  withTenantTransaction,
} from '@/db/transaction';
import {
  closePostgresPool,
  resolvePostgresRuntimeConfig,
} from '@/lib/postgresql';

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
  suffix: string
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
        .delete(leads)
        .where(inArray(leads.enterpriseId, enterpriseIds));
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
    'designer_and_measurer_unavailable'
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
