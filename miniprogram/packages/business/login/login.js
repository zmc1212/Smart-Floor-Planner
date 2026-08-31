const app = getApp();
const api = require('../../../utils/api.js');
const { navigateToRoleLanding } = require('../../../utils/identity-navigation.js');
const { resolveLegalDoc, buildLegalWebviewUrl } = require('../../../utils/legal-docs.js');
const {
  refreshWechatLoginCode,
  resolveWechatPhoneLoginInput,
  wechatPhoneAuthToast
} = require('../../../utils/wechat-phone-auth.js');

function shouldStayOnLoginPage(pages, previousRoute, options) {
  if (options && options.mode === 'password') return true;
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
    loading: false,
    agreed: false,
    showDisclaimer: false
  },

  onLoad(options) {
    refreshWechatLoginCode();
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
      !shouldStayOnLoginPage(pages, previousRoute, options)
    ) {
      wx.navigateBack();
    }
  },

  onShow() {
    refreshWechatLoginCode();
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

  onToggleAgreement() {
    this.setData({ agreed: !this.data.agreed });
  },

  onNeedAgreement() {
    wx.showToast({ title: '请先勾选同意协议', icon: 'none' });
  },

  onOpenLegalDoc(e) {
    const dataset = (e && e.currentTarget && e.currentTarget.dataset)
      || (e && e.target && e.target.dataset)
      || {};
    const kind = dataset.kind;
    const path = buildLegalWebviewUrl(resolveLegalDoc(kind));
    if (!path) {
      wx.showToast({ title: '文档即将开放', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: path });
  },

  async onGetPhoneNumber(e) {
    if (!this.data.agreed) {
      this.onNeedAgreement();
      return;
    }

    const resolved = resolveWechatPhoneLoginInput(e.detail);
    if (!resolved.ok) {
      wx.showToast({
        title: wechatPhoneAuthToast(resolved.reason),
        icon: 'none'
      });
      return;
    }

    if (resolved.kind === 'code') {
      this.performLogin(() => api.phoneLogin(resolved.phoneCode));
      return;
    }

    this.performLogin(() => api.phoneLogin({
      loginCode: resolved.loginCode,
      encryptedData: resolved.encryptedData,
      iv: resolved.iv
    }));
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

        this.setData({ loading: false });
        if (res.requiresPasswordChange) {
          this.promptInitialPasswordChange();
          return;
        }
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

  promptInitialPasswordChange() {
    wx.showModal({
      title: '建议修改初始密码',
      content: '当前账号仍使用初始密码。可先使用工作台，稍后也可在「我的 - 账号与安全」中修改。',
      confirmText: '去修改',
      cancelText: '稍后',
      success: (result) => {
        this.finishLogin();
        if (result && result.confirm) {
          setTimeout(() => {
            wx.navigateTo({
              url: '/packages/business/account-security/account-security'
            });
          }, 400);
        }
      },
      fail: () => {
        this.finishLogin();
      }
    });
  },

  finishLogin() {
    navigateToRoleLanding(app.globalData.userInfo);
  },

  onBack() {
    const pages = getCurrentPages();
    const previousRoute = pages.length >= 2 ? (pages[pages.length - 2].route || '') : '';
    if (pages.length > 1 && !String(previousRoute).includes('enterprise-register')) {
      wx.navigateBack();
      return;
    }

    wx.switchTab({ url: '/pages/mine/mine' });
  }
});
