const { canAccessRoute } = require('./identity-navigation');

const LOGIN_URL = '/packages/business/login/login';
const ACCOUNT_SECURITY_URL = '/packages/business/account-security/account-security';

function isInitialPasswordRequired(error) {
  return error?.statusCode === 403
    && (error.code || error.error) === 'construction_password_required';
}

function clearSession() {
  const app = getApp();
  if (app && app.globalData) {
    app.globalData.openid = null;
    app.globalData.userInfo = null;
    app.globalData.token = null;
    app.globalData.referral = { enterpriseId: null, staffId: null };
    app.globalData.bootstrap = null;
    app.globalData.sessionRecovery = null;
    app.globalData.lastValidIdentityContext = null;
  }
  wx.removeStorageSync('openid');
  wx.removeStorageSync('userInfo');
  wx.removeStorageSync('token');
  wx.removeStorageSync('lastValidIdentityContext');
}

function goToLogin() {
  wx.reLaunch({ url: LOGIN_URL });
}

function confirmLogout(options = {}) {
  wx.showModal({
    title: '退出登录',
    content: '确定要退出当前账号吗？',
    confirmText: '退出',
    confirmColor: '#DC2626',
    success(res) {
      if (!res.confirm) return;
      clearSession();
      if (typeof options.onCleared === 'function') options.onCleared();
      if (options.redirect !== false) goToLogin();
    }
  });
}

const staffPasswordRequiredMethods = {
  openAccountSecurity() {
    const { token, bootstrap, userInfo } = getApp().globalData;
    if (!this.data.passwordRequired && !this.data.followupPasswordRequired) return;
    if (!token || token !== this._passwordRequiredToken || this._openingAccountSecurity
      || !canAccessRoute(ACCOUNT_SECURITY_URL, bootstrap || userInfo)) return;
    this._openingAccountSecurity = true;
    wx.navigateTo({
      url: ACCOUNT_SECURITY_URL,
      fail: () => wx.showToast({ title: '暂时无法打开，请重试', icon: 'none' }),
      complete: () => { this._openingAccountSecurity = false; },
    });
  },

  goBackFromPasswordRequired() {
    const url = '/pages/mine/mine';
    const openAccountTab = () => wx.switchTab({ url, fail: () => wx.reLaunch({ url }) });
    if (getCurrentPages().length < 2) openAccountTab();
    else wx.navigateBack({ fail: openAccountTab });
  },
};

module.exports = {
  staffPasswordRequiredMethods,
  LOGIN_URL,
  ACCOUNT_SECURITY_URL,
  isInitialPasswordRequired,
  clearSession,
  goToLogin,
  confirmLogout
};
