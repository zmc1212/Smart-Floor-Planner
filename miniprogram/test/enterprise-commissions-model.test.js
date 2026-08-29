const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildGroups,
  buildPageData,
  money,
  statusMeta
} = require('../packages/business/enterprise-commissions/enterprise-commissions-model.js');

test('enterprise payout ledger groups by lead and keeps tenant totals unfiltered', () => {
  const payload = {
    enterpriseName: '家客来样板店',
    totals: { payable: '300.00', paid: '80.00', voided: '20.00' },
    items: [
      { id: '1', leadId: '11', customerLabel: '李女士', role: 'referrer', roleLabel: '推荐人', beneficiaryLabel: '老周', amount: '100', status: 'payable', source: 'referral' },
      { id: '2', leadId: '11', customerLabel: '李女士', role: 'designer', roleLabel: '家装设计顾问', beneficiaryLabel: '小美', amount: '120', status: 'payable', source: 'referral' },
      { id: '3', leadId: '11', customerLabel: '李女士', role: 'measurer', roleLabel: '家装现场顾问', beneficiaryLabel: '阿强', amount: '80', status: 'paid', source: 'referral' },
      { id: '4', leadId: '22', customerLabel: '王先生', role: 'designer', roleLabel: '家装设计顾问', beneficiaryLabel: '小美', amount: '80', status: 'payable', source: 'staff_activity' }
    ]
  };

  const all = buildPageData(payload, 'all');
  assert.equal(all.payableTotal, '¥300.00');
  assert.equal(all.paidTotal, '¥80.00');
  assert.equal(all.voidedTotal, '¥20.00');
  assert.equal(all.groups.length, 2);
  assert.deepEqual(all.groups[0].items.map((item) => item.role), ['referrer', 'designer', 'measurer']);
  assert.equal(all.groups[0].canMarkGroup, true);
  assert.equal(all.groups[0].payableIds, '1,2');
  assert.equal(all.groups[0].payableAmountLabel, '¥220.00');
  assert.equal(all.groups[0].markGroupLabel, '确认本单 2 笔付款');
  assert.equal(all.groups[1].sourceLabel, '员工活动');
  assert.equal(all.groups[1].canMarkGroup, false);
  assert.equal(all.groups[1].items[0].canMarkPaid, true);
  assert.equal(all.groups[1].items[0].requiresQuickLedger, false);

  const payable = buildPageData(payload, 'payable');
  assert.equal(payable.groups.length, 2);
  assert.equal(payable.groups[0].items.length, 2);
  assert.equal(payable.sectionTitle, '待确认付款');
  assert.equal(payable.visibleItemCount, 3);
  assert.equal(payable.payableTotal, '¥300.00');
});

test('enterprise payout money and status labels stay aligned with admin copy', () => {
  assert.equal(money(12), '¥12.00');
  assert.deepEqual(statusMeta('payable'), { label: '待支付', tone: 'payable' });
  assert.deepEqual(statusMeta('paid'), { label: '已支付', tone: 'paid' });
  assert.deepEqual(statusMeta('voided'), { label: '已作废', tone: 'voided' });
  assert.deepEqual(buildGroups([], 'all'), []);
});

test('zero-amount payable rows require quick ledger input and cannot be bypassed in a batch', () => {
  const zeroPayable = buildPageData({ items: [{
    id: 'zero', leadId: 'lead-zero', customerLabel: '王女士', role: 'referrer', roleLabel: '推荐人', beneficiaryLabel: '小周', amount: '0.00', status: 'payable', source: 'referral'
  }, {
    id: 'positive', leadId: 'lead-zero', customerLabel: '王女士', role: 'designer', roleLabel: '家装设计顾问', beneficiaryLabel: '小陈', amount: '20.00', status: 'payable', source: 'referral'
  }] }, 'all');
  assert.equal(zeroPayable.items[0].requiresQuickLedger, true);
  assert.equal(zeroPayable.groups[0].canMarkGroup, false);
  assert.equal(zeroPayable.groups[0].markGroupLabel, '');
});
