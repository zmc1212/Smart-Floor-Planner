import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import pg from 'pg';
import {
  ARCHIVE_FILE, MANIFEST_FILE, computeManifestDigest, missingTableDataEntries,
  parseSha256File, parseTocEntries, resolveApprovedDevelopmentTarget, resolveIsolatedTarget,
  sha256File, validateManifestShape,
} from '../xiaok-migration-backup.mjs';
import {
  assertIsolatedCluster, connect, dropDatabase, ensureRoles, fixtureConfig, provisionSource, urlFor,
} from './xiaok-migration-backup-fixture.mjs';

const adminRoot = fileURLToPath(new URL('../../', import.meta.url));
const script = path.join(adminRoot, 'scripts/xiaok-migration-backup.mjs');
const config = fixtureConfig();

function sampleManifest() {
  return {
    version: 1,
    backupId: 'xiaok-mig-20260101t000000000z-abcdef12',
    createdAt: '2026-01-01T00:00:00.000Z',
    sourceDatabase: 'xiaok_i749_sample',
    sourceHost: '127.0.0.1:55435',
    postgresqlVersion: '17.10',
    postgresqlVersionNumber: 170010,
    backupRole: { name: 'sfp_owner', rolsuper: false, rolbypassrls: true },
    migrationLedgerCount: 127,
    migrationLedgerDigest: 'a'.repeat(64),
    migrationLedgerLastId: 127,
    migrationLedgerLastTimestamp: 1795852800000,
    backupBytes: 1024,
    backupSha256: 'b'.repeat(64),
    pgDumpVersion: 'pg_dump (PostgreSQL) 17.10',
    pgRestoreVersion: 'pg_restore (PostgreSQL) 17.10',
    restoreListVerified: true,
    backupStatus: 'complete',
    archive: { file: ARCHIVE_FILE, bytes: 1024, sha256: 'b'.repeat(64) },
    dataSummary: [{ table: 'enterprises', rows: 2, digest: 'c'.repeat(32) }],
    relations: [{ name: 'enterprises', kind: 'r' }],
    rls: { rlsTableCount: 1, forcedRlsTableCount: 1, rlsTables: ['enterprises'], forcedRlsTables: ['enterprises'] },
    policies: { count: 1, digest: 'd'.repeat(64) },
    functions: { count: 0, digest: 'e'.repeat(64) },
    triggers: { count: 0, digest: 'f'.repeat(64) },
    schemaObjects: {
      columnCount: 1, columnDigest: '2'.repeat(64),
      constraintCount: 0, constraintDigest: '3'.repeat(64),
      indexCount: 0, indexDigest: '4'.repeat(64),
    },
    extensions: { count: 0, names: [], digest: '5'.repeat(64) },
    permissions: { digest: '1'.repeat(64), relationCount: 1, functionCount: 0 },
    historicalHashes: [],
    manifestDigest: '',
  };
}

test('only the approved development database, role and loopback port qualify', () => {
  const approved = 'postgresql://sfp_backup:synthetic%20password@localhost:5432/smart_floor_planner';
  assert.deepEqual(resolveApprovedDevelopmentTarget(approved)?.target, {
    hostname: 'localhost', connectionAddress: '127.0.0.1', port: 5432,
    database: 'smart_floor_planner', user: 'sfp_backup',
  });
  const legacy = approved.replace('sfp_backup', 'sfp_owner');
  assert.equal(resolveApprovedDevelopmentTarget(legacy), null);
  assert.equal(resolveApprovedDevelopmentTarget(legacy, { allowLegacyOwner: true })?.target.user, 'sfp_owner');
  assert.equal(resolveApprovedDevelopmentTarget(approved, { nodeEnv: 'production' }), null);
  for (const value of [
    undefined,
    approved.replace('localhost', 'db.example.test'),
    approved.replace(':5432', ':55435'),
    approved.replace('smart_floor_planner', 'xiaok_embedding_eval'),
    approved.replace('sfp_backup', 'sfp_app'),
    approved.replace('synthetic%20password@', ''),
    approved + '?options=unsafe',
  ]) {
    assert.equal(resolveApprovedDevelopmentTarget(value), null, String(value));
  }
});

test('isolated backup targets require a dynamic loopback port and a sandbox name', () => {
  const database = 'xiaok_i749_src_abcdef0123';
  const approved = `postgresql://sfp_backup:synthetic@127.0.0.1:55435/${database}`;
  assert.equal(resolveIsolatedTarget(approved, { database })?.target.port, 55435);
  assert.equal(resolveIsolatedTarget(approved.replace('sfp_backup', 'sfp_owner'), { database }), null);
  assert.equal(resolveIsolatedTarget(approved.replace('sfp_backup', 'sfp_owner'), {
    database, allowLegacyOwner: true,
  })?.target.user, 'sfp_owner');
  for (const value of [
    approved.replace(':55435', ':5432'),
    approved.replace(':55435', ':55432'),
    approved.replace('127.0.0.1', '192.168.10.54'),
    `postgresql://sfp_backup:synthetic@127.0.0.1:55435/smart_floor_planner`,
  ]) {
    const requested = value.includes('smart_floor_planner') ? 'smart_floor_planner' : database;
    assert.equal(resolveIsolatedTarget(value, { database: requested }), null, value);
  }
  assert.equal(resolveIsolatedTarget(approved, { database, nodeEnv: 'production' }), null);
});

test('the manifest digest is independent of key order and covers every recorded fact', () => {
  const manifest = sampleManifest();
  const digest = computeManifestDigest(manifest);
  const reordered = Object.fromEntries(Object.entries(manifest).reverse());
  assert.equal(computeManifestDigest(reordered), digest);
  manifest.migrationLedgerCount += 1;
  assert.notEqual(computeManifestDigest(manifest), digest);
});

test('manifest validation rejects missing fields, incomplete status and secret material', () => {
  const manifest = sampleManifest();
  manifest.manifestDigest = computeManifestDigest(manifest);
  assert.deepEqual(validateManifestShape(manifest), { ok: true, errors: [] });
  const missing = { ...manifest };
  delete missing.migrationLedgerDigest;
  assert.equal(validateManifestShape(missing).ok, false);
  const incomplete = { ...manifest, backupStatus: 'partial' };
  assert.ok(validateManifestShape(incomplete).errors.includes('backupStatus_not_complete'));
  const secret = { ...manifest, connectionString: 'postgresql://user:secret@host/db' };
  assert.ok(validateManifestShape(secret).errors.some(error => error.startsWith('forbidden_key:')));
});

test('the independent SHA-256 file and TOC helpers reject malformed input', () => {
  const digest = 'a'.repeat(64);
  assert.deepEqual(parseSha256File(`${digest}  database.dump\n`), { sha256: digest, file: 'database.dump' });
  assert.equal(parseSha256File('not-a-digest  database.dump'), null);
  assert.equal(parseSha256File(`${digest}  nested/database.dump`), null);
  const toc = [
    '1; 2615 16384 SCHEMA - app sfp_migrator',
    '2; 1259 16391 TABLE app enterprises sfp_migrator',
    '3; 0 16391 TABLE DATA app enterprises sfp_migrator',
    '4; 1259 16392 TABLE app empty_table sfp_migrator',
  ].join('\n');
  const entries = parseTocEntries(toc);
  assert.equal(entries.length, 4);
  assert.deepEqual(missingTableDataEntries(entries, [
    { table: 'enterprises', rows: 2 }, { table: 'empty_table', rows: 0 },
  ]), []);
  assert.deepEqual(missingTableDataEntries(entries, [{ table: 'missing_table', rows: 1 }]), ['missing_table']);
});

function runBackup(database, outputDir, {
  role = config?.passwords.sfp_backup ? 'sfp_backup' : 'sfp_owner',
  password = config?.passwords[config?.passwords.sfp_backup ? 'sfp_backup' : 'sfp_owner'],
  label, extraEnv = {}, allowLegacy = !config?.passwords.sfp_backup, minFreeBytes,
} = {}) {
  const args = [
    script, '--mode', 'isolated', '--database', database,
    '--output-dir', outputDir, '--pg-bin', config.pgBin,
  ];
  if (label) args.push('--label', label);
  if (allowLegacy) args.push('--allow-legacy-owner');
  if (minFreeBytes !== undefined) args.push('--min-free-bytes', String(minFreeBytes));
  const result = spawnSync(process.execPath, args, {
    cwd: adminRoot,
    env: {
      ...process.env,
      ...extraEnv,
      PG_BIN: config.pgBin,
      XIAOK_MIGRATION_BACKUP_URL: urlFor(config, database, role, password),
    },
    encoding: 'utf8',
    timeout: 600_000,
    windowsHide: true,
  });
  let body;
  try {
    body = JSON.parse(result.stdout);
  } catch {
    body = { status: 'unparsed', stdout: result.stdout, stderr: result.stderr };
  }
  return { exitCode: result.status, body, stderr: result.stderr };
}

async function directorySnapshot(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = {};
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    files[entry.name] = await sha256File(path.join(directory, entry.name));
  }
  return { names: entries.map(entry => entry.name).sort(), files };
}

async function secureDirectory(directory) {
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

async function makeUnsafeDirectory(directory) {
  await fs.mkdir(directory, { recursive: true });
  if (process.platform === 'win32') {
    const result = spawnSync('icacls', [
      directory, '/inheritance:r', '/grant:r', 'Everyone:(OI)(CI)M', 'SYSTEM:(OI)(CI)F',
    ], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  } else {
    await fs.chmod(directory, 0o777);
  }
}

let source;
let workDir;
let backupDirectory;
let manifest;

const live = (name, fn) => test(name, { skip: !config, timeout: 600_000 }, fn);
const liveWithBackupRole = (name, fn) =>
  test(name, { skip: !config?.passwords.sfp_backup, timeout: 600_000 }, fn);

before(async () => {
  if (!config) return;
  await assertIsolatedCluster(config);
  await ensureRoles(config);
  source = await provisionSource(config, 'backup');
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaok-i749-backup-'));
  await secureDirectory(workDir);
  const run = runBackup(source.database, workDir);
  assert.equal(run.body.status, 'passed', JSON.stringify(run.body));
  backupDirectory = path.join(workDir, run.body.backupId);
  manifest = JSON.parse(await fs.readFile(path.join(backupDirectory, MANIFEST_FILE), 'utf8'));
});

after(async () => {
  if (!config) return;
  if (workDir) await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  if (source) await dropDatabase(config, source.database).catch(() => undefined);
});

live('a normal backup writes a readable custom archive and a complete manifest', async () => {
  const stats = await fs.stat(path.join(backupDirectory, ARCHIVE_FILE));
  assert.ok(stats.size > 0);
  assert.equal(manifest.backupStatus, 'complete');
  assert.equal(manifest.sourceDatabase, source.database);
  const expectedRole = config.passwords.sfp_backup ? 'sfp_backup' : 'sfp_owner';
  assert.equal(manifest.backupRole.name, expectedRole);
  assert.equal(manifest.backupRole.profile, config.passwords.sfp_backup ? 'least_privilege' : 'legacy_owner');
  assert.equal(manifest.backupRole.rolsuper, false);
  assert.equal(manifest.backupRole.rolbypassrls, true);
  assert.equal(manifest.backupRole.fullReadProof, 'bypassrls');
  assert.equal(manifest.archive.ownerMode, 'full');
  assert.equal(manifest.archive.privilegesMode, 'full');
  assert.equal(validateManifestShape(manifest).ok, true);
});

live('the manifest records the ledger, RLS and synthetic business data facts', () => {
  assert.equal(manifest.migrationLedgerCount, 128);
  assert.equal(manifest.migrationLedgerLastId, 128);
  assert.equal(manifest.latestMigration.tag, '0131_platform_notification_config_not_null');
  assert.match(manifest.latestMigration.hash, /^[0-9a-f]{64}$/);
  assert.match(manifest.migrationLedgerDigest, /^[0-9a-f]{64}$/);
  assert.deepEqual(manifest.historicalHashes.map(entry => entry.tag),
    ['0021_platform_notification_config', '0051_staff_referrer_network']);
  assert.ok(manifest.historicalHashes.every(entry => entry.matchesAllowlist));
  assert.equal(manifest.rls.forcedRlsTableCount, manifest.rls.forcedRlsTables.length);
  assert.ok(manifest.rls.forcedRlsTableCount > 0);
  assert.ok(manifest.policies.count > 0);
  const enterprises = manifest.dataSummary.find(row => row.table === 'enterprises');
  const reminders = manifest.dataSummary.find(row => row.table === 'construction_stage_reminders');
  assert.equal(enterprises.rows, 2);
  assert.equal(reminders.rows, 2);
  assert.ok(manifest.dataSummary.every(row => /^([0-9a-f]{32})?$/.test(row.digest)));
  assert.ok(manifest.schemaObjects.columnCount > 0);
  assert.ok(manifest.schemaObjects.constraintCount > 0);
  assert.ok(manifest.schemaObjects.indexCount > 0);
  assert.ok(manifest.extensions.names.includes('btree_gist'));
  assert.equal(manifest.restoreListVerified, true);
  assert.ok(manifest.restoreList.tableDataEntries >= manifest.dataSummary.filter(row => row.rows > 0).length);
});

live('the independent SHA-256 file matches both the archive and the manifest', async () => {
  const shaText = await fs.readFile(path.join(backupDirectory, `${ARCHIVE_FILE}.sha256`), 'utf8');
  const parsed = parseSha256File(shaText);
  assert.equal(parsed.file, ARCHIVE_FILE);
  assert.equal(parsed.sha256, manifest.backupSha256);
  assert.equal(await sha256File(path.join(backupDirectory, ARCHIVE_FILE)), manifest.backupSha256);
});

live('an unapproved backup role is rejected before any backup', async () => {
  const names = (await fs.readdir(workDir)).sort();
  const run = runBackup(source.database, workDir, {
    role: 'sfp_app', password: config.passwords.sfp_app, label: 'unapproved', allowLegacy: false,
  });
  assert.notEqual(run.exitCode, 0);
  assert.equal(run.body.status, 'blocked');
  assert.equal(run.body.reason, 'unapproved_backup_role');
  assert.deepEqual((await fs.readdir(workDir)).sort(), names);
});

live('a mid-backup permission failure leaves the verified backup untouched', async () => {
  const before = await directorySnapshot(backupDirectory);
  const rootBefore = (await fs.readdir(workDir)).sort();
  const admin = new pg.Client({
    connectionString: urlFor(config, source.database, config.superuser, config.superuserPassword),
  });
  await admin.connect();
  const activeBackupRole = config.passwords.sfp_backup ? 'sfp_backup' : 'sfp_owner';
  try {
    await admin.query(`REVOKE SELECT ON app.enterprises FROM ${activeBackupRole}`);
    const run = runBackup(source.database, workDir, { label: 'failure' });
    assert.notEqual(run.exitCode, 0);
    assert.equal(run.body.status, 'failed');
    assert.match(run.body.reason, /backup_role_missing_table_select/);
    assert.deepEqual((await fs.readdir(workDir)).sort(), rootBefore);
    assert.deepEqual(await directorySnapshot(backupDirectory), before);
    assert.ok(!(await fs.readdir(workDir)).some(name => name.startsWith('.tmp-')));
  } finally {
    await admin.query(`GRANT SELECT ON app.enterprises TO ${activeBackupRole}`).catch(() => undefined);
    await admin.end();
  }
});

live('a pg_dump failure removes its temporary directory and preserves the verified backup', async () => {
  const before = await directorySnapshot(backupDirectory);
  const rootBefore = (await fs.readdir(workDir)).sort();
  const run = runBackup(source.database, workDir, {
    label: 'dump-failure', extraEnv: { PGOPTIONS: '-c xiaok_i749_nonexistent_guc=1' },
  });
  assert.notEqual(run.exitCode, 0);
  assert.equal(run.body.status, 'failed');
  assert.match(run.body.reason, /pg_dump_failed/);
  assert.deepEqual((await fs.readdir(workDir)).sort(), rootBefore);
  assert.deepEqual(await directorySnapshot(backupDirectory), before);
  assert.ok(!(await fs.readdir(workDir)).some(name => name.startsWith('.tmp-')));
});

liveWithBackupRole('a least-privilege role without BYPASSRLS fails closed', async () => {
  const admin = new pg.Client({
    connectionString: urlFor(config, source.database, config.superuser, config.superuserPassword),
  });
  await admin.connect();
  const names = (await fs.readdir(workDir)).sort();
  try {
    await admin.query('ALTER ROLE sfp_backup NOBYPASSRLS');
    const run = runBackup(source.database, workDir, { label: 'no-bypass' });
    assert.notEqual(run.exitCode, 0);
    assert.equal(run.body.status, 'failed');
    assert.match(run.body.reason, /backup_role_missing_bypass_rls/);
    assert.deepEqual((await fs.readdir(workDir)).sort(), names);
  } finally {
    await admin.query('ALTER ROLE sfp_backup BYPASSRLS').catch(() => undefined);
    await admin.end();
  }
});

live('the legacy sfp_owner role requires the explicit risk confirmation', async () => {
  const names = (await fs.readdir(workDir)).sort();
  const without = runBackup(source.database, workDir, {
    role: 'sfp_owner', password: config.passwords.sfp_owner, allowLegacy: false, label: 'legacy-no',
  });
  assert.notEqual(without.exitCode, 0);
  assert.equal(without.body.status, 'blocked');
  assert.equal(without.body.reason, 'legacy_backup_role_requires_explicit_confirmation');
  assert.deepEqual((await fs.readdir(workDir)).sort(), names);

  const withFlag = runBackup(source.database, workDir, {
    role: 'sfp_owner', password: config.passwords.sfp_owner, allowLegacy: true, label: 'legacy-yes',
  });
  assert.equal(withFlag.body.status, 'passed', JSON.stringify(withFlag.body));
  const legacyManifest = JSON.parse(await fs.readFile(
    path.join(workDir, withFlag.body.backupId, MANIFEST_FILE), 'utf8',
  ));
  assert.equal(legacyManifest.backupRole.name, 'sfp_owner');
  assert.equal(legacyManifest.backupRole.profile, 'legacy_owner');
  assert.equal(legacyManifest.backupRole.legacyOwnerRiskConfirmed, true);
  assert.equal(legacyManifest.backupRole.rolsuper, false);
  assert.equal(legacyManifest.backupRole.superuserConfirmed, false);
});

liveWithBackupRole('sfp_backup reads every tenant but cannot write, DDL or touch the migration ledger', async () => {
  const client = await connect(config, source.database, 'sfp_backup', config.passwords.sfp_backup);
  try {
    const { rows: [role] } = await client.query(`
      SELECT rolcanlogin, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication
      FROM pg_roles WHERE rolname=current_user`);
    assert.deepEqual(role, {
      rolcanlogin: true, rolsuper: false, rolbypassrls: true,
      rolcreatedb: false, rolcreaterole: false, rolreplication: false,
    });
    const { rows: [membership] } = await client.query(`
      SELECT pg_has_role(current_user,'sfp_owner','MEMBER') AS owner_member,
        pg_has_role(current_user,'sfp_migrator','MEMBER') AS migrator_member`);
    assert.deepEqual(membership, { owner_member: false, migrator_member: false });
    const { rows: [reminders] } = await client.query(
      'SELECT count(*)::int AS n FROM app.construction_stage_reminders',
    );
    assert.equal(reminders.n, 2);
    await assert.rejects(client.query("INSERT INTO app.users(nickname) VALUES ('forbidden')"), { code: '42501' });
    await assert.rejects(client.query("UPDATE app.users SET nickname='forbidden' WHERE id=1"), { code: '42501' });
    await assert.rejects(client.query('DELETE FROM app.users WHERE id=1'), { code: '42501' });
    await assert.rejects(client.query('CREATE TABLE app.i796_forbidden (id integer)'), { code: '42501' });
    await assert.rejects(client.query('ALTER TABLE app.users ADD COLUMN i796_forbidden integer'), { code: '42501' });
    await assert.rejects(
      client.query("INSERT INTO app.__drizzle_migrations(hash,created_at) VALUES ('forbidden',1)"),
      { code: '42501' },
    );
  } finally {
    await client.end();
  }
});

live('sfp_app remains tenant-limited while the backup role bypasses RLS', async () => {
  const app = await connect(config, source.database, 'sfp_app', config.passwords.sfp_app);
  try {
    const setTenant = id => app.query(
      "SELECT set_config('app.current_enterprise_id',$1,false), set_config('app.is_platform_admin','false',false)",
      [String(id)],
    );
    await setTenant(1454);
    assert.equal((await app.query('SELECT count(*)::int AS n FROM app.construction_stage_reminders')).rows[0].n, 1);
    await setTenant(1455);
    assert.equal((await app.query(
      'SELECT count(*)::int AS n FROM app.construction_stage_reminders',
    )).rows[0].n, 1);
  } finally {
    await app.end();
  }
});

live('the backup directory preflight rejects unsafe ACLs and repository paths', async () => {
  const unsafe = path.join(os.tmpdir(), `xiaok-i796-unsafe-${Date.now()}`);
  const inside = path.join(adminRoot, 'tmp', `i796-inside-${Date.now()}`);
  try {
    await makeUnsafeDirectory(unsafe);
    const unsafeRun = runBackup(source.database, unsafe, { label: 'unsafe' });
    assert.notEqual(unsafeRun.exitCode, 0);
    assert.equal(unsafeRun.body.status, 'blocked');
    assert.match(unsafeRun.body.reason, /backup_directory_/);
    assert.equal((await fs.readdir(unsafe)).length, 0);

    await fs.mkdir(inside, { recursive: true });
    await secureDirectory(inside);
    const insideRun = runBackup(source.database, inside, { label: 'inside' });
    assert.notEqual(insideRun.exitCode, 0);
    assert.equal(insideRun.body.status, 'blocked');
    assert.equal(insideRun.body.reason, 'backup_directory_inside_repository');

    const spaceRun = runBackup(source.database, workDir, {
      label: 'space', minFreeBytes: '1000000000000',
    });
    assert.notEqual(spaceRun.exitCode, 0);
    assert.equal(spaceRun.body.status, 'blocked');
    assert.equal(spaceRun.body.reason, 'backup_directory_insufficient_space');
  } finally {
    await fs.rm(unsafe, { recursive: true, force: true }).catch(() => undefined);
    await fs.rm(inside, { recursive: true, force: true }).catch(() => undefined);
  }
});
