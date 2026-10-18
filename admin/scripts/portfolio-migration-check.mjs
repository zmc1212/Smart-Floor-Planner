import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import pg from 'pg';
import nextEnv from '@next/env';
const root = path.resolve(import.meta.dirname, '..'); nextEnv.loadEnvConfig(root, true);
const isolated = JSON.parse(fs.readFileSync(path.resolve(root, '../tmp/xiaok-vector/connection.private.json'), 'utf8')).DATABASE_URL;
const tables = ['portfolio_communities', 'portfolio_profiles', 'portfolio_works', 'portfolio_versions', 'portfolio_assets', 'portfolio_audits', 'portfolio_community_requests', 'portfolio_provider_usage'];
const migrations = ['0071_designer_portfolio', '0072_portfolio_provider_guard', '0076_platform_map_services', '0078_map_provider_switching', '0079_optional_map_authorization'].map(tag => ({ tag, hash: createHash('sha256').update(fs.readFileSync(path.resolve(root, 'drizzle', tag + '.sql'))).digest('hex') }));
for (const [target, connectionString, database, port] of [['development', process.env.DATABASE_URL, '/smart_floor_planner', '5432'], ['evaluation', isolated, '/xiaok_embedding_eval', '55432']]) {
  const url = new URL(connectionString);
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== database || url.port !== port) throw Error('Unexpected migration verification target');
  const pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 });
  try {
    for (const migration of migrations) if ((await pool.query('select id from app.__drizzle_migrations where hash=$1', [migration.hash])).rowCount !== 1) throw Error('Migration hash mismatch');
    for (const table of tables) {
      const rls = (await pool.query('select relrowsecurity,relforcerowsecurity from pg_class where oid=$1::regclass', ['app.' + table])).rows[0];
      if (!rls?.relrowsecurity || !rls.relforcerowsecurity) throw Error('Missing forced RLS');
    }
    for (const [table, column] of [['portfolio_provider_usage', 'blocked_until'], ['portfolio_provider_usage', 'provider_key'], ['portfolio_communities', 'license_valid_until'], ['platform_configs', 'map_service_config']]) if (!(await pool.query('select 1 from information_schema.columns where table_schema=$1 and table_name=$2 and column_name=$3', ['app', table, column])).rowCount) throw Error('Missing guard column');
    if (!(await pool.query("select 1 from pg_constraint where conname='portfolio_communities_provider_check' and pg_get_constraintdef(oid) like '%tianditu%'")).rowCount) throw Error('Missing multi-provider community constraint');
    if ((await pool.query("select 1 from pg_constraint where conrelid='app.portfolio_communities'::regclass and conname='portfolio_community_binding_rights'")).rowCount) throw Error('Authorization is still mandatory');
    console.log(JSON.stringify({ target, migrations: migrations.map(m => m.tag), hashesVerified: true, forcedRlsTables: tables.length, guardColumnsVerified: true, mapAuthorizationOptional: true }));
  } finally { await pool.end(); }
}
