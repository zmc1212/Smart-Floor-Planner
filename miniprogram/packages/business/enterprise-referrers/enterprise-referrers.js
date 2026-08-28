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
  if (focus === 'active' || focus === 'disabled' || focus === 'exited') return focus;
  return 'all';
}

function emptyStatusLabel(focus) {
  if (focus === 'active') return '活动推荐人';
  if (focus === 'disabled') return '已停用推荐人';
  if (focus === 'exited') return '已退出推荐人';
  return '已入驻推荐人';
}

function emptyDesc(focus, searchQuery) {
  if (searchQuery) return '可更换关键词或切换上方状态';
  if (focus === 'active') return '出示入驻码邀请推荐人加入本企业';
  if (focus === 'disabled') return '停用后的推荐人会显示在这里';
  if (focus === 'exited') return '自行退出的推荐人会显示在这里';
  return '出示入驻码邀请推荐人加入本企业';
}

function confirmModal(options) {
  const confirmText = String(options.confirmText || '确定').slice(0, 4);
  return new Promise((resolve) => {
    wx.showModal({
      title: options.title,
      content: options.content,
      confirmText,
      confirmColor: options.destructive ? '#E11D48' : '#00C365',
      cancelText: '取消',
      success: (result) => resolve(Boolean(result.confirm)),
      fail: () => {
        wx.showToast({ title: '确认弹窗打开失败，请重试', icon: 'none' });
        resolve(false);
      },
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
    searchDraft: '',
    searchQuery: '',
    statusChips: [
      { key: 'all', label: '全部' },
      { key: 'active', label: '活动' },
      { key: 'disabled', label: '已停用' },
      { key: 'exited', label: '已退出' },
    ],
    items: [],
    summaryLine: '共 0 人',
    emptyStatusLabel: '已入驻推荐人',
    emptyDesc: '出示入驻码邀请推荐人加入本企业',
  },

  onLoad(options) {
    const focus = normalizeFocus(options && options.focus);
    this.setData({
      ...navigationMetrics(),
      focus,
      emptyStatusLabel: emptyStatusLabel(focus),
      emptyDesc: emptyDesc(focus, ''),
    });
  },

  onShow() {
    this.load();
  },

  onUnload() {
    if (this._searchTimer) clearTimeout(this._searchTimer);
  },

  onBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) });
  },

  selectChip(event) {
    const raw = event.currentTarget.dataset.key;
    const focus = normalizeFocus(raw);
    if (focus === this.data.focus) return;
    this.setData({
      focus,
      emptyStatusLabel: emptyStatusLabel(focus),
      emptyDesc: emptyDesc(focus, this.data.searchQuery),
    }, () => this.load());
  },

  onSearchInput(event) {
    const value = (event.detail && event.detail.value) || '';
    this.setData({ searchDraft: value });
    if (this._searchTimer) clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => {
      this.applySearch(value);
    }, 300);
  },

  onSearchConfirm(event) {
    if (this._searchTimer) clearTimeout(this._searchTimer);
    this.applySearch((event.detail && event.detail.value) || this.data.searchDraft);
  },

  applySearch(value) {
    const next = String(value || '').trim();
    if (next === this.data.searchQuery) return;
    this.setData({
      searchQuery: next,
      emptyStatusLabel: emptyStatusLabel(this.data.focus),
      emptyDesc: emptyDesc(this.data.focus, next),
    }, () => this.load({ quiet: true }));
  },

  async load(options) {
    const quiet = Boolean(options && options.quiet);
    if (!quiet) this.setData({ loading: true, error: '' });
    else this.setData({ error: '' });
    try {
      const focus = this.data.focus;
      const query = String(this.data.searchQuery || '').trim();
      const params = [];
      if (focus === 'active' || focus === 'disabled' || focus === 'exited') {
        params.push(`status=${encodeURIComponent(focus)}`);
      }
      if (query) params.push(`query=${encodeURIComponent(query)}`);
      const suffix = params.length ? `?${params.join('&')}` : '';
      const result = await api.request(`/miniprogram/enterprise-referrers${suffix}`, 'GET');
      const payload = result.data || {};
      const items = payload.items || [];
      const summary = payload.summary || {};
      const total = Number(summary.total != null ? summary.total : items.length);
      const activeCount = Number(summary.activeCount || 0);
      this.setData({
        loading: false,
        items,
        summaryLine: query
          ? `匹配 ${total} 人`
          : focus === 'all'
            ? `活动 ${activeCount} 人 · 共 ${total} 人`
            : `共 ${total} 人`,
        emptyStatusLabel: emptyStatusLabel(focus),
        emptyDesc: emptyDesc(focus, query),
      });
    } catch (error) {
      this.setData({
        loading: false,
        error: (error && (error.error || error.message)) || '推荐人名册加载失败，请检查网络后重试',
        items: quiet ? this.data.items : [],
        summaryLine: '共 0 人',
      });
    }
  },

  callReferrer(event) {
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

  async disableReferrer(event) {
    const item = event.currentTarget.dataset.item;
    if (!item || !item.id || item.action !== 'disable' || this.data.acting) return;

    const accepted = await confirmModal({
      title: `停用 ${item.displayName} 的后续扫码`,
      content: '停用后该推荐人不能再出示活动推广码获客；历史线索和提成记录保持不变。',
      confirmText: '确认停用',
      destructive: true,
    });
    if (!accepted) return;

    this.setData({ acting: true });
    try {
      await api.request(
        `/miniprogram/enterprise-referrers/${encodeURIComponent(item.id)}/disable`,
        'POST',
        {}
      );
      wx.showToast({ title: '已停用后续扫码', icon: 'success' });
      await this.load({ quiet: true });
    } catch (error) {
      wx.showToast({
        title: (error && (error.error || error.message)) || '停用失败',
        icon: 'none',
      });
    } finally {
      this.setData({ acting: false });
    }
  },
});
