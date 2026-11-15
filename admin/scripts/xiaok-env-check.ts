/** Unified XiaoK development environment check.
 *
 * Usage:
 *   npm run xiaok:env:check
 *   npm run xiaok:env:check -- --output ../tmp/xiaok-env-check.json
 *   npm run xiaok:env:check -- --require isolated-pg17,model,worker
 *
 * The command only reads configuration and database metadata. It never runs a
 * migration, writes business data, calls a model, creates an env file, or
 * touches production. Exit code 0 means no failed item and every required
 * level passed; 2 means failed/gated; 1 means an execution error.
 */
import { execFile } from 'node:child_process';
import { readFile, access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { loadEnvConfig } from '@next/env';
import { Client } from 'pg';
import { readWorkerHeartbeat } from '@/lib/assistant/operations';
import { loadIntegrationMigrationInputs } from './postgres-integration-migrations.mjs';
import {
  buildEnvironmentReport, environmentLevels, redactSecrets, requiredDependencies, unmetRequiredLevels,
  type DatabaseIdentitySnapshot, type EnvironmentCheckReport, type EnvironmentLevel, type KnowledgeTablesSnapshot,
  type MigrationInputsSnapshot, type ProviderSnapshot, type QueueSnapshot, type RlsTableSnapshot,
  type RuntimeSnapshot,
} from './xiaok-env-check-lib';

const root = fileURLToPath(new URL('../', import.meta.url));
const run = promisify(execFile);

type DatabaseProbe = {
  identity: DatabaseIdentitySnapshot | null;
  databaseError?: string;
  rls: RlsTableSnapshot[] | null;
  rlsError?: string;
  ledgerRows: Array<{ id: number; hash: string; created_at: string | number }> | null;
  ledgerError?: string;
  providers: ProviderSnapshot[] | null;
  providerError?: string;
  knowledgeTables: KnowledgeTablesSnapshot | null;
  knowledgeError?: string;
  queue: QueueSnapshot | null;
};

async function exists(file: string) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function readJson(file: string) {
  return JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
}

async function readEnvKeys(file: string): Promise<Set<string> | null> {
  try {
    const text = await readFile(file, 'utf8');
    const keys = new Set<string>();
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
      if (match) keys.add(match[1]);
    }
    return keys;
  } catch {
    return null;
  }
}

async function npmVersion() {
  const match = /npm\/(\d+\.\d+\.\d+)/.exec(process.env.npm_config_user_agent ?? '');
  if (match) return match[1];
  try {
    const { stdout } = await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--version'], {
      timeout: 5000, windowsHide: true,
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function optionalRead<T>(client: Client, read: () => Promise<T>): Promise<T | null> {
  await client.query('savepoint xiaok_env_check');
  try {
    return await read();
  } catch {
    await client.query('rollback to savepoint xiaok_env_check').catch(() => undefined);
    return null;
  } finally {
    await client.query('release savepoint xiaok_env_check').catch(() => undefined);
  }
}

function connectionFailure(error: unknown) {
  const code = (error as { code?: unknown })?.code;
  const message = error instanceof Error ? error.message : String(error);
  return redactSecrets(`${code ? `${String(code)}: ` : ''}${message.split(/\r?\n/)[0].slice(0, 200)}`);
}

async function probeDatabase(databaseUrl: string | undefined): Promise<DatabaseProbe> {
  const empty: DatabaseProbe = {
    identity: null, rls: null, ledgerRows: null, providers: null, knowledgeTables: null, queue: null,
  };
  if (!databaseUrl?.trim()) {
    return { ...empty, databaseError: 'DATABASE_URL 未配置' };
  }
  const client = new Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5000,
    application_name: 'xiaok-env-check',
    options: '-c default_transaction_read_only=on -c statement_timeout=10000 -c lock_timeout=2000',
  });
  try {
    await client.connect();
    await client.query('begin transaction read only');
    // Read-only platform scope lets aggregate queue counts be read without
    // exposing any tenant row. The transaction is always rolled back.
    await client.query("select set_config('app.current_enterprise_id','',true), set_config('app.is_platform_admin','true',true)");
    const { rows: [identity] } = await client.query<DatabaseIdentitySnapshot>(`
      select current_database() as database, current_user as role,
        current_setting('server_version_num')::int as "serverVersionNum",
        pg_is_in_recovery() as replica,
        current_setting('transaction_read_only') = 'on' as "readOnly",
        rolsuper, rolbypassrls,
        inet_server_addr()::text as host, inet_server_port() as port
      from pg_roles where rolname=current_user`);
    const { rows: rls } = await client.query<RlsTableSnapshot>(`
      select c.relname as table, true as exists, c.relrowsecurity as rls, c.relforcerowsecurity as forced,
        (select count(*)::int from pg_policies p where p.schemaname='app' and p.tablename=c.relname) as policies
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='app' and c.relkind='r' and c.relname = any($1::text[])`, [[
      'assistant_conversations', 'assistant_messages', 'assistant_jobs', 'construction_reports',
      'construction_report_versions', 'construction_report_deliveries', 'construction_followup_bindings',
    ]]);
    const ledgerRows = await optionalRead(client, async () => {
      const { rows } = await client.query<{ id: number; hash: string; created_at: string }>(
        'select id,hash,created_at from app.__drizzle_migrations order by id');
      return rows;
    });
    const providers = await optionalRead(client, async () => {
      const { rows } = await client.query<{
        key: string; base_url: string; enabled: boolean; adapter_type: string; has_key: boolean; model_mappings: unknown;
      }>(`select key,base_url,enabled,adapter_type,(api_key_encrypted<>'') as has_key,model_mappings
        from app.ai_provider_configs order by id`);
      return rows.map(row => ({
        key: row.key, baseUrl: row.base_url, enabled: Boolean(row.enabled),
        adapterType: row.adapter_type, hasKey: Boolean(row.has_key), modelMappings: row.model_mappings,
      }));
    });
    const knowledgeTables = await optionalRead(client, async () => {
      const { rows: [row] } = await client.query<KnowledgeTablesSnapshot>(`
        select to_regclass('app.assistant_knowledge_documents') is not null as documents,
          to_regclass('app.assistant_knowledge_chunks') is not null as chunks,
          exists(select 1 from pg_extension where extname='vector') as vector`);
      return row;
    });
    const queueRows = await optionalRead(client, async () => {
      const { rows } = await client.query<{ status: string; count: number; oldest: string | null }>(
        `select status,count(*)::int as count,min(created_at)::text as oldest
          from app.assistant_jobs group by status order by status`);
      return rows;
    });
    const queue: QueueSnapshot | null = queueRows === null ? null : {
      readable: true,
      queued: Number(queueRows.find(row => row.status === 'queued')?.count ?? 0),
      running: Number(queueRows.find(row => row.status === 'running')?.count ?? 0),
      failed: Number(queueRows.find(row => row.status === 'failed')?.count ?? 0),
      oldestQueuedSeconds: (() => {
        const oldest = queueRows.find(row => row.status === 'queued')?.oldest;
        return oldest ? Math.max(0, Math.floor((Date.now() - new Date(oldest).getTime()) / 1000)) : null;
      })(),
    };
    await client.query('rollback');
    return {
      identity,
      rls,
      ledgerRows,
      ...(ledgerRows === null ? { ledgerError: '迁移账本表不可读或不存在' } : {}),
      providers,
      ...(providers === null ? { providerError: 'ai_provider_configs 不可读或不存在' } : {}),
      knowledgeTables,
      ...(knowledgeTables === null ? { knowledgeError: '知识库表不可读或不存在' } : {}),
      queue,
    };
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    return { ...empty, databaseError: connectionFailure(error) };
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function runEnvironmentCheck(options: { now?: Date } = {}): Promise<EnvironmentCheckReport> {
  loadEnvConfig(root, process.env.NODE_ENV !== 'production', { info() {}, error() {} });
  const packageJson = await readJson(path.join(root, 'package.json'));
  const engines = packageJson.engines as { node?: string } | undefined;
  const installed: Record<string, string | null> = {};
  await Promise.all(requiredDependencies.map(async name => {
    try {
      const pkg = await readJson(path.join(root, 'node_modules', name, 'package.json'));
      installed[name] = typeof pkg.version === 'string' ? pkg.version : null;
    } catch {
      installed[name] = null;
    }
  }));
  const runtime: RuntimeSnapshot = {
    nodeVersion: process.version,
    npmVersion: await npmVersion(),
    enginesNode: engines?.node ?? '>=22.13.0',
    projectVersion: typeof packageJson.version === 'string' ? packageJson.version : '',
    nodeModulesPresent: await exists(path.join(root, 'node_modules')),
    lockfilePresent: await exists(path.join(root, 'package-lock.json')),
    installed,
  };
  const envFiles = await Promise.all(['.env.local', '.env.development', '.env', '.env.example', '.env.production']
    .map(async file => ({ file, exists: await exists(path.join(root, file)) })));
  const productionEnvKeys = await readEnvKeys(path.join(root, '.env.production'));
  const probe = await probeDatabase(process.env.DATABASE_URL);
  let migrationInputs: MigrationInputsSnapshot | null = null;
  let migrationInputsError: string | undefined;
  try {
    migrationInputs = loadIntegrationMigrationInputs(path.join(root, 'drizzle')) as MigrationInputsSnapshot;
  } catch (error) {
    migrationInputsError = error instanceof Error ? error.message : String(error);
  }
  return buildEnvironmentReport({
    generatedAt: options.now ?? new Date(),
    runtime,
    env: process.env,
    envFiles,
    productionEnvKeys,
    database: probe.identity,
    databaseError: probe.databaseError,
    rls: probe.rls,
    rlsError: probe.rlsError,
    ledgerRows: probe.ledgerRows,
    ledgerError: probe.ledgerError ?? migrationInputsError,
    migrationInputs,
    providers: probe.providers,
    providerError: probe.providerError,
    knowledgeTables: probe.knowledgeTables,
    knowledgeError: probe.knowledgeError,
    queue: probe.queue,
    heartbeat: await readWorkerHeartbeat(process.env),
  });
}

function usage() {
  return [
    'Usage: npm run xiaok:env:check -- [options]',
    '  --output <file>    Write the JSON report to a file as well as stdout.',
    '  --require <levels> Comma-separated levels that must be passed (exit 2 otherwise).',
    `                     Values: ${environmentLevels.join(',')}`,
    '  --help             Show this message.',
  ].join('\n');
}

async function main() {
  const { values } = parseArgs({
    options: {
      output: { type: 'string' },
      require: { type: 'string' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    process.stdout.write(usage() + '\n');
    return 0;
  }
  const required = (values.require ?? '').split(',').map(level => level.trim()).filter(Boolean);
  const invalid = required.filter(level => !environmentLevels.includes(level as EnvironmentLevel));
  if (invalid.length) throw new Error(`Unknown level(s): ${invalid.join(',')}. ${usage()}`);
  const report = await runEnvironmentCheck();
  const unmet = unmetRequiredLevels(report, required as EnvironmentLevel[]);
  const output = { ...report, gate: required.length ? { required, unmet, passed: unmet.length === 0 } : null };
  const json = JSON.stringify(output, null, 2) + '\n';
  process.stdout.write(json);
  if (values.output) {
    const file = path.resolve(values.output);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, json, 'utf8');
  }
  const failed = required.length ? unmet.length > 0 : report.overall === 'failed';
  return failed ? 2 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => {
    process.exitCode = code;
  }).catch(error => {
    process.stdout.write(JSON.stringify({
      tool: 'xiaok-env-check',
      status: 'error',
      error: redactSecrets(error instanceof Error ? error.message : String(error)),
    }) + '\n');
    process.exitCode = 1;
  });
}
