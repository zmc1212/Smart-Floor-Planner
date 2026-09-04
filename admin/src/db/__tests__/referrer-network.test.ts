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
  staffActivityCodes,
  users,
} from '@/db/schema';
import {
  AdminUserRepository,
  EnterpriseRepository,
  ReferrerNetworkRepository,
  createReferrerPromotionToken,
  createStaffActivityToken,
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
        .delete(staffActivityCodes)
        .where(inArray(staffActivityCodes.enterpriseId, enterpriseIds));
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

test('personal referrer codes preserve the first inviter and build the complete employee network', async () => {
  await withPlatformTransaction(async (transaction) => {
    const adminRepository = new AdminUserRepository(transaction);
    const repository = new ReferrerNetworkRepository(transaction);
    const designer = await adminRepository.create({
      enterpriseId: enterpriseIds[0],
      username: `${runKey}-personal-designer`,
      passwordHash: 'test-hash',
      displayName: 'Personal designer',
      role: 'designer',
      menuPermissions: ['dashboard'],
    });
    const measurer = await adminRepository.create({
      enterpriseId: enterpriseIds[0],
      username: `${runKey}-personal-measurer`,
      passwordHash: 'test-hash',
      displayName: 'Personal measurer',
      role: 'measurer',
      menuPermissions: ['dashboard'],
    });

    const designerCode = await repository.rotateEnterpriseJoinCode({
      enterpriseId: enterpriseIds[0],
      codeType: 'referrer',
      actorStaffId: designer.id,
      inviterStaffId: designer.id,
    });
    const measurerCode = await repository.rotateEnterpriseJoinCode({
      enterpriseId: enterpriseIds[0],
      codeType: 'referrer',
      actorStaffId: measurer.id,
      inviterStaffId: measurer.id,
    });
    assert.notEqual(designerCode.token, measurerCode.token);
    assert.equal(designerCode.code.inviterStaffId, designer.id);
    assert.equal(measurerCode.code.inviterStaffId, measurer.id);

    const designerScopedCodes = await repository.listEnterpriseJoinCodes(
      enterpriseIds[0],
      { referrerInviterStaffId: designer.id }
    );
    assert.deepEqual(
      designerScopedCodes
        .filter((row) => row.codeType === 'referrer')
        .map((row) => row.inviterStaffId),
      [designer.id]
    );
    const legacyScopedCodes = await repository.listEnterpriseJoinCodes(
      enterpriseIds[0],
      { referrerInviterStaffId: null }
    );
    assert.ok(
      legacyScopedCodes
        .filter((row) => row.codeType === 'referrer')
        .every((row) => row.inviterStaffId === null)
    );

    const [user] = await transaction
      .insert(users)
      .values({ phone: `131${Date.now().toString().slice(-8)}` })
      .returning();
    userIds.push(user.id);
    const joined = await repository.onboardReferrer({
      token: designerCode.token,
      userId: user.id,
      contextVersion: user.contextVersion,
      displayName: 'Personal invitee',
      membershipLimit: 3,
    });
    assert.equal(joined.ok, true);
    if (!joined.ok) return;
    assert.equal(joined.membership.invitedByStaffId, designer.id);
    assert.equal(joined.membership.invitedByNameSnapshot, designer.displayName);

    const repeated = await repository.onboardReferrer({
      token: measurerCode.token,
      userId: user.id,
      contextVersion: joined.user.contextVersion,
      displayName: 'Personal invitee',
      membershipLimit: 3,
    });
    assert.equal(repeated.ok && repeated.idempotent, true);
    if (repeated.ok) {
      assert.equal(repeated.membership.id, joined.membership.id);
      assert.equal(repeated.membership.invitedByStaffId, designer.id);
    }

    const [designerRoster, measurerRoster, network] = await Promise.all([
      repository.listEnterpriseReferrerMemberships(enterpriseIds[0], {
        inviterStaffId: designer.id,
      }),
      repository.listEnterpriseReferrerMemberships(enterpriseIds[0], {
        inviterStaffId: measurer.id,
      }),
      repository.listEnterpriseReferrerNetwork(enterpriseIds[0]),
    ]);
    assert.equal(designerRoster.length, 1);
    assert.equal(measurerRoster.length, 0);
    assert.equal(network.summary.total, 1);
    assert.equal(
      network.branches.find((branch) => branch.staff?.id === designer.id)?.total,
      1
    );
    assert.equal(
      network.branches.find((branch) => branch.staff?.id === measurer.id)?.total,
      0
    );

    await transaction
      .delete(referrerPromotionCodes)
      .where(eq(referrerPromotionCodes.membershipId, joined.membership.id));
    await transaction
      .delete(referrerEnterpriseMemberships)
      .where(eq(referrerEnterpriseMemberships.id, joined.membership.id));
    await transaction
      .delete(referrerProfiles)
      .where(eq(referrerProfiles.userId, user.id));
    await transaction
      .delete(enterpriseJoinCodes)
      .where(
        inArray(enterpriseJoinCodes.inviterStaffId, [designer.id, measurer.id])
      );
    await transaction
      .delete(adminUsers)
      .where(inArray(adminUsers.id, [designer.id, measurer.id]));
    await transaction.delete(users).where(eq(users.id, user.id));
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

test('service-code reads rotate active rows whose hash no longer matches the current secret', async () => {
  await withPlatformTransaction(async (transaction) => {
    const adminRepository = new AdminUserRepository(transaction);
    const repository = new ReferrerNetworkRepository(transaction);
    const [staffUser] = await transaction
      .insert(users)
      .values({ phone: `138${Date.now().toString().slice(-8)}` })
      .returning();
    userIds.push(staffUser.id);
    const staff = await adminRepository.create({
      enterpriseId: enterpriseIds[2],
      userId: staffUser.id,
      username: `${runKey}-activity-repair`,
      passwordHash: 'test-hash',
      displayName: 'Activity repair',
      role: 'measurer',
      menuPermissions: ['dashboard'],
    });

    const firstActivity = await repository.getStaffActivityCode(staffUser.id, staff.id);
    assert.ok(firstActivity);
    if (!firstActivity) return;
    await transaction
      .update(staffActivityCodes)
      .set({ tokenHash: `${runKey}-stale-activity` })
      .where(eq(staffActivityCodes.id, firstActivity.code.id));
    const repairedActivity = await repository.getStaffActivityCode(staffUser.id, staff.id);
    assert.ok(repairedActivity);
    assert.equal(repairedActivity?.code.version, firstActivity.code.version + 1);
    assert.equal(
      repairedActivity?.token,
      createStaffActivityToken(staff.id, repairedActivity!.code.version)
    );

    const joinCode = await repository.rotateEnterpriseJoinCode({
      enterpriseId: enterpriseIds[2],
      codeType: 'referrer',
      actorStaffId: actorIds[2],
    });
    const [referrerUser] = await transaction
      .insert(users)
      .values({ phone: `136${Date.now().toString().slice(-8)}` })
      .returning();
    userIds.push(referrerUser.id);
    const joined = await repository.onboardReferrer({
      token: joinCode.token,
      userId: referrerUser.id,
      contextVersion: referrerUser.contextVersion,
      displayName: 'Promotion repair',
      membershipLimit: 3,
    });
    assert.equal(joined.ok, true);
    if (!joined.ok) return;
    const firstPromotion = await repository.getReferrerPromotionCode(
      referrerUser.id,
      joined.membership.id
    );
    assert.ok(firstPromotion);
    if (!firstPromotion) return;
    await transaction
      .update(referrerPromotionCodes)
      .set({ tokenHash: `${runKey}-stale-promotion` })
      .where(eq(referrerPromotionCodes.id, firstPromotion.code.id));
    const repairedPromotion = await repository.getReferrerPromotionCode(
      referrerUser.id,
      joined.membership.id
    );
    assert.ok(repairedPromotion);
    assert.equal(repairedPromotion?.code.version, firstPromotion.code.version + 1);
    assert.equal(
      repairedPromotion?.token,
      createReferrerPromotionToken(joined.membership.id, repairedPromotion!.code.version)
    );
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

test('referrer onboarding enforces global N and the strictest enterprise M', async () => {
  await withPlatformTransaction(async (transaction) => {
    const enterpriseRepository = new EnterpriseRepository(transaction);
    const adminRepository = new AdminUserRepository(transaction);
    const created: Array<{ enterpriseId: bigint; actorId: bigint }> = [];
    for (const suffix of ['p0', 'p1', 'p2', 'p3', 'p4', 'p5']) {
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
      created.push({ enterpriseId: enterprise.id, actorId: actor.id });
    }

    const [exclusive, roomForOne, secondProtected, extra, openA, openB] = created;
    await transaction
      .update(enterprises)
      .set({ referrerAdditionalEnterpriseLimit: 0 })
      .where(eq(enterprises.id, exclusive.enterpriseId));
    await transaction
      .update(enterprises)
      .set({ referrerAdditionalEnterpriseLimit: 1 })
      .where(eq(enterprises.id, roomForOne.enterpriseId));
    await transaction
      .update(enterprises)
      .set({ referrerAdditionalEnterpriseLimit: 2 })
      .where(eq(enterprises.id, secondProtected.enterpriseId));

    const repository = new ReferrerNetworkRepository(transaction);
    const codes = [];
    for (const item of created) {
      codes.push(
        await repository.rotateEnterpriseJoinCode({
          enterpriseId: item.enterpriseId,
          codeType: 'referrer',
          actorStaffId: item.actorId,
        })
      );
    }

    const exclusiveUser = await transaction
      .insert(users)
      .values({ phone: `136${Date.now().toString().slice(-8)}` })
      .returning();
    userIds.push(exclusiveUser[0].id);
    const exclusiveJoin = await repository.onboardReferrer({
      token: codes[0].token,
      userId: exclusiveUser[0].id,
      contextVersion: 1,
      displayName: 'Exclusive referrer',
      membershipLimit: 3,
    });
    assert.equal(exclusiveJoin.ok, true);
    const exclusiveBlocked = await repository.onboardReferrer({
      token: codes[3].token,
      userId: exclusiveUser[0].id,
      contextVersion: exclusiveJoin.ok ? exclusiveJoin.user.contextVersion : 1,
      displayName: 'Exclusive referrer',
      membershipLimit: 3,
    });
    assert.deepEqual(exclusiveBlocked, {
      ok: false,
      code: 'referrer_protection_limit',
    });
    const exclusiveAgain = await repository.onboardReferrer({
      token: codes[0].token,
      userId: exclusiveUser[0].id,
      contextVersion: exclusiveJoin.ok ? exclusiveJoin.user.contextVersion : 1,
      displayName: 'Exclusive referrer',
      membershipLimit: 3,
    });
    assert.equal(exclusiveAgain.ok && exclusiveAgain.idempotent, true);

    const limitedUser = await transaction
      .insert(users)
      .values({ phone: `135${Date.now().toString().slice(-8)}` })
      .returning();
    userIds.push(limitedUser[0].id);
    const first = await repository.onboardReferrer({
      token: codes[1].token,
      userId: limitedUser[0].id,
      contextVersion: 1,
      displayName: 'Limited referrer',
      membershipLimit: 3,
    });
    assert.equal(first.ok, true);
    const second = await repository.onboardReferrer({
      token: codes[2].token,
      userId: limitedUser[0].id,
      contextVersion: first.ok ? first.user.contextVersion : 1,
      displayName: 'Limited referrer',
      membershipLimit: 3,
    });
    assert.equal(second.ok, true);
    const third = await repository.onboardReferrer({
      token: codes[3].token,
      userId: limitedUser[0].id,
      contextVersion: second.ok ? second.user.contextVersion : 1,
      displayName: 'Limited referrer',
      membershipLimit: 3,
    });
    assert.deepEqual(third, {
      ok: false,
      code: 'referrer_protection_limit',
    });

    const overLimitUser = await transaction
      .insert(users)
      .values({ phone: `134${Date.now().toString().slice(-8)}` })
      .returning();
    userIds.push(overLimitUser[0].id);
    let contextVersion = 1;
    for (const item of [extra, openA, openB]) {
      const joined = await repository.onboardReferrer({
        token: codes[created.indexOf(item)].token,
        userId: overLimitUser[0].id,
        contextVersion,
        displayName: 'Over-limit referrer',
        membershipLimit: 3,
      });
      assert.equal(joined.ok, true);
      if (joined.ok) contextVersion = joined.user.contextVersion;
    }
    const blockedByGlobal = await repository.onboardReferrer({
      token: codes[0].token,
      userId: overLimitUser[0].id,
      contextVersion,
      displayName: 'Over-limit referrer',
      membershipLimit: 2,
    });
    assert.deepEqual(blockedByGlobal, {
      ok: false,
      code: 'membership_limit_reached',
    });
    await transaction
      .update(enterprises)
      .set({ referrerAdditionalEnterpriseLimit: 0 })
      .where(eq(enterprises.id, extra.enterpriseId));
    const blockedByTightenedM = await repository.onboardReferrer({
      token: codes[0].token,
      userId: overLimitUser[0].id,
      contextVersion,
      displayName: 'Over-limit referrer',
      membershipLimit: 10,
    });
    assert.deepEqual(blockedByTightenedM, {
      ok: false,
      code: 'referrer_protection_limit',
    });
    const stillActive = (await repository.listReferrerMemberships(
      overLimitUser[0].id
    )).filter((row) => row.membership.status === 'active');
    assert.equal(stillActive.length, 3);
  });
});
