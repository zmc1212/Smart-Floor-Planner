const api = require('./api.js');

const IDENTITY_LABELS = {
  customer: '个人用户身份',
  referrer: '推荐人身份',
  staff: '员工身份'
};

async function readIdentityState(page) {
  try {
    const result = await api.request('/miniprogram/identity-contexts', 'GET');
    const current = result.current || {};
    const detail = current.mode === 'staff'
      ? (current.staffDisplayName || current.enterpriseName || '')
      : (current.enterpriseName || '个人');
    page.setData({
      identityLabel: `${IDENTITY_LABELS[current.mode] || '当前身份'}${detail ? ` · ${detail}` : ''}`,
      identityCount: (result.contexts || []).length
    });
    return result;
  } catch (error) {
    page.setData({ identityLabel: '读取失败', identityCount: 0 });
    return null;
  }
}

async function refreshAccountSettingsState(page) {
  return readIdentityState(page);
}

module.exports = {
  readIdentityState,
  refreshAccountSettingsState
};
