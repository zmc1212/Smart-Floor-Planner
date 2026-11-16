import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { loadEnvConfig } from '@next/env';
import type { MigrationMeta } from 'drizzle-orm/migrator';
import { Client } from 'pg';
import { setTransactionScope } from '@/db/transaction';
import {
  loadIntegrationMigrationInputs, pendingMigrations, validateLedger, verifyDelegationSchema,
} from './postgres-integration-migrations.mjs';
import { auditNotificationConfig, auditPendingMigration, readCatalog, type AuditClient } from './xiaok-migration-preflight-checks';

const root = fileURLToPath(new URL('../', import.meta.url));
const drizzle = path.join(root, 'drizzle');
const run = promisify(execFile);
const database = 'smart_floor_planner';
const username = 'sfp_app';
const enterpriseId = '1454';
const connectionPort = 5432;

type JournalEntry = { when: number; tag: string; hashes: Set<string> };
type MigrationInputs = {
  active: JournalEntry[];
  forks: Record<string, JournalEntry[]>;
  knownHashes: { when: number; tag: string; ledgerId: number; hash: string }[];
  migrations: MigrationMeta[];
};
type LedgerRow = { id: number; hash: string; created_at: string };
type Identity = {
  database: string; role: string; sessionRole: string; version: string; versionNumber: number;
  serverAddress: string | null; serverPort: number | null; readOnly: string; isolation: string; replica: boolean;
  rolsuper: boolean; rolbypassrls: boolean;
};

export function resolveApprovedTarget(value: string | undefined, nodeEnv?: string, role: 'sfp_app' | 'sfp_migrator' = username) {
  if (nodeEnv === 'production' || !value) return null;
  try {
    const url = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1'].includes(url.hostname)
      || (url.port && url.port !== String(connectionPort)) || url.pathname !== '/' + database
      || url.username !== role || !url.password || url.search || url.hash) return null;
    return {
      target: { hostname: url.hostname, connectionAddress: '127.0.0.1', port: connectionPort, database, user: role },
      password: decodeURIComponent(url.password),
    };
  } catch {
    return null;
  }
}

function safeSqlState(error: unknown) {
  const code = (error as { code?: unknown })?.code;
  return typeof code === 'string' && /^[A-Z0-9]{5}$/.test(code) ? code : null;
}

function ledgerFailure(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (message.startsWith('Unrecognized migration')) return 'unrecognized_migration';
  if (message.startsWith('Duplicate migration timestamp')) return 'duplicate_timestamp';
  if (message.startsWith('Migration history has a gap')) return 'prefix_gap';
  if (message.startsWith('Mixed XiaoK fork')) return 'mixed_fork';
  return 'ledger_validation_failed';
}

export function inspectLedger(rows: readonly LedgerRow[], inputs: MigrationInputs) {
  const { active, migrations, forks, knownHashes } = inputs;
  const duplicateTimestamps = rows.length - new Set(rows.map(row => String(row.created_at))).size;
  const historicalHashes = knownHashes.map(entry => ({
    tag: entry.tag, ledgerId: entry.ledgerId, timestamp: entry.when,
    exact: active.some(item => item.when === entry.when && item.tag === entry.tag)
      && rows.some(row => row.id === entry.ledgerId && Number(row.created_at) === entry.when && row.hash === entry.hash),
  }));
  const facts = {
    count: rows.length, lastId: rows.at(-1)?.id ?? null,
    lastTimestamp: rows.length ? Number(rows.at(-1)?.created_at) : null, duplicateTimestamps, historicalHashes,
    digest: createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
  };
  try {
    const { seen, schema, supersedesOriginal } = validateLedger(rows, active, forks, knownHashes);
    const tagByTime = new Map(active.map(entry => [entry.when, entry.tag]));
    const pending: MigrationMeta[] = pendingMigrations(migrations, seen, supersedesOriginal);
    const legacyFork = Object.entries(forks).find(([, entries]) => entries.some(entry =>
      rows.some(row => Number(row.created_at) === entry.when && entry.hashes.has(row.hash))))?.[0] ?? null;
    return {
      ...facts, status: historicalHashes.every(entry => entry.exact) ? 'passed' : 'failed',
      recognized: rows.length, prefixGap: false, mixedFork: false, schema, legacyFork,
      pending: pending.map(entry => String(tagByTime.get(entry.folderMillis))),
    };
  } catch (error) {
    const reason = ledgerFailure(error);
    return {
      ...facts, status: 'failed', reason, recognized: null, prefixGap: reason === 'prefix_gap' ? true : null,
      mixedFork: reason === 'mixed_fork' ? true : null, schema: null, legacyFork: null, pending: null,
    };
  }
}

async function isolatedCheck<T>(client: AuditClient, read: () => Promise<T>) {
  await client.query('SAVEPOINT preflight_check');
  try {
    return await read();
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT preflight_check');
    return { status: 'limited' as const, reason: 'check_query_failed', sqlstate: safeSqlState(error) };
  } finally {
    await client.query('RELEASE SAVEPOINT preflight_check');
  }
}

export async function readMigrationPreflight(client: AuditClient, inputs: MigrationInputs) {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    const { rows: [identity] } = await client.query<Identity>(`
      SELECT current_database() AS database, current_user AS role, session_user AS "sessionRole",
        current_setting('server_version') AS version, current_setting('server_version_num')::int AS "versionNumber",
        inet_server_addr()::text AS "serverAddress", inet_server_port() AS "serverPort",
        current_setting('transaction_read_only') AS "readOnly", current_setting('transaction_isolation') AS isolation,
        pg_is_in_recovery() AS replica, rolsuper, rolbypassrls
      FROM pg_catalog.pg_roles WHERE rolname=current_user
    `);
    if (!identity || identity.database !== database || identity.role !== username || identity.sessionRole !== username
      || identity.rolsuper !== false || identity.rolbypassrls !== false || identity.readOnly !== 'on'
      || identity.isolation !== 'repeatable read'
      || identity.replica !== false || identity.serverPort !== connectionPort
      || identity.versionNumber < 170000 || identity.versionNumber >= 180000) {
      return { status: 'blocked', reason: 'server_identity_mismatch' };
    }

    await setTransactionScope(client, { kind: 'tenant', enterpriseId });
    const { rows: [enterprise] } = await client.query<{ exists: boolean; active: boolean }>(`
      SELECT EXISTS(SELECT 1 FROM app.enterprises WHERE id=$1) AS exists,
        EXISTS(SELECT 1 FROM app.enterprises WHERE id=$1 AND status='active') AS active
    `, [enterpriseId]);
    if (!enterprise.active) return { status: 'blocked', reason: 'enterprise_unavailable', identity, enterprise };

    const { rows } = await client.query<LedgerRow>('SELECT id,hash,created_at FROM app.__drizzle_migrations ORDER BY id');
    const ledger = inspectLedger(rows, inputs);
    await setTransactionScope(client, { kind: 'platform' });
    const notification = await isolatedCheck(client, () => auditNotificationConfig(client,
      path.join(drizzle, '0021_platform_notification_config.sql'),
      path.join(root, '../docs/miniprogram-subscription-notification-template-baseline.zh-CN.md')));
    const { rows: [space] } = await client.query<{ bytes: string }>('SELECT pg_database_size(current_database())::text AS bytes');
    const { rows: [migrationRole] } = await client.query<{
      rolsuper: boolean; rolbypassrls: boolean; rolcanlogin: boolean; appSchemaCreate: boolean; ledgerWrite: boolean;
      ledgerSequenceUsage: boolean;
    }>(`
      SELECT rolsuper,rolbypassrls,rolcanlogin,
        has_schema_privilege(oid,'app','CREATE') AS "appSchemaCreate",
        has_table_privilege(oid,'app.__drizzle_migrations','SELECT')
          AND has_table_privilege(oid,'app.__drizzle_migrations','INSERT') AS "ledgerWrite",
        coalesce(has_sequence_privilege(oid, pg_get_serial_sequence('app.__drizzle_migrations','id'), 'USAGE'),false)
          AS "ledgerSequenceUsage"
      FROM pg_catalog.pg_roles WHERE rolname='sfp_migrator'
    `);
    const roleReady = migrationRole?.rolcanlogin === true && !migrationRole.rolsuper && !migrationRole.rolbypassrls
      && migrationRole.appSchemaCreate && migrationRole.ledgerWrite && migrationRole.ledgerSequenceUsage;
    const { rows: [backupRole] } = await client.query<{ rolcanlogin: boolean; rolbypassrls: boolean; rolsuper: boolean }>(
      "SELECT rolcanlogin,rolbypassrls,rolsuper FROM pg_catalog.pg_roles WHERE rolname='sfp_owner'",
    );
    const delegation = ledger.schema === null ? { status: 'not_run' } : await isolatedCheck(client, async () => {
      await verifyDelegationSchema(client, ledger.schema);
      return { status: 'passed' };
    });
    const migrations = [];
    const issues = [];
    if (ledger.status !== 'passed') issues.push('ledger_validation');
    if (!roleReady) issues.push('migration_role');
    if (delegation.status !== 'passed') issues.push('delegation_schema');
    if (ledger.pending && ledger.schema !== null && migrationRole) {
      const catalog = await readCatalog(client);
      const { pending } = ledger;
      for (const tag of ledger.pending) {
        const check = ledger.legacyFork && /^012[4567]_/.test(tag)
          ? { status: 'limited', reason: 'legacy_fork_requires_its_own_data_checks' }
          : await isolatedCheck(client, () => auditPendingMigration(client, catalog, tag, pending));
        migrations.push({ ...check, tag });
        if (check.status !== 'passed') issues.push(tag);
      }
    }
    return {
      status: issues.length ? 'blocked' : notification.status !== 'passed' ? 'limited' : 'passed',
      identity, enterprise, ledger, notification,
      databaseBytes: Number(space.bytes), migrationRole: migrationRole ?? null, backupRole: backupRole ?? null,
      delegation, migrations, issues,
    };
  } finally {
    await client.query('ROLLBACK');
  }
}

export async function windowsRuntime() {
  const unavailable = { status: 'limited', verifiedForward: false, workerCount: null, listeningPorts: null } as const;
  if (process.platform !== 'win32') return unavailable;
  const script = `
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'
    $all = @(Get-CimInstance Win32_Process)
    $listeners = @(Get-NetTCPConnection -State Listen)
    $forward = @($listeners | Where-Object { $_.LocalPort -eq 5432 -and $_.LocalAddress -eq '127.0.0.1' })
    $owner = if ($forward.Count -eq 1) { $all | Where-Object ProcessId -eq $forward[0].OwningProcess }
    $owned = $owner.Name -eq 'ssh.exe' -and $owner.CommandLine -match '(?i)(^|[ "\\s])-L[ "\\s]+127\\.0\\.0\\.1:5432:127\\.0\\.0\\.1:15432(["\\s]|$)' -and
      $owner.CommandLine -match '(?i)(^|["\\s])Administrator@192\\.168\\.10\\.54(["\\s]|$)'
    $workers = @($all | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match '(?i)(^|[\\\\/"\\s])assistant-worker\\.mjs(["\\s]|$)' })
    $listen = @($listeners | Where-Object { $_.LocalPort -in 3006,3016 } | Select-Object -ExpandProperty LocalPort -Unique | Sort-Object)
    [pscustomobject]@{status='passed';verifiedForward=[bool]$owned;workerCount=$workers.Count;listeningPorts=$listen} | ConvertTo-Json -Compress
  `;
  try {
    const powershell = path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
    const { stdout } = await run(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64')], { timeout: 12000, windowsHide: true });
    return JSON.parse(stdout) as { status: string; verifiedForward: boolean; workerCount: number; listeningPorts: number[] };
  } catch {
    return unavailable;
  }
}

async function workerHealth() {
  const args = [path.join(root, 'scripts/assistant-worker-healthcheck.mjs')];
  try {
    const result = await run(process.execPath, args, { cwd: root, timeout: 5000, windowsHide: true })
      .catch((error: { code: number; stderr: string }) => {
        if (error.code !== 1) throw error;
        return { stdout: error.stderr };
      });
    const { healthy, reason, processStatus, tickStatus, lastSuccessAt } = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)!);
    return { status: healthy ? 'passed' : 'failed', reason, processStatus, tickStatus, lastSuccessAt: lastSuccessAt ?? null };
  } catch {
    return { status: 'limited', reason: 'healthcheck_unavailable' };
  }
}

async function main() {
  const { values } = parseArgs({ options: { 'enterprise-id': { type: 'string' } } });
  if (values['enterprise-id'] !== enterpriseId) return { status: 'blocked', reason: 'explicit_enterprise_1454_required' };
  loadEnvConfig(root, true, { info() {}, error() {} });
  const approved = resolveApprovedTarget(process.env.DATABASE_URL, process.env.NODE_ENV);
  if (!approved) return { status: 'blocked', reason: 'unapproved_connection_target' };
  const runtime = await windowsRuntime();
  if (!runtime.verifiedForward) return { status: 'blocked', reason: 'approved_development_forward_unverified', runtime };
  const [heartbeat, compose, { loadAssistantWorkerConfig }] = await Promise.all([
    workerHealth(), readFile(path.join(root, 'docker-compose.yml'), 'utf8'), import('./assistant-worker-health.mjs'),
  ]);
  const workerService = compose.match(/\n  assistant-worker:\r?\n([\s\S]*?)(?=\n  \S|$)/)?.[1] ?? '';
  const worker = {
    status: runtime.workerCount === 0 ? 'failed' : heartbeat.status,
    windowsObservation: runtime, healthFile: loadAssistantWorkerConfig().healthFile, heartbeat,
    composeAssistantProfile: /profiles:\s*\["assistant"\]/.test(workerService),
  };
  const { target, password } = approved;
  const inputs = loadIntegrationMigrationInputs(drizzle);
  const client = new Client({
    host: target.connectionAddress, port: target.port, database: target.database, user: target.user, password,
    ssl: false, connectionTimeoutMillis: 5000, application_name: 'xiaok-migration-preflight',
    options: '-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=2000',
  });
  try {
    await client.connect();
    return { target, enterpriseId, worker, ...await readMigrationPreflight(client, inputs) };
  } catch (error) {
    return { status: 'blocked', reason: 'read_only_audit_failed', sqlstate: safeSqlState(error), target, enterpriseId, worker };
  } finally {
    await client.end().catch(() => undefined);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(result => {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exitCode = result.status === 'blocked' ? 2 : 0;
  }).catch(() => {
    process.stdout.write(JSON.stringify({ status: 'blocked', reason: 'preflight_execution_error' }) + '\n');
    process.exitCode = 1;
  });
}
