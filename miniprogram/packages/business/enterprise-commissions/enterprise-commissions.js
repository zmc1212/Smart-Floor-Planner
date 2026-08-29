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

function parseIds(value) {
  return String(value || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

function normalizePaidAmount(value) {
  const amount = String(value || '').trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) return '';
  return amount;
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
    voidedTotal: '¥0.00',
    page: 1,
    hasMore: false,
    loadingMore: false,
    footerText: '',
    quickLedgerDialogVisible: false,
    quickLedgerCommissionId: '',
    quickLedgerAmount: '',
    quickLedgerError: ''
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

  markPaid(event) {
    const ids = parseIds(event.currentTarget.dataset.ids || event.currentTarget.dataset.id);
    if (!ids.length || this.data.paying) return;
    const isZeroAmountPayment = ids.length === 1 && this.data.items.some((item) => (
      String(item.id) === ids[0] && item.requiresQuickLedger
    ));
    if (isZeroAmountPayment) {
      this.promptZeroAmountPayment(ids[0]);
      return;
    }
    wx.showModal({
      title: '确认标记已支付',
      content: `确认已在线下完成这 ${ids.length} 条提成的支付吗？该操作会保留付款审计。`,
      confirmText: '确认付款',
      cancelText: '取消',
      success: (modal) => {
        if (modal.confirm) this.submitMarkPaid(ids);
      }
    });
  },

  promptZeroAmountPayment(commissionId) {
    this.setData({
      quickLedgerDialogVisible: true,
      quickLedgerCommissionId: commissionId,
      quickLedgerAmount: '',
      quickLedgerError: ''
    });
  },

  changeQuickLedgerAmount(event) {
    this.setData({ quickLedgerAmount: event.detail.value, quickLedgerError: '' });
  },

  cancelQuickLedger() {
    if (this.data.paying) return;
    this.setData({
      quickLedgerDialogVisible: false,
      quickLedgerCommissionId: '',
      quickLedgerAmount: '',
      quickLedgerError: ''
    });
  },

  stopDialogTap() {},

  confirmQuickLedger() {
    const paidAmount = normalizePaidAmount(this.data.quickLedgerAmount);
    if (!paidAmount) {
      this.setData({ quickLedgerError: '请输入大于 0 的金额，最多两位小数' });
      return;
    }
    const commissionId = this.data.quickLedgerCommissionId;
    this.setData({ quickLedgerDialogVisible: false, quickLedgerError: '' });
    this.submitZeroAmountPayment(commissionId, paidAmount);
  },

  async submitZeroAmountPayment(commissionId, paidAmount) {
    if (this.data.paying) return;
    this.setData({ paying: true });
    try {
      await api.request('/miniprogram/enterprise-commissions/record-zero-payment', 'POST', { commissionId, paidAmount });
      wx.showToast({ title: '已记账并标记为已支付', icon: 'success' });
      await this.load({ reset: true });
      await this.refreshBadges();
    } catch (error) {
      wx.showToast({ title: error.message || error.error || '快速记账失败', icon: 'none' });
    } finally {
      this.setData({ paying: false });
    }
  },

  async submitMarkPaid(ids) {
    if (this.data.paying) return;
    this.setData({ paying: true });
    try {
      await api.request('/miniprogram/enterprise-commissions/mark-paid', 'POST', { commissionIds: ids });
      wx.showToast({ title: '已标记为已支付', icon: 'success' });
      await this.load({ reset: true });
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
