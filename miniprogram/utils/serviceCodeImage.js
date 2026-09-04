const api = require('./api.js');

let imageSequence = 0;

function imageExtension(data) {
  if (!(data instanceof ArrayBuffer)) return '';
  const bytes = new Uint8Array(data);
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return 'png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpg';
  return '';
}

function imageResponseError(response) {
  const data = response && response.data;
  if (data instanceof ArrayBuffer && data.byteLength <= 16384) {
    try {
      const payload = JSON.parse(String.fromCharCode.apply(null, new Uint8Array(data)));
      if (payload && typeof payload.code === 'string') return payload;
    } catch (error) {
      // Keep the existing presenter error state for non-JSON responses.
    }
  }
  return new Error('服务码图片响应无效');
}

function removeServiceCodeImage(filePath) {
  const root = `${wx.env.USER_DATA_PATH}/`;
  if (typeof filePath !== 'string' || !filePath.startsWith(root)) return;
  if (!/^service-code-[A-Za-z0-9_-]+\.(png|jpg)$/.test(filePath.slice(root.length))) return;
  wx.getFileSystemManager().unlink({ filePath, fail() {} });
}

function fetchServiceCodeImage({ endpoint, fileKey, isCurrent }) {
  const token = getApp().globalData.token || wx.getStorageSync('token');
  const nonce = `${Date.now()}-${++imageSequence}`;
  const safeKey = String(fileKey).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${api.getBaseUrls()[0]}${endpoint}?cache=${nonce}`,
      method: 'GET',
      timeout: 30000,
      responseType: 'arraybuffer',
      header: { Authorization: token ? `Bearer ${token}` : '' },
      success(response) {
        if (!isCurrent()) { resolve(''); return; }
        const extension = imageExtension(response.data);
        if (response.statusCode < 200 || response.statusCode >= 300 || !extension) {
          reject(imageResponseError(response));
          return;
        }
        // A new native image src avoids decoded-image caches of an overwritten file.
        const filePath = `${wx.env.USER_DATA_PATH}/service-code-${safeKey}-${nonce}.${extension}`;
        wx.getFileSystemManager().writeFile({
          filePath,
          data: response.data,
          success() {
            if (!isCurrent()) {
              removeServiceCodeImage(filePath);
              resolve('');
              return;
            }
            resolve(filePath);
          },
          fail(error) { removeServiceCodeImage(filePath); reject(error); }
        });
      },
      fail: reject
    });
  });
}

module.exports = { fetchServiceCodeImage, removeServiceCodeImage };
