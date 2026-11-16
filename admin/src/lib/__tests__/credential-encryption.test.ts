import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test } from 'node:test';
import {
  CredentialEncryptionError,
  decryptText,
  encryptText,
  isCredentialEncryptionReady,
} from '@/lib/crypto';

function legacyEncrypt(plain: string, secret: string) {
  const key = crypto.createHash('sha256').update(secret).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join('.');
}

function withEnv<T>(patch: Record<string, string | undefined>, run: () => T): T {
  const previous = Object.fromEntries(Object.keys(patch).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('production refuses encryption without a dedicated AI provider key', () => {
  withEnv({
    NODE_ENV: 'production',
    AI_PROVIDER_KEY_ENCRYPTION_SECRET: undefined,
    JWT_SECRET: 'j'.repeat(64),
  }, () => {
    assert.equal(isCredentialEncryptionReady(), false);
    assert.throws(() => encryptText('secret'), CredentialEncryptionError);
  });
});

test('production rejects a shared, short or default AI provider key', () => {
  const jwt = 'j'.repeat(64);
  for (const value of [jwt, 'short-key', 'smart-floor-planner-pollinations-secret']) {
    withEnv({
      NODE_ENV: 'production',
      JWT_SECRET: jwt,
      AI_PROVIDER_KEY_ENCRYPTION_SECRET: value,
    }, () => {
      assert.equal(isCredentialEncryptionReady(), false);
      assert.throws(() => encryptText('secret'), CredentialEncryptionError);
    });
  }
});

test('new ciphertext uses the dedicated key and round-trips', () => {
  withEnv({
    NODE_ENV: 'production',
    JWT_SECRET: 'j'.repeat(64),
    AI_PROVIDER_KEY_ENCRYPTION_SECRET: 'a'.repeat(64),
  }, () => {
    const payload = encryptText('provider-api-key');
    assert.notEqual(payload, '');
    assert.equal(decryptText(payload), 'provider-api-key');
  });
});

test('production does not fall back to the old fixed default secret', () => {
  const payload = legacyEncrypt('legacy-default-key', 'smart-floor-planner-pollinations-secret');
  withEnv({
    NODE_ENV: 'production',
    JWT_SECRET: 'j'.repeat(64),
    AI_PROVIDER_KEY_ENCRYPTION_SECRET: 'n'.repeat(64),
  }, () => {
    assert.throws(() => decryptText(payload), CredentialEncryptionError);
  });
});

test('old JWT-encrypted ciphertext remains readable and failures do not leak the secret', () => {
  const oldJwt = 'old-jwt-secret-' + 'x'.repeat(48);
  const payload = legacyEncrypt('legacy-provider-key', oldJwt);
  withEnv({
    NODE_ENV: 'production',
    JWT_SECRET: oldJwt,
    AI_PROVIDER_KEY_ENCRYPTION_SECRET: 'n'.repeat(64),
  }, () => {
    assert.equal(decryptText(payload), 'legacy-provider-key');
    let message = '';
    try {
      decryptText('not-a-valid-payload');
    } catch (error) {
      message = String((error as Error).message);
    }
    assert.match(message, /凭据解密失败/);
    assert.equal(message.includes(oldJwt), false);
    assert.equal(message.includes('n'.repeat(64)), false);
  });
});
