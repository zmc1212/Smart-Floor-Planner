const FILTERS = Object.freeze([
  { label: '全部', value: 'all' },
  { label: '待支付', value: 'payable' },
  { label: '已支付', value: 'paid' },
  { label: '已作废', value: 'voided' }
]);

const SECTION_TITLES = Object.freeze({ all: '付款记录', payable: '待确认付款', paid: '已完成付款', voided: '已作废记录' });

const ROLE_ORDER = Object.freeze({
  referrer: 0,
  designer: 1,
  measurer: 2
});

function money(value) {
  return `¥${Number(value || 0).toFixed(2)}`;
}

function statusMeta(status) {
  return status === 'paid'
    ? { label: '已支付', tone: 'paid' }
    : status === 'voided'
      ? { label: '已作废', tone: 'voided' }
      : { label: '待支付', tone: 'payable' };
}

function decorateItem(item) {
  return {
    ...item,
    amountLabel: money(item.amount),
    statusMeta: statusMeta(item.status),
    canConfirmPayment: item.status === 'payable',
    sourceLabel: item.source === 'staff_activity' ? '员工活动' : '推荐网络'
  };
}

function buildGroups(items, filter) {
  const filtered = filter === 'all' ? items : items.filter((item) => item.status === filter);
  const groups = [];
  const indexByLead = new Map();
  for (const item of filtered) {
    let group = indexByLead.get(item.leadId);
    if (!group) {
      group = {
        leadId: item.leadId,
        customerLabel: item.customerLabel,
        sourceLabel: item.sourceLabel,
        items: []
      };
      indexByLead.set(item.leadId, group);
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups.map((group) => {
    const payableItems = group.items.filter((item) => item.status === 'payable');
    const payableAmount = payableItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    return {
      ...group,
      items: group.items.slice().sort((left, right) => (
        (ROLE_ORDER[left.role] ?? 9) - (ROLE_ORDER[right.role] ?? 9)
      )),
      payableCount: payableItems.length,
      payableAmountLabel: money(payableAmount)
    };
  });
}

function formatTotals(totals) {
  return {
    payableTotal: money(totals && totals.payable),
    paidTotal: money(totals && totals.paid),
    voidedTotal: money(totals && totals.voided)
  };
}

function buildPageData(payload, filter) {
  const items = (payload && payload.items || []).map(decorateItem);
  const totals = (payload && payload.totals) || {};
  const groups = buildGroups(items, filter);
  return {
    enterpriseName: (payload && payload.enterpriseName) || '',
    filters: FILTERS,
    filter,
    items,
    groups,
    sectionTitle: SECTION_TITLES[filter] || SECTION_TITLES.all,
    visibleItemCount: groups.reduce((count, group) => count + group.items.length, 0),
    payableCount: Number(payload && payload.payableCount || 0),
    totals,
    ...formatTotals(totals)
  };
}

module.exports = {
  FILTERS,
  SECTION_TITLES,
  buildGroups,
  buildPageData,
  decorateItem,
  formatTotals,
  money,
  statusMeta
};
