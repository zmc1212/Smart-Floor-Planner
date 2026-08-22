import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { getAdminRoleLabel } from '../admin-user-roles';
import {
  fetchCurrentUserJson,
  parseCurrentUserResponse,
  shouldRetryCurrentUserError,
} from '../current-user';

const root = path.resolve(__dirname, '../..');

test('401 /api/auth/me JSON does not resolve a current user', () => {
  assert.equal(
    parseCurrentUserResponse({ success: false, error: '未登录' }),
    null
  );
  assert.equal(
    parseCurrentUserResponse({
      success: true,
      data: { username: 'admin', role: 'admin', displayName: '平台管理员' },
    })?.username,
    'admin'
  );
});

test('unauthenticated current-user errors are not retried', () => {
  assert.equal(
    shouldRetryCurrentUserError(Object.assign(new Error('未登录'), { status: 401 })),
    false
  );
  assert.equal(shouldRetryCurrentUserError(new Error('network')), true);
});

test('unauthenticated /api/auth/me throws instead of caching success:false', async () => {
  const fetchImpl = async () =>
    new Response(JSON.stringify({ success: false, error: '未登录' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });

  await assert.rejects(
    () => fetchCurrentUserJson('/api/auth/me', fetchImpl as typeof fetch),
    (error: unknown) => {
      assert.equal((error as Error & { status?: number }).status, 401);
      return true;
    }
  );
});

test('platform admin role label is 平台管理员, not 职员', () => {
  assert.equal(getAdminRoleLabel('admin'), '平台管理员');
  assert.equal(getAdminRoleLabel('super_admin'), '超级管理员');
  assert.equal(getAdminRoleLabel('enterprise_admin'), '企业负责人');
  assert.equal(getAdminRoleLabel(undefined), '职员');
});

test('sidebar uses shared admin role labels', () => {
  const sidebar = fs.readFileSync(
    path.join(root, 'components/Sidebar.tsx'),
    'utf8'
  );
  assert.match(sidebar, /getAdminRoleLabel/);
  assert.doesNotMatch(sidebar, /function getRoleLabel/);
});

test('login replaces the page after success so stale /api/auth/me cache is dropped', () => {
  const loginPage = fs.readFileSync(
    path.join(root, 'app/login/page.tsx'),
    'utf8'
  );
  assert.match(loginPage, /window\.location\.(assign|href|replace)/);
  assert.doesNotMatch(loginPage, /router\.push\(['"]\/['"]\)/);
});

test('login antd shell does not mount account settings / current-user fetch', () => {
  const loginPage = fs.readFileSync(
    path.join(root, 'app/login/page.tsx'),
    'utf8'
  );
  const provider = fs.readFileSync(
    path.join(root, 'components/admin/antd-provider.tsx'),
    'utf8'
  );
  assert.match(loginPage, /includeAccountSettings=\{false\}/);
  assert.match(provider, /includeAccountSettings/);
});
