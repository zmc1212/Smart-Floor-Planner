import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { loadEnvConfig } from '@next/env';
import { eq, inArray } from 'drizzle-orm';
import {
  adminUsers,
  platformEnterpriseRegistrationCodeEvents,
  platformEnterpriseRegistrationCodes,
} from '@/db/schema';
import {
  AdminUserRepository,
  EnterpriseRegistrationCodeRepository,
  hashEnterpriseRegistrationToken,
} from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import {
  closePostgresPool,
  resolvePostgresRuntimeConfig,
} from '@/lib/postgresql';

const runKey = `enterprise-registration-${process.pid}-${Date.now()}`;
let actorId: bigint | null = null;
const codeIds: bigint[] = [];

before(async () => {
  loadEnvConfig(process.cwd());
  const url = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(
    ['localhost', '127.0.0.1'].includes(url.hostname),
    'Enterprise registration code tests only mutate the local database'
  );

  await withPlatformTransaction(async (transaction) => {
    await transaction.delete(platformEnterpriseRegistrationCodeEvents);
    await transaction.delete(platformEnterpriseRegistrationCodes);
    const adminRepository = new AdminUserRepository(transaction);
    const actor = await adminRepository.create({
      enterpriseId: null,
      username: `${runKey}-actor`,
      passwordHash: 'test-hash',
      displayName: 'Platform actor',
      role: 'super_admin',
      menuPermissions: ['enterprises'],
    });
    actorId = actor.id;
  });
});

after(async () => {
  await withPlatformTransaction(async (transaction) => {
    if (codeIds.length) {
      await transaction
        .delete(platformEnterpriseRegistrationCodeEvents)
        .where(
          inArray(
            platformEnterpriseRegistrationCodeEvents.registrationCodeId,
            codeIds
          )
        );
      await transaction
        .delete(platformEnterpriseRegistrationCodes)
        .where(inArray(platformEnterpriseRegistrationCodes.id, codeIds));
    }
    if (actorId) {
      await transaction.delete(adminUsers).where(eq(adminUsers.id, actorId));
    }
  });
  await closePostgresPool();
});

test('platform enterprise registration codes rotate, reveal, disable, and resolve', async () => {
  assert.ok(actorId);
  await withPlatformTransaction(async (transaction) => {
    const repository = new EnterpriseRegistrationCodeRepository(transaction);
    const first = await repository.rotate({
      actorStaffId: actorId!,
    });
    codeIds.push(first.code.id);
    assert.match(first.token, /^er_[A-Za-z0-9_-]{32}$/);
    assert.equal(
      first.code.tokenHash,
      hashEnterpriseRegistrationToken(first.token)
    );
    assert.equal((await repository.resolve(first.token)).result, 'ok');

    const second = await repository.rotate({
      actorStaffId: actorId!,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    codeIds.push(second.code.id);
    assert.equal(second.code.version, first.code.version + 1);
    assert.equal((await repository.resolve(first.token)).result, 'code_rotated');
    assert.equal((await repository.resolve(second.token)).result, 'ok');

    const revealed = await repository.revealActive({
      actorStaffId: actorId!,
    });
    assert.equal(revealed?.token, second.token);
    assert.equal((await repository.listEvents())[0]?.result, 'token_revealed');

    const active = await repository.getActiveCode();
    assert.equal(active?.id, second.code.id);
    assert.equal(active?.status, 'active');

    const disabled = await repository.disable({
      actorStaffId: actorId!,
    });
    assert.equal(disabled?.status, 'disabled');
    assert.equal(
      (await repository.resolve(second.token)).result,
      'code_disabled'
    );
    assert.equal(await repository.getActiveCode(), null);
  });
});
