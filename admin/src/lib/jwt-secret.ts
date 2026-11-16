/**
 * One production-safe JWT secret resolver. Development and tests keep the
 * historical local fallback, but production must provide an explicit,
 * non-placeholder secret. No module may keep its own fallback copy.
 */
export const DEVELOPMENT_JWT_SECRET = 'fallback_secret_random_123';
const PLACEHOLDER = /(replace|your_|example|change_me|placeholder)/i;

export class JwtSecretUnavailableError extends Error {
  constructor() {
    super('认证服务未配置');
    this.name = 'JwtSecretUnavailableError';
  }
}

export function getJwtSecretString(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.JWT_SECRET?.trim();
  if (!configured) {
    if (env.NODE_ENV === 'production') throw new JwtSecretUnavailableError();
    return DEVELOPMENT_JWT_SECRET;
  }
  if (
    env.NODE_ENV === 'production' &&
    (configured === DEVELOPMENT_JWT_SECRET || configured.length < 32 || PLACEHOLDER.test(configured))
  ) {
    throw new JwtSecretUnavailableError();
  }
  return configured;
}

export function getJwtSecret(env: NodeJS.ProcessEnv = process.env): Uint8Array {
  return new TextEncoder().encode(getJwtSecretString(env));
}

export function isJwtSecretConfigured(env: NodeJS.ProcessEnv = process.env) {
  try {
    getJwtSecretString(env);
    return true;
  } catch {
    return false;
  }
}
