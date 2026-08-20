const api = require('../../../utils/api.js');

const REGISTER_ROUTE = 'packages/business/enterprise-register/enterprise-register';

function navigationMetrics() {
  const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
  let menuRect = null;
  try {
    menuRect = wx.getMenuButtonBoundingClientRect();
  } catch (error) {
    menuRect = null;
  }
  const menuLeft = Number((menuRect && menuRect.left) || windowInfo.windowWidth - 94);
  return {
    navigationTop: Number((menuRect && menuRect.top) || windowInfo.statusBarHeight || 24),
    navigationHeight: Number((menuRect && menuRect.height) || 32),
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
  return /^[A-Za-z0-9_-]{32}$/.test(decoded) ? `er_${decoded}` : decoded;
}

function isRecoveryCode(code) {
  return ['code_rotated', 'code_disabled', 'code_expired'].includes(code);
}

function navTitleFor(state) {
  if (state === 'recovery') return '开户恢复';
  if (state === 'success') return '提交成功';
  return '企业开户';
}

function registerErrorMessage(error) {
  const code = error && error.code;
  if (isRecoveryCode(code)) {
    return '该开户码已更新或停用，请联系平台获取最新二维码。';
  }
  if (code === 'phone_mismatch') {
    return '联系人手机号必须与微信授权手机号一致。';
  }
  if (code === 'ACCOUNT_CONFLICT') {
    return '该手机号已注册为系统账号，请更换手机号或联系平台管理员。';
  }
  if (code === '23505') {
    return '该统一社会信用代码已注册，请勿重复申请。';
  }
  if (code === 'VALIDATION') {
    return (error && error.message) || '请检查填写资料后重试。';
  }
  return (error && error.message) || '暂时无法提交开户申请，请检查网络后重试。';
}

function applyFailure(page, error) {
  const code = error && error.code;
  if (isRecoveryCode(code)) {
    page.setData({
      submitting: false,
      pageState: 'recovery',
      navTitle: navTitleFor('recovery'),
      errorMessage: registerErrorMessage(error)
    });
    return;
  }
  page.setData({
    submitting: false,
    pageState: 'error',
    navTitle: navTitleFor('error'),
    errorMessage: registerErrorMessage(error)
  });
}

function formReady(data) {
  return Boolean(
    String(data.enterpriseName || '').trim() &&
      String(data.creditCode || '').trim() &&
      String(data.contactName || '').trim() &&
      String(data.authorizedPhone || '').trim()
  );
}

Page({
  data: {
    navigationTop: 24,
    navigationHeight: 32,
    navigationRight: 96,
    navTitle: '企业开户',
    pageState: 'resolving',
    registrationToken: '',
    platformLabel: '家客来企业入驻',
    enterpriseName: '',
    creditCode: '',
    contactName: '',
    contactEmail: '',
    authorizedPhone: '',
    submitting: false,
    errorMessage: ''
  },

  onLoad(options) {
    const registrationToken = safeToken(options.token || options.scene);
    this.setData({ ...navigationMetrics(), registrationToken });
    this.resolveRegistrationCode();
  },

  async resolveRegistrationCode() {
    const token = this.data.registrationToken;
    if (!token || !String(token).startsWith('er_')) {
      this.setData({
        pageState: 'recovery',
        navTitle: navTitleFor('recovery'),
        errorMessage: '未识别到有效开户码，请重新扫码进入。'
      });
      return;
    }
    this.setData({ pageState: 'resolving', navTitle: navTitleFor('ready'), errorMessage: '' });
    try {
      const response = await api.request('/miniprogram/codes/resolve', 'POST', { token });
      if (!response.data || response.data.kind !== 'enterprise_registration') {
        throw new Error('开户码类型无效');
      }
      this.setData({
        pageState: 'ready',
        navTitle: navTitleFor('ready'),
        platformLabel: String(response.data.displayName || response.data.platformLabel || '家客来企业入驻').trim()
      });
    } catch (error) {
      applyFailure(this, error);
    }
  },

  onEnterpriseNameInput(event) {
    this.setData({ enterpriseName: String((event.detail && event.detail.value) || '').slice(0, 80) });
  },

  onCreditCodeInput(event) {
    this.setData({ creditCode: String((event.detail && event.detail.value) || '').slice(0, 32) });
  },

  onContactNameInput(event) {
    this.setData({ contactName: String((event.detail && event.detail.value) || '').slice(0, 30) });
  },

  onContactEmailInput(event) {
    this.setData({ contactEmail: String((event.detail && event.detail.value) || '').slice(0, 80) });
  },

  async onGetPhoneNumber(event) {
    if (this.data.pageState !== 'ready' || this.data.submitting) return;
    if (!event.detail || event.detail.errMsg !== 'getPhoneNumber:ok' || !event.detail.code) {
      wx.showToast({ title: '需要授权手机号才能提交开户', icon: 'none' });
      return;
    }
    this.setData({ submitting: true, errorMessage: '' });
    try {
      const login = await api.phoneLogin(event.detail.code);
      const phone = String((login && login.user && login.user.phone) || '').trim();
      if (!/^1[3-9]\d{9}$/.test(phone)) {
        throw Object.assign(new Error('未获取到有效手机号，请重试授权'), { code: 'VALIDATION' });
      }
      this.setData({
        submitting: false,
        authorizedPhone: phone,
        contactName: this.data.contactName || String((login && login.user && login.user.nickname) || '').trim().slice(0, 30)
      });
    } catch (error) {
      applyFailure(this, error);
    }
  },

  async onSubmit() {
    if (this.data.pageState !== 'ready' || this.data.submitting) return;
    if (!this.data.authorizedPhone) {
      wx.showToast({ title: '请先授权手机号', icon: 'none' });
      return;
    }
    if (!formReady(this.data)) {
      wx.showToast({ title: '请填写完整企业资料', icon: 'none' });
      return;
    }
    this.setData({ submitting: true, pageState: 'submitting', errorMessage: '' });
    try {
      await api.request('/miniprogram/enterprise-registration', 'POST', {
        token: this.data.registrationToken,
        name: String(this.data.enterpriseName).trim(),
        code: String(this.data.creditCode).trim(),
        contactPerson: {
          name: String(this.data.contactName).trim(),
          phone: String(this.data.authorizedPhone).trim(),
          email: String(this.data.contactEmail || '').trim()
        }
      });
      this.setData({
        submitting: false,
        pageState: 'success',
        navTitle: navTitleFor('success')
      });
    } catch (error) {
      applyFailure(this, error);
    }
  },

  onRetry() {
    this.setData({ errorMessage: '', pageState: 'resolving' });
    this.resolveRegistrationCode();
  },

  onOpenIdentitySwitch() {
    wx.navigateTo({
      url: '/packages/business/identity-switch/identity-switch',
      fail: () => wx.switchTab({ url: '/pages/mine/mine' })
    });
  },

  onDone() {
    wx.switchTab({ url: '/pages/index/index' });
  }
});

module.exports = {
  safeToken,
  isRecoveryCode,
  formReady,
  REGISTER_ROUTE
};
