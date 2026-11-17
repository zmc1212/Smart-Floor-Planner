import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEVELOPMENT_JWT_SECRET,
  JwtSecretUnavailableError,
  getJwtSecret,
  getJwtSecretString,
  isJwtSecretConfigured,
} from '@/lib/jwt-secret';
import { signMiniProgramToken, verifyMiniProgramToken } from '@/lib/miniprogram-jwt';
import { signAdminSession } from '@/lib/admin-session';
import { getTenantContext } from '@/lib/auth';
import type { AdminUserRecord } from '@/db/repositories';
import * as jose from 'jose';

const admin = {
  id: BigInt(42), username: 'admin42', displayName: 'Admin 42',
  role: 'enterprise_admin', enterpriseId: BigInt(7), mustChangePassword: false,
} as unknown as AdminUserRecord;

async function withEnv<T>(patch: Record<string, string | undefined>, run: () => Promise<T> | T): Promise<T> {
  const previous = Object.fromEntries(Object.keys(patch).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

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

test('Admin cookie signing and verification use the same production JWT source', async () => {
  const secret = 'A'.repeat(64);
  await withEnv({ NODE_ENV: 'production', JWT_SECRET: secret }, async () => {
    const token = await signAdminSession({ admin, permissions: ['construction-projects'] });
    const request = new Request('https://example.test/api/projects', {
      headers: { cookie: `auth_token=${token}` },
    });
    const context = await getTenantContext(request);
    assert.deepEqual(context, {
      userId: '42', role: 'enterprise_admin', enterpriseId: '7', username: 'admin42', mustChangePassword: false,
    });
    const { payload } = await jose.jwtVerify(token, getJwtSecret({ NODE_ENV: 'production', JWT_SECRET: secret } as NodeJS.ProcessEnv));
    assert.equal(payload.id, '42');
    assert.equal(payload.role, 'enterprise_admin');
  });
});

test('Mini Program signing, verification and audience isolation share the same production JWT source', async () => {
  const secret = 'B'.repeat(64);
  await withEnv({ NODE_ENV: 'production', JWT_SECRET: secret }, async () => {
    const token = await signMiniProgramToken({
      sub: '88', id: '88', mode: 'customer', role: 'user', contextVersion: 3, source: 'wechat',
    });
    const verified = await verifyMiniProgramToken(token);
    assert.equal(verified?.id, '88');
    assert.equal(verified?.mode, 'customer');
    assert.equal(verified?.contextVersion, 3);
    const miniAsCookie = await getTenantContext(new Request('https://example.test/api/projects', {
      headers: { cookie: `auth_token=${token}` },
    }));
    assert.equal(miniAsCookie, null, 'miniprogram audience must not become an Admin session');
    const adminToken = await signAdminSession({ admin, permissions: [] });
    assert.equal(await verifyMiniProgramToken(adminToken), null, 'Admin token must not verify as miniprogram');
  });
});

test('tokens signed before the resolver change remain compatible when the secret is unchanged', async () => {
  const secret = 'C'.repeat(64);
  await withEnv({ NODE_ENV: 'production', JWT_SECRET: secret }, async () => {
    const oldToken = await new jose.SignJWT({
      sub: '99', id: '99', mode: 'staff', role: 'staff', staffRole: 'designer',
      enterpriseId: '7', contextVersion: 1, source: 'password',
    }).setProtectedHeader({ alg: 'HS256' }).setSubject('99').setIssuedAt()
      .setAudience('miniprogram').setExpirationTime('21d')
      .sign(new TextEncoder().encode(secret));
    const payload = await verifyMiniProgramToken(oldToken);
    assert.equal(payload?.id, '99');
    assert.equal(payload?.staffRole, 'designer');
  });
});

test('development and test environments accept explicit test secrets', async () => {
  const secret = 'test-only-jwt-secret-with-enough-length';
  await withEnv({ NODE_ENV: 'test', JWT_SECRET: secret }, async () => {
    const token = await signMiniProgramToken({
      sub: '100', id: '100', mode: 'staff', role: 'staff', contextVersion: 1, source: 'password',
    });
    assert.equal((await verifyMiniProgramToken(token))?.id, '100');
    const adminToken = await signAdminSession({ admin, permissions: [] });
    const ctx = await getTenantContext(new Request('https://example.test/api/projects', {
      headers: { cookie: `auth_token=${adminToken}` },
    }));
    assert.equal(ctx?.userId, '42');
  });
});

test('verification logs do not contain the secret or the full token', async () => {
  const secret = 'D'.repeat(64);
  const token = 'definitely-not-a-jwt-token-value';
  const messages: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { messages.push(args.map(String).join(' ')); };
  try {
    await withEnv({ NODE_ENV: 'production', JWT_SECRET: secret }, async () => {
      assert.equal(await verifyMiniProgramToken(token), null);
    });
  } finally {
    console.error = original;
  }
  const output = messages.join('\n');
  assert.equal(output.includes(secret), false);
  assert.equal(output.includes(token), false);
});

test('mini program token signing fails closed and verification returns null without production JWT', async () => {
  const env = process.env as Record<string, string | undefined>;
  const previousNodeEnv = env.NODE_ENV;
  const previousSecret = env.JWT_SECRET;
  try {
    env.NODE_ENV = 'production';
    delete env.JWT_SECRET;
    await assert.rejects(
      signMiniProgramToken({
        sub: '1', id: '1', mode: 'customer', role: 'user', contextVersion: 1, source: 'wechat',
      }),
      JwtSecretUnavailableError
    );
    assert.equal(await verifyMiniProgramToken('not-a-token'), null);
  } finally {
    if (previousNodeEnv === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = previousNodeEnv;
    if (previousSecret === undefined) delete env.JWT_SECRET;
    else env.JWT_SECRET = previousSecret;
  }
});
