const api = require('../../../utils/api.js');

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

function normalizeFocus(value) {
  const focus = String(value || '').trim();
  if (focus === 'designer' || focus === 'measurer') return focus;
  return 'all';
}

function emptyRoleLabel(focus) {
  if (focus === 'designer') return '可派家装设计顾问';
  if (focus === 'measurer') return '可派家装现场顾问';
  return '家装设计顾问或家装现场顾问';
}

function confirmModal(options) {
  return new Promise((resolve) => {
    wx.showModal({
      title: options.title,
      content: options.content,
      confirmText: options.confirmText || '确定',
      confirmColor: options.destructive ? '#E11D48' : '#00C365',
      cancelText: '取消',
      success: (result) => resolve(Boolean(result.confirm)),
      fail: () => resolve(false),
    });
  });
}

Page({
  data: {
    navigationTop: 24,
    navigationHeight: 32,
    navigationRight: 96,
    loading: true,
    error: '',
    acting: false,
    focus: 'all',
    roleChips: [
      { key: 'all', label: '全部' },
      { key: 'designer', label: '家装设计顾问' },
      { key: 'measurer', label: '家装现场顾问' },
    ],
    items: [],
    summaryLine: '可派 0 人',
    emptyRoleLabel: '家装设计顾问或家装现场顾问',
  },

  onLoad(options) {
    const focus = normalizeFocus(options && options.focus);
    this.setData({
      ...navigationMetrics(),
      focus,
      emptyRoleLabel: emptyRoleLabel(focus),
    });
  },

  onShow() {
    this.load();
  },

  onBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) });
  },

  selectChip(event) {
    const raw = event.currentTarget.dataset.key;
    const focus = raw === 'designer' || raw === 'measurer' ? raw : 'all';
    if (focus === this.data.focus) return;
    this.setData({
      focus,
      emptyRoleLabel: emptyRoleLabel(focus),
    }, () => this.load());
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const focus = this.data.focus;
      const query = focus === 'designer' || focus === 'measurer' ? `?role=${encodeURIComponent(focus)}` : '';
      const result = await api.request(`/miniprogram/enterprise-staff${query}`, 'GET');
      const payload = result.data || {};
      const items = payload.items || [];
      const summary = payload.summary || {};
      const eligibleCount = Number(summary.eligibleCount || 0);
      this.setData({
        loading: false,
        items,
        summaryLine: `可派 ${eligibleCount} 人 · 共 ${items.length} 人`,
        emptyRoleLabel: emptyRoleLabel(focus),
      });
    } catch (error) {
      this.setData({
        loading: false,
        error: (error && (error.error || error.message)) || '人员名册加载失败，请检查网络后重试',
        items: [],
        summaryLine: '可派 0 人',
      });
    }
  },

  callStaff(event) {
    const item = event.currentTarget.dataset.item;
    const phone = item && String(item.phone || '').trim();
    if (!phone) {
      wx.showToast({ title: '暂未提供电话', icon: 'none' });
      return;
    }
    wx.makePhoneCall({ phoneNumber: phone });
  },

  openJoinCodes() {
    wx.navigateTo({ url: '/packages/business/enterprise-join-codes/enterprise-join-codes' });
  },

  async toggleAssignment(event) {
    const item = event.currentTarget.dataset.item;
    if (!item || !item.id || !item.action || this.data.acting) return;

    const pausing = item.action === 'pause';
    const accepted = await confirmModal({
      title: pausing ? '暂停派单' : '恢复派单',
      content: pausing
        ? `确认暂停「${item.displayName}」的自动派单？暂停后不会再分到新线索。`
        : `确认恢复「${item.displayName}」的自动派单？恢复后将重试待派队列。`,
      confirmText: pausing ? '暂停派单' : '恢复派单',
      destructive: pausing,
    });
    if (!accepted) return;

    this.setData({ acting: true });
    try {
      const result = await api.request(
        `/miniprogram/enterprise-staff/${encodeURIComponent(item.id)}/assignment`,
        'PATCH',
        { assignmentPaused: pausing }
      );
      const next = result.data || {};
      const items = (this.data.items || []).map((row) => (row.id === next.id ? next : row));
      const eligibleCount = items.filter((row) => row.assignmentEligible).length;
      this.setData({
        items,
        summaryLine: `可派 ${eligibleCount} 人 · 共 ${items.length} 人`,
      });
      wx.showToast({
        title: pausing ? '已暂停派单' : '已恢复派单',
        icon: 'success',
      });
    } catch (error) {
      wx.showToast({
        title: (error && (error.error || error.message)) || '更新失败',
        icon: 'none',
      });
    } finally {
      this.setData({ acting: false });
    }
  },
});
