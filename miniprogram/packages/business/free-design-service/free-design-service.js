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

function loginCode() {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (result) => result.code ? resolve(result.code) : reject(new Error('微信登录凭证获取失败')),
      fail: reject
    });
  });
}

function safeToken(value) {
  const raw = String(value || '').trim();
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch (error) {
    // Keep the original value when the QR scene is not URI encoded.
  }
  return /^[A-Za-z0-9_-]{32}$/.test(decoded) ? decoded : decoded;
}

function deviceSummary() {
  const device = wx.getDeviceInfo ? wx.getDeviceInfo() : wx.getSystemInfoSync();
  const appBase = wx.getAppBaseInfo ? wx.getAppBaseInfo() : {};
  return {
    platform: device.platform || '',
    model: device.model || '',
    system: device.system || '',
    language: appBase.language || device.language || '',
    version: appBase.version || device.version || ''
  };
}

function claimErrorMessage(error) {
  const code = error && error.code;
  if (code === 'pending_source_invalid') return '本次服务领取已超时，请重新扫描服务码。';
  if (code === 'wechat_user_mismatch') return '当前微信与登录账号不一致，请切换账号后重试。';
  if (code === 'customer_context_required') return '请先切换到客户身份后再领取服务。';
  return '服务领取暂未完成，请检查网络后重试。';
}

function applyClaimResult(page, response) {
  if (response.existingAttribution || (response.data && response.data.existingAttribution)) {
    page.setData({
      submitting: false,
      pageState: 'existing',
      navTitle: navTitleFor('existing'),
      pendingSource: '',
      enterpriseName: '',
      designerProfile: null,
      lead: response.data && response.data.lead || null,
      errorMessage: ''
    });
    return;
  }
  const designerProfile = response.data && response.data.designerProfile || null;
  page.setData({
    submitting: false,
    pageState: designerProfile ? 'success' : 'pending',
    navTitle: navTitleFor(designerProfile ? 'success' : 'pending'),
    designerProfile,
    lead: response.data && response.data.lead || null
  });
  if (designerProfile && designerProfile.wechatQrUrl) {
    page.loadDesignerQr(designerProfile.wechatQrUrl);
  }
}

function resolveErrorMessage(error) {
  const code = error && error.code;
  const expired = code === 'code_rotated' || code === 'code_disabled' || code === 'code_expired';
  if (expired) return '该服务码已更新，请联系推荐人或现场员工出示最新服务码。';
  return '服务码暂时无法识别，请重新扫码或稍后重试。';
}

function navTitleFor(state) {
  if (state === 'phoneAuth') return '手机号授权';
  if (state === 'success') return '服务已建立';
  if (state === 'pending') return '服务匹配中';
  if (state === 'existing') return '服务档案';
  return '确认领取';
}

Page({
  data: {
    navigationTop: 24,
    navigationHeight: 32,
    navigationRight: 96,
    pageState: 'resolving',
    navTitle: '确认领取',
    promotionToken: '',
    pendingSource: '',
    agreed: false,
    submitting: false,
    errorMessage: '',
    claimKind: '',
    enterpriseName: '',
    designerProfile: null,
    designerQrPath: '',
    designerQrLoading: false,
    designerQrError: false,
    lead: null
  },

  onLoad(options) {
    const promotionToken = safeToken(options.token || options.scene);
    this.setData({ ...navigationMetrics(), promotionToken });
    this.idempotencyKey = `claim-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    this.resolvePromotionCode();
  },

  onUnload() {
    this.qrRequestId = (this.qrRequestId || 0) + 1;
  },

  async resolvePromotionCode() {
    const token = this.data.promotionToken;
    if (!token) {
      this.setData({
        pageState: 'error',
        navTitle: navTitleFor('error'),
        errorMessage: '未识别到有效服务码，请重新扫码进入。'
      });
      return;
    }
    this.setData({ pageState: 'resolving', navTitle: navTitleFor('resolving'), errorMessage: '' });
    try {
      const response = await api.request('/miniprogram/codes/resolve', 'POST', {
        token,
        sessionKey: this.idempotencyKey,
        deviceSummary: deviceSummary()
      });
      if (!response.data || (response.data.kind !== 'referral' && response.data.kind !== 'staff_activity')) {
        throw new Error('服务码类型无效');
      }
      if (response.data.existingAttribution) {
        this.setData({
          pageState: 'existing',
          navTitle: navTitleFor('existing'),
          pendingSource: '',
          claimKind: response.data.kind,
          enterpriseName: '',
          lead: response.data.lead || null,
          errorMessage: ''
        });
        return;
      }
      if (!response.data.pendingSource) {
        throw new Error('服务码类型无效');
      }
      this.setData({
        pageState: 'ready',
        navTitle: navTitleFor('ready'),
        pendingSource: response.data.pendingSource,
        claimKind: response.data.kind,
        enterpriseName: response.data.enterpriseName || '',
        errorMessage: ''
      });
    } catch (error) {
      this.setData({
        pageState: 'error',
        navTitle: navTitleFor('error'),
        errorMessage: resolveErrorMessage(error)
      });
    }
  },

  onToggleAgreement() {
    if (this.data.submitting) return;
    this.setData({ agreed: !this.data.agreed });
  },

  onStartPhoneAuth() {
    if (!this.data.agreed || this.data.pageState !== 'ready' || this.data.submitting) return;
    this.setData({ pageState: 'phoneAuth', navTitle: navTitleFor('phoneAuth') });
  },

  onSkipAuth() {
    if (this.data.submitting) return;
    this.setData({ pageState: 'ready', navTitle: navTitleFor('ready') });
  },

  onLater() {
    wx.navigateBack({ delta: 1, fail: () => wx.switchTab({ url: '/pages/index/index' }) });
  },

  async onGetPhoneNumber(event) {
    if (!this.data.agreed || this.data.pageState !== 'phoneAuth' || this.data.submitting) return;
    if (!event.detail || event.detail.errMsg !== 'getPhoneNumber:ok' || !event.detail.code) {
      wx.showToast({ title: '需要授权手机号才能建立服务档案', icon: 'none' });
      return;
    }

    this.setData({ submitting: true, errorMessage: '' });
    try {
      const code = await loginCode();
      const response = await api.request(
        '/miniprogram/referrals/authorize-and-create-lead',
        'POST',
        {
          loginCode: code,
          phoneCode: event.detail.code,
          pendingSource: this.data.pendingSource,
          idempotencyKey: this.idempotencyKey
        },
        { headers: { 'Idempotency-Key': this.idempotencyKey } }
      );
      await this.persistCustomerSession(response);
      applyClaimResult(this, response);
    } catch (error) {
      this.setData({
        submitting: false,
        pageState: 'error',
        navTitle: navTitleFor('error'),
        errorMessage: claimErrorMessage(error)
      });
    }
  },

  async persistCustomerSession(response) {
    if (!response.token) return;
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
        app.globalData.sessionHydrated = false;
        await app.hydrateStoredSession();
        if (app.globalData.sessionRecovery) throw new Error('客户身份已失效');
        return;
      }
    } catch (error) {
      throw new Error('客户身份资料刷新失败');
    }
    throw new Error('客户身份资料缺失');
  },

  loadDesignerQr(url) {
    const requestId = (this.qrRequestId || 0) + 1;
    this.qrRequestId = requestId;
    const token = getApp().globalData.token || wx.getStorageSync('token');
    const separator = url.includes('?') ? '&' : '?';
    this.setData({ designerQrLoading: true, designerQrError: false, designerQrPath: '' });
    wx.request({
      url: `${url}${separator}clientCacheKey=${Date.now()}`,
      method: 'GET',
      responseType: 'arraybuffer',
      header: { Authorization: token ? `Bearer ${token}` : '' },
      success: (response) => {
        if (requestId !== this.qrRequestId) return;
        if (response.statusCode < 200 || response.statusCode >= 300 || !(response.data instanceof ArrayBuffer)) {
          this.setData({ designerQrLoading: false, designerQrError: true });
          return;
        }
        const filePath = `${wx.env.USER_DATA_PATH}/assigned-designer-qr.png`;
        wx.getFileSystemManager().writeFile({
          filePath,
          data: response.data,
          success: () => {
            if (requestId === this.qrRequestId) {
              this.setData({ designerQrLoading: false, designerQrError: false, designerQrPath: filePath });
            }
          },
          fail: () => this.setData({ designerQrLoading: false, designerQrError: true })
        });
      },
      fail: () => {
        if (requestId === this.qrRequestId) this.setData({ designerQrLoading: false, designerQrError: true });
      }
    });
  },

  onRetryDesignerQr() {
    const profile = this.data.designerProfile;
    if (profile && profile.wechatQrUrl) this.loadDesignerQr(profile.wechatQrUrl);
  },

  onCopyWechat() {
    const wechatId = this.data.designerProfile && this.data.designerProfile.wechatId;
    if (!wechatId) return;
    wx.setClipboardData({ data: wechatId, success: () => wx.showToast({ title: '微信号已复制', icon: 'success' }) });
  },

  async onSaveQr() {
    const filePath = this.data.designerQrPath;
    if (!filePath) {
      wx.showToast({ title: '二维码尚未准备好', icon: 'none' });
      return;
    }
    try {
      await wx.saveImageToPhotosAlbum({ filePath });
      wx.showToast({ title: '二维码已保存', icon: 'success' });
    } catch (error) {
      const message = error && error.errMsg || '';
      if (message.includes('auth deny') || message.includes('auth denied')) {
        wx.showModal({
          title: '需要相册权限',
          content: '请在设置中允许保存图片到相册。',
          confirmText: '去设置',
          success: (result) => result.confirm && wx.openSetting()
        });
      }
    }
  },

  onOpenProject() {
    const leadId = this.data.lead && this.data.lead.id;
    if (leadId) {
      wx.navigateTo({ url: `/packages/business/customer-project/customer-project?leadId=${encodeURIComponent(leadId)}` });
      return;
    }
    wx.switchTab({ url: '/pages/mine/mine' });
  },

  onRetry() {
    this.resolvePromotionCode();
  },

  onBack() {
    if (this.data.pageState === 'phoneAuth' && !this.data.submitting) {
      this.setData({ pageState: 'ready', navTitle: navTitleFor('ready') });
      return;
    }
    wx.navigateBack({ delta: 1, fail: () => wx.switchTab({ url: '/pages/index/index' }) });
  }
});
