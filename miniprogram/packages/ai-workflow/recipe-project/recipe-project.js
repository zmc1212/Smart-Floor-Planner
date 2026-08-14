const aiService = require('../../../utils/aiDesignService.js');
const { openSurveyingEditor } = require('../../../utils/surveyNavigation.js');
const { decorateSourcePlan, buildProjectPickerView, chooseDefaultProjectGroup } = require('../../../pages/ai-design/ai-design-model.js');

function buildScope(plan, room) {
  if (!room) return {
    key: 'whole_floor_plan',
    targetScope: 'whole_floor_plan',
    roomId: '',
    name: '完整户型',
    meta: `${Number(plan.closedRoomCount || (plan.rooms || []).length)} 个闭合空间`,
  };
  return {
    key: room.roomId,
    targetScope: 'single_room',
    roomId: room.roomId,
    name: room.roomName || '房间',
    meta: room.roomSize || `${Number(room.openingCount || 0)} 个门窗开口`,
  };
}

Page({
  data: {
    loading: true, error: '', recipeId: '', inputMode: 'floor_plan', recipe: null,
    step: 'projects', projects: [], filteredProjects: [], projectGroups: [], projectGroup: 'in_progress',
    projectSearch: '', projectEmptyCopy: '', selectedProject: null, scopes: [], selectedScope: null,
    navigationTop: 24, navigationHeight: 32, navigationRight: 96,
  },

  onLoad(options) {
    this.syncNavigationMetrics();
    this.setData({ recipeId: options.recipeId || '', inputMode: options.inputMode === 'photo' ? 'photo' : 'floor_plan' });
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
      const [recipe, sourceData] = await Promise.all([aiService.getRecipe(this.data.recipeId), aiService.loadSources()]);
      const projects = (sourceData || []).map(decorateSourcePlan);
      const projectGroup = chooseDefaultProjectGroup(projects, '');
      const picker = buildProjectPickerView(projects, projectGroup, '');
      this.setData({ recipe, projects, projectGroup, ...picker, loading: false });
    } catch (error) {
      this.setData({ loading: false, error: error.error || error.message || '客户项目加载失败' });
    }
  },

  goBack() {
    if (this.data.step === 'scope') { this.setData({ step: 'projects', selectedProject: null }); return; }
    wx.navigateBack();
  },

  retry() { this.loadData(); },

  openCustomerLeads() {
    wx.switchTab({ url: '/pages/leads-management/leads-management' });
  },

  selectProjectGroup(event) {
    const projectGroup = event.currentTarget.dataset.key;
    this.setData({ projectGroup, ...buildProjectPickerView(this.data.projects, projectGroup, this.data.projectSearch) });
  },

  onProjectSearch(event) {
    const projectSearch = event.detail.value || '';
    this.setData({ projectSearch, ...buildProjectPickerView(this.data.projects, this.data.projectGroup, projectSearch) });
  },

  selectProject(event) {
    const project = this.data.projects.find((item) => item.floorPlanId === event.currentTarget.dataset.id);
    if (!project) return;
    if (project.projectGroup === 'needs_survey' || (project.eligibility && project.eligibility.eligible === false)) {
      openSurveyingEditor({ leadId: project.leadId, floorPlanId: project.floorPlanId });
      return;
    }
    const scopes = [buildScope(project), ...(project.rooms || []).map((room) => buildScope(project, room))];
    this.setData({ selectedProject: project, scopes, selectedScope: scopes[0], step: 'scope' });
  },

  selectScope(event) {
    const scope = this.data.scopes.find((item) => item.key === event.currentTarget.dataset.key);
    if (scope) this.setData({ selectedScope: scope });
  },

  continueToConfirm() {
    const project = this.data.selectedProject;
    const scope = this.data.selectedScope;
    if (!project || !scope) return;
    const query = [
      `recipeId=${encodeURIComponent(this.data.recipeId)}`,
      `inputMode=${encodeURIComponent(this.data.inputMode)}`,
      `leadId=${encodeURIComponent(project.leadId || '')}`,
      `floorPlanId=${encodeURIComponent(project.floorPlanId)}`,
      `targetScope=${encodeURIComponent(scope.targetScope)}`,
      scope.roomId ? `roomId=${encodeURIComponent(scope.roomId)}` : '',
    ].filter(Boolean).join('&');
    wx.navigateTo({ url: `/packages/ai-workflow/recipe-confirm/recipe-confirm?${query}` });
  },
});
