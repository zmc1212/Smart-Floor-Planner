const app = getApp();
const api = require('../../../utils/api.js');
const { navigateToRoleLanding } = require('../../../utils/identity-navigation.js');

Page({
  data: {
    loginType: 'phone',
    username: '',
    password: '',
    loading: false
  },

  onLoad() {
    if (app.globalData.openid && app.globalData.userInfo) {
      wx.navigateBack();
    }
  },

  switchTab(e) {
    const type = e.currentTarget.dataset.type;
    if (!type || type === this.data.loginType) return;

    this.setData({ loginType: type });
  },

  onInputUsername(e) {
    this.setData({ username: e.detail.value });
  },

  onInputPassword(e) {
    this.setData({ password: e.detail.value });
  },

  async onGetPhoneNumber(e) {
    if (e.detail.errMsg !== 'getPhoneNumber:ok') {
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
    if (this.data.loading) return;

    wx.showLoading({ title: '登录中' });
    this.setData({ loading: true });

    try {
      const res = await loginFn();
      wx.hideLoading();

      if (res.success && (res.token || res.openid)) {
        // api.js already handled basic storage, but we ensure globalData and openid are synced
        app.globalData.token = res.token || app.globalData.token;
        app.globalData.userInfo = res.user || app.globalData.userInfo;
        app.globalData.openid = res.openid || app.globalData.openid || (res.user && res.user.openid);
        app.globalData.justLoggedIn = true;
        app.globalData.sessionHydrated = false;
        app.globalData.roleLandingRedirected = false;

        if (res.openid) wx.setStorageSync('openid', res.openid);

        if (typeof app.syncProfessionalContext === 'function') {
          app.syncProfessionalContext();
        }

        // Fix: Use modal to create a new user gesture for notification request
        wx.showModal({
          title: '登录成功',
          content: '建议开启消息通知，以便及时接收任务提醒与业务进度。',
          confirmText: '开启通知',
          cancelText: '直接进入',
          success: async (modalRes) => {
            if (modalRes.confirm) {
              const { requestNotification } = require('../../../utils/notification.js');
              try {
                await requestNotification();
              } catch (e) {
                console.error('Notification request failed', e);
              }
            }
            this.finishLogin();
          }
        });
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

  finishLogin() {
    const pages = getCurrentPages();
    // 如果页面栈大于1，说明是从其他页面跳过来的，直接返回
    if (pages.length > 1) {
      wx.navigateBack();
    } else {
      navigateToRoleLanding(app.globalData.userInfo);
    }
  },

  onBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
      return;
    }

    wx.switchTab({ url: '/pages/index/index' });
  }
});
