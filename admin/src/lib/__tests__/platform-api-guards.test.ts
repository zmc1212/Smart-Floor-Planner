import assert from 'node:assert/strict';
import test from 'node:test';
import * as jose from 'jose';
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';
import { GET as listAdminUsers } from '@/app/api/admin-users/route';
import { GET as listUsers } from '@/app/api/users/route';

const secret = new TextEncoder().encode(process.env.JWT_SECRET || 'fallback_secret_random_123');

function signAdminToken(role: string, permissions: string[] = []) {
  return new jose.SignJWT({ id: '42', username: 'u', role, enterpriseId: null, permissions })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(secret);
}

function signMiniStaffToken() {
  return new jose.SignJWT({
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
}

function middlewareRequest(pathname: string, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost${pathname}`, { headers });
}

test('middleware rejects unverified Bearer requests instead of skipping permission checks', async () => {
  const response = await proxy(middlewareRequest('/api/admin-users', {
    Authorization: 'Bearer garbage-token',
  }));
  assert.equal(response.status, 401);
});

test('middleware still passes verified Mini Program staff tokens to shared routes', async () => {
  const token = await signMiniStaffToken();
  const response = await proxy(middlewareRequest('/api/leads/1/claim', {
    Authorization: `Bearer ${token}`,
  }));
  assert.equal(response.status, 200);
});

test('middleware maps /api/admin-users to the admins permission', async () => {
  const enterpriseAdminToken = await signAdminToken('enterprise_admin');
  const forbidden = await proxy(middlewareRequest('/api/admin-users', {
    cookie: `auth_token=${enterpriseAdminToken}`,
  }));
  assert.equal(forbidden.status, 403);

  const superAdminToken = await signAdminToken('super_admin');
  const allowed = await proxy(middlewareRequest('/api/admin-users', {
    cookie: `auth_token=${superAdminToken}`,
  }));
  assert.equal(allowed.status, 200);
});

test('admin-users and users APIs reject anonymous callers at the route level', async () => {
  const admins = await listAdminUsers(new Request('http://localhost/api/admin-users'));
  assert.equal(admins.status, 401);
  assert.deepEqual(await admins.json(), { success: false, error: 'Unauthorized' });

  const users = await listUsers(new Request('http://localhost/api/users'));
  assert.equal(users.status, 401);
  assert.deepEqual(await users.json(), { success: false, error: 'Unauthorized' });
});

test('admin-users and users APIs reject enterprise-scoped roles at the route level', async () => {
  const enterpriseAdminToken = await signAdminToken('enterprise_admin', ['dashboard']);
  const headers = { Authorization: `Bearer ${enterpriseAdminToken}` };

  const admins = await listAdminUsers(new Request('http://localhost/api/admin-users', { headers }));
  assert.equal(admins.status, 403);
  assert.deepEqual(await admins.json(), { success: false, error: 'Forbidden' });

  const users = await listUsers(new Request('http://localhost/api/users', { headers }));
  assert.equal(users.status, 403);
  assert.deepEqual(await users.json(), { success: false, error: 'Forbidden' });
});
