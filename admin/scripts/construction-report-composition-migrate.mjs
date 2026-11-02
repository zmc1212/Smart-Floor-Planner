import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import nextEnv from '@next/env';
import pg from 'pg';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';

nextEnv.loadEnvConfig(process.cwd(), true);
const evaluation = process.argv.includes('--evaluation');
assert.ok(evaluation !== process.argv.includes('--development'), 'Select exactly one authorized local target');
const root = path.resolve('..'), isolated = JSON.parse(fs.readFileSync(path.join(root, 'tmp/xiaok-vector/connection.private.json'), 'utf8'));
const runtimeUrl = evaluation ? isolated.DATABASE_URL : process.env.DATABASE_URL;
const ownerUrl = evaluation ? isolated.EMBEDDING_EVAL_OWNER_URL : process.env.DATABASE_MIGRATION_URL;
const target = new URL(runtimeUrl), owner = new URL(ownerUrl);
assert.ok(['localhost','127.0.0.1'].includes(target.hostname));
assert.equal(target.port, evaluation ? '55432' : '5432');
assert.equal(target.pathname, evaluation ? '/xiaok_embedding_eval' : '/smart_floor_planner');
assert.equal(owner.hostname, target.hostname); assert.equal(owner.port, target.port); assert.equal(owner.pathname, target.pathname);
const directory = path.resolve(process.argv.find(v => v.startsWith('--output='))?.slice(9) || `../tmp/v1-02-natural-reports/migration-${evaluation ? 'evaluation' : 'development'}-01`);
assert.ok(!fs.existsSync(path.join(directory, 'audit.json')), 'Preserve prior outcomes');
fs.mkdirSync(directory, { recursive: true });
const journal = JSON.parse(fs.readFileSync('drizzle/meta/_journal.json', 'utf8')).entries;
const selected = journal.filter(e => evaluation ? e.idx >= 103 && e.idx <= 110 : e.idx >= 109 && e.idx <= 110);
assert.equal(selected.at(-1).tag, '0110_construction_report_run_independence');
const release = await lockAssistantAcceptance(isolated.DATABASE_URL, { waitForLock: true });
const app = new pg.Client({ connectionString: runtimeUrl }), ddl = new pg.Client({ connectionString: ownerUrl });
const audit = { startedAt: new Date().toISOString(), target: evaluation ? 'evaluation' : 'development', applied: [], source: {} };
try {
  await app.connect(); await ddl.connect();
  await app.query('begin read only'); await app.query("select set_config('app.is_platform_admin','true',true)");
  assert.equal((await app.query("select count(*)::int n from app.assistant_jobs where status in ('queued','running')")).rows[0].n, 0);
  const present = (await app.query("select to_regclass('app.construction_report_versions') present")).rows[0].present;
  const backup = { migrations: (await app.query('select * from app.__drizzle_migrations order by created_at')).rows,
    versions: present ? (await app.query('select * from app.construction_report_versions')).rows : [],
    functions: (await app.query("select p.oid::regprocedure::text name,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app' and p.prokind='f'")).rows };
  fs.writeFileSync(path.join(directory, 'before.private.json'), JSON.stringify(backup));
  audit.backupSha256 = createHash('sha256').update(fs.readFileSync(path.join(directory, 'before.private.json'))).digest('hex');
  audit.versionRowsBefore = backup.versions.length;
  await app.query('rollback');
  await ddl.query('begin');
  await ddl.query("select set_config('lock_timeout','5s',true),set_config('statement_timeout','120s',true)");
  await ddl.query("select pg_advisory_xact_lock(hashtext('construction_report_migration'))");
  for (const entry of selected) {
    const source = fs.readFileSync('drizzle/' + entry.tag + '.sql', 'utf8');
    const hash = createHash('sha256').update(source).digest('hex'); audit.source[entry.tag] = hash;
    const prior = (await ddl.query('select hash from app.__drizzle_migrations where created_at=$1', [entry.when])).rows[0];
    if (prior) { assert.equal(prior.hash, hash, 'Applied migration source must not drift'); continue; }
    // The unrelated dirty0102 source/journal entry is not part of this change.
    // Its already-applied timestamp is the original report migration boundary.
    const previousWhen = entry.idx === 103 ? 1793606400000 : journal.find(e => e.idx === entry.idx - 1).when;
    assert.ok((await ddl.query('select 1 from app.__drizzle_migrations where created_at=$1', [previousWhen])).rowCount, 'Apply only the bounded report dependency chain');
    await ddl.query(source);
    await ddl.query('insert into app.__drizzle_migrations(hash,created_at) values($1,$2)', [hash, entry.when]);
    audit.applied.push(entry.tag);
  }
  await ddl.query('commit');
  audit.columns = (await app.query("select column_name from information_schema.columns where table_schema='app' and table_name='construction_report_versions' and column_name like 'body%' order by column_name")).rows;
  assert.equal(audit.columns.length, 5);
  audit.rls = (await app.query("select relrowsecurity,relforcerowsecurity from pg_class where oid='app.construction_report_versions'::regclass")).rows[0];
  assert.ok(audit.rls.relrowsecurity && audit.rls.relforcerowsecurity);
  audit.passed = true;
  console.log(JSON.stringify({ target: audit.target, applied: audit.applied, columns: audit.columns.length, rls: audit.rls }));
} catch (error) {
  await ddl.query('rollback').catch(() => undefined); audit.error = error.code || error.message; process.exitCode = 1; console.error(audit.error);
} finally {
  audit.finishedAt = new Date().toISOString(); fs.writeFileSync(path.join(directory, 'audit.json'), JSON.stringify(audit, null, 2));
  await ddl.end().catch(() => undefined); await app.end().catch(() => undefined); await release();
}
