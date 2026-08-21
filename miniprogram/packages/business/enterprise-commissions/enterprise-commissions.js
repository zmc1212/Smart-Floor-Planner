const api = require('../../../utils/api.js');
const { buildPageData } = require('./enterprise-commissions-model.js');

function navigationMetrics() {
  const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
  let menuRect = null;
  try { menuRect = wx.getMenuButtonBoundingClientRect(); } catch (error) { menuRect = null; }
  const menuLeft = Number(menuRect && menuRect.left || windowInfo.windowWidth - 94);
  return {
    navigationTop: Number(menuRect && menuRect.top || windowInfo.statusBarHeight || 24),
    navigationHeight: Number(menuRect && menuRect.height || 32),
    navigationRight: Math.max(94, Number(windowInfo.windowWidth || 390) - menuLeft + 10)
  };
}

function parseIds(value) {
  return String(value || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

Page({
  data: {
    navigationTop: 24,
    navigationHeight: 32,
    navigationRight: 96,
    loading: true,
    error: '',
    paying: false,
    enterpriseName: '',
    filters: [],
    filter: 'all',
    items: [],
    groups: [],
    totals: { payable: '0.00', paid: '0.00', voided: '0.00' },
    payableTotal: '¥0.00',
    paidTotal: '¥0.00',
    voidedTotal: '¥0.00'
  },

  onLoad() {
    this.setData(navigationMetrics());
    this.load();
  },

  onShow() {
    const tabBar = typeof this.getTabBar === 'function' && this.getTabBar();
    if (tabBar && typeof tabBar.syncSelected === 'function') tabBar.syncSelected();
    this.load();
  },

  selectFilter(event) {
    const filter = event.currentTarget.dataset.filter || 'all';
    this.setData(buildPageData({
      enterpriseName: this.data.enterpriseName,
      totals: this.data.totals,
      items: this.data.items
    }, filter));
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const result = await api.request('/miniprogram/enterprise-commissions', 'GET');
      this.setData({
        loading: false,
        error: '',
        ...buildPageData(result.data || {}, this.data.filter)
      });
    } catch (error) {
      this.setData({
        loading: false,
        error: error.message || error.error || '暂时无法读取提成台账'
      });
    }
  },

  markPaid(event) {
    const ids = parseIds(event.currentTarget.dataset.ids || event.currentTarget.dataset.id);
    if (!ids.length || this.data.paying) return;
    wx.showModal({
      title: '确认标记已支付',
      content: `确认已在线下完成这 ${ids.length} 条提成的支付吗？该操作会保留付款审计。`,
      confirmText: '已线下打款',
      cancelText: '取消',
      success: (modal) => {
        if (modal.confirm) this.submitMarkPaid(ids);
      }
    });
  },

  async submitMarkPaid(ids) {
    if (this.data.paying) return;
    this.setData({ paying: true });
    try {
      await api.request('/miniprogram/enterprise-commissions/mark-paid', 'POST', { commissionIds: ids });
      wx.showToast({ title: '已标记为已支付', icon: 'success' });
      await this.load();
      await this.refreshBadges();
    } catch (error) {
      wx.showToast({
        title: error.message || error.error || '标记支付失败',
        icon: 'none'
      });
    } finally {
      this.setData({ paying: false });
    }
  },

  async refreshBadges() {
    try {
      const app = getApp();
      const bootstrap = await api.request('/miniprogram/bootstrap', 'GET');
      if (!app || !bootstrap || !bootstrap.current) return;
      app.globalData.bootstrap = bootstrap;
      if (typeof app.refreshCustomTabBar === 'function') app.refreshCustomTabBar();
    } catch (error) {
      // List already reloaded; badge refresh can wait for the next session hydrate.
    }
  },

  backToOperations() {
    wx.reLaunch({ url: '/pages/index/index' });
  }
});
