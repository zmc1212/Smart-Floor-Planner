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
    navigationRight: Math.max(94, Number(windowInfo.windowWidth || 390) - menuLeft + 10)
  };
}

function formatUpdatedAt(value) {
  const date = new Date(value || '');
  return Number.isNaN(date.getTime()) ? '状态更新中' : `${date.getMonth() + 1}月${date.getDate()}日更新`;
}

function formatCountdown(value) {
  const seconds = Math.max(0, Math.ceil((new Date(value || '').getTime() - Date.now()) / 1000));
  return `${Math.floor(seconds / 60)}分${seconds % 60}秒内可恢复`;
}

function withdrawnLabel(item) {
  const note = String(item.terminationNote || '').trim();
  if (!note || note === '测试记录') return '已撤回';
  return `${note} · 已撤回`;
}

function decorateItem(item) {
  return {
    ...item,
    updatedLabel: formatUpdatedAt(item.updatedAt),
    createdLabel: formatUpdatedAt(item.createdAt).replace('更新', '建档'),
    countdownLabel: item.canUndo ? formatCountdown(item.withdrawalDeadline) : '',
    withdrawnLabel: item.terminationType ? withdrawnLabel(item) : ''
  };
}

Page({
  data: {
    navigationTop: 24,
    navigationHeight: 32,
    navigationRight: 96,
    loading: true,
    error: '',
    enterpriseName: '',
    items: []
  },
  onLoad() {
    this.setData(navigationMetrics());
    this.load();
  },
  onShow() {
    this.load();
  },
  onUnload() {
    if (this._timer) clearInterval(this._timer);
  },
  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const result = await api.request('/miniprogram/referrer-progress', 'GET');
      const items = ((result.data && result.data.items) || []).map(decorateItem);
      this.setData({
        enterpriseName: (result.data && result.data.enterpriseName) || '',
        items
      });
      if (this._timer) clearInterval(this._timer);
      if (items.some((item) => item.canUndo)) {
        this._timer = setInterval(() => {
          this.setData({
            items: this.data.items.map((item) => ({
              ...item,
              countdownLabel: item.canUndo ? formatCountdown(item.withdrawalDeadline) : ''
            }))
          });
        }, 1000);
      }
    } catch (error) {
      this.setData({ error: error.message || error.error || '暂时无法读取客户' });
    } finally {
      this.setData({ loading: false });
    }
  },
  backToPromotion() {
    wx.reLaunch({
      url: '/packages/business/referrer-workbench/referrer-workbench',
      fail: () => wx.navigateBack()
    });
  },
  async withdrawLead(event) {
    const item = event.currentTarget.dataset.item;
    if (!item || !item.canWithdraw) {
      return wx.showToast({ title: (item && item.withdrawalBlockedReason) || '当前不能撤回', icon: 'none' });
    }
    const modal = await new Promise((resolve) => wx.showModal({
      title: '撤回这条线索？',
      content: `记录编号 ${item.recordCode}\n撤回后员工端将停止后续服务。`,
      confirmText: '确认撤回',
      success: resolve
    }));
    if (!modal.confirm) return;
    try {
      await api.request(
        '/miniprogram/referrer-progress/withdraw',
        'POST',
        { leadId: item.id, note: '推广人撤回' },
        { headers: { 'Idempotency-Key': `referrer-withdraw-${item.id}-${Date.now()}` } }
      );
      wx.showToast({ title: '已撤回', icon: 'success' });
      this.load();
    } catch (error) {
      wx.showToast({ title: error.message || '撤回失败', icon: 'none' });
    }
  },
  async undoWithdrawal(event) {
    const item = event.currentTarget.dataset.item;
    if (!item || !item.canUndo) return;
    try {
      await api.request(
        '/miniprogram/referrer-progress/withdraw/undo',
        'POST',
        { leadId: item.id },
        { headers: { 'Idempotency-Key': `referrer-undo-${item.id}-${Date.now()}` } }
      );
      wx.showToast({ title: '已恢复', icon: 'success' });
      this.load();
    } catch (error) {
      wx.showToast({ title: error.message || '恢复失败', icon: 'none' });
    }
  }
});
