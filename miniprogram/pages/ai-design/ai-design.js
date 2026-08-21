const aiService = require('../../utils/aiDesignService.js');
const { prioritizeProcessingTasks } = require('../../utils/aiDesignTaskOrdering.js');
const {
  consumeAIDesignContext,
  normalizeAIDesignContext,
  openSchemeStudio,
} = require('../../utils/aiDesignNavigation.js');
const { canAccessAIDesign, showAIDesignAccessDenied } = require('../../utils/aiDesignAccess.js');
const { openSurveyingEditor } = require('../../utils/surveyNavigation.js');
const { roleForIdentity } = require('../../utils/identity-navigation.js');
const {
  decorateSourcePlan,
  decorateRecentResult,
  buildHeroSlides,
  hasActiveTasks,
  normalizeCredits,
  buildExperienceState,
  PROJECT_FOLIO_COVER,
  buildProjectPickerView,
  chooseDefaultProjectGroup,
  chooseDefaultProject,
  buildRecentProjects,
  shouldOpenSchemeStudioFromContext,
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

const RECIPE_SPACE_FILTERS = [
  { key: 'all', label: '精选', icon: '/images/ai-design-icons/palette.png' },
  { key: 'living_room', label: '客厅', icon: '/images/ai-design-icons/armchair.png' },
  { key: 'bedroom', label: '卧室', icon: '/images/ai-design-icons/reference.png' },
  { key: 'dining_kitchen', label: '餐厨', icon: '/images/ai-design-icons/floor-plan.png' },
  { key: 'study', label: '书房', icon: '/images/mine-icons/clipboard-pen.png' },
];

function decorateRecipeCard(recipe, index) {
  const heightClasses = ['recipe-tall', 'recipe-short', 'recipe-mid', 'recipe-tallest'];
  return {
    ...recipe,
    heightClass: heightClasses[index % heightClasses.length],
    featured: index === 0,
    previewFailed: false,
  };
}

function splitRecipeColumns(recipes) {
  const columns = [
    { key: 'left', items: [] },
    { key: 'right', items: [] },
  ];
  (recipes || []).forEach((recipe, index) => columns[index % 2].items.push(recipe));
  return columns;
}

function resolveRecipeInputMode(recipe) {
  const inputTypes = Array.isArray(recipe && recipe.inputTypes) ? recipe.inputTypes : [];
  return inputTypes.includes('photo') && !inputTypes.includes('floor_plan') ? 'photo' : 'floor_plan';
}

function decorateVisibleRecipe(recipe, workflows) {
  const inputMode = resolveRecipeInputMode(recipe);
  const workflowKey = inputMode === 'photo' ? 'style_transform' : 'floor_plan_render';
  const workflow = (workflows || []).find((item) => item.key === workflowKey);
  return {
    ...recipe,
    inputMode,
    recipeCredits: normalizeCredits(workflow && workflow.credits),
  };
}

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

function isArchivedSource(source) {
  return Boolean(source && (
    source.leadArchived
    || source.isArchived
    || source.archivedAt
  ));
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
    recentProjects: [],
    heroResults: [],
    heroSlides: [],
    activeHeroSlide: 0,
    sources: [],
    projectGroup: 'in_progress',
    projectSearch: '',
    projectGroups: [],
    filteredProjects: [],
    projectEmptyCopy: '',
    selectedSource: null,
    sourcePickerOpen: false,
    sourcePickerStep: 'plans',
    createSchemePicker: false,
    activeSourcePlan: null,
    enterpriseName: '',
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
    projectFolioCover: PROJECT_FOLIO_COVER,
    primaryAction: null,
    secondaryActions: [],
    navigationTop: 24,
    navigationHeight: 32,
    navigationRight: 96,
    recipeSpaceFilters: RECIPE_SPACE_FILTERS.map((item, index) => ({ ...item, active: index === 0 })),
    recipeSpaceFilter: 'all',
    recipeQuery: '',
    recipeRecentSearches: ['奶油风', '现代简约', '原木客厅'],
    recipeSearchOpen: false,
    recipeLoading: true,
    recipeLoadingMore: false,
    recipeError: '',
    recipes: [],
    visibleRecipes: [],
    featuredRecipes: [],
    recipeColumns: splitRecipeColumns([]),
    recipeSkeletons: [1, 2, 3, 4],
    recipeCategories: [],
    recipePage: 1,
    recipeTotalPages: 1,
    recipeTotal: 0,
    heroRecipe: null,
    roleWorkbenchRole: '',
  },

  getRoleWorkbenchRole() {
    const globalData = getApp().globalData;
    const bootstrap = globalData.bootstrap;
    const role = (bootstrap && bootstrap.current && bootstrap.current.role)
      || roleForIdentity(globalData.userInfo);
    return role === 'measurer' ? 'measurer' : '';
  },

  onLoad(options) {
    this.syncImmersiveNavigationMetrics();
    try {
      const recentSearches = wx.getStorageSync('aiRecipeRecentSearches');
      if (Array.isArray(recentSearches) && recentSearches.length) {
        this.setData({ recipeRecentSearches: recentSearches.slice(0, 6) });
      }
    } catch (error) {
      // Search history is a convenience only; discovery remains usable without storage.
    }
    const context = this.applyNavigationContext(options);
    if (shouldOpenSchemeStudioFromContext(context)) {
      openSchemeStudio(context);
    }
  },

  resolveEnterpriseName() {
    try {
      const app = typeof getApp === 'function' ? getApp() : null;
      const globalData = (app && app.globalData) || {};
      const bootstrap = globalData.bootstrap || {};
      const userInfo = globalData.userInfo || {};
      return (bootstrap.enterprise && bootstrap.enterprise.name)
        || userInfo.enterpriseName
        || '';
    } catch (error) {
      return '';
    }
  },

  onShow() {
    const roleWorkbenchRole = this.getRoleWorkbenchRole();
    if (roleWorkbenchRole) {
      this.setData({ roleWorkbenchRole });
      this.syncTabBar();
      return;
    }
    this.setData({
      roleWorkbenchRole: '',
      enterpriseName: this.resolveEnterpriseName(),
    });
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
      if (shouldOpenSchemeStudioFromContext(pendingContext)) {
        this.applyNavigationContext(pendingContext);
        openSchemeStudio(pendingContext);
        return;
      }
      this.applyNavigationContext(pendingContext, () => this.loadData());
      return;
    }
    this.loadData();
  },

  syncTabBar() {
    const tabBar = typeof this.getTabBar === 'function' && this.getTabBar();
    if (tabBar) {
      tabBar.syncSelected();
      if (typeof tabBar.setData === 'function') {
        tabBar.setData({
          suppressed: !!(this.data.sourcePickerOpen || this.data.workflowPickerOpen),
        });
      }
    }
  },

  setTabBarHidden(hidden) {
    const tabBar = typeof this.getTabBar === 'function' && this.getTabBar();
    if (tabBar && typeof tabBar.setData === 'function') {
      tabBar.setData({ suppressed: !!hidden });
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
    this.setTabBarHidden(false);
  },

  onUnload() {
    this.recentPageVisible = false;
    this.stopRecentPolling();
    this.setTabBarHidden(false);
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
    return context;
  },

  async loadData() {
    this.setData({ loading: true, loadError: '' });
    try {
      const [capabilities, historyResult, sourceData, recipeResult] = await Promise.all([
        aiService.loadCapabilities(),
        aiService.loadHistory(1, 4)
          .then((history) => ({ history, error: '' }))
          .catch((error) => ({
            history: null,
            error: error.error || error.message || '最近成果加载失败',
          })),
        aiService.loadSources(),
        Promise.resolve().then(() => aiService.loadRecipes({ page: 1, limit: 24 }))
          .then((data) => ({ data, error: '' }))
          .catch((error) => ({
            data: null,
            error: error.error || error.message || '装修配方加载失败',
          })),
      ]);
      const priceMap = (capabilities.modes || []).reduce((result, item) => {
        result[item.key] = item;
        return result;
      }, {});
      const provider = capabilities.provider || { available: false };
      const recipeItems = recipeResult.data
        ? (recipeResult.data.items || []).map(decorateRecipeCard)
        : this.data.recipes;
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
      // Archived leads remain recoverable in the admin system, but they are
      // not selectable AI-design projects. Keep the empty-state workbench
      // authoritative even if an older API response still includes one.
      const sourcePlans = sourceData
        .map(decorateSourcePlan)
        .filter((item) => !isArchivedSource(item));
      const requestedPlan = sourcePlans.find((item) => item.floorPlanId === this.data.floorPlanId)
        || sourcePlans.find((item) => (
          item.activeWorkflow && item.activeWorkflow.id === this.data.workflowId
        ))
        || null;
      const selectedPlan = chooseDefaultProject(
        sourcePlans,
        this.data.floorPlanId,
        this.data.workflowId
      );
      const preservesRequestedScope = !!selectedPlan
        && !!requestedPlan
        && selectedPlan.floorPlanId === requestedPlan.floorPlanId;
      const requestedScope = preservesRequestedScope
        ? (this.data.targetScope || (this.data.roomId ? 'single_room' : 'whole_floor_plan'))
        : 'whole_floor_plan';
      const selectedRoom = selectedPlan && requestedScope === 'single_room'
        ? (selectedPlan.rooms || []).find((room) => room.roomId === this.data.roomId)
        : null;
      const selectedSource = selectedPlan
        ? (buildSelectedSource(selectedPlan, requestedScope, selectedRoom)
          || buildSelectedSource(selectedPlan, 'whole_floor_plan'))
        : null;
      const sources = sourcePlans.map((item) => ({
        ...item,
        sourceKey: item.floorPlanId,
        selected: !!selectedSource && item.floorPlanId === selectedSource.floorPlanId,
      }));
      const projectGroup = chooseDefaultProjectGroup(
        sources,
        (selectedSource && selectedSource.floorPlanId) || (requestedPlan && requestedPlan.floorPlanId)
      );
      const projectPickerState = buildProjectPickerView(sources, projectGroup, '');
      const preferredWorkflowId = this.data.workflowId
        || (selectedSource && selectedSource.activeWorkflow && selectedSource.activeWorkflow.id)
        || '';
      const workflowQuery = {
        workflowId: preferredWorkflowId,
        leadId: selectedSource ? selectedSource.leadId : this.data.leadId,
      };
      if (selectedSource) {
        workflowQuery.floorPlanId = selectedSource.floorPlanId;
        workflowQuery.targetScope = selectedSource.targetScope;
        workflowQuery.roomId = selectedSource.roomId;
      }
      const [schemeOptions, heroResults] = await Promise.all([
        selectedSource ? aiService.loadWorkflows(workflowQuery) : Promise.resolve([]),
        selectedSource
          ? aiService.loadHeroFloorPlanResults(selectedSource.floorPlanId).catch(() => [])
          : Promise.resolve([]),
      ]);
      const selectedWorkflow = schemeOptions.find((item) => item.id === preferredWorkflowId)
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
        modeTitle: MODE_TITLES[item.mode] || '设计成果',
      }));
      const heroSlides = buildHeroSlides(decoratedHeroResults, selectedSource);
      const sourcePickerOpen = false;
      this.setData({
        account: capabilities.account || { availableBalance: 0, frozenBalance: 0 },
        workflows: decoratedWorkflows,
        provider,
        recent,
        recentProjects: buildRecentProjects(sources),
        heroResults: decoratedHeroResults,
        heroSlides,
        activeHeroSlide: 0,
        sources,
        projectGroup,
        projectSearch: '',
        ...projectPickerState,
        selectedSource,
        sourcePickerOpen,
        createSchemePicker: false,
        enterpriseName: this.resolveEnterpriseName(),
        floorPlanId: selectedSource ? selectedSource.floorPlanId : (sourcePlans.length ? this.data.floorPlanId : ''),
        leadId: selectedSource ? selectedSource.leadId : (sourcePlans.length ? this.data.leadId : ''),
        roomId: selectedSource ? selectedSource.roomId : (sourcePlans.length ? this.data.roomId : ''),
        targetScope: selectedSource ? selectedSource.targetScope : (sourcePlans.length ? this.data.targetScope : ''),
        schemeOptions,
        selectedWorkflow,
        workflowId: selectedWorkflow ? selectedWorkflow.id : '',
        workflowPickerOpen: false,
        workflowLoading: false,
        workflowLoadError: '',
        createNewWorkflow: false,
        hasLoadedOnce: true,
        loadError: '',
        historyLoadError: historyResult.error,
        recipeLoading: false,
        recipeError: recipeResult.error,
        recipes: recipeItems,
        recipeCategories: recipeResult.data ? (recipeResult.data.categories || []) : this.data.recipeCategories,
        recipePage: recipeResult.data ? Number(recipeResult.data.pagination.page || 1) : this.data.recipePage,
        recipeTotalPages: recipeResult.data ? Number(recipeResult.data.pagination.totalPages || 1) : this.data.recipeTotalPages,
        recipeTotal: recipeResult.data ? Number(recipeResult.data.pagination.total || recipeItems.length) : this.data.recipeTotal,
        ...experienceState,
      });
      this.applyRecipeFilters();
      this.setTabBarHidden(sourcePickerOpen);
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

  applyRecipeFilters() {
    const spaceFilter = this.data.recipeSpaceFilter;
    const visibleRecipes = (this.data.recipes || []).filter((recipe) => {
      if (spaceFilter === 'all') return true;
      if (spaceFilter === 'dining_kitchen') return ['dining_room', 'kitchen'].includes(recipe.spaceKey);
      return recipe.spaceKey === spaceFilter;
    });
    const resolvedRecipes = visibleRecipes.map((recipe) => decorateVisibleRecipe(recipe, this.data.workflows));
    this.setData({
      visibleRecipes: resolvedRecipes,
      featuredRecipes: resolvedRecipes.slice(0, 4),
      recipeColumns: splitRecipeColumns(resolvedRecipes),
      heroRecipe: resolvedRecipes[0] || null,
    });
  },

  selectRecipeSpace(event) {
    const key = event.currentTarget.dataset.key || 'all';
    this.setData({
      recipeSpaceFilter: key,
      recipeSpaceFilters: this.data.recipeSpaceFilters.map((item) => ({ ...item, active: item.key === key })),
    }, () => this.applyRecipeFilters());
  },

  openRecipeSearch() {
    this.setData({ recipeSearchOpen: true });
  },

  closeRecipeSearch() {
    this.setData({ recipeSearchOpen: false });
  },

  onRecipeSearchInput(event) {
    this.setData({ recipeQuery: event.detail.value || '' });
  },

  onRecipeSuggestionTap(event) {
    this.setData({ recipeQuery: event.currentTarget.dataset.name || '' }, () => this.submitRecipeSearch());
  },

  async submitRecipeSearch() {
    if (this.data.recipeLoading) return;
    this.setData({ recipeLoading: true, recipeError: '' });
    try {
      const data = await aiService.loadRecipes({ page: 1, limit: 24, q: this.data.recipeQuery.trim() });
      const recipes = (data.items || []).map(decorateRecipeCard);
      this.setData({
        recipes,
        recipeCategories: data.categories || [],
        recipePage: Number(data.pagination.page || 1),
        recipeTotalPages: Number(data.pagination.totalPages || 1),
        recipeTotal: Number(data.pagination.total || recipes.length),
        recipeLoading: false,
        recipeSearchOpen: false,
        recipeSpaceFilter: 'all',
        recipeSpaceFilters: this.data.recipeSpaceFilters.map((item) => ({ ...item, active: item.key === 'all' })),
      });
      const query = this.data.recipeQuery.trim();
      if (query) {
        const recipeRecentSearches = [query, ...this.data.recipeRecentSearches.filter((item) => item !== query)].slice(0, 6);
        this.setData({ recipeRecentSearches });
        try { wx.setStorageSync('aiRecipeRecentSearches', recipeRecentSearches); } catch (error) { /* optional */ }
      }
      this.applyRecipeFilters();
    } catch (error) {
      this.setData({ recipeLoading: false, recipeError: error.error || error.message || '搜索配方失败' });
    }
  },

  async loadMoreRecipes() {
    if (this.data.recipeLoadingMore || this.data.recipePage >= this.data.recipeTotalPages) return;
    this.setData({ recipeLoadingMore: true });
    try {
      const nextPage = this.data.recipePage + 1;
      const data = await aiService.loadRecipes({ page: nextPage, limit: 24, q: this.data.recipeQuery.trim() });
      const recipes = this.data.recipes.concat((data.items || []).map((item, index) => (
        decorateRecipeCard(item, this.data.recipes.length + index)
      )));
      this.setData({
        recipes,
        recipePage: nextPage,
        recipeTotalPages: Number(data.pagination.totalPages || nextPage),
        recipeLoadingMore: false,
      });
      this.applyRecipeFilters();
    } catch (error) {
      this.setData({ recipeLoadingMore: false });
      wx.showToast({ title: error.error || error.message || '加载更多失败', icon: 'none' });
    }
  },

  retryRecipes() {
    this.submitRecipeSearch();
  },

  clearRecipeSearch() {
    this.setData({ recipeQuery: '', recipeSpaceFilter: 'all' }, () => this.submitRecipeSearch());
  },

  onRecipeImageError(event) {
    const id = String(event.currentTarget.dataset.id || '');
    const recipes = this.data.recipes.map((item) => item.id === id ? { ...item, previewFailed: true } : item);
    this.setData({ recipes }, () => this.applyRecipeFilters());
  },

  openRecipeDetail(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    const recipe = (this.data.recipes || []).find((item) => String(item.id) === String(id));
    wx.navigateTo({
      url: `/packages/ai-workflow/recipe-detail/recipe-detail?id=${encodeURIComponent(id)}&inputMode=${resolveRecipeInputMode(recipe)}`,
    });
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
        requestedSource && !isArchivedSource(requestedSource)
          && previewTask && ['created', 'pending', 'processing'].includes(previewTask.status)
          ? aiService.getTask(previewTask.id).catch(() => null)
          : Promise.resolve(null),
        requestedSource && !isArchivedSource(requestedSource)
          ? aiService.loadWorkflows({
            leadId: requestedSource.leadId,
            floorPlanId: requestedSource.floorPlanId,
            targetScope: requestedSource.targetScope,
            roomId: requestedSource.roomId,
          }).catch(() => null)
          : Promise.resolve(null),
        requestedSource && !isArchivedSource(requestedSource)
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
          || schemeOptions.find((item) => (
            selectedSource
            && selectedSource.activeWorkflow
            && item.id === selectedSource.activeWorkflow.id
          ))
          || (schemeOptions.length === 1 ? schemeOptions[0] : null))
        : this.data.selectedWorkflow;
      const recommendedMode = selectedWorkflow
        && selectedWorkflow.targetContext
        && selectedWorkflow.targetContext.recommendedMiniMode;
      const decoratedHeroResults = heroResults.map((item) => decorateRecentResult({
        ...item,
        modeTitle: MODE_TITLES[item.mode] || '设计成果',
      }));
      const heroSlides = buildHeroSlides(decoratedHeroResults, selectedSource);
      const sources = selectedSource
        ? this.data.sources.map((item) => (
          item.floorPlanId === selectedSource.floorPlanId
            ? { ...item, ...selectedSource, selected: true }
            : item
        ))
        : this.data.sources;
      this.setData({
        recent,
        recentProjects: buildRecentProjects(sources),
        heroResults: decoratedHeroResults,
        heroSlides,
        activeHeroSlide: Math.min(this.data.activeHeroSlide, Math.max(0, heroSlides.length - 1)),
        sources,
        selectedSource,
        schemeOptions,
        selectedWorkflow,
        workflowId: refreshedWorkflows
          ? (selectedWorkflow ? selectedWorkflow.id : '')
          : this.data.workflowId,
        workflowPickerOpen: refreshedWorkflows ? false : this.data.workflowPickerOpen,
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
      this.setTabBarHidden(true);
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
        this.setTabBarHidden(true);
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

  openCreateScheme() {
    if (!this.data.sources.length) {
      wx.showToast({ title: '暂无可关联的正式户型', icon: 'none' });
      return;
    }
    const projectGroup = chooseDefaultProjectGroup(
      this.data.sources,
      this.data.selectedSource && this.data.selectedSource.floorPlanId
    );
    this.setData({
      createSchemePicker: true,
      sourcePickerOpen: true,
      sourcePickerStep: 'plans',
      activeSourcePlan: null,
      projectGroup,
      projectSearch: '',
      ...buildProjectPickerView(this.data.sources, projectGroup, ''),
    });
    this.setTabBarHidden(true);
  },

  openRecentProject(event) {
    const plan = this.data.recentProjects[Number(event.currentTarget.dataset.index)];
    if (!plan) return;
    if (!plan.eligibility || !plan.eligibility.eligible) {
      openSurveyingEditor({
        leadId: plan.leadId,
        leadName: plan.leadName,
        communityName: plan.communityName,
        floorPlanId: plan.floorPlanId,
      });
      return;
    }
    openSchemeStudio({
      leadId: plan.leadId,
      floorPlanId: plan.floorPlanId,
      workflowId: plan.activeWorkflow && plan.activeWorkflow.id,
    });
  },

  openSourcePicker() {
    if (!this.data.sources.length) {
      wx.showToast({ title: '暂无可关联的正式户型', icon: 'none' });
      return;
    }
    const projectGroup = chooseDefaultProjectGroup(
      this.data.sources,
      this.data.selectedSource && this.data.selectedSource.floorPlanId
    );
    this.setData({
      createSchemePicker: true,
      sourcePickerOpen: true,
      sourcePickerStep: 'plans',
      activeSourcePlan: null,
      projectGroup,
      projectSearch: '',
      ...buildProjectPickerView(this.data.sources, projectGroup, ''),
    });
    this.setTabBarHidden(true);
  },

  openPreparationProjects() {
    if (!this.data.sources.length) {
      wx.showToast({ title: '暂无可关联的正式户型', icon: 'none' });
      return;
    }
    const projectGroup = this.data.sources.some((item) => item.projectGroup === 'needs_survey')
      ? 'needs_survey'
      : chooseDefaultProjectGroup(
        this.data.sources,
        this.data.selectedSource && this.data.selectedSource.floorPlanId
      );
    this.setData({
      createSchemePicker: true,
      sourcePickerOpen: true,
      sourcePickerStep: 'plans',
      activeSourcePlan: null,
      projectGroup,
      projectSearch: '',
      ...buildProjectPickerView(this.data.sources, projectGroup, ''),
    });
    this.setTabBarHidden(true);
  },

  closeSourcePicker() {
    this.setData({
      sourcePickerOpen: false,
      sourcePickerStep: 'plans',
      activeSourcePlan: null,
      projectSearch: '',
      createSchemePicker: false,
    });
    this.setTabBarHidden(false);
  },

  noop() {},

  selectSourcePlan(event) {
    this.selectProjectCard(event);
  },

  selectProjectGroup(event) {
    const projectGroup = event.currentTarget.dataset.group;
    if (!projectGroup || projectGroup === this.data.projectGroup) return;
    this.setData({
      projectGroup,
      ...buildProjectPickerView(this.data.sources, projectGroup, this.data.projectSearch),
    });
  },

  onProjectSearch(event) {
    const projectSearch = event.detail.value || '';
    this.setData({
      projectSearch,
      ...buildProjectPickerView(this.data.sources, this.data.projectGroup, projectSearch),
    });
  },

  onProjectPreviewError(event) {
    const sourceKey = event.currentTarget.dataset.sourceKey;
    if (!sourceKey) return;
    const sources = this.data.sources.map((item) => (
      item.sourceKey === sourceKey ? { ...item, previewLoadFailed: true } : item
    ));
    this.setData({
      sources,
      recentProjects: buildRecentProjects(sources),
      ...buildProjectPickerView(sources, this.data.projectGroup, this.data.projectSearch),
    });
  },

  selectProjectCard(event) {
    const plan = this.data.filteredProjects[Number(event.currentTarget.dataset.index)];
    if (!plan) return;
    if (!plan.eligibility || !plan.eligibility.eligible) {
      this.closeSourcePicker();
      openSurveyingEditor({
        leadId: plan.leadId,
        leadName: plan.leadName,
        communityName: plan.communityName,
        floorPlanId: plan.floorPlanId,
      });
      return;
    }
    if (this.data.createSchemePicker) {
      this.setData({ createSchemePicker: false, sourcePickerOpen: false });
      this.setTabBarHidden(false);
      openSchemeStudio({
        leadId: plan.leadId,
        floorPlanId: plan.floorPlanId,
        workflowId: plan.activeWorkflow && plan.activeWorkflow.id,
      });
      return;
    }
    this.applySource(plan, 'whole_floor_plan');
  },

  selectHomeProjectCard(event) {
    const plan = this.data.sources[Number(event.currentTarget.dataset.index)];
    if (!plan) return;
    if (!plan.eligibility || !plan.eligibility.eligible) {
      openSurveyingEditor({
        leadId: plan.leadId,
        leadName: plan.leadName,
        communityName: plan.communityName,
        floorPlanId: plan.floorPlanId,
      });
      return;
    }
    openSchemeStudio({
      leadId: plan.leadId,
      floorPlanId: plan.floorPlanId,
      workflowId: plan.activeWorkflow && plan.activeWorkflow.id,
    });
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
    if (isArchivedSource(plan)) {
      wx.showToast({ title: '该客户线索已归档，请先恢复后继续设计', icon: 'none' });
      return;
    }
    if (!plan || (plan.eligibility && plan.eligibility.eligible === false)) {
      wx.showToast({ title: (plan && plan.eligibility && plan.eligibility.reasonLabel) || '请先完成正式量房', icon: 'none' });
      return;
    }
    const source = buildSelectedSource(plan, targetScope, room);
    if (!source) return;
    const sameProject = source.floorPlanId === this.data.floorPlanId;
    const preferredWorkflowId = sameProject
      ? this.data.workflowId
      : ((plan.activeWorkflow && plan.activeWorkflow.id) || '');
    const sources = this.data.sources.map((item) => ({
      ...item,
      selected: item.floorPlanId === source.floorPlanId,
    }));
    const projectPickerState = buildProjectPickerView(
      sources,
      source.projectGroup || this.data.projectGroup,
      ''
    );
    this.setData({
      sources,
      projectGroup: source.projectGroup || this.data.projectGroup,
      projectSearch: '',
      ...projectPickerState,
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
    this.setTabBarHidden(false);
    await this.loadSourceWorkflows(source, preferredWorkflowId);
  },

  async loadSourceWorkflows(source, preferredWorkflowId = this.data.workflowId) {
    if (!source || isArchivedSource(source)) {
      this.workflowLoadRequestId = Number(this.workflowLoadRequestId || 0) + 1;
      this.setData({
        selectedSource: null,
        sourcePickerOpen: false,
        schemeOptions: [],
        selectedWorkflow: null,
        workflowId: '',
        floorPlanId: '',
        leadId: '',
        roomId: '',
        targetScope: '',
        workflowLoading: false,
        workflowLoadError: '',
      }, () => this.syncExperienceState());
      return;
    }
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
        || schemeOptions.find((item) => (
          source.activeWorkflow && item.id === source.activeWorkflow.id
        ))
        || (schemeOptions.length === 1 ? schemeOptions[0] : null);
      const recommendedMode = selectedWorkflow
        && selectedWorkflow.targetContext
        && selectedWorkflow.targetContext.recommendedMiniMode;
      const decoratedHeroResults = heroResults.map((item) => decorateRecentResult({
        ...item,
        modeTitle: MODE_TITLES[item.mode] || '设计成果',
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
        workflowPickerOpen: false,
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
    this.setTabBarHidden(true);
  },

  closeWorkflowPicker() {
    this.setData({ workflowPickerOpen: false });
    this.setTabBarHidden(false);
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
      this.setTabBarHidden(false);
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
    }, () => {
      this.setTabBarHidden(false);
      this.syncExperienceState();
    });
    wx.showToast({ title: '将创建新的备选方案', icon: 'none' });
  },

  openHistory() {
    wx.navigateTo({ url: '/packages/ai-workflow/history/ai-design-history' });
  },

  openResult(event) {
    wx.navigateTo({ url: `/packages/ai-workflow/result/ai-design-result?id=${event.currentTarget.dataset.id}` });
  },
});
