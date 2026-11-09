import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { closePostgresPool } from '@/lib/postgresql';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { signMiniProgramToken } from '@/lib/miniprogram-jwt';
import { POST as login } from '@/app/api/auth/miniprogram/route';

const originalDatabaseUrl = process.env.DATABASE_URL;

after(async () => {
  await closePostgresPool();
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
});

test('an unavailable identity database reports a service error instead of invalidating a valid Mini Program session', async () => {
  // No business database is contacted: loopback port 1 refuses the connection.
  process.env.DATABASE_URL = 'postgresql://127.0.0.1:1/native_qa_unavailable';
  const token = await signMiniProgramToken({
    sub: '1', id: '1', mode: 'customer', role: 'user',
    contextVersion: 1, source: 'wechat',
  });
  const request = new Request('http://localhost:3006/api/leads', {
    headers: { Authorization: `Bearer ${token}` },
  });

  await assert.rejects(
    resolveMiniProgramContext(request),
    (error: unknown) => (error as { status?: number }).status === 503,
  );
});

test('missing or invalid Mini Program credentials remain unauthenticated', async () => {
  assert.equal(await resolveMiniProgramContext(new Request('http://localhost:3006/api/leads')), null);
  assert.equal(await resolveMiniProgramContext(new Request('http://localhost:3006/api/leads', {
    headers: { Authorization: 'Bearer invalid-test-token' },
  })), null);
});

test('a failed login database query never returns SQL or account parameters to the client', async (t) => {
  await closePostgresPool();
  process.env.DATABASE_URL = 'postgresql://127.0.0.1:1/native_qa_unavailable';
  const { getPostgresPool } = await import('@/lib/postgresql');
  const sql = 'select "password_hash" from "app"."admin_users" where username = $1';
  const identifier = 'synthetic-private-login-parameter';
  const cause = Object.assign(new Error('column "construction_trades" does not exist'), { code: '42703' });
  const { DrizzleQueryError } = await import('drizzle-orm');
  const queryError = new DrizzleQueryError(sql, [identifier], cause);
  t.mock.method(getPostgresPool(), 'connect', async () => {
    // BEGIN and tenant scope succeed; the real repository SELECT fails.
    return {
      query: async (query: string | { text: string }) => {
        if (typeof query === 'object') throw queryError;
        return { rows: [] };
      },
      release() {},
    };
  });
  const logs: unknown[][] = [];
  for (const method of ['info', 'warn', 'error'] as const) {
    t.mock.method(console, method, (...args: unknown[]) => logs.push(args));
  }

  const response = await login(new Request('http://localhost:3006/api/auth/miniprogram', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'password', username: identifier, password: 'synthetic-password' }),
  }));

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { success: false, error: '登录失败，请稍后重试' });
  assert.ok(response.headers.get('X-Request-Id'));
  assert.match(JSON.stringify(logs), /42703/);
  assert.doesNotMatch(JSON.stringify(logs), /password_hash|synthetic-private-login-parameter|synthetic-password|construction_trades/);
});

test('malformed signed identity IDs are rejected before database resolution', async () => {
  const token = await signMiniProgramToken({
    sub: '1', id: '1', mode: 'staff', role: 'staff', staffRole: 'designer',
    enterpriseId: 'not-an-id', staffId: '2', contextVersion: 1, source: 'password',
  });
  assert.equal(await resolveMiniProgramContext(new Request('http://localhost:3006/api/leads', {
    headers: { Authorization: `Bearer ${token}` },
  })), null);
});
