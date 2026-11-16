#!/usr/bin/env node
/**
 * Unified production configuration gate. It never prints values.
 *
 * Usage:
 *   node scripts/production-env-check.mjs
 *   SFP_ALLOW_LOOPBACK_EMBEDDING=true node scripts/production-env-check.mjs
 */
import { isAbsolute } from 'node:path';

const PLACEHOLDER = /(replace|your_|example|change_me|placeholder)/i;
const INSECURE_SECRETS = new Set([
  '123456',
  'fallback_secret_random_123',
  'smart-floor-planner-pollinations-secret',
  'local-dev-credential-encryption-only',
]);
const LOCAL_DB_PASSWORDS = ['sfp_app_local_only', 'sfp_migrator_local_only', 'sfp_owner_local_only'];

function present(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function absolute(value) {
  return present(value) && isAbsolute(value.trim());
}

export function validateProductionEnv(env = process.env) {
  const errors = [];
  const required = (name, length = 0) => {
    const value = env[name]?.trim();
    if (!value) {
      errors.push(`${name} is required`);
      return false;
    }
    if (length && value.length < length) errors.push(`${name} must contain at least ${length} characters`);
    if (PLACEHOLDER.test(value)) errors.push(`${name} must not use a placeholder value`);
    if (INSECURE_SECRETS.has(value)) errors.push(`${name} must not use a fixed or default value`);
    return true;
  };

  required('JWT_SECRET', 32);
  required('INTERNAL_SECRET', 32);
  required('MEDIA_STORAGE_KEY_ENCRYPTION_SECRET', 32);
  required('AI_PROVIDER_KEY_ENCRYPTION_SECRET', 32);
  required('CRON_SECRET', 32);

  if (present(env.JWT_SECRET) && present(env.AI_PROVIDER_KEY_ENCRYPTION_SECRET)
    && env.JWT_SECRET.trim() === env.AI_PROVIDER_KEY_ENCRYPTION_SECRET.trim()) {
    errors.push('AI_PROVIDER_KEY_ENCRYPTION_SECRET must be independent from JWT_SECRET');
  }

  for (const name of ['DATABASE_URL', 'DATABASE_MIGRATION_URL']) {
    if (!required(name)) continue;
    const value = env[name].trim();
    if (LOCAL_DB_PASSWORDS.some((password) => value.includes(password))) {
      errors.push(`${name} must not use the local compose password`);
    }
  }
  if (present(env.POSTGRES_PASSWORD)
    && LOCAL_DB_PASSWORDS.includes(env.POSTGRES_PASSWORD.trim())) {
    errors.push('POSTGRES_PASSWORD must not use the local compose default');
  }

  if (env.AUTH_COOKIE_SECURE !== 'true') errors.push('AUTH_COOKIE_SECURE must be true');
  if (env.ALLOW_TENANT_ENTERPRISE_RESET === 'true') errors.push('ALLOW_TENANT_ENTERPRISE_RESET must be false');

  required('ASSISTANT_BAILIAN_RAG_WORKSPACE_ID');
  required('ASSISTANT_BAILIAN_RAG_API_KEY');
  required('ASSISTANT_EMBEDDING_URL');
  required('ASSISTANT_EMBEDDING_API_KEY');

  if (present(env.ASSISTANT_EMBEDDING_URL)) {
    try {
      const url = new URL(env.ASSISTANT_EMBEDDING_URL);
      if (!['http:', 'https:'].includes(url.protocol)) errors.push('ASSISTANT_EMBEDDING_URL must be HTTP(S)');
      if (['localhost', '127.0.0.1', '::1'].includes(url.hostname)
        && env.SFP_ALLOW_LOOPBACK_EMBEDDING !== 'true') {
        errors.push('ASSISTANT_EMBEDDING_URL must not be loopback unless SFP_ALLOW_LOOPBACK_EMBEDDING=true');
      }
    } catch {
      errors.push('ASSISTANT_EMBEDDING_URL must be a valid URL');
    }
  }

  if (!absolute(env.ASSISTANT_WORKER_HEALTH_FILE)) {
    errors.push('ASSISTANT_WORKER_HEALTH_FILE must be an absolute path');
  }
  if (!present(env.DEPLOY_SMOKE_USERNAME)) errors.push('DEPLOY_SMOKE_USERNAME is required');
  required('DEPLOY_SMOKE_PASSWORD', 12);

  return { ok: errors.length === 0, errors };
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/production-env-check.mjs')) {
  const result = validateProductionEnv(process.env);
  if (!result.ok) {
    console.error('[production-env-check] configuration rejected');
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log('[production-env-check] configuration passed');
  }
}
