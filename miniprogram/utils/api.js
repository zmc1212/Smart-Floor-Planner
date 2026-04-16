const BASE_URL = 'http://192.168.10.62:3002/api';

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
 * Phone number quick login.
 * 1. Call wx.login() to get loginCode (for openid)
 * 2. Send loginCode + phoneCode to backend
 * 3. Backend returns openid + user info
 */
function phoneLogin(phoneCode) {
  return new Promise((resolve, reject) => {
    wx.login({
      success: async (loginRes) => {
        if (loginRes.code) {
          try {
            const result = await request('/wechat/phone', 'POST', {
              loginCode: loginRes.code,
              phoneCode: phoneCode
            });
            resolve(result);
          } catch (err) {
            console.error('Phone login backend call failed:', err);
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

module.exports = {
  request,
  phoneLogin
};
