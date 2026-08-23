const aiService = require('../../../utils/aiDesignService.js');
const {
  openSchemeStudio,
  shouldOpenSchemeStudio,
} = require('../../../utils/aiDesignNavigation.js');
const { roomsFromWorkflowDetail } = require('../recipe-project/recipe-project-model.js');
const sitePhotos = require('../../../utils/sitePhotoService.js');
const { openSheet, closeSheet, clearSheetTimer } = require('../../../utils/sheetMotion.js');

const GALLERY_SHEET = { mountedKey: 'galleryMounted', openKey: 'galleryOpen' };

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
    loading: true, error: '', submitting: false, recipe: null, scope: null,
    recipeId: '', inputMode: 'floor_plan', leadId: '', floorPlanId: '', roomId: '', targetScope: 'whole_floor_plan',
    leadName: '', communityName: '', schemeTitle: '',
    account: { availableBalance: 0 }, price: 10, spaceImagePath: '', spaceAssetId: '', uploadError: '', uploading: false,
    customerResults: [], sourceResultTaskId: '',
    workflows: [], workflowConflictOpen: false, selectedWorkflowId: '', createNewWorkflow: false,
    sitePhotos: [], sitePhotoTags: sitePhotos.SPACE_TAGS, sitePhotoLimitReached: false,
    sitePhotoCaptureNonce: 0, sitePhotoCaptureSource: '',
    galleryMounted: false, galleryOpen: false,
    navigationTop: 24, navigationHeight: 32, navigationRight: 96,
  },

  onLoad(options) {
    this.syncNavigationMetrics();
    this.setData({
      recipeId: options.recipeId || '', inputMode: options.inputMode === 'photo' ? 'photo' : 'floor_plan',
      leadId: options.leadId || '', floorPlanId: options.floorPlanId || '', roomId: options.roomId || '',
      targetScope: options.targetScope === 'single_room' ? 'single_room' : 'whole_floor_plan',
      selectedWorkflowId: options.schemeId || options.workflowId || '',
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
      if (!this.data.selectedWorkflowId) throw new Error('请先选择要续接的方案');
      const [recipe, capabilities, detail, history] = await Promise.all([
        aiService.getRecipe(this.data.recipeId),
        aiService.loadCapabilities(),
        aiService.getStudioWorkflow(this.data.selectedWorkflowId),
        this.data.inputMode === 'photo' ? aiService.loadHistory(1, 30).catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
      ]);
      const bound = roomsFromWorkflowDetail(detail);
      const photoMode = this.data.inputMode === 'photo';
      if (!photoMode && !bound.floorPlanId) throw new Error('该方案尚未关联正式户型，请重新选择');
      if (this.data.floorPlanId && bound.floorPlanId && bound.floorPlanId !== this.data.floorPlanId) {
        throw new Error('所选方案与户型不匹配，请重新选择');
      }
      if (this.data.leadId && bound.lead.id && String(bound.lead.id) !== String(this.data.leadId)) {
        throw new Error('所选方案与客户不匹配，请重新选择');
      }
      const room = this.data.targetScope === 'single_room'
        ? (bound.rooms || []).find((item) => item.roomId === this.data.roomId) : null;
      if (!photoMode && this.data.targetScope === 'single_room' && !room) throw new Error('所选房间已不可用，请重新选择');
      const modeKey = this.data.inputMode === 'photo' ? 'style_transform' : 'floor_plan_render';
      const mode = (capabilities.modes || []).find((item) => item.key === modeKey);
      const customerResults = (history.data || []).filter((item) => (
        item.status === 'succeeded'
        && item.resultImageUrl
        && (!bound.floorPlanId || item.floorPlanId === bound.floorPlanId)
        && (photoMode || (
          (item.targetScope || 'whole_floor_plan') === this.data.targetScope
          && (this.data.targetScope !== 'single_room' || item.roomId === this.data.roomId)
        ))
      )).slice(0, 6);
      this.setData({
        recipe,
        leadId: this.data.leadId || String(bound.lead.id || ''),
        floorPlanId: bound.floorPlanId || this.data.floorPlanId || '',
        leadName: bound.lead.name || '客户',
        communityName: bound.lead.communityName || '未登记小区',
        schemeTitle: bound.workflow.title || 'AI 设计方案',
        scope: photoMode
          ? { name: '现场照片', meta: '可用户型图或现场照出图并发送' }
          : {
            name: room ? room.roomName : '完整户型',
            meta: room ? room.roomSize : `${bound.closedRoomCount} 个闭合空间`,
          },
        account: capabilities.account || { availableBalance: 0 },
        price: Number(mode && mode.credits || 10),
        customerResults,
        loading: false,
      });
    } catch (error) {
      this.setData({ loading: false, error: error.error || error.message || '生成确认信息加载失败' });
    }
  },

  goBack() { wx.navigateBack(); }, retry() { this.loadData(); },
  noop() {},

  onUnload() {
    clearSheetTimer(this, GALLERY_SHEET.openKey);
  },

  choosePhoto() {
    if (this.data.uploading || this.data.submitting) return;
    sitePhotos.chooseAiSource().then((choice) => {
      if (choice.kind === 'gallery') {
        void this.openGalleryPicker();
        return;
      }
      this.startSitePhotoCapture(choice.source);
    }).catch((error) => {
      if (error && error.cancelled) return;
      wx.showToast({ title: (error && error.error) || '无法选择照片来源', icon: 'none' });
    });
  },

  startSitePhotoCapture(source) {
    if (!this.data.leadId) {
      wx.showToast({ title: '缺少客户线索', icon: 'none' });
      return;
    }
    this.setData({
      sitePhotoCaptureSource: source || '',
      sitePhotoCaptureNonce: Date.now(),
    });
  },

  async openGalleryPicker() {
    if (!this.data.leadId) {
      wx.showToast({ title: '缺少客户线索', icon: 'none' });
      return;
    }
    try {
      const result = await sitePhotos.list(this.data.leadId);
      const items = result.items || [];
      this.setData({
        sitePhotos: items,
        sitePhotoTags: result.spaceTags || sitePhotos.SPACE_TAGS,
        sitePhotoLimitReached: Number(result.remaining || 0) <= 0,
      });
      if (!items.length) {
        wx.showToast({ title: '本户还没有现场图，请先拍照', icon: 'none' });
        this.startSitePhotoCapture('');
        return;
      }
      openSheet(this, GALLERY_SHEET);
    } catch (error) {
      wx.showToast({ title: (error && error.error) || '现场图加载失败', icon: 'none' });
    }
  },

  closeGalleryPicker() {
    closeSheet(this, GALLERY_SHEET);
  },

  applySitePhoto(photo) {
    if (!photo || !photo.assetId) {
      wx.showToast({ title: '这张现场图还不能用于出图', icon: 'none' });
      return;
    }
    this.setData({
      uploading: false,
      uploadError: '',
      spaceImagePath: photo.imagePath || photo.previewUrl || '',
      spaceAssetId: photo.assetId,
      sourceResultTaskId: '',
    });
  },

  onSitePhotoCaptured(event) {
    const photo = event.detail && event.detail.photo;
    if (!photo) return;
    this.applySitePhoto(photo);
    closeSheet(this, GALLERY_SHEET);
  },

  onSitePhotoSelect(event) {
    const photo = event.detail && event.detail.photo;
    if (!photo) return;
    this.applySitePhoto(photo);
    closeSheet(this, GALLERY_SHEET);
  },

  onSitePhotosChange(event) {
    this.setData({ sitePhotos: sitePhotos.mergePhotos(this.data.sitePhotos, event.detail || {}) });
  },

  onSitePhotoUploading(event) {
    this.setData({ uploading: Boolean(event.detail && event.detail.uploading) });
  },

  removePhoto() { if (!this.data.submitting) this.setData({ spaceImagePath: '', spaceAssetId: '', sourceResultTaskId: '', uploadError: '' }); },
  retryPhoto() { if (!this.data.submitting) this.choosePhoto(); },

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
        leadId: this.data.leadId,
        ...(this.data.floorPlanId ? {
          floorPlanId: this.data.floorPlanId,
          targetScope: this.data.targetScope,
          roomId: this.data.roomId || undefined,
        } : {}),
        workflowId: this.data.selectedWorkflowId || undefined,
        createNewWorkflow: this.data.selectedWorkflowId ? undefined : this.data.createNewWorkflow,
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
