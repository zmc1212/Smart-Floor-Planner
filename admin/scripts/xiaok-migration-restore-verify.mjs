import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import pg from 'pg';
import {
  ARCHIVE_FILE, collectDatabaseFacts, computeManifestDigest,
  connectionFor, isRestoreDatabaseName, missingTableDataEntries, parseSha256File, parseTocEntries,
  pgPasswordEnv, resolvePgBinary, resolveRestoreAdminTarget, runProcess, sha256File, toolVersion,
  validateManifestShape, versionMajor,
} from './xiaok-migration-backup.mjs';
import { loadIntegrationMigrationInputs } from './postgres-integration-migrations.mjs';

const adminRoot = fileURLToPath(new URL('../', import.meta.url));
const drizzleDir = path.join(adminRoot, 'drizzle');
const isolatedClusterMarker = 'xiaok-i749-isolated-test';
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

async function readManifest(manifestPath) {
  const text = await fs.readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(text);
  const shape = validateManifestShape(manifest);
  if (!shape.ok) return { error: 'manifest_schema_invalid', errors: shape.errors };
  if (computeManifestDigest(manifest) !== manifest.manifestDigest) {
    return { error: 'manifest_digest_mismatch' };
  }
  return { manifest };
}

async function verifyArchiveIntegrity(manifestPath, manifest) {
  const directory = path.dirname(manifestPath);
  const archivePath = path.join(directory, manifest.archive.file);
  const shaPath = `${archivePath}.sha256`;
  if (manifest.archive.file !== ARCHIVE_FILE) return { error: 'archive_filename_unexpected' };
  const archiveStat = await fs.stat(archivePath).catch(() => null);
  if (!archiveStat) return { error: 'archive_missing' };
  if (!archiveStat.size) return { error: 'archive_empty' };
  if (archiveStat.size !== manifest.backupBytes) return { error: 'archive_size_mismatch' };
  const shaText = await fs.readFile(shaPath, 'utf8').catch(() => null);
  if (shaText === null) return { error: 'sha256_file_missing' };
  const shaFile = parseSha256File(shaText);
  if (!shaFile || shaFile.file !== manifest.archive.file) return { error: 'sha256_file_invalid' };
  if (shaFile.sha256 !== manifest.backupSha256) return { error: 'sha256_manifest_mismatch' };
  const actual = await sha256File(archivePath);
  if (actual !== manifest.backupSha256) return { error: 'sha256_archive_mismatch' };
  return { archivePath, archiveBytes: archiveStat.size };
}

async function readCluster(maintenance) {
  const { rows: [cluster] } = await maintenance.query(`
    SELECT current_setting('server_version_num')::int AS version,
      shobj_description((SELECT oid FROM pg_catalog.pg_database WHERE datname='postgres'), 'pg_database')
        AS "clusterPurpose"
  `);
  return cluster;
}

async function targetState(maintenance, targetDatabase) {
  const { rows: [database] } = await maintenance.query(`
    SELECT d.datname AS name, shobj_description(d.oid,'pg_database') AS purpose
    FROM pg_catalog.pg_database d WHERE d.datname=$1
  `, [targetDatabase]);
  return database ?? null;
}

async function ensureTarget(maintenance, targetDatabase, { mode, cluster }) {
  const existing = await targetState(maintenance, targetDatabase);
  if (existing) {
    const isolated = mode === 'isolated' && cluster.clusterPurpose === isolatedClusterMarker;
    if (!isolated && existing.purpose !== disposableMarker) {
      return { error: 'target_not_marked_disposable' };
    }
    await maintenance.query(`DROP DATABASE ${quoteIdentifier(targetDatabase)} WITH (FORCE)`);
  }
  await maintenance.query(`CREATE DATABASE ${quoteIdentifier(targetDatabase)}`);
  await maintenance.query(`COMMENT ON DATABASE ${quoteIdentifier(targetDatabase)} IS '${disposableMarker}'`);
  return { created: true };
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
  const detail = { targetRetained: false };
  const fail = (code, extra) => {
    failures.push({ code, ...(extra ? { detail: extra } : {}) });
  };
  const admin = resolveRestoreAdminTarget(env.XIAOK_MIGRATION_RESTORE_URL, {
    nodeEnv: env.NODE_ENV, mode,
  });
  if (!admin) {
    fail('unapproved_restore_target');
    return { status: 'rejected', checks, failures, detail };
  }

  const loaded = await readManifest(manifestPath).catch(() => ({ error: 'manifest_unreadable' }));
  if (loaded.error) {
    fail(loaded.error, loaded.errors);
    return { status: 'rejected', checks, failures, detail };
  }
  const { manifest } = loaded;
  checks.manifest_format = true;
  checks.manifest_integrity = true;
  detail.manifest = {
    backupId: manifest.backupId, sourceDatabase: manifest.sourceDatabase,
    ledgerCount: manifest.migrationLedgerCount, ledgerDigest: manifest.migrationLedgerDigest,
  };
  if (targetDatabase === manifest.sourceDatabase) {
    fail('target_same_as_source');
    return { status: 'rejected', checks, failures, detail };
  }
  if (!isRestoreDatabaseName(targetDatabase)) {
    fail('target_database_name_rejected');
    return { status: 'rejected', checks, failures, detail };
  }

  const integrity = await verifyArchiveIntegrity(manifestPath, manifest).catch(() => ({ error: 'archive_unreadable' }));
  if (integrity.error) {
    fail(integrity.error);
    return { status: 'rejected', checks, failures, detail };
  }
  checks.backup_sha256 = true;
  detail.archive = {
    file: manifest.archive.file, bytes: integrity.archiveBytes, sha256: manifest.backupSha256,
  };

  const pgBin = env.PG_BIN ?? env.PG_BIN_DIR ?? '';
  const pgRestore = resolvePgBinary(pgBin, 'pg_restore');
  const pgRestoreVersion = await toolVersion(pgRestore).catch(() => '');
  const restoreList = await runProcess(pgRestore, ['--list'], {
    inputFile: integrity.archivePath,
  }).catch(() => null);
  if (!restoreList || restoreList.code !== 0) {
    fail('restore_list_failed', restoreList?.stderr?.slice(-400) ?? null);
    return { status: 'failed', checks, failures, detail };
  }
  const tocEntries = parseTocEntries(restoreList.stdout);
  const missingData = missingTableDataEntries(tocEntries, manifest.dataSummary);
  if (!tocEntries.length || missingData.length) {
    fail('restore_list_incomplete', missingData);
    return { status: 'failed', checks, failures, detail };
  }
  checks.restore_list = true;
  if (manifest.restoreListVerified !== true) {
    checks.restore_list = false;
    fail('manifest_restore_list_not_verified');
  }

  const maintenanceClient = new pg.Client(connectionFor({
    host: admin.connectionAddress, port: admin.port, database: 'postgres',
    user: admin.user, password: admin.password,
  }, 'xiaok-migration-restore-maintenance'));
  let targetCreated = false;
  let kept = false;
  try {
    await maintenanceClient.connect();
    const cluster = await readCluster(maintenanceClient);
    const manifestMajor = versionMajor(manifest.postgresqlVersion);
    const targetMajor = Math.floor(cluster.version / 10000);
    if (manifestMajor !== 17 || targetMajor !== 17 || versionMajor(pgRestoreVersion) !== 17) {
      fail('database_version_incompatible', {
        manifestMajor, targetMajor, pgRestoreVersion,
      });
      return { status: 'rejected', checks, failures, detail };
    }
    checks.database_version_compatible = true;
    if (mode === 'isolated' && cluster.clusterPurpose !== isolatedClusterMarker) {
      fail('isolated_cluster_marker_missing');
      return { status: 'rejected', checks, failures, detail };
    }

    const ensured = await ensureTarget(maintenanceClient, targetDatabase, { mode, cluster });
    if (ensured.error) {
      fail(ensured.error);
      return { status: 'rejected', checks, failures, detail };
    }
    targetCreated = true;

    const restore = await restoreArchive({
      pgRestore, admin, targetDatabase, archivePath: integrity.archivePath,
    });
    detail.restore = {
      exitCode: restore.code,
      stderrTail: restore.stderr.trim() ? restore.stderr.trim().split(/\r?\n/).slice(-8) : [],
    };
    if (restore.code !== 0) {
      fail('restore_failed', detail.restore.stderrTail);
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
      if (identity.rolsuper !== true && identity.rolbypassrls !== true) {
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
  } finally {
    kept = keepTarget;
    detail.targetRetained = kept;
    if (targetCreated && !kept) {
      await maintenanceClient.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(targetDatabase)} WITH (FORCE)`)
        .catch(() => undefined);
    }
    await maintenanceClient.end().catch(() => undefined);
  }

  checks.full_restore_passed = Object.entries(checks)
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
      mode: { type: 'string', default: 'development' },
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
  }).catch(error => {
    process.stdout.write(JSON.stringify({
      status: 'failed', failures: [{ code: 'restore_verify_execution_error' }],
      message: error?.message?.split('\n')[0] ?? null,
    }) + '\n');
    process.exitCode = 1;
  });
}
