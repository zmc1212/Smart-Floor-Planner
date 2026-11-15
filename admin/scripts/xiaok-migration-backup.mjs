import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import pg from 'pg';
import {
  loadIntegrationMigrationInputs, validateLedger, verifyDelegationSchema,
} from './postgres-integration-migrations.mjs';

const adminRoot = fileURLToPath(new URL('../', import.meta.url));
const drizzleDir = path.join(adminRoot, 'drizzle');
const repoRoot = path.resolve(adminRoot, '..');
const approvedDatabase = 'smart_floor_planner';
const leastPrivilegeBackupRole = 'sfp_backup';
const legacyBackupRole = 'sfp_owner';
const approvedBackupRoles = new Set([leastPrivilegeBackupRole, legacyBackupRole]);
const isolatedSourceMarker = 'xiaok-i749-backup-sandbox';
const isolatedClusterMarker = 'xiaok-i749-isolated-test';
const isolatedDatabasePattern = /^xiaok_i749_[a-z0-9_]{1,40}$/;
const blockedIsolatedPorts = new Set([5432, 55432]);
const defaultMinFreeBytes = 512 * 1024 * 1024;

export const MANIFEST_VERSION = 1;
export const MANIFEST_FILE = 'migration-backup-manifest.json';
export const ARCHIVE_FILE = 'database.dump';
export const SHA256_FILE = `${ARCHIVE_FILE}.sha256`;

const sha256Pattern = /^[0-9a-f]{64}$/;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

/** Stable JSON projection so a manifest digest does not depend on key order. */
export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort()
      .map(key => [key, canonicalize(value[key])]));
  }
  return value;
}

export function computeManifestDigest(manifest) {
  const copy = { ...manifest };
  delete copy.manifestDigest;
  return sha256(JSON.stringify(canonicalize(copy)));
}

const forbiddenKey = /password|passwd|secret|token|credential|connection.?string|^url$|^dsn$/i;

export function collectForbiddenKeys(value, prefix = '') {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectForbiddenKeys(item, `${prefix}[${index}]`));
  }
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const location = prefix ? `${prefix}.${key}` : key;
    return [
      ...(forbiddenKey.test(key) ? [location] : []),
      ...collectForbiddenKeys(child, location),
    ];
  });
}

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Validates the manifest contract shared by the backup and restore tools. */
export function validateManifestShape(value) {
  const errors = [];
  if (!isObject(value)) return { ok: false, errors: ['manifest_not_an_object'] };
  const string = (key, pattern) => {
    if (typeof value[key] !== 'string' || !value[key].length
      || (pattern && !pattern.test(value[key]))) errors.push(`${key}_invalid`);
  };
  const integer = (key, { nullable = false } = {}) => {
    if (nullable && value[key] === null) return;
    if (!Number.isSafeInteger(value[key]) || value[key] < 0) errors.push(`${key}_invalid`);
  };
  if (value.version !== MANIFEST_VERSION) errors.push('version_unsupported');
  string('backupId', /^[a-z0-9][a-z0-9-]{7,80}$/);
  string('createdAt');
  if (typeof value.createdAt === 'string' && Number.isNaN(Date.parse(value.createdAt))) {
    errors.push('createdAt_invalid');
  }
  string('sourceDatabase');
  string('sourceHost');
  string('postgresqlVersion');
  integer('postgresqlVersionNumber');
  string('backupStatus');
  if (value.backupStatus !== 'complete') errors.push('backupStatus_not_complete');
  integer('migrationLedgerCount');
  string('migrationLedgerDigest', sha256Pattern);
  integer('migrationLedgerLastId', { nullable: true });
  integer('migrationLedgerLastTimestamp', { nullable: true });
  integer('backupBytes');
  string('backupSha256', sha256Pattern);
  string('pgDumpVersion');
  string('pgRestoreVersion');
  if (typeof value.restoreListVerified !== 'boolean') errors.push('restoreListVerified_invalid');
  string('manifestDigest', sha256Pattern);
  if (!isObject(value.backupRole)) errors.push('backupRole_invalid');
  if (!isObject(value.archive) || typeof value.archive.file !== 'string'
    || path.basename(value.archive.file) !== value.archive.file) errors.push('archive_invalid');
  if (isObject(value.archive) && value.archive.file !== ARCHIVE_FILE) errors.push('archive_filename_unexpected');
  if (!Array.isArray(value.dataSummary) || !value.dataSummary.every(row =>
    isObject(row) && typeof row.table === 'string' && Number.isSafeInteger(row.rows)
    && typeof row.digest === 'string')) errors.push('dataSummary_invalid');
  if (!Array.isArray(value.relations) || !value.relations.every(row =>
    isObject(row) && typeof row.name === 'string' && typeof row.kind === 'string')) {
    errors.push('relations_invalid');
  }
  if (!isObject(value.rls) || !Array.isArray(value.rls.rlsTables)
    || !Array.isArray(value.rls.forcedRlsTables)) errors.push('rls_invalid');
  if (!isObject(value.policies) || !Number.isSafeInteger(value.policies.count)
    || typeof value.policies.digest !== 'string') errors.push('policies_invalid');
  if (!isObject(value.functions) || !Number.isSafeInteger(value.functions.count)
    || typeof value.functions.digest !== 'string') errors.push('functions_invalid');
  if (!isObject(value.triggers) || !Number.isSafeInteger(value.triggers.count)
    || typeof value.triggers.digest !== 'string') errors.push('triggers_invalid');
  if (!isObject(value.schemaObjects) || !Number.isSafeInteger(value.schemaObjects.columnCount)
    || typeof value.schemaObjects.columnDigest !== 'string'
    || !Number.isSafeInteger(value.schemaObjects.constraintCount)
    || typeof value.schemaObjects.constraintDigest !== 'string'
    || !Number.isSafeInteger(value.schemaObjects.indexCount)
    || typeof value.schemaObjects.indexDigest !== 'string') errors.push('schemaObjects_invalid');
  if (!isObject(value.extensions) || !Number.isSafeInteger(value.extensions.count)
    || !Array.isArray(value.extensions.names) || typeof value.extensions.digest !== 'string') {
    errors.push('extensions_invalid');
  }
  if (!isObject(value.permissions) || typeof value.permissions.digest !== 'string') {
    errors.push('permissions_invalid');
  }
  if (!Array.isArray(value.historicalHashes)) errors.push('historicalHashes_invalid');
  errors.push(...collectForbiddenKeys(value).map(location => `forbidden_key:${location}`));
  return { ok: errors.length === 0, errors };
}

export function parseSha256File(text) {
  const match = String(text).match(/^([0-9a-f]{64})\s+\*?(.+?)\s*$/);
  if (!match) return null;
  const file = match[2];
  if (file !== path.basename(file) || /[\\/]/.test(file)) return null;
  return { sha256: match[1], file };
}

export function formatSha256File(digest, fileName) {
  return `${digest}  ${fileName}\n`;
}

export async function sha256File(file) {
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    createReadStream(file)
      .on('data', chunk => hash.update(chunk))
      .on('error', reject)
      .on('end', resolve);
  });
  return hash.digest('hex');
}

function loopback(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function safeUrl(raw) {
  try {
    const url = new URL(raw);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) return null;
    if (url.search || url.hash || !url.username || !url.pathname || url.pathname === '/') return null;
    return url;
  } catch {
    return null;
  }
}

export function resolveBackupRoleProfile(user, allowLegacyOwner = false) {
  if (user === leastPrivilegeBackupRole) return { profile: 'least_privilege' };
  if (user === legacyBackupRole) return allowLegacyOwner ? { profile: 'legacy_owner' } : null;
  return null;
}

/**
 * The approved development target. Only the reviewed database, role and
 * loopback port qualify; production is never a backup source for this tool.
 */
export function resolveApprovedDevelopmentTarget(raw, {
  nodeEnv, database = approvedDatabase, allowLegacyOwner = false,
} = {}) {
  if (nodeEnv === 'production' || !raw || database !== approvedDatabase) return null;
  const url = safeUrl(raw);
  if (!url || !loopback(url.hostname) || (url.port || '5432') !== '5432') return null;
  if (url.pathname !== '/' + approvedDatabase || !url.password) return null;
  const role = resolveBackupRoleProfile(url.username, allowLegacyOwner);
  if (!role) return null;
  return {
    target: {
      hostname: url.hostname, connectionAddress: '127.0.0.1', port: 5432,
      database: approvedDatabase, user: url.username,
    },
    password: decodeURIComponent(url.password),
    roleProfile: role.profile,
  };
}

/**
 * Disposable isolated targets used by the PG17 tests. The dynamic port, name
 * prefix and database comments make it impossible to point this at the shared
 * development forward or the real development database.
 */
export function resolveIsolatedTarget(raw, {
  nodeEnv, database, allowLegacyOwner = false,
} = {}) {
  if (nodeEnv === 'production' || !raw || !database) return null;
  if (!isolatedDatabasePattern.test(database) || database === approvedDatabase) return null;
  const url = safeUrl(raw);
  if (!url || !loopback(url.hostname)) return null;
  const port = Number(url.port || 5432);
  if (!Number.isInteger(port) || port < 49152 || blockedIsolatedPorts.has(port)) return null;
  if (url.pathname !== '/' + database) return null;
  const role = resolveBackupRoleProfile(url.username, allowLegacyOwner);
  if (!role) return null;
  return {
    target: {
      hostname: url.hostname, connectionAddress: '127.0.0.1', port,
      database, user: url.username,
    },
    password: url.password ? decodeURIComponent(url.password) : '',
    roleProfile: role.profile,
  };
}

export function resolveRestoreAdminTarget(raw, { nodeEnv, mode } = {}) {
  if (nodeEnv === 'production' || !raw) return null;
  const url = safeUrl(raw);
  if (!url || !loopback(url.hostname)) return null;
  const port = Number(url.port || 5432);
  if (mode === 'isolated') {
    if (!Number.isInteger(port) || port < 49152 || blockedIsolatedPorts.has(port)) return null;
  } else if (port !== 5432) {
    return null;
  }
  return {
    hostname: url.hostname, connectionAddress: '127.0.0.1', port,
    database: decodeURIComponent(url.pathname.slice(1)), user: url.username,
    password: url.password ? decodeURIComponent(url.password) : '',
  };
}

export function isRestoreDatabaseName(name) {
  return /^xiaok_migration_restore_[a-z0-9_]{1,40}$/.test(name);
}

export function connectionFor({ host, port, database, user, password }, applicationName) {
  return {
    host, port, database, user, password,
    ssl: false,
    connectionTimeoutMillis: 8000,
    application_name: applicationName,
    options: '-c statement_timeout=0 -c lock_timeout=15000',
  };
}

export function pgPasswordEnv(password) {
  return password ? { PGPASSWORD: password } : {};
}

function childEnv(extra) {
  const env = { ...process.env, PGCONNECT_TIMEOUT: '15', ...extra };
  delete env.DATABASE_URL;
  delete env.DATABASE_MIGRATION_URL;
  delete env.XIAOK_MIGRATION_BACKUP_URL;
  delete env.XIAOK_MIGRATION_RESTORE_URL;
  return env;
}

export function resolvePgBinary(directory, name) {
  const file = directory ? path.join(directory, name) : name;
  return process.platform === 'win32' && directory && !file.endsWith('.exe') ? `${file}.exe` : file;
}

export function runProcess(command, args, { env, cwd, inputFile } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd, env: childEnv(env), stdio: [inputFile ? 'pipe' : 'ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => {
      if (stdout.length < 8_000_000) stdout += chunk.toString();
    });
    child.stderr.on('data', chunk => {
      if (stderr.length < 1_000_000) stderr += chunk.toString();
    });
    if (inputFile) {
      const input = createReadStream(inputFile);
      input.on('error', reject);
      child.stdin.on('error', () => undefined);
      input.pipe(child.stdin);
    }
    child.once('error', reject);
    child.once('close', code => resolve({ code, stdout, stderr }));
  });
}

/**
 * Streams the custom archive through stdout. Passing file paths to PostgreSQL
 * binaries is avoided because approved workspace paths contain non-ASCII text.
 */
export function runDumpToFile(command, args, { env, cwd, file }) {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(file, { flags: 'wx' });
    const child = spawn(command, args, {
      cwd, env: childEnv(env), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    let stderr = '';
    child.stderr.on('data', chunk => {
      if (stderr.length < 1_000_000) stderr += chunk.toString();
    });
    child.stdout.pipe(output);
    let settled = false;
    const finish = (error, code) => {
      if (settled) return;
      settled = true;
      if (error) {
        child.kill();
        output.destroy();
        reject(error);
      } else {
        resolve({ code, stderr });
      }
    };
    output.once('error', error => finish(error));
    child.once('error', error => finish(error));
    child.once('close', code => {
      if (output.writableFinished) finish(null, code);
      else output.once('finish', () => finish(null, code));
    });
  });
}

export async function toolVersion(binary) {
  const result = await runProcess(binary, ['--version']);
  if (result.code !== 0) throw new Error(`${path.basename(binary)} --version failed`);
  return result.stdout.trim() || result.stderr.trim();
}

export function versionMajor(text) {
  const match = String(text).match(/(\d+)\.(\d+)/);
  return match ? Number(match[1]) : null;
}

function quoteIdentifier(name) {
  return '"' + name.replaceAll('"', '""') + '"';
}

const forbiddenSnapshot = new Set(['__drizzle_migrations']);

/** Normalizes ledger rows exactly like the migration preflight digest. */
export function normalizeLedgerRows(rows) {
  return rows.map(row => ({
    id: Number(row.id), hash: String(row.hash), created_at: String(row.created_at),
  }));
}

export function ledgerFacts(rows, knownHashes = []) {
  const normalized = normalizeLedgerRows(rows);
  return {
    count: normalized.length,
    digest: sha256(JSON.stringify(normalized)),
    lastId: normalized.at(-1)?.id ?? null,
    lastTimestamp: normalized.at(-1) ? Number(normalized.at(-1).created_at) : null,
    lastHash: normalized.at(-1)?.hash ?? null,
    historicalHashes: knownHashes.map(entry => {
      const row = normalized.find(candidate => Number(candidate.created_at) === entry.when);
      return {
        tag: entry.tag, ledgerId: row?.id ?? null, when: entry.when,
        hash: row?.hash ?? null, matchesAllowlist: row?.hash === entry.hash,
      };
    }),
  };
}

async function readIdentity(client) {
  const { rows: [identity] } = await client.query(`
    SELECT current_database() AS database, current_user AS role, session_user AS "sessionRole",
      current_setting('server_version') AS version,
      current_setting('server_version_num')::int AS "versionNumber",
      pg_is_in_recovery() AS replica,
      shobj_description(
        (SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database()), 'pg_database'
      ) AS purpose,
      r.rolsuper, r.rolbypassrls, r.rolcanlogin, r.rolcreatedb, r.rolcreaterole, r.rolreplication
    FROM pg_catalog.pg_roles r WHERE r.rolname=current_user
  `);
  return identity;
}

async function readCoverage(client) {
  const { rows: tables } = await client.query(`
    SELECT c.relname FROM pg_catalog.pg_class c
    WHERE c.relnamespace='app'::regnamespace AND c.relkind IN ('r','p') AND NOT c.relispartition
      AND NOT has_table_privilege(current_user, c.oid, 'SELECT')
    ORDER BY c.relname
  `);
  const { rows: sequences } = await client.query(`
    SELECT c.relname FROM pg_catalog.pg_class c
    WHERE c.relnamespace='app'::regnamespace AND c.relkind='S'
      AND NOT has_sequence_privilege(current_user, c.oid, 'SELECT')
    ORDER BY c.relname
  `);
  const { rows: [schema] } = await client.query(
    "SELECT has_schema_privilege(current_user, 'app', 'USAGE') AS usage",
  );
  return {
    canUseSchema: schema?.usage === true,
    missingTableSelect: tables.map(row => row.relname),
    missingSequenceSelect: sequences.map(row => row.relname),
  };
}

export function assertBackupRole(identity, coverage) {
  const issues = [];
  if (identity.rolsuper !== true && identity.rolbypassrls !== true) {
    issues.push({
      code: 'backup_role_missing_bypass_rls',
      detail: 'The backup role is neither superuser nor BYPASSRLS, so FORCE RLS may silently hide rows.',
    });
  }
  if (!coverage.canUseSchema) {
    issues.push({ code: 'backup_role_missing_schema_usage', detail: 'USAGE on schema app is required.' });
  }
  if (coverage.missingTableSelect.length) {
    issues.push({
      code: 'backup_role_missing_table_select',
      detail: `Missing SELECT on tables: ${coverage.missingTableSelect.join(', ')}`,
    });
  }
  if (coverage.missingSequenceSelect.length) {
    issues.push({
      code: 'backup_role_missing_sequence_select',
      detail: `Missing SELECT on sequences: ${coverage.missingSequenceSelect.join(', ')}`,
    });
  }
  return issues;
}

async function collectDataSummary(client, tables) {
  const summary = [];
  for (const table of tables) {
    if (forbiddenSnapshot.has(table)) continue;
    const { rows: [row] } = await client.query(`
      SELECT count(*)::text AS rows,
        coalesce(md5(string_agg(md5(to_jsonb(t)::text), '' ORDER BY md5(to_jsonb(t)::text))), '') AS digest
      FROM app.${quoteIdentifier(table)} t
    `);
    summary.push({ table, rows: Number(row.rows), digest: row.digest });
  }
  return summary;
}

/**
 * Reads the schema, ledger, RLS, policy, permission and data facts that a
 * backup manifest records. The session is pinned to UTC and hex bytea so the
 * same content produces the same digest on the restore target.
 */
export async function collectDatabaseFacts(client, { includeData = true, knownHashes = [] } = {}) {
  await client.query("SET TimeZone='UTC'");
  await client.query("SET DateStyle='ISO, MDY'");
  await client.query("SET IntervalStyle='postgres'");
  await client.query("SET extra_float_digits=3");
  await client.query("SET bytea_output='hex'");
  const identity = await readIdentity(client);
  const { rows: [appSchema] } = await client.query("SELECT to_regnamespace('app')::text AS schema");
  if (!appSchema?.schema) throw new Error('app_schema_missing');
  const { rows: [ledgerTable] } = await client.query("SELECT to_regclass('app.__drizzle_migrations')::text AS ledger");
  if (!ledgerTable?.ledger) throw new Error('migration_ledger_missing');

  const { rows: relations } = await client.query(`
    SELECT c.relname AS name, c.relkind::text AS kind
    FROM pg_catalog.pg_class c
    WHERE c.relnamespace='app'::regnamespace AND c.relkind IN ('r','p') AND NOT c.relispartition
    ORDER BY c.relname
  `);
  const { rows: rlsRows } = await client.query(`
    SELECT c.relname AS name, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced
    FROM pg_catalog.pg_class c
    WHERE c.relnamespace='app'::regnamespace AND c.relkind IN ('r','p') AND NOT c.relispartition
    ORDER BY c.relname
  `);
  const { rows: policies } = await client.query(`
    SELECT tablename, policyname, permissive::text AS permissive, roles::text AS roles, cmd,
      coalesce(qual,'') AS qual, coalesce(with_check,'') AS with_check
    FROM pg_catalog.pg_policies WHERE schemaname='app'
    ORDER BY tablename, policyname
  `);
  const { rows: functions } = await client.query(`
    SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS signature,
      p.prokind::text AS kind, pg_get_userbyid(p.proowner) AS owner, coalesce(p.proacl::text,'') AS acl
    FROM pg_catalog.pg_proc p
    WHERE p.pronamespace='app'::regnamespace
    ORDER BY signature
  `);
  const { rows: triggers } = await client.query(`
    SELECT c.relname || '.' || t.tgname AS name, t.tgenabled::text AS enabled,
      pg_get_triggerdef(t.oid) AS definition
    FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
    WHERE c.relnamespace='app'::regnamespace AND NOT t.tgisinternal
    ORDER BY 1
  `);
  const { rows: [schemaAcl] } = await client.query(`
    SELECT pg_get_userbyid(nspowner) AS owner, coalesce(nspacl::text,'') AS acl
    FROM pg_catalog.pg_namespace WHERE nspname='app'
  `);
  const { rows: relationAcls } = await client.query(`
    SELECT c.relname AS name, c.relkind::text AS kind, pg_get_userbyid(c.relowner) AS owner,
      coalesce(c.relacl::text,'') AS acl
    FROM pg_catalog.pg_class c
    WHERE c.relnamespace='app'::regnamespace AND c.relkind IN ('r','p','S','v','m')
      AND NOT c.relispartition
    ORDER BY c.relname
  `);
  const { rows: ledgerRows } = await client.query(
    'SELECT id,hash,created_at FROM app.__drizzle_migrations ORDER BY id',
  );
  const ledger = ledgerFacts(ledgerRows, knownHashes);
  const { rows: columns } = await client.query(`
    SELECT c.relname AS relation, a.attname AS name, format_type(a.atttypid,a.atttypmod) AS type,
      a.attnotnull AS notnull, a.attidentity::text AS identity,
      coalesce(pg_get_expr(d.adbin,d.adrelid),'') AS "default"
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
    WHERE c.relnamespace='app'::regnamespace AND c.relkind IN ('r','p') AND NOT c.relispartition
    ORDER BY c.relname,a.attnum
  `);
  const { rows: constraints } = await client.query(`
    SELECT c.relname AS relation, con.conname AS name, con.contype::text AS type,
      con.convalidated AS validated, con.condeferrable AS deferrable, con.condeferred AS deferred,
      ARRAY(SELECT a.attname::text FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum,n)
        JOIN pg_catalog.pg_attribute a ON a.attrelid=con.conrelid AND a.attnum=k.attnum
        ORDER BY k.n) AS columns,
      ARRAY(SELECT a.attname::text FROM unnest(con.confkey) WITH ORDINALITY AS k(attnum,n)
        JOIN pg_catalog.pg_attribute a ON a.attrelid=con.confrelid AND a.attnum=k.attnum
        ORDER BY k.n) AS "targetColumns",
      CASE WHEN con.contype='c' THEN
        regexp_replace(regexp_replace(pg_get_constraintdef(con.oid), '\\s+', '', 'g'), '[()]', '', 'g')
      ELSE pg_get_constraintdef(con.oid) END AS definition
    FROM pg_catalog.pg_constraint con
    JOIN pg_catalog.pg_class c ON c.oid=con.conrelid
    WHERE c.relnamespace='app'::regnamespace
    ORDER BY c.relname,con.conname
  `);
  const { rows: indexes } = await client.query(`
    SELECT t.relname AS relation, ic.relname AS name, pg_get_indexdef(i.indexrelid) AS definition
    FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class ic ON ic.oid=i.indexrelid
    JOIN pg_catalog.pg_class t ON t.oid=i.indrelid
    WHERE t.relnamespace='app'::regnamespace
    ORDER BY t.relname,ic.relname
  `);
  const { rows: extensionRows } = await client.query(`
    SELECT extname AS name, extversion AS version FROM pg_catalog.pg_extension
    WHERE extname <> 'plpgsql' ORDER BY extname
  `);
  const dataSummary = includeData
    ? await collectDataSummary(client, relations.filter(row => row.kind === 'r').map(row => row.name))
    : [];

  const permissions = {
    schemaOwner: schemaAcl?.owner ?? null,
    ownerRoles: [...new Set([
      schemaAcl?.owner, ...relationAcls.map(row => row.owner), ...functions.map(row => row.owner),
    ].filter(Boolean))].sort(),
    relationCount: relationAcls.length,
    functionCount: functions.length,
    digest: sha256(JSON.stringify(canonicalize({
      schema: schemaAcl ?? null,
      relations: relationAcls,
      functions: functions.map(({ signature, owner, acl }) => ({ signature, owner, acl })),
    }))),
  };

  return {
    identity,
    relations: relations.map(row => ({ name: row.name, kind: row.kind })),
    dataSummary,
    ledger,
    rls: {
      rlsTableCount: rlsRows.filter(row => row.rls).length,
      forcedRlsTableCount: rlsRows.filter(row => row.forced).length,
      rlsTables: rlsRows.filter(row => row.rls).map(row => row.name),
      forcedRlsTables: rlsRows.filter(row => row.forced).map(row => row.name),
    },
    policies: { count: policies.length, digest: sha256(JSON.stringify(canonicalize(policies))) },
    functions: { count: functions.length, digest: sha256(JSON.stringify(canonicalize(functions))) },
    triggers: { count: triggers.length, digest: sha256(JSON.stringify(canonicalize(triggers))) },
    schemaObjects: {
      columnCount: columns.length,
      columnDigest: sha256(JSON.stringify(canonicalize(columns))),
      constraintCount: constraints.length,
      constraintDigest: sha256(JSON.stringify(canonicalize(constraints))),
      constraintDigestMode: 'check_expressions_parenthesis_normalized',
      indexCount: indexes.length,
      indexDigest: sha256(JSON.stringify(canonicalize(indexes))),
    },
    extensions: {
      count: extensionRows.length,
      names: extensionRows.map(row => row.name),
      digest: sha256(JSON.stringify(canonicalize(extensionRows))),
    },
    permissions,
  };
}

export function parseTocEntries(text) {
  return String(text).split(/\r?\n/).map(line => {
    const match = line.match(/^\d+;\s+\d+\s+\d+\s+(.+)$/);
    if (!match) return null;
    const parts = match[1].split(/\s+/);
    let description = parts[0];
    let offset = 1;
    if (parts[0] === 'TABLE' && parts[1] === 'DATA') {
      description = 'TABLE DATA';
      offset = 2;
    } else if (parts[0] === 'MATERIALIZED' && parts[1] === 'VIEW' && parts[2] === 'DATA') {
      description = 'MATERIALIZED VIEW DATA';
      offset = 3;
    }
    return {
      description, schema: parts[offset] ?? null, name: parts[offset + 1] ?? null,
      rest: parts.slice(offset + 2),
    };
  }).filter(Boolean);
}

export function missingTableDataEntries(entries, dataSummary) {
  const present = new Set(entries
    .filter(entry => entry.description === 'TABLE DATA' && entry.schema === 'app')
    .map(entry => entry.name));
  return dataSummary.filter(row => row.rows > 0 && !present.has(row.table)).map(row => row.table);
}

async function readManifestInputs() {
  const inputs = loadIntegrationMigrationInputs(drizzleDir);
  return inputs;
}

export function validateSourceLedger(rows, inputs) {
  try {
    const { seen, schema, supersedesOriginal } = validateLedger(
      rows, inputs.active, inputs.forks, inputs.knownHashes,
    );
    return { status: 'passed', schema, applied: seen.size, supersedesOriginal };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ledger_validation_failed';
    return { status: 'failed', reason: message.split('\n')[0].slice(0, 240) };
  }
}

export async function inspectBackupDirectory(directory, {
  minFreeBytes = defaultMinFreeBytes,
} = {}) {
  const resolved = path.resolve(directory);
  const relative = path.relative(repoRoot, resolved);
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    return { ok: false, reason: 'backup_directory_inside_repository' };
  }
  if (!relative) return { ok: false, reason: 'backup_directory_inside_repository' };
  const stats = await fs.stat(resolved).catch(() => null);
  if (!stats?.isDirectory()) return { ok: false, reason: 'backup_directory_missing' };

  let owner = null;
  if (process.platform === 'win32') {
    const script = `$acl = Get-Acl -LiteralPath '${resolved.replaceAll("'", "''")}';
$entries = @($acl.Access | ForEach-Object { [pscustomobject]@{ Identity = $_.IdentityReference.Value; Rights = $_.FileSystemRights.ToString() } });
[pscustomobject]@{ Owner = $acl.Owner; Access = $entries } | ConvertTo-Json -Compress -Depth 4`;
    const powershell = path.join(process.env.SystemRoot || 'C:/Windows',
      'System32/WindowsPowerShell/v1.0/powershell.exe');
    const result = await runProcess(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64')]);
    if (result.code !== 0) return { ok: false, reason: 'backup_directory_acl_unreadable' };
    let acl;
    try {
      acl = JSON.parse(result.stdout);
    } catch {
      return { ok: false, reason: 'backup_directory_acl_unreadable' };
    }
    owner = acl.Owner ?? null;
    const access = Array.isArray(acl.Access) ? acl.Access : acl.Access ? [acl.Access] : [];
    const broadWrite = access.filter(entry => /(Authenticated Users|Everyone)/i.test(String(entry.Identity ?? ''))
      && /(Modify|FullControl|Write|CreateFiles|AppendData|Delete)/i.test(String(entry.Rights ?? '')));
    if (broadWrite.length) {
      return { ok: false, reason: 'backup_directory_acl_unsafe',
        detail: broadWrite.map(entry => ({ identity: entry.Identity, rights: entry.Rights })) };
    }
    if (owner && /(Everyone|Authenticated Users)/i.test(owner)) {
      return { ok: false, reason: 'backup_directory_owner_unsafe', owner };
    }
  } else {
    if ((stats.mode & 0o022) !== 0) {
      return { ok: false, reason: 'backup_directory_group_or_world_writable' };
    }
    if (typeof process.getuid === 'function' && stats.uid !== process.getuid() && stats.uid !== 0) {
      return { ok: false, reason: 'backup_directory_owner_mismatch' };
    }
  }

  const space = await fs.statfs(resolved).catch(() => null);
  if (!space) return { ok: false, reason: 'backup_directory_space_unknown' };
  const freeBytes = Number(space.bavail) * Number(space.bsize);
  if (!Number.isFinite(freeBytes) || freeBytes < minFreeBytes) {
    return { ok: false, reason: 'backup_directory_insufficient_space', freeBytes, minFreeBytes };
  }
  return { ok: true, directory: resolved, owner, freeBytes };
}

async function createBackup({ client, target, password, pgBin, outputDir, mode, label, startedAt,
  roleProfile, legacyRiskConfirmed }) {
  const pgDump = resolvePgBinary(pgBin, 'pg_dump');
  const pgRestore = resolvePgBinary(pgBin, 'pg_restore');
  const [pgDumpVersion, pgRestoreVersion] = await Promise.all([
    toolVersion(pgDump), toolVersion(pgRestore),
  ]);
  if (versionMajor(pgDumpVersion) !== 17 || versionMajor(pgRestoreVersion) !== 17) {
    throw new Error('pg_client_major_must_be_17');
  }

  const inputs = await readManifestInputs();
  const facts = await (async () => {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try {
      const identity = await readIdentity(client);
      if (identity.database !== target.database || identity.role !== target.user
        || identity.sessionRole !== target.user) throw new Error('database_identity_mismatch');
      if (identity.versionNumber < 170000 || identity.versionNumber >= 180000) {
        throw new Error('postgres_major_must_be_17');
      }
      if (identity.replica) throw new Error('backup_source_is_a_replica');
      if (identity.rolcanlogin !== true) throw new Error('backup_role_cannot_login');
      if (!['least_privilege', 'legacy_owner'].includes(roleProfile)) {
        throw new Error('unapproved_backup_role');
      }
      if (roleProfile === 'least_privilege' && identity.rolsuper === true) {
        throw new Error('least_privilege_backup_role_must_not_be_superuser');
      }
      if (roleProfile === 'legacy_owner' && identity.rolsuper === true && legacyRiskConfirmed !== true) {
        throw new Error('superuser_backup_requires_explicit_confirmation');
      }
      const { rows: [appSchema] } = await client.query("SELECT to_regnamespace('app')::text AS schema");
      if (!appSchema?.schema) throw new Error('app_schema_missing');
      const { rows: [ledgerTable] } = await client.query(
        "SELECT to_regclass('app.__drizzle_migrations')::text AS ledger",
      );
      if (!ledgerTable?.ledger) throw new Error('migration_ledger_missing');
      const coverage = await readCoverage(client);
      const issues = assertBackupRole(identity, coverage);
      if (issues.length) {
        const error = new Error(issues[0].code);
        error.issues = issues;
        throw error;
      }
      const { rows: ledgerRows } = await client.query(
        'SELECT id,hash,created_at FROM app.__drizzle_migrations ORDER BY id',
      );
      const ledgerValidation = validateSourceLedger(ledgerRows, inputs);
      if (ledgerValidation.status !== 'passed') {
        const error = new Error('ledger_validation_failed');
        error.detail = ledgerValidation.reason;
        throw error;
      }
      await client.query('SAVEPOINT delegation_check');
      try {
        await verifyDelegationSchema(client, ledgerValidation.schema);
      } catch {
        await client.query('ROLLBACK TO SAVEPOINT delegation_check');
        throw new Error('delegation_schema_mismatch');
      } finally {
        await client.query('RELEASE SAVEPOINT delegation_check');
      }
      const collected = await collectDatabaseFacts(client, {
        includeData: true, knownHashes: inputs.knownHashes,
      });
      return { ...collected, coverage, ledgerValidation };
    } finally {
      await client.query('COMMIT').catch(() => undefined);
    }
  })();

  const backupId = `xiaok-mig-${new Date(startedAt).toISOString().replace(/[-:.]/g, '').toLowerCase()}-${randomBytes(4).toString('hex')}`;
  const workDirectory = path.join(outputDir, `.tmp-${backupId}-${randomBytes(4).toString('hex')}`);
  const finalDirectory = path.join(outputDir, backupId);
  await fs.mkdir(workDirectory, { recursive: true });
  const archivePath = path.join(workDirectory, ARCHIVE_FILE);
  let manifest;
  try {
    const dump = await runDumpToFile(pgDump, [
      '--format=custom',
      '--compress=6',
      '--no-password',
      '--lock-wait-timeout=30000',
      '--host', target.connectionAddress,
      '--port', String(target.port),
      '--username', target.user,
      '--dbname', target.database,
    ], { env: pgPasswordEnv(password), file: archivePath });
    if (dump.code !== 0) {
      throw new Error(`pg_dump_failed:${dump.stderr.trim().slice(-600) || dump.code}`);
    }
    const stats = await fs.stat(archivePath).catch(() => null);
    if (!stats?.size) throw new Error('pg_dump_created_an_empty_archive');
    const archiveSha256 = await sha256File(archivePath);

    const list = await runProcess(pgRestore, ['--list'], { inputFile: archivePath });
    if (list.code !== 0) throw new Error('pg_restore_list_failed');
    const tocEntries = parseTocEntries(list.stdout);
    const missing = missingTableDataEntries(tocEntries, facts.dataSummary);
    if (!tocEntries.length) throw new Error('pg_restore_list_empty');
    if (missing.length) {
      const error = new Error('archive_missing_table_data');
      error.detail = missing.join(', ');
      throw error;
    }

    await fs.writeFile(path.join(workDirectory, SHA256_FILE),
      formatSha256File(archiveSha256, ARCHIVE_FILE), { flag: 'wx' });

    manifest = {
      version: MANIFEST_VERSION,
      backupId,
      createdAt: new Date().toISOString(),
      label: label ?? null,
      targetMode: mode,
      sourceDatabase: target.database,
      sourceHost: `${target.hostname}:${target.port}`,
      sourceRole: target.user,
      databasePurpose: facts.identity.purpose ?? null,
      postgresqlVersion: facts.identity.version,
      postgresqlVersionNumber: facts.identity.versionNumber,
      backupRole: {
        name: facts.identity.role,
        profile: roleProfile,
        rolsuper: facts.identity.rolsuper,
        rolbypassrls: facts.identity.rolbypassrls,
        rolcanlogin: facts.identity.rolcanlogin,
        rolcreatedb: facts.identity.rolcreatedb,
        rolcreaterole: facts.identity.rolcreaterole,
        rolreplication: facts.identity.rolreplication,
        legacyOwnerRiskConfirmed: roleProfile === 'legacy_owner' && legacyRiskConfirmed === true,
        superuserConfirmed: roleProfile === 'legacy_owner' && legacyRiskConfirmed === true
          && facts.identity.rolsuper === true,
        fullReadProof: facts.identity.rolsuper ? 'superuser' : 'bypassrls',
        tableSelectCoverage: {
          checked: true,
          missing: facts.coverage.missingTableSelect,
        },
        sequenceSelectCoverage: {
          checked: true,
          missing: facts.coverage.missingSequenceSelect,
        },
        schemaUsage: facts.coverage.canUseSchema,
      },
      migrationLedgerCount: facts.ledger.count,
      migrationLedgerDigest: facts.ledger.digest,
      migrationLedgerLastId: facts.ledger.lastId,
      migrationLedgerLastTimestamp: facts.ledger.lastTimestamp,
      migrationLedgerDigestAlgorithm: 'sha256:json-v1',
      latestMigration: {
        tag: inputs.active.find(entry => entry.when === facts.ledger.lastTimestamp)?.tag ?? null,
        when: facts.ledger.lastTimestamp,
        ledgerId: facts.ledger.lastId,
        hash: facts.ledger.lastHash,
      },
      ledgerValidation: facts.ledgerValidation.status,
      historicalHashes: facts.ledger.historicalHashes,
      archive: {
        file: ARCHIVE_FILE,
        bytes: stats.size,
        sha256: archiveSha256,
        format: 'custom',
        ownerMode: 'full',
        privilegesMode: 'full',
      },
      backupBytes: stats.size,
      backupSha256: archiveSha256,
      pgDumpVersion,
      pgRestoreVersion,
      restoreListVerified: true,
      restoreList: {
        entries: tocEntries.length,
        tableDataEntries: tocEntries.filter(entry => entry.description === 'TABLE DATA').length,
      },
      schemaSummary: {
        tableCount: facts.relations.length,
        rlsTableCount: facts.rls.rlsTableCount,
        forcedRlsTableCount: facts.rls.forcedRlsTableCount,
        policyCount: facts.policies.count,
      },
      rls: facts.rls,
      policies: facts.policies,
      functions: facts.functions,
      triggers: facts.triggers,
      schemaObjects: facts.schemaObjects,
      extensions: facts.extensions,
      permissions: facts.permissions,
      dataSummary: facts.dataSummary,
      relations: facts.relations,
      backupStatus: 'complete',
    };
    manifest.manifestDigest = computeManifestDigest(manifest);
    const shape = validateManifestShape(manifest);
    if (!shape.ok) {
      throw new Error(`manifest_invalid:${shape.errors.join(',')}`);
    }
    await fs.writeFile(path.join(workDirectory, MANIFEST_FILE),
      JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
    await fs.access(finalDirectory).then(
      () => { throw new Error('backup_id_collision'); },
      () => undefined,
    );
    await fs.rename(workDirectory, finalDirectory);
    return { manifest, finalDirectory };
  } catch (error) {
    await fs.rm(workDirectory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export function parseBackupArguments(argv) {
  return parseArgs({
    args: argv,
    options: {
      mode: { type: 'string', default: 'development' },
      database: { type: 'string', default: approvedDatabase },
      'output-dir': { type: 'string' },
      'pg-bin': { type: 'string' },
      label: { type: 'string' },
      'allow-legacy-owner': { type: 'boolean', default: false },
      'min-free-bytes': { type: 'string' },
    },
  }).values;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const values = parseBackupArguments(argv);
  const mode = values.mode;
  if (!['development', 'isolated'].includes(mode)) {
    return { status: 'blocked', reason: 'unsupported_mode' };
  }
  const allowLegacyOwner = values['allow-legacy-owner'] === true
    || env.XIAOK_MIGRATION_ALLOW_LEGACY_OWNER === '1';
  const rawUrl = env.XIAOK_MIGRATION_BACKUP_URL;
  const requestedRole = safeUrl(rawUrl)?.username;
  if (requestedRole === legacyBackupRole && !allowLegacyOwner) {
    return { status: 'blocked', reason: 'legacy_backup_role_requires_explicit_confirmation' };
  }
  if (requestedRole && !approvedBackupRoles.has(requestedRole)) {
    return { status: 'blocked', reason: 'unapproved_backup_role' };
  }
  const approved = mode === 'development'
    ? resolveApprovedDevelopmentTarget(rawUrl, {
      nodeEnv: env.NODE_ENV, database: values.database, allowLegacyOwner,
    })
    : resolveIsolatedTarget(rawUrl, {
      nodeEnv: env.NODE_ENV, database: values.database, allowLegacyOwner,
    });
  if (!approved) return { status: 'blocked', reason: 'unapproved_backup_target' };
  const outputDir = path.resolve(values['output-dir'] ?? path.join(adminRoot, '.postgres-backups'));
  const requestedMinFree = values['min-free-bytes'] ?? env.XIAOK_MIGRATION_MIN_FREE_BYTES;
  const minFreeBytes = requestedMinFree === undefined ? defaultMinFreeBytes : Number(requestedMinFree);
  if (!Number.isSafeInteger(minFreeBytes) || minFreeBytes <= 0) {
    return { status: 'blocked', reason: 'invalid_min_free_bytes' };
  }
  const storage = await inspectBackupDirectory(outputDir, { minFreeBytes });
  if (!storage.ok) {
    return { status: 'blocked', reason: storage.reason, detail: storage };
  }
  const pgBin = values['pg-bin'] ?? env.PG_BIN ?? env.PG_BIN_DIR ?? '';
  const startedAt = Date.now();
  const client = new pg.Client(connectionFor({
    host: approved.target.connectionAddress, port: approved.target.port,
    database: approved.target.database, user: approved.target.user,
    password: approved.password,
  }, 'xiaok-migration-backup'));
  try {
    await client.connect();
    const identity = await readIdentity(client);
    if (mode === 'isolated') {
      if (identity.purpose !== isolatedSourceMarker) {
        return { status: 'blocked', reason: 'isolated_database_marker_missing' };
      }
      const { rows: [cluster] } = await client.query(
        "SELECT shobj_description(oid,'pg_database') AS purpose FROM pg_database WHERE datname='postgres'",
      );
      if (cluster?.purpose !== isolatedClusterMarker) {
        return { status: 'blocked', reason: 'isolated_cluster_marker_missing' };
      }
    }
    const { manifest, finalDirectory } = await createBackup({
      client, target: approved.target, password: approved.password, pgBin,
      outputDir, mode, label: values.label, startedAt,
      roleProfile: approved.roleProfile, legacyRiskConfirmed: allowLegacyOwner,
    });
    return {
      status: 'passed',
      backupId: manifest.backupId,
      backupDirectory: path.relative(process.cwd(), finalDirectory),
      backupBytes: manifest.backupBytes,
      backupSha256: manifest.backupSha256,
      migrationLedgerCount: manifest.migrationLedgerCount,
      migrationLedgerDigest: manifest.migrationLedgerDigest,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      status: 'failed',
      reason: error?.message?.split('\n')[0].slice(0, 400) ?? 'backup_failed',
      detail: error?.detail ?? null,
      issues: error?.issues ?? null,
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(result => {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exitCode = result.status === 'passed' ? 0 : result.status === 'blocked' ? 2 : 1;
  }).catch(error => {
    process.stdout.write(JSON.stringify({
      status: 'failed', reason: error?.message?.split('\n')[0] ?? 'backup_execution_error',
    }) + '\n');
    process.exitCode = 1;
  });
}
