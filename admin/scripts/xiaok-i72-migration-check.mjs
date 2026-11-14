/** Real PostgreSQL 17 migration check for I7.2. It refuses any non-I7.2 target. */
import path from 'node:path';
import nextEnv from '@next/env';
import pg from 'pg';
import { migratePostgresIntegration } from './postgres-integration-migrations.mjs';

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const url = process.env.XIAOK_I72_MIGRATION_URL?.trim() || process.env.DATABASE_MIGRATION_URL?.trim();
if (!url) throw new Error('XIAOK_I72_MIGRATION_URL is required');
const parsed = new URL(url);
if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || parsed.port !== '55443'
  || parsed.pathname !== '/i72_accept') {
  throw new Error('Use only the isolated I7.2 database at 127.0.0.1:55443/i72_accept');
}

const client = new pg.Client({ connectionString: url, application_name: 'xiaok-i72-migration-check' });
const result = { checks: [] };
const check = (id, status, detail, evidence) => result.checks.push({ id, status, detail, ...(evidence === undefined ? {} : { evidence }) });

try {
  await client.connect();
  const identity = (await client.query('select current_database() as db, current_user as usr')).rows[0];
  if (identity.db !== 'i72_accept') throw new Error('Unexpected database');

  const before = (await client.query('select count(*)::int as n from app.__drizzle_migrations')).rows[0].n;
  await migratePostgresIntegration(client, path.resolve(process.cwd(), 'drizzle'));
  const afterFirst = (await client.query('select count(*)::int as n from app.__drizzle_migrations')).rows[0].n;
  await migratePostgresIntegration(client, path.resolve(process.cwd(), 'drizzle'));
  const afterSecond = (await client.query('select count(*)::int as n from app.__drizzle_migrations')).rows[0].n;
  check('migration.duplicate_safe', afterSecond === afterFirst ? 'passed' : 'failed', '重复执行迁移不重复写账本',
    { before, afterFirst, afterSecond });

  const tables = (await client.query(`select c.relname,c.relrowsecurity as rls,c.relforcerowsecurity as forced
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='app' and c.relname in ('construction_stage_reminders','construction_stage_reminder_pauses')
    order by c.relname`)).rows;
  check('migration.tables', tables.length === 2 ? 'passed' : 'failed', '提醒表与暂停表创建',
    tables.map(row => ({ table: row.relname, rls: row.rls, forced: row.forced })));
  check('migration.forced_rls', tables.length === 2 && tables.every(row => row.rls && row.forced) ? 'passed' : 'failed',
    '两张表均启用并强制执行 RLS');

  const policies = (await client.query(`select tablename,policyname from pg_policies
    where schemaname='app' and tablename like 'construction_stage_reminder%' order by tablename`)).rows;
  check('migration.policy', policies.length === 2 ? 'passed' : 'failed', '企业隔离策略存在', policies);

  const constraints = (await client.query(`select conname,pg_get_constraintdef(oid) as definition
    from pg_constraint where conrelid='app.construction_stage_reminders'::regclass order by conname`)).rows;
  const unique = constraints.find(row => row.conname === 'construction_stage_reminders_enterprise_id_dedupe_key_key');
  const receipt = constraints.find(row => row.conname === 'construction_stage_reminders_receipt_check');
  const principal = constraints.find(row => row.conname === 'construction_stage_reminders_target_principal_id_check');
  check('migration.unique_and_checks', unique && receipt && principal ? 'passed' : 'failed',
    '去重唯一约束、回执约束与收件人约束存在', { unique: unique?.definition, receipt: receipt?.definition, principal: principal?.definition });

  const indexes = (await client.query(`select indexname,indexdef from pg_indexes
    where schemaname='app' and tablename like 'construction_stage_reminder%' order by indexname`)).rows;
  check('migration.indexes', indexes.some(row => row.indexname === 'construction_stage_reminders_inbox')
    && indexes.some(row => row.indexname === 'construction_stage_reminders_project') ? 'passed' : 'failed',
    '收件箱与项目索引存在', indexes.map(row => row.indexname));

  const reports = (await client.query(`select
    (select count(*)::int from app.construction_reports) as reports,
    (select count(*)::int from app.construction_report_versions) as versions`)).rows[0];
  check('migration.history_readable', 'passed', '迁移后历史 Construction 报告表可读', reports);

  await client.query('begin');
  await client.query(`insert into app.__drizzle_migrations(hash,created_at) values('i72-rollback-probe',9999999999999)`);
  await client.query('rollback');
  const probe = (await client.query(`select count(*)::int as n from app.__drizzle_migrations where hash='i72-rollback-probe'`)).rows[0].n;
  check('migration.transaction_rollback', probe === 0 ? 'passed' : 'failed', '迁移事务回滚不留下账本或结构变更', { probe });

  result.database = identity.db;
  result.finishedAt = new Date().toISOString();
  console.log(JSON.stringify(result));
} finally {
  await client.end();
}
