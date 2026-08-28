const api = require('../../../utils/api.js');
const {
  DEFAULT_PAGE_SIZE,
  appendQuery,
  parsePagination,
  mergePage,
  listFooterText,
} = require('../../../utils/list-pagination.js');

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
    eligibleCount: 0,
    totalCount: 0,
    page: 1,
    hasMore: false,
    loadingMore: false,
    footerText: '',
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
    this.load({ reset: true });
  },

  onLoadMore() {
    this.load({ reset: false });
  },

  async load(options) {
    const reset = !options || options.reset !== false;
    if (this._fetching) return;
    if (!reset && (this.data.loadingMore || !this.data.hasMore)) return;
    this._fetching = true;
    const page = reset ? 1 : Number(this.data.page || 1);
    if (reset) this.setData({ loading: true, error: '', loadingMore: false });
    else this.setData({ loadingMore: true, error: '', footerText: listFooterText(true, true, this.data.items.length) });
    try {
      const focus = this.data.focus;
      const path = appendQuery('/miniprogram/enterprise-staff', {
        role: focus === 'designer' || focus === 'measurer' ? focus : '',
        page,
        limit: DEFAULT_PAGE_SIZE,
      });
      const result = await api.request(path, 'GET');
      const payload = result.data || {};
      const items = mergePage(this.data.items, payload.items || [], reset);
      const summary = payload.summary || {};
      const pagination = parsePagination(payload);
      const eligibleCount = Number(summary.eligibleCount || 0);
      const total = Number(summary.total != null ? summary.total : pagination.total);
      this.setData({
        loading: false,
        loadingMore: false,
        items,
        page: page + 1,
        hasMore: pagination.hasMore,
        footerText: listFooterText(false, pagination.hasMore, items.length),
        summaryLine: `可派 ${eligibleCount} 人 · 共 ${total} 人`,
        eligibleCount,
        totalCount: total,
        emptyRoleLabel: emptyRoleLabel(focus),
      });
    } catch (error) {
      this.setData({
        loading: false,
        loadingMore: false,
        error: (error && (error.error || error.message)) || '人员名册加载失败，请检查网络后重试',
        items: reset ? [] : this.data.items,
        summaryLine: reset ? '可派 0 人' : this.data.summaryLine,
        footerText: listFooterText(false, this.data.hasMore, reset ? 0 : this.data.items.length),
      });
    } finally {
      this._fetching = false;
    }
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
      items: [],
      page: 1,
    }, () => this.load({ reset: true }));
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
      const eligibleDelta = (next.assignmentEligible ? 1 : 0) - (item.assignmentEligible ? 1 : 0);
      const eligibleCount = Math.max(0, Number(this.data.eligibleCount || 0) + eligibleDelta);
      this.setData({
        items,
        eligibleCount,
        summaryLine: `可派 ${eligibleCount} 人 · 共 ${this.data.totalCount} 人`,
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
