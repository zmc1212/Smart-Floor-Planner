const api = require('../../../utils/api.js');
const {
  STATUS_CHIPS,
  REASON_ACTIONS,
  validateReason,
  decorateEnterprise,
} = require('../enterprise-review-model.js');
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

const EMPTY_TITLES = {
  pending_approval: '暂无待审核企业',
  all: '暂无企业',
  rejected: '暂无已拒绝企业',
  disabled: '暂无已停用企业',
};

Page({
  data: {
    navigationTop: 24,
    navigationHeight: 32,
    navigationRight: 96,
    loading: true,
    error: '',
    statusChips: STATUS_CHIPS,
    statusFilter: 'pending_approval',
    searchDraft: '',
    searchQuery: '',
    subtitle: '待审核 0 家',
    emptyTitle: EMPTY_TITLES.pending_approval,
    emptyDesc: '可切换上方状态查看其他企业',
    enterprises: [],
    page: 1,
    hasMore: false,
    loadingMore: false,
    footerText: '',
    submitting: false,
    reasonVisible: false,
    reasonOpen: false,
    reasonTitle: '',
    reasonConfirm: '',
    reasonDraft: '',
    reasonAction: '',
    reasonEnterpriseId: '',
  },

  onLoad() {
    this.setData(navigationMetrics());
  },

  onShow() {
    const tabBar = typeof this.getTabBar === 'function' && this.getTabBar();
    if (tabBar && typeof tabBar.syncSelected === 'function') {
      tabBar.syncSelected();
    }
    this.load();
  },

  noop() {},

  selectChip(event) {
    const key = event.currentTarget.dataset.key;
    if (!key || key === this.data.statusFilter) return;
    this.setData({ statusFilter: key, enterprises: [], page: 1 });
    this.load();
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
    this.setData({ searchQuery: next, enterprises: [], page: 1 });
    this.load({ quiet: true, reset: true });
  },

  openRegistrationCode() {
    wx.navigateTo({
      url: '/packages/platform/registration-code/registration-code',
    });
  },

  onLoadMore() {
    this.load({ reset: false, quiet: true });
  },

  async load(options = {}) {
    const quiet = Boolean(options.quiet);
    const reset = options.reset !== false;
    if (this._fetching) return;
    if (!reset && (this.data.loadingMore || !this.data.hasMore)) return;
    this._fetching = true;
    const page = reset ? 1 : Number(this.data.page || 1);
    if (!quiet && reset) this.setData({ loading: true, error: '', loadingMore: false });
    else if (!reset) this.setData({ loadingMore: true, error: '', footerText: listFooterText(true, true, this.data.enterprises.length) });
    else this.setData({ error: '' });
    try {
      const status = this.data.statusFilter;
      const q = String(this.data.searchQuery || '').trim();
      const result = await api.request(appendQuery('/miniprogram/platform/enterprises', {
        status,
        q,
        page,
        limit: DEFAULT_PAGE_SIZE,
      }), 'GET');
      if (!result.success) {
        throw new Error(result.error || '审核列表加载失败');
      }
      const payload = result.data || {};
      const enterprises = mergePage(
        this.data.enterprises,
        (payload.enterprises || []).map(decorateEnterprise),
        reset
      );
      const pagination = parsePagination(payload);
      const chip = STATUS_CHIPS.find((item) => item.key === status);
      const total = pagination.total;
      this.setData({
        loading: false,
        loadingMore: false,
        enterprises,
        page: page + 1,
        hasMore: pagination.hasMore,
        footerText: listFooterText(false, pagination.hasMore, enterprises.length),
        subtitle: q
          ? `匹配 ${total} 家`
          : `${(chip && chip.label) || '企业'} ${total} 家`,
        emptyTitle: q ? '没有匹配的企业' : EMPTY_TITLES[status] || '暂无企业',
        emptyDesc: q ? '可更换关键词或切换上方状态' : '可切换上方状态查看其他企业',
      });
    } catch (error) {
      this.setData({
        loading: false,
        loadingMore: false,
        error: (error && error.error) || error.message || '审核列表加载失败，请检查网络后重试',
        enterprises: quiet && !reset ? this.data.enterprises : reset ? [] : this.data.enterprises,
        subtitle: reset ? '暂时无法读取' : this.data.subtitle,
        footerText: listFooterText(false, this.data.hasMore, reset ? 0 : this.data.enterprises.length),
      });
    } finally {
      this._fetching = false;
    }
  },

  openDetail(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({
      url: `/packages/platform/enterprise-review-detail/enterprise-review-detail?id=${encodeURIComponent(id)}`,
    });
  },

  callPhone(event) {
    const phone = String(event.currentTarget.dataset.phone || '');
    if (!phone) return;
    wx.makePhoneCall({ phoneNumber: phone });
  },

  approveEnterprise(event) {
    const id = event.currentTarget.dataset.id;
    const name = event.currentTarget.dataset.name || '该企业';
    if (!id || this.data.submitting) return;
    wx.showModal({
      title: '确认通过',
      content: `通过后将开通 ${name} 负责人账号`,
      confirmText: '通过',
      success: (res) => {
        if (res.confirm) this.submitStatus(id, 'approve');
      },
    });
  },

  openReasonSheet(event) {
    const id = event.currentTarget.dataset.id;
    const action = event.currentTarget.dataset.action;
    const meta = REASON_ACTIONS[action];
    if (!id || !meta || this.data.submitting) return;
    this.setData({
      reasonVisible: true,
      reasonOpen: false,
      reasonTitle: meta.title,
      reasonConfirm: meta.confirm,
      reasonDraft: '',
      reasonAction: action,
      reasonEnterpriseId: id,
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
        reasonEnterpriseId: '',
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
    this.submitStatus(this.data.reasonEnterpriseId, this.data.reasonAction, checked.reason);
  },

  async submitStatus(id, action, reason) {
    if (!id || this.data.submitting) return;
    this.setData({ submitting: true });
    try {
      const result = await api.request(
        `/miniprogram/platform/enterprises/${encodeURIComponent(id)}/status`,
        'POST',
        reason ? { action, reason } : { action }
      );
      if (!result.success) {
        throw new Error(result.error || '操作失败');
      }
      wx.showToast({ title: '已提交', icon: 'success' });
      if (this.data.reasonVisible) this.closeReasonSheet();
      await this.load({ reset: true });
    } catch (error) {
      wx.showToast({
        title: (error && error.error) || error.message || '操作失败',
        icon: 'none',
      });
    } finally {
      this.setData({ submitting: false });
    }
  },
});
