const aiService = require('../../../utils/aiDesignService.js');
const {
  openSchemeStudio,
  shouldOpenSchemeStudio,
} = require('../../../utils/aiDesignNavigation.js');

function redirectAfterRecipeTask(task, { run = false } = {}) {
  if (!task || !task.id) {
    wx.showToast({ title: '任务创建失败', icon: 'none' });
    return;
  }

  if (run && ['created', 'pending'].includes(task.status)) {
    aiService.runTask(task.id).catch(() => {});
  }

  if (shouldOpenSchemeStudio(task)) {
    openSchemeStudio({
      leadId: task.leadId,
      workflowId: task.workflowId,
      floorPlanId: task.floorPlanId,
      redirect: true,
    });
    return;
  }

  wx.redirectTo({
    url: `/packages/ai-workflow/result/ai-design-result?id=${task.id}${run ? '&run=1' : ''}`,
  });
}

Page({
  data: {
    loading: true, error: '', submitting: false, recipe: null, project: null, scope: null,
    recipeId: '', inputMode: 'floor_plan', leadId: '', floorPlanId: '', roomId: '', targetScope: 'whole_floor_plan',
    account: { availableBalance: 0 }, price: 10, spaceImagePath: '', spaceAssetId: '', uploadError: '', uploading: false,
    customerResults: [], sourceResultTaskId: '',
    workflows: [], workflowConflictOpen: false, selectedWorkflowId: '', createNewWorkflow: false,
    navigationTop: 24, navigationHeight: 32, navigationRight: 96,
  },

  onLoad(options) {
    this.syncNavigationMetrics();
    this.setData({
      recipeId: options.recipeId || '', inputMode: options.inputMode === 'photo' ? 'photo' : 'floor_plan',
      leadId: options.leadId || '', floorPlanId: options.floorPlanId || '', roomId: options.roomId || '',
      targetScope: options.targetScope === 'single_room' ? 'single_room' : 'whole_floor_plan',
    });
    this.loadData();
  },

  syncNavigationMetrics() {
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    let menuRect = null;
    try { menuRect = wx.getMenuButtonBoundingClientRect(); } catch (error) { menuRect = null; }
    const navigationTop = Number(menuRect && menuRect.top ? menuRect.top : Number(windowInfo.statusBarHeight || 0) + 6);
    const navigationHeight = Number(menuRect && menuRect.height ? menuRect.height : 32);
    const menuLeft = Number(menuRect && menuRect.left ? menuRect.left : windowInfo.windowWidth);
    this.setData({ navigationTop, navigationHeight, navigationRight: Math.max(92, Number(windowInfo.windowWidth || 390) - menuLeft + 12) });
  },

  async loadData() {
    this.setData({ loading: true, error: '' });
    try {
      const [recipe, capabilities, sources, workflows, history] = await Promise.all([
        aiService.getRecipe(this.data.recipeId), aiService.loadCapabilities(), aiService.loadSources(),
        aiService.loadWorkflows({ leadId: this.data.leadId, floorPlanId: this.data.floorPlanId }).catch(() => []),
        this.data.inputMode === 'photo' ? aiService.loadHistory(1, 30).catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
      ]);
      const project = (sources || []).find((item) => item.floorPlanId === this.data.floorPlanId);
      if (!project) throw new Error('所选客户项目已不可用，请重新选择');
      const room = this.data.targetScope === 'single_room'
        ? (project.rooms || []).find((item) => item.roomId === this.data.roomId) : null;
      if (this.data.targetScope === 'single_room' && !room) throw new Error('所选房间已不可用，请重新选择');
      const modeKey = this.data.inputMode === 'photo' ? 'style_transform' : 'floor_plan_render';
      const mode = (capabilities.modes || []).find((item) => item.key === modeKey);
      const customerResults = (history.data || []).filter((item) => (
        item.status === 'succeeded'
        && item.resultImageUrl
        && item.floorPlanId === this.data.floorPlanId
        && (item.targetScope || 'whole_floor_plan') === this.data.targetScope
        && (this.data.targetScope !== 'single_room' || item.roomId === this.data.roomId)
      )).slice(0, 6);
      this.setData({
        recipe, project, scope: { name: room ? room.roomName : '完整户型', meta: room ? room.roomSize : `${project.closedRoomCount} 个闭合空间` },
        account: capabilities.account || { availableBalance: 0 }, price: Number(mode && mode.credits || 10), workflows,
        selectedWorkflowId: workflows.length === 1 ? workflows[0].id : '', customerResults, loading: false,
      });
    } catch (error) {
      this.setData({ loading: false, error: error.error || error.message || '生成确认信息加载失败' });
    }
  },

  goBack() { wx.navigateBack(); }, retry() { this.loadData(); },
  noop() {},

  choosePhoto() {
    if (this.data.uploading || this.data.submitting) return;
    wx.chooseMedia({
      count: 1, mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['compressed'],
      success: (result) => {
        const file = result.tempFiles && result.tempFiles[0];
        if (file && file.tempFilePath) this.uploadPhoto(file.tempFilePath);
      },
    });
  },

  async uploadPhoto(path) {
    this.setData({ uploading: true, uploadError: '', spaceImagePath: path, spaceAssetId: '', sourceResultTaskId: '' });
    try {
      const asset = await aiService.uploadAsset(path);
      this.setData({ spaceAssetId: asset.id, uploading: false });
    } catch (error) {
      this.setData({ uploading: false, uploadError: error.error || '图片上传失败' });
    }
  },

  removePhoto() { if (!this.data.submitting) this.setData({ spaceImagePath: '', spaceAssetId: '', sourceResultTaskId: '', uploadError: '' }); },
  retryPhoto() { if (this.data.spaceImagePath) this.uploadPhoto(this.data.spaceImagePath); },

  selectCustomerResult(event) {
    const result = this.data.customerResults.find((item) => item.id === event.currentTarget.dataset.id);
    if (!result || this.data.submitting) return;
    this.setData({
      sourceResultTaskId: result.id,
      spaceImagePath: result.resultImageUrl,
      spaceAssetId: '',
      uploadError: '',
    });
  },

  selectWorkflow(event) {
    this.setData({ selectedWorkflowId: event.currentTarget.dataset.id || '', createNewWorkflow: false });
  },
  selectNewWorkflow() { this.setData({ selectedWorkflowId: '', createNewWorkflow: true }); },
  closeWorkflowConflict() { this.setData({ workflowConflictOpen: false }); },

  async startGeneration() {
    if (this.data.submitting || this.data.uploading) return;
    if (this.data.inputMode === 'photo' && !this.data.spaceAssetId && !this.data.sourceResultTaskId) {
      wx.showToast({ title: this.data.uploadError || '请先上传现场照片', icon: 'none' }); return;
    }
    if (Number(this.data.account.availableBalance || 0) < this.data.price) {
      wx.showModal({ title: 'AI 点数不足', content: `本次需要 ${this.data.price} 点，请联系企业管理员补充 AI 点数。`, showCancel: false }); return;
    }
    this.setData({ submitting: true });
    try {
      const task = await aiService.createTask({
        mode: this.data.inputMode === 'photo' ? 'style_transform' : 'floor_plan_render',
        recipeId: this.data.recipeId, spaceAssetId: this.data.inputMode === 'photo' ? this.data.spaceAssetId || undefined : undefined,
        sourceResultTaskId: this.data.inputMode === 'photo' ? this.data.sourceResultTaskId || undefined : undefined,
        styleKey: this.data.inputMode === 'photo' ? 'recipe' : undefined,
        leadId: this.data.leadId, floorPlanId: this.data.floorPlanId, targetScope: this.data.targetScope,
        roomId: this.data.roomId || undefined, workflowId: this.data.selectedWorkflowId || undefined,
        createNewWorkflow: this.data.createNewWorkflow,
      });
      redirectAfterRecipeTask(task, { run: true });
    } catch (error) {
      if (error.existingTaskId) {
        try {
          const existing = await aiService.getTask(error.existingTaskId);
          redirectAfterRecipeTask(existing, {
            run: ['created', 'pending'].includes(existing && existing.status),
          });
        } catch (lookupError) {
          wx.redirectTo({ url: `/packages/ai-workflow/result/ai-design-result?id=${error.existingTaskId}` });
        }
        return;
      }
      if (error.code === 'WORKFLOW_CONFLICT' && Array.isArray(error.workflows)) {
        this.setData({ submitting: false, workflows: error.workflows, workflowConflictOpen: true }); return;
      }
      wx.showToast({ title: error.error || '创建任务失败', icon: 'none' });
      this.setData({ submitting: false });
    }
  },
});
