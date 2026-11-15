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
  dropDatabase, ensureRoles, assertIsolatedCluster, fixtureConfig, provisionSource, urlFor,
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
  const approved = 'postgresql://sfp_owner:synthetic%20password@localhost:5432/smart_floor_planner';
  assert.deepEqual(resolveApprovedDevelopmentTarget(approved)?.target, {
    hostname: 'localhost', connectionAddress: '127.0.0.1', port: 5432,
    database: 'smart_floor_planner', user: 'sfp_owner',
  });
  assert.equal(resolveApprovedDevelopmentTarget(approved, { nodeEnv: 'production' }), null);
  for (const value of [
    undefined,
    approved.replace('localhost', 'db.example.test'),
    approved.replace(':5432', ':55435'),
    approved.replace('smart_floor_planner', 'xiaok_embedding_eval'),
    approved.replace('sfp_owner', 'sfp_app'),
    approved.replace('synthetic%20password@', ''),
    approved + '?options=unsafe',
  ]) {
    assert.equal(resolveApprovedDevelopmentTarget(value), null, String(value));
  }
});

test('isolated backup targets require a dynamic loopback port and a sandbox name', () => {
  const database = 'xiaok_i749_src_abcdef0123';
  const approved = `postgresql://sfp_owner:synthetic@127.0.0.1:55435/${database}`;
  assert.equal(resolveIsolatedTarget(approved, { database })?.target.port, 55435);
  for (const value of [
    approved.replace(':55435', ':5432'),
    approved.replace(':55435', ':55432'),
    approved.replace('127.0.0.1', '192.168.10.54'),
    `postgresql://sfp_owner:synthetic@127.0.0.1:55435/smart_floor_planner`,
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
  role = 'sfp_owner', password = config?.passwords.sfp_owner, label, extraEnv = {},
} = {}) {
  const args = [
    script, '--mode', 'isolated', '--database', database,
    '--output-dir', outputDir, '--pg-bin', config.pgBin,
  ];
  if (label) args.push('--label', label);
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

let source;
let workDir;
let backupDirectory;
let manifest;

const live = (name, fn) => test(name, { skip: !config, timeout: 600_000 }, fn);

before(async () => {
  if (!config) return;
  await assertIsolatedCluster(config);
  await ensureRoles(config);
  source = await provisionSource(config, 'backup');
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaok-i749-backup-'));
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
  assert.equal(manifest.backupRole.name, 'sfp_owner');
  assert.equal(manifest.backupRole.rolbypassrls, true);
  assert.equal(manifest.backupRole.fullReadProof, 'bypassrls');
  assert.equal(manifest.archive.ownerMode, 'full');
  assert.equal(manifest.archive.privilegesMode, 'full');
  assert.equal(validateManifestShape(manifest).ok, true);
});

live('the manifest records the ledger, RLS and synthetic business data facts', () => {
  assert.equal(manifest.migrationLedgerCount, 127);
  assert.equal(manifest.migrationLedgerLastId, 127);
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

live('a backup role without BYPASSRLS fails closed and creates nothing', async () => {
  const names = (await fs.readdir(workDir)).sort();
  const run = runBackup(source.database, workDir, {
    role: 'sfp_app', password: config.passwords.sfp_app, label: 'insufficient',
  });
  assert.notEqual(run.exitCode, 0);
  assert.equal(run.body.status, 'failed');
  assert.match(run.body.reason, /backup_role_missing_bypass_rls/);
  assert.deepEqual((await fs.readdir(workDir)).sort(), names);
});

live('a mid-backup permission failure leaves the verified backup untouched', async () => {
  const before = await directorySnapshot(backupDirectory);
  const rootBefore = (await fs.readdir(workDir)).sort();
  const admin = new pg.Client({
    connectionString: urlFor(config, source.database, config.superuser, config.superuserPassword),
  });
  await admin.connect();
  try {
    await admin.query('REVOKE SELECT ON app.enterprises FROM sfp_owner');
    const run = runBackup(source.database, workDir, { label: 'failure' });
    assert.notEqual(run.exitCode, 0);
    assert.equal(run.body.status, 'failed');
    assert.match(run.body.reason, /backup_role_missing_table_select/);
    assert.deepEqual((await fs.readdir(workDir)).sort(), rootBefore);
    assert.deepEqual(await directorySnapshot(backupDirectory), before);
    assert.ok(!(await fs.readdir(workDir)).some(name => name.startsWith('.tmp-')));
  } finally {
    await admin.query('GRANT SELECT ON app.enterprises TO sfp_owner').catch(() => undefined);
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
