import assert from 'node:assert/strict';
import test from 'node:test';
import { resolvePostgresRuntimeConfig } from '@/lib/postgresql';

const managedKeys = [
  'DATABASE_URL',
  'POSTGRES_APPLICATION_NAME',
  'POSTGRES_POOL_MAX',
  'POSTGRES_CONNECTION_TIMEOUT_MS',
  'POSTGRES_IDLE_TIMEOUT_MS',
  'POSTGRES_IDLE_TRANSACTION_TIMEOUT_MS',
  'POSTGRES_STATEMENT_TIMEOUT_MS',
] as const;

function withEnvironment(
  values: Partial<Record<(typeof managedKeys)[number], string>>,
  callback: () => void
) {
  const original = Object.fromEntries(
    managedKeys.map((key) => [key, process.env[key]])
  );
  for (const key of managedKeys) {
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    callback();
  } finally {
    for (const key of managedKeys) {
      const value = original[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('PostgreSQL runtime configuration requires DATABASE_URL', () => {
  withEnvironment({}, () => {
    assert.throws(
      () => resolvePostgresRuntimeConfig(),
      /DATABASE_URL is required/
    );
  });
});

test('PostgreSQL runtime configuration uses bounded defaults', () => {
  withEnvironment(
    {
      DATABASE_URL:
        'postgresql://app:password@localhost:5432/smart_floor_planner',
    },
    () => {
      const config = resolvePostgresRuntimeConfig();
      assert.equal(config.applicationName, 'smart-floor-planner-admin');
      assert.equal(config.maxConnections, 10);
      assert.equal(config.connectionTimeoutMillis, 5_000);
      assert.equal(config.idleTimeoutMillis, 30_000);
      assert.equal(config.idleInTransactionSessionTimeoutMillis, 30_000);
      assert.equal(config.statementTimeoutMillis, 30_000);
    }
  );
});

test('PostgreSQL runtime configuration rejects unsafe pool sizes', () => {
  withEnvironment(
    {
      DATABASE_URL:
        'postgresql://app:password@localhost:5432/smart_floor_planner',
      POSTGRES_POOL_MAX: '200',
    },
    () => {
      assert.throws(
        () => resolvePostgresRuntimeConfig(),
        /POSTGRES_POOL_MAX must be an integer between 1 and 50/
      );
    }
  );
});
