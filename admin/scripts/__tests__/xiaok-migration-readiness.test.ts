import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  ARCHIVE_FILE, formatSha256File, main as backupMain,
} from '../xiaok-migration-backup.mjs';
import {
  inspectRestoreTarget, resolveIndependentRestoreAdmin, verifyArchiveIntegrity, verifyRestore,
} from '../xiaok-migration-restore-verify.mjs';
import {
  inspectBackupEvidence, inspectMigrationFiles, inspectRestoreEvidence,
  runMigrationReadiness, summarizeReadiness,
} from '../xiaok-migration-readiness';
import { loadIntegrationMigrationInputs, migratePostgresIntegration } from '../postgres-integration-migrations.mjs';

const pathToDrizzle = fileURLToPath(new URL('../../drizzle/', import.meta.url));

async function fixtureDirectory(t: TestContext) {
  const root = await realpath(os.tmpdir());
  const directory = await mkdtemp(path.join(root, 'xiaok-readiness-'));
  t.after(async () => {
    const target = await realpath(directory);
    assert.equal(path.dirname(target), root);
    assert.equal(target, directory);
    await rm(target, { recursive: true });
  });
  return directory;
}

test('readiness is fail closed when any required check failed or did not run', () => {
  assert.equal(summarizeReadiness(['passed', 'passed']), 'passed');
  assert.equal(summarizeReadiness(['passed', 'not_run']), 'limited');
  assert.equal(summarizeReadiness(['limited', 'failed']), 'failed');
  assert.equal(summarizeReadiness(['not_run']), 'not_run');
});

test('the gate reports missing backup credentials, rejects a shared restore port and detects insufficient space', async t => {
  const directory = await fixtureDirectory(t);
  const fakeSecret = 'do-not-print-test-secret';
  const report = await runMigrationReadiness(['--backup-dir', directory, '--target-database', 'smart_floor_planner'], {
    // The explicit empty application environment prevents opening a development connection.
    NODE_ENV: 'test',
    XIAOK_MIGRATION_RESTORE_URL: 'postgresql://sfp_restore:' + fakeSecret + '@localhost:5432/postgres',
    XIAOK_MIGRATION_MIN_FREE_BYTES: String(Number.MAX_SAFE_INTEGER),
  });
  assert.equal(report.backup_readiness, 'failed');
  assert.equal(report.checks.backup.credentials.code, 'backup_credentials_missing');
  assert.equal(report.checks.backup.storage.code, 'backup_directory_insufficient_space');
  assert.equal(report.checks.backup.archive.status, 'not_run');
  assert.equal(report.restore_readiness, 'failed');
  assert.equal(report.checks.restore.credentials.code, 'unapproved_independent_restore_endpoint');
  assert.equal(report.checks.restore.target.code, 'target_same_as_source');
  assert.equal(report.checks.restore.receipt.status, 'not_run');
  assert.equal(report.overall_readiness, 'failed');
  assert.ok(!JSON.stringify(report).includes(fakeSecret));
});

test('missing backup and restore credentials stop the mutating entries before opening a target', async () => {
  assert.deepEqual(await backupMain([], { NODE_ENV: 'test', DATABASE_URL: 'irrelevant' }), {
    status: 'blocked', reason: 'backup_credentials_missing',
  });
  const restore = await verifyRestore({
    manifestPath: 'absent', targetDatabase: 'xiaok_migration_restore_sample', mode: 'isolated', env: {},
  });
  assert.equal(restore.status, 'rejected');
  assert.equal(restore.failures[0].code, 'restore_credentials_missing');
  assert.equal(restore.checks?.full_restore_passed, false);
});

test('the backup verification rejects a same-size altered archive even when the sidecar matches the manifest', async t => {
  const dir = await fixtureDirectory(t);
  const file = path.join(dir, ARCHIVE_FILE);
  const digest = createHash('sha256').update('pg-dump-test').digest('hex');
  const manifest = { archive: { file: ARCHIVE_FILE, bytes: 12, sha256: digest }, backupBytes: 12, backupSha256: digest };
  const manifestPath = path.join(dir, 'manifest.json');
  await writeFile(file, 'px-dump-test');
  await writeFile(file + '.sha256', formatSha256File(digest, ARCHIVE_FILE));
  assert.deepEqual(await verifyArchiveIntegrity(manifestPath, manifest), { error: 'sha256_archive_mismatch' });
  await writeFile(manifestPath, '{}');
  const evidence = await inspectBackupEvidence(manifestPath, '');
  assert.equal(evidence.check.status, 'failed');
  assert.equal(evidence.check.code, 'manifest_schema_invalid');
});

test('a loopback alias to the source or an existing disposable target is rejected with only a catalog read', async () => {
  const endpoint = resolveIndependentRestoreAdmin('postgresql://sfp_restore:fixture@localhost:55436/postgres');
  assert.ok(endpoint.admin);
  const status = {
    version: 170010, replica: false, database: 'postgres', role: 'sfp_restore', sessionRole: 'sfp_restore',
    clusterPurpose: 'xiaok-i749-isolated-test', rolsuper: false, rolbypassrls: true, rolcanlogin: true,
    rolcreatedb: true, rolcreaterole: false, rolreplication: false,
  };
  const calls: string[] = [];
  async function probe(sourcePresent: boolean, targetExists: boolean) {
    return inspectRestoreTarget({
      async query(sql: string) {
        calls.push(sql.trim());
        return { rows: [{ ...status, sourceDatabasePresent: sourcePresent,
          developmentDatabasePresent: sourcePresent, targetExists }] };
      },
    }, endpoint.admin, { targetDatabase: 'xiaok_migration_restore_readiness' });
  }
  assert.equal((await probe(true, false)).error, 'restore_cluster_contains_source_database');
  assert.equal((await probe(false, true)).error, 'restore_target_already_exists');
  assert.equal(calls.length, 2);
  assert.ok(calls.every(sql => sql.startsWith('SELECT')));
});

test('a restore receipt must prove every check for the same manifest, archive and isolated endpoint', async t => {
  const directory = await fixtureDirectory(t);
  const receiptPath = path.join(directory, 'receipt.json');
  const manifest = { sourceDatabase: 'smart_floor_planner', backupId: 'xiaok-mig-fixture',
    manifestDigest: 'manifest', backupSha256: 'archive', migrationLedgerDigest: 'ledger' };
  const checks = Object.fromEntries(['manifest_format', 'manifest_integrity', 'backup_sha256', 'restore_list',
    'target_safety_verified', 'database_version_compatible', 'schema_restore_passed', 'data_restore_passed',
    'ledger_verified', 'rls_verified', 'permissions_verified', 'full_restore_passed'].map(key => [key, true]));
  const receipt = {
    status: 'passed', mode: 'isolated', targetDatabase: 'xiaok_migration_restore_fixture', failures: [], checks,
    detail: {
      manifest, archive: { sha256: manifest.backupSha256 }, restore: { exitCode: 0 },
      verified: { ledger: { digest: manifest.migrationLedgerDigest } },
      cluster: { independentCluster: true, isolatedMarker: true, role: 'sfp_restore', superuser: false, port: 55436 },
      cleanup: 'dropped',
    },
  };
  await writeFile(receiptPath, '\uFEFF' + JSON.stringify(receipt));
  assert.equal((await inspectRestoreEvidence(receiptPath, manifest, 55436)).status, 'passed');
  assert.equal((await inspectRestoreEvidence(receiptPath, manifest, 55437)).status, 'failed');
  receipt.checks.rls_verified = false;
  await writeFile(receiptPath, JSON.stringify(receipt));
  assert.equal((await inspectRestoreEvidence(receiptPath, manifest, 55436)).status, 'failed');
});

test('the reviewed journal and all ten migrations match and SQL or journal drift is rejected', async t => {
  assert.equal((await inspectMigrationFiles()).status, 'passed');
  const directory = await fixtureDirectory(t);
  await mkdir(path.join(directory, 'meta'));
  const journal = await readFile(path.join(pathToDrizzle, 'meta/_journal.json'), 'utf8');
  const journalPath = path.join(directory, 'meta/_journal.json');
  await writeFile(journalPath, journal.replace(/\r\n/g, '\n'));
  const tags: string[] = JSON.parse(journal).entries.slice(119).map((entry: { tag: string }) => entry.tag);
  assert.equal(tags.length, 10);
  assert.equal(tags.at(-1), '0132_assistant_platform_knowledge_citations');
  await Promise.all(tags.map(async tag => {
    const name = tag + '.sql';
    await writeFile(path.join(directory, name), await readFile(path.join(pathToDrizzle, name)));
  }));
  assert.equal((await inspectMigrationFiles(directory)).status, 'passed');
  const driftedJournal = JSON.parse(journal);
  driftedJournal.entries[0].tag += '_drifted';
  await writeFile(journalPath, JSON.stringify(driftedJournal, null, 2) + '\n');
  assert.equal((await inspectMigrationFiles(directory)).status, 'failed');
  await writeFile(journalPath, journal);
  const alteredPath = path.join(directory, tags[9] + '.sql');
  await writeFile(alteredPath, 'SELECT 1;');
  assert.equal((await inspectMigrationFiles(directory)).status, 'failed');
});

test('the official runner rolls back the batch when 0131 or 0132 fails', async () => {
  const { active } = loadIntegrationMigrationInputs(pathToDrizzle);
  const journal: { when: number; hashes: Set<string> }[] = active;
  const ledger = journal.slice(0, 119).map((entry, index) => ({
    id: index + 1, created_at: String(entry.when), hash: [...entry.hashes][0],
  }));
  for (const [failAt, writtenRows] of [
    ['LOCK TABLE app.platform_configs', 8],
    ['UPDATE app.assistant_message_citations SET source_enterprise_id', 9],
  ] as const) {
    const failure = new Error('fixture migration failure');
    const commands: string[] = [];
    const client = {
      async query(sql: string) {
        const command = sql.trim();
        commands.push(command);
        if (command.startsWith('select id,hash,created_at')) return { rows: ledger };
        if (command.includes(failAt)) throw failure;
        return { rows: [] };
      },
    };
    await assert.rejects(migratePostgresIntegration(client, pathToDrizzle), failure);
    assert.equal(commands[0], 'begin');
    assert.match(commands[1], /pg_advisory_xact_lock/);
    assert.equal(commands.filter(sql => sql.startsWith('insert into app.__drizzle_migrations')).length, writtenRows);
    assert.equal(commands.at(-1), 'rollback');
    assert.ok(!commands.includes('commit'));
  }
});
