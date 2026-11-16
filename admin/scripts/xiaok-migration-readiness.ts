import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadEnvConfig } from '@next/env';
import { Client, type ClientConfig } from 'pg';
import { inspectBackupRole } from './xiaok-backup-role-preflight';
import {
  approvedDatabase, defaultMinFreeBytes, inspectBackupDirectory, ledgerFacts,
  resolveApprovedDevelopmentTarget, resolvePgBinary, toolVersion, versionMajor,
} from './xiaok-migration-backup.mjs';
import { readMigrationPreflight, resolveApprovedTarget, windowsRuntime } from './xiaok-migration-preflight';
import {
  checkArchiveToc, inspectRestoreTarget, readManifest, resolveIndependentRestoreAdmin,
  restoreTargetNameError, verifyArchiveIntegrity,
} from './xiaok-migration-restore-verify.mjs';
import { loadIntegrationMigrationInputs } from './postgres-integration-migrations.mjs';
import type { EnvironmentCheckStatus as Status } from './xiaok-env-check-lib';

const root = fileURLToPath(new URL('../', import.meta.url));
const drizzle = path.join(root, 'drizzle');
const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const lf = (text: string) => text.replace(/\r\n/g, '\n');
type Inputs = ReturnType<typeof loadIntegrationMigrationInputs>;
type Check = { status: Status; code: string; detail?: unknown };
type Section = Record<string, Check>;
const check = (status: Status, code: string, detail?: unknown): Check => ({ status, code, detail });

// I7.4.9.4 rehearsal fingerprints. Compare bytes first and report any checkout EOL variant.
const expectedBatch = [
  ['0120_construction_camera_sd_identity_version', 1794988800000, '4bf4f4f9a0ce596a9377a04091dc7ca520ff910500c6e163bd75110292e005f2'],
  ['0124_assistant_knowledge_integration', 1795334400000, 'e17d50b8b85aa77277dce9a5d9043ea3d51a641e2647c3bb2046dc86d6e77788'],
  ['0125_native_workflow_runtime_integration', 1795420800000, '6cc59fb40d57dc5a7829bbae9a9bc6e179017855044682a9955642768e7b84f7'],
  ['0126_native_workflow_delegation_integration', 1795507200000, '08cdb5a0a16f965a4857af2e938f42ccff74c3aa854e312713d423fc2c37989c'],
  ['0127_native_workflow_delegation_compatibility', 1795593600000, '83350941abebc88e19dd63eaccafa1e6d1a5008a7e04c68770f5e28ccd5ae09c'],
  ['0128_xiaok_v1_stage_reminders', 1795680000000, '2176a1199a2212b5b620e270ff8249d3aedc889dc3760d9e81cab9674862b49c'],
  ['0129_xiaok_v1_stage_reminder_receipts', 1795766400000, '966e93d18077b77773a5fb215ba3863f7fbbadddc51807176d09e44aa6263618'],
  ['0130_xiaok_pilot_project_scopes', 1795852800000, '49ede82f820ccd9c66b3911419c8784f1e43c6396c21ea7f40ea36b9a21501ee'],
  ['0131_platform_notification_config_not_null', 1796457600000, 'a7fd555fa43a149ddffc74067e6263cbf91446cf67d581706491756a86386291'],
] as const;
const expectedTags = expectedBatch.map(([tag]) => tag);
const preMigration = { count: 119, lastTimestamp: 1794902400000, tag: '0119_platform_portfolio_templates' };
const reviewedRunners = {
  'postgres-migrate.mjs': '1f72de27bd9ad19423437d29fa9724b680ac9fea9ca11c035271b8b9d61e72b0',
  'postgres-integration-migrations.mjs': 'ef67fe1646a167221def82d3b20b267e8cfead1c300688057f1645c319f9ca96',
};

export function summarizeReadiness(checks: readonly Status[]): Status {
  if (checks.includes('failed')) return 'failed';
  if (checks.every(status => status === 'not_run')) return 'not_run';
  return checks.every(status => status === 'passed') ? 'passed' : 'limited';
}

export async function inspectMigrationFiles(folder = drizzle) {
  const journal = JSON.parse(await readFile(path.join(folder, 'meta/_journal.json'), 'utf8'));
  const entries: { idx: number; when: number; tag: string; breakpoints: boolean }[] = journal.entries;
  const lastApplied = entries[preMigration.count - 1];
  const journalMatches = entries.length === preMigration.count + expectedBatch.length
    && entries.every((entry, index) => entry.idx === index && Number.isSafeInteger(entry.when)
      && (index === 0 || entry.when > entries[index - 1].when))
    && new Set(entries.map(entry => entry.tag)).size === entries.length
    && lastApplied.tag === preMigration.tag && lastApplied.when === preMigration.lastTimestamp;
  const migrations = await Promise.all(expectedBatch.map(async ([tag, when, expectedSha256], offset) => {
    const idx = preMigration.count + offset;
    const raw = await readFile(path.join(folder, tag + '.sql'));
    const hash = sha256(raw);
    const text = lf(raw.toString('utf8'));
    const eolVariant = hash !== expectedSha256
      && [sha256(text), sha256(text.replace(/\n/g, '\r\n'))].includes(expectedSha256);
    const entry = entries[idx];
    const passed = (hash === expectedSha256 || eolVariant) && entry?.tag === tag && entry.when === when
      && entry.breakpoints === true;
    return { tag, idx, when, bytes: raw.length, sha256: hash, expectedSha256, eolVariant, passed };
  }));
  const passed = journalMatches && migrations.every(migration => migration.passed);
  return check(passed ? 'passed' : 'failed', passed ? 'v1_sql_and_journal_match' : 'v1_sql_or_journal_drift',
    { journalCount: entries.length, journalMatches, migrations });
}

async function inspectAtomicity() {
  const runners = await Promise.all(Object.entries(reviewedRunners).map(async ([file, expected]) => {
    const digest = sha256(lf(await readFile(path.join(root, 'scripts', file), 'utf8')));
    return { file, sha256Lf: digest, matches: digest === expected };
  }));
  const match = runners.every(runner => runner.matches);
  return check(match ? 'passed' : 'failed',
    match ? 'reviewed_shared_transaction_runner' : 'transaction_runner_requires_review', runners);
}

function sqlstate(error: unknown) {
  const code = (error as { code?: unknown })?.code;
  return typeof code === 'string' && /^[A-Z0-9]{5}$/.test(code) ? code : null;
}

async function readOnly<T>(connection: ClientConfig, query: (client: Client) => Promise<T>) {
  const client = new Client({
    ...connection, ssl: false, connectionTimeoutMillis: 5000, application_name: 'xiaok-migration-readiness',
    options: '-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=2000',
  });
  try {
    await client.connect();
    return await query(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

type Approved = NonNullable<ReturnType<typeof resolveApprovedTarget>>;
type BackupTarget = NonNullable<ReturnType<typeof resolveApprovedDevelopmentTarget>>;
const sourceConnection = ({ target, password }: Approved | BackupTarget): ClientConfig => ({
  host: target.connectionAddress, port: target.port, database: target.database, user: target.user, password,
});

async function probeLogin(connection: ClientConfig, expectedLedgerDigest: string) {
  return readOnly(connection, async client => {
    const { rows: [role] } = await client.query(
      'SELECT current_database() AS database, current_user AS role, session_user AS "sessionRole", rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user',
    );
    if (!role || role.database !== connection.database || role.role !== connection.user
      || role.sessionRole !== connection.user || role.rolsuper !== false
      || role.rolbypassrls !== (connection.user === 'sfp_backup')) {
      return check('failed', 'credential_identity_mismatch');
    }
    const { rows } = await client.query('SELECT id,hash,created_at FROM app.__drizzle_migrations ORDER BY id');
    return ledgerFacts(rows).digest === expectedLedgerDigest
      ? check('passed', 'credential_and_source_ledger_verified')
      : check('failed', 'credential_source_ledger_mismatch');
  }).catch(error => check('failed', 'credential_connection_or_read_failed', { sqlstate: sqlstate(error) }));
}

async function inspectSource(approved: Approved, inputs: Inputs) {
  return readOnly(sourceConnection(approved), async client => {
    const preflight = await readMigrationPreflight(client, inputs);
    if (!preflight.identity) return { preflight };
    const { rows: [cluster] } = await client.query<{ restoreRoleOnSource: boolean; otherClients: number }>(
      'SELECT EXISTS (SELECT FROM pg_roles WHERE rolname=$1) AS "restoreRoleOnSource",'
      + ' (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database()'
      + " AND pid<>pg_backend_pid() AND backend_type='client backend') AS \"otherClients\"", ['sfp_restore'],
    );
    const backupRole = await inspectBackupRole(client).catch(error => ({
      failures: [{ code: 'backup_role_audit_failed', detail: { sqlstate: sqlstate(error) } }], role: null,
    }));
    return { preflight, cluster, backupRole };
  });
}

async function inspectTools(pgBin: string) {
  const results = await Promise.all(['pg_dump', 'pg_restore', 'psql'].map(async tool => {
    const version = await toolVersion(resolvePgBinary(pgBin, tool)).catch(() => '');
    const safeVersion = version.match(/^\w+ \(PostgreSQL\) (\d+(?:\.\d+)+)(?:\s|$)/)?.[1] ?? null;
    return { tool, version: safeVersion, passed: versionMajor(safeVersion) === 17 };
  }));
  const passed = results.every(result => result.passed);
  return check(passed ? 'passed' : 'failed', passed ? 'pg17_tools_available' : 'pg17_tools_missing_or_incompatible', results);
}

type Loaded = Awaited<ReturnType<typeof readManifest>>;
type Manifest = NonNullable<Loaded['manifest']>;
type VerifiedBackup = { check: Check; manifest?: Manifest };

export async function inspectBackupEvidence(manifestPath: string | undefined, pgBin: string, ledgerDigest?: string): Promise<VerifiedBackup> {
  if (!manifestPath) return { check: check('not_run', 'backup_manifest_not_provided') };
  try {
    const loaded = await readManifest(manifestPath);
    if (loaded.error) return { check: check('failed', loaded.error) };
    const manifest = loaded.manifest;
    if (manifest.targetMode !== 'development' || manifest.sourceDatabase !== approvedDatabase
      || !/^(localhost|127\.0\.0\.1):5432$/.test(manifest.sourceHost)) {
      return { check: check('failed', 'backup_is_not_from_development_source') };
    }
    const storage = await inspectBackupDirectory(path.dirname(manifestPath), { minFreeBytes: 0 });
    if (!storage.ok) return { check: check('failed', storage.reason ?? 'backup_evidence_directory_unverified') };
    const integrity = await verifyArchiveIntegrity(manifestPath, manifest);
    if (integrity.error) return { check: check('failed', integrity.error) };
    const toc = await checkArchiveToc(resolvePgBinary(pgBin, 'pg_restore'), integrity.archivePath, manifest);
    if (toc.error) return { check: check('failed', toc.error) };
    if (manifest.snapshotConsistent !== true || manifest.ledgerValidation !== 'passed'
      || manifest.postgresqlVersionNumber < 170000 || manifest.postgresqlVersionNumber >= 180000
      || manifest.archive.format !== 'custom' || manifest.archive.ownerMode !== 'full'
      || manifest.archive.privilegesMode !== 'full' || manifest.backupRole.name !== 'sfp_backup'
      || manifest.backupRole.profile !== 'least_privilege' || manifest.backupRole.rolsuper !== false
      || manifest.backupRole.rolbypassrls !== true) {
      return { check: check('failed', 'backup_snapshot_or_permission_evidence_incomplete') };
    }
    if (!ledgerDigest) return { check: check('limited', 'backup_source_ledger_unverified') };
    if (manifest.migrationLedgerDigest !== ledgerDigest) return { check: check('failed', 'backup_source_ledger_mismatch') };
    return {
      manifest,
      check: check('passed', 'source_backup_archive_verified', {
        backupId: manifest.backupId, createdAt: manifest.createdAt, bytes: integrity.archiveBytes,
        archiveSha256: manifest.backupSha256, manifestDigest: manifest.manifestDigest, entries: toc.entries,
      }),
    };
  } catch {
    return { check: check('failed', 'backup_evidence_unreadable') };
  }
}

export async function inspectRestoreEvidence(receiptPath: string | undefined, manifest?: Manifest, restorePort?: number) {
  if (!receiptPath) return check('not_run', 'restore_receipt_not_provided');
  if (!manifest) return check('limited', 'restore_receipt_requires_verified_backup');
  try {
    if (!(await lstat(receiptPath)).isFile()) return check('failed', 'restore_receipt_not_regular_file');
    const receipt = JSON.parse((await readFile(receiptPath, 'utf8')).replace(/^\uFEFF/, ''));
    const detail = receipt?.detail;
    const required = ['manifest_format', 'manifest_integrity', 'backup_sha256', 'restore_list', 'target_safety_verified',
      'database_version_compatible', 'schema_restore_passed', 'data_restore_passed', 'ledger_verified',
      'rls_verified', 'permissions_verified', 'full_restore_passed'];
    if (receipt?.status !== 'passed' || receipt.mode !== 'isolated' || !Array.isArray(receipt.failures)
      || receipt.failures.length || !required.every(key => receipt.checks?.[key] === true)
      || restoreTargetNameError(receipt.targetDatabase, manifest.sourceDatabase)
      || detail?.manifest?.backupId !== manifest.backupId || detail.manifest.manifestDigest !== manifest.manifestDigest
      || detail.manifest.sourceDatabase !== manifest.sourceDatabase
      || detail.archive?.sha256 !== manifest.backupSha256 || detail.verified?.ledger?.digest !== manifest.migrationLedgerDigest
      || detail.restore?.exitCode !== 0
      || detail.cluster?.independentCluster !== true || detail.cluster.isolatedMarker !== true
      || detail.cluster.role !== 'sfp_restore' || detail.cluster.superuser !== false || detail.cluster.port !== restorePort
      || !['dropped', 'retained'].includes(detail.cleanup)) {
      return check('failed', 'restore_receipt_incomplete_or_mismatched');
    }
    return check('passed', 'independent_restore_receipt_verified', {
      backupId: manifest.backupId, targetDatabase: receipt.targetDatabase, cleanup: detail.cleanup,
    });
  } catch {
    return check('failed', 'restore_receipt_unreadable');
  }
}

function assemble(backup: Section, restore: Section, migration: Section, environment: Section) {
  const status = (section: Section) => summarizeReadiness(Object.values(section).map(value => value.status));
  const statuses = {
    backup_readiness: status(backup), restore_readiness: status(restore),
    migration_readiness: status(migration), environment_readiness: status(environment),
  };
  return { ...statuses, overall_readiness: summarizeReadiness(Object.values(statuses)),
    checkedAt: new Date().toISOString(), readOnly: true, checks: { backup, restore, migration, environment } };
}

export async function runMigrationReadiness(argv = process.argv.slice(2), processEnv = process.env) {
  const { values } = parseArgs({ args: argv, options: {
    'backup-dir': { type: 'string' }, 'pg-bin': { type: 'string' }, manifest: { type: 'string' },
    'restore-receipt': { type: 'string' }, 'target-database': { type: 'string' },
  } });
  const nodeEnv = processEnv.NODE_ENV;
  if (nodeEnv === 'production') {
    return assemble({}, {}, {}, { target: check('failed', 'production_target_rejected') });
  }
  // Maintenance credentials must be injected before Next loads the local application settings.
  const backupUrl = processEnv.XIAOK_MIGRATION_BACKUP_URL;
  const restoreUrl = processEnv.XIAOK_MIGRATION_RESTORE_URL;
  const pgBin = values['pg-bin'] ?? processEnv.PG_BIN ?? processEnv.PG_BIN_DIR ?? '';
  const minFreeBytes = Number(processEnv.XIAOK_MIGRATION_MIN_FREE_BYTES ?? defaultMinFreeBytes);
  const env = processEnv === process.env ? loadEnvConfig(root, true, { info() {}, error() {} }).combinedEnv : processEnv;
  const backupTarget = resolveApprovedDevelopmentTarget(backupUrl);
  const restoreAdmin = resolveIndependentRestoreAdmin(restoreUrl, nodeEnv);
  const sourceTarget = resolveApprovedTarget(env.DATABASE_URL, nodeEnv);
  const migratorTarget = resolveApprovedTarget(env.DATABASE_MIGRATION_URL, nodeEnv, 'sfp_migrator');
  const outputDirectory = values['backup-dir'] ?? path.join(root, '.postgres-backups');
  const targetDatabase = values['target-database'];
  const [runtime, tools, files, atomicity] = await Promise.all([
    windowsRuntime(), inspectTools(pgBin),
    inspectMigrationFiles().catch(() => check('failed', 'migration_files_or_journal_unreadable')),
    inspectAtomicity().catch(() => check('failed', 'transaction_runner_unreadable')),
  ]);
  const inputs = (() => {
    try { return loadIntegrationMigrationInputs(drizzle); } catch { return null; }
  })();
  let source: Awaited<ReturnType<typeof inspectSource>> | undefined;
  let sourceError: string | null = null;
  if (runtime.verifiedForward && sourceTarget && inputs) {
    try {
      source = await inspectSource(sourceTarget, inputs);
    } catch (error) {
      sourceError = sqlstate(error);
    }
  }
  const preflight = source?.preflight;
  const ledger = preflight?.ledger;
  const preMigrationLedger = ledger?.status === 'passed' && ledger.count === preMigration.count
    && ledger.lastTimestamp === preMigration.lastTimestamp && ledger.schema === 'absent' && ledger.legacyFork === null
    && JSON.stringify(ledger.pending) === JSON.stringify(expectedTags);

  const evidence = await inspectBackupEvidence(values.manifest, pgBin, preMigrationLedger ? ledger?.digest : undefined);
  const storage = Number.isSafeInteger(minFreeBytes) && minFreeBytes > 0
    ? await inspectBackupDirectory(outputDirectory, { minFreeBytes: Math.max(minFreeBytes, preflight?.databaseBytes ?? 0) })
      .catch(() => ({ ok: false as const, reason: 'backup_directory_unreadable' }))
    : { ok: false as const, reason: 'invalid_min_free_bytes' };
  const nameError = restoreTargetNameError(targetDatabase, approvedDatabase);
  let restoreTarget = check('not_run', 'restore_target_probe_requires_credentials_and_name');
  if (targetDatabase && nameError) restoreTarget = check('failed', nameError);
  const admin = restoreAdmin.admin;
  if (admin && targetDatabase && !nameError) {
    const connection = { host: admin.connectionAddress, port: admin.port, database: 'postgres',
      user: admin.user, password: admin.password };
    restoreTarget = await readOnly(connection, client => inspectRestoreTarget(client, admin, {
      targetDatabase, ownerRoles: evidence.manifest?.permissions.ownerRoles,
    })).then(result => check(result.error ? 'failed' : 'passed',
      result.error ?? 'independent_empty_restore_target_verified', result.detail))
      .catch(error => check('failed', 'restore_connection_or_read_failed', { sqlstate: sqlstate(error) }));
  }

  const backup: Section = {
    credentials: backupTarget ? check('passed', 'backup_credentials_configured')
      : check('failed', backupUrl?.trim() ? 'backup_credentials_invalid' : 'backup_credentials_missing',
        { variable: 'XIAOK_MIGRATION_BACKUP_URL' }),
    role: source?.backupRole
      ? check(source.backupRole.failures.length ? 'failed' : 'passed', 'sfp_backup_catalog_audit', source.backupRole)
      : check('not_run', 'backup_role_catalog_unavailable'),
    login: backupTarget && ledger?.digest && source?.backupRole?.failures.length === 0
      ? await probeLogin(sourceConnection(backupTarget), ledger.digest)
      : check('not_run', 'backup_login_requires_source_and_role'),
    storage: storage.ok ? check('passed', 'backup_directory_verified', storage)
      : check('failed', storage.reason ?? 'backup_directory_unverified', storage),
    tools,
    archive: evidence.check,
  };
  const restore: Section = {
    credentials: admin ? check('passed', 'restore_credentials_configured')
      : check('failed', restoreAdmin.error ?? 'unapproved_independent_restore_endpoint',
        { variable: 'XIAOK_MIGRATION_RESTORE_URL' }),
    sourceRoleSeparation: source?.cluster ? check(source.cluster.restoreRoleOnSource ? 'failed' : 'passed',
      source.cluster.restoreRoleOnSource ? 'sfp_restore_exists_on_source_cluster' : 'sfp_restore_absent_on_source_cluster')
      : check('not_run', 'source_restore_role_catalog_unavailable'),
    target: restoreTarget,
    receipt: await inspectRestoreEvidence(values['restore-receipt'], evidence.manifest, admin?.port),
  };
  const notification = preflight?.notification;
  const notificationEvidenceAvailable = notification && 'defaultRowDigest' in notification
    && typeof notification.defaultRowDigest === 'string';
  const migration: Section = {
    files,
    atomicity,
    inputs: check(inputs ? 'passed' : 'failed', inputs ? 'migration_inputs_loaded' : 'migration_inputs_invalid'),
    ledger: ledger ? check(preMigrationLedger ? 'passed' : 'failed',
      preMigrationLedger ? 'expected_119_to_128_batch_pending' : 'unexpected_pre_migration_ledger', ledger)
      : check('not_run', 'source_ledger_unavailable'),
    dependencies: preflight?.migrations
      ? check(preflight.migrations.length === 9 && preflight.migrations.every(item => item.status === 'passed')
        && preflight.delegation?.status === 'passed' && notificationEvidenceAvailable ? 'passed' : 'failed',
      'read_only_migration_preconditions', { migrations: preflight.migrations, notification })
      : check('not_run', 'migration_preconditions_unavailable'),
    migrator: !migratorTarget ? check('failed', 'migration_credentials_missing_or_invalid', { variable: 'DATABASE_MIGRATION_URL' })
      : !preflight?.migrationRole || !ledger?.digest ? check('not_run', 'migration_role_catalog_unavailable')
        : preflight.issues?.includes('migration_role') ? check('failed', 'migration_role_permissions_invalid', preflight.migrationRole)
          : await probeLogin(sourceConnection(migratorTarget), ledger.digest),
  };
  const quiet = runtime.verifiedForward && runtime.workerCount === 0 && Array.isArray(runtime.listeningPorts)
    && runtime.listeningPorts.length === 0 && source?.cluster?.otherClients === 0;
  return assemble(backup, restore, migration, {
    tools,
    forward: check(runtime.verifiedForward ? 'passed' : 'failed',
      runtime.verifiedForward ? 'development_forward_verified' : 'approved_development_forward_unverified'),
    database: preflight?.identity ? check('passed', 'development_pg17_read_only', {
      ...preflight.identity, bytes: preflight.databaseBytes,
    }) : check('failed', preflight?.reason ?? (sourceTarget ? 'development_database_unverified' : 'development_credentials_missing_or_invalid'),
      { sqlstate: sourceError }),
    isolated: restoreTarget,
    quiet: source?.cluster ? check(quiet ? 'passed' : 'limited', 'observed_source_activity', {
      workerCount: runtime.workerCount, listeningPorts: runtime.listeningPorts, otherClients: source.cluster.otherClients,
    }) : check('not_run', 'source_activity_unverified'),
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runMigrationReadiness().then(result => {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exitCode = result.overall_readiness === 'passed' ? 0 : 2;
  }).catch(() => {
    process.stdout.write(JSON.stringify(assemble({}, {}, {}, { command: check('failed', 'readiness_execution_error') })) + '\n');
    process.exitCode = 1;
  });
}
