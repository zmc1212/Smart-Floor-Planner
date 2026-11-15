import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import pg from 'pg';
import {
  assertIsolatedCluster, connectAdmin, dropDatabase, ensureRoles, fixtureConfig, provisionSource, urlFor,
} from './xiaok-migration-backup-fixture.mjs';

const adminRoot = fileURLToPath(new URL('../../', import.meta.url));
const backupScript = path.join(adminRoot, 'scripts/xiaok-migration-backup.mjs');
const restoreScript = path.join(adminRoot, 'scripts/xiaok-migration-restore-verify.mjs');
const config = fixtureConfig();
const restoreBaseUrl = process.env.XIAOK_I798_RESTORE_PG_URL;
const restorePassword = 'I798Restore_local_20261115';
let source;
let workDir;

function restoreUrl(role, password, database = 'postgres') {
  const url = new URL(restoreBaseUrl);
  url.username = role;
  url.password = password;
  url.pathname = `/${database}`;
  return url.href;
}

async function connectRestoreAdmin(database = 'postgres') {
  const client = new pg.Client({
    connectionString: restoreUrl('postgres', config.superuserPassword, database),
    connectionTimeoutMillis: 8000,
  });
  await client.connect();
  return client;
}

async function dropRestoreDatabase(name) {
  const admin = await connectRestoreAdmin();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: adminRoot, encoding: 'utf8', timeout: 600_000, windowsHide: true,
    env: { ...process.env, ...options.env },
  });
}

async function secureDirectory(directory) {
  await fs.mkdir(directory, { recursive: true });
  if (process.platform === 'win32') {
    const result = spawnSync('icacls', [
      directory, '/inheritance:r', '/grant:r',
      `${process.env.USERNAME}:(OI)(CI)F`, 'SYSTEM:(OI)(CI)F',
    ], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  } else {
    await fs.chmod(directory, 0o700);
  }
}

async function runBackup(label) {
  const outputDir = path.join(workDir, label);
  await secureDirectory(outputDir);
  const result = run(process.execPath, [
    backupScript, '--mode', 'isolated', '--database', source.database,
    '--output-dir', outputDir, '--pg-bin', config.pgBin, '--label', label,
  ], { env: { XIAOK_MIGRATION_BACKUP_URL: urlFor(
    config, source.database, 'sfp_backup', config.passwords.sfp_backup,
  ) } });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const body = JSON.parse(result.stdout);
  assert.equal(body.status, 'passed');
  return { outputDir, backupId: body.backupId,
    manifestPath: path.join(outputDir, body.backupId, 'migration-backup-manifest.json') };
}

function runRestore(manifestPath, target, { role = 'sfp_restore', password = restorePassword, keep = false } = {}) {
  const args = [
    restoreScript, '--manifest', manifestPath, '--target-database', target,
    '--mode', 'isolated', '--pg-bin', config.pgBin,
  ];
  if (keep) args.push('--keep-target');
  const result = run(process.execPath, args, {
    env: { XIAOK_MIGRATION_RESTORE_URL: restoreUrl(role, password) },
  });
  return { exitCode: result.status, body: JSON.parse(result.stdout), stderr: result.stderr };
}

async function createMixedOwnerObjects() {
  const admin = await connectAdmin(config, source.database);
  try {
    await admin.query(`
      SET ROLE sfp_migrator;
      CREATE TABLE app.i798_owner_table (id integer PRIMARY KEY, note text);
      INSERT INTO app.i798_owner_table VALUES (1, 'synthetic');
      CREATE SEQUENCE app.i798_owner_seq START 10;
      CREATE FUNCTION app.i798_owner_fn() RETURNS integer LANGUAGE sql IMMUTABLE AS 'SELECT 1';
      RESET ROLE;
      ALTER TABLE app.i798_owner_table OWNER TO sfp_owner;
      ALTER SEQUENCE app.i798_owner_seq OWNER TO sfp_owner;
      ALTER FUNCTION app.i798_owner_fn() OWNER TO sfp_owner;
      GRANT CREATE ON SCHEMA app TO sfp_owner;
      GRANT SELECT ON app.i798_owner_table TO sfp_auditor;
    `);
  } finally {
    await admin.end();
  }
}

before(async () => {
  if (!config || !restoreBaseUrl) return;
  await assertIsolatedCluster(config);
  await ensureRoles(config);
  source = await provisionSource(config, 'restore_role');
  workDir = await fs.mkdtemp(path.join(process.env.TEMP || 'C:/i798-temp', 'xiaok-i798-'));
  await secureDirectory(workDir);

  // Remove any accidental sfp_restore from the source cluster: this role must
  // exist only in the independent restore cluster.
  const sourceAdmin = await connectAdmin(config);
  try {
    await sourceAdmin.query('DROP OWNED BY sfp_restore').catch(() => undefined);
    await sourceAdmin.query('DROP ROLE IF EXISTS sfp_restore');
  } finally {
    await sourceAdmin.end();
  }

  const restoreAdmin = await connectRestoreAdmin();
  try {
    for (const name of [
      'xiaok_migration_restore_i798_standard',
      'xiaok_migration_restore_i798_mixed',
      'xiaok_migration_restore_i798_nocreate',
      'xiaok_migration_restore_i798_nobypass',
      'xiaok_migration_restore_i798_backup_reject',
      'xiaok_migration_restore_i798_role_test',
    ]) {
      await restoreAdmin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    }
    await restoreAdmin.query('DROP OWNED BY sfp_restore').catch(() => undefined);
    await restoreAdmin.query('DROP ROLE IF EXISTS sfp_restore');
  } finally {
    await restoreAdmin.end();
  }
  const psql = run(path.join(config.pgBin, 'psql.exe'), [
    '-h', '127.0.0.1', '-p', new URL(restoreBaseUrl).port, '-U', 'postgres', '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-v', 'restore_owner_role=sfp_migrator',
    '-f', path.join(adminRoot, 'scripts/sql/xiaok-create-restore-role.sql'),
  ], { env: { PGPASSWORD: config.superuserPassword } });
  assert.equal(psql.status, 0, psql.stderr || psql.stdout);
  const roleAdmin = await connectRestoreAdmin();
  try {
    await roleAdmin.query(`ALTER ROLE sfp_restore PASSWORD ${roleAdmin.escapeLiteral(restorePassword)}`);
    // A non-superuser alternate owner needs schema access to accept ownership.
    await roleAdmin.query('GRANT sfp_migrator TO sfp_owner');
  } finally {
    await roleAdmin.end();
  }
});

after(async () => {
  if (!config || !source) return;
  await dropDatabase(config, source.database).catch(() => undefined);
  await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
});

const live = (name, fn) => test(name, {
  skip: !config || !restoreBaseUrl, timeout: 900_000,
}, fn);

live('sfp_restore attributes are maintenance-only and it cannot connect to the source', async () => {
  const admin = await connectRestoreAdmin();
  try {
    const { rows: [role] } = await admin.query(`
      SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
      FROM pg_roles WHERE rolname='sfp_restore'`);
    assert.deepEqual(role, {
      rolcanlogin: true, rolsuper: false, rolcreatedb: true,
      rolcreaterole: false, rolreplication: false, rolbypassrls: true,
    });
    const { rows: [membership] } = await admin.query(`
      SELECT pg_has_role('sfp_restore','sfp_migrator','MEMBER') AS migrator_member`);
    assert.deepEqual(membership, { migrator_member: true });
  } finally {
    await admin.end();
  }
  const denied = new pg.Client({
    connectionString: urlFor(config, source.database, 'sfp_restore', restorePassword),
  });
  await assert.rejects(denied.connect(), error => ['42501', '3D000', '28P01'].includes(error.code));
  await denied.end().catch(() => undefined);
});

live('sfp_restore fully restores a standard archive without superuser', async () => {
  const backup = await runBackup('standard');
  const target = 'xiaok_migration_restore_i798_standard';
  const result = runRestore(backup.manifestPath, target, { keep: true });
  assert.equal(result.exitCode, 0, result.stderr || JSON.stringify(result.body));
  assert.equal(result.body.status, 'passed');
  assert.equal(result.body.checks.full_restore_passed, true);
  assert.equal(result.body.detail.verified.ledger.count, 128);
  const targetAdmin = await connectRestoreAdmin(target);
  try {
    const { rows: [ledger] } = await targetAdmin.query(
      'SELECT count(*)::int AS n FROM app.__drizzle_migrations',
    );
    assert.equal(ledger.n, 128);
    const { rows: [defaultConfig] } = await targetAdmin.query(`SELECT notification_config::text AS text
      FROM app.platform_configs WHERE key='default'`);
    assert.equal(typeof defaultConfig.text, 'string');
  } finally {
    await targetAdmin.end();
  }
  await dropRestoreDatabase(target);
});

live('mixed object ownership requires membership in each non-superuser owner role', async () => {
  await createMixedOwnerObjects();
  const backup = await runBackup('mixed');
  const target = 'xiaok_migration_restore_i798_mixed';

  const withoutOwner = runRestore(backup.manifestPath, target);
  assert.notEqual(withoutOwner.exitCode, 0);
  assert.notEqual(withoutOwner.body.status, 'passed');
  assert.ok(withoutOwner.body.failures.length > 0);

  const admin = await connectRestoreAdmin();
  try {
    await admin.query('GRANT sfp_owner TO sfp_restore');
  } finally {
    await admin.end();
  }
  const withOwner = runRestore(backup.manifestPath, target, { keep: true });
  assert.equal(withOwner.exitCode, 0, withOwner.stderr || JSON.stringify(withOwner.body));
  assert.equal(withOwner.body.status, 'passed');
  assert.equal(withOwner.body.checks.full_restore_passed, true);

  const targetAdmin = await connectRestoreAdmin(target);
  try {
    const { rows: [owners] } = await targetAdmin.query(`
      SELECT pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='app.i798_owner_table'::regclass)) AS table_owner,
        pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='app.i798_owner_seq'::regclass)) AS sequence_owner,
        pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid='app.i798_owner_fn()'::regprocedure)) AS function_owner,
        has_table_privilege('sfp_auditor','app.i798_owner_table','SELECT') AS auditor_select`);
    assert.deepEqual(owners, {
      table_owner: 'sfp_owner', sequence_owner: 'sfp_owner',
      function_owner: 'sfp_owner', auditor_select: true,
    });
  } finally {
    await targetAdmin.end();
  }
  await dropRestoreDatabase(target);
});

live('CREATEDB and BYPASSRLS are required by the current restore tool', async () => {
  const backup = await runBackup('requirements');
  const admin = await connectRestoreAdmin();
  try {
    await admin.query('ALTER ROLE sfp_restore NOCREATEDB');
    const noCreate = runRestore(backup.manifestPath, 'xiaok_migration_restore_i798_nocreate');
    assert.notEqual(noCreate.exitCode, 0);
    assert.notEqual(noCreate.body.status, 'passed');
    await admin.query('ALTER ROLE sfp_restore CREATEDB');

    await admin.query('ALTER ROLE sfp_restore NOBYPASSRLS');
    const noBypass = runRestore(backup.manifestPath, 'xiaok_migration_restore_i798_nobypass');
    assert.notEqual(noBypass.exitCode, 0);
    assert.notEqual(noBypass.body.status, 'passed');
    await admin.query('ALTER ROLE sfp_restore BYPASSRLS');
  } finally {
    await admin.query('ALTER ROLE sfp_restore CREATEDB BYPASSRLS').catch(() => undefined);
    await admin.end();
  }
});

live('the restore tool rejects the backup role and pg_restore --role is not a substitute for owner membership', async () => {
  const backup = await runBackup('role-boundary');
  const rejected = runRestore(backup.manifestPath, 'xiaok_migration_restore_i798_backup_reject', {
    role: 'sfp_backup', password: config.passwords.sfp_backup,
  });
  assert.notEqual(rejected.exitCode, 0);
  assert.equal(rejected.body.status, 'rejected');
  assert.ok(rejected.body.failures.some(failure => failure.code === 'backup_role_cannot_restore'));

  const target = 'xiaok_migration_restore_i798_role_test';
  const admin = await connectRestoreAdmin();
  try {
    await admin.query(`CREATE DATABASE ${target}`);
    await admin.query(`COMMENT ON DATABASE ${target} IS 'xiaok-migration-restore-disposable'`);
    await admin.query(`GRANT CONNECT,CREATE ON DATABASE ${target} TO sfp_restore,sfp_migrator,sfp_owner`);
  } finally {
    await admin.end();
  }
  const restore = run(path.join(config.pgBin, 'pg_restore.exe'), [
    '--no-password', '--single-transaction', '--exit-on-error',
    '--host', '127.0.0.1', '--port', new URL(restoreBaseUrl).port,
    '--username', 'sfp_restore', '--dbname', target, '--role', 'sfp_migrator',
    path.join(path.dirname(backup.manifestPath), 'database.dump'),
  ], { env: { PGPASSWORD: restorePassword } });
  assert.notEqual(restore.status, 0);
  await dropRestoreDatabase(target);
});
