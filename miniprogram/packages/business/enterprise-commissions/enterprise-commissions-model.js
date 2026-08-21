const FILTERS = Object.freeze([
  { label: '全部', value: 'all' },
  { label: '待支付', value: 'payable' },
  { label: '已支付', value: 'paid' },
  { label: '已作废', value: 'voided' }
]);

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
    canMarkPaid: item.status === 'payable',
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
    return {
      ...group,
      items: group.items.slice().sort((left, right) => (
        (ROLE_ORDER[left.role] ?? 9) - (ROLE_ORDER[right.role] ?? 9)
      )),
      payableIds: payableItems.map((item) => item.id).join(','),
      canMarkGroup: payableItems.length > 1,
      markGroupLabel: payableItems.length > 1 ? `本单 ${payableItems.length} 笔全部确认` : ''
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
  return {
    enterpriseName: (payload && payload.enterpriseName) || '',
    filters: FILTERS,
    filter,
    items,
    groups: buildGroups(items, filter),
    totals,
    ...formatTotals(totals)
  };
}

module.exports = {
  FILTERS,
  buildGroups,
  buildPageData,
  decorateItem,
  formatTotals,
  money,
  statusMeta
};
