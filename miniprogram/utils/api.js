const BASE_URL = 'http://192.168.10.62:3005/api';
// const BASE_URL = 'https://smartfloor.zlyun168.com/api';

/**
 * Enhanced request method with JWT support
 */
function request(url, method = 'GET', data = {}) {
  const token = wx.getStorageSync('token');
  
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${BASE_URL}${url}`,
      method,
      data,
      header: {
        'content-type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
      },
      success: (res) => {
        if (res.statusCode === 401) {
          console.warn('Unauthorized request, clearing token');
          wx.removeStorageSync('token');
          wx.removeStorageSync('userInfo');
          
          const pages = getCurrentPages();
          const currentPage = pages[pages.length - 1];
          const isLoginPage = currentPage && (currentPage.route === 'pages/login/login' || currentPage.route === 'pages/index/index');

          if (!isLoginPage && !global.isShowingAuthModal) {
            global.isShowingAuthModal = true;
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
                global.isShowingAuthModal = false;
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
        reject(err);
      }
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
              wx.setStorageSync('token', result.token);
              wx.setStorageSync('userInfo', result.user);
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
