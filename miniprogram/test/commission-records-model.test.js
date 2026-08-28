const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildPageData,
  buildSummary,
  filterRecords,
  formatDate,
  formatMoney,
  normalizeRecords
} = require('../packages/business/commission-records/commission-records-model.js');

test('Commission records format money and dates deterministically', () => {
  assert.equal(formatMoney(12680), '12,680.00');
  assert.equal(formatMoney('1540.5'), '1,540.50');
  assert.equal(formatMoney('invalid'), '0.00');
  assert.equal(formatDate('2026-07-20T12:00:00'), '2026-07-20');
  assert.equal(formatDate('invalid'), '');
});

test('Commission summary uses real statuses and bounds the current month', () => {
  const records = [
    { status: 'pending_settlement', commissionAmount: 1000, generatedAt: '2026-08-01T12:00:00' },
    { status: 'pending_settlement', commissionAmount: 250.5, generatedAt: '2026-07-31T12:00:00' },
    { status: 'paid', commissionAmount: 800, generatedAt: '2026-08-02T08:00:00' },
    { status: 'voided', commissionAmount: 999, generatedAt: '2026-09-01T08:00:00' }
  ];

  assert.deepEqual(buildSummary(records, new Date(2026, 7, 2, 12)), {
    pendingCount: 2,
    pendingAmount: 1250.5,
    paidCount: 1,
    monthCount: 2,
    pendingAmountText: '1,250.50',
    pendingAmountInteger: '1,250',
    pendingAmountDecimal: '50'
  });
});

test('Commission filters keep truthful fields and stable row dividers', () => {
  const records = normalizeRecords([
    {
      _id: 'pending-1',
      status: 'pending_settlement',
      commissionType: 'fixed_per_paid_order',
      commissionAmount: 2860,
      generatedAt: '2026-07-20T12:00:00',
      orderId: { packageName: '武树 · 现代简约' }
    },
    {
      _id: 'paid-1',
      status: 'paid',
      commissionType: 'fixed_per_paid_order',
      commissionAmount: 1540,
      generatedAt: '2026-05-19T12:00:00',
      orderId: null
    },
    {
      _id: 'paid-2',
      status: 'paid',
      commissionType: 'fixed_per_paid_order',
      commissionAmount: 3920,
      generatedAt: '2026-05-18T12:00:00',
      orderId: { packageName: '新中式' }
    }
  ]);

  const paidRecords = filterRecords(records, 'paid');
  assert.equal(paidRecords.length, 2);
  assert.equal(paidRecords[0].showDivider, true);
  assert.equal(paidRecords[1].showDivider, false);
  assert.equal(paidRecords[0].statusLabel, '已结算');
  assert.equal(paidRecords[0].packageName, '企业订单');
  assert.equal(records[0].typeLabel, '成交提成');
  assert.equal(records[0].amountText, '2,860.00');
});

test('Commission page data filters the decorated records without changing the summary', () => {
  const pageData = buildPageData([
    { _id: '1', status: 'pending_settlement', commissionAmount: 100 },
    { _id: '2', status: 'paid', commissionAmount: 200 },
    { _id: '3', status: 'voided', commissionAmount: 300 }
  ], 'voided', new Date(2026, 7, 2, 12));

  assert.equal(pageData.records.length, 3);
  assert.equal(pageData.filteredRecords.length, 1);
  assert.equal(pageData.filteredRecords[0].key, '3');
  assert.equal(pageData.summary.pendingAmountText, '100.00');
});

test('Commercial commission records expose lead and designer context', () => {
  const [record] = normalizeRecords([{
    _id: 'commercial-1',
    leadId: { _id: 'lead-1', name: '李先生' },
    designerId: { _id: 'designer-1', displayName: '王设计' },
    status: 'pending_settlement',
    commissionAmount: 88,
    generatedAt: '2026-08-03T10:00:00Z'
  }]);
  assert.equal(record.leadName, '李先生');
  assert.equal(record.designerName, '王设计');
  assert.equal(record.amountText, '88.00');
  assert.equal(record.statusTone, 'pending');
});

test('API summary uses COUNT totals instead of the current page', () => {
  const { formatApiSummary } = require('../packages/business/commission-records/commission-records-model.js');
  const summary = formatApiSummary({
    pending: { amount: 1250.5, count: 12 },
    paid: { count: 8 },
    monthCount: 4
  });
  assert.equal(summary.pendingCount, 12);
  assert.equal(summary.pendingAmountText, '1,250.50');
  assert.equal(summary.paidCount, 8);
  assert.equal(summary.monthCount, 4);
});
