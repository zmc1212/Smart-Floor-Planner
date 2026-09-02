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
const {
  DEFAULT_PAGE_SIZE,
  parsePagination,
  mergePage,
  listFooterText,
} = require('../../../utils/list-pagination.js');

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
    leadPage: 1,
    leadHasMore: false,
    loadingMore: false,
    footerText: '',
    focusedLead: null,
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
    this.reloadLeads({ reset: true });
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
      const loadedRecipe = await aiService.getRecipe(this.data.recipeId);
      const recipe = {
        ...loadedRecipe,
        previewUrl: loadedRecipe.previewUrl || '/images/ai-design/unified-entry-v1/recipe-modern-minimal.jpg',
      };
      this.setData({ recipe });
      await this.fetchLeads({ reset: true, chooseDefault: true });
      this.setData({ loading: false });
    } catch (error) {
      this.setData({ loading: false, error: error.error || error.message || '客户列表加载失败' });
    }
  },

  onLoadMoreLeads() {
    if (this.data.step !== 'leads') return;
    this.fetchLeads({ reset: false });
  },

  async reloadLeads() {
    return this.fetchLeads({ reset: true });
  },

  async fetchLeads(options) {
    const reset = !options || options.reset !== false;
    const chooseDefault = Boolean(options && options.chooseDefault);
    if (this._fetchingLeads) return;
    if (!reset && (this.data.loadingMore || !this.data.leadHasMore)) return;
    this._fetchingLeads = true;
    const page = reset ? 1 : Number(this.data.leadPage || 1);
    if (!reset) this.setData({ loadingMore: true, footerText: listFooterText(true, true, this.data.leads.length) });
    try {
      const result = await aiService.loadStudioLeads({
        page,
        limit: DEFAULT_PAGE_SIZE,
        search: String(this.data.leadSearch || '').trim(),
      });
      const incoming = (result.items || []).map((item) => decorateLead(item, { inputMode: this.data.inputMode }));
      const leads = mergePage(this.data.leads, incoming, reset);
      const pagination = parsePagination(result);
      const surveyingLeadId = this._surveyingLeadId || '';
      const leadGroup = reset
        ? (chooseDefault
          ? chooseDefaultLeadGroup(leads)
          : resolveLeadGroupAfterRefresh(leads, this.data.leadGroup, surveyingLeadId))
        : this.data.leadGroup;
      if (reset) this._surveyingLeadId = '';
      this.setData({
        leads,
        leadGroup,
        error: '',
        loadingMore: false,
        leadPage: page + 1,
        leadHasMore: pagination.hasMore,
        footerText: listFooterText(false, pagination.hasMore, leads.length),
        ...buildLeadPickerView(leads, leadGroup, ''),
      });
    } catch (error) {
      if (reset && this.data.loading) throw error;
      wx.showToast({ title: error.error || error.message || '客户列表刷新失败', icon: 'none' });
      this.setData({
        loadingMore: false,
        footerText: listFooterText(false, this.data.leadHasMore, reset ? 0 : this.data.leads.length),
      });
    } finally {
      this._fetchingLeads = false;
    }
  },

  goBack() {
    if (this.data.step === 'scope') {
      this.setData({ step: 'schemes', selectedScheme: null, scopes: [], selectedScope: null, floorPlanId: '' });
      return;
    }
    if (this.data.step === 'schemes') {
      this.setData({ step: 'leads', focusedLead: null, selectedLead: null, schemes: [], selectedScheme: null });
      return;
    }
    wx.navigateBack();
  },

  changeRecipe() {
    wx.navigateBack();
  },

  retry() { this.loadData(); },

  openCustomerLeads() {
    wx.switchTab({ url: '/pages/leads-management/leads-management' });
  },

  selectLeadGroup(event) {
    const leadGroup = event.currentTarget.dataset.key;
    this.setData({ leadGroup, focusedLead: null, ...buildLeadPickerView(this.data.leads, leadGroup, '') });
  },

  onLeadSearch(event) {
    const leadSearch = event.detail.value || '';
    this.setData({ leadSearch });
    if (this._searchTimer) clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => {
      this.setData({ leads: [], leadPage: 1 }, () => this.fetchLeads({ reset: true }));
    }, 300);
  },

  async selectLead(event) {
    const lead = this.data.leads.find((item) => item.id === event.currentTarget.dataset.id);
    if (!lead) return;
    this.setData({ focusedLead: lead });
  },

  async continueWithFocusedLead() {
    const lead = this.data.focusedLead;
    if (!lead || this.data.creating) return;
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
      const schemes = (list || []).map(decorateScheme);
      this.setData({ schemes, selectedScheme: schemes[0] || null, schemesLoading: false });
    } catch (error) {
      wx.showToast({ title: error.error || error.message || '方案列表加载失败', icon: 'none' });
      this.setData({
        schemesLoading: false,
        step: 'leads',
        selectedLead: null,
      });
    }
  },

  selectScheme(event) {
    const scheme = this.data.schemes.find((item) => item.id === event.currentTarget.dataset.id);
    if (!scheme) return;
    this.setData({ selectedScheme: scheme });
  },

  async continueWithSelectedScheme() {
    const scheme = this.data.selectedScheme;
    if (!scheme || this.data.creating) return;
    this.enterScheme(scheme.id);
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
      this.enterScheme(workflowId);
    } catch (error) {
      wx.showToast({ title: error.error || error.message || '新建方案失败', icon: 'none' });
      this.setData({ creating: false });
    }
  },

  enterScheme(workflowId) {
    const lead = this.data.selectedLead;
    if (!lead || !workflowId) return;
    const floorPlanId = lead.eligibleFloorPlanId || this.data.floorPlanId || '';
    const query = [
      `leadId=${encodeURIComponent(lead.id)}`,
      `workflowId=${encodeURIComponent(workflowId)}`,
      floorPlanId ? `floorPlanId=${encodeURIComponent(floorPlanId)}` : '',
      `recipeId=${encodeURIComponent(this.data.recipeId)}`,
      `inputMode=${encodeURIComponent(this.data.inputMode)}`,
      'startNewRound=1',
    ].filter(Boolean).join('&');
    this.setData({ creating: false, schemesLoading: false });
    wx.navigateTo({ url: `/packages/ai-workflow/scheme-studio/scheme-studio?${query}` });
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
