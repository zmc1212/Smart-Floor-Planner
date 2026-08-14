import assert from 'node:assert/strict';
import test from 'node:test';
import { leadDtoForMini, POST as createLead } from '@/app/api/leads/route';
import {
  canMarkLeadConverted,
  canRevertLeadConversion,
  getLeadConversionActions,
  hasLeadConversionEnterpriseContext,
  isProtectedConversionStatusChange,
  parseConversionRevertReason,
  parseLeadConversionInput,
  redactLeadConversionDetailsForConsumer,
} from '@/lib/lead-conversion';

function lead(input: Partial<{
  assignedTo: bigint | null;
  archivedAt: Date | null;
  status: string;
}> = {}) {
  return {
    assignedTo: input.assignedTo ?? 8n,
    archivedAt: input.archivedAt ?? null,
    status: input.status ?? 'designing',
  };
}

test('enterprise managers can convert active leads and designers stay within assignment', () => {
  assert.equal(canMarkLeadConverted(lead(), 'enterprise_admin', 99n), true);
  assert.equal(canMarkLeadConverted(lead(), 'designer', 8n), true);
  assert.equal(canMarkLeadConverted(lead(), 'designer', 9n), false);
  assert.equal(canMarkLeadConverted(lead(), 'measurer', 8n), false);
  assert.equal(canMarkLeadConverted(lead({ archivedAt: new Date() }), 'enterprise_admin', 99n), false);
});

test('all supported open stages can convert while closed and converted cannot', () => {
  ['new', 'contacted', 'measuring', 'measured', 'assigned', 'designing', 'quoting'].forEach((status) => {
    assert.equal(canMarkLeadConverted(lead({ status }), 'enterprise_admin', 99n), true, status);
  });
  assert.equal(canMarkLeadConverted(lead({ status: 'converted' }), 'enterprise_admin', 99n), false);
  assert.equal(canMarkLeadConverted(lead({ status: 'closed' }), 'enterprise_admin', 99n), false);
});

test('only enterprise managers can revert a live converted lead', () => {
  assert.equal(canRevertLeadConversion(lead({ status: 'converted' }), 'enterprise_admin'), true);
  assert.equal(canRevertLeadConversion(lead({ status: 'converted' }), 'designer'), false);
  assert.deepEqual(getLeadConversionActions(lead({ status: 'converted' }), 'enterprise_admin', 1n), {
    canMarkConverted: false,
    canRevertConversion: true,
  });
});

test('conversion input requires a real non-future date and validates optional fields', () => {
  const parsed = parseLeadConversionInput({
    convertedOn: '2026-08-14',
    contractAmount: '128000.5',
    conversionNote: '客户已签署装修合同',
  });
  assert.deepEqual(parsed, {
    convertedOn: '2026-08-14',
    contractAmount: '128000.50',
    conversionNote: '客户已签署装修合同',
  });
  assert.throws(() => parseLeadConversionInput({ convertedOn: '2026-02-30' }), /有效的签约日期/);
  assert.throws(() => parseLeadConversionInput({ convertedOn: '2999-01-01' }), /不能晚于今天/);
  assert.throws(() => parseLeadConversionInput({ convertedOn: '2026-08-14', contractAmount: 0 }), /有效的正数/);
});

test('conversion status cannot be entered or left through generic updates', () => {
  assert.equal(isProtectedConversionStatusChange('designing', 'converted'), true);
  assert.equal(isProtectedConversionStatusChange('converted', 'designing'), true);
  assert.equal(isProtectedConversionStatusChange('measuring', 'designing'), false);
  assert.equal(parseConversionRevertReason({ reason: '客户合同尚未正式生效' }), '客户合同尚未正式生效');
  assert.throws(() => parseConversionRevertReason({ reason: ' ' }), /请填写撤销原因/);
});

test('lead creation rejects converted before authentication or persistence', async () => {
  const response = await createLead(new Request('http://localhost/api/leads', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '测试客户', phone: '13000000000', status: 'converted' }),
  }));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /专用签约操作/);
});

test('conversion requires an enterprise and consumer DTOs hide internal contract details', () => {
  assert.equal(hasLeadConversionEnterpriseContext(null, null), false);
  assert.equal(hasLeadConversionEnterpriseContext('7', null), true);
  assert.deepEqual(redactLeadConversionDetailsForConsumer({
    status: 'converted',
    convertedOn: '2026-08-14',
    convertedAt: new Date('2026-08-14T01:00:00Z'),
    convertedBy: { id: '9', displayName: '负责人' },
    contractAmount: 128000,
    conversionNote: '合同编号 001',
  }), {
    status: 'converted',
    convertedOn: '2026-08-14',
    convertedAt: null,
    convertedBy: null,
    contractAmount: null,
    conversionNote: null,
  });
});

test('Mini lead create/dedup responses redact conversion details for consumers', () => {
  const now = new Date('2026-08-14T01:00:00Z');
  const convertedLead = {
    id: 41n,
    enterpriseId: 7n,
    promoter: null,
    promoterId: null,
    assignedUser: null,
    assignedTo: null,
    name: '已签约客户',
    phone: '13000000000',
    communityName: null,
    area: null,
    stylePreference: null,
    city: null,
    source: 'miniprogram',
    status: 'converted',
    convertedOn: '2026-08-14',
    convertedAt: now,
    convertedUser: { id: 9n, displayName: '企业负责人', username: 'manager', role: 'enterprise_admin' },
    convertedBy: 9n,
    contractAmount: '128000.00',
    conversionNote: '内部合同备注',
    acquiredAt: null,
    acquiredBy: null,
    archivedAt: null,
    archivedUser: null,
    archivedBy: null,
    archiveReason: null,
    archiveNote: null,
    acquisitionCommission: null,
    notes: null,
    assignedAt: null,
    floorPlanRecords: [],
    primaryFloorPlanRecord: null,
    primaryFloorPlanId: null,
    followUpRecords: [],
    createdAt: now,
    updatedAt: now,
  } as Parameters<typeof leadDtoForMini>[1];

  for (const consumerRole of [undefined, 'user']) {
    const consumerDto = leadDtoForMini(
      new Request('http://localhost/api/leads'),
      convertedLead,
      consumerRole
    );
    assert.equal(consumerDto.status, 'converted');
    assert.equal(consumerDto.convertedOn, '2026-08-14');
    assert.equal(consumerDto.convertedAt, null);
    assert.equal(consumerDto.convertedBy, null);
    assert.equal(consumerDto.contractAmount, null);
    assert.equal(consumerDto.conversionNote, null);
  }

  const staffDto = leadDtoForMini(new Request('http://localhost/api/leads'), convertedLead, 'designer');
  assert.equal(staffDto.contractAmount, 128000);
  assert.equal(staffDto.conversionNote, '内部合同备注');
});
