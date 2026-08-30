const API_BASE_URLS = Object.freeze({
  // local: 'http://192.168.10.111:3006/api',
  local: 'http://124.70.90.30:9966/api',
  production: 'https://smartfloor.zlyun168.com/api',
});

// Switch this value before building or previewing the Mini Program.
// `local` targets the development machine and is intended for WeChat Developer Tools.
const ACTIVE_API_ENVIRONMENT = 'local';

let isShowingAuthModal = false;
const session = require('./session.js');

function handleUnauthorized(url, token) {
  console.warn(`Unauthorized request to ${url}, clearing session. Token present: ${!!token}`);
  session.clearSession();

  const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
  const currentPage = pages[pages.length - 1];
  const isLoginPage = currentPage && currentPage.route === 'packages/business/login/login';
  if (isLoginPage || isShowingAuthModal) return;

  isShowingAuthModal = true;
  wx.showModal({
    title: '登录已过期',
    content: '您的登录信息已过期或无效，请重新登录。',
    showCancel: true,
    confirmText: '去登录',
    cancelText: '取消',
    success: (modalRes) => {
      if (modalRes.confirm) session.goToLogin();
    },
    complete: () => {
      isShowingAuthModal = false;
    }
  });
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || '').replace(/\/+$/, '');
}

function getBaseUrls(environment = ACTIVE_API_ENVIRONMENT) {
  const baseUrl = normalizeBaseUrl(API_BASE_URLS[environment]);

  if (!baseUrl) {
    throw new Error(`Unknown Mini Program API environment: ${environment}`);
  }

  // Do not fall back to another environment. A failed local request must not
  // accidentally read or mutate production data.
  return [baseUrl];
}

/**
 * Enhanced request method with JWT support
 */
function request(url, method = 'GET', data = {}, options = {}) {
  const app = getApp();
  // Prefer in-memory token from globalData to avoid storage latency
  const token = (app && app.globalData && app.globalData.token) || wx.getStorageSync('token');
  const baseUrls = getBaseUrls();
  
  return new Promise((resolve, reject) => {
    const send = (baseIndex) => {
      const baseUrl = baseUrls[baseIndex];

      if (!baseUrl) {
        reject({ error: 'Missing API base URL' });
        return;
      }

      wx.request({
        url: `${baseUrl}${url}`,
        method,
        data,
        timeout: options.timeout || 30000,
        header: {
          'content-type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : '',
          ...(options.headers || {})
        },
        success: (res) => {
          if (res.statusCode === 401) {
            if (!options.suppressUnauthorized) handleUnauthorized(url, token);
            const payload = res.data && typeof res.data === 'object' ? res.data : {};
            reject({
              ...payload,
              error: payload.error || 'Unauthorized',
              statusCode: 401,
            });
            return;
          }

          if (res.statusCode >= 200 && res.statusCode < 300 && res.data.success) {
            resolve(res.data);
          } else {
            const payload = res.data && typeof res.data === 'object' ? res.data : {};
            reject({
              ...payload,
              error: payload.error || 'Request failed',
              statusCode: res.statusCode,
            });
          }
        },
        fail: (err) => {
          if (baseIndex < baseUrls.length - 1) {
            console.warn(`Request to ${baseUrl}${url} failed, retrying next API base:`, err);
            send(baseIndex + 1);
            return;
          }

          reject(err);
        }
      });
    };

    send(0);
  });
}

// Some WeChat DevTools builds retain the module's callable export shape during
// hot reload. Keep the canonical method available on that shape as well, so
// existing `api.request(...)` consumers remain valid.
request.request = request;

function downloadFile(url, options = {}) {
  const app = getApp();
  const token = (app && app.globalData && app.globalData.token) || wx.getStorageSync('token');
  const baseUrl = getBaseUrls()[0];
  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url: `${baseUrl}${url}`,
      timeout: options.timeout || 60000,
      header: {
        Authorization: token ? `Bearer ${token}` : '',
        ...(options.headers || {})
      },
      success(res) {
        if (res.statusCode === 401) {
          if (!options.suppressUnauthorized) handleUnauthorized(url, token);
          reject({ error: '登录已过期，请重新登录', statusCode: 401 });
          return;
        }
        if (res.statusCode >= 200 && res.statusCode < 300 && res.tempFilePath) {
          resolve(res);
          return;
        }
        reject({ error: '文件下载失败', statusCode: res.statusCode });
      },
      fail: reject
    });
  });
}

function uploadStaffWechatQr(filePath) {
  const app = getApp();
  const token = (app && app.globalData && app.globalData.token) || wx.getStorageSync('token');
  const baseUrl = getBaseUrls()[0];
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: `${baseUrl}/miniprogram/staff/wechat-qr`,
      filePath,
      name: 'file',
      timeout: 30000,
      header: { Authorization: token ? `Bearer ${token}` : '' },
      success(res) {
        let payload = null;
        try {
          payload = JSON.parse(res.data || '{}');
        } catch (error) {
          reject({ error: '二维码上传响应无法解析' });
          return;
        }
        if (res.statusCode === 401) {
          handleUnauthorized('/miniprogram/staff/wechat-qr', token);
          reject({ error: '登录已过期，请重新登录', statusCode: 401 });
          return;
        }
        if (res.statusCode >= 200 && res.statusCode < 300 && payload.success) {
          resolve(payload);
          return;
        }
        reject(payload || { error: '二维码上传失败' });
      },
      fail(err) {
        reject({ error: '二维码上传失败', errMsg: err && err.errMsg });
      }
    });
  });
}

function uploadProfileAvatar(filePath) {
  const app = getApp();
  const token = (app && app.globalData && app.globalData.token) || wx.getStorageSync('token');
  const baseUrl = getBaseUrls()[0];
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: `${baseUrl}/miniprogram/profile/avatar`,
      filePath,
      name: 'file',
      timeout: 30000,
      header: { Authorization: token ? `Bearer ${token}` : '' },
      success(res) {
        let payload = null;
        try {
          payload = JSON.parse(res.data || '{}');
        } catch (error) {
          reject({ error: '头像上传响应无法解析' });
          return;
        }
        if (res.statusCode === 401) {
          handleUnauthorized('/miniprogram/profile/avatar', token);
          reject({ error: '登录已过期，请重新登录', statusCode: 401 });
          return;
        }
        if (res.statusCode >= 200 && res.statusCode < 300 && payload.success) {
          resolve(payload);
          return;
        }
        reject(payload || { error: '头像上传失败' });
      },
      fail: reject
    });
  });
}

/**
 * Phone number quick login using unified auth endpoint
 */
function phoneLogin(phoneCode) {
  const app = getApp();
  return new Promise((resolve, reject) => {
    wx.login({
      success: async (loginRes) => {
        if (loginRes.code) {
          try {
            const result = await request('/auth/miniprogram', 'POST', {
              type: 'wechat_phone',
              loginCode: loginRes.code,
              phoneCode: phoneCode,
              referral: app ? app.globalData.referral : {}
            });
            
            if (result.success && result.token) {
              if (app && app.globalData) {
                app.globalData.token = result.token;
                app.globalData.userInfo = result.user;
                app.globalData.openid = result.openid || (result.user && result.user.openid);
              }
              wx.setStorageSync('token', result.token);
              wx.setStorageSync('userInfo', result.user);
              if (result.openid) wx.setStorageSync('openid', result.openid);
            }
            resolve(result);
          } catch (err) {
            console.error('Phone login failed:', err);
            reject(err);
          }
        } else {
          reject(new Error('wx.login failed: ' + loginRes.errMsg));
        }
      },
      fail: reject
    });
  });
}

/**
 * Account/Password login using unified auth endpoint
 */
async function passwordLogin(username, password) {
  const app = getApp();
  try {
    const result = await request('/auth/miniprogram', 'POST', {
      type: 'password',
      username,
      password,
      referral: app ? app.globalData.referral : {}
    }, { suppressUnauthorized: true });

    if (result.success && result.token) {
      if (app && app.globalData) {
        app.globalData.token = result.token;
        app.globalData.userInfo = result.user;
      }
      wx.setStorageSync('token', result.token);
      wx.setStorageSync('userInfo', result.user);
    }
    return result;
  } catch (err) {
    console.error('Password login failed:', err);
    throw err;
  }
}

module.exports = {
  request,
  downloadFile,
  getBaseUrls,
  ACTIVE_API_ENVIRONMENT,
  API_BASE_URLS,
  uploadProfileAvatar,
  uploadStaffWechatQr,
  phoneLogin,
  passwordLogin
};
