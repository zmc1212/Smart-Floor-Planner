import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { loadEnvConfig } from '@next/env';
import { eq } from 'drizzle-orm';
import { AiProviderConfigRepository, type NewAiProviderConfig } from '@/db/repositories';
import { platformConfigs } from '@/db/schema';
import { withPlatformTransaction, type PostgresTransaction } from '@/db/transaction';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';

const runKey = `provider-environment-${process.pid}-${Date.now()}`;
const rollback = new Error('Roll back test fixtures');

before(() => {
  loadEnvConfig(process.cwd());
  assert.ok(['localhost', '127.0.0.1'].includes(
    new URL(resolvePostgresRuntimeConfig().connectionString).hostname,
  ), 'Provider integration tests only use the local database');
});
after(closePostgresPool);

function provider(suffix: string): NewAiProviderConfig {
  return {
    key: `${runKey}-${suffix}`,
    name: 'Environment provider regression fixture',
    adapterType: 'pollinations',
    baseUrl: 'https://example.invalid',
    apiKeyEncrypted: '',
    apiKeyMasked: '',
  };
}

async function inRollbackTransaction(check: (transaction: PostgresTransaction) => Promise<void>) {
  await assert.rejects(withPlatformTransaction(async (transaction) => {
    await check(transaction);
    throw rollback;
  }), (error) => error === rollback);
}

test('environment initialization preserves edits and does not recreate a deleted provider', async () => {
  await inRollbackTransaction(async (transaction) => {
    const repository = new AiProviderConfigRepository(transaction);
    const input = provider('single');
    const initial = await repository.initializeFromEnvironment(input);
    assert.ok(initial);
    await repository.update(initial.id, { enabled: false, name: 'Edited provider' });
    const repeated = await repository.initializeFromEnvironment(input);
    assert.equal(repeated?.id, initial.id);
    assert.equal(repeated?.enabled, false);
    assert.equal(repeated?.name, 'Edited provider');
    assert.equal((await repository.delete(initial.id))?.id, initial.id);
    // A new repository instance cannot lose the durable initialization marker.
    assert.equal(await new AiProviderConfigRepository(transaction).initializeFromEnvironment(input), null);
    assert.equal(await repository.findByKey(input.key), null);
    // Explicit Admin creation remains possible after deletion.
    assert.ok(await repository.create(input));
  });
});

test('single deletion before first initialization also prevents recreation', async () => {
  await inRollbackTransaction(async (transaction) => {
    const repository = new AiProviderConfigRepository(transaction);
    const input = provider('legacy');
    const existing = await repository.create(input);
    await repository.delete(existing.id);
    assert.equal(await repository.initializeFromEnvironment(input), null);
  });
});

test('bulk deletion preserves initialization markers for both seeded and legacy providers', async () => {
  await inRollbackTransaction(async (transaction) => {
    const repository = new AiProviderConfigRepository(transaction);
    const firstInput = provider('bulk-seeded');
    const secondInput = provider('bulk-legacy');
    const first = await repository.initializeFromEnvironment(firstInput);
    const second = await repository.create(secondInput);
    assert.ok(first);
    const deleted = await repository.deleteMany([first.id, second.id]);
    assert.equal(deleted.length, 2);
    assert.equal(await repository.initializeFromEnvironment(firstInput), null);
    assert.equal(await repository.initializeFromEnvironment(secondInput), null);
    assert.deepEqual(await repository.deleteMany([]), []);
  });
});

test('failed initialization transaction rolls back the marker so retry remains possible', async () => {
  const input = provider('rollback');
  await inRollbackTransaction(async (transaction) => {
    assert.ok(await new AiProviderConfigRepository(transaction).initializeFromEnvironment(input));
  });
  await inRollbackTransaction(async (transaction) => {
    const markers = await transaction.select().from(platformConfigs)
      .where(eq(platformConfigs.key, `ai-provider-environment:${input.key}`));
    assert.equal(markers.length, 0);
    assert.ok(await new AiProviderConfigRepository(transaction).initializeFromEnvironment(input));
  });
});
