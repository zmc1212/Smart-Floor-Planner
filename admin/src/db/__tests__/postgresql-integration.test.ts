import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { loadEnvConfig } from '@next/env';
import { count, eq, inArray } from 'drizzle-orm';
import { departments, enterprises } from '@/db/schema';
import {
  DepartmentRepository,
  EnterpriseRepository,
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
let enterpriseAId: bigint;
let enterpriseBId: bigint;

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
  });
});

after(async () => {
  if (enterpriseAId && enterpriseBId) {
    await withPlatformTransaction(async (transaction) => {
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
