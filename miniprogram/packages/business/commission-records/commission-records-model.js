const FILTERS = Object.freeze([
  { label: '全部', value: 'all' },
  { label: '待结算', value: 'pending_settlement' },
  { label: '已结算', value: 'paid' },
  { label: '已作废', value: 'voided' }
]);

const STATUS_META = Object.freeze({
  pending_settlement: {
    label: '待结算',
    tone: 'pending',
    iconPath: '/packages/business/assets/commission-records/receipt-orange.png'
  },
  paid: {
    label: '已结算',
    tone: 'paid',
    iconPath: '/packages/business/assets/commission-records/receipt-green.png'
  },
  voided: {
    label: '已作废',
    tone: 'voided',
    iconPath: '/packages/business/assets/commission-records/receipt-gray.png'
  }
});

const COMMISSION_TYPE_LABELS = Object.freeze({
  fixed: '固定提成',
  percentage: '比例提成',
  fixed_per_paid_order: '成交提成'
});

function toAmount(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount : 0;
}

function formatMoney(value) {
  const amount = toAmount(value);
  const sign = amount < 0 ? '-' : '';
  const [integer, decimal] = Math.abs(amount).toFixed(2).split('.');
  const groupedInteger = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${groupedInteger}.${decimal}`;
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getCommissionTypeLabel(value) {
  return COMMISSION_TYPE_LABELS[value] || '提成记录';
}

function normalizeRecord(item, index) {
  const source = item || {};
  const statusMeta = STATUS_META[source.status] || {
    label: '状态待确认',
    tone: 'voided',
    iconPath: '/packages/business/assets/commission-records/receipt-gray.png'
  };
  const amountText = formatMoney(source.commissionAmount);
  const order = source.orderId && typeof source.orderId === 'object' ? source.orderId : {};
  const lead = source.leadId && typeof source.leadId === 'object' ? source.leadId : {};
  const designer = source.designerId && typeof source.designerId === 'object' ? source.designerId : {};

  return {
    ...source,
    key: String(source._id || source.id || `commission-${index}`),
    typeLabel: getCommissionTypeLabel(source.commissionType),
    statusLabel: statusMeta.label,
    statusTone: statusMeta.tone,
    iconPath: statusMeta.iconPath,
    amountText,
    leadName: lead.name || '',
    designerName: designer.displayName || designer.username || '',
    packageName: order.packageName || '企业订单',
    generatedAtText: formatDate(source.generatedAt) || '日期待确认',
    showDivider: false
  };
}

function normalizeRecords(records) {
  return (Array.isArray(records) ? records : []).map(normalizeRecord);
}

function filterRecords(records, activeStatus) {
  const filtered = activeStatus === 'all'
    ? records.slice()
    : records.filter((item) => item.status === activeStatus);

  return filtered.map((item, index) => ({
    ...item,
    showDivider: index < filtered.length - 1
  }));
}

function buildSummary(records, now = new Date()) {
  const current = now instanceof Date ? now : new Date(now);
  const monthStart = new Date(current.getFullYear(), current.getMonth(), 1).getTime();
  const nextMonthStart = new Date(current.getFullYear(), current.getMonth() + 1, 1).getTime();

  const summary = (Array.isArray(records) ? records : []).reduce(
    (result, item) => {
      const amount = toAmount(item.commissionAmount);
      const generatedAt = item.generatedAt ? new Date(item.generatedAt).getTime() : 0;

      if (item.status === 'pending_settlement') {
        result.pendingCount += 1;
        result.pendingAmount += amount;
      }
      if (item.status === 'paid') result.paidCount += 1;
      if (generatedAt >= monthStart && generatedAt < nextMonthStart) result.monthCount += 1;
      return result;
    },
    { pendingCount: 0, pendingAmount: 0, paidCount: 0, monthCount: 0 }
  );

  const pendingAmountText = formatMoney(summary.pendingAmount);
  const [pendingAmountInteger, pendingAmountDecimal] = pendingAmountText.split('.');

  return {
    ...summary,
    pendingAmountText,
    pendingAmountInteger,
    pendingAmountDecimal
  };
}

function buildPageData(rawRecords, activeStatus = 'all', now = new Date()) {
  const records = normalizeRecords(rawRecords);
  return {
    records,
    filteredRecords: filterRecords(records, activeStatus),
    summary: buildSummary(records, now)
  };
}

module.exports = {
  FILTERS,
  buildPageData,
  buildSummary,
  filterRecords,
  formatDate,
  formatMoney,
  getCommissionTypeLabel,
  normalizeRecords
};
