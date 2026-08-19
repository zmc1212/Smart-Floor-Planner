const api = require('../../../utils/api.js');

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
    activityToken: '',
    enterpriseName: '',
    qrImagePath: '',
    loading: true,
    errorMessage: ''
  },

  onLoad() {
    this.setData(navigationMetrics());
    this.loadServiceCode();
  },

  onUnload() {
    this.qrRequestId = (this.qrRequestId || 0) + 1;
  },

  async loadServiceCode() {
    const requestId = (this.qrRequestId || 0) + 1;
    this.qrRequestId = requestId;
    this.setData({ loading: true, errorMessage: '', qrImagePath: '' });
    try {
      const [activity] = await Promise.all([
        api.request('/miniprogram/staff-activity-code', 'GET'),
        this.fetchServiceCodeImage(requestId)
      ]);
      if (requestId !== this.qrRequestId) return;
      this.setData({
        loading: false,
        activityToken: activity.data && activity.data.token || '',
        enterpriseName: activity.data && activity.data.enterpriseName || ''
      });
    } catch (error) {
      if (requestId !== this.qrRequestId) return;
      this.setData({
        loading: false,
        qrImagePath: '',
        errorMessage: '服务码暂时无法生成，请检查网络或确认微信号资料后重试。'
      });
    }
  },

  fetchServiceCodeImage(requestId) {
    const token = getApp().globalData.token || wx.getStorageSync('token');
    const baseUrl = api.getBaseUrls()[0];
    return new Promise((resolve, reject) => {
      wx.request({
        url: `${baseUrl}/miniprogram/staff-activity-code/image?cache=${Date.now()}`,
        method: 'GET',
        responseType: 'arraybuffer',
        header: { Authorization: token ? `Bearer ${token}` : '' },
        success: (response) => {
          if (response.statusCode < 200 || response.statusCode >= 300 || !(response.data instanceof ArrayBuffer)) {
            reject(new Error('服务码图片响应无效'));
            return;
          }
          const filePath = `${wx.env.USER_DATA_PATH}/staff-activity-code.png`;
          wx.getFileSystemManager().writeFile({
            filePath,
            data: response.data,
            success: () => {
              if (requestId === this.qrRequestId) this.setData({ qrImagePath: filePath });
              resolve(filePath);
            },
            fail: reject
          });
        },
        fail: reject
      });
    });
  },

  onRetry() {
    this.loadServiceCode();
  },

  onShareAppMessage() {
    const token = this.data.activityToken;
    return {
      title: '免费上门测量与设计师服务',
      path: token
        ? `/packages/business/free-design-service/free-design-service?token=${encodeURIComponent(token)}`
        : '/pages/index/index'
    };
  }
});
