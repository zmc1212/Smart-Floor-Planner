import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import pg from 'pg';

const adminRoot = fileURLToPath(new URL('../', import.meta.url));
const approvedDatabase = 'smart_floor_planner';
const isolatedPattern = /^xiaok_i749_[a-z0-9_]{1,40}$/;
const blockedPorts = new Set([5432, 55432]);

function safeUrl(value: string | undefined): URL | null {
  if (!value) return null;
  try { return new URL(value); } catch { return null; }
}

function loopback(host: string): boolean {
  return ['127.0.0.1', 'localhost', '::1'].includes(host);
}

type TargetOptions = { mode?: string; database?: string; nodeEnv?: string };

export function resolveCheckTarget(raw: string | undefined, {
  mode, database, nodeEnv,
}: TargetOptions = {}) {
  if (nodeEnv === 'production') return { error: 'production_target_rejected' };
  const url = safeUrl(raw);
  if (!url) return { error: 'backup_role_check_url_missing' };
  if (url.username !== 'sfp_app' || !url.password) {
    return { error: 'backup_role_check_target_must_use_sfp_app' };
  }
  if (!loopback(url.hostname)) return { error: 'backup_role_check_target_not_loopback' };
  if (mode === 'development') {
    if ((url.port || '5432') !== '5432' || url.pathname !== `/${approvedDatabase}`
      || database !== approvedDatabase) {
      return { error: 'unapproved_backup_role_check_target' };
    }
    return { host: '127.0.0.1', port: 5432, database: approvedDatabase, user: 'sfp_app',
      password: decodeURIComponent(url.password) };
  }
  if (mode !== 'isolated') return { error: 'unsupported_mode' };
  const port = Number(url.port || 5432);
  if (!database || !isolatedPattern.test(database) || database === approvedDatabase
    || !Number.isInteger(port) || port < 49152 || blockedPorts.has(port)
    || url.pathname !== `/${database}`) {
    return { error: 'unapproved_isolated_backup_role_check_target' };
  }
  return { host: '127.0.0.1', port, database, user: 'sfp_app',
    password: decodeURIComponent(url.password) };
}

function envUrlUsers(adminPath: string) {
  const violations: { key: string; reason: string }[] = [];
  const inspect = (key: string, value: string | undefined) => {
    const url = safeUrl(value);
    if (url?.username === 'sfp_backup') violations.push({ key, reason: 'sfp_backup_present' });
  };
  for (const key of ['DATABASE_URL', 'DATABASE_MIGRATION_URL', 'XIAOK_MIGRATION_RESTORE_URL']) {
    inspect(key, process.env[key]);
  }
  for (const file of ['.env', '.env.local']) {
    let content = '';
    try { content = readFileSync(path.join(adminPath, file), 'utf8'); } catch { continue; }
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*(DATABASE_URL|DATABASE_MIGRATION_URL|XIAOK_MIGRATION_RESTORE_URL)\s*=\s*(.+)\s*$/);
      if (match) inspect(`${file}:${match[1]}`, match[2].replace(/^['"]|['"]$/g, ''));
    }
  }
  return violations;
}

export async function inspectBackupRole(client: pg.Client, {
  adminPath = adminRoot,
}: { adminPath?: string } = {}) {
  const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
  const failures: { code: string; detail?: unknown }[] = [];
  const add = (name: string, passed: boolean, detail: unknown = {}) => {
    checks.push({ name, passed, detail });
    if (!passed) failures.push({ code: name, detail });
  };

  const { rows: [role] } = await client.query(`
    SELECT rolname, rolcanlogin, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication
    FROM pg_catalog.pg_roles WHERE rolname='sfp_backup'
  `);
  if (!role) {
    add('role_exists', false, { role: 'sfp_backup' });
    return { checks, failures, role: null };
  }
  add('role_exists', true);
  add('rolcanlogin', role.rolcanlogin === true);
  add('rolsuper_false', role.rolsuper === false);
  add('rolbypassrls_true', role.rolbypassrls === true);
  add('rolcreatedb_false', role.rolcreatedb === false);
  add('rolcreaterole_false', role.rolcreaterole === false);
  add('rolreplication_false', role.rolreplication === false);

  const { rows: [membership] } = await client.query(`
    SELECT pg_has_role('sfp_backup','sfp_owner','MEMBER') AS owner_member,
      pg_has_role('sfp_backup','sfp_migrator','MEMBER') AS migrator_member
  `);
  add('not_owner_or_migrator_member', !membership.owner_member && !membership.migrator_member, membership);

  const { rows: [privileges] } = await client.query(`
    SELECT has_schema_privilege('sfp_backup','app','USAGE') AS schema_usage,
      has_schema_privilege('sfp_backup','app','CREATE') AS schema_create,
      has_database_privilege('sfp_backup',current_database(),'CONNECT') AS database_connect,
      has_database_privilege('sfp_backup',current_database(),'CREATE') AS database_create
  `);
  add('app_schema_usage', privileges.schema_usage === true);
  add('database_connect', privileges.database_connect === true);
  add('no_schema_create', privileges.schema_create === false);
  add('no_database_create', privileges.database_create === false);

  const { rows: missingTables } = await client.query(`
    SELECT c.relname FROM pg_class c
    WHERE c.relnamespace='app'::regnamespace AND c.relkind IN ('r','p') AND NOT c.relispartition
      AND NOT has_table_privilege('sfp_backup', c.oid, 'SELECT')
    ORDER BY c.relname
  `);
  add('all_tables_selectable', missingTables.length === 0, {
    missingCount: missingTables.length, missing: missingTables.slice(0, 20).map((row: { relname: string }) => row.relname),
  });

  const { rows: missingSequences } = await client.query(`
    WITH seqs AS MATERIALIZED (
      SELECT oid, relname FROM pg_class
      WHERE relnamespace='app'::regnamespace AND relkind='S'
    )
    SELECT relname FROM seqs
    WHERE NOT has_sequence_privilege('sfp_backup', oid, 'SELECT')
    ORDER BY relname
  `);
  add('all_sequences_selectable', missingSequences.length === 0, {
    missingCount: missingSequences.length, missing: missingSequences.slice(0, 20).map((row: { relname: string }) => row.relname),
  });

  const { rows: writes } = await client.query(`
    SELECT c.relname, p.privilege FROM pg_class c
    CROSS JOIN (VALUES ('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE')) p(privilege)
    WHERE c.relnamespace='app'::regnamespace AND c.relkind IN ('r','p') AND NOT c.relispartition
      AND has_table_privilege('sfp_backup', c.oid, p.privilege)
    ORDER BY c.relname, p.privilege
  `);
  add('no_table_write_privileges', writes.length === 0, {
    violationCount: writes.length,
    violations: writes.slice(0, 20).map((row: { relname: string; privilege: string }) => `${row.relname}:${row.privilege}`),
  });

  const { rows: owned } = await client.query(`
    SELECT c.relname, c.relkind FROM pg_class c
    WHERE c.relnamespace='app'::regnamespace
      AND c.relkind IN ('r','p','S')
      AND pg_get_userbyid(c.relowner)='sfp_backup'
    ORDER BY c.relname
  `);
  add('no_object_ownership', owned.length === 0, {
    ownedCount: owned.length, owned: owned.slice(0, 20).map((row: { relname: string }) => row.relname),
  });

  const { rows: [ledgerTable] } = await client.query(
    "SELECT to_regclass('app.__drizzle_migrations') AS relation",
  );
  if (!ledgerTable.relation) {
    add('migration_ledger_write_forbidden', false, { reason: 'ledger_missing' });
  } else {
    const { rows: [ledger] } = await client.query(`
      SELECT has_table_privilege('sfp_backup','app.__drizzle_migrations','INSERT') AS can_insert,
        has_table_privilege('sfp_backup','app.__drizzle_migrations','UPDATE') AS can_update,
        has_table_privilege('sfp_backup','app.__drizzle_migrations','DELETE') AS can_delete,
        has_table_privilege('sfp_backup','app.__drizzle_migrations','TRUNCATE') AS can_truncate
    `);
    add('migration_ledger_write_forbidden',
      !ledger.can_insert && !ledger.can_update && !ledger.can_delete && !ledger.can_truncate, ledger);
  }

  const { rows: [appRole] } = await client.query(`
    SELECT rolcanlogin, rolsuper, rolbypassrls FROM pg_catalog.pg_roles WHERE rolname='sfp_app'
  `);
  const { rows: [rls] } = await client.query(`
    SELECT count(*) FILTER (WHERE c.relforcerowsecurity)::int AS forced_rls_tables,
      (SELECT count(*)::int FROM pg_policies WHERE schemaname='app'
        AND ('public' = ANY(roles) OR 'sfp_app' = ANY(roles))) AS sfp_app_policies,
      (SELECT count(*)::int FROM pg_class c2 WHERE c2.relnamespace='app'::regnamespace
        AND c2.relkind IN ('r','p') AND c2.relforcerowsecurity
        AND has_table_privilege('sfp_app', c2.oid, 'SELECT')) AS sfp_app_rls_selectable
    FROM pg_class c WHERE c.relnamespace='app'::regnamespace AND c.relkind IN ('r','p') AND NOT c.relispartition
  `);
  add('sfp_app_still_rls_limited', Boolean(appRole)
    && appRole.rolsuper === false && appRole.rolbypassrls === false
    && rls.forced_rls_tables > 0 && rls.sfp_app_policies > 0 && rls.sfp_app_rls_selectable > 0,
  { role: appRole ?? null, ...rls });

  const { rows: [sessions] } = await client.query(`
    SELECT count(*)::int AS n FROM pg_stat_activity
    WHERE usename='sfp_backup' AND pid<>pg_backend_pid()
  `);
  const envViolations = envUrlUsers(adminPath);
  add('not_used_by_app_or_worker', sessions.n === 0 && envViolations.length === 0,
    { activeBackupSessions: sessions.n, envViolations });

  return { checks, failures, role };
}

async function main() {
  const values = parseArgs({
    options: {
      mode: { type: 'string', default: 'development' },
      database: { type: 'string', default: approvedDatabase },
    },
    allowPositionals: false,
  }).values;
  const target = resolveCheckTarget(process.env.XIAOK_BACKUP_ROLE_CHECK_URL, {
    mode: values.mode, database: values.database, nodeEnv: process.env.NODE_ENV,
  });
  if (target.error) {
    console.log(JSON.stringify({ status: 'blocked', reason: target.error }, null, 2));
    process.exitCode = 1;
    return;
  }
  const client = new pg.Client({
    host: target.host, port: target.port, database: target.database, user: target.user,
    password: target.password, ssl: false, connectionTimeoutMillis: 8000,
    options: '-c default_transaction_read_only=on -c statement_timeout=20000 -c lock_timeout=3000',
  });
  try {
    await client.connect();
    if (values.mode === 'isolated') {
      const { rows: [database] } = await client.query(
        "SELECT shobj_description(oid,'pg_database') AS purpose FROM pg_database WHERE datname=current_database()",
      );
      const { rows: [cluster] } = await client.query(
        "SELECT shobj_description(oid,'pg_database') AS purpose FROM pg_database WHERE datname='postgres'",
      );
      if (database?.purpose !== 'xiaok-i749-backup-sandbox' || cluster?.purpose !== 'xiaok-i749-isolated-test') {
        console.log(JSON.stringify({ status: 'blocked', reason: 'isolated_marker_missing' }, null, 2));
        process.exitCode = 1;
        return;
      }
    }
    const result = await inspectBackupRole(client);
    const status = result.failures.length === 0 ? 'passed' : 'failed';
    console.log(JSON.stringify({
      status,
      mode: values.mode,
      database: target.database,
      roleCheckUser: target.user,
      role: result.role,
      checks: result.checks,
      failures: result.failures,
    }, null, 2));
    process.exitCode = status === 'passed' ? 0 : 1;
  } catch (error: unknown) {
    const code = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: string }).code)
      : 'unknown';
    console.log(JSON.stringify({ status: 'blocked', reason: 'connection_failed',
      code }, null, 2));
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => undefined);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error: unknown) => {
    const code = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: string }).code)
      : 'unknown';
    console.log(JSON.stringify({
      status: 'blocked', reason: 'unexpected_error', code,
    }, null, 2));
    process.exitCode = 1;
  });
}
