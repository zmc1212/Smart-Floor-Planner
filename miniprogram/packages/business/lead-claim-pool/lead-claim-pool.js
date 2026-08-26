const api = require('../../../utils/api.js');
const notification = require('../../../utils/notification.js');

function navigationMetrics() {
  const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
  let menuRect = null;
  try { menuRect = wx.getMenuButtonBoundingClientRect(); } catch (error) { menuRect = null; }
  const menuLeft = Number((menuRect && menuRect.left) || windowInfo.windowWidth - 94);
  return {
    navigationTop: Number((menuRect && menuRect.top) || windowInfo.statusBarHeight || 24),
    navigationHeight: Number((menuRect && menuRect.height) || 32),
    navigationRight: Math.max(94, Number(windowInfo.windowWidth || 390) - menuLeft + 10),
  };
}

function createIdempotencyKey(leadId) {
  return `${leadId}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

Page({
  data: {
    navigationTop: 24,
    navigationHeight: 32,
    navigationRight: 96,
    loading: true,
    refreshing: false,
    error: '',
    rows: [],
    serverOffset: 0,
    capacity: null,
    settings: null,
    claimingId: '',
    reminderLoading: false,
  },

  onLoad() {
    this.setData(navigationMetrics());
  },

  onShow() {
    this.load();
    this.startPolling();
  },

  onHide() { this.stopPolling(); },
  onUnload() { this.stopPolling(); },

  startPolling() {
    this.stopPolling();
    this._poller = setInterval(() => this.load({ silent: true }), 3000);
    this._ticker = setInterval(() => this.tick(), 1000);
  },

  stopPolling() {
    if (this._poller) clearInterval(this._poller);
    if (this._ticker) clearInterval(this._ticker);
    this._poller = null;
    this._ticker = null;
  },

  tick() {
    const now = Date.now() + Number(this.data.serverOffset || 0);
    const rows = (this.data.rows || []).map((item) => ({
      ...item,
      displaySeconds: Math.max(0, Math.ceil((new Date(item.expiresAt).getTime() - now) / 1000)),
      canClaim: item.canClaim && new Date(item.expiresAt).getTime() > now,
    }));
    this.setData({ rows });
  },

  async load(options = {}) {
    if (this._loading) return;
    this._loading = true;
    if (!options.silent) this.setData({ loading: true, error: '' });
    try {
      const result = await api.request('/lead-claim-pool', 'GET');
      const offset = new Date(result.serverNow).getTime() - Date.now();
      const now = Date.now() + offset;
      const rows = ((result && result.data) || []).map((item) => ({
        ...item,
        displaySeconds: Math.max(0, Math.ceil((new Date(item.expiresAt).getTime() - now) / 1000)),
      }));
      this.setData({
        loading: false,
        refreshing: false,
        error: '',
        rows,
        serverOffset: offset,
        capacity: result.capacity || null,
        settings: result.settings || null,
      });
    } catch (error) {
      if (!options.silent) this.setData({ loading: false, refreshing: false, error: error.error || error.message || '抢单池加载失败' });
    } finally { this._loading = false; }
  },

  onRefresh() {
    this.setData({ refreshing: true });
    this.load();
  },

  onBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) wx.navigateBack();
    else wx.switchTab({ url: '/pages/index/index' });
  },

  async claim(event) {
    const leadId = String(event.currentTarget.dataset.id || '');
    const row = (this.data.rows || []).find((item) => String(item.id) === leadId);
    if (!row || !row.canClaim || this.data.claimingId) return;
    if (this.data.capacity && this.data.capacity.available === false) {
      wx.showToast({ title: '在手线索已达容量上限', icon: 'none' });
      return;
    }
    this.setData({ claimingId: leadId });
    try {
      const result = await api.request(`/leads/${encodeURIComponent(leadId)}/claim`, 'POST', {}, {
        headers: { 'Idempotency-Key': createIdempotencyKey(leadId) },
      });
      await new Promise((resolve) => wx.showModal({
        title: '抢单成功',
        content: `${(result.data && result.data.name) || '客户'}已转入你的客户线索，请尽快联系跟进。`,
        showCancel: false,
        confirmText: '查看客户',
        success: () => {
          wx.navigateTo({ url: `/packages/business/lead-detail/lead-detail?id=${encodeURIComponent(leadId)}` });
          resolve();
        },
        fail: resolve,
      }));
    } catch (error) {
      const message = error.code === 'lead_already_claimed'
        ? '手慢一步，这条线索已被其他家装设计顾问抢走'
        : error.error || error.message || '抢单失败，请重试';
      wx.showModal({ title: '未能抢到', content: message, showCancel: false, confirmText: '知道了' });
      await this.load({ silent: true });
    } finally { this.setData({ claimingId: '' }); }
  },

  async enableReminder() {
    if (this.data.reminderLoading) return;
    this.setData({ reminderLoading: true });
    try {
      await notification.refreshTemplateConfig();
      await notification.requestSubscribeKinds(['lead_claim_available']);
    } catch (error) {
      wx.showToast({ title: '提醒开启失败，请稍后重试', icon: 'none' });
    } finally { this.setData({ reminderLoading: false }); }
  },
});
