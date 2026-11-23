const api = require('../../../utils/api.js');
const {
  refreshWechatLoginCode,
  resolveWechatPhoneLoginInput,
  wechatPhoneAuthToast
} = require('../../../utils/wechat-phone-auth.js');

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
  try {
    return decodeURIComponent(raw);
  } catch (error) {
    return raw;
  }
}

function loginCode() {
  return new Promise((resolve, reject) => {
    wx.login({
      success: result => result.code ? resolve(result.code) : reject(new Error('微信登录凭证获取失败')),
      fail: reject
    });
  });
}

function errorCopy(error) {
  const code = error && (error.code || error.error);
  if (code === 'code_not_found' || code === 'code_disabled') return '这个服务码已失效，请让推广人重新生成。';
  if (code === 'pending_source_expired') return '服务码已过期，请重新扫码进入。';
  if (code === 'phone_authorization_required') return '需要授权手机号才能建立服务档案。';
  if (code === 'customer_service_ambiguous') return '请联系当前的装修顾问确认服务企业。';
  return (error && error.message) || '服务暂时不可用，请稍后重试。';
}

Page({
  data: {
    navigationTop: 24,
    navigationHeight: 32,
    navigationRight: 96,
    token: '',
    loading: true,
    submitting: false,
    errorMessage: '',
    pendingSource: '',
    brandMode: 'anonymous',
    brandName: '',
    brandLogo: '',
    opening: '你好，我是小K。先说说你家的情况和想法，需要量房时再留下手机号，我会帮你安排。',
    prompts: []
  },

  onLoad(options) {
    refreshWechatLoginCode();
    const token = safeToken(options.entryCode || options.token || options.scene);
    this.setData({ ...navigationMetrics(), token });
    this.idempotencyKey = `acq-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    this.resolveCode();
  },

  onShow() {
    refreshWechatLoginCode();
  },

  async resolveCode() {
    const token = this.data.token;
    if (!token) {
      this.setData({ loading: false, errorMessage: '未识别到有效服务码，请重新扫码进入。' });
      return;
    }
    this.setData({ loading: true, errorMessage: '' });
    try {
      const response = await api.request('/miniprogram/codes/resolve', 'POST', {
        token,
        sessionKey: this.idempotencyKey,
        deviceSummary: {}
      });
      const data = response && response.data;
      if (!data || (data.kind !== 'referral' && data.kind !== 'staff_activity')) {
        throw new Error('服务码类型无效');
      }
      if (data.existingAttribution && data.lead && data.lead.id) {
        this.goChat(true);
        return;
      }
      if (!data.pendingSource) throw new Error('服务码暂时不可用，请重新扫码');
      const acquisition = data.acquisition || {};
      this.setData({
        loading: false,
        pendingSource: data.pendingSource,
        brandMode: acquisition.brandMode || 'anonymous',
        brandName: acquisition.brandName || '',
        brandLogo: acquisition.brandLogo || '',
        opening: acquisition.opening || this.data.opening,
        prompts: Array.isArray(acquisition.prompts) ? acquisition.prompts : []
      });
    } catch (error) {
      this.setData({ loading: false, errorMessage: errorCopy(error) });
    }
  },

  async onGetPhoneNumber(event) {
    if (this.data.submitting || !this.data.pendingSource) return;
    const resolved = resolveWechatPhoneLoginInput(event.detail);
    if (!resolved.ok) {
      wx.showToast({ title: wechatPhoneAuthToast(resolved.reason, '需要授权手机号才能安排服务'), icon: 'none' });
      return;
    }
    this.setData({ submitting: true, errorMessage: '' });
    try {
      const code = resolved.kind === 'code' ? await loginCode() : resolved.loginCode;
      const response = await api.request(
        '/miniprogram/referrals/authorize-and-create-lead',
        'POST',
        {
          loginCode: code,
          phoneCode: resolved.kind === 'code' ? resolved.phoneCode : undefined,
          encryptedData: resolved.kind === 'encrypted' ? resolved.encryptedData : undefined,
          iv: resolved.kind === 'encrypted' ? resolved.iv : undefined,
          pendingSource: this.data.pendingSource,
          idempotencyKey: this.idempotencyKey
        },
        { headers: { 'Idempotency-Key': this.idempotencyKey } }
      );
      await this.persistCustomerSession(response);
      this.goChat(response.existingAttribution === true);
    } catch (error) {
      this.setData({ submitting: false, errorMessage: errorCopy(error) });
    }
  },

  async persistCustomerSession(response) {
    if (!response || !response.token) return;
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

  goChat(existingService) {
    const path = '/packages/assistant/chat/chat';
    if (existingService) {
      wx.redirectTo({ url: path });
    } else if (this.data.token) {
      wx.redirectTo({ url: path + '?entryCode=' + encodeURIComponent(this.data.token) });
    }
  },

  onRetry() {
    this.resolveCode();
  },

  onBack() {
    const pages = getCurrentPages();
    if (pages && pages.length > 1) {
      wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) });
      return;
    }
    wx.switchTab({ url: '/pages/index/index' });
  }
});
