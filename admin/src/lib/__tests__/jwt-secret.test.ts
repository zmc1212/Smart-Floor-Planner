import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEVELOPMENT_JWT_SECRET,
  JwtSecretUnavailableError,
  getJwtSecretString,
  isJwtSecretConfigured,
} from '@/lib/jwt-secret';

test('production refuses a missing or default JWT secret', () => {
  assert.throws(() => getJwtSecretString({ NODE_ENV: 'production' } as NodeJS.ProcessEnv), JwtSecretUnavailableError);
  assert.throws(
    () => getJwtSecretString({ NODE_ENV: 'production', JWT_SECRET: DEVELOPMENT_JWT_SECRET } as NodeJS.ProcessEnv),
    JwtSecretUnavailableError
  );
  assert.equal(isJwtSecretConfigured({ NODE_ENV: 'production' } as NodeJS.ProcessEnv), false);
});

test('production rejects short and placeholder JWT secrets', () => {
  assert.throws(
    () => getJwtSecretString({ NODE_ENV: 'production', JWT_SECRET: 'short-secret' } as NodeJS.ProcessEnv),
    JwtSecretUnavailableError
  );
  assert.throws(
    () => getJwtSecretString({ NODE_ENV: 'production', JWT_SECRET: 'replace_with_a_32_character_secret_value' } as NodeJS.ProcessEnv),
    JwtSecretUnavailableError
  );
});

test('development and tests keep a local-only fallback while production requires explicit configuration', () => {
  assert.equal(getJwtSecretString({ NODE_ENV: 'development' } as NodeJS.ProcessEnv), DEVELOPMENT_JWT_SECRET);
  assert.equal(getJwtSecretString({ NODE_ENV: 'test' } as NodeJS.ProcessEnv), DEVELOPMENT_JWT_SECRET);
  const configured = 'a'.repeat(64);
  assert.equal(
    getJwtSecretString({ NODE_ENV: 'production', JWT_SECRET: configured } as NodeJS.ProcessEnv),
    configured
  );
  assert.equal(isJwtSecretConfigured({ NODE_ENV: 'production', JWT_SECRET: configured } as NodeJS.ProcessEnv), true);
});
