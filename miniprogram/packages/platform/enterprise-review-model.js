const STATUS_CHIPS = [
  { key: 'pending_approval', label: '待审核' },
  { key: 'all', label: '全部' },
  { key: 'rejected', label: '已拒绝' },
  { key: 'disabled', label: '已停用' },
];

const STATUS_META = {
  pending_approval: { label: '待审核', tone: 'orange' },
  active: { label: '正常', tone: 'green' },
  rejected: { label: '已拒绝', tone: 'orange' },
  disabled: { label: '已停用', tone: 'gray' },
};

const ACTION_LABELS = {
  approve: '通过',
  reject: '拒绝',
  disable: '停用',
  enable: '启用',
  resubmit_review: '重新提交审核',
};

const REASON_ACTIONS = {
  reject: { title: '拒绝原因', confirm: '确认拒绝' },
  disable: { title: '停用原因', confirm: '确认停用' },
};

function contactName(item) {
  const person = item && item.contactPerson;
  return (person && person.name) || '';
}

function contactPhone(item) {
  const person = item && item.contactPerson;
  return (person && person.phone) || '';
}

function registrationLabel(mode) {
  return mode === 'self_service' ? '扫码自助' : '后台手工';
}

function formatDateTime(value) {
  if (!value) return '';
  return String(value).replace('T', ' ').slice(0, 16);
}

function statusMeta(status) {
  return STATUS_META[status] || { label: status || '未知', tone: 'gray' };
}

function validateReason(reason) {
  const trimmed = String(reason || '').trim();
  if (trimmed.length < 4 || trimmed.length > 200) {
    return { ok: false, message: '操作原因需为 4-200 个字符' };
  }
  return { ok: true, reason: trimmed };
}

function decorateEnterprise(item) {
  const meta = statusMeta(item.status);
  const phone = contactPhone(item);
  const name = contactName(item);
  return {
    ...item,
    statusLabel: meta.label,
    tone: meta.tone,
    registrationLabel: registrationLabel(item.registrationMode),
    contactName: name,
    contactPhone: phone,
    createdLabel: formatDateTime(item.createdAt),
    reasonLabel: item.statusReason || '',
    contactLine: [name, phone].filter(Boolean).join(' · ') || '未填写联系人',
    sourceLine: registrationLabel(item.registrationMode),
    canApprove: (item.allowedActions || []).includes('approve'),
    canReject: (item.allowedActions || []).includes('reject'),
    canDisable: (item.allowedActions || []).includes('disable'),
    canEnable: (item.allowedActions || []).includes('enable'),
    canResubmit: (item.allowedActions || []).includes('resubmit_review'),
  };
}

module.exports = {
  STATUS_CHIPS,
  ACTION_LABELS,
  REASON_ACTIONS,
  contactPhone,
  formatDateTime,
  validateReason,
  decorateEnterprise,
};
