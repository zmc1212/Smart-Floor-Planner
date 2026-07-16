const LOCAL_BASE_URL = 'http://localhost:3005/api';
const LAN_BASE_URL = 'http://192.168.10.19:3005/api';
// const PROD_BASE_URL = 'https://smartfloor.zlyun168.com/api';

let isShowingAuthModal = false;

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || '').replace(/\/+$/, '');
}

function getBaseUrls() {
  let customBaseUrl = '';
  try {
    customBaseUrl = wx.getStorageSync('apiBaseUrl') || '';
  } catch (err) {
    customBaseUrl = '';
  }

  const candidates = customBaseUrl
    ? [customBaseUrl]
    : [LOCAL_BASE_URL, LAN_BASE_URL];

  return candidates
    .map(normalizeBaseUrl)
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index);
}

/**
 * Enhanced request method with JWT support
 */
function request(url, method = 'GET', data = {}) {
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
      header: {
        'content-type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
      },
      success: (res) => {
        if (res.statusCode === 401) {
          console.warn(`Unauthorized request to ${url}, clearing session. Token present: ${!!token}`);
          if (token) {
            console.warn(`Token prefix: ${token.substring(0, 10)}...${token.substring(token.length - 10)}`);
          }
          
          if (app && app.globalData) {
            app.globalData.token = null;
            app.globalData.userInfo = null;
          }
          wx.removeStorageSync('token');
          wx.removeStorageSync('userInfo');
          
          const pages = getCurrentPages();
          const currentPage = pages[pages.length - 1];
          const isLoginPage = currentPage && currentPage.route === 'pages/login/login';

          if (!isLoginPage && !isShowingAuthModal) {
            isShowingAuthModal = true;
            wx.showModal({
              title: '登录已过期',
              content: '您的登录信息已过期或无效，请重新登录。',
              showCancel: true,
              confirmText: '去登录',
              cancelText: '取消',
              success: (modalRes) => {
                if (modalRes.confirm) {
                  wx.reLaunch({ url: '/pages/login/login' });
                }
              },
              complete: () => {
                isShowingAuthModal = false;
              }
            });
          }
          
          reject({ error: 'Unauthorized', statusCode: 401 });
          return;
        }

        if (res.statusCode >= 200 && res.statusCode < 300 && res.data.success) {
          resolve(res.data);
        } else {
          reject(res.data || { error: 'Request failed', statusCode: res.statusCode });
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
    });

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
  phoneLogin,
  passwordLogin
};
