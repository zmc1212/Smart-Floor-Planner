const api = require('../../../utils/api.js');
const { leaveScanLanding } = require('../../../utils/identity-navigation.js');
const {
  customerProjectFromApiResponse,
  hasDesignerContact,
} = require('../../../utils/designerContact.js');

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
  const raw = error && (error.error || error.message);
  if (code === 'pending_source_invalid') return '本次服务领取已超时，请重新扫描服务码。';
  if (code === 'wechat_user_mismatch') return '当前微信与登录账号不一致，请切换账号后重试。';
  if (code === 'customer_context_required') return '请先切换到客户身份后再领取服务。';
  if (
    code === 'staff_phone_linked_to_other_user' ||
    raw === 'STAFF_PHONE_LINKED_TO_OTHER_USER'
  ) {
    return '该手机号已绑定其他微信账号，请换本人手机号授权，或联系企业管理员处理。';
  }
  if (
    code === 'wechat_identity_conflict' ||
    raw === 'WECHAT_IDENTITY_ALREADY_LINKED' ||
    raw === 'WECHAT_USER_ALREADY_LINKED'
  ) {
    return '当前微信已绑定其他账号，请换用本人微信重试，或联系企业管理员处理。';
  }
  if (typeof raw === 'string' && raw && !/^[A-Z][A-Z0-9_]+$/.test(raw)) {
    return raw;
  }
  return '服务领取暂未完成，请检查网络后重试。';
}

function applyClaimResult(page, response) {
  if (response.existingAttribution || (response.data && response.data.existingAttribution)) {
    page.setData({
      submitting: false,
      pageState: 'existing',
      navTitle: navTitleFor('existing'),
      pendingSource: '',
      designerProfile: null,
      lead: response.data && response.data.lead || null,
      errorMessage: ''
    });
    hydrateExistingAttribution(page);
    return;
  }
  const designerProfile = response.data && response.data.designerProfile || null;
  const contactAvailable = canContactDesigner(designerProfile);
  page.setData({
    submitting: false,
    pageState: designerProfile ? 'success' : 'pending',
    navTitle: navTitleFor(designerProfile ? 'success' : 'pending'),
    designerProfile,
    canContactDesigner: contactAvailable,
    showContactSheet: Boolean(designerProfile && contactAvailable),
    lead: response.data && response.data.lead || null,
  });
}

function canContactDesigner(designer) {
  return hasDesignerContact(designer);
}

function resolveErrorMessage(error) {
  const code = error && error.code;
  const expired = code === 'code_rotated' || code === 'code_disabled' || code === 'code_expired';
  if (expired) return '该服务码已更新，请联系推荐人或现场员工出示最新服务码。';
  return '服务码暂时无法识别，请重新扫码或稍后重试。';
}

const EXISTING_STAGE_LABELS = {
  new: '服务准备中',
  contacted: '家装设计顾问沟通中',
  measuring: '量房安排中',
  measured: '量房已完成',
  assigned: '家装设计顾问沟通中',
  designing: '家装设计顾问沟通中',
  quoting: '方案沟通中',
};

function maskCustomerName(name) {
  const raw = String(name || '').trim();
  if (!raw) return '客户';
  if (raw.length === 1) return `${raw}*`;
  return `${raw.charAt(0)}*`;
}

function formatRelativeUpdate(value) {
  if (!value) return '最近更新：待同步';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '最近更新：待同步';
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return '最近更新：今天';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return '最近更新：昨天';
  return `最近更新：${date.getMonth() + 1}月${date.getDate()}日`;
}

function existingStageLabel(lead) {
  if (!lead) return '服务进行中';
  return EXISTING_STAGE_LABELS[lead.status] || '服务进行中';
}

function existingStageIndex(lead, serviceStageLabel) {
  const status = lead && String(lead.status || '').toLowerCase();
  if (status === 'measuring' || status === 'measured') return 1;
  if (status === 'assigned' || status === 'designing' || status === 'quoting') return 2;
  const label = String(serviceStageLabel || '');
  if (label.includes('量房') || label.includes('测量')) return 1;
  if (label.includes('设计') || label.includes('方案')) return 2;
  return 0;
}

function navTitleFor(state) {
  if (state === 'phoneAuth') return '手机号授权';
  if (state === 'success') return '服务已建立';
  if (state === 'pending') return '服务匹配中';
  if (state === 'existing') return '服务已存在';
  return '手机号授权';
}

async function hydrateExistingAttribution(page) {
  const lead = page.data.lead;
  const leadId = lead && lead.id;
  const app = getApp();
  const fallbackName = maskCustomerName(
    (app.globalData.userInfo && app.globalData.userInfo.nickname) || (lead && lead.name)
  );
  const fallbackStage = existingStageLabel(lead);
  const fallbackUpdate = formatRelativeUpdate(lead && lead.createdAt);
  if (!leadId) {
    page.setData({
      existingServiceLabel: fallbackName,
      serviceStageLabel: fallbackStage,
      existingStageIndex: existingStageIndex(lead, fallbackStage),
      lastUpdateLabel: fallbackUpdate,
    });
    return;
  }
  try {
    const result = await api.request(`/miniprogram/customer-projects/${encodeURIComponent(leadId)}`, 'GET');
    const project = customerProjectFromApiResponse(result);
    const updatedAt = (project.appointment && project.appointment.updatedAt)
      || (project.formalFloorPlan && project.formalFloorPlan.updatedAt)
      || (lead && lead.createdAt);
    page.setData({
      existingServiceLabel: fallbackName,
      serviceStageLabel: project.serviceStageLabel || fallbackStage,
      existingStageIndex: existingStageIndex(lead, project.serviceStageLabel || fallbackStage),
      lastUpdateLabel: formatRelativeUpdate(updatedAt),
      designerProfile: project.designer || page.data.designerProfile || null,
      canContactDesigner: canContactDesigner(project.designer || page.data.designerProfile),
    });
  } catch (error) {
    page.setData({
      existingServiceLabel: fallbackName,
      serviceStageLabel: fallbackStage,
      existingStageIndex: existingStageIndex(lead, fallbackStage),
      lastUpdateLabel: fallbackUpdate,
    });
  }
}

Page({
  data: {
    navigationTop: 24,
    navigationHeight: 32,
    navigationRight: 96,
    pageState: 'resolving',
    navTitle: '手机号授权',
    promotionToken: '',
    pendingSource: '',
    submitting: false,
    errorMessage: '',
    claimKind: '',
    designerProfile: null,
    canContactDesigner: false,
    showContactSheet: false,
    lead: null,
    existingServiceLabel: '',
    serviceStageLabel: '',
    existingStageIndex: 0,
    lastUpdateLabel: ''
  },

  onLoad(options) {
    const promotionToken = safeToken(options.token || options.scene);
    this.setData({ ...navigationMetrics(), promotionToken });
    this.idempotencyKey = `claim-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    this.resolvePromotionCode();
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
          lead: response.data.lead || null,
          errorMessage: ''
        });
        hydrateExistingAttribution(this);
        return;
      }
      if (!response.data.pendingSource) {
        throw new Error('服务码类型无效');
      }
      this.setData({
        pageState: 'phoneAuth',
        navTitle: navTitleFor('phoneAuth'),
        pendingSource: response.data.pendingSource,
        claimKind: response.data.kind,
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

  onSkipAuth() {
    if (this.data.submitting) return;
    this.onLater();
  },

  onLater() {
    wx.navigateBack({ delta: 1, fail: () => wx.switchTab({ url: '/pages/index/index' }) });
  },

  async onGetPhoneNumber(event) {
    if (this.data.pageState !== 'phoneAuth' || this.data.submitting) return;
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

  onOpenContactSheet() {
    const designer = this.data.designerProfile;
    if (!hasDesignerContact(designer)) {
      wx.showToast({ title: '家装设计顾问联系方式暂未提供', icon: 'none' });
      return;
    }
    this.setData({ showContactSheet: true });
  },

  closeContactSheet() {
    this.setData({ showContactSheet: false });
  },

  onOpenProject() {
    const leadId = this.data.lead && this.data.lead.id;
    if (leadId) {
      wx.navigateTo({ url: `/packages/business/customer-project/customer-project?leadId=${encodeURIComponent(leadId)}` });
      return;
    }
    wx.switchTab({ url: '/pages/mine/mine' });
  },

  onOpenServiceNeeds() {
    const leadId = this.data.lead && this.data.lead.id;
    if (!leadId) {
      wx.showToast({ title: '服务档案正在同步，请稍后再试', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: `/packages/business/service-needs/service-needs?leadId=${encodeURIComponent(leadId)}`,
    });
  },

  onContactDesigner() {
    this.onOpenContactSheet();
  },

  onRetry() {
    this.resolvePromotionCode();
  },

  onBack() {
    if (this.data.submitting) return;
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    if (pages && pages.length > 1) {
      wx.navigateBack({
        fail: () => leaveScanLanding(currentSignedIdentity())
      });
      return;
    }
    leaveScanLanding(currentSignedIdentity());
  }
});
