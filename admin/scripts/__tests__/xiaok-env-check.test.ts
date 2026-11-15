import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MigrationMeta } from 'drizzle-orm/migrator';
import {
  buildEnvironmentReport, developmentDatabaseScope, evaluateDatabase, evaluateEmbeddingConfiguration,
  evaluateEnvironmentFiles, evaluateIsolatedIndependence, evaluateKnowledgeConfiguration, evaluateModelConfiguration,
  evaluateProductionBoundary, evaluateProductionConfig, evaluateRuntime, evaluateWorkerConfiguration,
  isolatedDatabaseScope, parsePostgresTarget, redactSecrets, requiredProductionVariables, summarizeEnvironment,
  unmetRequiredLevels,
  type DatabaseEvidence, type DatabaseIdentitySnapshot, type EnvironmentReportInput, type MigrationInputsSnapshot,
  type PlatformLlmSnapshot, type ProviderSnapshot, type QueueSnapshot, type RlsTableSnapshot, type RuntimeSnapshot,
} from '../xiaok-env-check-lib';

const expectedPlatformModel = 'deepseek-v4.1-flash-1017';

const healthyPlatform: PlatformLlmSnapshot = {
  query: 'ok', rowPresent: true, enabled: true, providerKey: 'dashscope',
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  model: expectedPlatformModel, rawBaseUrlValid: true, rawModelPresent: true,
  apiKeyField: 'string', hasApiKey: true, apiKeyMasked: true,
  credentialFingerprint: 'fingerprint-current',
  lastTestStatus: '成功', lastTestBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  lastTestModel: expectedPlatformModel, lastTestAt: '2026-11-16T00:00:00.000Z',
  lastTestCredentialFingerprint: 'fingerprint-current', lastTestApiKeyMasked: 'masked-value',
};

const directProvider: ProviderSnapshot = {
  key: 'bailian-direct', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode', enabled: true,
  adapterType: 'openai_compatible', hasKey: true, capabilities: ['chat'],
  modelMappings: { chat: { general: expectedPlatformModel } }, priority: 100,
  createdAt: '2026-01-01T00:00:00.000Z',
  credential: { legacyKey: true, credentialsKeyType: 'string', credentialsKeyLength: 120, masked: true },
};

function platformLlm(overrides: Partial<PlatformLlmSnapshot> = {}): PlatformLlmSnapshot {
  return { ...healthyPlatform, ...overrides };
}

function modelItems(
  platform: PlatformLlmSnapshot,
  providers: ProviderSnapshot[] | null = [directProvider],
  credentialReady = true,
) {
  return evaluateModelConfiguration({ platform, providers, credentialReady });
}

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

const healthyIdentity: DatabaseIdentitySnapshot = {
  database: 'smart_floor_planner', role: 'sfp_app', serverVersionNum: 170010,
  rolsuper: false, rolbypassrls: false, readOnly: true, replica: false, host: '127.0.0.1', port: 5432,
};

const healthyRls: RlsTableSnapshot[] = [
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

const healthyQueue: QueueSnapshot = {
  readable: true, queued: 0, running: 0, failed: 0, oldestQueuedSeconds: null,
};

function databaseEvidence(overrides: Partial<DatabaseEvidence> = {}): DatabaseEvidence {
  return {
    configured: true, identity: { ...healthyIdentity }, rls: healthyRls,
    ledgerRows: [{ id: 1, hash: 'hash-1', created_at: 1000 }],
    ...overrides,
  };
}

const healthyReportInput: EnvironmentReportInput = {
  generatedAt: new Date('2026-11-16T00:00:00.000Z'),
  runtime: healthyRuntime,
  env: {
    DATABASE_URL: 'postgresql://sfp_app:super-secret-password@127.0.0.1:5432/smart_floor_planner',
    XIAOK_ISOLATED_DATABASE_URL: 'postgresql://sfp_app:isolated-secret@127.0.0.1:55432/smart_floor_planner_isolated',
    JWT_SECRET: 'jwt-secret-value', CRON_SECRET: 'cron-secret-value',
    INTERNAL_SECRET: 'internal-secret-value', MEDIA_STORAGE_KEY_ENCRYPTION_SECRET: 'media-secret-value',
    ASSISTANT_KNOWLEDGE_PROVIDER: 'bailian',
    ASSISTANT_BAILIAN_RAG_WORKSPACE_ID: 'approved-workspace',
    ASSISTANT_BAILIAN_RAG_API_KEY: 'rag-api-key-value',
  },
  envFiles: [{ file: '.env.local', exists: true }],
  productionEnvKeys: new Set(requiredProductionVariables),
  productionDatabaseUrl: 'postgresql://prod_user:prod-secret-password@prod.example.com:5432/smart_floor_planner',
  developmentDatabase: databaseEvidence({ queue: healthyQueue }),
  isolatedDatabase: databaseEvidence({
    identity: { ...healthyIdentity, database: 'smart_floor_planner_isolated', port: 55432 },
  }),
  migrationInputs,
  providers: [directProvider],
  platformLlm: healthyPlatform,
  credentialReady: true,
  knowledgeTables: { documents: true, chunks: true, vector: true },
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
});

test('environment file and required variable gaps are explicit', () => {
  const missingFile = evaluateEnvironmentFiles({ files: [], env: {} });
  assert.equal(missingFile.find(entry => entry.id === 'development.env_file')?.status, 'failed');
  assert.equal(missingFile.find(entry => entry.id === 'development.env_required')?.status, 'failed');
  const ok = evaluateEnvironmentFiles({
    files: [{ file: '.env.local', exists: true }],
    env: {
      DATABASE_URL: 'postgresql://redacted', XIAOK_ISOLATED_DATABASE_URL: 'postgresql://redacted',
      JWT_SECRET: 'a', CRON_SECRET: 'b', INTERNAL_SECRET: 'c', MEDIA_STORAGE_KEY_ENCRYPTION_SECRET: 'd',
    },
  });
  assert.equal(ok.every(entry => entry.status === 'passed'), true);
});

test('development and isolated databases use their own connection evidence', () => {
  const development = evaluateDatabase(databaseEvidence(), developmentDatabaseScope, migrationInputs);
  assert.equal(development.every(entry => entry.status === 'passed'), true);
  assert.equal(development.every(entry => entry.id.startsWith('development.database.')), true);
  const isolated = evaluateDatabase(databaseEvidence({
    identity: { ...healthyIdentity, database: 'smart_floor_planner_isolated', port: 55432 },
  }), isolatedDatabaseScope, migrationInputs);
  assert.equal(isolated.every(entry => entry.status === 'passed'), true);
  assert.equal(isolated.every(entry => entry.id.startsWith('isolated-pg17.')), true);

  const missingIsolated = evaluateDatabase({
    configured: false, identity: null, rls: null, ledgerRows: null,
  }, isolatedDatabaseScope, migrationInputs);
  assert.equal(missingIsolated.length, 1);
  assert.equal(missingIsolated[0].status, 'not_run');
  assert.equal(missingIsolated.some(entry => entry.status === 'passed'), false);
  assert.match(missingIsolated[0].reason ?? '', /XIAOK_ISOLATED_DATABASE_URL/);

  const missingDevelopment = evaluateDatabase({
    configured: false, identity: null, rls: null, ledgerRows: null,
  }, developmentDatabaseScope, migrationInputs);
  assert.equal(missingDevelopment[0].status, 'failed');
});

test('database checks distinguish PG16, superuser, bypassrls and connection failure', () => {
  const find = (evidence: DatabaseEvidence, id: string) =>
    evaluateDatabase(evidence, developmentDatabaseScope, migrationInputs).find(entry => entry.id === id);
  assert.equal(find(databaseEvidence({ identity: { ...healthyIdentity, serverVersionNum: 160010 } }),
    'development.database.version')?.status, 'failed');
  assert.equal(find(databaseEvidence({ identity: { ...healthyIdentity, rolsuper: true } }),
    'development.database.account')?.status, 'failed');
  assert.equal(find(databaseEvidence({ identity: { ...healthyIdentity, rolbypassrls: true } }),
    'development.database.account')?.status, 'failed');
  assert.equal(find(databaseEvidence({ identity: { ...healthyIdentity, readOnly: false } }),
    'development.database.read_only')?.status, 'failed');
  const failed = evaluateDatabase({
    configured: true, identity: null, rls: null, ledgerRows: null,
    error: '28P01: password authentication failed for user "sfp_app"',
  }, isolatedDatabaseScope, migrationInputs);
  assert.equal(failed[0].status, 'failed');
  assert.equal(failed[0].actual, 'connection_failed');
  assert.doesNotMatch(JSON.stringify(failed), /postgresql:\/\/[^\s]*@/);
});

test('RLS and migration gaps are reported per database', () => {
  const missingRls = evaluateDatabase(databaseEvidence({
    rls: healthyRls.filter(row => row.table !== 'assistant_jobs'),
  }), developmentDatabaseScope, migrationInputs);
  const rls = missingRls.find(entry => entry.id === 'development.database.rls');
  assert.equal(rls?.status, 'failed');
  assert.match(rls?.reason ?? '', /assistant_jobs/);
  const notForced = evaluateDatabase(databaseEvidence({
    rls: healthyRls.map(row => row.table === 'construction_reports' ? { ...row, forced: false } : row),
  }), isolatedDatabaseScope, migrationInputs);
  assert.equal(notForced.find(entry => entry.id === 'isolated-pg17.rls')?.status, 'failed');

  const pendingInputs: MigrationInputsSnapshot = {
    ...migrationInputs,
    active: [...migrationInputs.active, { when: 2000, tag: '0002_next', hashes: new Set(['hash-2']) }],
    migrations: [
      ...migrationInputs.migrations,
      { folderMillis: 2000, hash: 'hash-2', sql: ['select 2'] },
    ] as unknown as MigrationMeta[],
  };
  const pending = evaluateDatabase(databaseEvidence(), developmentDatabaseScope, pendingInputs)
    .find(entry => entry.id === 'development.database.migrations');
  assert.equal(pending?.status, 'failed');
  assert.match(pending?.reason ?? '', /0002_next/);
  assert.equal(evaluateDatabase(databaseEvidence({ ledgerRows: null, ledgerError: 'table_missing' }),
    isolatedDatabaseScope, migrationInputs).find(entry => entry.id === 'isolated-pg17.migrations')?.status, 'failed');
});

test('isolated independence prevents reusing the development database', () => {
  const same = evaluateIsolatedIndependence(databaseEvidence(), databaseEvidence());
  assert.equal(same.status, 'failed');
  const different = evaluateIsolatedIndependence(databaseEvidence(), databaseEvidence({
    identity: { ...healthyIdentity, database: 'smart_floor_planner_isolated', port: 55432 },
  }));
  assert.equal(different.status, 'passed');
  const missing = evaluateIsolatedIndependence(databaseEvidence(), {
    configured: false, identity: null, rls: null, ledgerRows: null,
  });
  assert.equal(missing.status, 'not_run');
});

test('platform LLM override wins when enabled and correctly configured', () => {
  const items = modelItems(platformLlm());
  for (const id of [
    'model.platform_config', 'model.platform_credentials', 'model.platform_endpoint',
    'model.platform_preset', 'model.platform_model', 'model.platform_last_test',
    'model.provider_config', 'model.final_runtime',
  ]) {
    assert.equal(items.find(entry => entry.id === id)?.status, 'passed', id);
  }
  assert.match(items.find(entry => entry.id === 'model.final_runtime')?.actual ?? '', /source=llm_settings/);
  assert.equal(items.find(entry => entry.id === 'model.live_probe')?.status, 'not_run');
});

test('platform override disabled uses ai_provider_configs priority', () => {
  const items = modelItems(platformLlm({
    enabled: false, apiKeyField: 'missing', hasApiKey: false, apiKeyMasked: false,
    credentialFingerprint: null, lastTestStatus: null, lastTestBaseUrl: null, lastTestModel: null,
    lastTestAt: null, lastTestCredentialFingerprint: null, lastTestApiKeyMasked: null,
  }));
  assert.equal(items.find(entry => entry.id === 'model.platform_config')?.status, 'passed');
  assert.equal(items.find(entry => entry.id === 'model.platform_endpoint')?.status, 'not_run');
  const provider = items.find(entry => entry.id === 'model.provider_config');
  assert.equal(provider?.status, 'passed');
  assert.match(provider?.actual ?? '', /used=true/);
  const final = items.find(entry => entry.id === 'model.final_runtime');
  assert.equal(final?.status, 'passed');
  assert.match(final?.actual ?? '', /source=ai_providers,providerKey=bailian-direct/);
});

test('platform override missing credentials fails without falling back', () => {
  const items = modelItems(platformLlm({
    hasApiKey: false, apiKeyField: 'empty', apiKeyMasked: false, credentialFingerprint: null,
  }));
  assert.equal(items.find(entry => entry.id === 'model.platform_credentials')?.status, 'failed');
  const final = items.find(entry => entry.id === 'model.final_runtime');
  assert.equal(final?.status, 'failed');
  assert.match(final?.reason ?? '', /API Key/);
  assert.match(items.find(entry => entry.id === 'model.provider_config')?.actual ?? '', /used=false/);
});

test('platform override wrong model or endpoint fails the final route', () => {
  const wrongModel = modelItems(platformLlm({
    model: 'qwen3.7-flash', lastTestStatus: null, lastTestBaseUrl: null, lastTestModel: null,
    lastTestAt: null, lastTestCredentialFingerprint: null, lastTestApiKeyMasked: null,
  }));
  assert.equal(wrongModel.find(entry => entry.id === 'model.platform_model')?.status, 'failed');
  assert.equal(wrongModel.find(entry => entry.id === 'model.final_runtime')?.status, 'failed');
  const wrongEndpoint = modelItems(platformLlm({
    baseUrl: 'https://api.deepseek.com/v1', lastTestStatus: null, lastTestBaseUrl: null,
    lastTestModel: null, lastTestAt: null, lastTestCredentialFingerprint: null, lastTestApiKeyMasked: null,
  }));
  assert.equal(wrongEndpoint.find(entry => entry.id === 'model.platform_endpoint')?.status, 'failed');
  assert.equal(wrongEndpoint.find(entry => entry.id === 'model.final_runtime')?.status, 'failed');
});

test('platform config read failure and credential anomalies are explicit', () => {
  const failed = modelItems(platformLlm({
    query: 'failed', error: '42501: permission denied', enabled: false, hasApiKey: false,
    apiKeyField: 'missing', credentialFingerprint: null,
  }));
  assert.equal(failed.find(entry => entry.id === 'model.platform_config')?.status, 'failed');
  assert.match(failed.find(entry => entry.id === 'model.platform_config')?.reason ?? '', /读取失败/);
  assert.equal(failed.find(entry => entry.id === 'model.final_runtime')?.status, 'failed');

  const anomaly = modelItems(platformLlm({
    apiKeyField: 'invalid', hasApiKey: false, apiKeyMasked: false, credentialFingerprint: null,
  }));
  const credentials = anomaly.find(entry => entry.id === 'model.platform_credentials');
  assert.equal(credentials?.status, 'failed');
  assert.match(credentials?.reason ?? '', /类型异常/);
  assert.doesNotMatch(JSON.stringify(anomaly), /apiKeyEncrypted=/);
});

test('embedding and knowledge checks separate configuration from live probes', () => {
  const bailianMissing = evaluateKnowledgeConfiguration({
    env: { ASSISTANT_KNOWLEDGE_PROVIDER: 'bailian' }, tables: { documents: true, chunks: true, vector: true },
  });
  assert.equal(bailianMissing.find(entry => entry.id === 'knowledge.config')?.status, 'failed');
  assert.match(bailianMissing.find(entry => entry.id === 'knowledge.config')?.reason ?? '', /WORKSPACE_ID/);
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
  assert.equal(evaluateEmbeddingConfiguration({ ASSISTANT_KNOWLEDGE_PROVIDER: 'local' })[0].status, 'failed');
});

test('worker checks are explicitly scoped to the development environment', () => {
  const healthy = evaluateWorkerConfiguration({
    env: { CRON_SECRET: 'secret' }, heartbeat: healthyHeartbeat, queue: healthyQueue,
    developmentIdentity: healthyIdentity,
  });
  assert.equal(healthy.every(entry => entry.status === 'passed'), true);
  const heartbeat = healthy.find(entry => entry.id === 'worker.heartbeat');
  assert.match(heartbeat?.actual ?? '', /environment=development/);
  const queue = healthy.find(entry => entry.id === 'worker.queue');
  assert.match(queue?.actual ?? '', /environment=development,database=smart_floor_planner/);
  assert.doesNotMatch(queue?.actual ?? '', /production|isolated/);

  const missingSecret = evaluateWorkerConfiguration({
    env: {}, heartbeat: healthyHeartbeat, queue: healthyQueue, developmentIdentity: healthyIdentity,
  });
  assert.equal(missingSecret.find(entry => entry.id === 'worker.auth')?.status, 'failed');
  const stale = evaluateWorkerConfiguration({
    env: { CRON_SECRET: 'secret' },
    heartbeat: { freshness: 'stale', lastSuccessAt: '2026-11-15T00:00:00.000Z', ageSeconds: '86400', liveProbe: false },
    queue: null, developmentIdentity: healthyIdentity,
  });
  assert.equal(stale.find(entry => entry.id === 'worker.heartbeat')?.status, 'failed');
  assert.match(stale.find(entry => entry.id === 'worker.heartbeat')?.reason ?? '', /开发环境/);
  const noDevelopment = evaluateWorkerConfiguration({
    env: { CRON_SECRET: 'secret' }, heartbeat: healthyHeartbeat, queue: null, developmentIdentity: null,
  });
  assert.equal(noDevelopment.find(entry => entry.id === 'worker.environment')?.status, 'limited');
  assert.equal(noDevelopment.find(entry => entry.id === 'worker.queue')?.status, 'not_run');
  assert.match(noDevelopment.find(entry => entry.id === 'worker.queue')?.reason ?? '', /不读取生产或隔离库队列/);
  const backlog = evaluateWorkerConfiguration({
    env: { CRON_SECRET: 'secret' }, heartbeat: healthyHeartbeat,
    queue: { readable: true, queued: 60, running: 0, failed: 2, oldestQueuedSeconds: 7200 },
    developmentIdentity: healthyIdentity,
  });
  assert.equal(backlog.find(entry => entry.id === 'worker.queue')?.status, 'failed');
});

test('production identifies configuration without connecting', () => {
  const target = parsePostgresTarget('postgresql://prod_user:prod-secret@prod.example.com:5432/smart_floor_planner');
  assert.deepEqual(target, { host: 'prod.example.com', database: 'smart_floor_planner', credentials: true });
  const config = evaluateProductionConfig('postgresql://prod_user:prod-secret@prod.example.com:5432/smart_floor_planner');
  assert.equal(config.status, 'passed');
  assert.match(config.actual, /host=prod\.example\.com,database=smart_floor_planner/);
  assert.doesNotMatch(config.actual, /prod-secret|postgresql:\/\//);
  assert.equal(evaluateProductionConfig(null).status, 'not_run');
  assert.equal(evaluateProductionConfig('not-a-url').status, 'failed');
  const local = evaluateProductionConfig('postgresql://prod_user:prod-secret@localhost:5432/smart_floor_planner');
  assert.equal(local.status, 'limited');
  assert.match(local.reason ?? '', /本机地址/);
  const boundary = evaluateProductionBoundary({
    productionDatabaseUrl: 'postgresql://prod_user:prod-secret@prod.example.com:5432/smart_floor_planner',
    productionEnvKeys: new Set(requiredProductionVariables),
  });
  assert.equal(boundary.find(entry => entry.id === 'production.connection')?.status, 'not_run');
  assert.equal(boundary.find(entry => entry.id === 'production.env_file')?.status, 'passed');
  assert.equal(boundary.find(entry => entry.id === 'production.deployment')?.status, 'not_run');
});

test('full report passes without leaking development, isolated or production secrets', () => {
  const report = buildEnvironmentReport(healthyReportInput);
  assert.equal(report.overall, 'passed');
  assert.equal(report.summary.failed, 0);
  assert.equal(unmetRequiredLevels(report, ['development', 'isolated-pg17', 'model', 'knowledge', 'worker', 'production']).length, 0);
  assert.equal(report.targets.development.database, 'smart_floor_planner');
  assert.equal(report.targets.isolated.database, 'smart_floor_planner_isolated');
  assert.equal(report.targets.production.connected, false);
  const json = JSON.stringify(report);
  for (const secret of ['super-secret-password', 'isolated-secret', 'prod-secret-password', 'jwt-secret-value',
    'cron-secret-value', 'internal-secret-value', 'media-secret-value', 'rag-api-key-value']) {
    assert.equal(json.includes(secret), false, `report leaked ${secret}`);
  }
  assert.equal(report.variables.DATABASE_URL, 'set');
  assert.equal(report.variables.XIAOK_ISOLATED_DATABASE_URL, 'set');
});

test('only DATABASE_URL leaves isolated-pg17 not_run instead of passed', () => {
  const report = buildEnvironmentReport({
    ...healthyReportInput,
    isolatedDatabase: { configured: false, identity: null, rls: null, ledgerRows: null },
  });
  assert.equal(report.levels.find(level => level.level === 'development')?.status, 'passed');
  assert.equal(report.levels.find(level => level.level === 'isolated-pg17')?.status, 'not_run');
  assert.equal(report.items.some(entry => entry.id.startsWith('isolated-pg17.') && entry.status === 'passed'), false);
  assert.equal(unmetRequiredLevels(report, ['isolated-pg17']).length, 1);
  assert.equal(report.targets.isolated.configured, false);
  assert.equal(report.targets.isolated.connected, false);
});

test('both databases configured are reported separately', () => {
  const report = buildEnvironmentReport(healthyReportInput);
  assert.equal(report.levels.find(level => level.level === 'development')?.status, 'passed');
  assert.equal(report.levels.find(level => level.level === 'isolated-pg17')?.status, 'passed');
  assert.equal(report.items.find(entry => entry.id === 'isolated-pg17.independence')?.status, 'passed');
  assert.equal(report.targets.development.source, 'DATABASE_URL');
  assert.equal(report.targets.isolated.source, 'XIAOK_ISOLATED_DATABASE_URL');
});

test('isolated connection failure does not affect the development database result', () => {
  const report = buildEnvironmentReport({
    ...healthyReportInput,
    isolatedDatabase: {
      configured: true, identity: null, rls: null, ledgerRows: null,
      error: '28P01: password authentication failed for user "sfp_app"',
    },
  });
  assert.equal(report.levels.find(level => level.level === 'development')?.status, 'passed');
  assert.equal(report.levels.find(level => level.level === 'isolated-pg17')?.status, 'failed');
  assert.equal(report.items.find(entry => entry.id === 'isolated-pg17.connection')?.status, 'failed');
  assert.doesNotMatch(JSON.stringify(report), /postgresql:\/\/[^\s]*@/);
});

test('different migration ledgers fail only the affected database', () => {
  const pendingInputs: MigrationInputsSnapshot = {
    ...migrationInputs,
    active: [...migrationInputs.active, { when: 2000, tag: '0002_next', hashes: new Set(['hash-2']) }],
    migrations: [
      ...migrationInputs.migrations,
      { folderMillis: 2000, hash: 'hash-2', sql: ['select 2'] },
    ] as unknown as MigrationMeta[],
  };
  const report = buildEnvironmentReport({
    ...healthyReportInput,
    migrationInputs: pendingInputs,
    developmentDatabase: databaseEvidence({
      queue: healthyQueue,
      ledgerRows: [
        { id: 1, hash: 'hash-1', created_at: 1000 },
        { id: 2, hash: 'hash-2', created_at: 2000 },
      ],
    }),
    isolatedDatabase: databaseEvidence({
      identity: { ...healthyIdentity, database: 'smart_floor_planner_isolated', port: 55432 },
    }),
  });
  assert.equal(report.items.find(entry => entry.id === 'development.database.migrations')?.status, 'passed');
  const isolated = report.items.find(entry => entry.id === 'isolated-pg17.migrations');
  assert.equal(isolated?.status, 'failed');
  assert.match(isolated?.reason ?? '', /0002_next/);
});

test('failed and limited states are summarized per level and redacted', () => {
  const report = buildEnvironmentReport({
    ...healthyReportInput,
    developmentDatabase: {
      configured: true, identity: null, rls: null, ledgerRows: null,
      error: 'connect ECONNREFUSED 127.0.0.1:5432',
    },
    isolatedDatabase: { configured: false, identity: null, rls: null, ledgerRows: null },
    heartbeat: { freshness: 'unknown', lastSuccessAt: 'unknown', ageSeconds: 'unknown', liveProbe: false },
  });
  assert.equal(report.overall, 'failed');
  assert.equal(report.levels.find(level => level.level === 'development')?.status, 'failed');
  assert.equal(report.levels.find(level => level.level === 'isolated-pg17')?.status, 'not_run');
  assert.equal(report.levels.find(level => level.level === 'worker')?.status, 'failed');
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
