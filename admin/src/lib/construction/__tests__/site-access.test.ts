import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { PostgresTransaction } from '@/db/transaction';
import { siteAccessRevoked } from '../site-access';

const dialect = new PgDialect();
function fixture(revoked = false) {
  const queries: ReturnType<PgDialect['sqlToQuery']>[] = [];
  const tx = { execute: async (query: SQL) => {
    queries.push(dialect.sqlToQuery(query));
    return { rows: revoked ? [{ id: '9' }] : [] };
  } } as unknown as PostgresTransaction;
  return { tx, queries };
}

test('database timestamp strings use the time boundary without losing microseconds', async () => {
  const { tx, queries } = fixture();
  const timestamp = '2026-10-30 19:01:32.123456+00';
  assert.equal(await siteAccessRevoked(tx, '1454', '237', ['1'], timestamp), false);
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /created_at>\$\d+(?:::timestamptz)?/);
  assert.ok(queries[0].params.includes(timestamp));
  assert.doesNotMatch(queries[0].sql, /id>\s+and/);
});

test('Date and audit-watermark boundaries retain tenant, project and role revocation checks', async () => {
  for (const since of [new Date('2026-10-30T19:01:32.123Z'), { afterAuditId: '123' }]) {
    const { tx, queries } = fixture(true);
    assert.equal(await siteAccessRevoked(tx, '1454', '237', ['1', '2'], since,
      { reviewers: ['1'], managers: ['2'] }), true);
    const query = queries[0];
    assert.match(query.sql, /enterprise_id=\$1 and project_id=\$2/);
    assert.match(query.sql, /snapshot->>'active'='false'/);
    assert.match(query.sql, /previousRole.*manager.*designer/);
    assert.deepEqual(query.params.slice(-3), ['["1","2"]', '["1"]', '["2"]']);
    if ('afterAuditId' in since) {
      assert.match(query.sql, /id>\$\d+/);
      assert.ok(query.params.includes('123'));
    } else assert.match(query.sql, /created_at>\$\d+/);
  }
});

test('an unusable boundary fails closed without sending malformed SQL', async () => {
  for (const since of [new Date(NaN), 'not-a-date', {}, { afterAuditId: undefined }, { afterAuditId: '1 or true' }]) {
    const { tx, queries } = fixture();
    assert.equal(await siteAccessRevoked(tx, '1454', '237', ['1'], since as Date), true);
    assert.equal(queries.length, 0);
  }
});
