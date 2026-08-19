import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { loadEnvConfig } from '@next/env';
import { eq, inArray } from 'drizzle-orm';
import {
  adminUsers,
  enterpriseJoinCodeEvents,
  enterpriseJoinCodes,
  enterprises,
  promotionScanAudits,
  referrerEnterpriseMemberships,
  referrerProfiles,
  referrerPromotionCodes,
  users,
} from '@/db/schema';
import {
  AdminUserRepository,
  EnterpriseRepository,
  ReferrerNetworkRepository,
  hashReferrerNetworkToken,
} from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import {
  closePostgresPool,
  resolvePostgresRuntimeConfig,
} from '@/lib/postgresql';

const runKey = `referrer-network-${process.pid}-${Date.now()}`;
const enterpriseIds: bigint[] = [];
const actorIds: bigint[] = [];
const userIds: bigint[] = [];

before(async () => {
  loadEnvConfig(process.cwd());
  const url = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(
    ['localhost', '127.0.0.1'].includes(url.hostname),
    'Referrer network integration tests only mutate the local database'
  );

  await withPlatformTransaction(async (transaction) => {
    const enterpriseRepository = new EnterpriseRepository(transaction);
    const adminRepository = new AdminUserRepository(transaction);
    for (const suffix of ['a', 'b', 'c', 'd']) {
      const enterprise = await enterpriseRepository.create({
        name: `${runKey}-${suffix}`,
        code: `${runKey}-${suffix}`,
      });
      enterpriseIds.push(enterprise.id);
      const actor = await adminRepository.create({
        enterpriseId: enterprise.id,
        username: `${runKey}-actor-${suffix}`,
        passwordHash: 'test-hash',
        displayName: `Actor ${suffix}`,
        role: 'enterprise_admin',
        menuPermissions: ['dashboard'],
      });
      actorIds.push(actor.id);
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
        .delete(enterpriseJoinCodeEvents)
        .where(inArray(enterpriseJoinCodeEvents.enterpriseId, enterpriseIds));
      await transaction
        .delete(referrerPromotionCodes)
        .where(inArray(referrerPromotionCodes.enterpriseId, enterpriseIds));
      await transaction
        .delete(referrerEnterpriseMemberships)
        .where(inArray(referrerEnterpriseMemberships.enterpriseId, enterpriseIds));
      for (const userId of userIds) {
        await transaction
          .delete(referrerProfiles)
          .where(eq(referrerProfiles.userId, userId));
      }
      await transaction
        .delete(enterpriseJoinCodes)
        .where(inArray(enterpriseJoinCodes.enterpriseId, enterpriseIds));
      await transaction
        .delete(adminUsers)
        .where(inArray(adminUsers.enterpriseId, enterpriseIds));
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

test('enterprise join codes rotate, disable, and enforce code types', async () => {
  await withPlatformTransaction(async (transaction) => {
    const repository = new ReferrerNetworkRepository(transaction);
    const first = await repository.rotateEnterpriseJoinCode({
      enterpriseId: enterpriseIds[0],
      codeType: 'staff',
      actorStaffId: actorIds[0],
    });
    assert.match(first.token, /^ej_[A-Za-z0-9_-]{32}$/);
    assert.equal(
      first.code.tokenHash,
      hashReferrerNetworkToken(first.token)
    );
    assert.equal(
      (await repository.resolveEnterpriseJoinToken(first.token)).result,
      'ok'
    );

    const second = await repository.rotateEnterpriseJoinCode({
      enterpriseId: enterpriseIds[0],
      codeType: 'staff',
      actorStaffId: actorIds[0],
    });
    assert.equal(second.code.version, 2);
    assert.equal(
      (await repository.resolveEnterpriseJoinToken(first.token)).result,
      'code_rotated'
    );
    assert.equal(
      (await repository.resolveEnterpriseJoinToken(second.token)).result,
      'ok'
    );
    const revealed = await repository.revealActiveEnterpriseJoinCode({
      enterpriseId: enterpriseIds[0],
      codeType: 'staff',
      actorStaffId: actorIds[0],
    });
    assert.equal(revealed?.token, second.token);
    assert.equal(
      (await repository.listEnterpriseJoinCodeEvents(enterpriseIds[0]))[0]?.event.result,
      'token_revealed'
    );
    assert.equal(await repository.countActiveReferrerMemberships(enterpriseIds[0]), 0);

    const referrerCode = await repository.rotateEnterpriseJoinCode({
      enterpriseId: enterpriseIds[0],
      codeType: 'referrer',
      actorStaffId: actorIds[0],
    });
    const userRows = await transaction
      .insert(users)
      .values({ phone: `138${Date.now().toString().slice(-8)}` })
      .returning();
    userIds.push(userRows[0].id);
    const rejected = await repository.onboardStaff({
      token: referrerCode.token,
      userId: userRows[0].id,
      contextVersion: 1,
      role: 'designer',
      displayName: 'Wrong type',
      menuPermissions: [],
      passwordHash: 'test-hash',
    });
    assert.deepEqual(rejected, { ok: false, code: 'code_type_mismatch' });

    const disabled = await repository.disableEnterpriseJoinCode({
      enterpriseId: enterpriseIds[0],
      codeType: 'staff',
      actorStaffId: actorIds[0],
    });
    assert.equal(disabled?.status, 'disabled');
    assert.equal(
      (await repository.resolveEnterpriseJoinToken(second.token)).result,
      'code_disabled'
    );
  });
});

test('staff onboarding is idempotent but cannot overwrite its enterprise', async () => {
  await withPlatformTransaction(async (transaction) => {
    const repository = new ReferrerNetworkRepository(transaction);
    const codeA = await repository.rotateEnterpriseJoinCode({
      enterpriseId: enterpriseIds[0],
      codeType: 'staff',
      actorStaffId: actorIds[0],
    });
    const codeB = await repository.rotateEnterpriseJoinCode({
      enterpriseId: enterpriseIds[1],
      codeType: 'staff',
      actorStaffId: actorIds[1],
    });
    const userRows = await transaction
      .insert(users)
      .values({ phone: `139${Date.now().toString().slice(-8)}` })
      .returning();
    userIds.push(userRows[0].id);

    const joined = await repository.onboardStaff({
      token: codeA.token,
      userId: userRows[0].id,
      contextVersion: 1,
      role: 'measurer',
      displayName: 'Test measurer',
      menuPermissions: ['dashboard'],
      passwordHash: 'test-hash',
    });
    assert.equal(joined.ok, true);
    if (!joined.ok) return;
    assert.equal(joined.staff.enterpriseId, enterpriseIds[0]);
    assert.equal(joined.user.contextVersion, 2);

    const duplicate = await repository.onboardStaff({
      token: codeA.token,
      userId: userRows[0].id,
      contextVersion: 2,
      role: 'measurer',
      displayName: 'Ignored',
      menuPermissions: [],
      passwordHash: 'ignored',
    });
    assert.equal(duplicate.ok && duplicate.idempotent, true);

    const conflict = await repository.onboardStaff({
      token: codeB.token,
      userId: userRows[0].id,
      contextVersion: 2,
      role: 'measurer',
      displayName: 'Other enterprise',
      menuPermissions: [],
      passwordHash: 'test-hash',
    });
    assert.deepEqual(conflict, {
      ok: false,
      code: 'staff_enterprise_conflict',
    });
  });
});

test('referrer memberships cap at three and exit disables the promotion token', async () => {
  const promotionTokens: string[] = [];
  await withPlatformTransaction(async (transaction) => {
    const repository = new ReferrerNetworkRepository(transaction);
    const joinCodes = [];
    for (let index = 0; index < enterpriseIds.length; index += 1) {
      joinCodes.push(
        await repository.rotateEnterpriseJoinCode({
          enterpriseId: enterpriseIds[index],
          codeType: 'referrer',
          actorStaffId: actorIds[index],
        })
      );
    }
    const userPhone = `137${Date.now().toString().slice(-8)}`;
    const userRows = await transaction
      .insert(users)
      .values({ phone: userPhone })
      .returning();
    const userId = userRows[0].id;
    userIds.push(userId);

    let contextVersion = 1;
    const memberships: bigint[] = [];
    for (let index = 0; index < 3; index += 1) {
      const joined = await repository.onboardReferrer({
        token: joinCodes[index].token,
        userId,
        contextVersion,
        displayName: 'Test referrer',
        membershipLimit: 3,
      });
      assert.equal(joined.ok, true);
      if (!joined.ok) continue;
      contextVersion = joined.user.contextVersion;
      memberships.push(joined.membership.id);
      const promotion = await repository.getReferrerPromotionCode(
        userId,
        joined.membership.id
      );
      assert.ok(promotion);
      assert.equal(
        promotion?.token,
        await repository
          .getReferrerPromotionCode(userId, joined.membership.id)
          .then((row) => row?.token)
      );
      promotionTokens.push(promotion!.token);
    }
    assert.equal(contextVersion, 4);
    assert.equal((await repository.listReferrerMemberships(userId)).length, 3);
    const roster = await repository.listEnterpriseReferrerMemberships(enterpriseIds[0]);
    assert.equal(roster.length, 1);
    assert.equal(roster[0].displayName, 'Test referrer');
    assert.equal(roster[0].phone, userPhone);
    const renamed = await repository.onboardReferrer({
      token: joinCodes[0].token,
      userId,
      contextVersion,
      displayName: 'Renamed Referrer',
      membershipLimit: 3,
    });
    assert.equal(renamed.ok, true);
    if (renamed.ok) {
      assert.equal(renamed.idempotent, true);
      assert.equal(renamed.user.nickname, 'Renamed Referrer');
    }
    assert.equal(
      (await repository.listEnterpriseReferrerMemberships(enterpriseIds[0]))[0]?.displayName,
      'Renamed Referrer'
    );
    assert.equal(
      (await repository.listEnterpriseReferrerMemberships(enterpriseIds[0], { query: userPhone.slice(-4) })).length,
      1
    );
    assert.equal(
      (await repository.listEnterpriseReferrerMemberships(enterpriseIds[0], { query: 'nomatch-referrer' })).length,
      0
    );
    assert.equal(
      await repository.countActiveReferrerPromotionCodes(enterpriseIds[1]),
      1
    );

    const limited = await repository.onboardReferrer({
      token: joinCodes[3].token,
      userId,
      contextVersion,
      displayName: 'Test referrer',
      membershipLimit: 3,
    });
    assert.deepEqual(limited, {
      ok: false,
      code: 'membership_limit_reached',
    });

    const exited = await repository.exitReferrerMembership({
      userId,
      contextVersion,
      membershipId: memberships[1],
    });
    assert.ok(exited);
    assert.equal(exited?.membership.status, 'exited');
    assert.equal(exited?.user.contextVersion, 5);
    assert.equal(
      (await repository.resolvePromotionToken({ token: promotionTokens[1] }))
        .result,
      'code_disabled'
    );
    assert.equal(
      await repository.countActiveReferrerPromotionCodes(enterpriseIds[1]),
      0
    );

    const replacement = await repository.onboardReferrer({
      token: joinCodes[3].token,
      userId,
      contextVersion: 5,
      displayName: 'Test referrer',
      membershipLimit: 3,
    });
    assert.equal(replacement.ok, true);
    if (replacement.ok) assert.equal(replacement.user.contextVersion, 6);
    assert.equal(
      await repository.countActiveReferrerPromotionCodes(enterpriseIds[3]),
      1
    );
    const history = await repository.listReferrerMemberships(userId);
    assert.equal(history.filter((row) => row.membership.status === 'active').length, 3);
    assert.equal(history.filter((row) => row.membership.status === 'exited').length, 1);
  });
});
