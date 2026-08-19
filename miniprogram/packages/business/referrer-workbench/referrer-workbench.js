const api = require('../../../utils/api.js');
const session = require('../../../utils/session.js');

function navigationMetrics() {
  const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
  let menuRect = null;
  try {
    menuRect = wx.getMenuButtonBoundingClientRect();
  } catch (error) {
    menuRect = null;
  }
  const menuLeft = Number(menuRect && menuRect.left || windowInfo.windowWidth - 94);
  return {
    navigationTop: Number(menuRect && menuRect.top || windowInfo.statusBarHeight || 24),
    navigationHeight: Number(menuRect && menuRect.height || 32),
    navigationRight: Math.max(94, Number(windowInfo.windowWidth || 390) - menuLeft + 10),
  };
}

Page({
  data: {
    navigationTop: 24,
    navigationHeight: 32,
    navigationRight: 96,
    loading: true,
    exitingId: '',
    error: '',
    memberships: [],
    selectedMembershipId: '',
    switchingMembershipId: '',
    identityCount: 0,
  },

  onLoad() {
    this.setData(navigationMetrics());
    this.load();
  },

  async onShow() {
    if (this.data.selectedMembershipId) await this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const result = await api.request('/miniprogram/referrer-memberships', 'GET');
      let identityCount = 0;
      try {
        const identityResult = await api.request('/miniprogram/identity-contexts', 'GET');
        identityCount = Array.isArray(identityResult.contexts)
          ? new Set(identityResult.contexts.map((context) => context && context.mode).filter(Boolean)).size
          : 0;
      } catch (identityError) {
        // The promotion workbench remains usable when the optional switch list is temporarily unavailable.
        console.warn('Failed to read identity contexts for referrer workbench', identityError);
      }
      const memberships = (result.data || []).filter((item) => item.status === 'active');
      const app = typeof getApp === 'function' ? getApp() : null;
      const signedMembershipId = String(
        app && app.globalData && app.globalData.bootstrap && app.globalData.bootstrap.current
          && app.globalData.bootstrap.current.context && app.globalData.bootstrap.current.context.referrerMembershipId
          || ''
      );
      const selectedMembershipId = memberships.some((item) => item.id === signedMembershipId)
        ? signedMembershipId
        : memberships.some((item) => item.id === this.data.selectedMembershipId)
          ? this.data.selectedMembershipId
          : (memberships[0] && memberships[0].id) || '';
      this.setData({ memberships, selectedMembershipId, identityCount });
    } catch (error) {
      this.setData({ error: error.message || error.error || '暂时无法读取推广企业' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async selectMembership(event) {
    const membershipId = String(event.currentTarget.dataset.id || '');
    const membership = this.data.memberships.find((item) => item.id === membershipId);
    if (!membership || membershipId === this.data.selectedMembershipId || this.data.switchingMembershipId) return;

    const app = typeof getApp === 'function' ? getApp() : null;
    const oldToken = app && app.globalData && app.globalData.token;
    const oldUserInfo = app && app.globalData && app.globalData.userInfo;
    const oldBootstrap = app && app.globalData && app.globalData.bootstrap;
    this.setData({ switchingMembershipId: membershipId });
    try {
      const switched = await api.request('/miniprogram/identity-contexts/switch', 'POST', {
        mode: 'referrer',
        enterpriseId: membership.enterpriseId,
        referrerMembershipId: membership.id,
      });
      if (!switched.token) throw new Error('企业身份刷新失败');

      if (app && app.globalData) app.globalData.token = switched.token;
      wx.setStorageSync('token', switched.token);
      const refreshed = await api.request('/auth/miniprogram', 'POST', { type: 'refresh', token: switched.token });
      if (!refreshed.token || !refreshed.user) throw new Error('企业会话刷新失败');
      if (app && app.globalData) {
        app.globalData.token = refreshed.token;
        app.globalData.userInfo = refreshed.user;
        app.globalData.openid = refreshed.openid || refreshed.user.openid || null;
        app.globalData.sessionHydrated = false;
        app.globalData.bootstrap = null;
      }
      wx.setStorageSync('token', refreshed.token);
      wx.setStorageSync('userInfo', refreshed.user);
      if (refreshed.openid) wx.setStorageSync('openid', refreshed.openid);
      if (app && typeof app.hydrateStoredSession === 'function') await app.hydrateStoredSession();
      this.setData({ selectedMembershipId: membershipId });
      wx.showToast({ title: '已切换推广企业', icon: 'success' });
    } catch (error) {
      if (app && app.globalData) {
        app.globalData.token = oldToken;
        app.globalData.userInfo = oldUserInfo;
        app.globalData.bootstrap = oldBootstrap;
      }
      if (oldToken) wx.setStorageSync('token', oldToken);
      wx.showToast({ title: error.message || error.error || '切换失败，请重试', icon: 'none' });
    } finally {
      this.setData({ switchingMembershipId: '' });
    }
  },

  showServiceCode() {
    const membershipId = this.data.selectedMembershipId;
    if (!membershipId) return;
    wx.navigateTo({
      url: `/packages/business/promotion-service-code/promotion-service-code?membershipId=${encodeURIComponent(membershipId)}`,
    });
  },

  openProgress() {
    wx.navigateTo({ url: '/packages/business/referrer-progress/referrer-progress' });
  },

  openEarnings() {
    wx.navigateTo({ url: '/packages/business/referrer-earnings/referrer-earnings' });
  },

  onOpenIdentitySwitch() {
    wx.navigateTo({ url: '/packages/business/identity-switch/identity-switch' });
  },

  onLogout() {
    session.confirmLogout();
  },

  leaveSelectedEnterprise() {
    const membershipId = this.data.selectedMembershipId;
    if (!membershipId || this.data.exitingId) return;
    const selected = this.data.memberships.find((item) => item.id === membershipId);
    wx.showModal({
      title: '退出推广企业',
      content: `退出后将无法继续展示${selected && selected.enterpriseName ? '该企业的' : ''}服务码，历史服务记录不受影响。`,
      confirmText: '确认退出',
      confirmColor: '#D14343',
      success: async (modalResult) => {
        if (!modalResult.confirm) return;
        this.setData({ exitingId: membershipId });
        try {
          const result = await api.request(
            `/miniprogram/referrer-memberships/${encodeURIComponent(membershipId)}`,
            'DELETE'
          );
          if (result.token) {
            const app = getApp();
            app.globalData.token = result.token;
            wx.setStorageSync('token', result.token);
          }
          wx.showToast({ title: '已退出推广企业', icon: 'success' });
          await this.load();
        } catch (error) {
          wx.showToast({ title: error.message || error.error || '退出失败，请重试', icon: 'none' });
        } finally {
          this.setData({ exitingId: '' });
        }
      },
    });
  },
});
