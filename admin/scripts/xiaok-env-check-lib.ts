/** Pure evaluation core for the unified XiaoK development environment check.
 *
 * The CLI (`scripts/xiaok-env-check.ts`) collects real runtime/database facts and
 * passes them here. Nothing in this module reads environment variables, opens a
 * connection or calls a model, so failures are attributed to the observed
 * environment rather than to a mocked pass.
 */
import type { MigrationMeta } from 'drizzle-orm/migrator';
import { retrievalConfiguration, type WorkerHeartbeat } from '@/lib/assistant/operations';
import { BAILIAN_KNOWLEDGE_MODEL } from '@/lib/assistant/knowledge/bailian-provider';
import { specialistModel } from '@/lib/assistant/specialists/registry';
import { pendingMigrations, validateLedger } from './postgres-integration-migrations.mjs';

export type EnvironmentLevel = 'development' | 'isolated-pg17' | 'model' | 'knowledge' | 'worker' | 'production';
export type EnvironmentCheckStatus = 'passed' | 'failed' | 'limited' | 'not_run';

export const environmentLevels: readonly EnvironmentLevel[] = [
  'development', 'isolated-pg17', 'model', 'knowledge', 'worker', 'production',
] as const;

export type EnvironmentCheckItem = {
  id: string;
  level: EnvironmentLevel;
  label: string;
  status: EnvironmentCheckStatus;
  actual: string;
  reason?: string;
  fix: string;
  verify: string;
};

export type EnvironmentLevelSummary = {
  level: EnvironmentLevel;
  status: EnvironmentCheckStatus;
  counts: Record<EnvironmentCheckStatus, number>;
  items: string[];
};

export type EnvironmentCheckReport = {
  tool: 'xiaok-env-check';
  version: 1;
  generatedAt: string;
  overall: EnvironmentCheckStatus;
  redacted: true;
  levels: EnvironmentLevelSummary[];
  summary: Record<EnvironmentCheckStatus, number> & { total: number };
  items: EnvironmentCheckItem[];
  runtime: {
    node: string;
    npm: string | null;
    platform: string;
    cwd: string;
    projectVersion: string;
  };
  envFiles: Array<{ file: string; exists: boolean }>;
  variables: Record<string, 'set' | 'missing'>;
};

const statuses: readonly EnvironmentCheckStatus[] = ['passed', 'failed', 'limited', 'not_run'];

/** Mask values that could carry credentials in error text or diagnostics. */
export function redactSecrets(value: string): string {
  return String(value)
    .replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, 'postgresql://[redacted]')
    .replace(/\b(bearer)\s+[a-z0-9._~+/=-]+/gi, '$1 [redacted]')
    .replace(/\bsk-[a-z0-9_-]{6,}/gi, 'sk-[redacted]')
    .replace(/((?:api[_-]?key|secret|password|token|authorization)\s*[=:]\s*)[^\s,;]+/gi, '$1[redacted]');
}

function item(
  id: string, level: EnvironmentLevel, label: string, status: EnvironmentCheckStatus,
  actual: string, fix: string, verify: string, reason?: string,
): EnvironmentCheckItem {
  return { id, level, label, status, actual, ...(reason ? { reason: redactSecrets(reason) } : {}), fix, verify };
}

const verifyCommand = 'cd admin; npm run xiaok:env:check';

// ---------------------------------------------------------------- runtime

export const requiredDependencies = [
  'next', 'react', 'react-dom', 'drizzle-orm', 'pg', 'tsx', 'typescript',
] as const;

export type RuntimeSnapshot = {
  nodeVersion: string;
  npmVersion: string | null;
  enginesNode: string;
  projectVersion: string;
  nodeModulesPresent: boolean;
  lockfilePresent: boolean;
  installed: Record<string, string | null>;
};

export function parseVersion(value: string): [number, number, number] | null {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(String(value).trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function versionAtLeast(actual: string, minimum: string): boolean {
  const left = parseVersion(actual);
  const right = parseVersion(minimum);
  if (!left || !right) return false;
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return true;
}

export function evaluateRuntime(snapshot: RuntimeSnapshot): EnvironmentCheckItem[] {
  const minimum = parseVersion(snapshot.enginesNode);
  const minimumLabel = minimum ? minimum.join('.') : 'unknown';
  const nodeOk = minimum ? versionAtLeast(snapshot.nodeVersion, snapshot.enginesNode) : false;
  const missing = requiredDependencies.filter(name => !snapshot.installed[name]);
  const installedCount = requiredDependencies.length - missing.length;
  const dependenciesOk = snapshot.nodeModulesPresent && missing.length === 0;
  const projectOk = Boolean(snapshot.projectVersion) && snapshot.lockfilePresent;
  return [
    item('development.node', 'development', 'Node.js 版本', nodeOk ? 'passed' : 'failed',
      `${snapshot.nodeVersion} (engines >=${minimumLabel})`,
      '安装项目要求的 Node.js（engines >=22.13.0），再重新安装依赖。',
      'node --version; cd admin; npm run xiaok:env:check',
      nodeOk ? undefined : `当前 Node.js 版本低于项目要求或无法解析。`),
    item('development.npm', 'development', 'npm 可用性', snapshot.npmVersion ? 'passed' : 'failed',
      snapshot.npmVersion ? `npm ${snapshot.npmVersion}` : 'unavailable',
      '随 Node.js 安装 npm，并在 admin 目录执行 npm ci。',
      'npm --version; cd admin; npm run xiaok:env:check',
      snapshot.npmVersion ? undefined : '无法读取 npm 版本，脚本或依赖安装命令可能不可用。'),
    item('development.dependencies', 'development', '依赖安装', dependenciesOk ? 'passed' : 'failed',
      `node_modules=${snapshot.nodeModulesPresent ? 'present' : 'missing'},installed=${installedCount}/${requiredDependencies.length}`,
      'cd admin; npm ci',
      verifyCommand,
      !snapshot.nodeModulesPresent ? 'admin/node_modules 不存在。'
        : missing.length ? `缺少依赖：${missing.join(',')}。` : undefined),
    item('development.project', 'development', '项目版本与锁文件', projectOk ? 'passed' : 'limited',
      `version=${snapshot.projectVersion || 'missing'},lockfile=${snapshot.lockfilePresent ? 'present' : 'missing'}`,
      '保留并提交 admin/package-lock.json；使用 npm ci 安装。',
      verifyCommand,
      projectOk ? undefined : '项目版本或 package-lock.json 缺失，安装结果不可重复。'),
  ];
}

// ---------------------------------------------------------------- environment files

export const requiredEnvironmentVariables = ['DATABASE_URL', 'JWT_SECRET', 'CRON_SECRET'] as const;
export const optionalEnvironmentVariables = ['INTERNAL_SECRET', 'MEDIA_STORAGE_KEY_ENCRYPTION_SECRET'] as const;

export type EnvironmentFileSnapshot = { file: string; exists: boolean };

export function evaluateEnvironmentFiles(input: {
  files: EnvironmentFileSnapshot[];
  env: Record<string, string | undefined>;
}): EnvironmentCheckItem[] {
  const exists = (file: string) => input.files.some(entry => entry.file === file && entry.exists);
  const localFile = exists('.env.local') || exists('.env.development');
  const fallbackFile = exists('.env');
  const missingRequired = requiredEnvironmentVariables.filter(name => !input.env[name]?.trim());
  const missingOptional = optionalEnvironmentVariables.filter(name => !input.env[name]?.trim());
  return [
    item('development.env_file', 'development', '开发环境文件', localFile ? 'passed' : fallbackFile ? 'limited' : 'failed',
      localFile ? '.env.local/.env.development present' : fallbackFile ? 'only .env present' : 'no local env file',
      '复制 admin/.env.example 到 admin/.env.local 并填写本机值；不要覆盖已有文件。',
      verifyCommand,
      localFile ? undefined : fallbackFile ? '只找到通用 .env，缺少本机覆盖文件。' : '缺少 admin/.env.local。'),
    item('development.env_required', 'development', '必要环境变量', missingRequired.length ? 'failed' : 'passed',
      `required=${requiredEnvironmentVariables.length},missing=${missingRequired.join(',') || 'none'}`,
      '在 admin/.env.local 中补充缺失变量（参照 .env.example；不要覆盖现有文件）。',
      verifyCommand,
      missingRequired.length ? `缺少必要环境变量：${missingRequired.join(',')}。` : undefined),
    item('development.env_optional', 'development', '可选环境变量', missingOptional.length ? 'limited' : 'passed',
      `optional=${optionalEnvironmentVariables.length},missing=${missingOptional.join(',') || 'none'}`,
      '按需在 admin/.env.local 中补充；缺失只会关闭对应能力。',
      verifyCommand,
      missingOptional.length ? `未配置可选项：${missingOptional.join(',')}。` : undefined),
  ];
}

// ---------------------------------------------------------------- database identity

export type DatabaseIdentitySnapshot = {
  database: string;
  role: string;
  serverVersionNum: number;
  rolsuper: boolean;
  rolbypassrls: boolean;
  readOnly: boolean;
  replica: boolean;
  host: string | null;
  port: number | null;
};

const versionLabel = (value: number) => `PostgreSQL ${Math.floor(value / 10000)}.x (${value})`;

export function evaluateDatabaseIdentity(
  identity: DatabaseIdentitySnapshot | null, error?: string,
): EnvironmentCheckItem[] {
  if (!identity) {
    return [
      item('isolated-pg17.connection', 'isolated-pg17', 'PG17 连接', 'failed', 'connection_failed',
        '确认 PostgreSQL 17 已启动，且 admin/.env.local 的 DATABASE_URL 指向可访问的开发库；不要改为生产库。',
        'cd admin; npm run db:check', error ? `连接失败：${error}` : '未连接数据库。'),
      item('isolated-pg17.version', 'isolated-pg17', 'PostgreSQL 版本', 'not_run', 'not_run', '先恢复数据库连接。', verifyCommand),
      item('isolated-pg17.account', 'isolated-pg17', '数据库身份', 'not_run', 'not_run', '先恢复数据库连接。', verifyCommand),
      item('isolated-pg17.read_only', 'isolated-pg17', '只读检查事务', 'not_run', 'not_run', '先恢复数据库连接。', verifyCommand),
    ];
  }
  const versionOk = identity.serverVersionNum >= 170000 && identity.serverVersionNum < 180000;
  const accountOk = !identity.rolsuper && !identity.rolbypassrls;
  return [
    item('isolated-pg17.connection', 'isolated-pg17', 'PG17 连接', 'passed', 'connected',
      '无需处理。', 'cd admin; npm run db:check'),
    item('isolated-pg17.version', 'isolated-pg17', 'PostgreSQL 版本', versionOk ? 'passed' : 'failed',
      versionLabel(identity.serverVersionNum),
      '连接项目要求的 PostgreSQL 17；不要自动重建或删除数据库。',
      'select version(); cd admin; npm run xiaok:env:check',
      versionOk ? undefined : '数据库不是 PostgreSQL 17.x。'),
    item('isolated-pg17.account', 'isolated-pg17', '数据库身份', accountOk ? 'passed' : 'failed',
      `role=${identity.role},database=${identity.database},superuser=${identity.rolsuper},bypassRls=${identity.rolbypassrls}`,
      '使用非超级用户业务账号（如 sfp_app），保持 FORCE ROW LEVEL SECURITY；不要关闭 RLS。',
      verifyCommand,
      accountOk ? undefined : '业务连接使用了超级用户或可绕过 RLS 的角色。'),
    item('isolated-pg17.read_only', 'isolated-pg17', '只读检查事务', identity.readOnly ? 'passed' : 'failed',
      `readOnly=${identity.readOnly},replica=${identity.replica}`,
      '环境检查必须使用只读事务；不要用可写连接执行诊断。',
      verifyCommand,
      identity.readOnly ? undefined : '当前连接不是只读事务。'),
  ];
}

// ---------------------------------------------------------------- RLS

export const requiredRlsTables = [
  'assistant_conversations',
  'assistant_messages',
  'assistant_jobs',
  'construction_reports',
  'construction_report_versions',
  'construction_report_deliveries',
  'construction_followup_bindings',
] as const;

export type RlsTableSnapshot = { table: string; exists: boolean; rls: boolean; forced: boolean; policies: number };

export function evaluateRowLevelSecurity(
  tables: RlsTableSnapshot[] | null, error?: string,
): EnvironmentCheckItem[] {
  if (!tables) {
    return [
      item('isolated-pg17.rls', 'isolated-pg17', '强制租户 RLS', 'not_run', 'not_run',
        '先恢复数据库连接。', verifyCommand, error ? `未执行 RLS 检查：${error}` : undefined),
    ];
  }
  const invalid = requiredRlsTables.map(table => {
    const row = tables.find(candidate => candidate.table === table);
    return {
      table,
      exists: Boolean(row?.exists), rls: Boolean(row?.rls), forced: Boolean(row?.forced), policies: Number(row?.policies ?? 0),
    };
  }).filter(row => !row.exists || !row.rls || !row.forced || row.policies === 0);
  return [
    item('isolated-pg17.rls', 'isolated-pg17', '强制租户 RLS', invalid.length ? 'failed' : 'passed',
      `tables=${requiredRlsTables.length},invalid=${invalid.length}`,
      '应用已授权迁移，并确认 ENABLE/FORCE ROW LEVEL SECURITY 与租户策略；不要关闭 RLS。',
      verifyCommand,
      invalid.length ? invalid.map(row =>
        `${row.table}(exists=${row.exists},rls=${row.rls},forced=${row.forced},policies=${row.policies})`).join(',') : undefined),
  ];
}

// ---------------------------------------------------------------- migrations

export type LedgerRowSnapshot = { id: number; hash: string; created_at: string | number };
export type JournalEntrySnapshot = { when: number; tag: string; hashes: Set<string> };
export type MigrationInputsSnapshot = {
  active: JournalEntrySnapshot[];
  migrations: MigrationMeta[];
  forks: Record<string, JournalEntrySnapshot[]>;
  knownHashes: Array<{ when: number; tag: string; hash: string; ledgerId: number }>;
};

export function evaluateMigrationLedger(
  rows: LedgerRowSnapshot[] | null,
  inputs: MigrationInputsSnapshot | null,
  error?: string,
): EnvironmentCheckItem[] {
  if (!rows || !inputs) {
    return [
      item('isolated-pg17.migrations', 'isolated-pg17', '迁移账本', 'failed', 'ledger_unreadable',
        '确认开发库已初始化并应用基础迁移；本命令不会自动执行迁移，也不会重建数据库。',
        'cd admin; npm run check:migration-preflight -- --enterprise-id <id>',
        error ? `迁移账本不可读：${error}` : '缺少迁移日志或账本。'),
    ];
  }
  const tagByTime = new Map(inputs.active.map(entry => [entry.when, entry.tag]));
  try {
    const { seen, schema, supersedesOriginal } = validateLedger(rows, inputs.active, inputs.forks, inputs.knownHashes);
    const pending = pendingMigrations(inputs.migrations, seen, supersedesOriginal)
      .map((migration: MigrationMeta) => tagByTime.get(migration.folderMillis) ?? String(migration.folderMillis));
    return [
      item('isolated-pg17.migrations', 'isolated-pg17', '迁移账本', pending.length ? 'failed' : 'passed',
        `ledger=${rows.length},schema=${schema},pending=${pending.length}`,
        '先做只读预检并备份，再按部署流程执行已授权迁移；本命令不会自动迁移、不会删除数据库。',
        'cd admin; npm run check:migration-preflight -- --enterprise-id <id>; npm run xiaok:env:check',
        pending.length ? `待执行迁移：${pending.join(',')}。` : undefined),
    ];
  } catch (ledgerError) {
    return [
      item('isolated-pg17.migrations', 'isolated-pg17', '迁移账本', 'failed', `ledger=${rows.length},validation=failed`,
        '核对迁移文件与数据库账本；先备份再按部署流程处理，不要手工改写账本。',
        'cd admin; npm run check:migration-preflight -- --enterprise-id <id>',
        ledgerError instanceof Error ? ledgerError.message : String(ledgerError)),
    ];
  }
}

// ---------------------------------------------------------------- model

export type ProviderSnapshot = {
  key: string;
  baseUrl: string;
  enabled: boolean;
  adapterType: string;
  hasKey: boolean;
  modelMappings: unknown;
};

function officialBailianOrigin(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    return url.protocol === 'https:'
      && ['dashscope.aliyuncs.com', 'dashscope-intl.aliyuncs.com'].includes(url.hostname)
      && /^\/compatible-mode(?:\/v1)?\/?$/.test(url.pathname)
      && !url.username && !url.password && !url.search && !url.hash
      && (!url.port || url.port === '443');
  } catch {
    return false;
  }
}

function collectModelNames(value: unknown, output: string[] = []): string[] {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) output.push(trimmed);
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach(entry => collectModelNames(entry, output));
    return output;
  }
  if (value && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach(entry => collectModelNames(entry, output));
  }
  return output;
}

export function evaluateModelConfiguration(
  providers: ProviderSnapshot[] | null, error?: string,
): EnvironmentCheckItem[] {
  const live = item('model.live_probe', 'model', '真实模型调用', 'not_run', 'not_run',
    '如需真实模型验收，由模型验收脚本在明确授权后单独执行。',
    'cd admin; npm run xiaok:env:check',
    '为避免产生模型调用费用，本命令不发起真实推理。');
  if (!providers) {
    return [
      item('model.provider', 'model', '百炼供应商', 'not_run', 'not_run',
        '先恢复数据库连接，再读取 ai_provider_configs。', verifyCommand,
        error ? `供应商配置不可读：${error}` : undefined),
      item('model.deepseek', 'model', 'deepseek-flash 配置', 'not_run', 'not_run',
        '先恢复数据库连接。', verifyCommand),
      live,
    ];
  }
  const bailian = providers.filter(provider => officialBailianOrigin(provider.baseUrl));
  const enabled = bailian.filter(provider => provider.enabled && provider.hasKey);
  const models = [...new Set(enabled.flatMap(provider => collectModelNames(provider.modelMappings)))];
  const deepseek = models.find(model => /deepseek/i.test(model)) ?? null;
  return [
    item('model.provider', 'model', '百炼供应商', enabled.length ? 'passed' : 'failed',
      `bailianProviders=${bailian.length},enabledWithKey=${enabled.length}`,
      '在平台 AI 供应商配置中启用官方百炼（dashscope）兼容模式并保存 API Key；不要更换模型供应商。',
      verifyCommand,
      enabled.length ? undefined : bailian.length
        ? '百炼供应商存在，但未启用或未保存 API Key。'
        : '未找到官方百炼兼容模式供应商。'),
    item('model.deepseek', 'model', 'deepseek-flash 配置', deepseek ? 'passed' : 'failed',
      `configuredModels=${models.slice(0, 10).join(',') || 'none'}`,
      `在百炼供应商模型映射或企业 Agent 配置中配置 ${specialistModel.model}；保持百炼供应商不变。`,
      verifyCommand,
      deepseek ? undefined : `未找到 deepseek-flash 模型映射或企业绑定（期望 ${specialistModel.model}）。`),
    live,
  ];
}

// ---------------------------------------------------------------- embedding + knowledge

const bailianModels = [BAILIAN_KNOWLEDGE_MODEL, 'qwen3.7-text-embedding'];
const workspacePattern = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function knowledgeMode(env: Record<string, string | undefined>): 'bailian' | 'local' | 'invalid' {
  const mode = env.ASSISTANT_KNOWLEDGE_PROVIDER?.trim() || 'bailian';
  return mode === 'bailian' || mode === 'local' ? mode : 'invalid';
}

export function evaluateEmbeddingConfiguration(env: Record<string, string | undefined>): EnvironmentCheckItem[] {
  const mode = knowledgeMode(env);
  if (mode === 'invalid') {
    return [
      item('knowledge.embedding', 'knowledge', 'Embedding 配置', 'failed',
        `mode=${env.ASSISTANT_KNOWLEDGE_PROVIDER}`, 'ASSISTANT_KNOWLEDGE_PROVIDER 只能是 bailian 或 local；不要擅自更换供应商。',
        verifyCommand, '知识库供应商模式无效。'),
    ];
  }
  if (mode === 'bailian') {
    const ready = Boolean(env.ASSISTANT_BAILIAN_RAG_WORKSPACE_ID?.trim()) && Boolean(env.ASSISTANT_BAILIAN_RAG_API_KEY?.trim());
    return [
      item('knowledge.embedding', 'knowledge', 'Embedding 配置', ready ? 'passed' : 'not_run',
        `mode=bailian,managedModel=${BAILIAN_KNOWLEDGE_MODEL}`,
        '配置已批准的百炼知识库工作区与 API Key；不要覆盖现有 .env。',
        verifyCommand,
        ready ? undefined : '知识库工作区或 API Key 缺失，无法确认托管 Embedding。'),
    ];
  }
  const retrieval = retrievalConfiguration(env);
  const reason = retrieval.reason === 'missing_url' ? 'ASSISTANT_EMBEDDING_URL 未配置。'
    : retrieval.reason === 'missing_api_key' ? 'ASSISTANT_EMBEDDING_API_KEY 未配置。'
    : retrieval.reason === 'invalid_url' ? 'ASSISTANT_EMBEDDING_URL 无效（仅允许 HTTPS，或本机 HTTP）。' : undefined;
  return [
    item('knowledge.embedding', 'knowledge', 'Embedding 配置', retrieval.configured ? 'passed' : 'failed',
      `mode=local,profile=${retrieval.profile},configured=${retrieval.configured}`,
      '在 admin/.env.local 配置 ASSISTANT_EMBEDDING_URL 与 ASSISTANT_EMBEDDING_API_KEY；不要覆盖现有文件。',
      verifyCommand,
      retrieval.configured ? undefined : reason),
  ];
}

export type KnowledgeTablesSnapshot = { documents: boolean; chunks: boolean; vector: boolean };

export function evaluateKnowledgeConfiguration(input: {
  env: Record<string, string | undefined>;
  tables: KnowledgeTablesSnapshot | null;
  error?: string;
}): EnvironmentCheckItem[] {
  const mode = knowledgeMode(input.env);
  const live = item('knowledge.live_probe', 'knowledge', '真实知识检索', 'not_run', 'not_run',
    '如需真实检索验收，由知识库验收脚本在明确授权后单独执行。',
    verifyCommand,
    '为避免 Embedding/知识库调用费用，本命令不执行真实检索。');
  if (mode === 'invalid') {
    return [
      item('knowledge.provider', 'knowledge', '知识库供应商', 'failed', `mode=${input.env.ASSISTANT_KNOWLEDGE_PROVIDER}`,
        'ASSISTANT_KNOWLEDGE_PROVIDER 只能是 bailian 或 local。', verifyCommand, '知识库供应商模式无效。'),
      live,
    ];
  }
  const provider = item('knowledge.provider', 'knowledge', '知识库供应商', 'passed', `mode=${mode}`, '无需处理。', verifyCommand);
  if (mode === 'bailian') {
    const workspace = input.env.ASSISTANT_BAILIAN_RAG_WORKSPACE_ID?.trim() ?? '';
    const apiKey = input.env.ASSISTANT_BAILIAN_RAG_API_KEY?.trim() ?? '';
    const category = input.env.ASSISTANT_BAILIAN_RAG_CATEGORY_ID?.trim() || 'default';
    const model = input.env.ASSISTANT_BAILIAN_RAG_EMBEDDING_MODEL?.trim() || BAILIAN_KNOWLEDGE_MODEL;
    const missing = [
      ...(!workspace ? ['ASSISTANT_BAILIAN_RAG_WORKSPACE_ID'] : []),
      ...(!apiKey ? ['ASSISTANT_BAILIAN_RAG_API_KEY'] : []),
    ];
    const invalid = workspace && !workspacePattern.test(workspace) ? `workspace 格式无效（${workspace}）`
      : !bailianModels.includes(model) ? `Embedding 模型不受支持（${model}）`
      : !/^[a-zA-Z0-9_.:-]{1,240}$/.test(category) ? `category 格式无效（${category}）` : null;
    const configOk = missing.length === 0 && !invalid;
    const tablesOk = Boolean(input.tables?.documents && input.tables.chunks);
    return [
      provider,
      item('knowledge.config', 'knowledge', '百炼知识库配置', configOk ? 'passed' : 'failed',
        `mode=bailian,workspace=${workspace ? 'set' : 'missing'},category=${category},model=${model}`,
        '在 admin/.env.local 配置已批准的百炼工作区与 API Key；不要覆盖现有文件，也不要擅自切换供应商。',
        verifyCommand,
        configOk ? undefined : invalid ?? `缺少：${missing.join(',')}。`),
      item('knowledge.tables', 'knowledge', '知识库表结构', !input.tables ? 'not_run' : tablesOk ? 'passed' : 'failed',
        !input.tables ? 'not_run' : `documents=${input.tables.documents},chunks=${input.tables.chunks},vector=${input.tables.vector}`,
        '应用已授权迁移；本命令不会自动重建数据库。',
        verifyCommand,
        !input.tables ? (input.error ? `未执行检查：${input.error}` : '数据库不可用。') : tablesOk ? undefined : '知识库文档或切片表缺失。'),
      live,
    ];
  }
  const retrieval = retrievalConfiguration(input.env);
  const tablesOk = Boolean(input.tables?.documents && input.tables.chunks && input.tables.vector);
  return [
    provider,
    item('knowledge.config', 'knowledge', '本地知识库配置', retrieval.configured ? 'passed' : 'failed',
      `mode=local,embedding=${retrieval.configured}`,
      '在 admin/.env.local 配置本地 Embedding 网关；不要覆盖现有文件。',
      verifyCommand,
      retrieval.configured ? undefined : '本地 Embedding 未配置完整。'),
    item('knowledge.tables', 'knowledge', '知识库表结构', !input.tables ? 'not_run' : tablesOk ? 'passed' : 'failed',
      !input.tables ? 'not_run' : `documents=${input.tables.documents},chunks=${input.tables.chunks},vector=${input.tables.vector}`,
      '应用已授权迁移并确认 pgvector；本命令不会自动重建数据库。',
      verifyCommand,
      !input.tables ? (input.error ? `未执行检查：${input.error}` : '数据库不可用。') : tablesOk ? undefined : '知识库表或 pgvector 扩展缺失。'),
    live,
  ];
}

// ---------------------------------------------------------------- worker

export type QueueSnapshot = {
  readable: boolean;
  queued: number;
  running: number;
  failed: number;
  oldestQueuedSeconds: number | null;
  error?: string;
};

export function evaluateWorkerConfiguration(input: {
  env: Record<string, string | undefined>;
  heartbeat: WorkerHeartbeat;
  queue: QueueSnapshot | null;
}): EnvironmentCheckItem[] {
  const secret = Boolean(input.env.CRON_SECRET?.trim());
  const endpoint = input.env.ASSISTANT_WORKER_ENDPOINT?.trim();
  const heartbeat = input.heartbeat.freshness;
  const heartbeatReason = heartbeat === 'stale' ? `最近成功心跳已过期（${input.heartbeat.ageSeconds} 秒前）。`
    : heartbeat === 'unknown' ? '未找到可读的 Worker 健康文件或最近成功心跳。' : undefined;
  const queue = input.queue;
  const queueFailed = queue && queue.readable
    && (queue.queued > 50 || (queue.oldestQueuedSeconds ?? 0) > 3600);
  const queueLimited = queue && queue.readable
    && (queueFailed || queue.queued > 10 || (queue.oldestQueuedSeconds ?? 0) > 300 || queue.failed > 0);
  return [
    item('worker.auth', 'worker', 'Worker 鉴权', secret ? 'passed' : 'failed',
      `CRON_SECRET=${secret ? 'set' : 'missing'}`,
      '在 admin/.env.local 配置 CRON_SECRET（不要覆盖现有文件），并确保 Worker 与 API 使用同一值。',
      verifyCommand,
      secret ? undefined : '缺少 CRON_SECRET，Worker 请求无法鉴权。'),
    item('worker.endpoint', 'worker', 'Worker 端点', 'passed',
      endpoint ? 'configured' : 'default',
      '无需处理；如需远程 Worker，在 .env.local 设置 ASSISTANT_WORKER_ENDPOINT。',
      verifyCommand),
    item('worker.heartbeat', 'worker', 'Worker 心跳', heartbeat === 'fresh' ? 'passed' : 'failed',
      `freshness=${heartbeat},ageSeconds=${input.heartbeat.ageSeconds},liveProbe=false`,
      'cd admin; npm run worker:assistant',
      'cd admin; node scripts/assistant-worker-healthcheck.mjs',
      heartbeatReason),
    item('worker.queue', 'worker', '任务队列', !queue ? 'not_run' : !queue.readable ? 'not_run' : queueFailed ? 'failed' : queueLimited ? 'limited' : 'passed',
      !queue ? 'not_run' : `queued=${queue.queued},running=${queue.running},failed=${queue.failed},oldestQueuedSeconds=${queue.oldestQueuedSeconds ?? 'none'}`,
      '启动 Worker 并观察队列消化；不要通过删除任务制造通过。',
      verifyCommand,
      !queue ? '数据库不可用或任务表不可读。'
        : !queue.readable ? queue.error ?? '任务表不可读。'
        : queueFailed ? '队列积压超过 1 小时或 50 条，Worker 可能未运行。'
        : queueLimited ? '存在排队/失败任务，需要观察 Worker 消化。' : undefined),
  ];
}

// ---------------------------------------------------------------- production

export const requiredProductionVariables = [
  'DATABASE_URL', 'DATABASE_MIGRATION_URL', 'JWT_SECRET', 'INTERNAL_SECRET', 'CRON_SECRET', 'WX_APPID', 'WX_APPSECRET',
] as const;

export function evaluateProductionBoundary(input: {
  identity: DatabaseIdentitySnapshot | null;
  productionEnvKeys: Set<string> | null;
}): EnvironmentCheckItem[] {
  const readOnly = Boolean(input.identity?.readOnly);
  const missing = input.productionEnvKeys
    ? requiredProductionVariables.filter(name => !input.productionEnvKeys!.has(name))
    : null;
  return [
    item('production.read_only', 'production', '生产数据只读边界', !input.identity ? 'not_run' : readOnly ? 'passed' : 'failed',
      !input.identity ? 'not_run' : `readOnly=${input.identity.readOnly},writes=0`,
      '环境检查只允许 SELECT；不要在生产库执行诊断性写入。',
      verifyCommand,
      !input.identity ? '数据库不可用，未验证只读边界。' : readOnly ? undefined : '当前事务不是只读。'),
    item('production.env_file', 'production', '生产环境变量清单', missing === null ? 'not_run' : missing.length ? 'failed' : 'passed',
      missing === null ? 'no .env.production' : `keys=${input.productionEnvKeys!.size},missing=${missing.join(',') || 'none'}`,
      '由部署负责人在部署环境中补齐生产变量；本命令不会创建或覆盖 .env。',
      '部署前复验（由发布流程执行）',
      missing === null ? '未发现 admin/.env.production，生产配置检查未执行。'
        : missing.length ? `缺少生产变量：${missing.join(',')}。` : undefined),
    item('production.deployment', 'production', '生产部署与 Worker', 'not_run', 'not_run',
      '按发布流程单独执行；本命令不部署生产、不启动或修改生产 Worker、不发送通知。',
      '发布流程',
      'I7.5.2 明确不部署生产。'),
  ];
}

// ---------------------------------------------------------------- summary

function statusFor(items: EnvironmentCheckItem[]): EnvironmentCheckStatus {
  if (items.some(entry => entry.status === 'failed')) return 'failed';
  if (items.some(entry => entry.status === 'limited')) return 'limited';
  if (items.some(entry => entry.status === 'passed')) return 'passed';
  return 'not_run';
}

export function summarizeEnvironment(items: EnvironmentCheckItem[]): {
  overall: EnvironmentCheckStatus;
  levels: EnvironmentLevelSummary[];
  summary: Record<EnvironmentCheckStatus, number> & { total: number };
} {
  const summary = Object.fromEntries(statuses.map(status => [status, 0])) as Record<EnvironmentCheckStatus, number> & { total: number };
  summary.total = items.length;
  for (const entry of items) summary[entry.status] += 1;
  const levels = environmentLevels.map(level => {
    const levelItems = items.filter(entry => entry.level === level);
    const counts = Object.fromEntries(statuses.map(status => [status, 0])) as Record<EnvironmentCheckStatus, number>;
    for (const entry of levelItems) counts[entry.status] += 1;
    return { level, status: statusFor(levelItems), counts, items: levelItems.map(entry => entry.id) };
  });
  return { overall: statusFor(items), levels, summary };
}

// ---------------------------------------------------------------- report

export type EnvironmentReportInput = {
  generatedAt: Date;
  runtime: RuntimeSnapshot;
  env: Record<string, string | undefined>;
  envFiles: EnvironmentFileSnapshot[];
  productionEnvKeys: Set<string> | null;
  database: DatabaseIdentitySnapshot | null;
  databaseError?: string;
  rls: RlsTableSnapshot[] | null;
  rlsError?: string;
  ledgerRows: LedgerRowSnapshot[] | null;
  ledgerError?: string;
  migrationInputs: MigrationInputsSnapshot | null;
  providers: ProviderSnapshot[] | null;
  providerError?: string;
  knowledgeTables: KnowledgeTablesSnapshot | null;
  knowledgeError?: string;
  queue: QueueSnapshot | null;
  heartbeat: WorkerHeartbeat;
};

const trackedVariables = [
  ...requiredEnvironmentVariables,
  ...optionalEnvironmentVariables,
  'ASSISTANT_EMBEDDING_URL',
  'ASSISTANT_EMBEDDING_API_KEY',
  'ASSISTANT_KNOWLEDGE_PROVIDER',
  'ASSISTANT_BAILIAN_RAG_WORKSPACE_ID',
  'ASSISTANT_BAILIAN_RAG_API_KEY',
  'ASSISTANT_WORKER_ENDPOINT',
  'ASSISTANT_WORKER_HEALTH_FILE',
] as const;

export function buildEnvironmentReport(input: EnvironmentReportInput): EnvironmentCheckReport {
  const items = [
    ...evaluateRuntime(input.runtime),
    ...evaluateEnvironmentFiles({ files: input.envFiles, env: input.env }),
    ...evaluateDatabaseIdentity(input.database, input.databaseError),
    ...evaluateRowLevelSecurity(input.rls, input.rlsError),
    ...evaluateMigrationLedger(input.ledgerRows, input.migrationInputs, input.ledgerError),
    ...evaluateModelConfiguration(input.providers, input.providerError),
    ...evaluateEmbeddingConfiguration(input.env),
    ...evaluateKnowledgeConfiguration({ env: input.env, tables: input.knowledgeTables, error: input.knowledgeError }),
    ...evaluateWorkerConfiguration({ env: input.env, heartbeat: input.heartbeat, queue: input.queue }),
    ...evaluateProductionBoundary({ identity: input.database, productionEnvKeys: input.productionEnvKeys }),
  ];
  const { overall, levels, summary } = summarizeEnvironment(items);
  return {
    tool: 'xiaok-env-check',
    version: 1,
    generatedAt: input.generatedAt.toISOString(),
    overall,
    redacted: true,
    levels,
    summary,
    items,
    runtime: {
      node: input.runtime.nodeVersion,
      npm: input.runtime.npmVersion,
      platform: process.platform,
      cwd: process.cwd(),
      projectVersion: input.runtime.projectVersion,
    },
    envFiles: input.envFiles,
    variables: Object.fromEntries(trackedVariables.map(name => [name, input.env[name]?.trim() ? 'set' : 'missing'])),
  };
}

/** Acceptance scripts can gate on explicit levels instead of reimplementing probes. */
export function unmetRequiredLevels(report: EnvironmentCheckReport, required: readonly EnvironmentLevel[]): EnvironmentLevel[] {
  return required.filter(level => report.levels.find(entry => entry.level === level)?.status !== 'passed');
}
