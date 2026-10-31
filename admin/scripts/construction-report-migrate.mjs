import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import nextEnv from '@next/env';
import pg from 'pg';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';

nextEnv.loadEnvConfig(process.cwd(), true);
assert.ok(process.argv.includes('--development'), 'Explicit development target required');
const root = path.resolve('..'), directory = path.join(root, 'tmp/v1-02-proactive-foundation');
fs.mkdirSync(directory, { recursive: true });
const auditPath = path.resolve(process.argv.find(v => v.startsWith('--audit='))?.slice(8) || path.join(directory, 'migration.json'));
assert.ok(!fs.existsSync(auditPath), 'Retain the original migration audit; choose a fresh --audit path');
const runtime = new URL(process.env.DATABASE_URL);
assert.ok(['localhost','127.0.0.1'].includes(runtime.hostname) && runtime.port === '5432' && runtime.pathname === '/smart_floor_planner');
const target = new URL(process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL);
assert.equal(target.hostname, runtime.hostname); assert.equal(target.port, runtime.port); assert.equal(target.pathname, runtime.pathname);
const journal = JSON.parse(fs.readFileSync('drizzle/meta/_journal.json', 'utf8')).entries;
const entry = journal.find(e => e.tag === '0103_construction_proactive_reports');
const source = fs.readFileSync('drizzle/0103_construction_proactive_reports.sql', 'utf8');
const hash = createHash('sha256').update(source).digest('hex');
// The preceding local migration was already applied before this task. Do not
// require or stage its unrelated dirty source just to verify this local target.
const previousTimestamp = 1793606400000;
const control = JSON.parse(fs.readFileSync(path.join(root, 'tmp/xiaok-vector/connection.private.json'), 'utf8')).DATABASE_URL;
const release = await lockAssistantAcceptance(control, { waitForLock: true });
const app = new pg.Client({ connectionString: runtime.toString() });
const migration = new pg.Client({ connectionString: target.toString() });
const audit = { startedAt: new Date().toISOString(), hash, migration: entry.tag, applied: false };
try {
  await app.connect(); await migration.connect();
  await app.query('begin'); await app.query("select set_config('app.is_platform_admin','true',true)");
  assert.equal((await app.query("select count(*)::int n from app.assistant_jobs where status in ('queued','running')")).rows[0].n, 0);
  await app.query('rollback');
  await migration.query('begin');
  await migration.query("select set_config('lock_timeout','5s',true),set_config('statement_timeout','120s',true)");
  await migration.query("select pg_advisory_xact_lock(hashtext('construction_report_migration'))");
  const old = (await migration.query('select hash from app.__drizzle_migrations where created_at=$1', [entry.when])).rows[0];
  if (old) assert.equal(old.hash, hash, 'Applied SQL must not drift');
  else {
    assert.ok((await migration.query('select 1 from app.__drizzle_migrations where created_at=$1', [previousTimestamp])).rowCount,
      '0102 must already be applied; do not migrate unrelated dirty work');
    await migration.query(source);
    await migration.query('insert into app.__drizzle_migrations(hash,created_at) values($1,$2)', [hash, entry.when]);
    audit.applied = true;
  }
  await migration.query('commit');
  audit.tables = (await app.query("select relname,relrowsecurity,relforcerowsecurity from pg_class join pg_namespace on pg_namespace.oid=pg_class.relnamespace where nspname='app' and relname=any($1::text[]) order by relname",
    [['construction_report_settings','construction_followup_bindings','construction_reports','construction_report_versions','construction_report_deliveries']])).rows;
  assert.equal(audit.tables.length, 5); assert.ok(audit.tables.every(t => t.relrowsecurity && t.relforcerowsecurity));
  console.log(JSON.stringify({ success: true, applied: audit.applied, hash, forcedRlsTables: audit.tables.length }));
} catch (error) {
  await migration.query('rollback').catch(() => undefined); audit.error = error.message;
  process.exitCode = 1; console.error(error.message);
} finally {
  audit.finishedAt = new Date().toISOString(); fs.writeFileSync(auditPath, JSON.stringify(audit, null, 2));
  await migration.end().catch(() => undefined); await app.end().catch(() => undefined); await release();
}
