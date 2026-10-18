import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';
import nextEnv from '@next/env';
const root = path.resolve(import.meta.dirname, '..');
nextEnv.loadEnvConfig(root, true);
const evaluation = JSON.parse(fs.readFileSync(path.join(root, '../tmp/xiaok-vector/connection.private.json'), 'utf8')).DATABASE_URL;
const hashes = ['0069_assistant_agent','0070_assistant_reference_cases'].map(tag => ({ tag, hash: crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'drizzle',tag+'.sql'))).digest('hex') }));
for (const [target, connectionString, database] of [['development', process.env.DATABASE_URL, '/smart_floor_planner'], ['evaluation', evaluation, '/xiaok_embedding_eval']]) {
  const url = new URL(connectionString);
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== database) throw Error('Unexpected migration verification target');
  const pool = new pg.Pool({ connectionString, max: 1 });
  try {
    for (const {hash} of hashes) if ((await pool.query('select id from app.__drizzle_migrations where hash=$1', [hash])).rowCount !== 1) throw Error('Migration hash mismatch');
    for (const [table, column] of [['assistant_enterprise_settings', 'agent_config'], ['assistant_run_steps', 'private_checkpoint'], ['assistant_knowledge_versions','reference_case']]) {
      if ((await pool.query('select 1 from information_schema.columns where table_schema=$1 and table_name=$2 and column_name=$3', ['app', table, column])).rowCount !== 1) throw Error('Missing migration column');
      const rls = (await pool.query('select relrowsecurity,relforcerowsecurity from pg_class where oid=$1::regclass', ['app.' + table])).rows[0];
      if (!rls.relrowsecurity || !rls.relforcerowsecurity) throw Error('RLS mismatch');
    }
    console.log(JSON.stringify({ target, migrations: hashes.map(h=>h.tag), hashVerified: true, columnsVerified: true, forcedRls: true }));
  } finally { await pool.end(); }
}
