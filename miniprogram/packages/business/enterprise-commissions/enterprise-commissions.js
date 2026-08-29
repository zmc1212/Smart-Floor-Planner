const api = require('../../../utils/api.js');
const { buildPageData } = require('./enterprise-commissions-model.js');
const {
  DEFAULT_PAGE_SIZE,
  appendQuery,
  parsePagination,
  mergePage,
  listFooterText,
} = require('../../../utils/list-pagination.js');

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

Page({
  data: {
    navigationTop: 24,
    navigationHeight: 32,
    navigationRight: 96,
    loading: true,
    error: '',
    enterpriseName: '',
    filters: [],
    filter: 'all',
    items: [],
    groups: [],
    totals: { payable: '0.00', paid: '0.00', voided: '0.00' },
    payableTotal: '¥0.00',
    paidTotal: '¥0.00',
    voidedTotal: '¥0.00',
    page: 1,
    hasMore: false,
    loadingMore: false,
    footerText: ''
  },

  onLoad() {
    this.setData(navigationMetrics());
    this.load({ reset: true });
  },

  onShow() {
    const tabBar = typeof this.getTabBar === 'function' && this.getTabBar();
    if (tabBar && typeof tabBar.syncSelected === 'function') tabBar.syncSelected();
    this.load({ reset: true });
  },

  onReachBottom() {
    this.load({ reset: false });
  },

  selectFilter(event) {
    const filter = event.currentTarget.dataset.filter || 'all';
    if (filter === this.data.filter) return;
    this.setData({
      filter,
      items: [],
      groups: [],
      page: 1,
    }, () => this.load({ reset: true }));
  },

  async load(options) {
    const reset = !options || options.reset !== false;
    if (this._fetching) return;
    if (!reset && (this.data.loadingMore || !this.data.hasMore)) return;
    this._fetching = true;
    const page = reset ? 1 : Number(this.data.page || 1);
    if (reset) this.setData({ loading: true, error: '', loadingMore: false });
    else this.setData({ loadingMore: true, footerText: listFooterText(true, true, this.data.items.length) });
    try {
      const result = await api.request(appendQuery('/miniprogram/enterprise-commissions', {
        status: this.data.filter === 'all' ? '' : this.data.filter,
        page,
        limit: DEFAULT_PAGE_SIZE,
      }), 'GET');
      const payload = result.data || {};
      const items = mergePage(this.data.items, payload.items || [], reset);
      const pagination = parsePagination(payload);
      this.setData({
        loading: false,
        loadingMore: false,
        error: '',
        page: page + 1,
        hasMore: pagination.hasMore,
        footerText: listFooterText(false, pagination.hasMore, items.length),
        ...buildPageData({ ...payload, items }, this.data.filter)
      });
    } catch (error) {
      this.setData({
        loading: false,
        loadingMore: false,
        error: reset ? (error.message || error.error || '暂时无法读取提成台账') : this.data.error,
        footerText: listFooterText(false, this.data.hasMore, reset ? 0 : this.data.items.length)
      });
    } finally {
      this._fetching = false;
    }
  },

  async handlePaymentCompleted() {
    await this.load({ reset: true });
    await this.refreshBadges();
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
