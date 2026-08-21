import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { normalizeDeviceBindingStatus } from '../device-binding-status';

const srcRoot = path.resolve(__dirname, '..', '..');
const deviceRoute = fs.readFileSync(path.join(srcRoot, 'app', 'api', 'devices', 'route.ts'), 'utf8');
const deviceDetailRoute = fs.readFileSync(path.join(srcRoot, 'app', 'api', 'devices', '[id]', 'route.ts'), 'utf8');
const devicesPage = fs.readFileSync(
  path.join(srcRoot, 'app', '(admin)', '(merchant)', 'devices', 'page.tsx'),
  'utf8'
);
const verifyBindingRoute = fs.readFileSync(
  path.join(srcRoot, 'app', 'api', 'devices', 'verify-binding', 'route.ts'),
  'utf8'
);
const enrollRoute = fs.readFileSync(
  path.join(srcRoot, 'app', 'api', 'miniprogram', 'devices', 'route.ts'),
  'utf8'
);
const transactionScope = fs.readFileSync(
  path.join(srcRoot, 'lib', 'postgres-request-scope.ts'),
  'utf8'
);

test('device writes are limited to platform administrators', () => {
  for (const route of [deviceRoute, deviceDetailRoute]) {
    assert.match(route, /WRITE_ROLES = \['super_admin', 'admin'\]/);
    assert.doesNotMatch(route, /assignedUserIds/);
  }
  assert.match(deviceRoute, /'enterprise_admin'/);
  assert.doesNotMatch(deviceDetailRoute, /enterprise_admin/);
});

test('platform administrators save devices in platform device scope', () => {
  assert.match(transactionScope, /withDevicePostgresTransaction/);
  assert.match(transactionScope, /if \(isPlatformRole\(context\.role\)\)/);
  assert.match(deviceRoute, /withDevicePostgresTransaction/);
  assert.match(deviceDetailRoute, /withDevicePostgresTransaction/);
});

test('admin devices page no longer binds staff users', () => {
  assert.doesNotMatch(devicesPage, /assignedUserIds/);
  assert.doesNotMatch(devicesPage, /绑定人员/);
  assert.match(devicesPage, /canManage = \['super_admin', 'admin'\]/);
  assert.match(devicesPage, /设备编码 \/ MAC/);
});

test('duplicate device codes return a business error instead of a raw query', () => {
  for (const route of [deviceRoute, deviceDetailRoute]) {
    assert.match(route, /details\.cause\?\.code/);
    assert.match(route, /code === '23505'/);
  }
});

test('enterprise ownership makes an otherwise idle device assigned', () => {
  assert.equal(normalizeDeviceBindingStatus('unassigned', true), 'assigned');
  assert.equal(normalizeDeviceBindingStatus('maintenance', true), 'maintenance');
  assert.equal(normalizeDeviceBindingStatus('assigned', false), 'unassigned');
});

test('verify-binding authorizes by enterprise ownership only', () => {
  assert.doesNotMatch(verifyBindingRoute, /assignedUsers/);
  assert.match(verifyBindingRoute, /matchedDevice\.enterpriseId !== staff\.enterpriseId/);
  assert.match(verifyBindingRoute, /未分配企业/);
});

test('miniprogram device enroll is platform-admin only and upserts by MAC code', () => {
  assert.match(enrollRoute, /isPlatformAdmin/);
  assert.match(enrollRoute, /findByCode/);
  assert.match(enrollRoute, /normalizeDeviceBindingStatus/);
  assert.match(enrollRoute, /assignedUserId: null/);
  assert.match(enrollRoute, /parseDeviceCodes/);
  assert.match(enrollRoute, /body\.devices/);
});
