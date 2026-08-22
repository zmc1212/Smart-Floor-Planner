const api = require('../../../utils/api.js');
const { getRoleLanding, leaveScanLanding } = require('../../../utils/identity-navigation.js');

const ONBOARDING_ROUTE = 'packages/business/onboarding/onboarding';

function currentSignedIdentity() {
  const app = typeof getApp === 'function' ? getApp() : null;
  const globalData = (app && app.globalData) || {};
  return {
    ...(globalData.userInfo || {}),
    ...((globalData.bootstrap && globalData.bootstrap.current) || {})
  };
}

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

function usableDisplayName(value) {
  const name = String(value || '').trim();
  if (!name || name.length > 30) return '';
  if (['推荐人', '微信用户', '微信员工'].includes(name)) return '';
  return name;
}

function isRecoveryCode(code) {
  return ['code_rotated', 'code_disabled', 'code_expired', 'staff_enterprise_conflict', 'membership_limit_reached'].includes(code);
}

function navTitleFor(state) {
  if (state === 'recovery') return '入驻恢复';
  return '欢迎加入';
}

function onboardingUrlFromScanResult(scanResult) {
  const rawPath = String(scanResult && scanResult.path || '').trim();
  const queryIndex = rawPath.indexOf('?');
  const route = (queryIndex === -1 ? rawPath : rawPath.slice(0, queryIndex))
    .replace(/^\/+/, '');
  const query = queryIndex === -1 ? '' : rawPath.slice(queryIndex + 1);
  if (route !== ONBOARDING_ROUTE || !/(^|&)(token|scene)=[^&]+/.test(query)) return '';
  return `/${ONBOARDING_ROUTE}${rawPath.slice(queryIndex)}`;
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
  if (code === 'display_name_required') {
    return '请填写真实姓名后再加入。';
  }
  return '暂时无法完成入驻，请检查网络后重试或联系企业管理员。';
}

function applyOnboardingFailure(page, error) {
  const code = error && error.code;
  if (isRecoveryCode(code)) {
    page.setData({
      submitting: false,
      nameSheetVisible: false,
      pageState: 'recovery',
      navTitle: navTitleFor('recovery'),
      errorMessage: onboardingErrorMessage(error),
    });
    return;
  }
  page.setData({
    submitting: false,
    nameSheetVisible: false,
    pageState: 'error',
    navTitle: navTitleFor('error'),
    errorMessage: onboardingErrorMessage(error),
  });
}

Page({
  data: {
    navigationTop: 24,
    navigationHeight: 32,
    navigationRight: 96,
    navTitle: '欢迎加入',
    pageState: 'resolving',
    onboardingToken: '',
    codeType: '',
    enterpriseName: '',
    selectedStaffRole: 'designer',
    displayName: '',
    nameSheetVisible: false,
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
      this.setData({
        pageState: 'recovery',
        navTitle: navTitleFor('recovery'),
        errorMessage: '未识别到有效入驻码，请重新扫码进入。',
      });
      return;
    }
    this.setData({ pageState: 'resolving', navTitle: navTitleFor('ready'), errorMessage: '' });
    try {
      const response = await api.request('/miniprogram/codes/resolve', 'POST', { token });
      if (
        !response.data ||
        response.data.kind !== 'onboarding' ||
        !['staff', 'referrer'].includes(response.data.codeType) ||
        !String(response.data.enterpriseName || '').trim()
      ) {
        throw new Error('入驻码类型无效');
      }
      this.setData({
        pageState: 'ready',
        navTitle: navTitleFor('ready'),
        codeType: response.data.codeType,
        enterpriseName: String(response.data.enterpriseName).trim()
      });
    } catch (error) {
      applyOnboardingFailure(this, error);
    }
  },

  onChooseStaffRole(event) {
    if (this.data.submitting) return;
    const role = event.currentTarget.dataset.role;
    if (role === 'designer' || role === 'measurer') this.setData({ selectedStaffRole: role });
  },

  onDisplayNameInput(event) {
    this.setData({ displayName: String((event.detail && event.detail.value) || '').slice(0, 30) });
  },

  async onGetPhoneNumber(event) {
    if (this.data.pageState !== 'ready' || this.data.submitting) return;
    if (!event.detail || event.detail.errMsg !== 'getPhoneNumber:ok' || !event.detail.code) {
      wx.showToast({ title: '需要授权手机号才能完成入驻', icon: 'none' });
      return;
    }

    this.setData({ submitting: true, pageState: 'submitting', errorMessage: '' });
    try {
      const login = await api.phoneLogin(event.detail.code);
      if (this.data.codeType === 'referrer') {
        this.setData({
          submitting: false,
          pageState: 'name',
          nameSheetVisible: true,
          displayName: usableDisplayName(login && login.user && login.user.nickname)
        });
        return;
      }
      await this.submitOnboarding();
    } catch (error) {
      applyOnboardingFailure(this, error);
    }
  },

  async onConfirmReferrerName() {
    if (this.data.pageState !== 'name' || this.data.submitting) return;
    const displayName = usableDisplayName(this.data.displayName);
    if (!displayName) {
      wx.showToast({ title: '请填写真实姓名', icon: 'none' });
      return;
    }
    this.setData({ submitting: true, pageState: 'submitting', displayName, errorMessage: '' });
    try {
      await this.submitOnboarding();
    } catch (error) {
      if (isRecoveryCode(error && error.code)) {
        applyOnboardingFailure(this, error);
        return;
      }
      this.setData({
        submitting: false,
        pageState: 'name',
        nameSheetVisible: true,
        errorMessage: onboardingErrorMessage(error)
      });
      wx.showToast({ title: onboardingErrorMessage(error), icon: 'none' });
    }
  },

  async submitOnboarding() {
    const endpoint = this.data.codeType === 'staff'
      ? '/miniprogram/onboarding/staff'
      : '/miniprogram/onboarding/referrer';
    const payload = {
      token: this.data.onboardingToken,
      ...(this.data.codeType === 'staff'
        ? { role: this.data.selectedStaffRole }
        : { displayName: usableDisplayName(this.data.displayName) })
    };
    const response = await api.request(endpoint, 'POST', payload);
    if (!response.token) throw new Error('入驻结果缺少身份凭据');
    await this.persistOnboardingSession(response);
    this.setData({
      submitting: false,
      nameSheetVisible: false,
      pageState: 'success',
      joinedLabel: this.data.codeType === 'staff'
        ? (this.data.selectedStaffRole === 'designer' ? '设计师' : '测量员')
        : '推荐人'
    });
  },

  async persistOnboardingSession(response) {
    const app = getApp();
    app.globalData.token = response.token;
    app.globalData.sessionHydrated = false;
    app.globalData.roleLandingRedirected = false;
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
        app.globalData.sessionHydrated = false;
        await app.hydrateStoredSession();
        if (app.globalData.sessionRecovery) throw new Error('入驻身份已失效');
        return;
      }
    } catch (error) {
      throw new Error('入驻身份资料刷新失败');
    }
    throw new Error('入驻身份资料缺失');
  },

  enterWorkbench() {
    const app = typeof getApp === 'function' ? getApp() : null;
    const globalData = (app && app.globalData) || {};
    const identity = {
      ...(globalData.userInfo || {}),
      ...((globalData.bootstrap && globalData.bootstrap.current) || {})
    };
    if (!identity.mode) {
      identity.mode = this.data.codeType === 'staff' ? 'staff' : 'referrer';
    }
    if (this.data.codeType === 'staff' && !identity.staffRole) {
      identity.staffRole = this.data.selectedStaffRole;
    }
    const url = getRoleLanding(identity);
    if (!url) {
      wx.showToast({ title: '暂时无法进入工作台，请稍后重试', icon: 'none' });
      return;
    }
    wx.reLaunch({
      url,
      fail: () => wx.showToast({ title: '暂时无法进入工作台，请稍后重试', icon: 'none' })
    });
  },

  onContinue() {
    if (this._enteringWorkbench) return;
    this._enteringWorkbench = true;
    try {
      this.enterWorkbench();
    } finally {
      this._enteringWorkbench = false;
    }
  },

  onRetry() {
    if (this.data.submitting) return;
    this.setData({ nameSheetVisible: false, displayName: '' });
    this.resolveOnboardingCode();
  },

  onOpenIdentitySwitch() {
    wx.navigateTo({ url: '/packages/business/identity-switch/identity-switch' });
  },

  onScanNewInvite() {
    wx.scanCode({
      onlyFromCamera: false,
      scanType: ['qrCode'],
      success: (result) => {
        const url = onboardingUrlFromScanResult(result);
        if (!url) {
          wx.showToast({ title: '请扫描企业提供的入驻码', icon: 'none' });
          return;
        }
        wx.redirectTo({
          url,
          fail: () => wx.showToast({ title: '无法打开入驻页，请重新扫码', icon: 'none' })
        });
      },
      fail: (error) => {
        if (String(error && error.errMsg || '').includes('cancel')) return;
        wx.showToast({ title: '扫码失败，请确认二维码有效', icon: 'none' });
      }
    });
  },

  onBack() {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    if (pages && pages.length > 1) {
      wx.navigateBack({
        fail: () => leaveScanLanding(currentSignedIdentity())
      });
      return;
    }
    leaveScanLanding(currentSignedIdentity());
  },

  preventMove() {}
});
