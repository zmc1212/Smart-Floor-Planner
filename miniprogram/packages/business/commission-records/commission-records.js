const app = getApp();
const api = require('../../../utils/api.js');
const {
  FILTERS,
  formatApiSummary,
  normalizeRecords,
  withRowDividers
} = require('./commission-records-model.js');
const {
  DEFAULT_PAGE_SIZE,
  appendQuery,
  parsePagination,
  mergePage,
  listFooterText,
} = require('../../../utils/list-pagination.js');

function resolveNavigationMetrics() {
  const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
  const statusBarHeight = Number(windowInfo.statusBarHeight || 0);
  let menuButton = null;

  try {
    menuButton = wx.getMenuButtonBoundingClientRect();
  } catch (error) {
    menuButton = null;
  }

  const navContentHeight = menuButton && menuButton.height
    ? Math.max(44, (menuButton.top - statusBarHeight) * 2 + menuButton.height)
    : 44;

  return {
    statusBarHeight,
    navBarHeightTotal: statusBarHeight + navContentHeight
  };
}

Page({
  data: {
    ...resolveNavigationMetrics(),
    filters: FILTERS,
    loadingRows: [1, 2, 3],
    activeStatus: 'all',
    records: [],
    filteredRecords: [],
    loading: true,
    errorMessage: '',
    totalCount: 0,
    page: 1,
    hasMore: false,
    loadingMore: false,
    footerText: '',
    summary: {
      pendingCount: 0,
      pendingAmount: 0,
      pendingAmountText: '0.00',
      pendingAmountInteger: '0',
      pendingAmountDecimal: '00',
      paidCount: 0,
      monthCount: 0
    }
  },

  onShow() {
    this.fetchData({ reset: true });
  },

  onBack() {
    wx.navigateBack({
      delta: 1,
      fail: () => {
        wx.switchTab({ url: '/pages/mine/mine' });
      }
    });
  },

  onFilterTap(event) {
    const status = event.currentTarget.dataset.status;
    if (!FILTERS.some((item) => item.value === status) || status === this.data.activeStatus) {
      return;
    }

    this.setData({
      activeStatus: status,
      records: [],
      filteredRecords: [],
      page: 1,
    }, () => this.fetchData({ reset: true }));
  },

  onRetry() {
    this.fetchData({ reset: true });
  },

  onLoadMore() {
    this.fetchData({ reset: false });
  },

  async fetchData(options) {
    const reset = !options || options.reset !== false;
    const openid = app.globalData.openid || wx.getStorageSync('openid');
    const token = wx.getStorageSync('token');

    if (!openid && !token) {
      this.setData({
        loading: false,
        errorMessage: '登录状态已失效，请返回后重新进入'
      });
      return;
    }

    if (this._fetching) return;
    if (!reset && (this.data.loadingMore || !this.data.hasMore)) return;
    this._fetching = true;
    const page = reset ? 1 : Number(this.data.page || 1);
    if (reset) this.setData({ loading: true, errorMessage: '', loadingMore: false });
    else this.setData({ loadingMore: true, footerText: listFooterText(true, true, this.data.filteredRecords.length) });

    try {
      const response = await api.request(appendQuery('/commission-records', {
        status: this.data.activeStatus === 'all' ? '' : this.data.activeStatus,
        page,
        limit: DEFAULT_PAGE_SIZE,
      }), 'GET');
      const rawRecords = response && Array.isArray(response.data) ? response.data : [];
      const records = mergePage(this.data.records, normalizeRecords(rawRecords), reset);
      const pagination = parsePagination(response);
      const summary = formatApiSummary(response && response.summary);
      this.setData({
        records,
        filteredRecords: withRowDividers(records),
        summary,
        totalCount: pagination.total,
        page: page + 1,
        hasMore: pagination.hasMore,
        footerText: listFooterText(false, pagination.hasMore, records.length),
        loading: false,
        loadingMore: false,
        errorMessage: ''
      });
    } catch (error) {
      const errorMessage = error && error.error ? error.error : '提成记录加载失败，请重试';
      this.setData({
        loading: false,
        loadingMore: false,
        errorMessage: reset ? errorMessage : this.data.errorMessage,
        footerText: listFooterText(false, this.data.hasMore, reset ? 0 : this.data.filteredRecords.length)
      });
      if (reset) wx.showToast({ title: errorMessage, icon: 'none' });
    } finally {
      this._fetching = false;
    }
  }
});
