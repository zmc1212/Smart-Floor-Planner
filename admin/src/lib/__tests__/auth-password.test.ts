import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const authPasswordRoute = fs.readFileSync(
  path.resolve(__dirname, '../../app/api/auth/password/route.ts'),
  'utf8'
);
const loginPasswordModal = fs.readFileSync(
  path.resolve(__dirname, '../../components/admin/login-password-settings-modal.tsx'),
  'utf8'
);
const accountSettingsProvider = fs.readFileSync(
  path.resolve(__dirname, '../../components/admin/account-settings-provider.tsx'),
  'utf8'
);
const antdProvider = fs.readFileSync(
  path.resolve(__dirname, '../../components/admin/antd-provider.tsx'),
  'utf8'
);

test('PUT /api/auth/password uses cookie JWT auth inside handler', () => {
  assert.match(authPasswordRoute, /export async function PUT/);
  assert.match(authPasswordRoute, /getTenantContext\(request\)/);
  assert.match(authPasswordRoute, /未登录/);
  assert.match(authPasswordRoute, /passwordHash/);
});

test('login password modal posts to admin auth password endpoint', () => {
  assert.match(loginPasswordModal, /\/api\/auth\/password/);
  assert.match(loginPasswordModal, /currentPassword/);
  assert.match(loginPasswordModal, /newPassword/);
  assert.match(loginPasswordModal, /confirmPassword/);
});

test('account settings provider is mounted under admin shell', () => {
  assert.match(antdProvider, /AccountSettingsProvider/);
  assert.match(accountSettingsProvider, /openLoginPassword/);
});
