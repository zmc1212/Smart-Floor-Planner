const aiService = require('../../../utils/aiDesignService.js');
const { openSurveyingEditor } = require('../../../utils/surveyNavigation.js');
const {
  decorateLead,
  buildLeadPickerView,
  chooseDefaultLeadGroup,
  decorateScheme,
  nextSchemeTitle,
  roomsFromWorkflowDetail,
  buildScopes,
} = require('./recipe-project-model.js');

Page({
  data: {
    loading: true,
    error: '',
    creating: false,
    schemesLoading: false,
    recipeId: '',
    inputMode: 'floor_plan',
    recipe: null,
    step: 'leads',
    leads: [],
    filteredLeads: [],
    leadGroups: [],
    leadGroup: 'designable',
    leadSearch: '',
    leadEmptyCopy: '',
    selectedLead: null,
    schemes: [],
    selectedScheme: null,
    floorPlanId: '',
    closedRoomCount: 0,
    scopes: [],
    selectedScope: null,
    navigationTop: 24,
    navigationHeight: 32,
    navigationRight: 96,
  },

  onLoad(options) {
    this.syncNavigationMetrics();
    this.setData({
      recipeId: options.recipeId || '',
      inputMode: options.inputMode === 'photo' ? 'photo' : 'floor_plan',
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
    this.setData({
      navigationTop,
      navigationHeight,
      navigationRight: Math.max(92, Number(windowInfo.windowWidth || 390) - menuLeft + 12),
    });
  },

  async loadData() {
    this.setData({ loading: true, error: '' });
    try {
      const [recipe, leadData] = await Promise.all([
        aiService.getRecipe(this.data.recipeId),
        aiService.loadStudioLeads({ limit: 50 }),
      ]);
      const leads = (leadData || []).map(decorateLead);
      const leadGroup = chooseDefaultLeadGroup(leads);
      this.setData({
        recipe,
        leads,
        leadGroup,
        ...buildLeadPickerView(leads, leadGroup, this.data.leadSearch),
        loading: false,
      });
    } catch (error) {
      this.setData({ loading: false, error: error.error || error.message || '客户列表加载失败' });
    }
  },

  goBack() {
    if (this.data.step === 'scope') {
      this.setData({ step: 'schemes', selectedScheme: null, scopes: [], selectedScope: null, floorPlanId: '' });
      return;
    }
    if (this.data.step === 'schemes') {
      this.setData({ step: 'leads', selectedLead: null, schemes: [], selectedScheme: null });
      return;
    }
    wx.navigateBack();
  },

  retry() { this.loadData(); },

  openCustomerLeads() {
    wx.switchTab({ url: '/pages/leads-management/leads-management' });
  },

  selectLeadGroup(event) {
    const leadGroup = event.currentTarget.dataset.key;
    this.setData({ leadGroup, ...buildLeadPickerView(this.data.leads, leadGroup, this.data.leadSearch) });
  },

  onLeadSearch(event) {
    const leadSearch = event.detail.value || '';
    this.setData({ leadSearch, ...buildLeadPickerView(this.data.leads, this.data.leadGroup, leadSearch) });
  },

  async selectLead(event) {
    const lead = this.data.leads.find((item) => item.id === event.currentTarget.dataset.id);
    if (!lead) return;
    if (lead.group === 'needs_survey') {
      openSurveyingEditor({
        leadId: lead.id,
        leadName: lead.name,
        communityName: lead.communityName,
      });
      return;
    }
    this.setData({
      selectedLead: lead,
      step: 'schemes',
      schemesLoading: true,
      schemes: [],
      selectedScheme: null,
    });
    try {
      const list = await aiService.listStudioWorkflows({ leadId: lead.id, limit: 50 });
      this.setData({ schemes: (list || []).map(decorateScheme), schemesLoading: false });
    } catch (error) {
      this.setData({
        schemesLoading: false,
        error: error.error || error.message || '方案列表加载失败',
        step: 'leads',
        selectedLead: null,
      });
    }
  },

  async selectScheme(event) {
    const scheme = this.data.schemes.find((item) => item.id === event.currentTarget.dataset.id);
    if (!scheme) return;
    await this.enterScheme(scheme.id);
  },

  async createScheme() {
    const lead = this.data.selectedLead;
    if (!lead || this.data.creating) return;
    if (!lead.eligibleFloorPlanId) {
      wx.showToast({ title: '该线索还没有合格的正式户型，请先完成量房', icon: 'none' });
      return;
    }
    this.setData({ creating: true });
    try {
      const created = await aiService.createStudioWorkflow({
        leadId: lead.id,
        sourceFloorPlanId: lead.eligibleFloorPlanId,
        title: nextSchemeTitle(lead),
      });
      const workflowId = String(created.id || created._id || '');
      if (!workflowId) throw new Error('创建方案失败');
      this.setData({
        leads: this.data.leads.map((item) => (
          item.id === lead.id ? { ...item, workflowCount: Number(item.workflowCount || 0) + 1 } : item
        )),
        selectedLead: { ...lead, workflowCount: Number(lead.workflowCount || 0) + 1 },
      });
      await this.enterScheme(workflowId);
    } catch (error) {
      wx.showToast({ title: error.error || error.message || '新建方案失败', icon: 'none' });
      this.setData({ creating: false });
    }
  },

  async enterScheme(workflowId) {
    try {
      const detail = await aiService.getStudioWorkflow(workflowId);
      const bound = roomsFromWorkflowDetail(detail);
      if (!bound.floorPlanId) {
        wx.showToast({ title: '该方案尚未关联正式户型', icon: 'none' });
        this.setData({ creating: false });
        return;
      }
      const scheme = decorateScheme(bound.workflow);
      const scopes = buildScopes(bound.rooms, bound.closedRoomCount);
      this.setData({
        selectedScheme: scheme,
        floorPlanId: bound.floorPlanId,
        closedRoomCount: bound.closedRoomCount,
        scopes,
        selectedScope: scopes[0],
        step: 'scope',
        creating: false,
        schemesLoading: false,
      });
    } catch (error) {
      wx.showToast({ title: error.error || error.message || '方案详情加载失败', icon: 'none' });
      this.setData({ creating: false, schemesLoading: false });
    }
  },

  selectScope(event) {
    const scope = this.data.scopes.find((item) => item.key === event.currentTarget.dataset.key);
    if (scope) this.setData({ selectedScope: scope });
  },

  continueToConfirm() {
    const lead = this.data.selectedLead;
    const scheme = this.data.selectedScheme;
    const scope = this.data.selectedScope;
    if (!lead || !scheme || !scope || !this.data.floorPlanId) return;
    const query = [
      `recipeId=${encodeURIComponent(this.data.recipeId)}`,
      `inputMode=${encodeURIComponent(this.data.inputMode)}`,
      `leadId=${encodeURIComponent(lead.id)}`,
      `floorPlanId=${encodeURIComponent(this.data.floorPlanId)}`,
      `schemeId=${encodeURIComponent(scheme.id)}`,
      `targetScope=${encodeURIComponent(scope.targetScope)}`,
      scope.roomId ? `roomId=${encodeURIComponent(scope.roomId)}` : '',
    ].filter(Boolean).join('&');
    wx.navigateTo({ url: `/packages/ai-workflow/recipe-confirm/recipe-confirm?${query}` });
  },
});
