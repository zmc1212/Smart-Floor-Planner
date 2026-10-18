import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { closePostgresPool } from '@/lib/postgresql';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { signMiniProgramToken } from '@/lib/miniprogram-jwt';

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

test('malformed signed identity IDs are rejected before database resolution', async () => {
  const token = await signMiniProgramToken({
    sub: '1', id: '1', mode: 'staff', role: 'staff', staffRole: 'designer',
    enterpriseId: 'not-an-id', staffId: '2', contextVersion: 1, source: 'password',
  });
  assert.equal(await resolveMiniProgramContext(new Request('http://localhost:3006/api/leads', {
    headers: { Authorization: `Bearer ${token}` },
  })), null);
});
