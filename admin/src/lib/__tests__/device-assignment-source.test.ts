import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { normalizeDeviceBindingStatus } from '../device-binding-status';
import {
  compactDeviceIdentity,
  duplicateDeviceMessage,
  matchesDeviceSerialNumber,
  normalizeDeviceSerialNumber,
} from '../device-serial-number';

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
  assert.match(devicesPage, /serialNumber/);
  assert.match(devicesPage, /matchesDeviceSerialNumber/);
  assert.match(devicesPage, /支持部分匹配，可省略横线空格/);
  assert.match(devicesPage, /title: '归属企业'/);
  assert.match(devicesPage, /placeholder: '全部企业'/);
  assert.match(devicesPage, /params\.enterpriseId/);
  assert.match(devicesPage, /批量删除/);
  assert.match(devicesPage, /rowSelection/);
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

test('device serial numbers are optional, trimmed, and unique-error mapped', () => {
  assert.equal(normalizeDeviceSerialNumber(''), null);
  assert.equal(normalizeDeviceSerialNumber('  ld-12ab  '), 'LD-12AB');
  assert.throws(() => normalizeDeviceSerialNumber('x'.repeat(65)), /64/);
  assert.equal(compactDeviceIdentity('LD-12 AB'), 'LD12AB');
  assert.equal(matchesDeviceSerialNumber('LD-12-AB', '12 ab'), true);
  assert.equal(matchesDeviceSerialNumber('LD-12-AB', '99'), false);
  assert.equal(matchesDeviceSerialNumber(null, ''), true);
  assert.equal(
    duplicateDeviceMessage({ constraint: 'devices_serial_number_uidx' }),
    '设备 SN 码已存在'
  );
  assert.equal(
    duplicateDeviceMessage({ cause: { constraint: 'devices_code_uidx' } }, { createCopy: true }),
    '设备编码已存在，请在列表中编辑该设备'
  );
  assert.equal(
    duplicateDeviceMessage({ constraint: 'devices_code_uidx' }, { enrollment: true }),
    '该设备已录入'
  );
});

test('verify-binding authorizes by enterprise ownership only', () => {
  assert.doesNotMatch(verifyBindingRoute, /assignedUsers/);
  assert.match(verifyBindingRoute, /matchedDevice\.enterpriseId !== staff\.enterpriseId/);
  assert.match(verifyBindingRoute, /未分配企业/);
  assert.match(verifyBindingRoute, /normalizeBleIdentity/);
  assert.match(verifyBindingRoute, /identitiesMatch/);
  assert.match(verifyBindingRoute, /advertisDataHex/);
  assert.match(verifyBindingRoute, /identitiesMatch\(reportedAdvertis, code\)/);
});

test('miniprogram device enroll is platform-admin only and rejects duplicate MAC codes', () => {
  assert.match(enrollRoute, /isPlatformAdmin/);
  assert.match(enrollRoute, /findByCode/);
  assert.match(enrollRoute, /normalizeDeviceBindingStatus/);
  assert.match(enrollRoute, /assignedUserId: null/);
  assert.match(enrollRoute, /parseDeviceCodes/);
  assert.match(enrollRoute, /body\.devices/);
  assert.match(enrollRoute, /serialNumber/);
  assert.match(enrollRoute, /DeviceAlreadyEnrolledError/);
  assert.match(enrollRoute, /该设备已录入/);
});

test('platform device collection delete is limited to 1-100 ids', () => {
  assert.match(deviceRoute, /export async function DELETE/);
  assert.match(deviceRoute, /请选择 1-100 台设备进行删除/);
  assert.match(deviceRoute, /ids: bigint\[\]/);
  assert.match(deviceRoute, /deleteMany/);
});
