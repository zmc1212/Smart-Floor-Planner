const api = require('../../../utils/api.js');
const { navigateToRoleLanding } = require('../../../utils/identity-navigation.js');

function navigationMetrics() {
  const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
  let menuRect = null;
  try {
    menuRect = wx.getMenuButtonBoundingClientRect();
  } catch (error) {
    menuRect = null;
  }
  const menuLeft = Number((menuRect && menuRect.left) || windowInfo.windowWidth - 94);
  return {
    navigationTop: Number((menuRect && menuRect.top) || windowInfo.statusBarHeight || 24),
    navigationHeight: Number((menuRect && menuRect.height) || 32),
    navigationRight: Math.max(94, Number(windowInfo.windowWidth || 390) - menuLeft + 10),
  };
}

function formatExpires(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', { hour12: false });
}

function parseImageError(response) {
  try {
    const bytes = response && response.data;
    if (!(bytes instanceof ArrayBuffer)) return null;
    const text = String.fromCharCode.apply(null, new Uint8Array(bytes));
    const payload = JSON.parse(text);
    if (payload && (payload.code || payload.error)) return payload;
  } catch (error) {
    return null;
  }
  return null;
}

Page({
  data: {
    navigationTop: 24,
    navigationHeight: 32,
    navigationRight: 96,
    loading: true,
    hasActive: true,
    qrImagePath: '',
    errorMessage: '',
    statusLine: '当前有效 · 未换新',
  },

  onLoad() {
    this.setData(navigationMetrics());
    this.load();
  },

  onBack() {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    if (pages.length > 1) {
      wx.navigateBack();
      return;
    }
    const app = getApp();
    const identity = (app && app.globalData && (app.globalData.userInfo || app.globalData.bootstrap)) || {};
    if (!navigateToRoleLanding(identity)) {
      wx.switchTab({ url: '/pages/mine/mine' });
    }
  },

  onRetry() {
    this.load();
  },

  async load() {
    this.qrRequestId = (this.qrRequestId || 0) + 1;
    const requestId = this.qrRequestId;
    this.setData({
      loading: true,
      errorMessage: '',
      qrImagePath: '',
      hasActive: true,
      statusLine: '当前有效 · 未换新',
    });
    try {
      const result = await api.request('/miniprogram/platform/enterprise-registration-code', 'GET');
      if (requestId !== this.qrRequestId) return;
      if (!result.success) {
        throw new Error(result.error || '开户码加载失败');
      }
      const code = result.data && result.data.code;
      if (!code) {
        this.setData({
          loading: false,
          hasActive: false,
          statusLine: '请先在后台生成开户码',
        });
        return;
      }
      const expiresLabel = formatExpires(code.expiresAt);
      this.setData({
        hasActive: true,
        statusLine: expiresLabel
          ? `当前有效 · 未换新 · ${expiresLabel} 前有效`
          : '当前有效 · 未换新',
      });
      await this.fetchCodeImage(requestId);
      if (requestId !== this.qrRequestId) return;
      this.setData({ loading: false });
    } catch (error) {
      if (requestId !== this.qrRequestId) return;
      this.setData({
        loading: false,
        errorMessage:
          (error && error.error) || error.message || '开户码加载失败，请检查网络后重试',
      });
    }
  },

  fetchCodeImage(requestId) {
    const token = getApp().globalData.token || wx.getStorageSync('token');
    const baseUrl = api.getBaseUrls()[0];
    return new Promise((resolve, reject) => {
      wx.request({
        url: `${baseUrl}/miniprogram/platform/enterprise-registration-code/image?cache=${Date.now()}`,
        method: 'GET',
        responseType: 'arraybuffer',
        header: { Authorization: token ? `Bearer ${token}` : '' },
        success: (response) => {
          if (requestId !== this.qrRequestId) {
            resolve('');
            return;
          }
          if (response.statusCode === 404) {
            this.setData({
              hasActive: false,
              qrImagePath: '',
              statusLine: '请先在后台生成开户码',
            });
            resolve('');
            return;
          }
          if (response.statusCode < 200 || response.statusCode >= 300 || !(response.data instanceof ArrayBuffer)) {
            const payload = parseImageError(response);
            reject(new Error((payload && payload.error) || '开户码图片响应无效'));
            return;
          }
          const filePath = `${wx.env.USER_DATA_PATH}/enterprise-registration-code.png`;
          wx.getFileSystemManager().writeFile({
            filePath,
            data: response.data,
            success: () => {
              if (requestId === this.qrRequestId) this.setData({ qrImagePath: filePath });
              resolve(filePath);
            },
            fail: reject,
          });
        },
        fail: reject,
      });
    });
  },
});
