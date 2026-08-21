import assert from 'node:assert/strict';
import test from 'node:test';
import * as jose from 'jose';
import { getTenantContext } from '@/lib/auth';

const secret = new TextEncoder().encode(process.env.JWT_SECRET || 'fallback_secret_random_123');

test('getTenantContext accepts Admin JWTs without a miniprogram audience', async () => {
  const token = await new jose.SignJWT({
    id: '42',
    username: 'designer',
    role: 'designer',
    enterpriseId: '7',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(secret);

  const context = await getTenantContext(new Request('http://localhost/api/test', {
    headers: { Authorization: `Bearer ${token}` },
  }));
  assert.deepEqual(context, {
    userId: '42',
    role: 'designer',
    enterpriseId: '7',
    username: 'designer',
  });
});

test('getTenantContext rejects Mini Program audience tokens even when role looks like staff', async () => {
  const token = await new jose.SignJWT({
    id: '99',
    mode: 'staff',
    role: 'designer',
    staffRole: 'designer',
    enterpriseId: '7',
    staffId: '42',
    contextVersion: 1,
    source: 'wechat',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('99')
    .setAudience('miniprogram')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(secret);

  const context = await getTenantContext(new Request('http://localhost/api/test', {
    headers: { Authorization: `Bearer ${token}` },
  }));
  assert.equal(context, null);
});
