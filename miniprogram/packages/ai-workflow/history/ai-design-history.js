const aiService = require('../../../utils/aiDesignService.js');
const { canAccessAIDesign, showAIDesignAccessDenied } = require('../../../utils/aiDesignAccess.js');
const { openSchemeStudio } = require('../../../utils/aiDesignNavigation.js');

const MODE_TITLES = {
  reference_recreate: '参考图复刻',
  style_transform: '空间换风格',
  floor_plan_render: '户型生成',
  soft_furnishing: '软装深化',
};

function padTimePart(value) {
  return String(value).padStart(2, '0');
}

function formatHistoryTime(value, nowValue = Date.now()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date(nowValue);
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const itemDayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDifference = Math.round((dayStart - itemDayStart) / 86400000);
  const time = `${padTimePart(date.getHours())}:${padTimePart(date.getMinutes())}`;
  if (dayDifference === 0) return `今天 ${time}`;
  if (dayDifference === 1) return `昨天 ${time}`;
  return `${padTimePart(date.getMonth() + 1)}-${padTimePart(date.getDate())} ${time}`;
}

function decorateHistoryItem(item, project) {
  const processing = ['created', 'pending', 'processing'].includes(item.status);
  return {
    ...item,
    projectTitle: project ? project.projectDisplayTitle : '',
    modeTitle: item.recipeName || MODE_TITLES[item.mode] || 'AI 设计',
    timeLabel: formatHistoryTime(item.updatedAt || item.createdAt),
    statusClass: processing ? 'processing' : item.status === 'failed' ? 'failed' : 'succeeded',
    statusLabel: processing ? (item.recipeId ? '生成中' : `生成中 ${item.progress}%`) : item.status === 'failed' ? '生成失败' : '已完成',
    canOpenScheme: Boolean(item.leadId && item.workflowId),
  };
}

Page({
  data: {
    items: [],
    filteredItems: [],
    activeFilter: 'all',
    historyFilters: [
      { value: 'all', label: '全部' },
      { value: 'processing', label: '生成中' },
      { value: 'succeeded', label: '已完成' },
      { value: 'failed', label: '失败' },
    ],
    page: 1,
    totalPages: 1,
    loading: false,
    refreshing: false,
    projects: [],
  },

  onShow() {
    if (!canAccessAIDesign()) {
      showAIDesignAccessDenied();
      wx.switchTab({ url: '/pages/index/index' });
      return;
    }

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
      const [result, sources] = await Promise.all([
        aiService.loadHistory(page, 12),
        reset ? aiService.loadSources().catch(() => this.data.projects) : Promise.resolve(this.data.projects),
      ]);
      const projects = sources || [];
      const pageItems = (result.data || []).map((item) => decorateHistoryItem(
        item,
        projects.find((project) => project.floorPlanId === item.floorPlanId)
      ));
      const items = reset ? pageItems : this.data.items.concat(pageItems);
      this.setData({
        items,
        projects,
        filteredItems: this.filterHistoryItems(items, this.data.activeFilter),
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

  filterHistoryItems(items, filter) {
    if (filter === 'all') return items;
    if (filter === 'processing') {
      return items.filter((item) => ['created', 'pending', 'processing'].includes(item.status));
    }
    return items.filter((item) => item.status === filter);
  },

  formatHistoryTime,
  decorateHistoryItem,

  selectHistoryFilter(event) {
    const activeFilter = event.currentTarget.dataset.value || 'all';
    this.setData({
      activeFilter,
      filteredItems: this.filterHistoryItems(this.data.items, activeFilter),
    });
  },

  openResult(event) {
    wx.navigateTo({ url: `/packages/ai-workflow/result/ai-design-result?id=${event.currentTarget.dataset.id}` });
  },

  openScheme(event) {
    const item = this.data.items.find((entry) => entry.id === event.currentTarget.dataset.id);
    if (!item || !item.canOpenScheme) return;
    openSchemeStudio({
      leadId: item.leadId,
      workflowId: item.workflowId,
      floorPlanId: item.floorPlanId,
    });
  },

  reuse(event) {
    const item = this.data.items.find((entry) => entry.id === event.currentTarget.dataset.id);
    if (!item) return;
    if (item.recipeId) {
      wx.navigateTo({ url: `/packages/ai-workflow/recipe-detail/recipe-detail?id=${encodeURIComponent(item.recipeId)}` });
      return;
    }
    wx.navigateTo({ url: `/packages/ai-workflow/create/ai-design-create?mode=${item.mode}&sourceTaskId=${item.id}` });
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
          const items = this.data.items.filter((item) => item.id !== id);
          this.setData({
            items,
            filteredItems: this.filterHistoryItems(items, this.data.activeFilter),
          });
          wx.showToast({ title: '已删除', icon: 'success' });
        } catch (error) {
          wx.showToast({ title: error.error || '删除失败', icon: 'none' });
        }
      },
    });
  },
});
