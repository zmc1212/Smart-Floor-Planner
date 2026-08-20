import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { appointmentToDto, parseAppointmentLocation } from '@/lib/appointment-api';

test('appointment address updates resolve Mini Program staff identity before Admin JWT', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../app/api/appointments/[id]/address/route.ts'),
    'utf8'
  );
  const miniIndex = source.indexOf('resolveMiniProgramContext(request)');
  const adminIndex = source.indexOf('getTenantContext(request)');
  assert.ok(miniIndex >= 0 && adminIndex >= 0 && miniIndex < adminIndex);
  assert.match(source, /miniContext\.staff\._id/);
  assert.match(source, /appointment\.measurerId === staffId/);
});

test('measurer calendar appointment DTO includes the assigned customer contact only when supplied', () => {
  const record = {
    id: BigInt(1),
    enterpriseId: BigInt(2),
    leadId: BigInt(3),
    designerId: BigInt(4),
    measurerId: BigInt(5),
    address: '未记录小区 111',
    timeRange: '["2026-08-20T01:00:00.000Z","2026-08-20T02:00:00.000Z")',
    status: 'confirmed',
    version: 1,
    updatedByUserId: null,
    createdAt: new Date('2026-08-19T00:00:00.000Z'),
    updatedAt: new Date('2026-08-19T00:00:00.000Z'),
  } as never;

  const dto = appointmentToDto(record, { name: '微信客户', phone: '15997671595' });
  assert.equal(dto.customerName, '微信客户');
  assert.equal(dto.customerPhone, '15997671595');
  assert.equal('customerPhone' in appointmentToDto(record), false);
  assert.equal(appointmentToDto(record).latitude, null);
});

test('appointment locations accept only bounded GCJ-02 coordinates', () => {
  assert.deepEqual(parseAppointmentLocation({
    locationName: '阳光花园', latitude: 23.1291, longitude: 113.2644, coordinateSystem: 'gcj02',
  }), {
    locationName: '阳光花园', latitude: '23.1291000', longitude: '113.2644000', coordinateSystem: 'gcj02',
  });
  assert.throws(() => parseAppointmentLocation({ latitude: 91, longitude: 113, coordinateSystem: 'gcj02' }));
  assert.throws(() => parseAppointmentLocation({ latitude: 23, longitude: 113, coordinateSystem: 'wgs84' }));
});
