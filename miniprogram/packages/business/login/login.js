const app = getApp();
const api = require('../../../utils/api.js');
const { navigateToRoleLanding } = require('../../../utils/identity-navigation.js');

function shouldStayOnLoginPage(pages, previousRoute) {
  const stack = Array.isArray(pages) ? pages : [];
  if (stack.length <= 1) return true;
  return String(previousRoute || '').includes('enterprise-register');
}

function loginErrorMessage(error) {
  const code = error && error.code;
  const raw = error && (error.error || error.message);
  if (
    code === 'staff_phone_linked_to_other_user' ||
    raw === 'STAFF_PHONE_LINKED_TO_OTHER_USER'
  ) {
    return '该手机号已绑定其他微信账号，请使用绑定该号的微信登录，或联系企业管理员。';
  }
  if (
    code === 'wechat_identity_conflict' ||
    raw === 'WECHAT_IDENTITY_ALREADY_LINKED' ||
    raw === 'WECHAT_USER_ALREADY_LINKED'
  ) {
    return '当前微信已绑定其他账号，请换用本人微信登录，或联系企业管理员处理。';
  }
  if (typeof raw === 'string' && raw && !/^[A-Z][A-Z0-9_]+$/.test(raw)) {
    return raw;
  }
  return '登录失败，请稍后重试';
}

Page({
  data: {
    loginType: 'phone',
    username: '',
    password: '',
    loading: false
  },

  onLoad(options) {
    if (options && options.recovery === 'identity_context_invalid') {
      wx.showToast({ title: '身份已变更，请重新登录', icon: 'none' });
    }
    if (options && options.mode === 'password') {
      this.setData({ loginType: 'password' });
    }
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    const previousRoute = pages.length >= 2 ? (pages[pages.length - 2].route || '') : '';
    if (
      app.globalData.openid &&
      app.globalData.userInfo &&
      !shouldStayOnLoginPage(pages, previousRoute)
    ) {
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
        await app.hydrateStoredSession();
        if (app.globalData.sessionRecovery) throw new Error('身份资料已失效，请重新登录');

        this.finishLogin();
      } else {
        throw new Error(res.error || '登录失败');
      }
    } catch (err) {
      wx.hideLoading();
      this.setData({ loading: false });
      const title = loginErrorMessage(err);
      if (title.length > 20) {
        wx.showModal({
          title: '无法登录',
          content: title,
          showCancel: false,
          confirmText: '知道了'
        });
        return;
      }
      wx.showToast({
        title,
        icon: 'none',
        duration: 2500
      });
    }
  },

  finishLogin() {
    navigateToRoleLanding(app.globalData.userInfo);
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
