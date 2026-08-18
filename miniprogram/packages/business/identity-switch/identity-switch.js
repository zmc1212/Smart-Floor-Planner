const api = require('../../../utils/api.js');
const { navigateToRoleLanding } = require('../../../utils/identity-navigation.js');

const MODE_LABELS = { customer: '客户', referrer: '推荐人', staff: '员工' };
const ROLE_LABELS = { enterprise_admin: '企业负责人', designer: '设计师', measurer: '测量员', salesperson: '地推人员' };

function sameContext(left, right) {
  return Boolean(left && right
    && left.mode === right.mode
    && String(left.enterpriseId || '') === String(right.enterpriseId || '')
    && String(left.staffId || '') === String(right.staffId || '')
    && String(left.referrerMembershipId || '') === String(right.referrerMembershipId || ''));
}

function decorateContext(context, current) {
  const role = context.mode === 'staff' ? (ROLE_LABELS[context.staffRole] || context.staffRole || '员工') : MODE_LABELS[context.mode];
  return {
    ...context,
    modeLabel: MODE_LABELS[context.mode] || '身份',
    title: context.mode === 'staff' ? (context.staffDisplayName || role) : (context.enterpriseName || role),
    detail: context.mode === 'staff'
      ? [role, context.enterpriseName].filter(Boolean).join(' · ')
      : context.mode === 'referrer'
        ? [role, context.enterpriseName].filter(Boolean).join(' · ')
        : '查看个人客户项目与服务进度',
    current: sameContext(context, current)
  };
}

function errorMessage(error, fallback) {
  const message = error && (error.error || error.message);
  if (message === 'Unauthorized' || message === 'UNAUTHORIZED') return '登录状态已失效，请重新进入小程序';
  return message || fallback;
}

Page({
  data: { loading: true, switchingKey: '', error: '', sessionExpired: false, contexts: [] },
  onLoad() { this.load(); },
  async load() {
    this.setData({ loading: true, error: '', sessionExpired: false });
    try {
      const result = await api.request('/miniprogram/identity-contexts', 'GET');
      this.setData({ contexts: (result.contexts || []).map((context) => decorateContext(context, result.current)) });
    } catch (error) {
      const rawMessage = error && (error.error || error.message);
      this.setData({
        error: errorMessage(error, '身份列表加载失败'),
        sessionExpired: rawMessage === 'Unauthorized' || rawMessage === 'UNAUTHORIZED'
      });
    } finally {
      this.setData({ loading: false });
    }
  },
  goToLogin() {
    wx.navigateTo({ url: '/packages/business/login/login' });
  },
  selectIdentity(event) {
    const context = event.currentTarget.dataset.context;
    if (!context || context.current || this.data.switchingKey) return;
    wx.showModal({
      title: `切换为${context.modeLabel}身份`,
      content: `切换后将进入${context.title}对应的工作区域。`,
      confirmText: '确认切换',
      success: async (result) => { if (result.confirm) await this.switchIdentity(context); }
    });
  },
  async switchIdentity(context) {
    const key = [context.mode, context.enterpriseId, context.staffId, context.referrerMembershipId].filter(Boolean).join(':');
    const app = getApp();
    const oldToken = (app && app.globalData && app.globalData.token) || wx.getStorageSync('token');
    this.setData({ switchingKey: key });
    try {
      const switched = await api.request('/miniprogram/identity-contexts/switch', 'POST', {
        mode: context.mode,
        enterpriseId: context.enterpriseId,
        staffId: context.staffId,
        referrerMembershipId: context.referrerMembershipId
      });
      if (!switched.token) throw new Error('身份令牌刷新失败');
      if (app && app.globalData) app.globalData.token = switched.token;
      wx.setStorageSync('token', switched.token);
      const refreshed = await api.request('/auth/miniprogram', 'POST', { type: 'refresh', token: switched.token });
      if (!refreshed.token || !refreshed.user) throw new Error('身份资料刷新失败');
      if (app && app.globalData) {
        app.globalData.token = refreshed.token;
        app.globalData.userInfo = refreshed.user;
        app.globalData.openid = refreshed.openid || refreshed.user.openid || null;
        app.globalData.referral = {
          enterpriseId: refreshed.user.enterpriseId || '',
          staffId: refreshed.user.staffId || ''
        };
      }
      wx.setStorageSync('token', refreshed.token);
      wx.setStorageSync('userInfo', refreshed.user);
      if (refreshed.openid) wx.setStorageSync('openid', refreshed.openid);
      wx.showToast({ title: '身份已切换', icon: 'success' });
      setTimeout(() => navigateToRoleLanding({
        ...context,
        // Keep the approved referrer landing explicit for older DevTools builds.
        landingPath: context.mode === 'referrer' ? '/packages/business/referrer-workbench/referrer-workbench' : '/pages/mine/mine'
      }), 500);
    } catch (error) {
      if (app && app.globalData) app.globalData.token = oldToken;
      if (oldToken) wx.setStorageSync('token', oldToken);
      wx.showToast({ title: errorMessage(error, '身份切换失败'), icon: 'none' });
    } finally {
      this.setData({ switchingKey: '' });
    }
  }
});
