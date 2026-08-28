const api = require('../../../utils/api.js');
const {
  ACTION_LABELS,
  REASON_ACTIONS,
  formatDateTime,
  validateReason,
  decorateEnterprise,
} = require('../enterprise-review-model.js');

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
    navigationRight: Math.max(94, Number(windowInfo.windowWidth || 390) - menuLeft + 10),
  };
}

function mapEvents(events) {
  return (events || []).map((item) => ({
    ...item,
    actionLabel: ACTION_LABELS[item.action] || item.action,
    createdLabel: formatDateTime(item.createdAt),
  }));
}

Page({
  data: {
    navigationTop: 24,
    navigationHeight: 32,
    navigationRight: 96,
    enterpriseId: '',
    loading: true,
    error: '',
    enterprise: {},
    events: [],
    approveLabel: '通过',
    submitting: false,
    reasonVisible: false,
    reasonOpen: false,
    reasonTitle: '',
    reasonConfirm: '',
    reasonDraft: '',
    reasonAction: '',
  },

  onLoad(query) {
    this.setData({
      ...navigationMetrics(),
      enterpriseId: String((query && query.id) || ''),
    });
    this.load();
  },

  onBack() {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    if (pages.length > 1) {
      wx.navigateBack();
      return;
    }
    wx.reLaunch({ url: '/packages/platform/enterprise-review/enterprise-review' });
  },

  async load() {
    if (!this.data.enterpriseId) {
      this.setData({ loading: false, error: '缺少企业编号' });
      return;
    }
    this.setData({ loading: true, error: '' });
    try {
      const result = await api.request(
        `/miniprogram/platform/enterprises/${encodeURIComponent(this.data.enterpriseId)}`,
        'GET'
      );
      if (!result.success) {
        throw new Error(result.error || '企业详情加载失败');
      }
      const enterprise = decorateEnterprise(result.data || {});
      this.setData({
        loading: false,
        enterprise,
        events: mapEvents(enterprise.statusEvents),
        approveLabel: enterprise.status === 'rejected' ? '直接通过' : '通过',
      });
    } catch (error) {
      this.setData({
        loading: false,
        error: (error && error.error) || error.message || '企业详情加载失败，请检查网络后重试',
        enterprise: {},
        events: [],
      });
    }
  },

  callPhone(event) {
    const phone = String(event.currentTarget.dataset.phone || '');
    if (!phone) return;
    wx.makePhoneCall({ phoneNumber: phone });
  },

  approveEnterprise() {
    if (this.data.submitting) return;
    const name = this.data.enterprise.name || '该企业';
    wx.showModal({
      title: '确认通过',
      content: `通过后将开通 ${name} 负责人账号`,
      confirmText: '通过',
      success: (res) => {
        if (res.confirm) this.submitStatus('approve');
      },
    });
  },

  enableEnterprise() {
    if (this.data.submitting) return;
    wx.showModal({
      title: '确认启用',
      content: '启用后该企业可重新登录工作台',
      confirmText: '启用',
      success: (res) => {
        if (res.confirm) this.submitStatus('enable');
      },
    });
  },

  resubmitEnterprise() {
    if (this.data.submitting) return;
    wx.showModal({
      title: '重新提交审核',
      content: '将把该企业改回待审核',
      confirmText: '提交',
      success: (res) => {
        if (res.confirm) this.submitStatus('resubmit_review');
      },
    });
  },

  openReasonSheet(event) {
    const action = event.currentTarget.dataset.action;
    const meta = REASON_ACTIONS[action];
    if (!meta || this.data.submitting) return;
    this.setData({
      reasonVisible: true,
      reasonOpen: false,
      reasonTitle: meta.title,
      reasonConfirm: meta.confirm,
      reasonDraft: '',
      reasonAction: action,
    });
    wx.nextTick(() => this.setData({ reasonOpen: true }));
  },

  closeReasonSheet() {
    if (!this.data.reasonVisible) return;
    this.setData({ reasonOpen: false });
    setTimeout(() => {
      this.setData({
        reasonVisible: false,
        reasonDraft: '',
        reasonAction: '',
      });
    }, 260);
  },

  onReasonInput(event) {
    this.setData({ reasonDraft: event.detail.value || '' });
  },

  submitReason() {
    const checked = validateReason(this.data.reasonDraft);
    if (!checked.ok) {
      wx.showToast({ title: checked.message, icon: 'none' });
      return;
    }
    this.submitStatus(this.data.reasonAction, checked.reason);
  },

  async submitStatus(action, reason) {
    if (!action || this.data.submitting) return;
    this.setData({ submitting: true });
    try {
      const result = await api.request(
        `/miniprogram/platform/enterprises/${encodeURIComponent(this.data.enterpriseId)}/status`,
        'POST',
        reason ? { action, reason } : { action }
      );
      if (!result.success) {
        throw new Error(result.error || '操作失败');
      }
      wx.showToast({ title: '已提交', icon: 'success' });
      if (this.data.reasonVisible) this.closeReasonSheet();
      const enterprise = decorateEnterprise(result.data || {});
      this.setData({
        enterprise,
        events: mapEvents(enterprise.statusEvents),
        approveLabel: enterprise.status === 'rejected' ? '直接通过' : '通过',
      });
    } catch (error) {
      wx.showToast({
        title: (error && error.error) || error.message || '操作失败',
        icon: 'none',
      });
    } finally {
      this.setData({ submitting: false });
    }
  },

  noop() {},
});
