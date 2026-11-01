const STORE = 'assistant-report-history-v1';
const monthNow = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 7);
const initialHistory = () => ({ followupHistoryOpen: false, followupHistoryFilters: null, followupHistoryItems: [],
  followupHistoryCursor: null, followupHistoryLoading: false, followupHistoryError: '', followupHistoryProjects: [],
  followupHistoryProjectIndex: 0, followupHistoryProjectLabel: '', followupHistoryMonthLabel: '', followupHistoryScroll: 0,
  followupHistoryProjectsCursor: null, followupHistoryProjectsLoading: false });
const historyMethods = {
  rememberHistory() {
    if (!this.state.followupHistoryFilters || !this.session || !this.selected) return;
    const value = { session: this.session, bindingId: this.selected, filters: this.state.followupHistoryFilters,
      scroll: this.state.followupHistoryScroll };
    try { wx.setStorageSync(STORE, value); } catch (_) { /* Optional selection memory; reports and receipts remain server-owned. */ }
  },
  historyOptions(context, append = false) {
    const choices = [...(append ? this.state.followupHistoryProjects.filter(p => p.id && p.id !== '__more') : []), ...(context.projects || []), ...(context.selectedProject ? [context.selectedProject] : [])];
    const projects = [{ id: '', name: '全部获权工地' }, ...new Map(choices.map(p => [p.id, p])).values(), ...(context.projectsNextCursor ? [{ id: '__more', name: '查看更多工地…' }] : [])];
    let filters = this.state.followupHistoryFilters;
    if (!filters) {
      let saved;
      try { saved = wx.getStorageSync(STORE); } catch (_) { /* Non-WeChat tests. */ }
      filters = saved?.session === this.session && saved.bindingId === this.selected ? saved.filters : null;
      filters = { projectId: context.audience === 'customer' ? context.projects[0]?.id || '' : '', month: monthNow(), kind: '', ...filters };
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(filters.month)) filters.month = monthNow();
      if (!['', 'daily', 'weekly'].includes(filters.kind)) filters.kind = '';
    }
    const index = projects.findIndex(p => p.id === filters.projectId);
    // Never retain the old selected name after relationship/enterprise changes.
    const selected = Math.max(0, index);
    this.set({ followupHistoryFilters: filters, followupHistoryProjects: projects, followupHistoryProjectIndex: selected,
      followupHistoryProjectsCursor: context.projectsNextCursor || null, followupHistoryProjectLabel: index < 0 ? '当前范围不可用' : projects[selected].name, followupHistoryMonthLabel: filters.month.replace('-', '年') + '月' });
  },
  async moreHistoryProjects() {
    if (!this.current() || this.state.followupHistoryProjectsLoading || !this.state.followupHistoryProjectsCursor) return;
    const epoch = this.epoch, bid = this.selected, request = this.historyRequest; this.set({ followupHistoryProjectsLoading: true });
    try {
      const result = await this.client.read('/followups/' + bid, { afterProjectId: this.state.followupHistoryProjectsCursor,
        ...(this.state.followupHistoryFilters.projectId ? { projectId: this.state.followupHistoryFilters.projectId } : {}) }, await this.headers());
      if (this.current(epoch) && bid === this.selected && request === this.historyRequest && this.state.followupHistoryOpen) this.historyOptions(result, true);
    } catch (e) { if (this.current(epoch) && request === this.historyRequest) {
      if (e.statusCode === 404) this.set({ ...initialHistory(), followupContext: null, followupBindings: [], followupReports: [], followupDetail: null, followupOriginal: null });
      if ([401,403,404].includes(e.statusCode)) this.failure(e); this.set({ followupHistoryError: this.historyErrorCopy(e) }); } }
    finally { if (this.current(epoch)) this.set({ followupHistoryProjectsLoading: false }); }
  },
  async openHistory() {
    if (!this.current() || !this.state.followupContext || this.state.followupBusy || this.state.followupPending) return;
    this.historyOptions(this.state.followupContext);
    this.set({ followupHistoryOpen: true, followupManageOpen: false });
    return this.loadHistory();
  },
  closeHistory() { this.rememberHistory(); this.historyRequest = (this.historyRequest || 0) + 1; this.set({ followupHistoryOpen: false, followupHistoryLoading: false }); },
  filterHistory(field, value) {
    if (!this.current() || !this.state.followupHistoryFilters || this.state.followupBusy || this.state.followupPending) return;
    if (field === 'projectId' && !this.state.followupHistoryProjects.some(p => p.id === value)) return;
    if (field === 'month' && !/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(value)) return;
    if (field === 'kind' && !['', 'daily', 'weekly'].includes(value)) return;
    if (!['projectId','month','kind'].includes(field)) return;
    this.historyPages = 1;
    this.set({ followupHistoryFilters: { ...this.state.followupHistoryFilters, [field]: value }, followupHistoryItems: [],
      followupHistoryCursor: null, followupHistoryError: '', followupHistoryScroll: 0 });
    this.historyOptions(this.state.followupContext); this.rememberHistory();
    return this.loadHistory();
  },
  async loadHistory({ more = false, background = false } = {}) {
    if (!this.current() || !this.state.followupHistoryOpen || !this.state.followupHistoryFilters
      || more && (!this.state.followupHistoryCursor || this.state.followupHistoryLoading)
      || background && this.state.followupHistoryLoading) return;
    const epoch = this.epoch, bid = this.selected, request = this.historyRequest = (this.historyRequest || 0) + 1;
    const filters = { ...this.state.followupHistoryFilters }, valid = () => this.current(epoch) && bid === this.selected && request === this.historyRequest;
    this.set({ followupHistoryLoading: true });
    try {
      const headers = await this.headers(); let context = await this.client.read('/followups/' + bid, {}, headers);
      if (!valid()) return;
      this.set({ followupContext: context, followupBindings: this.state.followupBindings.map(b => b.bindingId === bid
        ? { ...b, title: context.title, projects: context.projects, stages: context.stages } : b) }); this.historyOptions(context);
      if (filters.projectId && !context.projects.some(p => p.id === filters.projectId)) {
        context = await this.client.read('/followups/' + bid, { projectId: filters.projectId }, headers);
        if (!valid()) return;
        this.set({ followupContext: context }); this.historyOptions(context);
      }
      // Reject a removed selected project without falling through to another scope.
      if (filters.projectId && context.selectedProject?.id !== filters.projectId && !context.projects.some(p => p.id === filters.projectId)) {
        this.set({ followupReports: [], followupHistoryItems: [], followupHistoryCursor: null, followupDetail: null, followupOriginal: null });
        throw { statusCode: 404, code: 'construction_not_found' };
      }
      const query = Object.fromEntries(Object.entries(filters).filter(([, value]) => value));
      const pages = more ? 1 : background ? this.historyPages || 1 : 1;
      let items = more ? this.state.followupHistoryItems : [], cursor = more ? this.state.followupHistoryCursor : null;
      for (let page = 0; page < pages; page++) {
        const result = await this.client.read(`/followups/${bid}/reports`, { ...query, ...(cursor ? { beforeId: cursor } : {}) }, headers);
        if (!valid()) return;
        items = items.concat(result.items.map(r => this.historyReport(r, context)));
        cursor = result.nextCursor; if (!cursor) break;
      }
      this.historyPages = more ? (this.historyPages || 1) + 1 : pages;
      this.set({ followupHistoryItems: [...new Map(items.map(r => [r.reportId, r])).values()], followupHistoryCursor: cursor, followupHistoryError: '' });
      this.rememberHistory();
    } catch (e) {
      if (!valid()) return;
      if ([401,403,404].includes(e.statusCode) || ['context_changed','identity_context_invalid'].includes(e.code || e.error)) {
        this.set({ followupReports: [], followupHistoryItems: [], followupHistoryCursor: null, followupDetail: null, followupOriginal: null });
        if (e.statusCode === 404) {
          const remove = projects => (projects || []).filter(p => p.id !== filters.projectId);
          this.set({ followupHistoryProjectLabel: '当前范围不可用', followupHistoryProjects: remove(this.state.followupHistoryProjects),
            followupContext: this.state.followupContext ? { ...this.state.followupContext, projects: remove(this.state.followupContext.projects), selectedProject: null } : null,
            followupBindings: this.state.followupBindings.map(b => b.bindingId === bid ? { ...b, projects: remove(b.projects) } : b) });
        }
        if (e.statusCode !== 404 || (e.code || e.error) === 'assistant_resource_not_found') this.failure(e);
      }
      this.set({ followupHistoryError: this.historyErrorCopy(e) });
    } finally { if (valid()) this.set({ followupHistoryLoading: false }); }
  },
  historyViewed(reportId, revision) {
    this.set({ followupHistoryItems: this.state.followupHistoryItems.map(r => r.reportId === reportId && r.revision === revision ? { ...r, readAt: true } : r) });
  },
};
const historyPageMethods = {
  followupHistory() { return this.followups.openHistory(); },
  closeFollowupHistory() { return this.followups.closeHistory(); },
  filterFollowupProject(e) { const project = this.data.followupHistoryProjects[Number(e.detail.value)]; if (project?.id === '__more') return this.followups.moreHistoryProjects(); if (project) return this.followups.filterHistory('projectId', project.id); },
  filterFollowupMonth(e) { return this.followups.filterHistory('month', e.detail.value); },
  filterFollowupKind(e) { return this.followups.filterHistory('kind', e.currentTarget.dataset.kind); },
  refreshFollowupHistory() { return this.followups.loadHistory(); },
  moreFollowupHistory() { return this.followups.loadHistory({ more: true }); },
  scrollFollowupHistory(e) { this.followups.state.followupHistoryScroll = e.detail.scrollTop; },
  settingsFromFollowupHistory() { this.followups.closeHistory(); return this.openFollowupSettings(); },
};
module.exports = { initialHistory, historyMethods, historyPageMethods };
