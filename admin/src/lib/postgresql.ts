import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '@/db/schema';

type PostgresCache = {
  database: NodePgDatabase<typeof schema> | null;
  pool: Pool | null;
};

export type PostgresRuntimeConfig = {
  applicationName: string;
  connectionString: string;
  connectionTimeoutMillis: number;
  idleInTransactionSessionTimeoutMillis: number;
  idleTimeoutMillis: number;
  maxConnections: number;
  statementTimeoutMillis: number;
};

const globalForPostgres = globalThis as typeof globalThis & {
  postgresCache?: PostgresCache;
};

const cache: PostgresCache = globalForPostgres.postgresCache ?? {
  database: null,
  pool: null,
};

if (process.env.NODE_ENV !== 'production') {
  globalForPostgres.postgresCache = cache;
}

function positiveInteger(
  name: string,
  fallback: number,
  options: { min: number; max: number }
) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < options.min || value > options.max) {
    throw new Error(
      `${name} must be an integer between ${options.min} and ${options.max}`
    );
  }
  return value;
}

export function isPostgresConfigured() {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function resolvePostgresRuntimeConfig(): PostgresRuntimeConfig {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to connect to PostgreSQL');
  }

  return {
    applicationName:
      process.env.POSTGRES_APPLICATION_NAME?.trim() ||
      'smart-floor-planner-admin',
    connectionString,
    maxConnections: positiveInteger('POSTGRES_POOL_MAX', 10, {
      min: 1,
      max: 50,
    }),
    connectionTimeoutMillis: positiveInteger(
      'POSTGRES_CONNECTION_TIMEOUT_MS',
      5_000,
      { min: 100, max: 60_000 }
    ),
    idleTimeoutMillis: positiveInteger(
      'POSTGRES_IDLE_TIMEOUT_MS',
      30_000,
      { min: 1_000, max: 600_000 }
    ),
    idleInTransactionSessionTimeoutMillis: positiveInteger(
      'POSTGRES_IDLE_TRANSACTION_TIMEOUT_MS',
      30_000,
      { min: 1_000, max: 600_000 }
    ),
    statementTimeoutMillis: positiveInteger(
      'POSTGRES_STATEMENT_TIMEOUT_MS',
      30_000,
      { min: 1_000, max: 600_000 }
    ),
  };
}

export function getPostgresPool() {
  if (cache.pool) return cache.pool;

  const config = resolvePostgresRuntimeConfig();
  const pool = new Pool({
    application_name: config.applicationName,
    connectionString: config.connectionString,
    connectionTimeoutMillis: config.connectionTimeoutMillis,
    idle_in_transaction_session_timeout:
      config.idleInTransactionSessionTimeoutMillis,
    idleTimeoutMillis: config.idleTimeoutMillis,
    max: config.maxConnections,
    statement_timeout: config.statementTimeoutMillis,
  });

  pool.on('error', (error) => {
    console.error('[PostgreSQL] idle pool connection failed', {
      code: (error as { code?: string }).code || 'unknown',
    });
  });

  cache.pool = pool;
  return pool;
}

export function getPostgresDatabase() {
  if (!cache.database) {
    cache.database = drizzle(getPostgresPool(), { schema });
  }
  return cache.database;
}

export async function checkPostgresConnection() {
  const result = await getPostgresPool().query<{
    database_name: string;
    server_time: Date;
  }>(
    'select current_database() as database_name, now() as server_time'
  );
  return result.rows[0];
}

export async function closePostgresPool() {
  if (!cache.pool) return;
  const pool = cache.pool;
  cache.pool = null;
  cache.database = null;
  await pool.end();
}
