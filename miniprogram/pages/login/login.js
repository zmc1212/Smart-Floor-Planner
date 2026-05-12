const app = getApp();
const api = require('../../utils/api.js');

Page({
  data: {
    loginType: 'phone', // 'phone' or 'password'
    username: '',
    password: '',
    loading: false
  },

  onLoad() {
    // If already logged in, go back
    if (app.globalData.openid && app.globalData.userInfo) {
      wx.navigateBack();
    }
  },

  switchTab(e) {
    const type = e.currentTarget.dataset.type;
    this.setData({ loginType: type });
  },

  onInputUsername(e) {
    this.setData({ username: e.detail.value });
  },

  onInputPassword(e) {
    this.setData({ password: e.detail.value });
  },

  async onGetPhoneNumber(e) {
    if (e.detail.errMsg !== "getPhoneNumber:ok") {
      wx.showToast({ title: '已取消授权', icon: 'none' });
      return;
    }

    const phoneCode = e.detail.code;
    if (!phoneCode) {
      wx.showToast({ title: '获取手机号失败', icon: 'none' });
      return;
    }

    this.performLogin(() => api.phoneLogin(phoneCode));
  },

  async onPasswordLogin() {
    const { username, password } = this.data;
    if (!username || !password) {
      wx.showToast({ title: '请输入账号密码', icon: 'none' });
      return;
    }

    this.performLogin(() => api.passwordLogin(username, password));
  },

  async performLogin(loginFn) {
    wx.showLoading({ title: '登录中' });
    this.setData({ loading: true });

    try {
      const res = await loginFn();
      wx.hideLoading();

      if (res.success && (res.token || res.openid)) {
        // Save to global data
        app.globalData.token = res.token;
        app.globalData.openid = res.openid;
        app.globalData.userInfo = res.user;

        // Save to storage
        if (res.token) wx.setStorageSync('token', res.token);
        wx.setStorageSync('openid', res.openid);
        wx.setStorageSync('userInfo', res.user);

        // Sync context (if method exists)
        if (typeof app.syncProfessionalContext === 'function') {
          app.syncProfessionalContext();
        }

        wx.showToast({ title: '登录成功', icon: 'success' });
        
        // --- New: Request notification permission ---
        const { requestNotification } = require('../../utils/notification.js');
        try {
          await requestNotification();
        } catch (e) {
          console.error('Notification request failed', e);
        }

        // Wait a bit for toast, then go back
        setTimeout(() => {
          wx.navigateBack();
        }, 1000);
      } else {
        throw new Error(res.error || '登录失败');
      }
    } catch (err) {
      wx.hideLoading();
      this.setData({ loading: false });
      wx.showToast({ 
        title: err.error || err.message || '登录失败', 
        icon: 'none',
        duration: 2000
      });
    }
  },

  onBack() {
    wx.navigateBack();
  }
});
