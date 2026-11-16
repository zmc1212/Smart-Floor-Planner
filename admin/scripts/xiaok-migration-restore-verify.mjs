import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import pg from 'pg';
import {
  ARCHIVE_FILE, approvedDatabase, collectDatabaseFacts, computeManifestDigest,
  connectionFor, inspectBackupDirectory, isRestoreDatabaseName, missingTableDataEntries, parseSha256File, parseTocEntries,
  isolatedClusterMarker, isolatedSourceMarker,
  pgPasswordEnv, resolvePgBinary, resolveRestoreAdminTarget, runProcess, sha256File, toolVersion,
  validateManifestShape, versionMajor,
} from './xiaok-migration-backup.mjs';
import { loadIntegrationMigrationInputs } from './postgres-integration-migrations.mjs';

const adminRoot = fileURLToPath(new URL('../', import.meta.url));
const drizzleDir = path.join(adminRoot, 'drizzle');
const disposableMarker = 'xiaok-migration-restore-disposable';

function difference(left, right) {
  const other = new Set(right);
  return left.filter(value => !other.has(value));
}

function sameArray(left, right) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function sameDataSummary(expected, actual) {
  const actualByTable = new Map(actual.map(row => [row.table, row]));
  const missing = difference(expected.map(row => row.table), actual.map(row => row.table));
  const extra = difference(actual.map(row => row.table), expected.map(row => row.table));
  const changed = expected.filter(row => {
    const candidate = actualByTable.get(row.table);
    return !candidate || candidate.rows !== row.rows || candidate.digest !== row.digest;
  }).map(row => row.table);
  return { passed: !missing.length && !extra.length && !changed.length, missing, extra, changed };
}

export async function readManifest(manifestPath) {
  if (!(await fs.lstat(manifestPath)).isFile()) return { error: 'manifest_not_regular_file' };
  const text = await fs.readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(text);
  const shape = validateManifestShape(manifest);
  if (!shape.ok) return { error: 'manifest_schema_invalid', errors: shape.errors };
  if (computeManifestDigest(manifest) !== manifest.manifestDigest) {
    return { error: 'manifest_digest_mismatch' };
  }
  return { manifest };
}

export async function verifyArchiveIntegrity(manifestPath, manifest) {
  const directory = path.dirname(manifestPath);
  const archivePath = path.join(directory, manifest.archive.file);
  const shaPath = `${archivePath}.sha256`;
  if (manifest.archive.file !== ARCHIVE_FILE) return { error: 'archive_filename_unexpected' };
  const archiveStat = await fs.lstat(archivePath).catch(() => null);
  if (!archiveStat) return { error: 'archive_missing' };
  if (!archiveStat.isFile()) return { error: 'archive_not_regular_file' };
  if (!archiveStat.size) return { error: 'archive_empty' };
  if (archiveStat.size !== manifest.backupBytes || archiveStat.size !== manifest.archive.bytes) {
    return { error: 'archive_size_mismatch' };
  }
  if (manifest.archive.sha256 !== manifest.backupSha256) return { error: 'archive_manifest_digest_mismatch' };
  if (!(await fs.lstat(shaPath).catch(() => null))?.isFile()) return { error: 'sha256_file_missing_or_not_regular' };
  const shaText = await fs.readFile(shaPath, 'utf8').catch(() => null);
  if (shaText === null) return { error: 'sha256_file_missing' };
  const shaFile = parseSha256File(shaText);
  if (!shaFile || shaFile.file !== manifest.archive.file) return { error: 'sha256_file_invalid' };
  if (shaFile.sha256 !== manifest.backupSha256) return { error: 'sha256_manifest_mismatch' };
  const actual = await sha256File(archivePath);
  if (actual !== manifest.backupSha256) return { error: 'sha256_archive_mismatch' };
  return { archivePath, archiveBytes: archiveStat.size };
}

export async function checkArchiveToc(pgRestore, archivePath, manifest) {
  if (!manifest.restoreListVerified) return { error: 'manifest_restore_list_not_verified' };
  const list = await runProcess(pgRestore, ['--list'], { inputFile: archivePath }).catch(() => null);
  if (list?.code !== 0) return { error: 'restore_list_failed' };
  const entries = parseTocEntries(list.stdout);
  const missing = missingTableDataEntries(entries, manifest.dataSummary);
  if (!entries.length || missing.length) return { error: 'restore_list_incomplete' };
  return { entries: entries.length };
}

export function resolveIndependentRestoreAdmin(raw, nodeEnv) {
  if (!raw?.trim()) return { error: 'restore_credentials_missing' };
  const admin = resolveRestoreAdminTarget(raw, { nodeEnv, mode: 'isolated' });
  if (!admin) return { error: 'unapproved_independent_restore_endpoint' };
  if (!admin.password) return { error: 'restore_credentials_incomplete' };
  if (admin.user === 'sfp_backup') return { error: 'backup_role_cannot_restore' };
  if (admin.user !== 'sfp_restore' || admin.database !== 'postgres') {
    return { error: 'restore_requires_sfp_restore_on_postgres' };
  }
  return { admin };
}

export function restoreTargetNameError(targetDatabase, sourceDatabase) {
  if (targetDatabase === sourceDatabase) return 'target_same_as_source';
  if (!isRestoreDatabaseName(targetDatabase)) return 'target_database_name_rejected';
  return null;
}

export async function inspectRestoreTarget(maintenance, admin, {
  targetDatabase, sourceDatabase = approvedDatabase, requireIndependent = true, ownerRoles = [],
}) {
  const { rows: [cluster] } = await maintenance.query(`
    SELECT current_setting('server_version_num')::int AS version, pg_is_in_recovery() AS replica,
      current_database() AS database, current_user AS role, session_user AS "sessionRole",
      r.rolcanlogin, r.rolsuper, r.rolbypassrls, r.rolcreatedb, r.rolcreaterole, r.rolreplication,
      shobj_description((SELECT oid FROM pg_catalog.pg_database WHERE datname='postgres'), 'pg_database')
        AS "clusterPurpose",
      EXISTS (SELECT FROM pg_catalog.pg_database WHERE datname=$1) AS "sourceDatabasePresent",
      EXISTS (SELECT FROM pg_catalog.pg_database WHERE datname=$2) AS "targetExists",
      EXISTS (SELECT FROM pg_catalog.pg_database WHERE datname=$3) AS "developmentDatabasePresent"
    FROM pg_catalog.pg_roles r WHERE rolname=current_user
  `, [sourceDatabase, targetDatabase, approvedDatabase]);
  const detail = {
    port: admin.port, version: cluster?.version ?? null, isolatedMarker: cluster?.clusterPurpose === isolatedClusterMarker,
    sourceDatabasePresent: cluster?.sourceDatabasePresent ?? null,
    independentCluster: cluster?.sourceDatabasePresent === false && cluster?.developmentDatabasePresent === false,
    targetExists: cluster?.targetExists ?? null, role: cluster?.role === admin.user ? admin.user : null,
    superuser: cluster?.rolsuper ?? null, bypassRls: cluster?.rolbypassrls ?? null,
  };
  if (!cluster || cluster.role !== admin.user || cluster.sessionRole !== admin.user
    || cluster.database !== 'postgres') return { detail, error: 'restore_identity_mismatch' };
  if (Math.floor(cluster.version / 10000) !== 17 || cluster.replica) {
    return { detail, error: 'database_version_incompatible' };
  }
  if (cluster.developmentDatabasePresent || (requireIndependent && !detail.independentCluster)) {
    return { detail, error: 'restore_cluster_contains_source_database' };
  }
  if (!detail.isolatedMarker) return { detail, error: 'isolated_cluster_marker_missing' };
  if (cluster.targetExists) return { detail, error: 'restore_target_already_exists' };
  if (!requireIndependent) return { detail };
  if (admin.user !== 'sfp_restore' || cluster.rolsuper !== false || cluster.rolbypassrls !== true
    || cluster.rolcanlogin !== true || cluster.rolcreatedb !== true
    || cluster.rolcreaterole !== false || cluster.rolreplication !== false) {
    return { detail, error: 'restore_role_attributes_invalid' };
  }
  const requiredRoles = ['sfp_app', 'sfp_auditor', 'sfp_backup', ...new Set(['sfp_migrator', ...ownerRoles])];
  const { rows: [roles] } = await maintenance.query(`
    SELECT count(*) FILTER (WHERE rolname=ANY($1::text[]))::int AS "present",
      coalesce(bool_and(NOT rolsuper AND pg_has_role(oid,'USAGE') AND pg_has_role(oid,'SET'))
        FILTER (WHERE rolname=ANY($2::text[])),false) AS "canRestoreOwners",
      coalesce(bool_or(rolsuper AND pg_has_role(oid,'SET')),false) AS "canAssumeSuperuser"
    FROM pg_catalog.pg_roles
  `, [[...new Set(requiredRoles)], [...new Set(['sfp_migrator', ...ownerRoles])]]);
  if (roles.present !== new Set(requiredRoles).size) return { detail, error: 'restore_cluster_roles_missing' };
  if (roles.canAssumeSuperuser || !roles.canRestoreOwners) return { detail, error: 'restore_role_membership_invalid' };
  return { detail };
}

async function targetState(maintenance, targetDatabase) {
  const { rows: [database] } = await maintenance.query(`
    SELECT d.oid, pg_get_userbyid(d.datdba) AS owner, shobj_description(d.oid,'pg_database') AS purpose
    FROM pg_catalog.pg_database d WHERE d.datname=$1
  `, [targetDatabase]);
  return database ?? null;
}

function quoteIdentifier(name) {
  return '"' + name.replaceAll('"', '""') + '"';
}

async function restoreArchive({ pgRestore, admin, targetDatabase, archivePath }) {
  return runProcess(pgRestore, [
    '--no-password',
    '--single-transaction',
    '--exit-on-error',
    '--host', admin.connectionAddress,
    '--port', String(admin.port),
    '--username', admin.user,
    '--dbname', targetDatabase,
  ], { env: pgPasswordEnv(admin.password), inputFile: archivePath });
}

function emptyChecks() {
  return {
    manifest_format: false,
    manifest_integrity: false,
    backup_sha256: false,
    restore_list: false,
    target_safety_verified: false,
    database_version_compatible: false,
    schema_restore_passed: false,
    data_restore_passed: false,
    ledger_verified: false,
    rls_verified: false,
    permissions_verified: false,
    full_restore_passed: false,
  };
}

export async function verifyRestore({ manifestPath, targetDatabase, mode, env, keepTarget = false }) {
  const checks = emptyChecks();
  const failures = [];
  const detail = { targetRetained: false, cleanup: 'not_run' };
  const fail = (code, extra) => {
    failures.push({ code, ...(extra ? { detail: extra } : {}) });
  };
  if (!env.XIAOK_MIGRATION_RESTORE_URL?.trim()) {
    fail('restore_credentials_missing');
    return { status: 'rejected', checks, failures, detail };
  }
  if (mode !== 'isolated') {
    fail('independent_restore_cluster_required');
    return { status: 'rejected', checks, failures, detail };
  }
  const admin = resolveRestoreAdminTarget(env.XIAOK_MIGRATION_RESTORE_URL, {
    nodeEnv: env.NODE_ENV, mode,
  });
  if (!admin) {
    fail('unapproved_restore_target');
    return { status: 'rejected', checks, failures, detail };
  }
  if (admin.user === 'sfp_backup') {
    fail('backup_role_cannot_restore');
    return { status: 'rejected', checks, failures, detail };
  }

  const loaded = await readManifest(manifestPath).catch(() => ({ error: 'manifest_unreadable' }));
  if (loaded.error) {
    fail(loaded.error, loaded.errors);
    return { status: 'rejected', checks, failures, detail };
  }
  const { manifest } = loaded;
  const synthetic = manifest.targetMode === 'isolated' && manifest.databasePurpose === isolatedSourceMarker
    && /^xiaok_i749_[a-z0-9_]{1,40}$/.test(manifest.sourceDatabase);
  checks.manifest_format = true;
  checks.manifest_integrity = true;
  detail.manifest = {
    backupId: manifest.backupId, manifestDigest: manifest.manifestDigest, sourceDatabase: manifest.sourceDatabase,
    ledgerCount: manifest.migrationLedgerCount, ledgerDigest: manifest.migrationLedgerDigest,
  };
  const nameError = restoreTargetNameError(targetDatabase, manifest.sourceDatabase);
  if (nameError) {
    fail(nameError);
    return { status: 'rejected', checks, failures, detail };
  }
  if (!synthetic) {
    const { error } = resolveIndependentRestoreAdmin(env.XIAOK_MIGRATION_RESTORE_URL, env.NODE_ENV);
    if (error) {
      fail(error);
      return { status: 'rejected', checks, failures, detail };
    }
  }

  const integrity = await verifyArchiveIntegrity(manifestPath, manifest).catch(() => ({ error: 'archive_unreadable' }));
  if (integrity.error) {
    fail(integrity.error);
    return { status: 'rejected', checks, failures, detail };
  }
  if (!synthetic) {
    const storage = await inspectBackupDirectory(path.dirname(manifestPath), { minFreeBytes: 0 });
    if (!storage.ok) {
      fail(storage.reason);
      return { status: 'rejected', checks, failures, detail };
    }
  }
  checks.backup_sha256 = true;
  detail.archive = {
    file: manifest.archive.file, bytes: integrity.archiveBytes, sha256: manifest.backupSha256,
  };

  const pgBin = env.PG_BIN ?? env.PG_BIN_DIR ?? '';
  const pgRestore = resolvePgBinary(pgBin, 'pg_restore');
  const pgRestoreVersion = await toolVersion(pgRestore).catch(() => '');
  if (versionMajor(manifest.postgresqlVersion) !== 17 || versionMajor(pgRestoreVersion) !== 17) {
    fail('database_version_incompatible');
    return { status: 'rejected', checks, failures, detail };
  }
  const toc = await checkArchiveToc(pgRestore, integrity.archivePath, manifest);
  if (toc.error) {
    fail(toc.error);
    return { status: 'failed', checks, failures, detail };
  }
  checks.restore_list = true;

  const maintenanceClient = new pg.Client(connectionFor({
    host: admin.connectionAddress, port: admin.port, database: 'postgres',
    user: admin.user, password: admin.password,
  }, 'xiaok-migration-restore-maintenance'));
  let targetCreated = false;
  let targetOid;
  const marker = `${disposableMarker}:${randomUUID()}`;
  try {
    await maintenanceClient.connect();
    const target = await inspectRestoreTarget(maintenanceClient, admin, {
      targetDatabase, sourceDatabase: manifest.sourceDatabase, requireIndependent: !synthetic,
      ownerRoles: manifest.permissions.ownerRoles,
    });
    detail.cluster = target.detail;
    if (target.error) {
      fail(target.error);
      return { status: 'rejected', checks, failures, detail };
    }
    checks.database_version_compatible = true;
    checks.target_safety_verified = true;
    // CREATE itself rejects names occupied after the read-only probe. Never drop a previous target.
    await maintenanceClient.query(`CREATE DATABASE ${quoteIdentifier(targetDatabase)}`);
    targetCreated = true;
    const created = await targetState(maintenanceClient, targetDatabase);
    if (!created || created.owner !== admin.user) throw new Error('restore_target_owner_unverified');
    await maintenanceClient.query(`COMMENT ON DATABASE ${quoteIdentifier(targetDatabase)} IS '${marker}'`);
    targetOid = created.oid;

    const restore = await restoreArchive({
      pgRestore, admin, targetDatabase, archivePath: integrity.archivePath,
    });
    detail.restore = {
      exitCode: restore.code,
    };
    if (restore.code !== 0) {
      fail('restore_failed');
      return { status: 'failed', checks, failures, detail };
    }

    const verificationClient = new pg.Client(connectionFor({
      host: admin.connectionAddress, port: admin.port, database: targetDatabase,
      user: admin.user, password: admin.password,
    }, 'xiaok-migration-restore-verify'));
    try {
      await verificationClient.connect();
      const identity = await verificationClient.query(`
        SELECT current_user AS role, session_user AS "sessionRole",
          r.rolsuper, r.rolbypassrls, r.rolcanlogin
        FROM pg_catalog.pg_roles r WHERE r.rolname=current_user
      `).then(result => result.rows[0]);
      if (identity?.role !== admin.user || identity.sessionRole !== admin.user || !identity.rolcanlogin
        || (!synthetic && identity.rolsuper) || (!identity.rolsuper && !identity.rolbypassrls)) {
        fail('verification_role_cannot_read_all_tenants');
        return { status: 'failed', checks, failures, detail };
      }
      await verificationClient.query("SET row_security='off'");

      const inputs = loadIntegrationMigrationInputs(drizzleDir);
      const actual = await collectDatabaseFacts(verificationClient, {
        includeData: true, knownHashes: inputs.knownHashes,
      });

      const ledgerMatches = actual.ledger.count === manifest.migrationLedgerCount
        && actual.ledger.digest === manifest.migrationLedgerDigest
        && actual.ledger.lastId === manifest.migrationLedgerLastId
        && actual.ledger.lastTimestamp === manifest.migrationLedgerLastTimestamp;
      checks.ledger_verified = ledgerMatches;
      if (!ledgerMatches) fail('ledger_digest_mismatch', {
        expected: manifest.migrationLedgerDigest, actual: actual.ledger.digest,
      });

      const historyMatches = manifest.historicalHashes.every(expected => {
        const row = actual.ledger.historicalHashes.find(candidate => candidate.tag === expected.tag);
        return row && row.hash === expected.hash && row.matchesAllowlist === true;
      }) && actual.ledger.historicalHashes.every(row => row.matchesAllowlist === true);
      if (!historyMatches) {
        checks.ledger_verified = false;
        fail('historical_hash_mismatch');
      }

      const rlsMatches = actual.rls.rlsTableCount === manifest.rls.rlsTableCount
        && actual.rls.forcedRlsTableCount === manifest.rls.forcedRlsTableCount
        && sameArray(actual.rls.rlsTables, manifest.rls.rlsTables)
        && sameArray(actual.rls.forcedRlsTables, manifest.rls.forcedRlsTables)
        && actual.policies.count === manifest.policies.count
        && actual.policies.digest === manifest.policies.digest;
      checks.rls_verified = rlsMatches;
      if (!rlsMatches) fail('rls_or_policy_mismatch');

      const schemaMatches = JSON.stringify(actual.relations) === JSON.stringify(manifest.relations)
        && actual.functions.count === manifest.functions.count
        && actual.functions.digest === manifest.functions.digest
        && actual.triggers.count === manifest.triggers.count
        && actual.triggers.digest === manifest.triggers.digest
        && actual.schemaObjects.columnCount === manifest.schemaObjects.columnCount
        && actual.schemaObjects.columnDigest === manifest.schemaObjects.columnDigest
        && actual.schemaObjects.constraintCount === manifest.schemaObjects.constraintCount
        && actual.schemaObjects.constraintDigest === manifest.schemaObjects.constraintDigest
        && actual.schemaObjects.indexCount === manifest.schemaObjects.indexCount
        && actual.schemaObjects.indexDigest === manifest.schemaObjects.indexDigest
        && actual.extensions.count === manifest.extensions.count
        && actual.extensions.digest === manifest.extensions.digest
        && sameArray(actual.extensions.names, manifest.extensions.names);
      checks.schema_restore_passed = schemaMatches;
      if (!schemaMatches) {
        fail('schema_object_mismatch', {
          relationsEqual: JSON.stringify(actual.relations) === JSON.stringify(manifest.relations),
          functions: [manifest.functions, actual.functions],
          triggers: [manifest.triggers, actual.triggers],
          schemaObjects: [manifest.schemaObjects, actual.schemaObjects],
          extensions: [manifest.extensions, actual.extensions],
        });
      }

      const data = sameDataSummary(manifest.dataSummary, actual.dataSummary);
      checks.data_restore_passed = data.passed;
      if (!data.passed) fail('data_summary_mismatch', {
        missing: data.missing, extra: data.extra, changed: data.changed,
      });

      const permissionsMatch = manifest.archive.ownerMode === 'full'
        && manifest.archive.privilegesMode === 'full'
        && actual.permissions.digest === manifest.permissions.digest
        && actual.permissions.relationCount === manifest.permissions.relationCount
        && actual.permissions.functionCount === manifest.permissions.functionCount;
      checks.permissions_verified = permissionsMatch;
      if (!permissionsMatch) fail('permissions_not_restored');

      detail.verified = {
        ledger: actual.ledger,
        rls: actual.rls,
        policies: { count: actual.policies.count, digest: actual.policies.digest },
        functions: { count: actual.functions.count, digest: actual.functions.digest },
        triggers: { count: actual.triggers.count, digest: actual.triggers.digest },
        permissions: {
          digest: actual.permissions.digest,
          ownerRoles: actual.permissions.ownerRoles,
        },
        dataTables: actual.dataSummary.length,
        dataRows: actual.dataSummary.reduce((sum, row) => sum + row.rows, 0),
      };
    } finally {
      await verificationClient.end().catch(() => undefined);
    }
  } catch (error) {
    const sqlstate = /^[A-Z0-9]{5}$/.test(error?.code ?? '') ? error.code : null;
    fail(sqlstate === '42P04' ? 'restore_target_already_exists' : 'restore_execution_failed', { sqlstate });
    return { status: 'failed', checks, failures, detail };
  } finally {
    if (targetCreated) {
      detail.targetRetained = true;
      detail.cleanup = keepTarget ? 'retained' : 'ownership_unverified';
      if (!keepTarget && targetOid !== undefined) {
        try {
          const current = await targetState(maintenanceClient, targetDatabase);
          if (current?.oid !== targetOid || current.owner !== admin.user || current.purpose !== marker) {
            fail('restore_target_cleanup_ownership_unverified');
          } else {
            await maintenanceClient.query(`DROP DATABASE ${quoteIdentifier(targetDatabase)}`);
            detail.targetRetained = false;
            detail.cleanup = 'dropped';
          }
        } catch {
          detail.cleanup = 'failed';
          fail('restore_target_cleanup_failed');
        }
      }
    }
    await maintenanceClient.end().catch(() => undefined);
  }

  checks.full_restore_passed = failures.length === 0 && Object.entries(checks)
    .filter(([key]) => !['full_restore_passed'].includes(key))
    .every(([, value]) => value === true);
  if (!checks.full_restore_passed) {
    return { status: 'failed', checks, failures, detail };
  }
  return { status: 'passed', checks, failures, detail };
}

export function parseVerifyArguments(argv) {
  return parseArgs({
    args: argv,
    options: {
      manifest: { type: 'string' },
      'target-database': { type: 'string' },
      mode: { type: 'string', default: 'isolated' },
      'pg-bin': { type: 'string' },
      'keep-target': { type: 'boolean', default: false },
    },
  }).values;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const values = parseVerifyArguments(argv);
  if (!values.manifest || !values['target-database']) {
    return { status: 'rejected', failures: [{ code: 'manifest_and_target_required' }] };
  }
  if (!['development', 'isolated'].includes(values.mode)) {
    return { status: 'rejected', failures: [{ code: 'unsupported_mode' }] };
  }
  const result = await verifyRestore({
    manifestPath: path.resolve(values.manifest),
    targetDatabase: values['target-database'],
    mode: values.mode,
    env: { ...env, PG_BIN: values['pg-bin'] ?? env.PG_BIN ?? env.PG_BIN_DIR ?? '' },
    keepTarget: values['keep-target'],
  });
  return {
    ...result,
    manifest: path.relative(process.cwd(), path.resolve(values.manifest)),
    targetDatabase: values['target-database'],
    mode: values.mode,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(result => {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exitCode = result.status === 'passed' ? 0 : result.status === 'rejected' ? 2 : 1;
  }).catch(() => {
    process.stdout.write(JSON.stringify({
      status: 'failed', failures: [{ code: 'restore_verify_execution_error' }],
    }) + '\n');
    process.exitCode = 1;
  });
}
