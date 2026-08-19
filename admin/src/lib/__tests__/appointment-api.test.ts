import assert from 'node:assert/strict';
import test from 'node:test';
import { appointmentToDto } from '@/lib/appointment-api';

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
});
