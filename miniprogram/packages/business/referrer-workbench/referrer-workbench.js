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
      const selectedMembershipId = memberships.some((item) => item.id === this.data.selectedMembershipId)
        ? this.data.selectedMembershipId
        : (memberships[0] && memberships[0].id) || '';
      this.setData({ memberships, selectedMembershipId, identityCount });
    } catch (error) {
      this.setData({ error: error.message || error.error || '暂时无法读取推广企业' });
    } finally {
      this.setData({ loading: false });
    }
  },

  selectMembership(event) {
    const membershipId = String(event.currentTarget.dataset.id || '');
    if (this.data.memberships.some((item) => item.id === membershipId)) {
      this.setData({ selectedMembershipId: membershipId });
    }
  },

  showServiceCode() {
    const membershipId = this.data.selectedMembershipId;
    if (!membershipId) return;
    wx.navigateTo({
      url: `/packages/business/promotion-service-code/promotion-service-code?membershipId=${encodeURIComponent(membershipId)}`,
    });
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
