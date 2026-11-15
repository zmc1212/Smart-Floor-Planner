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
import { createHash } from 'node:crypto';
import { readFile, access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { loadEnvConfig } from '@next/env';
import { Client } from 'pg';
import { readWorkerHeartbeat } from '@/lib/assistant/operations';
import {
  DEFAULT_PLATFORM_LLM_CONFIG, isLlmCredentialEncryptionReady, normalizeLlmBaseUrl, normalizeStoredConfig,
} from '@/lib/platform-llm-config';
import { loadIntegrationMigrationInputs } from './postgres-integration-migrations.mjs';
import {
  buildEnvironmentReport, environmentLevels, redactSecrets, requiredDependencies, unmetRequiredLevels,
  type DatabaseEvidence, type DatabaseIdentitySnapshot, type EnvironmentCheckReport, type EnvironmentLevel,
  type KnowledgeTablesSnapshot, type MigrationInputsSnapshot, type PlatformLlmSnapshot, type ProviderCredentialSnapshot,
  type ProviderSnapshot, type QueueSnapshot, type RlsTableSnapshot, type RuntimeSnapshot,
} from './xiaok-env-check-lib';

const root = fileURLToPath(new URL('../', import.meta.url));
const run = promisify(execFile);

type DatabaseProbe = DatabaseEvidence & {
  providers: ProviderSnapshot[] | null;
  providerError?: string;
  platformLlm: PlatformLlmSnapshot;
  knowledgeTables: KnowledgeTablesSnapshot | null;
  knowledgeError?: string;
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

/** Read one value only for local identification. The caller never prints it. */
async function readEnvValue(file: string, name: string): Promise<string | null> {
  try {
    const text = await readFile(file, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (match && match[1] === name) {
        const value = match[2].trim().replace(/^["']|["']$/g, '');
        return value || null;
      }
    }
    return null;
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

function defaultPlatformLlm(query: 'missing_migration' | 'failed', error?: string): PlatformLlmSnapshot {
  return {
    query, ...(error ? { error } : {}), rowPresent: false, enabled: false,
    providerKey: DEFAULT_PLATFORM_LLM_CONFIG.providerKey,
    baseUrl: DEFAULT_PLATFORM_LLM_CONFIG.baseUrl,
    model: DEFAULT_PLATFORM_LLM_CONFIG.model,
    rawBaseUrlValid: false, rawModelPresent: false, apiKeyField: 'missing',
    hasApiKey: false, apiKeyMasked: false, credentialFingerprint: null,
    lastTestStatus: null, lastTestBaseUrl: null, lastTestModel: null, lastTestAt: null,
    lastTestCredentialFingerprint: null, lastTestApiKeyMasked: null,
  };
}

/** Read platform_configs.llm_config without calling getPlatformLlmOverrideRuntime,
 * which can upsert the managed provider projection. No credential value leaves
 * this function other than a SHA-256 fingerprint used for test matching. */
async function readPlatformLlm(client: Client): Promise<PlatformLlmSnapshot> {
  await client.query('savepoint xiaok_env_platform_llm');
  try {
    const { rows } = await client.query<{ llm_config: unknown }>(
      "select llm_config from app.platform_configs where key='default'");
    const raw = rows[0]?.llm_config ?? null;
    const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const stored = normalizeStoredConfig(raw as Parameters<typeof normalizeStoredConfig>[0]);
    const rawBaseUrl = typeof record.baseUrl === 'string' ? record.baseUrl.trim() : '';
    let rawBaseUrlValid = false;
    if (rawBaseUrl) {
      try { normalizeLlmBaseUrl(rawBaseUrl); rawBaseUrlValid = true; } catch { rawBaseUrlValid = false; }
    }
    const rawKey = record.apiKeyEncrypted;
    const apiKeyField = rawKey === undefined || rawKey === null
      ? 'missing' as const
      : typeof rawKey === 'string' ? (rawKey.trim() ? 'string' as const : 'empty' as const) : 'invalid' as const;
    const hasApiKey = Boolean(stored.apiKeyEncrypted);
    return {
      query: 'ok', rowPresent: rows.length > 0 && raw !== null,
      enabled: stored.enabled, providerKey: stored.providerKey, baseUrl: stored.baseUrl, model: stored.model,
      rawBaseUrlValid,
      rawModelPresent: typeof record.model === 'string' && Boolean(record.model.trim()),
      apiKeyField, hasApiKey, apiKeyMasked: Boolean(stored.apiKeyMasked),
      credentialFingerprint: hasApiKey ? createHash('sha256').update(stored.apiKeyEncrypted).digest('hex') : null,
      lastTestStatus: stored.lastTestStatus, lastTestBaseUrl: stored.lastTestBaseUrl,
      lastTestModel: stored.lastTestModel, lastTestAt: stored.lastTestAt,
      lastTestCredentialFingerprint: stored.lastTestCredentialFingerprint,
      lastTestApiKeyMasked: stored.lastTestApiKeyMasked,
    };
  } catch (error) {
    await client.query('rollback to savepoint xiaok_env_platform_llm').catch(() => undefined);
    const code = (error as { code?: unknown })?.code;
    const message = error instanceof Error ? error.message : String(error);
    const missingMigration = code === '42703'
      || (message.toLowerCase().includes('llm_config') && message.toLowerCase().includes('column'));
    return defaultPlatformLlm(missingMigration ? 'missing_migration' : 'failed',
      redactSecrets(`${code ? `${String(code)}: ` : ''}${message.split(/\r?\n/)[0].slice(0, 200)}`));
  } finally {
    await client.query('release savepoint xiaok_env_platform_llm').catch(() => undefined);
  }
}

async function probeDatabase(
  databaseUrl: string | undefined,
  options: { includeQueue: boolean },
): Promise<DatabaseProbe> {
  const empty: DatabaseProbe = {
    configured: false, identity: null, rls: null, ledgerRows: null, providers: null,
    platformLlm: defaultPlatformLlm('failed'), knowledgeTables: null,
  };
  if (!databaseUrl?.trim()) return empty;
  const client = new Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5000,
    application_name: 'xiaok-env-check',
    options: '-c default_transaction_read_only=on -c statement_timeout=10000 -c lock_timeout=2000',
  });
  try {
    await client.connect();
    await client.query('begin transaction read only');
    // Read-only platform scope is only used for development queue counts. It
    // never exposes tenant rows and the transaction is always rolled back.
    if (options.includeQueue) {
      await client.query("select set_config('app.current_enterprise_id','',true), set_config('app.is_platform_admin','true',true)");
    }
    const { rows: [identity] } = await client.query<DatabaseIdentitySnapshot>(`
      select current_database() as database, current_user as role,
        current_setting('server_version_num')::int as "serverVersionNum",
        pg_is_in_recovery() as replica,
        current_setting('transaction_read_only') = 'on' as "readOnly",
        rolsuper, rolbypassrls,
        inet_server_addr()::text as host, inet_server_port() as port
      from pg_roles where rolname=current_user`);
    const rls = await optionalRead(client, async () => {
      const { rows } = await client.query<RlsTableSnapshot>(`
        select c.relname as table, true as exists, c.relrowsecurity as rls, c.relforcerowsecurity as forced,
          (select count(*)::int from pg_policies p where p.schemaname='app' and p.tablename=c.relname) as policies
        from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='app' and c.relkind='r' and c.relname = any($1::text[])`, [[
        'assistant_conversations', 'assistant_messages', 'assistant_jobs', 'construction_reports',
        'construction_report_versions', 'construction_report_deliveries', 'construction_followup_bindings',
      ]]);
      return rows;
    });
    const ledgerRows = await optionalRead(client, async () => {
      const { rows } = await client.query<{ id: number; hash: string; created_at: string }>(
        'select id,hash,created_at from app.__drizzle_migrations order by id');
      return rows;
    });
    const platformLlm = await readPlatformLlm(client);
    const providers = await optionalRead(client, async () => {
      const { rows } = await client.query<{
        key: string; base_url: string; enabled: boolean; adapter_type: string;
        capabilities: string[] | null; adapter_config: unknown; model_mappings: unknown;
        priority: number; created_at: string | Date | null;
        has_legacy_key: boolean; credentials_key_type: string | null;
        credentials_key_length: number | null; masked: boolean;
      }>(`select key,base_url,enabled,adapter_type,capabilities,adapter_config,model_mappings,
          priority,created_at,
          (api_key_encrypted<>'') as has_legacy_key,
          jsonb_typeof(credentials_encrypted->'apiKey') as credentials_key_type,
          length(credentials_encrypted->>'apiKey') as credentials_key_length,
          (api_key_masked<>'') as masked
        from app.ai_provider_configs order by priority,created_at`);
      return rows.map(row => {
        const credentialsKeyType: ProviderCredentialSnapshot['credentialsKeyType'] =
          row.credentials_key_type === 'string' ? 'string'
            : row.credentials_key_type === 'null' ? 'null'
              : row.credentials_key_type === null ? 'missing' : 'other';
        const credentialsKeyLength = row.credentials_key_length === null ? null : Number(row.credentials_key_length);
        return {
          key: row.key, baseUrl: row.base_url, enabled: Boolean(row.enabled),
          adapterType: row.adapter_type, modelMappings: row.model_mappings,
          capabilities: Array.isArray(row.capabilities) ? row.capabilities : undefined,
          adapterConfig: row.adapter_config, priority: Number(row.priority),
          createdAt: row.created_at ? String(row.created_at) : null,
          hasKey: credentialsKeyType === 'string' ? (credentialsKeyLength ?? 0) > 0 : Boolean(row.has_legacy_key),
          credential: {
            legacyKey: Boolean(row.has_legacy_key), credentialsKeyType, credentialsKeyLength,
            masked: Boolean(row.masked),
          },
        };
      });
    });
    const knowledgeTables = await optionalRead(client, async () => {
      const { rows: [row] } = await client.query<KnowledgeTablesSnapshot>(`
        select to_regclass('app.assistant_knowledge_documents') is not null as documents,
          to_regclass('app.assistant_knowledge_chunks') is not null as chunks,
          exists(select 1 from pg_extension where extname='vector') as vector`);
      return row;
    });
    const queue = options.includeQueue
      ? await optionalRead(client, async () => {
        const { rows } = await client.query<{ status: string; count: number; oldest: string | null }>(
          `select status,count(*)::int as count,min(created_at)::text as oldest
            from app.assistant_jobs group by status order by status`);
        return {
          readable: true,
          queued: Number(rows.find(row => row.status === 'queued')?.count ?? 0),
          running: Number(rows.find(row => row.status === 'running')?.count ?? 0),
          failed: Number(rows.find(row => row.status === 'failed')?.count ?? 0),
          oldestQueuedSeconds: (() => {
            const oldest = rows.find(row => row.status === 'queued')?.oldest;
            return oldest ? Math.max(0, Math.floor((Date.now() - new Date(oldest).getTime()) / 1000)) : null;
          })(),
        } satisfies QueueSnapshot;
      })
      : null;
    await client.query('rollback');
    return {
      configured: true,
      identity,
      rls,
      ...(rls === null ? { rlsError: 'RLS 元数据不可读' } : {}),
      ledgerRows,
      ...(ledgerRows === null ? { ledgerError: '迁移账本表不可读或不存在' } : {}),
      providers,
      ...(providers === null ? { providerError: 'ai_provider_configs 不可读或不存在' } : {}),
      platformLlm,
      knowledgeTables,
      ...(knowledgeTables === null ? { knowledgeError: '知识库表不可读或不存在' } : {}),
      ...(options.includeQueue ? { queue } : {}),
    };
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    return { ...empty, configured: true, error: connectionFailure(error) };
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
  const productionDatabaseUrl = await readEnvValue(path.join(root, '.env.production'), 'DATABASE_URL');
  const development = await probeDatabase(process.env.DATABASE_URL, { includeQueue: true });
  const isolated = await probeDatabase(process.env.XIAOK_ISOLATED_DATABASE_URL, { includeQueue: false });
  let migrationInputs: MigrationInputsSnapshot | null = null;
  let migrationInputsError: string | undefined;
  try {
    migrationInputs = loadIntegrationMigrationInputs(path.join(root, 'drizzle')) as MigrationInputsSnapshot;
  } catch (error) {
    migrationInputsError = error instanceof Error ? error.message : String(error);
  }
  const withMigrationError = (probe: DatabaseProbe): DatabaseProbe => ({
    ...probe, ...(probe.ledgerError || !migrationInputsError ? {} : { ledgerError: migrationInputsError }),
  });
  return buildEnvironmentReport({
    generatedAt: options.now ?? new Date(),
    runtime,
    env: process.env,
    envFiles,
    productionEnvKeys,
    productionDatabaseUrl,
    developmentDatabase: withMigrationError(development),
    isolatedDatabase: withMigrationError(isolated),
    migrationInputs,
    providers: development.providers,
    providerError: development.providerError,
    platformLlm: development.platformLlm,
    credentialReady: isLlmCredentialEncryptionReady(),
    knowledgeTables: development.knowledgeTables,
    knowledgeError: development.knowledgeError,
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
