const app = getApp();
const api = require('../../utils/api.js');
const {
  FILTERS,
  buildPageData,
  filterRecords
} = require('./commission-records-model.js');

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
    this.fetchData();
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
      filteredRecords: filterRecords(this.data.records, status)
    });
  },

  onRetry() {
    this.fetchData();
  },

  async fetchData() {
    const openid = app.globalData.openid || wx.getStorageSync('openid');
    const token = wx.getStorageSync('token');

    if (!openid && !token) {
      this.setData({
        loading: false,
        errorMessage: '登录状态已失效，请返回后重新进入'
      });
      return;
    }

    this.setData({ loading: true, errorMessage: '' });

    try {
      const response = await api.request('/commission-records', 'GET');
      const rawRecords = response && Array.isArray(response.data) ? response.data : [];
      const pageData = buildPageData(rawRecords, this.data.activeStatus);

      this.setData({
        ...pageData,
        loading: false,
        errorMessage: ''
      });
    } catch (error) {
      const errorMessage = error && error.error ? error.error : '提成记录加载失败，请重试';
      this.setData({ loading: false, errorMessage });
      wx.showToast({ title: errorMessage, icon: 'none' });
    }
  }
});
