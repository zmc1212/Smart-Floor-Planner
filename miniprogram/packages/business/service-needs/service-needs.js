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

Page({
  data: {
    navigationTop: 24,
    navigationHeight: 32,
    navigationRight: 96,
    leadId: '',
    loading: true,
    saving: false,
    error: '',
    options: [],
    hasSelection: false,
  },

  onLoad(options) {
    const leadId = String((options && (options.leadId || options.id)) || '').trim();
    this.setData({ ...navigationMetrics(), leadId });
    if (!leadId) {
      this.setData({ loading: false, error: '服务档案暂未准备好，请返回后重试' });
      return;
    }
    this.load();
  },

  async load() {
    if (!this.data.leadId) return;
    this.setData({ loading: true, error: '' });
    try {
      const response = await api.request(
        `/miniprogram/customer-projects/${encodeURIComponent(this.data.leadId)}/service-needs`,
        'GET',
      );
      const selected = new Set((response.data && response.data.needKeys) || []);
      const options = (response.data && response.data.options || []).map((item) => ({
        ...item,
        selected: selected.has(item.key),
      }));
      this.setData({
        options,
        hasSelection: selected.size > 0,
        loading: false,
      });
    } catch (error) {
      this.setData({ loading: false, error: error.message || error.error || '服务需求暂时无法读取' });
    }
  },

  onToggle(event) {
    const key = String(event.currentTarget.dataset.key || '');
    if (!key) return;
    const options = this.data.options.map((item) => (
      item.key === key ? { ...item, selected: !item.selected } : item
    ));
    this.setData({ options, hasSelection: options.some((item) => item.selected) });
  },

  onClear() {
    this.setData({
      options: this.data.options.map((item) => ({ ...item, selected: false })),
      hasSelection: false,
    });
  },

  async onSave() {
    if (this.data.saving || this.data.loading || this.data.error || !this.data.leadId) return;
    const needKeys = this.data.options.filter((item) => item.selected).map((item) => item.key);
    this.setData({ saving: true });
    try {
      await api.request(
        `/miniprogram/customer-projects/${encodeURIComponent(this.data.leadId)}/service-needs`,
        'PUT',
        { needKeys },
      );
      wx.showToast({ title: needKeys.length ? '服务需求已记录' : '已清除其他需求', icon: 'success' });
      setTimeout(() => this.onBack(), 700);
    } catch (error) {
      this.setData({ saving: false });
      wx.showToast({ title: error.message || error.error || '保存失败，请稍后重试', icon: 'none' });
    }
  },

  onBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) });
  },
});
