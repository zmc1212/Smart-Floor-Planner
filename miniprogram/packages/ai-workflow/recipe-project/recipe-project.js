const aiService = require('../../../utils/aiDesignService.js');
const { openSurveyingEditor } = require('../../../utils/surveyNavigation.js');
const {
  decorateLead,
  buildLeadPickerView,
  chooseDefaultLeadGroup,
  resolveLeadGroupAfterRefresh,
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

  onShow() {
    if (!this._leadsReady) {
      this._leadsReady = true;
      return;
    }
    if (this.data.step !== 'leads') return;
    this.reloadLeads();
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
      const leads = (leadData || []).map((item) => decorateLead(item, { inputMode: this.data.inputMode }));
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

  async reloadLeads() {
    if (this._reloadingLeads) return;
    this._reloadingLeads = true;
    try {
      const leadData = await aiService.loadStudioLeads({ limit: 50 });
      const leads = (leadData || []).map((item) => decorateLead(item, { inputMode: this.data.inputMode }));
      const surveyingLeadId = this._surveyingLeadId || '';
      const leadGroup = resolveLeadGroupAfterRefresh(leads, this.data.leadGroup, surveyingLeadId);
      this._surveyingLeadId = '';
      this.setData({
        leads,
        leadGroup,
        error: '',
        ...buildLeadPickerView(leads, leadGroup, this.data.leadSearch),
      });
    } catch (error) {
      // Keep the existing list; toast so the return from surveying is not silent.
      wx.showToast({ title: error.error || error.message || '客户列表刷新失败', icon: 'none' });
    } finally {
      this._reloadingLeads = false;
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
    if (this.data.inputMode !== 'photo' && lead.group === 'needs_survey') {
      this._surveyingLeadId = lead.id;
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
      wx.showToast({ title: error.error || error.message || '方案列表加载失败', icon: 'none' });
      this.setData({
        schemesLoading: false,
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
    const photoMode = this.data.inputMode === 'photo';
    if (!photoMode && !lead.eligibleFloorPlanId) {
      wx.showToast({ title: '该线索还没有合格的正式户型，请先完成量房', icon: 'none' });
      return;
    }
    this.setData({ creating: true });
    try {
      const created = await aiService.createStudioWorkflow({
        leadId: lead.id,
        ...(photoMode
          ? { sourceAssetRole: 'rough_sketch' }
          : { sourceFloorPlanId: lead.eligibleFloorPlanId }),
        title: nextSchemeTitle(lead),
      });
      const workflowId = String(created.id || created._id || '');
      if (!workflowId) throw new Error('创建方案失败');
      const createdScheme = decorateScheme(created);
      this.setData({
        schemes: [createdScheme, ...this.data.schemes.filter((item) => item.id !== workflowId)],
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
      const photoMode = this.data.inputMode === 'photo';
      if (!photoMode && !bound.floorPlanId) {
        wx.showToast({ title: '该方案尚未关联正式户型', icon: 'none' });
        this.setData({ creating: false });
        return;
      }
      const scheme = decorateScheme(bound.workflow);
      if (photoMode) {
        this.setData({
          selectedScheme: scheme,
          floorPlanId: bound.floorPlanId || '',
          closedRoomCount: bound.closedRoomCount,
          scopes: [],
          selectedScope: null,
          creating: false,
          schemesLoading: false,
        });
        this.continueToConfirm({ skipScope: true, scheme, floorPlanId: bound.floorPlanId || '' });
        return;
      }
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

  continueToConfirm(options = {}) {
    const lead = this.data.selectedLead;
    const scheme = options.scheme || this.data.selectedScheme;
    const photoMode = this.data.inputMode === 'photo';
    const floorPlanId = options.floorPlanId != null ? options.floorPlanId : this.data.floorPlanId;
    const scope = photoMode ? null : this.data.selectedScope;
    if (!lead || !scheme) return;
    if (!photoMode && (!scope || !floorPlanId)) return;
    const query = [
      `recipeId=${encodeURIComponent(this.data.recipeId)}`,
      `inputMode=${encodeURIComponent(this.data.inputMode)}`,
      `leadId=${encodeURIComponent(lead.id)}`,
      floorPlanId ? `floorPlanId=${encodeURIComponent(floorPlanId)}` : '',
      `schemeId=${encodeURIComponent(scheme.id)}`,
      !photoMode && scope ? `targetScope=${encodeURIComponent(scope.targetScope)}` : '',
      !photoMode && scope && scope.roomId ? `roomId=${encodeURIComponent(scope.roomId)}` : '',
    ].filter(Boolean).join('&');
    wx.navigateTo({ url: `/packages/ai-workflow/recipe-confirm/recipe-confirm?${query}` });
  },
});
