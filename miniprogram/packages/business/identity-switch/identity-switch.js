const api = require('../../../utils/api.js');
const { navigateToRoleLanding } = require('../../../utils/identity-navigation.js');

const MODE_LABELS = { customer: '个人用户', referrer: '推荐人', staff: '员工' };
const ROLE_LABELS = {
  enterprise_admin: '企业负责人',
  designer: '家装设计顾问',
  measurer: '家装现场顾问',
  salesperson: '地推人员',
  platform_admin: '平台管理员'
};
const IDENTITY_ICONS = {
  customer: '/packages/business/assets/identity-switch/customer.png',
  referrer: '/packages/business/assets/identity-switch/referrer.png',
  enterprise_admin: '/packages/business/assets/identity-switch/enterprise-admin.png',
  designer: '/packages/business/assets/identity-switch/designer.png',
  measurer: '/packages/business/assets/identity-switch/measurer.png',
  salesperson: '/packages/business/assets/identity-switch/salesperson.png',
  platform_admin: '/packages/business/assets/identity-switch/platform-admin.png'
};

function resolveIdentityIcon(context) {
  const key = context.mode === 'staff' ? context.staffRole : context.mode;
  return IDENTITY_ICONS[key] || IDENTITY_ICONS.customer;
}

function contextKey(context) {
  return [context && context.mode, context && context.enterpriseId, context && context.staffId, context && context.referrerMembershipId]
    .filter(Boolean)
    .join(':');
}

function sameContext(left, right) {
  return Boolean(left && right
    && left.mode === right.mode
    && String(left.enterpriseId || '') === String(right.enterpriseId || '')
    && String(left.staffId || '') === String(right.staffId || '')
    && String(left.referrerMembershipId || '') === String(right.referrerMembershipId || ''));
}

function decorateContext(context, current, selected) {
  const role = context.mode === 'staff' ? (ROLE_LABELS[context.staffRole] || context.staffRole || '员工') : MODE_LABELS[context.mode];
  return {
    ...context,
    modeLabel: MODE_LABELS[context.mode] || '身份',
    roleLabel: role,
    icon: resolveIdentityIcon(context),
    title: context.mode === 'staff' ? (context.staffDisplayName || role) : (context.enterpriseName || role),
    detail: context.mode === 'staff'
      ? [role, context.enterpriseName].filter(Boolean).join(' · ')
      : context.mode === 'referrer'
        ? [role, context.enterpriseName].filter(Boolean).join(' · ')
        : '查看个人客户项目与服务进度',
    current: sameContext(context, current),
    selected: sameContext(context, selected),
    contextKey: contextKey(context)
  };
}

function errorMessage(error, fallback) {
  const message = error && (error.error || error.message);
  if (message === 'Unauthorized' || message === 'UNAUTHORIZED') return '登录状态已失效，请重新进入小程序';
  return message || fallback;
}

Page({
  data: {
    loading: true,
    switchingKey: '',
    error: '',
    sessionExpired: false,
    contexts: [],
    selectedContext: null
  },
  onLoad() { this.load(); },
  presentSelection(selection) {
    const rawContexts = this._rawContexts || [];
    const current = this._currentContext;
    const activeSelection = rawContexts.find((context) => sameContext(context, selection)) || current || rawContexts[0];
    const contexts = rawContexts.map((context) => decorateContext(context, current, activeSelection));
    const selectedContext = contexts.find((context) => context.selected) || null;
    this.setData({
      contexts,
      selectedContext
    });
  },
  async load() {
    this.setData({ loading: true, error: '', sessionExpired: false });
    try {
      const result = await api.request('/miniprogram/identity-contexts', 'GET');
      this._rawContexts = result.contexts || [];
      this._currentContext = result.current;
      this.presentSelection(result.current);
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
    if (!context || this.data.switchingKey) return;
    this.presentSelection(context);
  },
  confirmSelectedIdentity() {
    const context = this.data.selectedContext;
    if (!context || context.current || this.data.switchingKey) return;
    wx.showModal({
      title: `切换为${context.modeLabel}身份`,
      content: `切换后将进入${context.title}对应的工作区域。`,
      confirmText: '确认切换',
      success: async (result) => { if (result.confirm) await this.switchIdentity(context); }
    });
  },
  async switchIdentity(context) {
    const key = contextKey(context);
    const app = getApp();
    const oldToken = (app && app.globalData && app.globalData.token) || wx.getStorageSync('token');
    const oldSession = app && app.globalData ? {
      userInfo: app.globalData.userInfo,
      openid: app.globalData.openid,
      bootstrap: app.globalData.bootstrap
    } : null;
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
      app.globalData.sessionHydrated = false;
      await app.hydrateStoredSession();
      if (app.globalData.sessionRecovery) throw new Error('身份已失效，请重新选择');
      wx.showToast({ title: '身份已切换', icon: 'success' });
      setTimeout(() => navigateToRoleLanding({
        ...app.globalData.userInfo,
        ...(app.globalData.bootstrap && app.globalData.bootstrap.current || {}),
        // Keep the approved referrer landing explicit for older DevTools builds.
        landingPath: (app.globalData.bootstrap && app.globalData.bootstrap.current && app.globalData.bootstrap.current.landingPath)
          || (context.mode === 'referrer' ? '/packages/business/referrer-workbench/referrer-workbench' : '/pages/mine/mine')
      }), 500);
    } catch (error) {
      if (app && app.globalData && !app.globalData.sessionRecovery) {
        app.globalData.token = oldToken;
        app.globalData.userInfo = oldSession && oldSession.userInfo;
        app.globalData.openid = oldSession && oldSession.openid;
        app.globalData.bootstrap = oldSession && oldSession.bootstrap;
        if (oldToken) wx.setStorageSync('token', oldToken);
        if (oldSession && oldSession.userInfo) wx.setStorageSync('userInfo', oldSession.userInfo);
      }
      wx.showToast({ title: errorMessage(error, '身份切换失败'), icon: 'none' });
    } finally {
      this.setData({ switchingKey: '' });
    }
  }
});
