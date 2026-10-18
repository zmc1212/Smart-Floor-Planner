import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import pg from 'pg';
import nextEnv from '@next/env';
const root = path.resolve(import.meta.dirname, '..'); nextEnv.loadEnvConfig(root, true);
const isolated = JSON.parse(fs.readFileSync(path.resolve(root, '../tmp/xiaok-vector/connection.private.json'), 'utf8')).DATABASE_URL;
const tables = ['construction_projects','construction_members','construction_rooms','construction_plans','construction_visits','construction_audits','construction_links','construction_stage_settings','construction_stage_assignments','construction_chats','construction_site_media','construction_site_records','construction_site_record_versions','construction_site_attachments','construction_watches'];
tables.push('construction_public_sites','construction_public_versions','construction_public_sources','construction_public_media','construction_public_audits');
const migrations = ['0073_construction_planning','0074_construction_context_retention','0075_construction_resource_cleanup','0077_construction_stages','0080_construction_staff','0081_construction_identity_scope','0082_construction_staff_role','0083_construction_shared_chat','0084_construction_public_sites'].map(tag => ({ tag, hash: createHash('sha256').update(fs.readFileSync(path.resolve(root,'drizzle',tag+'.sql'))).digest('hex') }));
for (const [target, connectionString, database, port] of [['development',process.env.DATABASE_URL,'/smart_floor_planner','5432'], ['evaluation',isolated,'/xiaok_embedding_eval','55432']]) {
  const url = new URL(connectionString);
  if (!['localhost','127.0.0.1'].includes(url.hostname) || url.pathname !== database || url.port !== port) throw Error('Unexpected verification target');
  const pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 });
  try {
    for (const m of migrations) if ((await pool.query('select id from app.__drizzle_migrations where hash=$1',[m.hash])).rowCount !== 1) throw Error('Migration hash mismatch');
    for (const t of tables) { const p = (await pool.query('select relrowsecurity,relforcerowsecurity from pg_class where oid=$1::regclass',['app.'+t])).rows[0]; if (!p?.relrowsecurity || !p.relforcerowsecurity) throw Error('Missing forced RLS'); }
    const sources = (await pool.query("select column_name,is_nullable from information_schema.columns where table_schema='app' and table_name='construction_visits' and column_name in ('conversation_id','source_message_id')")).rows;
    if (sources.length !== 2 || sources.some(c => c.is_nullable !== 'YES')) throw Error('Business retention guard missing');
    const stageColumns = (await pool.query("select column_name from information_schema.columns where table_schema='app' and table_name='construction_projects' and column_name in ('current_stage_key','stage_contacts','progress_note','progress_revision')")).rows;
    if (stageColumns.length !== 4) throw Error('Construction stage columns missing');
    const employeeColumns = (await pool.query("select table_name,column_name from information_schema.columns where table_schema='app' and ((table_name='admin_users' and column_name='construction_trades') or (table_name='construction_members' and column_name='work_label'))")).rows;
    if (employeeColumns.length !== 2) throw Error('Construction employee columns missing');
    const roleConstraint = (await pool.query("select pg_get_constraintdef(oid) definition from pg_constraint where conrelid='app.admin_users'::regclass and conname='admin_users_role_check'")).rows[0];
    if (!roleConstraint?.definition.includes('construction_staff')) throw Error('Construction role guard missing');
    const functions = (await pool.query("select pronargs from pg_proc where pronamespace='app'::regnamespace and proname='construction_miniprogram_access'")).rows;
    if (functions.length !== 1 || functions[0].pronargs !== 4) throw Error('Construction session guard missing');
    const shared = (await pool.query("select pronargs from pg_proc where pronamespace='app'::regnamespace and proname='assistant_shared_conversation_access'")).rows;
    if (shared.length !== 1 || shared[0].pronargs !== 5) throw Error('Shared project session guard missing');
    const purpose = (await pool.query("select pg_get_constraintdef(oid) definition from pg_constraint where conrelid='app.assistant_conversations'::regclass and conname='assistant_conversations_purpose_check'")).rows[0];
    if (!purpose?.definition.includes('project_collaboration')) throw Error('Shared project purpose missing');
    console.log(JSON.stringify({ target, hashesVerified: true, forcedRlsTables: tables.length, stageColumnsVerified: true, employeeColumnsVerified: true, legacyRecordsRetained: true, migrations: migrations.map(m=>m.tag) }));
  } finally { await pool.end(); }
}
