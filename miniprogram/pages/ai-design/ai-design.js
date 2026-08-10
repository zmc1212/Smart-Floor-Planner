const aiService = require('../../utils/aiDesignService.js');
const { prioritizeProcessingTasks } = require('../../utils/aiDesignTaskOrdering.js');
const { consumeAIDesignContext, normalizeAIDesignContext } = require('../../utils/aiDesignNavigation.js');
const { canAccessAIDesign, showAIDesignAccessDenied } = require('../../utils/aiDesignAccess.js');
const {
  decorateSourcePlan,
  decorateRecentResult,
  buildHeroSlides,
  hasActiveTasks,
  normalizeCredits,
  buildExperienceState,
} = require('./ai-design-model.js');

const WORKFLOW_DEFINITIONS = [
  { key: 'reference_recreate', title: '参考图复刻', description: '参考灵感图，还原到真实空间', icon: '/images/ai-design-icons/reference.png', requires: 'edit' },
  { key: 'style_transform', title: '空间换风格', description: '保留结构，一键切换设计风格', icon: '/images/ai-design-icons/palette.png', requires: 'edit' },
  { key: 'floor_plan_render', title: '户型生成', description: '按正式量房数据生成概念效果', icon: '/images/ai-design-icons/floor-plan.png', requires: 'generate' },
  { key: 'soft_furnishing', title: '软装搭配', description: '保留硬装，重点优化软装细节', icon: '/images/ai-design-icons/armchair.png', requires: 'edit' },
];

const MODE_TITLES = WORKFLOW_DEFINITIONS.reduce((result, item) => {
  result[item.key] = item.title;
  return result;
}, {});

function buildSelectedSource(plan, targetScope, room) {
  if (!plan) return null;
  if (targetScope === 'single_room' && !room) return null;
  const roomCount = Number(plan.closedRoomCount || (plan.rooms || []).length || 0);
  const openingCount = targetScope === 'single_room'
    ? Number(room.openingCount || 0)
    : (plan.rooms || []).reduce((sum, item) => sum + Number(item.openingCount || 0), 0);
  return {
    ...plan,
    targetScope,
    targetLabel: targetScope === 'whole_floor_plan' ? '完整户型' : room.roomName,
    roomId: targetScope === 'single_room' ? room.roomId : '',
    roomName: targetScope === 'single_room' ? room.roomName : '完整户型',
    roomSize: targetScope === 'single_room' ? room.roomSize : `${roomCount} 个闭合房间`,
    openingCount,
  };
}

function sourceTargetKey(source) {
  if (!source) return '';
  return [source.floorPlanId || '', source.targetScope || '', source.roomId || ''].join(':');
}

Page({
  data: {
    loading: true,
    hasLoadedOnce: false,
    loadError: '',
    historyLoadError: '',
    refreshing: false,
    account: { availableBalance: 0, frozenBalance: 0 },
    workflows: WORKFLOW_DEFINITIONS,
    provider: { available: false, supportsEdit: false, supportsGenerate: false },
    recent: [],
    heroResults: [],
    heroSlides: [],
    activeHeroSlide: 0,
    sources: [],
    selectedSource: null,
    sourcePickerOpen: false,
    sourcePickerStep: 'plans',
    activeSourcePlan: null,
    schemeOptions: [],
    selectedWorkflow: null,
    workflowPickerOpen: false,
    workflowLoading: false,
    workflowLoadError: '',
    workflowId: '',
    createNewWorkflow: false,
    floorPlanId: '',
    leadId: '',
    roomId: '',
    targetScope: '',
    stageRail: [],
    primaryAction: null,
    secondaryActions: [],
    activeSceneMode: 'reference_recreate',
    sceneNavigation: null,
    navigationTop: 24,
    navigationHeight: 32,
    navigationRight: 96,
  },

  onLoad(options) {
    this.syncImmersiveNavigationMetrics();
    this.applyNavigationContext(options);
  },

  onShow() {
    if (!canAccessAIDesign()) {
      this.recentPageVisible = false;
      this.stopRecentPolling();
      showAIDesignAccessDenied();
      wx.switchTab({ url: '/pages/index/index' });
      return;
    }

    this.syncTabBar();
    this.recentPageVisible = true;
    this.stopRecentPolling();
    const pendingContext = consumeAIDesignContext();
    if (pendingContext) {
      this.applyNavigationContext(pendingContext, () => this.loadData());
      return;
    }
    this.loadData();
  },

  syncTabBar() {
    const tabBar = typeof this.getTabBar === 'function' && this.getTabBar();
    if (tabBar) {
      tabBar.syncSelected();
    }
  },

  syncImmersiveNavigationMetrics() {
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    let menuRect = null;
    try {
      menuRect = wx.getMenuButtonBoundingClientRect();
    } catch (error) {
      console.warn('Failed to read menu button metrics', error);
    }
    const statusBarHeight = Number(windowInfo.statusBarHeight || 0);
    const navigationTop = Number(menuRect && menuRect.top
      ? menuRect.top
      : statusBarHeight + 6);
    const navigationHeight = Number(menuRect && menuRect.height
      ? menuRect.height
      : 32);
    const menuLeft = Number(menuRect && menuRect.left
      ? menuRect.left
      : windowInfo.windowWidth);

    this.setData({
      navigationTop,
      navigationHeight,
      navigationRight: Math.max(92, Number(windowInfo.windowWidth || 390) - menuLeft + 12),
    });
  },

  onHide() {
    this.recentPageVisible = false;
    this.stopRecentPolling();
  },

  onUnload() {
    this.recentPageVisible = false;
    this.stopRecentPolling();
  },

  onPullDownRefresh() {
    this.loadData().finally(() => wx.stopPullDownRefresh());
  },

  onRefresh() {
    this.setData({ refreshing: true });
    this.loadData().finally(() => this.setData({ refreshing: false }));
  },

  applyNavigationContext(options, callback) {
    const context = normalizeAIDesignContext(options);
    this.setData({
      floorPlanId: context.floorPlanId || '',
      leadId: context.leadId || '',
      roomId: context.roomId || '',
      targetScope: context.targetScope || '',
      workflowId: context.workflowId || '',
    }, callback);
  },

  async loadData() {
    this.setData({ loading: true, loadError: '' });
    try {
      const [capabilities, historyResult, sourceData] = await Promise.all([
        aiService.loadCapabilities(),
        aiService.loadHistory(1, 4)
          .then((history) => ({ history, error: '' }))
          .catch((error) => ({
            history: null,
            error: error.error || error.message || '最近成果加载失败',
          })),
        aiService.loadSources(),
      ]);
      const priceMap = (capabilities.modes || []).reduce((result, item) => {
        result[item.key] = item;
        return result;
      }, {});
      const provider = capabilities.provider || { available: false };
      const workflows = WORKFLOW_DEFINITIONS.map((item) => {
        const capability = priceMap[item.key] || {};
        const providerReady = item.requires === 'generate' ? provider.supportsGenerate : provider.supportsEdit;
        return {
          ...item,
          credits: normalizeCredits(capability.credits),
          enabled: capability.enabled !== false && providerReady !== false,
        };
      });
      const recent = historyResult.history
        ? prioritizeProcessingTasks(
          (historyResult.history.data || []).map((item) => decorateRecentResult({
            ...item,
            modeTitle: MODE_TITLES[item.mode] || '设计成果',
          })),
        )
        : this.data.recent;
      const sourcePlans = sourceData.map(decorateSourcePlan);
      const selectedPlan = sourcePlans.find((item) => item.floorPlanId === this.data.floorPlanId) || null;
      const requestedScope = this.data.targetScope || (this.data.roomId ? 'single_room' : 'whole_floor_plan');
      const selectedRoom = selectedPlan && requestedScope === 'single_room'
        ? (selectedPlan.rooms || []).find((room) => room.roomId === this.data.roomId)
        : null;
      const selectedSource = selectedPlan
        ? buildSelectedSource(selectedPlan, requestedScope, selectedRoom)
        : null;
      const sources = sourcePlans.map((item) => ({
        ...item,
        sourceKey: item.floorPlanId,
        selected: !!selectedSource && item.floorPlanId === selectedSource.floorPlanId,
      }));
      const workflowQuery = {
        workflowId: this.data.workflowId,
        leadId: selectedSource ? selectedSource.leadId : this.data.leadId,
      };
      if (selectedSource) {
        workflowQuery.floorPlanId = selectedSource.floorPlanId;
        workflowQuery.targetScope = selectedSource.targetScope;
        workflowQuery.roomId = selectedSource.roomId;
      }
      const [schemeOptions, heroResults] = await Promise.all([
        aiService.loadWorkflows(workflowQuery),
        selectedSource
          ? aiService.loadHeroFloorPlanResults(selectedSource.floorPlanId).catch(() => [])
          : Promise.resolve([]),
      ]);
      const selectedWorkflow = schemeOptions.find((item) => item.id === this.data.workflowId)
        || (schemeOptions.length === 1 ? schemeOptions[0] : null);
      const decoratedWorkflows = workflows.map((item) => ({
        ...item,
        recommended: !!selectedWorkflow
          && !!selectedWorkflow.targetContext
          && selectedWorkflow.targetContext.recommendedMiniMode === item.key,
      }));
      const experienceState = buildExperienceState({
        workflows: decoratedWorkflows,
        selectedSource,
        selectedWorkflow,
      });
      const decoratedHeroResults = heroResults.map((item) => decorateRecentResult({
        ...item,
        modeTitle: MODE_TITLES[item.mode] || '璁捐鎴愭灉',
      }));
      const heroSlides = buildHeroSlides(decoratedHeroResults, selectedSource);
      this.setData({
        account: capabilities.account || { availableBalance: 0, frozenBalance: 0 },
        workflows: decoratedWorkflows,
        provider,
        recent,
        heroResults: decoratedHeroResults,
        heroSlides,
        activeHeroSlide: 0,
        sources,
        selectedSource,
        floorPlanId: selectedSource ? selectedSource.floorPlanId : this.data.floorPlanId,
        leadId: selectedSource ? selectedSource.leadId : this.data.leadId,
        roomId: selectedSource ? selectedSource.roomId : this.data.roomId,
        targetScope: selectedSource ? selectedSource.targetScope : this.data.targetScope,
        schemeOptions,
        selectedWorkflow,
        workflowId: selectedWorkflow ? selectedWorkflow.id : '',
        workflowPickerOpen: schemeOptions.length > 1 && !selectedWorkflow,
        workflowLoading: false,
        workflowLoadError: '',
        createNewWorkflow: false,
        hasLoadedOnce: true,
        loadError: '',
        historyLoadError: historyResult.error,
        ...experienceState,
      });
      this.scheduleRecentPolling(recent, selectedSource, selectedWorkflow);
    } catch (error) {
      const loadError = error.error || error.message || 'AI 服务加载失败';
      this.setData({ loadError });
      if (this.data.hasLoadedOnce) {
        wx.showToast({ title: '刷新失败，已保留当前内容', icon: 'none' });
      }
    } finally {
      this.setData({ loading: false });
    }
  },

  retryLoad() {
    if (this.data.loading) return;
    this.loadData();
  },

  stopRecentPolling() {
    if (this.recentPollTimer) clearTimeout(this.recentPollTimer);
    this.recentPollTimer = null;
  },

  scheduleRecentPolling(
    recent,
    selectedSource = this.data.selectedSource,
    selectedWorkflow = this.data.selectedWorkflow
  ) {
    this.stopRecentPolling();
    const previewProcessing = selectedSource
      && selectedSource.navigationPreview
      && selectedSource.navigationPreview.state === 'processing';
    const targetProcessing = selectedWorkflow
      && selectedWorkflow.targetContext
      && selectedWorkflow.targetContext.status === 'processing';
    if (!this.recentPageVisible
      || (!hasActiveTasks(recent) && !previewProcessing && !targetProcessing)) return;
    this.recentPollTimer = setTimeout(() => this.refreshRecent(), 5000);
  },

  async refreshRecent() {
    if (!this.recentPageVisible) return;
    try {
      const requestedSource = this.data.selectedSource;
      const requestedTargetKey = sourceTargetKey(requestedSource);
      const previewTask = this.data.selectedSource
        && this.data.selectedSource.navigationPreview
        && this.data.selectedSource.navigationPreview.task;
      const [history, refreshedPreviewTask, refreshedWorkflows, heroResults] = await Promise.all([
        aiService.loadHistory(1, 4),
        previewTask && ['created', 'pending', 'processing'].includes(previewTask.status)
          ? aiService.getTask(previewTask.id).catch(() => null)
          : Promise.resolve(null),
        requestedSource
          ? aiService.loadWorkflows({
            leadId: requestedSource.leadId,
            floorPlanId: requestedSource.floorPlanId,
            targetScope: requestedSource.targetScope,
            roomId: requestedSource.roomId,
          }).catch(() => null)
          : Promise.resolve(null),
        requestedSource
          ? aiService.loadHeroFloorPlanResults(requestedSource.floorPlanId).catch(() => [])
          : Promise.resolve([]),
      ]);
      if (requestedTargetKey !== sourceTargetKey(this.data.selectedSource)) return;
      const recent = prioritizeProcessingTasks(
        (history.data || []).map((item) => decorateRecentResult({
          ...item,
          modeTitle: MODE_TITLES[item.mode] || '设计成果',
        })),
      );
      let selectedSource = this.data.selectedSource;
      if (selectedSource && refreshedPreviewTask) {
        const previewState = refreshedPreviewTask.status === 'succeeded'
          ? 'ready'
          : refreshedPreviewTask.status === 'failed'
            ? (selectedSource.navigationPreview.imageUrl ? 'ready' : 'missing')
            : 'processing';
        selectedSource = {
          ...selectedSource,
          navigationPreview: {
            ...selectedSource.navigationPreview,
            state: previewState,
            task: previewState === 'ready' && refreshedPreviewTask.status === 'failed'
              ? selectedSource.navigationPreview.readyTask
              : refreshedPreviewTask,
            readyTask: previewState === 'ready' && refreshedPreviewTask.status === 'succeeded'
              ? refreshedPreviewTask
              : selectedSource.navigationPreview.readyTask,
            imageUrl: previewState === 'ready'
              ? (refreshedPreviewTask.resultImageUrl || selectedSource.navigationPreview.imageUrl)
              : selectedSource.navigationPreview.imageUrl,
          },
        };
      }
      const schemeOptions = refreshedWorkflows || this.data.schemeOptions;
      const selectedWorkflow = refreshedWorkflows
        ? (schemeOptions.find((item) => item.id === this.data.workflowId)
          || (schemeOptions.length === 1 ? schemeOptions[0] : null))
        : this.data.selectedWorkflow;
      const recommendedMode = selectedWorkflow
        && selectedWorkflow.targetContext
        && selectedWorkflow.targetContext.recommendedMiniMode;
      const decoratedHeroResults = heroResults.map((item) => decorateRecentResult({
        ...item,
        modeTitle: MODE_TITLES[item.mode] || '璁捐鎴愭灉',
      }));
      const heroSlides = buildHeroSlides(decoratedHeroResults, selectedSource);
      this.setData({
        recent,
        heroResults: decoratedHeroResults,
        heroSlides,
        activeHeroSlide: Math.min(this.data.activeHeroSlide, Math.max(0, heroSlides.length - 1)),
        selectedSource,
        schemeOptions,
        selectedWorkflow,
        workflowId: refreshedWorkflows
          ? (selectedWorkflow ? selectedWorkflow.id : '')
          : this.data.workflowId,
        workflowPickerOpen: refreshedWorkflows
          ? schemeOptions.length > 1 && !selectedWorkflow
          : this.data.workflowPickerOpen,
        workflows: this.data.workflows.map((item) => ({
          ...item,
          recommended: item.key === recommendedMode,
        })),
        historyLoadError: '',
      }, () => this.syncExperienceState());
      this.scheduleRecentPolling(recent, selectedSource, selectedWorkflow);
    } catch (error) {
      this.setData({ historyLoadError: error.error || error.message || '最近成果刷新失败' });
      this.scheduleRecentPolling(this.data.recent);
    }
  },

  syncExperienceState() {
    this.setData(buildExperienceState(this.data));
  },

  onHeroSlideChange(event) {
    this.setData({ activeHeroSlide: Number(event.detail.current || 0) });
  },

  openHeroSlide(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    this.openResult({ currentTarget: { dataset: { id } } });
  },

  openMode(event) {
    const mode = event.currentTarget.dataset.mode;
    const requestedScope = event.currentTarget.dataset.scope;
    const sourceResultTaskId = event.currentTarget.dataset.sourceResultTaskId || '';
    const effectiveTargetScope = requestedScope || this.data.targetScope;
    const effectiveRoomId = effectiveTargetScope === 'whole_floor_plan' ? '' : this.data.roomId;
    if (this.data.workflowLoading) {
      wx.showToast({ title: '客户方案正在加载，请稍候', icon: 'none' });
      return;
    }
    if (this.data.workflowLoadError) {
      wx.showToast({ title: '客户方案加载失败，请先重试', icon: 'none' });
      return;
    }
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
        wx.showToast({ title: '请先关联户型并选择设计范围', icon: 'none' });
      } else {
        wx.showToast({ title: '暂无可关联的正式户型', icon: 'none' });
      }
      return;
    }
    if (mode === 'floor_plan_render') {
      const support = (this.data.provider && this.data.provider.floorPlanTargetSupport) || {};
      if (support[effectiveTargetScope] === false) {
        wx.showToast({
          title: effectiveTargetScope === 'whole_floor_plan' ? '全屋 3D 生成服务暂未配置' : '单房间生成服务暂未配置',
          icon: 'none',
        });
        return;
      }
    }
    const query = [
      `mode=${mode}`,
      this.data.floorPlanId ? `floorPlanId=${this.data.floorPlanId}` : '',
      this.data.leadId ? `leadId=${this.data.leadId}` : '',
      effectiveRoomId ? `roomId=${effectiveRoomId}` : '',
      effectiveTargetScope ? `targetScope=${effectiveTargetScope}` : '',
      this.data.workflowId ? `workflowId=${this.data.workflowId}` : '',
      this.data.createNewWorkflow ? 'createNewWorkflow=1' : '',
      sourceResultTaskId ? `sourceResultTaskId=${sourceResultTaskId}` : '',
    ].filter(Boolean).join('&');
    wx.navigateTo({ url: `/packages/ai-workflow/create/ai-design-create?${query}` });
  },

  openPrimaryAction() {
    if (this.data.workflowLoading || this.data.workflowLoadError) {
      wx.showToast({
        title: this.data.workflowLoading ? '客户方案正在加载，请稍候' : '客户方案加载失败，请先重试',
        icon: 'none',
      });
      return;
    }
    const action = this.data.primaryAction;
    if (action && action.actionType === 'busy') {
      wx.showToast({ title: '其他成员正在生成当前空间', icon: 'none' });
      return;
    }
    if (action && action.actionType === 'handoff') {
      wx.showToast({ title: '请在管理后台继续深化当前方案', icon: 'none' });
      return;
    }
    if (!action || action.enabled === false) {
      wx.showToast({ title: '当前服务暂不可用', icon: 'none' });
      return;
    }
    if (action.actionType === 'result' && action.taskId) {
      this.openResult({ currentTarget: { dataset: { id: action.taskId } } });
      return;
    }
    if (action.actionType === 'history') {
      this.openHistory();
      return;
    }
    this.openMode({
      currentTarget: {
        dataset: {
          mode: action.mode,
          scope: action.targetScope,
          sourceResultTaskId: action.sourceResultTaskId,
        },
      },
    });
  },

  focusSceneWaypoint(event) {
    const mode = event.currentTarget.dataset.mode;
    if (!mode || mode === this.data.activeSceneMode) return;
    this.setData({ activeSceneMode: mode }, () => this.syncExperienceState());
  },

  enterSceneMode() {
    const navigation = this.data.sceneNavigation;
    if (!navigation || navigation.enabled === false) {
      wx.showToast({ title: '当前服务暂不可用', icon: 'none' });
      return;
    }
    if (navigation.mode === 'floor_plan_render' && !this.data.floorPlanId) {
      this.openSourcePicker();
      return;
    }
    this.openMode({
      currentTarget: {
        dataset: {
          mode: navigation.mode,
          scope: navigation.targetScope,
        },
      },
    });
  },

  openSourcePicker() {
    if (!this.data.sources.length) {
      wx.showToast({ title: '暂无可关联的正式户型', icon: 'none' });
      return;
    }
    this.setData({ sourcePickerOpen: true, sourcePickerStep: 'plans', activeSourcePlan: null });
  },

  closeSourcePicker() {
    this.setData({ sourcePickerOpen: false, sourcePickerStep: 'plans', activeSourcePlan: null });
  },

  noop() {},

  selectSourcePlan(event) {
    const plan = this.data.sources[Number(event.currentTarget.dataset.index)];
    if (!plan) return;
    this.setData({ activeSourcePlan: plan, sourcePickerStep: 'targets' });
  },

  backSourcePlans() {
    this.setData({ activeSourcePlan: null, sourcePickerStep: 'plans' });
  },

  selectWholeSource() {
    this.applySource(this.data.activeSourcePlan, 'whole_floor_plan');
  },

  selectRoomSource(event) {
    const plan = this.data.activeSourcePlan;
    const room = plan && (plan.rooms || [])[Number(event.currentTarget.dataset.index)];
    if (!plan || !room) return;
    this.applySource(plan, 'single_room', room);
  },

  async applySource(plan, targetScope, room) {
    const source = buildSelectedSource(plan, targetScope, room);
    if (!source) return;
    const preferredWorkflowId = this.data.workflowId;
    const sources = this.data.sources.map((item) => ({
      ...item,
      selected: item.floorPlanId === source.floorPlanId,
    }));
    this.setData({
      sources,
      selectedSource: source,
      heroResults: [],
      heroSlides: [],
      activeHeroSlide: 0,
      floorPlanId: source.floorPlanId,
      leadId: source.leadId,
      roomId: source.roomId,
      targetScope: source.targetScope,
      sourcePickerOpen: false,
      sourcePickerStep: 'plans',
      activeSourcePlan: null,
      selectedWorkflow: null,
      workflowId: preferredWorkflowId,
      createNewWorkflow: false,
      schemeOptions: [],
      workflows: this.data.workflows.map((item) => ({ ...item, recommended: false })),
      workflowPickerOpen: false,
      workflowLoading: true,
      workflowLoadError: '',
    }, () => this.syncExperienceState());
    await this.loadSourceWorkflows(source, preferredWorkflowId);
  },

  async loadSourceWorkflows(source, preferredWorkflowId = this.data.workflowId) {
    if (!source) return;
    const requestId = Number(this.workflowLoadRequestId || 0) + 1;
    this.workflowLoadRequestId = requestId;
    this.setData({ workflowLoading: true, workflowLoadError: '' });
    try {
      const [schemeOptions, heroResults] = await Promise.all([
        aiService.loadWorkflows({
          leadId: source.leadId,
          floorPlanId: source.floorPlanId,
          targetScope: source.targetScope,
          roomId: source.roomId,
        }),
        aiService.loadHeroFloorPlanResults(source.floorPlanId).catch(() => []),
      ]);
      if (requestId !== this.workflowLoadRequestId
        || sourceTargetKey(source) !== sourceTargetKey(this.data.selectedSource)) return;
      const selectedWorkflow = schemeOptions.find((item) => item.id === preferredWorkflowId)
        || (schemeOptions.length === 1 ? schemeOptions[0] : null);
      const recommendedMode = selectedWorkflow
        && selectedWorkflow.targetContext
        && selectedWorkflow.targetContext.recommendedMiniMode;
      const decoratedHeroResults = heroResults.map((item) => decorateRecentResult({
        ...item,
        modeTitle: MODE_TITLES[item.mode] || '璁捐鎴愭灉',
      }));
      const heroSlides = buildHeroSlides(decoratedHeroResults, source);
      this.setData({
        schemeOptions,
        heroResults: decoratedHeroResults,
        heroSlides,
        activeHeroSlide: 0,
        selectedWorkflow,
        workflowId: selectedWorkflow ? selectedWorkflow.id : '',
        workflows: this.data.workflows.map((item) => ({
          ...item,
          recommended: item.key === recommendedMode,
        })),
        workflowPickerOpen: schemeOptions.length > 1 && !selectedWorkflow,
        workflowLoadError: '',
      }, () => {
        this.syncExperienceState();
        this.scheduleRecentPolling(this.data.recent, source, selectedWorkflow);
      });
    } catch (error) {
      if (requestId !== this.workflowLoadRequestId
        || sourceTargetKey(source) !== sourceTargetKey(this.data.selectedSource)) return;
      this.setData({
        schemeOptions: [],
        selectedWorkflow: null,
        workflowId: '',
        workflowPickerOpen: false,
        workflowLoadError: error.error || error.message || '客户方案加载失败',
      }, () => this.syncExperienceState());
      wx.showToast({ title: '客户方案加载失败，请重试', icon: 'none' });
    } finally {
      if (requestId === this.workflowLoadRequestId
        && sourceTargetKey(source) === sourceTargetKey(this.data.selectedSource)) {
        this.setData({ workflowLoading: false });
      }
    }
  },

  retryWorkflowLoad() {
    if (this.data.workflowLoading) return;
    this.loadSourceWorkflows(this.data.selectedSource);
  },

  selectMapTarget(event) {
    const source = this.data.selectedSource;
    if (!source) return;
    const scope = event.currentTarget.dataset.scope;
    if (scope === 'whole_floor_plan') {
      this.applySource(source, 'whole_floor_plan');
      return;
    }
    const room = (source.rooms || [])[Number(event.currentTarget.dataset.index)];
    if (room) this.applySource(source, 'single_room', room);
  },

  clearSource() {
    this.workflowLoadRequestId = Number(this.workflowLoadRequestId || 0) + 1;
    this.setData({
      sources: this.data.sources.map((item) => ({ ...item, selected: false })),
      selectedSource: null,
      heroResults: [],
      heroSlides: [],
      activeHeroSlide: 0,
      floorPlanId: '',
      leadId: '',
      roomId: '',
      targetScope: '',
      sourcePickerStep: 'plans',
      activeSourcePlan: null,
      schemeOptions: [],
      selectedWorkflow: null,
      workflowId: '',
      workflowPickerOpen: false,
      workflowLoading: false,
      workflowLoadError: '',
      createNewWorkflow: false,
    }, () => this.syncExperienceState());
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
      workflows: this.data.workflows.map((item) => ({
        ...item,
        recommended: item.key === (workflow.targetContext && workflow.targetContext.recommendedMiniMode),
      })),
    }, () => {
      this.syncExperienceState();
      this.scheduleRecentPolling(this.data.recent, this.data.selectedSource, workflow);
    });
  },

  createAlternativeWorkflow() {
    this.setData({
      selectedWorkflow: null,
      workflowId: '',
      createNewWorkflow: true,
      workflowPickerOpen: false,
    }, () => this.syncExperienceState());
    wx.showToast({ title: '将创建新的备选方案', icon: 'none' });
  },

  openHistory() {
    wx.navigateTo({ url: '/packages/ai-workflow/history/ai-design-history' });
  },

  openResult(event) {
    wx.navigateTo({ url: `/packages/ai-workflow/result/ai-design-result?id=${event.currentTarget.dataset.id}` });
  },
});
