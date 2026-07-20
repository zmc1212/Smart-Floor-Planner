const aiService = require('../../utils/aiDesignService.js');

const WORKFLOW_DEFINITIONS = [
  { key: 'reference_recreate', title: '参考图复刻', description: '参考灵感图，还原到真实空间', icon: '/images/ai-design-icons/reference.png', requires: 'edit' },
  { key: 'style_transform', title: '空间换风格', description: '保留结构，一键切换设计风格', icon: '/images/ai-design-icons/palette.png', requires: 'edit' },
  { key: 'floor_plan_render', title: '户型生成', description: '按正式量房数据生成概念效果', icon: '/images/ai-design-icons/floor-plan.png', requires: 'generate' },
  { key: 'soft_furnishing', title: '软装深化', description: '保留硬装，重点优化软装细节', icon: '/images/ai-design-icons/armchair.png', requires: 'edit' },
];

const MODE_TITLES = WORKFLOW_DEFINITIONS.reduce((result, item) => {
  result[item.key] = item.title;
  return result;
}, {});

Page({
  data: {
    loading: true,
    account: { availableBalance: 0, frozenBalance: 0 },
    workflows: WORKFLOW_DEFINITIONS,
    provider: { available: false, supportsEdit: false, supportsGenerate: false },
    recent: [],
    sources: [],
    selectedSource: null,
    sourcePickerOpen: false,
    schemeOptions: [],
    selectedWorkflow: null,
    workflowPickerOpen: false,
    workflowId: '',
    createNewWorkflow: false,
    floorPlanId: '',
    leadId: '',
    roomId: '',
  },

  onLoad(options) {
    this.setData({
      floorPlanId: options.floorPlanId || '',
      leadId: options.leadId || '',
      roomId: options.roomId || '',
      workflowId: options.workflowId || '',
    });
  },

  onShow() {
    this.loadData();
  },

  onPullDownRefresh() {
    this.loadData().finally(() => wx.stopPullDownRefresh());
  },

  async loadData() {
    this.setData({ loading: true });
    try {
      const [capabilities, history, sourceData] = await Promise.all([
        aiService.loadCapabilities(),
        aiService.loadHistory(1, 4).catch(() => ({ data: [] })),
        aiService.loadSources().catch(() => []),
      ]);
      const priceMap = (capabilities.modes || []).reduce((result, item) => {
        result[item.key] = item;
        return result;
      }, {});
      const provider = capabilities.provider || { available: false };
      const workflows = WORKFLOW_DEFINITIONS.map((item) => {
        const capability = priceMap[item.key] || {};
        const providerReady = item.requires === 'generate' ? provider.supportsGenerate : provider.supportsEdit;
        return { ...item, credits: capability.credits || 10, enabled: capability.enabled !== false && providerReady !== false };
      });
      const recent = (history.data || []).map((item) => ({ ...item, modeTitle: MODE_TITLES[item.mode] || 'AI 设计' }));
      const selectedSource = sourceData.find((item) => (
        item.floorPlanId === this.data.floorPlanId
        && (!this.data.roomId || item.roomId === this.data.roomId)
      )) || null;
      const sources = sourceData.map((item) => ({
        ...item,
        sourceKey: `${item.floorPlanId}:${item.roomId}`,
        selected: !!selectedSource
          && item.floorPlanId === selectedSource.floorPlanId
          && item.roomId === selectedSource.roomId,
      }));
      const schemeOptions = await aiService.loadWorkflows({
        workflowId: this.data.workflowId,
        leadId: selectedSource ? selectedSource.leadId : this.data.leadId,
        floorPlanId: selectedSource ? selectedSource.floorPlanId : this.data.floorPlanId,
      }).catch(() => []);
      const selectedWorkflow = schemeOptions.find((item) => item.id === this.data.workflowId)
        || (schemeOptions.length === 1 ? schemeOptions[0] : null);
      this.setData({
        account: capabilities.account,
        workflows: workflows.map((item) => ({
          ...item,
          recommended: !!selectedWorkflow && selectedWorkflow.recommendedMiniMode === item.key,
        })),
        provider,
        recent,
        sources,
        selectedSource,
        floorPlanId: selectedSource ? selectedSource.floorPlanId : this.data.floorPlanId,
        leadId: selectedSource ? selectedSource.leadId : this.data.leadId,
        roomId: selectedSource ? selectedSource.roomId : this.data.roomId,
        schemeOptions,
        selectedWorkflow,
        workflowId: selectedWorkflow ? selectedWorkflow.id : '',
        workflowPickerOpen: schemeOptions.length > 1 && !selectedWorkflow,
        createNewWorkflow: false,
      });
    } catch (error) {
      wx.showToast({ title: error.error || 'AI 服务加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  openMode(event) {
    const mode = event.currentTarget.dataset.mode;
    if (this.data.schemeOptions.length > 1 && !this.data.workflowId && !this.data.createNewWorkflow) {
      this.setData({ workflowPickerOpen: true });
      wx.showToast({ title: '请先选择要续接的客户方案', icon: 'none' });
      return;
    }
    const workflow = this.data.workflows.find((item) => item.key === mode);
    if (workflow && !workflow.enabled) {
      wx.showToast({ title: mode === 'floor_plan_render' ? '户型生图服务暂未配置' : '图片编辑服务暂未配置', icon: 'none' });
      return;
    }
    if (!this.data.provider.available) {
      wx.showToast({ title: this.data.provider.error || '企业 AI 服务未配置', icon: 'none' });
      return;
    }
    if (mode === 'floor_plan_render' && !this.data.floorPlanId) {
      if (this.data.sources.length) {
        this.setData({ sourcePickerOpen: true });
        wx.showToast({ title: '请先关联一个户型房间', icon: 'none' });
      } else {
        wx.showToast({ title: '暂无可关联的正式户型', icon: 'none' });
      }
      return;
    }
    const query = [
      `mode=${mode}`,
      this.data.floorPlanId ? `floorPlanId=${this.data.floorPlanId}` : '',
      this.data.leadId ? `leadId=${this.data.leadId}` : '',
      this.data.roomId ? `roomId=${this.data.roomId}` : '',
      this.data.workflowId ? `workflowId=${this.data.workflowId}` : '',
      this.data.createNewWorkflow ? 'createNewWorkflow=1' : '',
    ].filter(Boolean).join('&');
    wx.navigateTo({ url: `/pages/ai-design-create/ai-design-create?${query}` });
  },

  openSourcePicker() {
    if (!this.data.sources.length) {
      wx.showToast({ title: '暂无可关联的正式户型', icon: 'none' });
      return;
    }
    this.setData({ sourcePickerOpen: true });
  },

  closeSourcePicker() {
    this.setData({ sourcePickerOpen: false });
  },

  noop() {},

  async selectSource(event) {
    const source = this.data.sources[Number(event.currentTarget.dataset.index)];
    if (!source) return;
    const sources = this.data.sources.map((item) => ({
      ...item,
      selected: item.floorPlanId === source.floorPlanId && item.roomId === source.roomId,
    }));
    this.setData({
      sources,
      selectedSource: source,
      floorPlanId: source.floorPlanId,
      leadId: source.leadId,
      roomId: source.roomId,
      sourcePickerOpen: false,
      selectedWorkflow: null,
      workflowId: '',
      createNewWorkflow: false,
    });
    const schemeOptions = await aiService.loadWorkflows({ leadId: source.leadId, floorPlanId: source.floorPlanId }).catch(() => []);
    const selectedWorkflow = schemeOptions.length === 1 ? schemeOptions[0] : null;
    this.setData({
      schemeOptions,
      selectedWorkflow,
      workflowId: selectedWorkflow ? selectedWorkflow.id : '',
      workflowPickerOpen: schemeOptions.length > 1,
    });
  },

  clearSource() {
    this.setData({
      sources: this.data.sources.map((item) => ({ ...item, selected: false })),
      selectedSource: null,
      floorPlanId: '',
      leadId: '',
      roomId: '',
      schemeOptions: [],
      selectedWorkflow: null,
      workflowId: '',
      workflowPickerOpen: false,
      createNewWorkflow: false,
    });
  },

  openWorkflowPicker() {
    if (!this.data.schemeOptions.length) return;
    this.setData({ workflowPickerOpen: true });
  },

  closeWorkflowPicker() {
    this.setData({ workflowPickerOpen: false });
  },

  selectWorkflow(event) {
    const workflow = this.data.schemeOptions[Number(event.currentTarget.dataset.index)];
    if (!workflow) return;
    this.setData({
      selectedWorkflow: workflow,
      workflowId: workflow.id,
      createNewWorkflow: false,
      workflowPickerOpen: false,
    });
  },

  createAlternativeWorkflow() {
    this.setData({
      selectedWorkflow: null,
      workflowId: '',
      createNewWorkflow: true,
      workflowPickerOpen: false,
    });
    wx.showToast({ title: '将创建新的备选方案', icon: 'none' });
  },

  openHistory() {
    wx.navigateTo({ url: '/pages/ai-design-history/ai-design-history' });
  },

  openResult(event) {
    wx.navigateTo({ url: `/pages/ai-design-result/ai-design-result?id=${event.currentTarget.dataset.id}` });
  },
});
