import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import {
  assertIsolatedCluster, connect, connectAdmin, dropDatabase, ensureRoles, fixtureConfig, provisionSource, urlFor,
} from './xiaok-migration-backup-fixture.mjs';

const adminRoot = fileURLToPath(new URL('../../', import.meta.url));
const powershell = path.join(process.env.SystemRoot || 'C:/Windows',
  'System32/WindowsPowerShell/v1.0/powershell.exe');
const config = fixtureConfig();
let source;
let preflightUrl;
let rolePassword;

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: adminRoot, encoding: 'utf8', timeout: 600_000, windowsHide: true,
    env: { ...process.env, ...options.env },
  });
}

function runPreflight() {
  return run(process.execPath, [
    'node_modules/tsx/dist/cli.mjs', 'scripts/xiaok-backup-role-preflight.ts',
    '--mode', 'isolated', '--database', source.database,
  ], { env: { XIAOK_BACKUP_ROLE_CHECK_URL: preflightUrl } });
}

before(async () => {
  if (!config) return;
  await assertIsolatedCluster(config);
  await ensureRoles(config);
  source = await provisionSource(config, 'role');
  const cleanup = await connectAdmin(config, source.database);
  try {
    await cleanup.query('DROP OWNED BY sfp_backup');
  } finally {
    await cleanup.end();
  }
  const admin = await connectAdmin(config);
  try {
    await admin.query('DROP ROLE IF EXISTS sfp_backup');
  } finally {
    await admin.end();
  }
  const psql = run(path.join(config.pgBin, 'psql.exe'), [
    '-h', '127.0.0.1', '-p', new URL(config.baseUrl).port, '-U', 'postgres', '-d', source.database,
    '-v', 'ON_ERROR_STOP=1', '-v', `backup_database=${source.database}`,
    '-f', path.join(adminRoot, 'scripts/sql/xiaok-create-backup-role.sql'),
  ], { env: { PGPASSWORD: config.superuserPassword } });
  assert.equal(psql.status, 0, psql.stderr || psql.stdout);
  rolePassword = config.passwords.sfp_backup;
  const roleAdmin = await connectAdmin(config, source.database);
  try {
    await roleAdmin.query(`ALTER ROLE sfp_backup PASSWORD ${roleAdmin.escapeLiteral(rolePassword)}`);
  } finally {
    await roleAdmin.end();
  }
  preflightUrl = urlFor(config, source.database, 'sfp_app', config.passwords.sfp_app);
});

after(async () => {
  if (!config || !source) return;
  await dropDatabase(config, source.database).catch(() => undefined);
});

const live = (name, fn) => test(name, { skip: !config, timeout: 600_000 }, fn);

live('the formal SQL creates the least-privilege role with complete read coverage', async () => {
  const admin = await connectAdmin(config, source.database);
  try {
    const { rows: [role] } = await admin.query(`
      SELECT rolcanlogin, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication
      FROM pg_roles WHERE rolname='sfp_backup'`);
    assert.deepEqual(role, {
      rolcanlogin: true, rolsuper: false, rolbypassrls: true,
      rolcreatedb: false, rolcreaterole: false, rolreplication: false,
    });
    const { rows: [membership] } = await admin.query(`
      SELECT pg_has_role('sfp_backup','sfp_owner','MEMBER') AS owner_member,
        pg_has_role('sfp_backup','sfp_migrator','MEMBER') AS migrator_member`);
    assert.deepEqual(membership, { owner_member: false, migrator_member: false });
    const { rows: [coverage] } = await admin.query(`
      WITH seqs AS MATERIALIZED (
        SELECT oid FROM pg_class
        WHERE relnamespace='app'::regnamespace AND relkind='S'
      )
      SELECT
        (SELECT count(*)::int FROM pg_class c WHERE c.relnamespace='app'::regnamespace
          AND c.relkind IN ('r','p') AND NOT c.relispartition
          AND NOT has_table_privilege('sfp_backup', c.oid, 'SELECT')) AS missing_tables,
        (SELECT count(*)::int FROM seqs s
          WHERE NOT has_sequence_privilege('sfp_backup', s.oid, 'SELECT')) AS missing_sequences,
        (SELECT count(*)::int FROM pg_class c WHERE c.relnamespace='app'::regnamespace
          AND c.relkind IN ('r','p','S') AND pg_get_userbyid(c.relowner)='sfp_backup') AS owned`);
    assert.deepEqual(coverage, { missing_tables: 0, missing_sequences: 0, owned: 0 });
  } finally {
    await admin.end();
  }
});

live('sfp_backup bypasses FORCE RLS while sfp_app stays tenant-limited', async () => {
  const backup = await connect(config, source.database, 'sfp_backup', rolePassword);
  const app = await connect(config, source.database, 'sfp_app', config.passwords.sfp_app);
  try {
    assert.equal((await backup.query(
      'SELECT count(*)::int AS n FROM app.construction_stage_reminders',
    )).rows[0].n, 2);
    const setTenant = id => app.query(
      "SELECT set_config('app.current_enterprise_id',$1,false), set_config('app.is_platform_admin','false',false)",
      [String(id)],
    );
    await setTenant(1454);
    assert.equal((await app.query('SELECT count(*)::int AS n FROM app.construction_stage_reminders')).rows[0].n, 1);
    await setTenant(1455);
    assert.equal((await app.query('SELECT count(*)::int AS n FROM app.construction_stage_reminders')).rows[0].n, 1);
  } finally {
    await backup.end();
    await app.end();
  }
});

live('sfp_backup cannot write, truncate, DDL or modify the migration ledger', async () => {
  const backup = await connect(config, source.database, 'sfp_backup', rolePassword);
  try {
    await assert.rejects(backup.query("INSERT INTO app.users(nickname) VALUES ('forbidden')"), { code: '42501' });
    await assert.rejects(backup.query("UPDATE app.users SET nickname='forbidden' WHERE id=1"), { code: '42501' });
    await assert.rejects(backup.query('DELETE FROM app.users WHERE id=1'), { code: '42501' });
    await assert.rejects(backup.query('TRUNCATE app.users'), { code: '42501' });
    await assert.rejects(backup.query('CREATE TABLE app.i797_forbidden (id integer)'), { code: '42501' });
    await assert.rejects(backup.query('ALTER TABLE app.users ADD COLUMN i797_forbidden integer'), { code: '42501' });
    await assert.rejects(backup.query('DROP TABLE app.users'), { code: '42501' });
    await assert.rejects(
      backup.query("INSERT INTO app.__drizzle_migrations(hash,created_at) VALUES ('forbidden',1)"),
      { code: '42501' },
    );
  } finally {
    await backup.end();
  }
});

live('new sfp_migrator objects receive SELECT-only default privileges', async () => {
  const migrator = await connect(config, source.database, 'sfp_migrator', config.passwords.sfp_migrator);
  const admin = await connectAdmin(config, source.database);
  try {
    await migrator.query('CREATE TABLE app.i797_default_probe (id integer)');
    await migrator.query('CREATE SEQUENCE app.i797_default_probe_seq');
    const { rows: [privileges] } = await admin.query(`
      SELECT has_table_privilege('sfp_backup','app.i797_default_probe','SELECT') AS table_select,
        has_table_privilege('sfp_backup','app.i797_default_probe','INSERT') AS table_insert,
        has_sequence_privilege('sfp_backup','app.i797_default_probe_seq','SELECT') AS sequence_select`);
    assert.deepEqual(privileges, { table_select: true, table_insert: false, sequence_select: true });
  } finally {
    await migrator.query('DROP TABLE IF EXISTS app.i797_default_probe').catch(() => undefined);
    await migrator.query('DROP SEQUENCE IF EXISTS app.i797_default_probe_seq').catch(() => undefined);
    await migrator.end();
    await admin.end();
  }
});

live('the backup-role preflight passes for the formal role and fails closed on regressions', async () => {
  const pass = runPreflight();
  assert.equal(pass.status, 0, pass.stdout || pass.stderr);
  const passed = JSON.parse(pass.stdout);
  assert.equal(passed.status, 'passed');
  assert.ok(passed.checks.every(check => check.passed));

  const admin = await connectAdmin(config, source.database);
  try {
    await admin.query('ALTER ROLE sfp_backup NOBYPASSRLS');
    const noBypass = runPreflight();
    assert.notEqual(noBypass.status, 0);
    const failedBypass = JSON.parse(noBypass.stdout);
    assert.equal(failedBypass.status, 'failed');
    assert.ok(failedBypass.failures.some(failure => failure.code === 'rolbypassrls_true'));
  } finally {
    await admin.query('ALTER ROLE sfp_backup BYPASSRLS').catch(() => undefined);
    await admin.end();
  }

  const revoke = await connectAdmin(config, source.database);
  try {
    await revoke.query('REVOKE SELECT ON app.enterprises FROM sfp_backup');
    const noSelect = runPreflight();
    assert.notEqual(noSelect.status, 0);
    const failedSelect = JSON.parse(noSelect.stdout);
    assert.equal(failedSelect.status, 'failed');
    assert.ok(failedSelect.failures.some(failure => failure.code === 'all_tables_selectable'));
  } finally {
    await revoke.query('GRANT SELECT ON app.enterprises TO sfp_backup').catch(() => undefined);
    await revoke.end();
  }
});

live('the directory preparation script is parseable, idempotent and fails closed', async () => {
  const script = path.join(adminRoot, 'scripts/prepare-xiaok-backup-directory.ps1');
  const parse = run(powershell, ['-NoProfile', '-NonInteractive', '-Command',
    `$errors=$null; [void][System.Management.Automation.Language.Parser]::ParseFile('${script.replaceAll("'", "''")}',[ref]$null,[ref]$errors); if ($errors.Count -gt 0) { $errors | ForEach-Object { $_.Message }; exit 1 }`]);
  assert.equal(parse.status, 0, parse.stderr || parse.stdout);

  const safe = `C:\\i797-safe-${Date.now()}`;
  const first = run(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', script, '-Directory', safe, '-MinFreeGB', '1']);
  assert.equal(first.status, 0, first.stderr || first.stdout);
  const firstBody = JSON.parse(first.stdout);
  assert.equal(firstBody.Status, 'passed');
  assert.equal(firstBody.CreatedBackupFiles, false);
  assert.ok(!firstBody.Access.some(entry =>
    /Authenticated Users|Everyone/i.test(entry.Identity)
    && /Modify|FullControl|Write|CreateFiles|AppendData|Delete/i.test(entry.Rights)));

  const second = run(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', script, '-Directory', safe, '-MinFreeGB', '1']);
  assert.equal(second.status, 0, second.stderr || second.stdout);
  assert.equal(JSON.parse(second.stdout).Directory, safe);

  const noSpace = run(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', script, '-Directory', `${safe}-nospace`, '-MinFreeGB', '100000']);
  assert.notEqual(noSpace.status, 0);
  assert.equal(await fs.stat(`${safe}-nospace`).catch(() => null), null);

  const inside = path.join(adminRoot, 'tmp', `i797-inside-${Date.now()}`);
  const insideRun = run(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', script, '-Directory', inside, '-MinFreeGB', '1']);
  assert.notEqual(insideRun.status, 0);
  assert.equal(await fs.stat(inside).catch(() => null), null);

  await fs.rm(safe, { recursive: true, force: true }).catch(() => undefined);
  await fs.rm(`${safe}-nospace`, { recursive: true, force: true }).catch(() => undefined);
  await fs.rm(inside, { recursive: true, force: true }).catch(() => undefined);
});
