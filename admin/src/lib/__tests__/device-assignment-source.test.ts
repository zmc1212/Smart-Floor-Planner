import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { normalizeDeviceBindingStatus } from '../device-binding-status';

const srcRoot = path.resolve(__dirname, '..', '..');
const staffRoute = fs.readFileSync(path.join(srcRoot, 'app', 'api', 'staff', 'route.ts'), 'utf8');
const deviceRoute = fs.readFileSync(path.join(srcRoot, 'app', 'api', 'devices', 'route.ts'), 'utf8');
const deviceDetailRoute = fs.readFileSync(path.join(srcRoot, 'app', 'api', 'devices', '[id]', 'route.ts'), 'utf8');
const transactionScope = fs.readFileSync(
  path.join(srcRoot, 'lib', 'postgres-request-scope.ts'),
  'utf8'
);

test('standalone devices can load standalone channel promoters without widening enterprise assignments', () => {
  assert.match(staffRoute, /scope === 'unassigned-promoters'/);
  assert.match(staffRoute, /roles: \['salesperson'\]/);
  assert.match(staffRoute, /withoutEnterprise: true/);
  assert.match(staffRoute, /roles: \['super_admin', 'admin'\]/);
  for (const route of [deviceRoute, deviceDetailRoute]) {
    assert.match(route, /assignedUser && enterpriseId !== assignedUser\.enterpriseId/);
    assert.match(route, /An unassigned device can only be assigned to staff without an enterprise/);
  }
});

test('platform administrators save standalone device assignments in platform scope', () => {
  assert.match(transactionScope, /withDevicePostgresTransaction/);
  assert.match(transactionScope, /if \(isPlatformRole\(context\.role\)\)/);
  assert.match(deviceRoute, /withDevicePostgresTransaction/);
  assert.match(deviceDetailRoute, /withDevicePostgresTransaction/);
});

test('a holder makes an otherwise idle device eligible for authorization', () => {
  assert.equal(normalizeDeviceBindingStatus('unassigned', true, false), 'assigned');
  assert.equal(normalizeDeviceBindingStatus('maintenance', true, false), 'maintenance');
  assert.equal(normalizeDeviceBindingStatus('assigned', false, false), 'unassigned');
});
