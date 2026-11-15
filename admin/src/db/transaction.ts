import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PoolClient } from 'pg';
import * as schema from '@/db/schema';
import { getPostgresPool } from '@/lib/postgresql';

export type PostgresTransaction = NodePgDatabase<typeof schema>;

type TransactionScope =
  | { kind: 'tenant'; enterpriseId: bigint | number | string }
  | { kind: 'platform' };

function normalizeEnterpriseId(value: bigint | number | string) {
  const normalized = String(value);
  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new Error('enterpriseId must be a positive PostgreSQL bigint');
  }
  return normalized;
}

export async function setTransactionScope(
  client: Pick<PoolClient, 'query'>,
  scope: TransactionScope
) {
  const enterpriseId =
    scope.kind === 'tenant'
      ? normalizeEnterpriseId(scope.enterpriseId)
      : '';
  await client.query(
    `select
       set_config('app.current_enterprise_id', $1, true),
       set_config('app.is_platform_admin', $2, true)`,
    [enterpriseId, String(scope.kind === 'platform')]
  );
}

type TransactionOptions = { isolationLevel?: 'repeatable read'; readOnly?: boolean };

function beginStatement(options?: TransactionOptions) {
  const isolation = options?.isolationLevel === 'repeatable read' ? ' isolation level repeatable read' : '';
  const readOnly = options?.readOnly ? ' read only' : '';
  return 'begin' + isolation + readOnly;
}

async function withScopedTransaction<T>(
  scope: TransactionScope,
  callback: (transaction: PostgresTransaction) => Promise<T>,
  options?: TransactionOptions
) {
  const client = await getPostgresPool().connect();
  try {
    await client.query(beginStatement(options));
    await setTransactionScope(client, scope);
    const transaction = drizzle(client, { schema });
    const result = await callback(transaction);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export function withTenantTransaction<T>(
  enterpriseId: bigint | number | string,
  callback: (transaction: PostgresTransaction) => Promise<T>,
  options?: TransactionOptions
) {
  return withScopedTransaction(
    { kind: 'tenant', enterpriseId },
    callback,
    options
  );
}

export function withPlatformTransaction<T>(
  callback: (transaction: PostgresTransaction) => Promise<T>,
  options?: TransactionOptions
) {
  return withScopedTransaction({ kind: 'platform' }, callback, options);
}
