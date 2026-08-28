const api = require('../../../utils/api.js');
const session = require('../../../utils/session.js');
const {
  getRoleLanding,
  navigateToRoleLanding,
  roleForIdentity,
  shouldLeaveScanLanding,
  currentEnterScene,
  leaveScanLanding: exitScanLanding
} = require('../../../utils/identity-navigation.js');

const REGISTER_ROUTE = 'packages/business/enterprise-register/enterprise-register';
const WORKBENCH_ROLES = new Set([
  'designer',
  'measurer',
  'enterprise_admin',
  'referrer'
]);
const LOGIN_FROM_REGISTER_URL = `${session.LOGIN_URL}?mode=password`;

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

function currentSignedIdentity() {
  const app = typeof getApp === 'function' ? getApp() : null;
  const globalData = (app && app.globalData) || {};
  return {
    ...(globalData.userInfo || {}),
    ...((globalData.bootstrap && globalData.bootstrap.current) || {})
  };
}

function isWorkbenchIdentity(identity) {
  return WORKBENCH_ROLES.has(roleForIdentity(identity));
}

function currentScanScene() {
  const app = typeof getApp === 'function' ? getApp() : null;
  const fallback = app && app.globalData && app.globalData.launchOptions
    ? app.globalData.launchOptions.scene
    : undefined;
  return currentEnterScene(fallback);
}

function leaveRegistrationTarget(identity) {
  if (isWorkbenchIdentity(identity)) {
    return {
      action: 'role_landing',
      url: getRoleLanding(identity),
      clearSession: false
    };
  }
  return {
    action: 'login',
    url: LOGIN_FROM_REGISTER_URL,
    clearSession: true
  };
}

function applyAuthorizedIdentity(page, user) {
  const phone = String((user && user.phone) || page.data.authorizedPhone || '').trim();
  if (!isWorkbenchIdentity(user)) {
    return { leave: false, phone };
  }
  page.setData({
    submitting: false,
    authorizedPhone: phone,
    pageState: 'account',
    navTitle: '去登录',
    errorMessage: '该手机号已开通企业账号，请直接登录。'
  });
  return { leave: true, phone };
}

function goToPasswordLogin() {
  session.clearSession();
  const app = typeof getApp === 'function' ? getApp() : null;
  if (app && app.globalData) {
    app.globalData.sessionHydrated = false;
    app.globalData.roleLandingRedirected = false;
  }
  wx.reLaunch({
    url: LOGIN_FROM_REGISTER_URL,
    fail: () => wx.switchTab({ url: '/pages/mine/mine' })
  });
}

function applyFailure(page, error) {
  const code = error && error.code;
  if (code === 'ACCOUNT_CONFLICT') {
    page.setData({
      submitting: false,
      pageState: 'account',
      navTitle: '去登录',
      errorMessage: registerErrorMessage(error)
    });
    return;
  }
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

const REQUIRED_FORM_FIELDS = [
  { key: 'enterpriseName', label: '企业全称' },
  { key: 'creditCode', label: '统一社会信用代码' },
  { key: 'contactName', label: '联系人姓名' }
];

function missingFormFields(data) {
  return REQUIRED_FORM_FIELDS.filter(
    (field) => !String((data && data[field.key]) || '').trim()
  );
}

function missingHintFrom(fields) {
  if (!fields.length) return '';
  return `还需填写：${fields.map((field) => field.label).join('、')}`;
}

function emptyFieldErrors() {
  return { enterpriseName: '', creditCode: '', contactName: '' };
}

function fieldErrorsFrom(fields) {
  const missingKeys = new Set(fields.map((field) => field.key));
  return REQUIRED_FORM_FIELDS.reduce((errors, field) => {
    errors[field.key] = missingKeys.has(field.key) ? `请填写${field.label}` : '';
    return errors;
  }, emptyFieldErrors());
}

function formFeedback(data, options) {
  const missing = missingFormFields(data);
  const showFieldErrors = Boolean(options && options.showFieldErrors);
  return {
    canSubmit: missing.length === 0,
    missingHint: missingHintFrom(missing),
    fieldErrors: showFieldErrors ? fieldErrorsFrom(missing) : emptyFieldErrors()
  };
}

function formFieldsReady(data) {
  return missingFormFields(data).length === 0;
}

function formReady(data) {
  return formFieldsReady(data) && Boolean(String(data.authorizedPhone || '').trim());
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
    contactPhone: '',
    contactEmail: '',
    authorizedPhone: '',
    phoneError: '',
    canSubmit: false,
    missingHint: missingHintFrom(missingFormFields({})),
    showFieldErrors: false,
    fieldErrors: emptyFieldErrors(),
    submitting: false,
    errorMessage: ''
  },

  onLoad(options) {
    const registrationToken = safeToken(options.token || options.scene);
    this.setData({ ...navigationMetrics(), registrationToken });
    if (this.leaveIfStickyScanReopen()) return;
    this.resolveRegistrationCode();
  },

  leaveIfStickyScanReopen() {
    const identity = currentSignedIdentity();
    if (!shouldLeaveScanLanding(REGISTER_ROUTE, identity, currentScanScene())) {
      return false;
    }
    exitScanLanding(identity);
    return true;
  },

  leaveIfWorkbenchSignedIn() {
    const identity = currentSignedIdentity();
    if (!isWorkbenchIdentity(identity)) return false;
    navigateToRoleLanding(identity);
    return true;
  },

  onGoToLogin() {
    const identity = currentSignedIdentity();
    if (isWorkbenchIdentity(identity) && navigateToRoleLanding(identity)) {
      return;
    }
    goToPasswordLogin();
  },

  leaveScanLanding() {
    return exitScanLanding(currentSignedIdentity());
  },

  onBack() {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    if (pages && pages.length > 1) {
      wx.navigateBack({
        fail: () => this.leaveScanLanding()
      });
      return;
    }
    this.leaveScanLanding();
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
        platformLabel: String(response.data.displayName || response.data.platformLabel || '家客来企业入驻').trim(),
        ...formFeedback(this.data, { showFieldErrors: this.data.showFieldErrors })
      });
    } catch (error) {
      applyFailure(this, error);
    }
  },

  syncFormPatch(patch) {
    const next = { ...this.data, ...patch };
    this.setData({
      ...patch,
      ...formFeedback(next, { showFieldErrors: next.showFieldErrors })
    });
  },

  revealMissingFields() {
    const missing = missingFormFields(this.data);
    const first = missing[0];
    this.setData({
      showFieldErrors: true,
      ...formFeedback(this.data, { showFieldErrors: true })
    });
    wx.showToast({
      title: first ? `请填写${first.label}` : '请填写完整企业资料',
      icon: 'none'
    });
    return missing;
  },

  onIncompleteSubmit() {
    if (this.data.pageState !== 'ready' || this.data.submitting) return;
    this.revealMissingFields();
  },

  onEnterpriseNameInput(event) {
    this.syncFormPatch({
      enterpriseName: String((event.detail && event.detail.value) || '').slice(0, 80)
    });
  },

  onCreditCodeInput(event) {
    this.syncFormPatch({
      creditCode: String((event.detail && event.detail.value) || '').slice(0, 32)
    });
  },

  onContactNameInput(event) {
    this.syncFormPatch({
      contactName: String((event.detail && event.detail.value) || '').slice(0, 30)
    });
  },

  onContactPhoneInput(event) {
    const contactPhone = String((event.detail && event.detail.value) || '')
      .replace(/\D/g, '')
      .slice(0, 11);
    const authorizedPhone = String(this.data.authorizedPhone || '').trim();
    this.setData({
      contactPhone,
      authorizedPhone: authorizedPhone === contactPhone ? authorizedPhone : '',
      phoneError: ''
    });
  },

  onContactEmailInput(event) {
    this.setData({ contactEmail: String((event.detail && event.detail.value) || '').slice(0, 80) });
  },

  async onGetPhoneNumber(event) {
    if (this.data.pageState !== 'ready' || this.data.submitting) return;
    if (!this.data.canSubmit) {
      this.revealMissingFields();
      return;
    }
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
      const enteredPhone = String(this.data.contactPhone || '').trim();
      if (enteredPhone && enteredPhone !== phone) {
        this.setData({
          submitting: false,
          authorizedPhone: '',
          phoneError: '手动填写的手机号需与微信授权手机号一致，请修改后重试'
        });
        wx.showToast({ title: '手机号与微信授权号码不一致', icon: 'none' });
        return;
      }
      const authorized = applyAuthorizedIdentity(this, login && login.user);
      if (authorized.leave) {
        setTimeout(() => {
          if (!this.leaveIfWorkbenchSignedIn()) this.onGoToLogin();
        }, 50);
        return;
      }
      const contactName =
        this.data.contactName ||
        String((login && login.user && login.user.nickname) || '')
          .trim()
          .slice(0, 30);
      this.setData({
        authorizedPhone: phone,
        contactPhone: enteredPhone || phone,
        phoneError: '',
        contactName,
        ...formFeedback(
          { ...this.data, contactName },
          { showFieldErrors: this.data.showFieldErrors }
        )
      });
      await this.submitRegistration();
    } catch (error) {
      applyFailure(this, error);
    }
  },

  async onSubmit() {
    if (this.data.pageState !== 'ready' || this.data.submitting) return;
    if (!this.data.canSubmit) {
      this.revealMissingFields();
      return;
    }
    if (!this.data.authorizedPhone) {
      wx.showToast({ title: '请点击“授权手机号并提交”完成验证', icon: 'none' });
      return;
    }
    await this.submitRegistration();
  },

  async submitRegistration() {
    if (!formReady(this.data)) {
      this.setData({ submitting: false });
      this.revealMissingFields();
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
          phone: String(this.data.contactPhone || this.data.authorizedPhone).trim(),
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
    this.onGoToLogin();
  }
});

module.exports = {
  safeToken,
  isRecoveryCode,
  missingFormFields,
  formFeedback,
  formFieldsReady,
  formReady,
  applyFailure,
  applyAuthorizedIdentity,
  isWorkbenchIdentity,
  leaveRegistrationTarget,
  goToPasswordLogin,
  REGISTER_ROUTE
};
