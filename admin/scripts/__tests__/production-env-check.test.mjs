import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateProductionEnv } from '../production-env-check.mjs';

function valid(overrides = {}) {
  return {
    NODE_ENV: 'production',
    JWT_SECRET: 'j'.repeat(64),
    INTERNAL_SECRET: 'i'.repeat(64),
    CRON_SECRET: 'c'.repeat(64),
    MEDIA_STORAGE_KEY_ENCRYPTION_SECRET: 'm'.repeat(64),
    AI_PROVIDER_KEY_ENCRYPTION_SECRET: 'a'.repeat(64),
    DATABASE_URL: 'postgresql://sfp_app:strong-password@db:5432/smart_floor_planner',
    DATABASE_MIGRATION_URL: 'postgresql://sfp_migrator:strong-password@db:5432/smart_floor_planner',
    AUTH_COOKIE_SECURE: 'true',
    ALLOW_TENANT_ENTERPRISE_RESET: 'false',
    ASSISTANT_BAILIAN_RAG_WORKSPACE_ID: 'ws-production',
    ASSISTANT_BAILIAN_RAG_API_KEY: 'bailian-key',
    ASSISTANT_EMBEDDING_URL: 'https://embedding.internal',
    ASSISTANT_EMBEDDING_API_KEY: 'embedding-key',
    ASSISTANT_WORKER_HEALTH_FILE: '/shared/assistant-worker-health.json',
    DEPLOY_SMOKE_USERNAME: 'deploy_smoke',
    DEPLOY_SMOKE_PASSWORD: 'smoke-password-1234',
    ...overrides,
  };
}

test('a complete production configuration passes', () => {
  assert.deepEqual(validateProductionEnv(valid()), { ok: true, errors: [] });
});

test('missing, default, placeholder and shared secrets are rejected', () => {
  const missing = validateProductionEnv(valid({ JWT_SECRET: '' }));
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.some((error) => error.includes('JWT_SECRET')));

  const placeholder = validateProductionEnv(valid({ INTERNAL_SECRET: 'replace_with_a_long_random_value' }));
  assert.equal(placeholder.ok, false);
  assert.ok(placeholder.errors.some((error) => error.includes('placeholder')));

  const shared = validateProductionEnv(valid({ AI_PROVIDER_KEY_ENCRYPTION_SECRET: 'j'.repeat(64) }));
  assert.equal(shared.ok, false);
  assert.ok(shared.errors.some((error) => error.includes('independent')));

  const weak = validateProductionEnv(valid({ MEDIA_STORAGE_KEY_ENCRYPTION_SECRET: '123456' }));
  assert.equal(weak.ok, false);
});

test('local database defaults and unsafe deployment flags are rejected', () => {
  const local = validateProductionEnv(valid({
    DATABASE_URL: 'postgresql://sfp_app:sfp_app_local_only@postgres:5432/smart_floor_planner',
  }));
  assert.equal(local.ok, false);
  assert.ok(local.errors.some((error) => error.includes('local compose password')));

  const insecure = validateProductionEnv(valid({
    AUTH_COOKIE_SECURE: 'false',
    ALLOW_TENANT_ENTERPRISE_RESET: 'true',
  }));
  assert.equal(insecure.ok, false);
  assert.ok(insecure.errors.some((error) => error.includes('AUTH_COOKIE_SECURE')));
  assert.ok(insecure.errors.some((error) => error.includes('ALLOW_TENANT_ENTERPRISE_RESET')));
});

test('AI endpoints, worker health path and smoke credentials are required', () => {
  const result = validateProductionEnv(valid({
    ASSISTANT_BAILIAN_RAG_WORKSPACE_ID: '',
    ASSISTANT_EMBEDDING_URL: 'http://127.0.0.1:18089',
    ASSISTANT_WORKER_HEALTH_FILE: 'assistant-worker-health.json',
    DEPLOY_SMOKE_USERNAME: '',
  }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('ASSISTANT_BAILIAN_RAG_WORKSPACE_ID')));
  assert.ok(result.errors.some((error) => error.includes('loopback')));
  assert.ok(result.errors.some((error) => error.includes('absolute path')));
  assert.ok(result.errors.some((error) => error.includes('DEPLOY_SMOKE_USERNAME')));
});
