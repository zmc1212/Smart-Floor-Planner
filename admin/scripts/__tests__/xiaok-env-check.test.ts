import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MigrationMeta } from 'drizzle-orm/migrator';
import {
  buildEnvironmentReport, evaluateDatabaseIdentity, evaluateEmbeddingConfiguration, evaluateEnvironmentFiles,
  evaluateKnowledgeConfiguration, evaluateMigrationLedger, evaluateModelConfiguration, evaluateRowLevelSecurity,
  evaluateRuntime, evaluateWorkerConfiguration, redactSecrets, summarizeEnvironment, unmetRequiredLevels,
  type EnvironmentReportInput, type MigrationInputsSnapshot, type RuntimeSnapshot,
} from '../xiaok-env-check-lib';

const healthyRuntime: RuntimeSnapshot = {
  nodeVersion: 'v24.9.0',
  npmVersion: '11.6.0',
  enginesNode: '>=22.13.0',
  projectVersion: '0.1.0',
  nodeModulesPresent: true,
  lockfilePresent: true,
  installed: {
    next: '16.4.6', react: '19.2.4', 'react-dom': '19.2.4', 'drizzle-orm': '0.45.2',
    pg: '8.22.0', tsx: '4.20.6', typescript: '5.9.3',
  },
};

const healthyIdentity = {
  database: 'smart_floor_planner', role: 'sfp_app', serverVersionNum: 170010,
  rolsuper: false, rolbypassrls: false, readOnly: true, replica: false, host: '127.0.0.1', port: 5432,
};

const healthyRls = [
  'assistant_conversations', 'assistant_messages', 'assistant_jobs', 'construction_reports',
  'construction_report_versions', 'construction_report_deliveries', 'construction_followup_bindings',
].map(table => ({ table, exists: true, rls: true, forced: true, policies: 1 }));

const migrationInputs: MigrationInputsSnapshot = {
  active: [{ when: 1000, tag: '0001_init', hashes: new Set(['hash-1']) }],
  migrations: [{ folderMillis: 1000, hash: 'hash-1', sql: ['select 1'] }] as unknown as MigrationMeta[],
  forks: {},
  knownHashes: [],
};

const healthyHeartbeat = {
  freshness: 'fresh' as const, lastSuccessAt: '2026-11-16T00:00:00.000Z', ageSeconds: '10', liveProbe: false as const,
};

const healthyReportInput: EnvironmentReportInput = {
  generatedAt: new Date('2026-11-16T00:00:00.000Z'),
  runtime: healthyRuntime,
  env: {
    DATABASE_URL: 'postgresql://sfp_app:super-secret-password@127.0.0.1:5432/smart_floor_planner',
    JWT_SECRET: 'jwt-secret-value', CRON_SECRET: 'cron-secret-value',
    INTERNAL_SECRET: 'internal-secret-value', MEDIA_STORAGE_KEY_ENCRYPTION_SECRET: 'media-secret-value',
    ASSISTANT_KNOWLEDGE_PROVIDER: 'bailian',
    ASSISTANT_BAILIAN_RAG_WORKSPACE_ID: 'approved-workspace',
    ASSISTANT_BAILIAN_RAG_API_KEY: 'rag-api-key-value',
  },
  envFiles: [{ file: '.env.local', exists: true }],
  productionEnvKeys: null,
  database: healthyIdentity,
  rls: healthyRls,
  ledgerRows: [{ id: 1, hash: 'hash-1', created_at: 1000 }],
  migrationInputs,
  providers: [{
    key: 'bailian', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode', enabled: true,
    adapterType: 'openai_compatible', hasKey: true,
    modelMappings: { chat: { general: 'deepseek-v4.1-flash-1017' } },
  }],
  knowledgeTables: { documents: true, chunks: true, vector: true },
  queue: { readable: true, queued: 0, running: 0, failed: 0, oldestQueuedSeconds: null },
  heartbeat: healthyHeartbeat,
};

test('runtime requires the project Node floor and installed dependencies', () => {
  assert.equal(evaluateRuntime(healthyRuntime).every(entry => entry.status === 'passed'), true);
  const lowNode = evaluateRuntime({ ...healthyRuntime, nodeVersion: 'v22.12.0' });
  assert.equal(lowNode.find(entry => entry.id === 'development.node')?.status, 'failed');
  const missing = evaluateRuntime({
    ...healthyRuntime, nodeModulesPresent: true,
    installed: { ...healthyRuntime.installed, pg: null, tsx: null },
  });
  const dependencies = missing.find(entry => entry.id === 'development.dependencies');
  assert.equal(dependencies?.status, 'failed');
  assert.match(dependencies?.reason ?? '', /pg/);
  assert.match(dependencies?.reason ?? '', /tsx/);
  assert.equal(evaluateRuntime({ ...healthyRuntime, nodeModulesPresent: false })
    .find(entry => entry.id === 'development.dependencies')?.status, 'failed');
});

test('environment file and required variable gaps are explicit', () => {
  const missingFile = evaluateEnvironmentFiles({ files: [], env: {} });
  assert.equal(missingFile.find(entry => entry.id === 'development.env_file')?.status, 'failed');
  assert.equal(missingFile.find(entry => entry.id === 'development.env_required')?.status, 'failed');
  const ok = evaluateEnvironmentFiles({
    files: [{ file: '.env.local', exists: true }],
    env: {
      DATABASE_URL: 'postgresql://redacted', JWT_SECRET: 'a', CRON_SECRET: 'b',
      INTERNAL_SECRET: 'c', MEDIA_STORAGE_KEY_ENCRYPTION_SECRET: 'd',
    },
  });
  assert.equal(ok.every(entry => entry.status === 'passed'), true);
});

test('database identity distinguishes PG16, superuser and bypassrls', () => {
  assert.equal(evaluateDatabaseIdentity(healthyIdentity)[0].status, 'passed');
  assert.equal(evaluateDatabaseIdentity({ ...healthyIdentity, serverVersionNum: 160010 })
    .find(entry => entry.id === 'isolated-pg17.version')?.status, 'failed');
  assert.equal(evaluateDatabaseIdentity({ ...healthyIdentity, rolsuper: true })
    .find(entry => entry.id === 'isolated-pg17.account')?.status, 'failed');
  assert.equal(evaluateDatabaseIdentity({ ...healthyIdentity, rolbypassrls: true })
    .find(entry => entry.id === 'isolated-pg17.account')?.status, 'failed');
  const failed = evaluateDatabaseIdentity(null, 'password authentication failed for user "sfp_app"');
  assert.equal(failed[0].status, 'failed');
  assert.equal(failed[0].actual, 'connection_failed');
  assert.doesNotMatch(JSON.stringify(failed), /postgresql:\/\/[^\s]*@/);
  assert.equal(evaluateDatabaseIdentity({ ...healthyIdentity, readOnly: false })
    .find(entry => entry.id === 'isolated-pg17.read_only')?.status, 'failed');
});

test('RLS gaps name the exact table and policy state', () => {
  assert.equal(evaluateRowLevelSecurity(healthyRls)[0].status, 'passed');
  const missing = evaluateRowLevelSecurity(healthyRls.filter(row => row.table !== 'assistant_jobs'));
  assert.equal(missing[0].status, 'failed');
  assert.match(missing[0].reason ?? '', /assistant_jobs/);
  const notForced = evaluateRowLevelSecurity(healthyRls.map(row =>
    row.table === 'construction_reports' ? { ...row, forced: false } : row));
  assert.equal(notForced[0].status, 'failed');
  assert.match(notForced[0].reason ?? '', /construction_reports/);
  assert.equal(evaluateRowLevelSecurity(null)[0].status, 'not_run');
});

test('migration ledger reports pending tags without running them', () => {
  assert.equal(evaluateMigrationLedger([{ id: 1, hash: 'hash-1', created_at: 1000 }], migrationInputs)[0].status, 'passed');
  const pendingInputs: MigrationInputsSnapshot = {
    ...migrationInputs,
    active: [...migrationInputs.active, { when: 2000, tag: '0002_next', hashes: new Set(['hash-2']) }],
    migrations: [
      ...migrationInputs.migrations,
      { folderMillis: 2000, hash: 'hash-2', sql: ['select 2'] },
    ] as unknown as MigrationMeta[],
  };
  const pending = evaluateMigrationLedger([{ id: 1, hash: 'hash-1', created_at: 1000 }], pendingInputs)[0];
  assert.equal(pending.status, 'failed');
  assert.match(pending.reason ?? '', /0002_next/);
  const unknown = evaluateMigrationLedger([{ id: 1, hash: 'unknown', created_at: 1000 }], pendingInputs)[0];
  assert.equal(unknown.status, 'failed');
  assert.match(unknown.reason ?? '', /Unrecognized migration/);
  assert.equal(evaluateMigrationLedger(null, null, 'table_missing')[0].status, 'failed');
});

test('model check requires the official Bailian origin and deepseek-flash mapping', () => {
  const provider = {
    key: 'bailian', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode', enabled: true,
    adapterType: 'openai_compatible', hasKey: true,
    modelMappings: { chat: { general: 'deepseek-v4.1-flash-1017' } },
  };
  assert.equal(evaluateModelConfiguration([provider]).find(entry => entry.id === 'model.deepseek')?.status, 'passed');
  const qwen = evaluateModelConfiguration([{ ...provider, modelMappings: { chat: { general: 'qwen3.7-flash' } } }]);
  assert.equal(qwen.find(entry => entry.id === 'model.deepseek')?.status, 'failed');
  assert.match(qwen.find(entry => entry.id === 'model.deepseek')?.reason ?? '', /deepseek/);
  const otherSupplier = evaluateModelConfiguration([{ ...provider, baseUrl: 'https://api.deepseek.com/v1' }]);
  assert.equal(otherSupplier.find(entry => entry.id === 'model.provider')?.status, 'failed');
  const disabled = evaluateModelConfiguration([{ ...provider, enabled: false }]);
  assert.equal(disabled.find(entry => entry.id === 'model.provider')?.status, 'failed');
  assert.equal(evaluateModelConfiguration([provider]).find(entry => entry.id === 'model.live_probe')?.status, 'not_run');
  assert.equal(evaluateModelConfiguration(null, 'database unavailable')[0].status, 'not_run');
});

test('embedding and knowledge checks separate configuration from live probes', () => {
  const bailianMissing = evaluateKnowledgeConfiguration({
    env: { ASSISTANT_KNOWLEDGE_PROVIDER: 'bailian' }, tables: { documents: true, chunks: true, vector: true },
  });
  assert.equal(bailianMissing.find(entry => entry.id === 'knowledge.config')?.status, 'failed');
  assert.match(bailianMissing.find(entry => entry.id === 'knowledge.config')?.reason ?? '', /WORKSPACE_ID/);
  assert.equal(bailianMissing.find(entry => entry.id === 'knowledge.live_probe')?.status, 'not_run');
  const bailianOk = evaluateKnowledgeConfiguration({
    env: {
      ASSISTANT_KNOWLEDGE_PROVIDER: 'bailian',
      ASSISTANT_BAILIAN_RAG_WORKSPACE_ID: 'approved-workspace',
      ASSISTANT_BAILIAN_RAG_API_KEY: 'redacted',
    },
    tables: { documents: true, chunks: true, vector: false },
  });
  assert.equal(bailianOk.find(entry => entry.id === 'knowledge.config')?.status, 'passed');
  assert.equal(evaluateEmbeddingConfiguration({ ASSISTANT_KNOWLEDGE_PROVIDER: 'bailian' })[0].status, 'not_run');
  const localMissing = evaluateKnowledgeConfiguration({
    env: { ASSISTANT_KNOWLEDGE_PROVIDER: 'local' }, tables: { documents: true, chunks: true, vector: false },
  });
  assert.equal(localMissing.find(entry => entry.id === 'knowledge.config')?.status, 'failed');
  assert.equal(localMissing.find(entry => entry.id === 'knowledge.tables')?.status, 'failed');
  const localEmbedding = evaluateEmbeddingConfiguration({ ASSISTANT_KNOWLEDGE_PROVIDER: 'local' });
  assert.equal(localEmbedding[0].status, 'failed');
  assert.match(localEmbedding[0].reason ?? '', /ASSISTANT_EMBEDDING_URL/);
  assert.equal(evaluateKnowledgeConfiguration({ env: { ASSISTANT_KNOWLEDGE_PROVIDER: 'other' }, tables: null })[0].status, 'failed');
});

test('worker check reports missing secret, stale heartbeat and queue backlog', () => {
  const healthy = evaluateWorkerConfiguration({
    env: { CRON_SECRET: 'secret' }, heartbeat: healthyHeartbeat,
    queue: { readable: true, queued: 0, running: 0, failed: 0, oldestQueuedSeconds: null },
  });
  assert.equal(healthy.every(entry => entry.status === 'passed'), true);
  const missingSecret = evaluateWorkerConfiguration({
    env: {}, heartbeat: healthyHeartbeat,
    queue: { readable: true, queued: 0, running: 0, failed: 0, oldestQueuedSeconds: null },
  });
  assert.equal(missingSecret.find(entry => entry.id === 'worker.auth')?.status, 'failed');
  const stale = evaluateWorkerConfiguration({
    env: { CRON_SECRET: 'secret' },
    heartbeat: { freshness: 'stale', lastSuccessAt: '2026-11-15T00:00:00.000Z', ageSeconds: '86400', liveProbe: false },
    queue: null,
  });
  assert.equal(stale.find(entry => entry.id === 'worker.heartbeat')?.status, 'failed');
  assert.equal(stale.find(entry => entry.id === 'worker.queue')?.status, 'not_run');
  const unknown = evaluateWorkerConfiguration({
    env: { CRON_SECRET: 'secret' },
    heartbeat: { freshness: 'unknown', lastSuccessAt: 'unknown', ageSeconds: 'unknown', liveProbe: false },
    queue: null,
  });
  assert.equal(unknown.find(entry => entry.id === 'worker.heartbeat')?.status, 'failed');
  const backlog = evaluateWorkerConfiguration({
    env: { CRON_SECRET: 'secret' }, heartbeat: healthyHeartbeat,
    queue: { readable: true, queued: 60, running: 0, failed: 2, oldestQueuedSeconds: 7200 },
  });
  assert.equal(backlog.find(entry => entry.id === 'worker.queue')?.status, 'failed');
  const limited = evaluateWorkerConfiguration({
    env: { CRON_SECRET: 'secret' }, heartbeat: healthyHeartbeat,
    queue: { readable: true, queued: 12, running: 1, failed: 0, oldestQueuedSeconds: 120 },
  });
  assert.equal(limited.find(entry => entry.id === 'worker.queue')?.status, 'limited');
});

test('full report is passed when real configuration is complete and never leaks secrets', () => {
  const report = buildEnvironmentReport(healthyReportInput);
  assert.equal(report.overall, 'passed');
  assert.equal(report.summary.failed, 0);
  assert.equal(unmetRequiredLevels(report, ['development', 'isolated-pg17', 'model', 'knowledge', 'worker']).length, 0);
  assert.equal(unmetRequiredLevels(report, ['production']).length, 0);
  const json = JSON.stringify(report);
  for (const secret of ['super-secret-password', 'jwt-secret-value', 'cron-secret-value', 'internal-secret-value',
    'media-secret-value', 'rag-api-key-value']) {
    assert.equal(json.includes(secret), false, `report leaked ${secret}`);
  }
  assert.equal(report.variables.DATABASE_URL, 'set');
  assert.equal(report.variables.ASSISTANT_EMBEDDING_API_KEY, 'missing');
});

test('failed and limited states are summarized per level and redacted', () => {
  const report = buildEnvironmentReport({
    ...healthyReportInput,
    database: null,
    databaseError: 'connect ECONNREFUSED 127.0.0.1:5432',
    rls: null,
    rlsError: 'database unavailable',
    ledgerRows: null,
    ledgerError: 'database unavailable',
    providers: null,
    providerError: 'database unavailable',
    knowledgeTables: null,
    knowledgeError: 'database unavailable',
    queue: null,
    heartbeat: { freshness: 'unknown', lastSuccessAt: 'unknown', ageSeconds: 'unknown', liveProbe: false },
  });
  assert.equal(report.overall, 'failed');
  assert.equal(report.levels.find(level => level.level === 'isolated-pg17')?.status, 'failed');
  assert.equal(report.levels.find(level => level.level === 'worker')?.status, 'failed');
  assert.equal(unmetRequiredLevels(report, ['isolated-pg17']).length, 1);
  assert.equal(redactSecrets('postgresql://user:pass@host/db Bearer abc.def sk-live-123456').includes('pass'), false);
  const limited = summarizeEnvironment([{
    id: 'x', level: 'development', label: 'x', status: 'limited', actual: 'x', fix: 'x', verify: 'x',
  }]);
  assert.equal(limited.overall, 'limited');
  const notRun = summarizeEnvironment([{
    id: 'y', level: 'production', label: 'y', status: 'not_run', actual: 'y', fix: 'y', verify: 'y',
  }]);
  assert.equal(notRun.overall, 'not_run');
});
