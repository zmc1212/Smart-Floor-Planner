import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { loadEnvConfig } from '@next/env';
import { count, eq, inArray } from 'drizzle-orm';
import {
  aiPromptCategories,
  aiPromptLibraryRevisions,
  aiPromptParameterTemplates,
  aiPromptSourceModels,
  aiPromptTemplateAssets,
  aiPromptTemplates,
  departments,
  enterprises,
  mediaStorageConfigs,
  platformConfigs,
  systemRoles,
} from '@/db/schema';
import {
  DepartmentRepository,
  EnterpriseRepository,
  MediaStorageConfigRepository,
  PlatformConfigRepository,
  PromptLibraryRepository,
  SystemRoleRepository,
} from '@/db/repositories';
import {
  withPlatformTransaction,
  withTenantTransaction,
} from '@/db/transaction';
import {
  closePostgresPool,
  getPostgresPool,
  resolvePostgresRuntimeConfig,
} from '@/lib/postgresql';

const testRunKey = `phase2-${process.pid}-${Date.now()}`;
const enterpriseCodes = [`${testRunKey}-a`, `${testRunKey}-b`];
const systemRoleKey = `${testRunKey}-role`;
let enterpriseAId: bigint;
let enterpriseBId: bigint;
let promptRevisionId: bigint;
let promptTemplateId: bigint;

before(async () => {
  loadEnvConfig(process.cwd());
  const url = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(
    ['localhost', '127.0.0.1'].includes(url.hostname),
    'PostgreSQL integration tests only mutate the local database'
  );

  await withPlatformTransaction(async (transaction) => {
    const repository = new EnterpriseRepository(transaction);
    const enterpriseA = await repository.create({
      name: `${testRunKey} A`,
      code: enterpriseCodes[0],
    });
    const enterpriseB = await repository.create({
      name: `${testRunKey} B`,
      code: enterpriseCodes[1],
    });
    enterpriseAId = enterpriseA.id;
    enterpriseBId = enterpriseB.id;

    const departmentsRepository = new DepartmentRepository(transaction);
    await departmentsRepository.create({
      enterpriseId: enterpriseAId,
      name: 'Tenant A Department',
    });
    await departmentsRepository.create({
      enterpriseId: enterpriseBId,
      name: 'Tenant B Department',
    });

    const revision = await transaction
      .insert(aiPromptLibraryRevisions)
      .values({
        source: testRunKey,
        revisionKey: `${testRunKey}-revision`,
        status: 'active',
        manifestHash: 'manifest',
        contentHash: 'content',
      })
      .returning({ id: aiPromptLibraryRevisions.id });
    promptRevisionId = revision[0].id;

    const category = await transaction
      .insert(aiPromptCategories)
      .values({
        importRevisionId: promptRevisionId,
        source: testRunKey,
        sourceId: `${testRunKey}-category`,
        sourceHash: 'category-hash',
        importedAt: new Date(),
        level: 1,
        name: 'Test category',
        weight: 10,
      })
      .returning({ id: aiPromptCategories.id });
    const parameterTemplate = await transaction
      .insert(aiPromptParameterTemplates)
      .values({
        importRevisionId: promptRevisionId,
        source: testRunKey,
        sourceId: `${testRunKey}-parameters`,
        sourceHash: 'parameter-hash',
        importedAt: new Date(),
        name: 'Test parameters',
        parameters: { ratio: ['1:1'] },
      })
      .returning({ id: aiPromptParameterTemplates.id });
    const sourceModel = await transaction
      .insert(aiPromptSourceModels)
      .values({
        importRevisionId: promptRevisionId,
        source: testRunKey,
        sourceId: `${testRunKey}-model`,
        sourceHash: 'model-hash',
        importedAt: new Date(),
        name: 'Test model',
        localModelProfileId: null,
        capabilities: { image: true },
      })
      .returning({ id: aiPromptSourceModels.id });
    const asset = await transaction
      .insert(aiPromptTemplateAssets)
      .values({
        importRevisionId: promptRevisionId,
        source: testRunKey,
        sourceId: `${testRunKey}-asset`,
        templateSourceId: `${testRunKey}-template`,
        sourceHash: 'asset-hash',
        importedAt: new Date(),
        sourceUrl: 'https://example.test/preview.png',
        mimeType: 'image/png',
        size: 4n,
        width: 2,
        height: 2,
        checksumSha256: 'asset-checksum',
        storageProvider: 'local',
        storageKey: `${testRunKey}/preview.png`,
      })
      .returning({ id: aiPromptTemplateAssets.id });
    const template = await transaction
      .insert(aiPromptTemplates)
      .values({
        importRevisionId: promptRevisionId,
        categoryId: category[0].id,
        sourceModelId: sourceModel[0].id,
        parameterTemplateId: parameterTemplate[0].id,
        previewAssetId: asset[0].id,
        source: testRunKey,
        sourceId: `${testRunKey}-template`,
        sourceHash: 'template-hash',
        importedAt: new Date(),
        name: 'Test template',
        promptContent: 'A test prompt',
        categorySourceId: `${testRunKey}-category`,
        bestModelSourceId: `${testRunKey}-model`,
        parameterTemplateSourceId: `${testRunKey}-parameters`,
      })
      .returning({ id: aiPromptTemplates.id });
    promptTemplateId = template[0].id;
  });
});

after(async () => {
  if (enterpriseAId && enterpriseBId) {
    await withPlatformTransaction(async (transaction) => {
      if (promptRevisionId) {
        await transaction
          .delete(aiPromptLibraryRevisions)
          .where(eq(aiPromptLibraryRevisions.id, promptRevisionId));
      }
      await transaction
        .delete(platformConfigs)
        .where(eq(platformConfigs.key, testRunKey));
      await transaction
        .delete(mediaStorageConfigs)
        .where(eq(mediaStorageConfigs.key, testRunKey));
      await transaction
        .delete(systemRoles)
        .where(eq(systemRoles.roleKey, systemRoleKey));
      await transaction
        .delete(enterprises)
        .where(inArray(enterprises.id, [enterpriseAId, enterpriseBId]));
    });
  }
  await closePostgresPool();
});

test('tenant transaction only sees its own rows', async () => {
  const tenantARows = await withTenantTransaction(
    enterpriseAId,
    (transaction) => new DepartmentRepository(transaction).list()
  );
  const tenantBRows = await withTenantTransaction(
    enterpriseBId,
    (transaction) => new DepartmentRepository(transaction).list()
  );

  assert.deepEqual(
    tenantARows.map((row) => row.name),
    ['Tenant A Department']
  );
  assert.deepEqual(
    tenantBRows.map((row) => row.name),
    ['Tenant B Department']
  );
});

test('RLS rejects a cross-tenant insert even without a repository filter', async () => {
  await assert.rejects(
    withTenantTransaction(enterpriseAId, async (transaction) => {
      await new DepartmentRepository(transaction).create({
        enterpriseId: enterpriseBId,
        name: 'Cross-tenant write',
      });
    }),
    (error: unknown) =>
      (error as { cause?: { code?: string } }).cause?.code === '42501'
      || (error as { code?: string }).code === '42501'
  );
});

test('platform transaction sees both tenants', async () => {
  const visibleCount = await withPlatformTransaction(async (transaction) => {
    const rows = await transaction
      .select({ value: count() })
      .from(departments)
      .where(inArray(departments.enterpriseId, [enterpriseAId, enterpriseBId]));
    return rows[0].value;
  });
  assert.equal(visibleCount, 2);
});

test('transaction context does not leak back into the connection pool', async () => {
  await withTenantTransaction(enterpriseAId, async (transaction) => {
    const rows = await transaction
      .select({ value: count() })
      .from(departments);
    assert.equal(rows[0].value, 1);
  });

  const result = await getPostgresPool().query<{ value: string }>(
    'select count(*) as value from app.departments'
  );
  assert.equal(result.rows[0].value, '0');
});

test('failed repository work rolls back atomically', async () => {
  const rollbackCode = `${testRunKey}-rollback`;
  await assert.rejects(
    withPlatformTransaction(async (transaction) => {
      await new EnterpriseRepository(transaction).create({
        name: 'Must Roll Back',
        code: rollbackCode,
      });
      throw new Error('rollback sentinel');
    }),
    /rollback sentinel/
  );

  const rows = await withPlatformTransaction((transaction) =>
    transaction
      .select({ id: enterprises.id })
      .from(enterprises)
      .where(eq(enterprises.code, rollbackCode))
  );
  assert.equal(rows.length, 0);
});

test('prompt repository returns the active revision and related records', async () => {
  const result = await withPlatformTransaction(async (transaction) => {
    const repository = new PromptLibraryRepository(transaction);
    const revision = await repository.findActiveRevision(testRunKey);
    assert.equal(revision?.id, promptRevisionId);

    const categories = await repository.listCategories(promptRevisionId);
    assert.equal(categories.length, 1);

    const templates = await repository.listTemplates(promptRevisionId, {
      page: 1,
      limit: 10,
      query: 'test prompt',
      categorySourceIds: [categories[0].sourceId],
    });
    assert.equal(templates.total, 1);
    assert.equal(templates.rows[0].id, promptTemplateId);

    const template = await repository.findTemplate(
      promptRevisionId,
      promptTemplateId
    );
    assert.equal(template?.previewAssetId, templates.rows[0].previewAssetId);
    const asset = await repository.findTemplateAsset(
      promptRevisionId,
      template?.previewAssetId ?? null
    );
    assert.equal(asset?.storageKey, `${testRunKey}/preview.png`);
    const assets = await repository.listTemplateAssets(
      promptRevisionId,
      asset ? [asset.id] : []
    );
    assert.equal(assets.length, 1);
    return templates.total;
  });
  assert.equal(result, 1);
});

test('platform config upsert preserves unrelated JSON sections', async () => {
  await withPlatformTransaction(async (transaction) => {
    const repository = new PlatformConfigRepository(transaction);
    await repository.upsert(testRunKey, {
      mediaStorage: { activeProviderKey: 'local' },
      promotionConfig: { protectionPeriodDays: 30 },
    });
    await repository.upsert(testRunKey, {
      promotionConfig: { protectionPeriodDays: 45 },
    });

    const config = await repository.findByKey(testRunKey);
    assert.deepEqual(config?.mediaStorage, { activeProviderKey: 'local' });
    assert.deepEqual(config?.promotionConfig, { protectionPeriodDays: 45 });
  });
});

test('system role defaults are idempotent and preserve configured permissions', async () => {
  await withPlatformTransaction(async (transaction) => {
    const repository = new SystemRoleRepository(transaction);
    await repository.ensureDefaults([
      {
        roleKey: systemRoleKey,
        label: 'Test role',
        menuKeys: ['dashboard'],
      },
    ]);

    const created = await repository.findByRoleKey(systemRoleKey);
    assert.ok(created);
    const updated = await repository.updateMenuKeys(created.id, [
      'dashboard',
      'roles',
    ]);
    assert.deepEqual(updated?.menuKeys, ['dashboard', 'roles']);

    await repository.ensureDefaults([
      {
        roleKey: systemRoleKey,
        label: 'Seed label must not overwrite',
        menuKeys: ['dashboard'],
      },
    ]);

    const preserved = await repository.findByRoleKey(systemRoleKey);
    assert.equal(preserved?.label, 'Test role');
    assert.deepEqual(preserved?.menuKeys, ['dashboard', 'roles']);
  });
});

test('media storage repository uses optimistic test-result updates', async () => {
  await withPlatformTransaction(async (transaction) => {
    const repository = new MediaStorageConfigRepository(transaction);
    const created = await repository.create({
      key: testRunKey,
      name: 'Test storage',
      driver: 'qiniu',
      accessKeyEncrypted: 'encrypted-ak',
      accessKeyMasked: 'ak***',
      secretKeyEncrypted: 'encrypted-sk',
      secretKeyMasked: 'sk***',
      bucket: 'private-bucket',
      region: 'z0',
      domain: 'https://media.example.test',
      lastTestMessage: 'not tested',
    });
    const updated = await repository.update(created.id, {
      name: 'Renamed storage',
    });
    assert.ok(updated);

    const staleResult = await repository.recordTestResult(
      created.id,
      created.updatedAt,
      {
        lastTestedAt: new Date(),
        lastTestOk: true,
        lastTestMessage: 'stale success',
      }
    );
    assert.equal(staleResult, null);

    const currentResult = await repository.recordTestResult(
      created.id,
      updated.updatedAt,
      {
        lastTestedAt: new Date(),
        lastTestOk: true,
        lastTestMessage: 'current success',
      }
    );
    assert.equal(currentResult?.lastTestOk, true);
    assert.equal(currentResult?.lastTestMessage, 'current success');
  });
});

test('media storage list ordering has a matching composite index', async () => {
  const result = await getPostgresPool().query<{ definition: string }>(`
    select indexdef as definition
    from pg_indexes
    where schemaname = 'app'
      and indexname = 'media_storage_configs_status_created_idx'
  `);
  assert.equal(result.rows.length, 1);
  assert.match(result.rows[0].definition, /\(status, created_at\)/);
});

test('every tenant foreign key and RLS predicate column has an index', async () => {
  const missingForeignKeyIndexes = await getPostgresPool().query<{
    table_name: string;
    column_name: string;
  }>(`
    select
      c.conrelid::regclass::text as table_name,
      a.attname as column_name
    from pg_constraint c
    cross join lateral unnest(c.conkey) as key(attnum)
    join pg_attribute a
      on a.attrelid = c.conrelid
      and a.attnum = key.attnum
    where c.contype = 'f'
      and c.connamespace = 'app'::regnamespace
      and not exists (
        select 1
        from pg_index i
        where i.indrelid = c.conrelid
          and key.attnum = any(i.indkey)
      )
  `);
  assert.deepEqual(missingForeignKeyIndexes.rows, []);
});

test('formal floor plans require the version-4 surveying contract', async () => {
  const result = await getPostgresPool().query<{
    column_default: string | null;
    definition: string;
  }>(`
    select
      columns.column_default,
      pg_get_constraintdef(constraints.oid) as definition
    from information_schema.columns columns
    join pg_constraint constraints
      on constraints.conrelid = 'app.floor_plans'::regclass
      and constraints.conname = 'floor_plans_formal_layout_check'
    where columns.table_schema = 'app'
      and columns.table_name = 'floor_plans'
      and columns.column_name = 'layout_data'
  `);
  assert.equal(result.rows[0].column_default, null);
  assert.match(result.rows[0].definition, /version/);
  assert.match(result.rows[0].definition, /measurementMode/);
  assert.match(result.rows[0].definition, /surveyGraph/);
});
