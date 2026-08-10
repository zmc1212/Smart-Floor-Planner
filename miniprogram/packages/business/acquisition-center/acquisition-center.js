const api = require('../../../utils/api.js');

const AUTO_REFRESH_INTERVAL = 30 * 1000;

const COMMISSION_STATUS_LABELS = {
  pending_settlement: '待结算',
  paid: '已发放',
  voided: '已作废'
};

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatTaskTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  if (date.toDateString() === now.toDateString()) return `今天 ${time}`;
  return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
}

function decorateTask(task) {
  const commission = task.commission || null;
  return {
    ...task,
    taskTime: formatTaskTime(task.acquiredAt || task.createdAt),
    confirmedTime: formatDateTime(task.acquiredAt),
    measurerName: task.measurer && (task.measurer.displayName || task.measurer.username) || '测量员',
    commissionAmountLabel: commission ? `¥${Number(commission.amount || 0).toFixed(2)}` : '尚未生成',
    commissionStatusLabel: commission ? (COMMISSION_STATUS_LABELS[commission.status] || commission.status) : '尚未生成'
  };
}

function buildSummary(role, summary) {
  const safe = summary || {};
  if (role === 'designer') {
    return [
      { key: 'pending', label: '待我确认', value: Number(safe.pendingCount || 0), unit: '项' },
      { key: 'month', label: '本月完成', value: Number(safe.confirmedThisMonth || 0), unit: '项' }
    ];
  }
  return [
    { key: 'pending', label: '待确认', value: Number(safe.pendingCount || 0), unit: '项' },
    { key: 'confirmed', label: '已完成', value: Number(safe.confirmedCount || 0), unit: '项' },
    { key: 'amount', label: '待结算', value: `¥${Number(safe.pendingSettlementAmount || 0).toFixed(2)}`, unit: '' }
  ];
}

Page({
  data: {
    navigationTop: 47,
    navigationHeight: 32,
    navigationRight: 96,
    leadId: '',
    role: '',
    roleSubtitle: '',
    tabs: [],
    status: 'pending_confirmation',
    summaryItems: [],
    tasks: [],
    loading: true,
    loadingMore: false,
    refreshing: false,
    errorMessage: '',
    page: 1,
    pageSize: 20,
    hasMore: true,
    confirmingId: '',
    designerProfile: null,
    showDesignerSheet: false
  },

  onLoad(options) {
    this.syncNavigationMetrics();
    this.setData({ leadId: options && options.leadId ? String(options.leadId) : '' });
  },

  onShow() {
    this._pageVisible = true;
    this.fetchTasks(true);
    this.startAutoRefresh();
  },

  onHide() {
    this._pageVisible = false;
    this.stopAutoRefresh();
  },

  onUnload() {
    this._pageVisible = false;
    this.stopAutoRefresh();
  },

  syncNavigationMetrics() {
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const menuRect = wx.getMenuButtonBoundingClientRect();
    this.setData({
      navigationTop: menuRect.top || windowInfo.statusBarHeight || 0,
      navigationHeight: menuRect.height || 32,
      navigationRight: Math.max(96, windowInfo.windowWidth - menuRect.left + 8)
    });
  },

  async fetchTasks(reset = false) {
    if (this._fetchPromise) return this._fetchPromise;
    if (this.data.loadingMore || (!reset && !this.data.hasMore)) return;
    this._fetchPromise = this._fetchTasks(reset);
    try {
      return await this._fetchPromise;
    } finally {
      this._fetchPromise = null;
    }
  },

  async _fetchTasks(reset = false) {
    const page = reset ? 1 : this.data.page;
    this.setData(reset
      ? { loading: true, errorMessage: '' }
      : { loadingMore: true, errorMessage: '' });
    try {
      const result = await api.request(
        `/acquisition-tasks?status=${this.data.status}&page=${page}&limit=${this.data.pageSize}`,
        'GET'
      );
      if (!result.success) throw new Error(result.error || '获客协作任务加载失败');
      const role = result.role || this.data.role;
      const tasks = (result.data || []).map(decorateTask);
      const nextTasks = reset ? tasks : this.data.tasks.concat(tasks);
      const tabs = role === 'designer'
        ? [
            { key: 'pending_confirmation', label: '待确认' },
            { key: 'confirmed', label: '已完成' }
          ]
        : [
            { key: 'pending_confirmation', label: '等待确认' },
            { key: 'confirmed', label: '已完成' }
          ];

      this.setData({
        role,
        roleSubtitle: role === 'designer' ? '确认客户已添加微信，完成交接' : '跟进客户微信交接与获客奖励',
        tabs,
        summaryItems: buildSummary(role, result.summary),
        designerProfile: role === 'measurer' ? (result.designerProfile || null) : null,
        tasks: nextTasks,
        page: page + 1,
        hasMore: tasks.length === this.data.pageSize,
        loading: false,
        loadingMore: false
      });

      if (
        reset &&
        this.data.leadId &&
        !nextTasks.some((item) => String(item.leadId) === this.data.leadId) &&
        this.data.status === 'pending_confirmation' &&
        !this._deepLinkFallbackTried
      ) {
        this._deepLinkFallbackTried = true;
        this.setData({ status: 'confirmed' });
        await this._fetchTasks(true);
      }
    } catch (error) {
      this.setData({
        loading: false,
        loadingMore: false,
        errorMessage: (error && error.error) || (error && error.message) || '网络异常，请稍后重试'
      });
    }
  },

  startAutoRefresh() {
    this.stopAutoRefresh();
    this._autoRefreshTimer = setInterval(() => {
      if (!this._pageVisible || this.data.loading || this.data.loadingMore || this.data.refreshing) return;
      this.fetchTasks(true);
    }, AUTO_REFRESH_INTERVAL);
  },

  stopAutoRefresh() {
    if (!this._autoRefreshTimer) return;
    clearInterval(this._autoRefreshTimer);
    this._autoRefreshTimer = null;
  },

  async onRefresh() {
    if (this.data.refreshing) return;
    this.setData({ refreshing: true });
    try {
      await this.fetchTasks(true);
    } finally {
      this.setData({ refreshing: false });
    }
  },

  onBack() {
    wx.navigateBack({ delta: 1, fail: () => wx.switchTab({ url: '/pages/mine/mine' }) });
  },

  onTabChange(event) {
    const status = event.currentTarget.dataset.status;
    if (!status || status === this.data.status) return;
    this._deepLinkFallbackTried = true;
    this.setData({ status, tasks: [], page: 1, hasMore: true });
    this.fetchTasks(true);
  },

  onLoadMore() {
    this.fetchTasks(false);
  },

  onRetry() {
    this.fetchTasks(true);
  },

  onOpenLead(event) {
    const leadId = event.currentTarget.dataset.id;
    if (leadId) wx.navigateTo({ url: `/packages/business/lead-detail/lead-detail?id=${leadId}` });
  },

  onOpenCommission() {
    wx.navigateTo({ url: '/packages/business/commission-records/commission-records' });
  },

  onOpenDesigner() {
    if (!this.data.designerProfile) return;
    this.setData({ showDesignerSheet: true });
  },

  onCloseDesignerSheet() {
    this.setData({ showDesignerSheet: false });
  },

  onRetryDesignerProfile() {
    this.fetchTasks(true);
  },

  onConfirm(event) {
    const leadId = String(event.currentTarget.dataset.id || '');
    if (!leadId || this.data.confirmingId) return;
    wx.showModal({
      title: '确认客户已添加微信',
      content: '确认后将认定测量员已完成本次获客交接，并生成一条待结算获客提成。此操作不会改变客户线索的量房或设计进度。',
      confirmText: '确认交接',
      success: async (modalResult) => {
        if (!modalResult.confirm) return;
        this.setData({ confirmingId: leadId });
        try {
          await api.request(`/leads/${leadId}/acquire`, 'POST');
          wx.showToast({ title: '交接已确认', icon: 'success' });
        } catch (error) {
          const message = (error && error.error) || '确认失败，请刷新重试';
          wx.showToast({ title: message.includes('已确认') ? '交接已被确认，正在刷新' : message, icon: 'none' });
        } finally {
          this.setData({ confirmingId: '' });
          await this.fetchTasks(true);
        }
      }
    });
  }
});

module.exports = { decorateTask, buildSummary, formatDateTime, formatTaskTime };
