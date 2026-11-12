import path from 'node:path';
import nextEnv from '@next/env';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const migrationUrl =
  process.env.DATABASE_MIGRATION_URL?.trim() ||
  process.env.DATABASE_URL?.trim();

if (!migrationUrl) {
  throw new Error(
    'DATABASE_MIGRATION_URL or DATABASE_URL is required to run migrations'
  );
}

const client = new pg.Client({
  application_name: 'smart-floor-planner-migrator',
  connectionString: migrationUrl,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 120_000,
});

try {
  await client.connect();
  await client.query("select pg_advisory_lock(hashtext('smart-floor-planner:drizzle:migrate'))");
  const database = drizzle(client);
  await migrate(database, {
    migrationsFolder: path.resolve(process.cwd(), 'drizzle'),
    migrationsSchema: 'app',
  });
  console.log(
    JSON.stringify({
      success: true,
      migrationsFolder: 'drizzle',
    })
  );
} finally {
  await client.end();
}
