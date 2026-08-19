const { clearSession, goToLogin } = require('../../../utils/session.js');

const RECOVERY_COPY = {
  identity_context_invalid: {
    title: '当前身份已不可用',
    detail: '企业关系、成员状态或登录版本已变化。请重新登录后确认可用身份。'
  },
  signed_context_required: {
    title: '需要重新确认身份',
    detail: '旧会话无法确认当前权限。请重新登录后继续。'
  },
  default: {
    title: '身份确认未完成',
    detail: '暂时无法确认当前身份，请重新登录后继续。'
  }
};

Page({
  data: { title: '', detail: '' },
  onLoad(query) {
    const reason = String((query && query.reason) || '');
    const copy = RECOVERY_COPY[reason] || RECOVERY_COPY.default;
    this.setData(copy);
  },
  onRelogin() {
    clearSession();
    goToLogin();
  }
});
