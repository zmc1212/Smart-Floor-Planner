import assert from 'node:assert/strict';
import test from 'node:test';
import * as jose from 'jose';
import { authorizePlatformAdmin, getTenantContext } from '@/lib/auth';

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
    mustChangePassword: false,
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

test('authorizePlatformAdmin admits super_admin and admin, rejects other admin roles', async () => {
  const signAdmin = (role: string, enterpriseId: string | null) =>
    new jose.SignJWT({ id: '42', username: 'u', role, enterpriseId })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secret);

  const superAdmin = await authorizePlatformAdmin(new Request('http://localhost/api/admin-users', {
    headers: { Authorization: `Bearer ${await signAdmin('super_admin', null)}` },
  }));
  assert.equal(superAdmin, null);

  const platformAdmin = await authorizePlatformAdmin(new Request('http://localhost/api/admin-users', {
    headers: { Authorization: `Bearer ${await signAdmin('admin', null)}` },
  }));
  assert.equal(platformAdmin, null);

  const enterpriseAdmin = await authorizePlatformAdmin(new Request('http://localhost/api/admin-users', {
    headers: { Authorization: `Bearer ${await signAdmin('enterprise_admin', '7')}` },
  }));
  assert.equal(enterpriseAdmin?.status, 403);
  assert.deepEqual(await enterpriseAdmin?.json(), { success: false, error: 'Forbidden' });
});

test('authorizePlatformAdmin rejects anonymous and Mini Program tokens', async () => {
  const anonymous = await authorizePlatformAdmin(new Request('http://localhost/api/admin-users'));
  assert.equal(anonymous?.status, 401);
  assert.deepEqual(await anonymous?.json(), { success: false, error: 'Unauthorized' });

  const miniToken = await new jose.SignJWT({
    id: '99',
    mode: 'staff',
    role: 'admin',
    contextVersion: 1,
    source: 'wechat',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('99')
    .setAudience('miniprogram')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(secret);

  const mini = await authorizePlatformAdmin(new Request('http://localhost/api/admin-users', {
    headers: { Authorization: `Bearer ${miniToken}` },
  }));
  assert.equal(mini?.status, 401);
});
