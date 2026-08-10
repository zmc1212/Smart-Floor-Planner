const LOGIN_URL = '/packages/business/login/login';

function clearSession() {
  const app = getApp();
  if (app && app.globalData) {
    app.globalData.openid = null;
    app.globalData.userInfo = null;
    app.globalData.token = null;
    app.globalData.referral = { enterpriseId: null, staffId: null };
  }
  wx.removeStorageSync('openid');
  wx.removeStorageSync('userInfo');
  wx.removeStorageSync('token');
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

module.exports = {
  LOGIN_URL,
  clearSession,
  goToLogin,
  confirmLogout
};
