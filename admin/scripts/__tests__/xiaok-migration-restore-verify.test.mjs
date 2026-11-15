import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import pg from 'pg';
import {
  ARCHIVE_FILE, MANIFEST_FILE, computeManifestDigest, formatSha256File, isRestoreDatabaseName,
  ledgerFacts, resolveRestoreAdminTarget, sha256File,
} from '../xiaok-migration-backup.mjs';
import {
  assertIsolatedCluster, dropDatabase, ensureRoles, fixtureConfig, provisionSource, urlFor,
} from './xiaok-migration-backup-fixture.mjs';

const adminRoot = fileURLToPath(new URL('../../', import.meta.url));
const backupScript = path.join(adminRoot, 'scripts/xiaok-migration-backup.mjs');
const verifyScript = path.join(adminRoot, 'scripts/xiaok-migration-restore-verify.mjs');
const config = fixtureConfig();

test('restore targets must be explicitly named as disposable databases', () => {
  assert.equal(isRestoreDatabaseName('xiaok_migration_restore_ok'), true);
  assert.equal(isRestoreDatabaseName('xiaok_migration_restore_20261115_a'), true);
  for (const name of [
    'smart_floor_planner', 'xiaok_i749_src_abcdef', 'restore_drill', 'xiaok_migration_restore_',
    'xiaok_migration_restore_Bad', 'xiaok_migration_restore_with-a-dash',
  ]) assert.equal(isRestoreDatabaseName(name), false, name);
});

test('restore admin connections stay on the approved loopback ports', () => {
  const isolated = 'postgresql://postgres:synthetic@127.0.0.1:55435/postgres';
  assert.equal(resolveRestoreAdminTarget(isolated, { mode: 'isolated' })?.port, 55435);
  assert.equal(resolveRestoreAdminTarget(isolated.replace(':55435', ':5432'), { mode: 'isolated' }), null);
  assert.equal(resolveRestoreAdminTarget(isolated.replace(':55435', ':55432'), { mode: 'isolated' }), null);
  assert.equal(resolveRestoreAdminTarget(isolated, { mode: 'development' }), null);
  const development = 'postgresql://postgres:synthetic@127.0.0.1:5432/postgres';
  assert.equal(resolveRestoreAdminTarget(development, { mode: 'development' })?.port, 5432);
  assert.equal(resolveRestoreAdminTarget(development, { mode: 'development', nodeEnv: 'production' }), null);
  assert.equal(resolveRestoreAdminTarget(development.replace('127.0.0.1', '192.168.10.54'),
    { mode: 'development' }), null);
});

function runBackup(database, outputDir) {
  const role = config.passwords.sfp_backup ? 'sfp_backup' : 'sfp_owner';
  const args = [
    backupScript, '--mode', 'isolated', '--database', database,
    '--output-dir', outputDir, '--pg-bin', config.pgBin,
  ];
  if (role === 'sfp_owner') args.push('--allow-legacy-owner');
  const result = spawnSync(process.execPath, args, {
    cwd: adminRoot,
    env: {
      ...process.env,
      PG_BIN: config.pgBin,
      XIAOK_MIGRATION_BACKUP_URL: urlFor(config, database, role, config.passwords[role]),
    },
    encoding: 'utf8',
    timeout: 600_000,
    windowsHide: true,
  });
  return { exitCode: result.status, body: JSON.parse(result.stdout), stderr: result.stderr };
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

function runVerify(manifestPath, targetDatabase) {
  const result = spawnSync(process.execPath, [
    verifyScript, '--manifest', manifestPath, '--target-database', targetDatabase,
    '--mode', 'isolated', '--pg-bin', config.pgBin,
  ], {
    cwd: adminRoot,
    env: {
      ...process.env,
      PG_BIN: config.pgBin,
      XIAOK_MIGRATION_RESTORE_URL: urlFor(config, 'postgres', config.superuser, config.superuserPassword),
    },
    encoding: 'utf8',
    timeout: 600_000,
    windowsHide: true,
  });
  return { exitCode: result.status, body: JSON.parse(result.stdout), stderr: result.stderr };
}

async function copyBackup(sourceDirectory, root, name) {
  const destination = path.join(root, name);
  await fs.cp(sourceDirectory, destination, { recursive: true });
  return destination;
}

async function rewriteManifest(directory, mutate) {
  const file = path.join(directory, MANIFEST_FILE);
  const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
  mutate(manifest);
  manifest.manifestDigest = computeManifestDigest(manifest);
  await fs.writeFile(file, JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

async function sourceLedgerDigest() {
  const client = new pg.Client({
    connectionString: urlFor(config, source.database, config.superuser, config.superuserPassword),
  });
  await client.connect();
  try {
    const { rows } = await client.query('SELECT id,hash,created_at FROM app.__drizzle_migrations ORDER BY id');
    return ledgerFacts(rows);
  } finally {
    await client.end();
  }
}

let source;
let workDir;
let backupDirectory;

const live = (name, fn) => test(name, { skip: !config, timeout: 900_000 }, fn);

before(async () => {
  if (!config) return;
  await assertIsolatedCluster(config);
  await ensureRoles(config);
  source = await provisionSource(config, 'restore');
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaok-i749-restore-'));
  await secureDirectory(workDir);
  const run = runBackup(source.database, workDir);
  assert.equal(run.body.status, 'passed', JSON.stringify(run.body));
  backupDirectory = path.join(workDir, run.body.backupId);
});

after(async () => {
  if (!config) return;
  if (workDir) await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  if (source) await dropDatabase(config, source.database).catch(() => undefined);
});

live('a disposable PG17 restore verifies the ledger, RLS, data and permissions', async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(backupDirectory, MANIFEST_FILE), 'utf8'));
  assert.equal(manifest.backupRole.name, config.passwords.sfp_backup ? 'sfp_backup' : 'sfp_owner');
  assert.equal(manifest.backupRole.profile, config.passwords.sfp_backup ? 'least_privilege' : 'legacy_owner');
  const target = 'xiaok_migration_restore_ok';
  const run = runVerify(path.join(backupDirectory, MANIFEST_FILE), target);
  assert.equal(run.body.status, 'passed', JSON.stringify(run.body, null, 2));
  assert.equal(run.body.checks.ledger_verified, true);
  assert.equal(run.body.checks.rls_verified, true);
  assert.equal(run.body.checks.permissions_verified, true);
  assert.equal(run.body.checks.schema_restore_passed, true);
  assert.equal(run.body.checks.data_restore_passed, true);
  assert.equal(run.body.checks.full_restore_passed, true);
  assert.equal(run.body.detail.verified.ledger.count, 128);
  assert.ok(run.body.detail.verified.rls.forcedRlsTableCount > 0);
  assert.ok(run.body.detail.verified.dataRows > 0);
  const admin = new pg.Client({
    connectionString: urlFor(config, 'postgres', config.superuser, config.superuserPassword),
  });
  await admin.connect();
  try {
    const { rows } = await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [target]);
    assert.equal(rows.length, 0, 'the disposable restore target must be dropped by default');
  } finally {
    await admin.end();
  }
});

live('a modified backup SHA-256 is rejected before any restore', async () => {
  const directory = await copyBackup(backupDirectory, workDir, 'reject-sha');
  await rewriteManifest(directory, manifest => {
    manifest.backupSha256 = '0'.repeat(64);
    manifest.archive.sha256 = '0'.repeat(64);
  });
  const run = runVerify(path.join(directory, MANIFEST_FILE), 'xiaok_migration_restore_sha');
  assert.notEqual(run.exitCode, 0);
  assert.equal(run.body.status, 'rejected');
  assert.ok(run.body.failures.some(failure => failure.code === 'sha256_manifest_mismatch'));
  assert.equal(run.body.checks.full_restore_passed, false);
});

live('a modified manifest body is rejected by the manifest digest', async () => {
  const directory = await copyBackup(backupDirectory, workDir, 'reject-manifest');
  const file = path.join(directory, MANIFEST_FILE);
  const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
  manifest.migrationLedgerCount += 1;
  await fs.writeFile(file, JSON.stringify(manifest, null, 2) + '\n');
  const run = runVerify(file, 'xiaok_migration_restore_manifest');
  assert.notEqual(run.exitCode, 0);
  assert.equal(run.body.status, 'rejected');
  assert.ok(run.body.failures.some(failure => failure.code === 'manifest_digest_mismatch'));
});

live('a corrupted archive is rejected even when its SHA-256 is recomputed', async () => {
  const directory = await copyBackup(backupDirectory, workDir, 'reject-archive');
  const archive = path.join(directory, ARCHIVE_FILE);
  const bytes = await fs.readFile(archive);
  bytes[0] ^= 0xff;
  await fs.writeFile(archive, bytes);
  const first = runVerify(path.join(directory, MANIFEST_FILE), 'xiaok_migration_restore_archive_1');
  assert.notEqual(first.exitCode, 0);
  assert.equal(first.body.status, 'rejected');
  assert.ok(first.body.failures.some(failure => failure.code === 'sha256_archive_mismatch'));

  const digest = await sha256File(archive);
  await fs.writeFile(`${archive}.sha256`, formatSha256File(digest, ARCHIVE_FILE));
  await rewriteManifest(directory, manifest => {
    manifest.backupSha256 = digest;
    manifest.archive.sha256 = digest;
  });
  const second = runVerify(path.join(directory, MANIFEST_FILE), 'xiaok_migration_restore_archive_2');
  assert.notEqual(second.exitCode, 0);
  assert.equal(second.body.status, 'failed');
  assert.ok(second.body.failures.some(failure =>
    ['restore_list_failed', 'restore_list_incomplete', 'restore_failed'].includes(failure.code)));
});

live('restoring onto the source database is rejected', () => {
  const run = runVerify(path.join(backupDirectory, MANIFEST_FILE), source.database);
  assert.notEqual(run.exitCode, 0);
  assert.equal(run.body.status, 'rejected');
  assert.ok(run.body.failures.some(failure => failure.code === 'target_same_as_source'));
});

live('repeated restores are predictable and leave the source ledger unchanged', async () => {
  const before = await sourceLedgerDigest();
  for (let index = 0; index < 2; index += 1) {
    const run = runVerify(path.join(backupDirectory, MANIFEST_FILE), 'xiaok_migration_restore_repeat');
    assert.equal(run.body.status, 'passed', JSON.stringify(run.body, null, 2));
    assert.equal(run.body.checks.full_restore_passed, true);
  }
  const after = await sourceLedgerDigest();
  assert.deepEqual(after, before);
});

live('an incompatible PostgreSQL version in the manifest is rejected', async () => {
  const directory = await copyBackup(backupDirectory, workDir, 'reject-version');
  await rewriteManifest(directory, manifest => {
    manifest.postgresqlVersion = '16.9';
    manifest.postgresqlVersionNumber = 160000;
  });
  const run = runVerify(path.join(directory, MANIFEST_FILE), 'xiaok_migration_restore_version');
  assert.notEqual(run.exitCode, 0);
  assert.equal(run.body.status, 'rejected');
  assert.ok(run.body.failures.some(failure => failure.code === 'database_version_incompatible'));
});
