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

Page({
  data: {
    navigationTop: 24,
    navigationHeight: 32,
    navigationRight: 96,
    membershipId: '',
    promotionToken: '',
    qrImagePath: '',
    loading: true,
    errorMessage: ''
  },

  onLoad(options) {
    this.setData({
      ...navigationMetrics(),
      membershipId: String(options.membershipId || '').trim()
    });
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
    const membershipId = this.data.membershipId;
    if (!membershipId) {
      this.setData({ loading: false, errorMessage: '未找到可用的推广关系，请从推荐人工作台重新进入。' });
      return;
    }

    const requestId = (this.qrRequestId || 0) + 1;
    this.qrRequestId = requestId;
    const previousImage = this.data.qrImagePath;
    this.setData({ loading: true, errorMessage: '', qrImagePath: '', promotionToken: '' });
    removeServiceCodeImage(previousImage);
    try {
      const promotion = await api.request(`/miniprogram/referrer-memberships/${encodeURIComponent(membershipId)}/promotion-code`, 'GET');
      if (requestId !== this.qrRequestId) return;
      const qrImagePath = await this.fetchServiceCodeImage(membershipId, requestId);
      if (requestId !== this.qrRequestId) return;
      this.setData({
        loading: false,
        qrImagePath,
        promotionToken: promotion.data && promotion.data.token || ''
      });
    } catch (error) {
      if (requestId !== this.qrRequestId) return;
      this.setData({
        loading: false,
        qrImagePath: '',
        errorMessage: '服务码暂时无法生成，请检查网络后重试。'
      });
    }
  },

  fetchServiceCodeImage(membershipId, requestId) {
    return fetchServiceCodeImage({
      endpoint: `/miniprogram/referrer-memberships/${encodeURIComponent(membershipId)}/promotion-code/image`,
      fileKey: `promotion-${membershipId}`,
      isCurrent: () => requestId === this.qrRequestId
    });
  },

  onRetry() {
    this.loadServiceCode();
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
    const token = this.data.promotionToken;
    return {
      title: '免费上门测量与家装设计顾问服务',
      path: token
        ? `/packages/business/free-design-service/free-design-service?token=${encodeURIComponent(token)}`
        : '/pages/index/index'
    };
  }
});
