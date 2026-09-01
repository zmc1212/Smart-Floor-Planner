const aiService = require('../../../utils/aiDesignService.js');
const { canAccessAIDesign, showAIDesignAccessDenied } = require('../../../utils/aiDesignAccess.js');
const {
  applyModelDefaults,
  applyScopeToDraft,
  buildDraftFromBatch,
  buildScopeSubmitPayload,
  buildTemplateListParams,
  createDefaultDraft,
  parseTemplateListPayload,
  resolveDraftScope,
  resolvePreferredTemplateCategoryId,
  TEMPLATE_PAGE_SIZE,
  WHOLE_HOUSE_RENDER_MODE,
} = require('../../../components/ai-scheme-composer/ai-scheme-composer-model.js');
const {
  applySelectionToView,
  buildStudioView,
  buildWorkflowSwitcherOptions,
  findGenerationTarget,
  mergeSendSelection,
  pickPreferredStudioWorkflow,
  resolveSendTitle,
  resolveSendTitlePrefill,
  shouldPollStudioView,
  shouldRenameWorkflowOnSend,
  toggleGenerationSelection,
  workflowIdentity,
} = require('./scheme-studio-model.js');
const {
  buildScopes,
  roomsFromWorkflowDetail,
} = require('../recipe-project/recipe-project-model.js');
const { openSheet, closeSheet, dismissSheet, clearSheetTimer } = require('../../../utils/sheetMotion.js');
const sitePhotos = require('../../../utils/sitePhotoService.js');

const POLL_INTERVAL_MS = 4000;
const WORKFLOW_LOOKUP_TIMEOUT_MS = 8000;
const SIBLING_WORKFLOW_CACHE_MS = 30000;
const MENU_SHEET = { mountedKey: 'menuMounted', openKey: 'menuVisible' };
const RENAME_SHEET = { mountedKey: 'renameMounted', openKey: 'renameModalVisible' };
const SEND_SHEET = { mountedKey: 'sendMounted', openKey: 'sendModalVisible' };
const FINALIZE_SHEET = { mountedKey: 'finalizeMounted', openKey: 'finalizeModalVisible' };
const GALLERY_SHEET = { mountedKey: 'galleryMounted', openKey: 'galleryOpen' };

function downloadImage(url) {
  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url,
      success: (result) => {
        if (result.statusCode === 200 && result.tempFilePath) {
          resolve(result.tempFilePath);
          return;
        }
        reject(new Error('图片下载失败'));
      },
      fail: () => reject(new Error('图片下载失败')),
    });
  });
}

function saveImageToAlbum(filePath) {
  return new Promise((resolve, reject) => {
    wx.saveImageToPhotosAlbum({
      filePath,
      success: resolve,
      fail: (error) => reject(error),
    });
  });
}

function isAlbumPermissionError(error) {
  const message = String((error && error.errMsg) || '').toLowerCase();
  return message.includes('auth deny')
    || message.includes('auth denied')
    || message.includes('authorize no response')
    || message.includes('permission denied');
}

Page({
  data: {
    leadId: '',
    workflowId: '',
    floorPlanId: '',
    loading: true,
    creating: false,
    error: '',
    view: null,
    task: null,
    bootstrap: null,
    composerDraft: null,
    composerDockExpanded: false,
    composerKeyboardHeight: 0,
    scopes: [],
    generating: false,
    assisting: false,
    uploadingReference: false,
    retryingBatchId: '',
    selectedGenerationIds: [],
    sendMounted: false,
    sendModalVisible: false,
    sendTitle: '',
    sendingScheme: false,
    finalizeMounted: false,
    finalizeModalVisible: false,
    finalizingScheme: false,
    menuMounted: false,
    menuVisible: false,
    renameMounted: false,
    renameModalVisible: false,
    renameTitle: '',
    renaming: false,
    deletingGeneration: false,
    deletingWorkflow: false,
    withdrawingGeneration: false,
    siblingWorkflows: [],
    schemeChips: [],
    templates: [],
    templateCategories: [],
    templateCategoryId: '',
    templateQuery: '',
    templateLoading: false,
    templateLoadingMore: false,
    templateHasMore: false,
    templatePage: 1,
    templateTotal: 0,
    templateSheetVisible: false,
    sitePhotos: [],
    sitePhotoTags: sitePhotos.SPACE_TAGS,
    sitePhotoLimitReached: false,
    sitePhotoCaptureNonce: 0,
    sitePhotoCaptureSource: '',
    galleryMounted: false,
    galleryOpen: false,
    navigationTop: 24,
    navigationHeight: 32,
    navigationRight: 96,
  },

  onLoad(options) {
    if (!canAccessAIDesign()) {
      showAIDesignAccessDenied();
      wx.navigateBack({ delta: 1, fail: () => wx.switchTab({ url: '/pages/index/index' }) });
      return;
    }

    this.previousView = null;
    this.preferredWorkflowPromptShown = false;
    this.syncNavigationMetrics();
    this.setData({
      leadId: options.leadId || '',
      workflowId: options.workflowId || '',
      floorPlanId: options.floorPlanId || '',
    });

    if (!this.data.leadId) {
      this.setData({ loading: false, error: '缺少客户线索，无法打开方案工作台' });
      return;
    }

    void this.initializePage();
  },

  async initializePage() {
    // Start the workflow read at the same time as bootstrap. The workflow
    // content is what makes the page useful; waiting for model/credit config
    // first made a slow bootstrap endpoint leave the whole screen in loading.
    const workflowPromise = this.data.workflowId
      ? this.loadStudio()
      : this.bootstrapWorkflow();
    try {
      const bootstrap = await aiService.loadStudioBootstrap();
      this.setData({
        bootstrap,
        composerDraft: createDefaultDraft(bootstrap),
      });
    } catch (error) {
      this.setData({
        error: error.error || error.message || '加载创作配置失败',
      });
    }
    await workflowPromise;
    if (!this.data.bootstrap && this.data.view) {
      this.setData({ error: '创作配置加载失败，暂时无法使用出图功能' });
    }
  },

  onShow() {
    if (this.data.workflowId && !this.data.loading && !this.data.creating) {
      this.loadStudio({ silent: true });
    }
  },

  onUnload() {
    this.clearTemplateQueryTimer();
    this.stopPolling();
    this.setData({ composerKeyboardHeight: 0, composerDockExpanded: false });
    clearSheetTimer(this, MENU_SHEET.openKey);
    clearSheetTimer(this, RENAME_SHEET.openKey);
    clearSheetTimer(this, SEND_SHEET.openKey);
    clearSheetTimer(this, GALLERY_SHEET.openKey);
  },

  syncNavigationMetrics() {
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    let menuRect = null;
    try { menuRect = wx.getMenuButtonBoundingClientRect(); } catch (error) { menuRect = null; }
    const statusBarHeight = Number(windowInfo.statusBarHeight || 0);
    const navigationTop = Number(menuRect && menuRect.top ? menuRect.top : statusBarHeight + 6);
    const navigationHeight = Number(menuRect && menuRect.height ? menuRect.height : 32);
    const menuLeft = Number(menuRect && menuRect.left ? menuRect.left : windowInfo.windowWidth);
    this.setData({
      navigationTop,
      navigationHeight,
      navigationRight: Math.max(92, Number(windowInfo.windowWidth || 390) - menuLeft + 12),
    });
  },

  async bootstrapWorkflow(options = {}) {
    if (this.data.creating) return;
    const forceCreate = Boolean(options.forceCreate);
    this.setData({ creating: true, loading: true, error: '' });
    try {
      if (!forceCreate) {
        const existing = await aiService.listStudioWorkflows({
          leadId: this.data.leadId,
          limit: 50,
        }, { timeout: WORKFLOW_LOOKUP_TIMEOUT_MS }).catch(() => []);
        const preferred = pickPreferredStudioWorkflow(existing, {
          floorPlanId: this.data.floorPlanId,
          preferredWorkflowId: this.data.workflowId,
        });
        const workflowId = preferred ? workflowIdentity(preferred) : '';
        if (workflowId) {
          this.siblingWorkflowsLoadedAt = Date.now();
          this.setData({ workflowId, creating: false, siblingWorkflows: existing });
          await this.loadStudio();
          return;
        }
      }

      const created = await aiService.createStudioWorkflow({
        leadId: this.data.leadId,
        ...(this.data.floorPlanId
          ? { sourceFloorPlanId: this.data.floorPlanId }
          : { sourceAssetRole: 'rough_sketch' }),
        title: 'AI 设计方案',
      });
      const workflowId = String(created.id || created._id || '');
      if (!workflowId) throw new Error('创建方案失败');
      this.setData({ workflowId, creating: false });
      await this.loadStudio();
    } catch (error) {
      this.setData({
        creating: false,
        loading: false,
        error: error.error || error.message || '创建方案失败',
      });
    }
  },

  async loadStudio(options = {}) {
    const silent = Boolean(options.silent);
    const requestedWorkflowId = String(this.data.workflowId || '');
    if (!silent) this.setData({ loading: true, error: '' });
    try {
      const [detail, task] = await Promise.all([
        aiService.getStudioWorkflow(this.data.workflowId),
        aiService.getStudioTask(this.data.workflowId).catch(() => null),
      ]);
      const initialSiblingWorkflows = this.data.siblingWorkflows || [];
      const baseView = buildStudioView(detail, task);
      const selectedGenerationIds = mergeSendSelection(
        this.previousView,
        baseView,
        this.data.selectedGenerationIds,
      );
      const view = applySelectionToView(baseView, selectedGenerationIds);
      this.previousView = baseView;
      const schemeChips = buildWorkflowSwitcherOptions(initialSiblingWorkflows, this.data.workflowId);
      const bound = roomsFromWorkflowDetail(detail);
      const scopes = bound.floorPlanId ? buildScopes(bound.rooms, bound.closedRoomCount) : [];
      const currentDraft = this.data.composerDraft || createDefaultDraft(this.data.bootstrap);
      const selectedScope = resolveDraftScope(scopes, currentDraft);
      const nextDraft = applyScopeToDraft(currentDraft, selectedScope);
      const scopeDrifted = nextDraft.targetScope !== currentDraft.targetScope
        || String(nextDraft.roomId || '') !== String(currentDraft.roomId || '');
      const nextData = {
        view,
        task,
        siblingWorkflows: initialSiblingWorkflows,
        schemeChips,
        scopes,
        selectedGenerationIds,
        loading: false,
        error: '',
        floorPlanId: bound.floorPlanId || this.data.floorPlanId,
        sendTitle: this.data.sendModalVisible
          ? this.data.sendTitle
          : resolveSendTitlePrefill(view),
      };
      if (!silent || !this.data.composerDraft || scopeDrifted) {
        nextData.composerDraft = nextDraft;
      }
      this.setData(nextData);
      const siblingCacheFresh = Date.now() - Number(this.siblingWorkflowsLoadedAt || 0)
        < SIBLING_WORKFLOW_CACHE_MS;
      if (this.data.leadId && !siblingCacheFresh && !this.siblingWorkflowsPromise) {
        const siblingWorkflowsPromise = aiService.listStudioWorkflows({ leadId: this.data.leadId, limit: 50 }, {
          timeout: WORKFLOW_LOOKUP_TIMEOUT_MS,
        });
        this.siblingWorkflowsPromise = siblingWorkflowsPromise;
        void siblingWorkflowsPromise.then((siblingWorkflows) => {
          this.siblingWorkflowsLoadedAt = Date.now();
          if (String(this.data.workflowId || '') !== requestedWorkflowId) return;
          this.setData({
            siblingWorkflows,
            schemeChips: buildWorkflowSwitcherOptions(siblingWorkflows, this.data.workflowId),
          });
          if (!silent) this.maybeOfferPreferredWorkflow(siblingWorkflows, view, detail);
        }).catch(() => {}).finally(() => {
          if (this.siblingWorkflowsPromise === siblingWorkflowsPromise) {
            this.siblingWorkflowsPromise = null;
          }
        });
      } else if (!silent && siblingCacheFresh) {
        this.maybeOfferPreferredWorkflow(initialSiblingWorkflows, view, detail);
      }
      if (shouldPollStudioView(baseView)) this.startPolling();
      else this.stopPolling();
      if (!silent && !this.data.leadId) this.maybeOfferPreferredWorkflow(initialSiblingWorkflows, baseView, detail);
    } catch (error) {
      this.setData({
        loading: false,
        error: error.error || error.message || '读取方案详情失败',
      });
      this.stopPolling();
    }
  },

  maybeOfferPreferredWorkflow(siblingWorkflows, view, detail) {
    if (this.preferredWorkflowPromptShown || !view || view.hasBatches) return;
    const preferred = pickPreferredStudioWorkflow(siblingWorkflows, {
      floorPlanId: this.data.floorPlanId
        || detail?.workflow?.sourceFloorPlanId
        || detail?.workflow?.sourceFloorPlan?.id,
    });
    const preferredId = preferred ? workflowIdentity(preferred) : '';
    if (!preferredId || preferredId === String(this.data.workflowId || '')) return;
    if (Number(preferred.generationCount || 0) <= 0) return;
    this.preferredWorkflowPromptShown = true;
    const title = String(preferred.title || '设计方案').trim() || '设计方案';
    wx.showModal({
      title: '发现已有方案',
      content: `该客户已有「${title}」（${preferred.generationCount} 张出图）。是否切换过去？当前空白方案可稍后在菜单删除。`,
      confirmText: '切换',
      cancelText: '留在当前',
      success: (result) => {
        if (!result.confirm) return;
        this.previousView = null;
        this.setData({
          workflowId: preferredId,
          selectedGenerationIds: [],
          loading: true,
          error: '',
        });
        void this.loadStudio();
      },
    });
  },

  startPolling() {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      if (!this.data.workflowId || this.data.loading || this.data.creating) return;
      this.loadStudio({ silent: true });
    }, POLL_INTERVAL_MS);
  },

  stopPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  },

  goBack() {
    wx.navigateBack({
      fail: () => wx.switchTab({ url: '/pages/ai-design/ai-design' }),
    });
  },

  retry() {
    if (this.data.workflowId) {
      this.loadStudio();
      return;
    }
    if (this.data.floorPlanId) {
      this.bootstrapWorkflow();
    }
  },

  openWorkflowSwitcher() {
    const options = buildWorkflowSwitcherOptions(this.data.siblingWorkflows, this.data.workflowId);
    if (options.length <= 1) {
      wx.showToast({ title: '当前客户只有这一套方案，可点「+ 新建」', icon: 'none' });
      return;
    }
    wx.showActionSheet({
      itemList: options.map((item) => item.label),
      success: (result) => {
        const selected = options[result.tapIndex];
        if (!selected || selected.current) return;
        this.switchToWorkflow(selected.id);
      },
    });
  },

  selectSchemeChip(event) {
    const id = event.currentTarget.dataset.id;
    if (!id || String(id) === String(this.data.workflowId || '')) return;
    this.switchToWorkflow(id);
  },

  switchToWorkflow(workflowId) {
    const id = String(workflowId || '');
    if (!id || id === String(this.data.workflowId || '')) return;
    this.previousView = null;
    this.preferredWorkflowPromptShown = false;
    this.setData({
      workflowId: id,
      selectedGenerationIds: [],
      loading: true,
      error: '',
    });
    void this.loadStudio();
  },

  createAnotherWorkflow() {
    if (!this.data.floorPlanId) {
      const fromWorkflow = this.data.view?.workflow?.sourceFloorPlan?.id
        || this.data.siblingWorkflows.find((item) => String(item.id || item._id) === String(this.data.workflowId))?.sourceFloorPlanId;
      if (fromWorkflow) {
        this.setData({ floorPlanId: String(fromWorkflow) });
      }
    }
    dismissSheet(this, MENU_SHEET);
    wx.showModal({
      title: '新建方案',
      content: this.data.floorPlanId
        ? '将在同一客户户型下新建一套空白方案，不会覆盖已有出图。'
        : '将在同一客户下新建一套空白方案，不会覆盖已有出图。',
      success: (result) => {
        if (result.confirm) {
          this.previousView = null;
          this.preferredWorkflowPromptShown = true;
          this.setData({ workflowId: '', selectedGenerationIds: [] });
          void this.bootstrapWorkflow({ forceCreate: true });
        }
      },
    });
  },

  previewRoundFirst(event) {
    const batchIndex = Number(event.currentTarget.dataset.batchIndex);
    this.previewGeneration({
      currentTarget: {
        dataset: { batchIndex, generationIndex: 0 },
      },
    });
  },

  openMenu() {
    openSheet(this, MENU_SHEET);
  },

  closeMenu() {
    closeSheet(this, MENU_SHEET);
  },

  noop() {},

  openRenameModal() {
    const title = this.data.view?.workflow?.title || 'AI 设计方案';
    dismissSheet(this, MENU_SHEET);
    this.setData({ renameTitle: title });
    openSheet(this, RENAME_SHEET);
  },

  closeRenameModal() {
    closeSheet(this, RENAME_SHEET);
  },

  onRenameInput(event) {
    this.setData({ renameTitle: event.detail.value });
  },

  async confirmRename() {
    const title = String(this.data.renameTitle || '').trim();
    if (!title || this.data.renaming) return;
    this.setData({ renaming: true });
    try {
      await aiService.renameStudioWorkflow(this.data.workflowId, title);
      wx.showToast({ title: '已重命名', icon: 'success' });
      this.setData({ renaming: false });
      closeSheet(this, RENAME_SHEET);
      await this.loadStudio({ silent: true });
    } catch (error) {
      this.setData({ renaming: false });
      wx.showToast({ title: error.error || error.message || '重命名失败', icon: 'none' });
    }
  },

  confirmDeleteWorkflow() {
    dismissSheet(this, MENU_SHEET);
    wx.showModal({
      title: '删除方案',
      content: '删除后客户侧已确认图片将移除，且该方案无法继续编辑。',
      confirmColor: '#dc4b3e',
      success: (result) => {
        if (result.confirm) void this.deleteWorkflow();
      },
    });
  },

  async deleteWorkflow() {
    if (this.data.deletingWorkflow) return;
    this.setData({ deletingWorkflow: true });
    wx.showLoading({ title: '删除中', mask: true });
    try {
      await aiService.deleteStudioWorkflow(this.data.workflowId);
      wx.hideLoading();
      wx.showToast({ title: '方案已删除', icon: 'success' });
      this.setData({ deletingWorkflow: false });
      setTimeout(() => this.goBack(), 300);
    } catch (error) {
      wx.hideLoading();
      this.setData({ deletingWorkflow: false });
      wx.showToast({ title: error.error || error.message || '删除方案失败', icon: 'none' });
    }
  },

  openSendModal() {
    const count = this.data.selectedGenerationIds.length;
    if (!count) {
      wx.showToast({ title: '请先勾选要发送的效果图', icon: 'none' });
      return;
    }
    const view = this.data.view;
    this.setData({
      sendTitle: resolveSendTitlePrefill(view),
    });
    openSheet(this, SEND_SHEET);
  },

  closeSendModal() {
    closeSheet(this, SEND_SHEET);
  },

  onSendTitleInput(event) {
    this.setData({ sendTitle: event.detail.value });
  },

  async confirmSendScheme() {
    if (this.data.sendingScheme || !this.data.selectedGenerationIds.length) return;
    const view = this.data.view;
    const title = resolveSendTitle(view, this.data.sendTitle);
    if (!title) {
      wx.showToast({ title: '请输入方案名称', icon: 'none' });
      return;
    }
    this.setData({ sendingScheme: true });
    wx.showLoading({ title: '发送中', mask: true });
    try {
      if (shouldRenameWorkflowOnSend(view, title)) {
        await aiService.renameStudioWorkflow(this.data.workflowId, title);
      }
      await aiService.publishScheme(this.data.leadId, {
        workflowId: this.data.workflowId,
        title,
        generationIds: this.data.selectedGenerationIds,
      });
      wx.hideLoading();
      wx.showToast({
        title: view?.publishedScheme ? '方案已更新' : '已发送给客户',
        icon: 'success',
      });
      this.setData({ sendingScheme: false });
      closeSheet(this, SEND_SHEET);
      await this.loadStudio({ silent: true });
    } catch (error) {
      wx.hideLoading();
      this.setData({ sendingScheme: false });
      wx.showToast({ title: error.error || error.message || '发送失败', icon: 'none' });
    }
  },

  openFinalizeModal() {
    if (!this.data.view?.publishedScheme || this.data.view.publishedScheme.finalized) return;
    openSheet(this, FINALIZE_SHEET);
  },

  closeFinalizeModal() {
    closeSheet(this, FINALIZE_SHEET);
  },

  async confirmFinalizeScheme() {
    if (this.data.finalizingScheme || !this.data.view?.publishedScheme) return;
    this.setData({ finalizingScheme: true });
    wx.showLoading({ title: '定稿中', mask: true });
    try {
      await aiService.finalizeScheme(this.data.leadId, this.data.workflowId);
      wx.hideLoading();
      wx.showToast({ title: '已设为定稿', icon: 'success' });
      this.setData({ finalizingScheme: false });
      closeSheet(this, FINALIZE_SHEET);
      await this.loadStudio({ silent: true });
    } catch (error) {
      wx.hideLoading();
      this.setData({ finalizingScheme: false });
      wx.showToast({ title: error.error || error.message || '定稿失败', icon: 'none' });
    }
  },

  onComposerDraftChange(event) {
    const { field, value } = event.detail;
    this.setData({ composerDraft: { ...this.data.composerDraft, [field]: value } });
  },

  onComposerRenderModeChange(event) {
    const draft = event.detail && event.detail.draft;
    if (!draft) return;
    this.setData({ composerDraft: draft });
  },

  onComposerScopeChange(event) {
    const targetScope = event.detail && event.detail.targetScope === 'single_room'
      ? 'single_room'
      : 'whole_floor_plan';
    const roomId = targetScope === 'single_room' ? String(event.detail && event.detail.roomId || '') : '';
    this.setData({
      composerDraft: applyScopeToDraft(this.data.composerDraft, resolveDraftScope(this.data.scopes, {
        targetScope,
        roomId,
      }) || { targetScope, roomId }),
    });
  },

  onComposerDockExpandChange(event) {
    this.setData({ composerDockExpanded: Boolean(event.detail && event.detail.expanded) });
  },

  onComposerKeyboardHeightChange(event) {
    const height = Math.max(0, Math.floor(Number(event.detail && event.detail.height) || 0));
    this.setData({ composerKeyboardHeight: height });
  },

  onComposerModelChange(event) {
    const modelProfileId = event.detail.modelProfileId;
    const model = (this.data.bootstrap?.models || []).find((item) => item.id === modelProfileId);
    this.setData({
      composerDraft: applyModelDefaults({ ...this.data.composerDraft, modelProfileId }, model),
    });
  },

  clearTemplateQueryTimer() {
    if (this.templateQueryTimer) {
      clearTimeout(this.templateQueryTimer);
      this.templateQueryTimer = null;
    }
  },

  async ensureTemplateCategories() {
    if ((this.data.templateCategories || []).length) {
      return {
        categories: this.data.templateCategories,
        categoryId: this.data.templateCategoryId,
      };
    }
    try {
      const payload = await aiService.loadStudioPromptCategories();
      const categories = Array.isArray(payload?.categories) ? payload.categories : [];
      const categoryId = resolvePreferredTemplateCategoryId(categories);
      this.setData({ templateCategories: categories, templateCategoryId: categoryId });
      return { categories, categoryId };
    } catch (error) {
      this.setData({ templateCategories: [], templateCategoryId: '' });
      return { categories: [], categoryId: '' };
    }
  },

  async loadTemplateList({
    page = 1,
    append = false,
    categoryId,
    query,
  } = {}) {
    const requestId = (this.templateRequestId || 0) + 1;
    this.templateRequestId = requestId;
    const resolvedCategoryId = categoryId === undefined ? this.data.templateCategoryId : categoryId;
    const resolvedQuery = query === undefined ? this.data.templateQuery : query;
    const loadingKey = append ? 'templateLoadingMore' : 'templateLoading';
    this.setData({ [loadingKey]: true });
    try {
      const params = buildTemplateListParams({
        categoryId: resolvedCategoryId,
        query: resolvedQuery,
        page,
        limit: TEMPLATE_PAGE_SIZE,
      });
      const payload = await aiService.loadStudioPromptTemplates(params);
      if (requestId !== this.templateRequestId) return;
      const parsed = parseTemplateListPayload(payload);
      const nextItems = append
        ? (() => {
          const existingIds = new Set((this.data.templates || []).map((item) => String(item.id)));
          return [
            ...(this.data.templates || []),
            ...parsed.items.filter((item) => !existingIds.has(String(item.id))),
          ];
        })()
        : parsed.items;
      this.setData({
        templates: nextItems,
        templatePage: parsed.page,
        templateTotal: parsed.total,
        templateHasMore: nextItems.length < parsed.total,
        [loadingKey]: false,
      });
    } catch (error) {
      if (requestId !== this.templateRequestId) return;
      this.setData({ [loadingKey]: false });
      if (!append) {
        this.setData({ templates: [], templateHasMore: false, templateTotal: 0 });
      }
      wx.showToast({ title: error.error || error.message || '模板加载失败', icon: 'none' });
    }
  },

  async openTemplateSheet() {
    this.clearTemplateQueryTimer();
    this.setData({
      templateSheetVisible: true,
      templateLoading: true,
      templateQuery: '',
      templates: [],
      templateHasMore: false,
    });
    const { categoryId } = await this.ensureTemplateCategories();
    const resolvedCategoryId = this.data.templateCategoryId || categoryId || '';
    if (resolvedCategoryId !== this.data.templateCategoryId) {
      this.setData({ templateCategoryId: resolvedCategoryId });
    }
    await this.loadTemplateList({
      page: 1,
      append: false,
      categoryId: resolvedCategoryId,
      query: '',
    });
  },

  closeTemplateSheet() {
    this.clearTemplateQueryTimer();
    this.setData({ templateSheetVisible: false });
  },

  onTemplateQueryChange(event) {
    const query = event.detail?.query || '';
    const immediate = Boolean(event.detail?.immediate);
    const nextCategoryId = String(query).trim() ? '' : this.data.templateCategoryId;
    this.setData({
      templateQuery: query,
      templateCategoryId: nextCategoryId,
    });
    this.clearTemplateQueryTimer();
    const reload = () => {
      this.loadTemplateList({
        page: 1,
        append: false,
        categoryId: nextCategoryId,
        query,
      });
    };
    if (immediate) {
      reload();
      return;
    }
    this.templateQueryTimer = setTimeout(reload, 320);
  },

  onTemplateCategoryChange(event) {
    const categoryId = event.detail?.categoryId == null ? '' : String(event.detail.categoryId);
    this.clearTemplateQueryTimer();
    this.setData({
      templateCategoryId: categoryId,
      templateQuery: '',
    });
    this.loadTemplateList({
      page: 1,
      append: false,
      categoryId,
      query: '',
    });
  },

  onTemplateLoadMore() {
    if (!this.data.templateHasMore || this.data.templateLoadingMore || this.data.templateLoading) return;
    this.loadTemplateList({ page: (this.data.templatePage || 1) + 1, append: true });
  },

  onSelectTemplate(event) {
    const { template } = event.detail;
    if (!template) return;
    let draft = {
      ...this.data.composerDraft,
      prompt: template.promptContent || this.data.composerDraft.prompt,
      templateId: template.id,
      templateName: template.name || '',
    };
    if (template.recommendedModelProfileId) {
      const model = (this.data.bootstrap?.models || []).find((item) => item.id === template.recommendedModelProfileId);
      if (model) draft = applyModelDefaults({ ...draft, modelProfileId: model.id }, model);
    }
    this.setData({ composerDraft: draft, templateSheetVisible: false });
    wx.showToast({ title: `已应用：${template.name}`, icon: 'none' });
  },

  onTemplateImageError(event) {
    const id = event.detail && event.detail.id;
    if (!id) return;
    const templates = (this.data.templates || []).map((item) => (
      String(item.id) === String(id) ? { ...item, previewFailed: true } : item
    ));
    this.setData({ templates });
  },

  async assistPrompt() {
    const prompt = String(this.data.composerDraft?.prompt || '').trim();
    if (!prompt || this.data.assisting) {
      if (!prompt) wx.showToast({ title: '请先输入提示词', icon: 'none' });
      return;
    }
    this.setData({ assisting: true });
    try {
      const result = await aiService.assistStudioPrompt({ prompt });
      this.setData({
        assisting: false,
        composerDraft: { ...this.data.composerDraft, prompt: result.prompt || prompt },
      });
      wx.showToast({ title: '提示词已优化', icon: 'success' });
    } catch (error) {
      this.setData({ assisting: false });
      wx.showToast({ title: error.error || error.message || '优化失败', icon: 'none' });
    }
  },

  uploadReferenceImage() {
    if (this.data.uploadingReference) return;
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

  applySitePhotoAsReference(photo) {
    const assetId = photo && photo.assetId;
    if (!assetId) {
      wx.showToast({ title: '这张现场图还不能用作参考', icon: 'none' });
      return;
    }
    const existing = this.data.composerDraft && this.data.composerDraft.referenceAssets || [];
    if (existing.some((item) => String(item.id) === String(assetId))) {
      wx.showToast({ title: '这张参考图已添加', icon: 'none' });
      return;
    }
    const referenceAssets = [
      ...existing,
      { id: assetId, previewUrl: photo.imagePath || photo.previewUrl || '', role: 'site_photo' },
    ];
    this.setData({
      uploadingReference: false,
      composerDraft: { ...this.data.composerDraft, referenceAssets },
    });
    wx.showToast({ title: '参考图已添加', icon: 'success' });
  },

  onSitePhotoCaptured(event) {
    const photo = event.detail && event.detail.photo;
    if (!photo) return;
    this.applySitePhotoAsReference(photo);
    closeSheet(this, GALLERY_SHEET);
  },

  onSitePhotoSelect(event) {
    const photo = event.detail && event.detail.photo;
    if (!photo) return;
    this.applySitePhotoAsReference(photo);
    closeSheet(this, GALLERY_SHEET);
  },

  onSitePhotosChange(event) {
    this.setData({ sitePhotos: sitePhotos.mergePhotos(this.data.sitePhotos, event.detail || {}) });
  },

  onSitePhotoUploading(event) {
    this.setData({ uploadingReference: Boolean(event.detail && event.detail.uploading) });
  },

  async uploadReferencePath(filePath, role = 'site_photo') {
    this.setData({ uploadingReference: true });
    try {
      const asset = await aiService.uploadStudioAsset(filePath);
      const referenceAssets = [
        ...(this.data.composerDraft?.referenceAssets || []),
        { id: asset.id, previewUrl: asset.previewUrl || asset.url || '', role },
      ];
      this.setData({
        uploadingReference: false,
        composerDraft: { ...this.data.composerDraft, referenceAssets },
      });
      wx.showToast({ title: '参考图已添加', icon: 'success' });
    } catch (error) {
      this.setData({ uploadingReference: false });
      wx.showToast({ title: error.error || error.message || '参考图上传失败', icon: 'none' });
    }
  },

  removeReferenceImage(event) {
    const { id } = event.detail;
    const referenceAssets = (this.data.composerDraft?.referenceAssets || []).filter((item) => item.id !== id);
    this.setData({ composerDraft: { ...this.data.composerDraft, referenceAssets } });
  },

  async submitGeneration() {
    if (this.data.generating || !this.data.composerDraft) return;
    const draft = this.data.composerDraft;
    const prompt = String(draft.prompt || '').trim();
    if (!prompt) {
      wx.showToast({ title: '请输入提示词', icon: 'none' });
      return;
    }
    // Whole-house rounds use the floor-plan scope by default. Photo-first
    // rounds can run from the现场图 alone; only an explicitly selected room
    // is sent as optional identity metadata.
    const hasSelectedRoom = draft.targetScope === 'single_room'
      && String(draft.roomId || '').trim();
    const scopePayload = this.data.floorPlanId
      && (draft.renderMode === WHOLE_HOUSE_RENDER_MODE || hasSelectedRoom)
      ? buildScopeSubmitPayload(draft)
      : null;
    this.setData({ generating: true });
    wx.showLoading({ title: '提交中', mask: true });
    try {
      let task = this.data.task;
      if (!task?.id) {
        task = await aiService.createStudioTask({
          title: this.data.view?.workflow?.title || prompt.slice(0, 32),
          prompt,
          modelProfileId: draft.modelProfileId,
          referenceAssetIds: (draft.referenceAssets || []).map((item) => item.id),
        });
      }
      const payload = await aiService.submitStudioBatch(task.id, {
        prompt,
        negativePrompt: draft.negativePrompt || '',
        referenceAssetIds: (draft.referenceAssets || []).map((item) => item.id),
        modelProfileId: draft.modelProfileId,
        aspectRatio: draft.aspectRatio,
        resolutionTier: draft.resolutionTier,
        templateId: draft.templateId || undefined,
        count: draft.count || 1,
        workflowId: this.data.workflowId,
        renderMode: draft.renderMode,
        hasStyleReference: false,
        hasSitePhoto: (draft.referenceAssets || []).some((item) => item.role === 'site_photo'),
        sitePhotoAssetIds: (draft.referenceAssets || [])
          .filter((item) => item.role === 'site_photo')
          .map((item) => item.id),
        ...(scopePayload ? {
          targetScope: scopePayload.targetScope,
          roomId: scopePayload.roomId,
        } : {}),
      });
      if (payload?.account && this.data.bootstrap) {
        this.setData({
          bootstrap: { ...this.data.bootstrap, account: payload.account },
        });
      }
      this.setData({ generating: false, task: payload?.task || task });
      wx.hideLoading();
      wx.showToast({ title: '生成任务已提交', icon: 'success' });
      await this.loadStudio({ silent: true });
      const nextDraft = createDefaultDraft(this.data.bootstrap);
      this.setData({
        composerDraft: applyScopeToDraft(nextDraft, resolveDraftScope(this.data.scopes, nextDraft)),
      });
    } catch (error) {
      wx.hideLoading();
      this.setData({ generating: false });
      wx.showToast({ title: error.error || error.message || '提交失败', icon: 'none' });
    }
  },

  async retryBatch(event) {
    const { batchId } = event.currentTarget.dataset;
    const batch = (this.data.view?.batches || []).find((item) => item.id === batchId);
    if (!batch || batch.isLegacy || this.data.retryingBatchId) return;
    const taskId = this.data.task?.id;
    if (!taskId) {
      wx.showToast({ title: '创作任务尚未建立', icon: 'none' });
      return;
    }
    this.setData({ retryingBatchId: batchId });
    wx.showLoading({ title: '重试中', mask: true });
    try {
      const payload = await aiService.retryStudioBatch(taskId, batchId);
      if (payload?.account && this.data.bootstrap) {
        this.setData({
          bootstrap: { ...this.data.bootstrap, account: payload.account },
        });
      }
      this.setData({
        retryingBatchId: '',
        task: payload?.task || this.data.task,
      });
      wx.hideLoading();
      wx.showToast({ title: '已重试失败项', icon: 'success' });
      await this.loadStudio({ silent: true });
    } catch (error) {
      wx.hideLoading();
      this.setData({ retryingBatchId: '' });
      wx.showToast({ title: error.error || error.message || '重试失败', icon: 'none' });
      await this.loadStudio({ silent: true });
    }
  },

  regenerateBatch(event) {
    const { batchId } = event.currentTarget.dataset;
    const batch = (this.data.view?.batches || []).find((item) => item.id === batchId);
    if (!batch) return;
    const restored = buildDraftFromBatch(batch, this.data.bootstrap);
    const draft = applyScopeToDraft(restored, resolveDraftScope(this.data.scopes, restored));
    this.setData({ composerDraft: draft }, () => {
      void this.submitGeneration();
    });
  },

  editBatch(event) {
    const { batchId } = event.currentTarget.dataset;
    const batch = (this.data.view?.batches || []).find((item) => item.id === batchId);
    if (!batch) return;
    const draft = buildDraftFromBatch(batch, this.data.bootstrap);
    this.setData({
      composerDraft: applyScopeToDraft(draft, resolveDraftScope(this.data.scopes, draft)),
    });
  },

  toggleGenerationSelect(event) {
    const { batchIndex, generationIndex } = event.currentTarget.dataset;
    const target = findGenerationTarget(this.data.view, Number(batchIndex), Number(generationIndex));
    if (!target || !target.canSelect) return;
    const checked = !this.data.selectedGenerationIds.includes(String(target.generationId));
    const selectedGenerationIds = toggleGenerationSelection(
      this.data.selectedGenerationIds,
      target.generationId,
      checked,
    );
    this.setData({
      selectedGenerationIds,
      view: applySelectionToView(this.previousView, selectedGenerationIds),
    });
  },

  previewGeneration(event) {
    const { batchIndex, generationIndex } = event.currentTarget.dataset;
    const batch = this.data.view && this.data.view.batches[batchIndex];
    const generation = batch && batch.generations[generationIndex];
    if (!generation || !generation.imageUrl) return;
    const urls = batch.generations
      .filter((item) => item.imageUrl)
      .map((item) => item.imageUrl);
    wx.previewImage({ urls, current: generation.imageUrl });
  },

  openGenerationActions(event) {
    const { batchIndex, generationIndex } = event.currentTarget.dataset;
    const target = findGenerationTarget(this.data.view, Number(batchIndex), Number(generationIndex));
    if (!target) return;
    this.actionTarget = target;
    const options = [];
    if (target.canSave) options.push('保存到相册');
    if (target.canContinue) options.push('作参考图继续');
    if (target.canSelect) {
      const selected = this.data.selectedGenerationIds.includes(String(target.generationId));
      options.push(selected ? '取消发送勾选' : '勾选发送给客户');
    }
    if (target.canWithdraw) options.push('撤回客户确认');
    if (target.canDelete) options.push('删除此图');
    if (!options.length) return;
    wx.showActionSheet({
      itemList: options,
      success: (result) => {
        const action = options[result.tapIndex];
        if (action === '保存到相册') void this.saveGenerationImage(target);
        else if (action === '作参考图继续') void this.continueFromGeneration(target);
        else if (action === '勾选发送给客户' || action === '取消发送勾选') this.toggleGenerationSelect(event);
        else if (action === '撤回客户确认') this.confirmWithdrawGeneration(target);
        else if (action === '删除此图') this.confirmDeleteGeneration(target);
      },
    });
  },

  async saveGenerationImage(target) {
    if (!target?.generation?.imageUrl) return;
    wx.showLoading({ title: '保存中', mask: true });
    try {
      const filePath = await downloadImage(target.generation.imageUrl);
      await saveImageToAlbum(filePath);
      wx.hideLoading();
      wx.showToast({ title: '已保存到相册', icon: 'success' });
    } catch (error) {
      wx.hideLoading();
      if (isAlbumPermissionError(error)) {
        wx.showModal({
          title: '需要相册权限',
          content: '请在设置中允许保存到相册后重试。',
          confirmText: '去设置',
          success: (result) => {
            if (result.confirm) wx.openSetting({});
          },
        });
        return;
      }
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },

  async continueFromGeneration(target) {
    if (!target?.generation?.imageUrl || this.data.uploadingReference) return;
    wx.showLoading({ title: '引用中', mask: true });
    try {
      const filePath = await downloadImage(target.generation.imageUrl);
      wx.hideLoading();
      await this.uploadReferencePath(filePath, 'baseline');
      wx.showToast({ title: '已加入参考图', icon: 'success' });
    } catch (error) {
      wx.hideLoading();
      wx.showToast({ title: error.message || '引用失败', icon: 'none' });
    }
  },

  confirmWithdrawGeneration(target) {
    wx.showModal({
      title: '撤回客户确认',
      content: '撤回后客户将不再看到这张效果图，可重新勾选后再次发送。',
      confirmColor: '#dc4b3e',
      success: (result) => {
        if (result.confirm) void this.withdrawGeneration(target);
      },
    });
  },

  async withdrawGeneration(target) {
    if (!target?.generationId || this.data.withdrawingGeneration) return;
    this.setData({ withdrawingGeneration: true });
    wx.showLoading({ title: '撤回中', mask: true });
    try {
      await aiService.withdrawSchemeGeneration(
        this.data.leadId,
        this.data.workflowId,
        target.generationId,
      );
      wx.hideLoading();
      this.setData({ withdrawingGeneration: false });
      wx.showToast({ title: '已撤回', icon: 'success' });
      await this.loadStudio({ silent: true });
    } catch (error) {
      wx.hideLoading();
      this.setData({ withdrawingGeneration: false });
      wx.showToast({ title: error.error || error.message || '撤回失败', icon: 'none' });
    }
  },

  confirmDeleteGeneration(target) {
    wx.showModal({
      title: '删除效果图',
      content: '删除后该图将从方案中移除；若已发送给客户，也会一并撤回。',
      confirmColor: '#dc4b3e',
      success: (result) => {
        if (result.confirm) void this.deleteGeneration(target);
      },
    });
  },

  async deleteGeneration(target) {
    if (!target?.generationId || this.data.deletingGeneration) return;
    this.setData({ deletingGeneration: true });
    wx.showLoading({ title: '删除中', mask: true });
    try {
      await aiService.deleteStudioGeneration(this.data.workflowId, target.generationId);
      wx.hideLoading();
      this.setData({ deletingGeneration: false });
      wx.showToast({ title: '已删除', icon: 'success' });
      await this.loadStudio({ silent: true });
    } catch (error) {
      wx.hideLoading();
      this.setData({ deletingGeneration: false });
      wx.showToast({ title: error.error || error.message || '删除失败', icon: 'none' });
    }
  },

  previewFloorPlan() {
    const url = this.data.view && this.data.view.workflow.floorPlanPreviewUrl;
    if (!url) return;
    wx.previewImage({ urls: [url], current: url });
  },

  onShareAppMessage() {
    const view = this.data.view;
    const title = view && view.workflow.title ? view.workflow.title : 'AI 设计方案';
    const query = [
      `leadId=${this.data.leadId}`,
      this.data.workflowId ? `workflowId=${this.data.workflowId}` : '',
      this.data.floorPlanId ? `floorPlanId=${this.data.floorPlanId}` : '',
    ].filter(Boolean).join('&');
    return {
      title,
      path: `/packages/ai-workflow/scheme-studio/scheme-studio?${query}`,
    };
  },
});
