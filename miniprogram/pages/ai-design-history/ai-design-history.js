const aiService = require('../../utils/aiDesignService.js');

const MODE_TITLES = {
  reference_recreate: '参考图复刻',
  style_transform: '空间换风格',
  floor_plan_render: '户型生成',
  soft_furnishing: '软装深化',
};

Page({
  data: {
    items: [],
    page: 1,
    totalPages: 1,
    loading: false,
    refreshing: false,
  },

  onShow() {
    this.reload();
  },

  async reload() {
    this.setData({ page: 1, totalPages: 1, refreshing: true });
    await this.loadPage(true);
    this.setData({ refreshing: false });
  },

  async loadPage(reset) {
    if (this.data.loading) return;
    const page = reset ? 1 : this.data.page;
    if (!reset && page > this.data.totalPages) return;
    this.setData({ loading: true });
    try {
      const result = await aiService.loadHistory(page, 12);
      const pageItems = (result.data || []).map((item) => ({ ...item, modeTitle: MODE_TITLES[item.mode] || 'AI 设计' }));
      this.setData({
        items: reset ? pageItems : this.data.items.concat(pageItems),
        page: page + 1,
        totalPages: (result.pagination && result.pagination.totalPages) || 1,
      });
    } catch (error) {
      wx.showToast({ title: error.error || '读取历史失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  loadMore() {
    this.loadPage(false);
  },

  openResult(event) {
    wx.navigateTo({ url: `/pages/ai-design-result/ai-design-result?id=${event.currentTarget.dataset.id}` });
  },

  reuse(event) {
    const item = this.data.items.find((entry) => entry.id === event.currentTarget.dataset.id);
    if (!item) return;
    wx.navigateTo({ url: `/pages/ai-design-create/ai-design-create?mode=${item.mode}&sourceTaskId=${item.id}` });
  },

  remove(event) {
    const id = event.currentTarget.dataset.id;
    wx.showModal({
      title: '删除这条 AI 记录？',
      content: '输入图片和生成结果将从历史中移除，此操作不可撤销。',
      confirmText: '删除',
      confirmColor: '#DC4B3E',
      success: async (result) => {
        if (!result.confirm) return;
        try {
          await aiService.deleteHistory(id);
          this.setData({ items: this.data.items.filter((item) => item.id !== id) });
          wx.showToast({ title: '已删除', icon: 'success' });
        } catch (error) {
          wx.showToast({ title: error.error || '删除失败', icon: 'none' });
        }
      },
    });
  },
});
