const api = require('../../../utils/api.js');
const { navigateToRoleLanding } = require('../../../utils/identity-navigation.js');
const { fetchServiceCodeImage, removeServiceCodeImage } = require('../../../utils/serviceCodeImage.js');

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
    navigationRight: Math.max(94, Number(windowInfo.windowWidth || 390) - menuLeft + 10)
  };
}

function resolveActivityError(error) {
  const code = error && error.code;
  if (code === 'designer_profile_incomplete') {
    return {
      errorAction: 'profile',
      errorMessage: '请先补齐微信号和个人二维码，再生成活动码。'
    };
  }
  return {
    errorAction: 'retry',
    errorMessage: '服务码暂时无法生成，请检查网络后重试。'
  };
}

Page({
  data: {
    navigationTop: 24,
    navigationHeight: 32,
    navigationRight: 96,
    activityToken: '',
    enterpriseName: '',
    qrImagePath: '',
    loading: true,
    errorMessage: '',
    errorAction: 'retry'
  },

  onLoad() {
    this.setData(navigationMetrics());
  },

  onShow() {
    return this.loadServiceCode();
  },

  onHide() {
    this.qrRequestId = (this.qrRequestId || 0) + 1;
  },

  onUnload() {
    this.qrRequestId = (this.qrRequestId || 0) + 1;
    removeServiceCodeImage(this.data.qrImagePath);
  },

  async loadServiceCode() {
    const requestId = (this.qrRequestId || 0) + 1;
    this.qrRequestId = requestId;
    const previousImage = this.data.qrImagePath;
    this.setData({
      loading: true,
      errorMessage: '',
      errorAction: 'retry',
      qrImagePath: '',
      activityToken: ''
    });
    removeServiceCodeImage(previousImage);
    try {
      const activity = await api.request('/miniprogram/staff-activity-code', 'GET');
      if (requestId !== this.qrRequestId) return;
      const qrImagePath = await this.fetchServiceCodeImage(requestId);
      if (requestId !== this.qrRequestId) return;
      this.setData({
        loading: false,
        qrImagePath,
        activityToken: activity.data && activity.data.token || '',
        enterpriseName: activity.data && activity.data.enterpriseName || ''
      });
    } catch (error) {
      if (requestId !== this.qrRequestId) return;
      this.setData({
        loading: false,
        qrImagePath: '',
        ...resolveActivityError(error)
      });
    }
  },

  fetchServiceCodeImage(requestId) {
    return fetchServiceCodeImage({
      endpoint: '/miniprogram/staff-activity-code/image',
      fileKey: 'staff-activity',
      isCurrent: () => requestId === this.qrRequestId
    });
  },

  onRetry() {
    this.loadServiceCode();
  },

  onFixProfile() {
    wx.navigateTo({ url: '/packages/business/profile-edit/profile-edit' });
  },

  onBack() {
    const pages = getCurrentPages();
    if (pages && pages.length > 1) {
      wx.navigateBack({
        fail: () => this.leaveToRoleHome()
      });
      return;
    }
    this.leaveToRoleHome();
  },

  leaveToRoleHome() {
    const app = getApp();
    const identity = app && app.globalData && app.globalData.userInfo;
    if (!navigateToRoleLanding(identity)) {
      wx.switchTab({ url: '/pages/index/index' });
    }
  },

  onShareAppMessage() {
    const token = this.data.activityToken;
    return {
      title: '免费上门测量与家装设计顾问服务',
      path: token
        ? `/packages/business/free-design-service/free-design-service?token=${encodeURIComponent(token)}`
        : '/pages/index/index'
    };
  }
});
