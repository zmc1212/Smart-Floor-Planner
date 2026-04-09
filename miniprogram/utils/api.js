const BASE_URL = 'http://192.168.10.62:3000/api';

/**
 * Enhanced request method
 */
function request(url, method = 'GET', data = {}) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${BASE_URL}${url}`,
      method,
      data,
      header: {
        'content-type': 'application/json' // Default
      },
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300 && res.data.success) {
          resolve(res.data);
        } else {
          reject(res.data || { error: 'Request failed' });
        }
      },
      fail: (err) => {
        reject(err);
      }
    });
  });
}

/**
 * Handle WeChat login & get openid
 */
function wechatLogin() {
  return new Promise((resolve, reject) => {
    wx.login({
      success: async (res) => {
        if (res.code) {
          try {
            const loginRes = await request('/wechat/login', 'POST', { code: res.code });
            resolve(loginRes);
          } catch (err) {
            console.error('Backend login failed:', err);
            reject(err);
          }
        } else {
          reject(new Error('wx.login failed: ' + res.errMsg));
        }
      },
      fail: reject
    });
  });
}

module.exports = {
  request,
  wechatLogin
};
