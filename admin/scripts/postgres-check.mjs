import nextEnv from '@next/env';
import pg from 'pg';

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  throw new Error('DATABASE_URL is required to check PostgreSQL');
}

const pool = new pg.Pool({
  application_name: 'smart-floor-planner-db-check',
  connectionString,
  connectionTimeoutMillis: 5_000,
  max: 1,
  statement_timeout: 10_000,
});

try {
  const identity = await pool.query(`
    select
      current_database() as database_name,
      current_user as database_user,
      has_schema_privilege(current_user, 'app', 'USAGE') as can_use_app_schema
  `);
  const checkpoints = await pool.query(`
    select key, phase, status, updated_at
    from app.migration_checkpoints
    order by key
  `);
  console.log(
    JSON.stringify(
      {
        success: true,
        identity: identity.rows[0],
        checkpoints: checkpoints.rows,
      },
      null,
      2
    )
  );
} finally {
  await pool.end();
}
