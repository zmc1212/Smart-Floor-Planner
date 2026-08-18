const api = require('../../../utils/api.js');

function navigationMetrics() {
  const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
  let menuRect = null;
  try {
    menuRect = wx.getMenuButtonBoundingClientRect();
  } catch (error) {
    menuRect = null;
  }
  const menuLeft = Number(menuRect && menuRect.left || windowInfo.windowWidth - 94);
  return {
    navigationTop: Number(menuRect && menuRect.top || windowInfo.statusBarHeight || 24),
    navigationHeight: Number(menuRect && menuRect.height || 32),
    navigationRight: Math.max(94, Number(windowInfo.windowWidth || 390) - menuLeft + 10)
  };
}

function safeToken(value) {
  const raw = String(value || '').trim();
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch (error) {
    // Keep the original value when the QR scene is not URI encoded.
  }
  return /^[A-Za-z0-9_-]{32}$/.test(decoded) ? `ej_${decoded}` : decoded;
}

function onboardingErrorMessage(error) {
  const code = error && error.code;
  if (['code_rotated', 'code_disabled', 'code_expired'].includes(code)) {
    return '该入驻码已更新或停用，请联系企业管理员获取最新二维码。';
  }
  if (code === 'staff_enterprise_conflict') {
    return '当前微信已加入其他企业，不能重复作为员工入驻。';
  }
  if (code === 'membership_limit_reached') {
    return '当前微信的推荐人企业数量已达上限，请先退出不再服务的企业。';
  }
  return '暂时无法完成入驻，请检查网络后重试或联系企业管理员。';
}

Page({
  data: {
    navigationTop: 24,
    navigationHeight: 32,
    navigationRight: 96,
    pageState: 'resolving',
    onboardingToken: '',
    codeType: '',
    selectedStaffRole: 'designer',
    submitting: false,
    errorMessage: '',
    joinedLabel: ''
  },

  onLoad(options) {
    const onboardingToken = safeToken(options.token || options.scene);
    this.setData({ ...navigationMetrics(), onboardingToken });
    this.resolveOnboardingCode();
  },

  async resolveOnboardingCode() {
    const token = this.data.onboardingToken;
    if (!token) {
      this.setData({ pageState: 'error', errorMessage: '未识别到有效入驻码，请重新扫码进入。' });
      return;
    }
    this.setData({ pageState: 'resolving', errorMessage: '' });
    try {
      const response = await api.request('/miniprogram/codes/resolve', 'POST', { token });
      if (!response.data || response.data.kind !== 'onboarding' || !['staff', 'referrer'].includes(response.data.codeType)) {
        throw new Error('入驻码类型无效');
      }
      this.setData({ pageState: 'ready', codeType: response.data.codeType });
    } catch (error) {
      this.setData({ pageState: 'error', errorMessage: onboardingErrorMessage(error) });
    }
  },

  onChooseStaffRole(event) {
    if (this.data.submitting) return;
    const role = event.currentTarget.dataset.role;
    if (role === 'designer' || role === 'measurer') this.setData({ selectedStaffRole: role });
  },

  async onGetPhoneNumber(event) {
    if (this.data.pageState !== 'ready' || this.data.submitting) return;
    if (!event.detail || event.detail.errMsg !== 'getPhoneNumber:ok' || !event.detail.code) {
      wx.showToast({ title: '需要授权手机号才能完成入驻', icon: 'none' });
      return;
    }

    this.setData({ submitting: true, pageState: 'submitting', errorMessage: '' });
    try {
      await api.phoneLogin(event.detail.code);
      const endpoint = this.data.codeType === 'staff'
        ? '/miniprogram/onboarding/staff'
        : '/miniprogram/onboarding/referrer';
      const payload = {
        token: this.data.onboardingToken,
        ...(this.data.codeType === 'staff' ? { role: this.data.selectedStaffRole } : {})
      };
      const response = await api.request(endpoint, 'POST', payload);
      if (!response.token) throw new Error('入驻结果缺少身份凭据');
      await this.persistOnboardingSession(response);
      this.setData({
        submitting: false,
        pageState: 'success',
        joinedLabel: this.data.codeType === 'staff'
          ? (this.data.selectedStaffRole === 'designer' ? '设计师' : '测量员')
          : '推荐人'
      });
    } catch (error) {
      this.setData({
        submitting: false,
        pageState: 'error',
        errorMessage: onboardingErrorMessage(error)
      });
    }
  },

  async persistOnboardingSession(response) {
    const app = getApp();
    app.globalData.token = response.token;
    wx.setStorageSync('token', response.token);
    try {
      const refreshed = await api.request('/auth/miniprogram', 'POST', {
        type: 'refresh',
        token: response.token
      });
      if (refreshed.user) {
        app.globalData.userInfo = refreshed.user;
        app.globalData.openid = refreshed.openid || '';
        wx.setStorageSync('userInfo', refreshed.user);
        if (refreshed.openid) wx.setStorageSync('openid', refreshed.openid);
        return;
      }
    } catch (error) {
      // The onboarding token remains valid; use the smallest truthful local identity until refresh succeeds.
    }
    const fallbackUser = this.data.codeType === 'staff'
      ? { role: 'staff', staffRole: this.data.selectedStaffRole, mode: 'staff' }
      : { role: 'user', mode: 'referrer' };
    app.globalData.userInfo = fallbackUser;
    wx.setStorageSync('userInfo', fallbackUser);
  },

  onContinue() {
    const url = this.data.codeType === 'staff'
      ? '/pages/index/index'
      : '/packages/business/referrer-workbench/referrer-workbench';
    wx.reLaunch({ url });
  },

  onRetry() {
    if (this.data.submitting) return;
    this.resolveOnboardingCode();
  },

  onBack() {
    wx.navigateBack({
      delta: 1,
      fail: () => wx.reLaunch({ url: '/pages/index/index' })
    });
  }
});
