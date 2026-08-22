function getAuthToken() {
  const app = getApp();
  return (app && app.globalData && app.globalData.token) || wx.getStorageSync('token') || '';
}

function customerProjectFromApiResponse(response) {
  if (!response || typeof response !== 'object') return {};
  const payload = response.data;
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return payload;
  }
  return response;
}

function hasDesignerContact(designer) {
  if (!designer) return false;
  return Boolean(String(designer.wechatId || '').trim() || designer.wechatQrUrl);
}

function designerShortcutDescription(designer) {
  if (!designer) return '设计师匹配后可联系';
  if (designer.wechatQrUrl) return '扫码添加微信好友';
  if (String(designer.wechatId || '').trim()) return '微信号可复制联系';
  return '设计师匹配后可联系';
}

function loadDesignerQrToTempFile(url, cacheKey) {
  const token = getAuthToken();
  const separator = String(url).includes('?') ? '&' : '?';
  const safeKey = String(cacheKey || 'designer-qr').replace(/[^a-zA-Z0-9_-]/g, '') || 'designer-qr';
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${url}${separator}clientCacheKey=${Date.now()}`,
      method: 'GET',
      responseType: 'arraybuffer',
      header: { Authorization: token ? `Bearer ${token}` : '' },
      success(response) {
        if (response.statusCode < 200 || response.statusCode >= 300 || !response.data) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }
        const contentType = String(
          (response.header && (response.header['content-type'] || response.header['Content-Type'])) || ''
        ).toLowerCase();
        const extension = contentType.includes('png')
          ? 'png'
          : contentType.includes('jpeg') || contentType.includes('jpg')
            ? 'jpg'
            : 'png';
        const filePath = `${wx.env.USER_DATA_PATH}/designer-contact-${safeKey}.${extension}`;
        wx.getFileSystemManager().writeFile({
          filePath,
          data: response.data,
          success: () => resolve(filePath),
          fail: (error) => reject(error instanceof Error ? error : new Error((error && error.errMsg) || '二维码写入失败')),
        });
      },
      fail: (error) => reject(error instanceof Error ? error : new Error((error && error.errMsg) || '二维码读取失败')),
    });
  });
}

function copyDesignerWechatId(wechatId, options) {
  const id = String(wechatId || '').trim();
  if (!id) return Promise.reject(new Error('missing_wechat_id'));
  const withSearchHint = Boolean(options && options.withSearchHint);
  return new Promise((resolve, reject) => {
    wx.setClipboardData({
      data: id,
      success: () => {
        if (withSearchHint) {
          wx.showModal({
            title: '微信号已复制',
            content: '请打开微信，通过搜索添加设计师为好友。',
            showCancel: false,
            confirmText: '知道了',
          });
        } else {
          wx.showToast({ title: '微信号已复制', icon: 'success' });
        }
        resolve(id);
      },
      fail: (error) => reject(error instanceof Error ? error : new Error((error && error.errMsg) || '复制失败')),
    });
  });
}

module.exports = {
  customerProjectFromApiResponse,
  hasDesignerContact,
  designerShortcutDescription,
  loadDesignerQrToTempFile,
  copyDesignerWechatId,
};
