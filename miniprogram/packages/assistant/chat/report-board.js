const { reportForView, dateLabel, FollowupRecordMedia } = require('../../../utils/assistant-followups');
const { errorCopy } = require('../../../utils/assistant-client');
const { initialBook, reportBookMethods } = require('./report-book');

const titles = { customer: '我家进展', designer: '设计跟进', worker: '施工跟进', boss: '企业工地简报' };
const validId = value => /^[1-9]\d{0,18}$/.test(String(value || ''));
const base = '/packages/construction/';
const projectRoutes = {
  issue: (project, id) => base + 'chat/chat?projectId=' + project + '&issueId=' + id + '&mode=review',
  record: (project, id) => base + 'inspection-record/inspection-record?projectId=' + project + '&recordId=' + id,
  node: (project, key) => base + 'projects/projects?project=' + project + '&scheduleNode=' + encodeURIComponent(key),
};
const initialBoard = () => ({ reportBoard: false, reportBoardView: null, reportBoardKind: 'daily', reportBoardRole: '',
  reportBoardTitle: '', reportBoardLoading: false, reportBoardError: '', reportBoardPaths: {},
  reportBoardPhotoError: '', reportBoardScroll: 0, reportBoardDecision: '', reportBoardExpandedSite: '',
  reportBoardRefreshing: false, ...initialBook() });

function photoView(photo) {
  return { ...photo, key: [photo.recordId, photo.version, photo.mediaId].join('_') };
}

function boardView(report, workbench, context, kind, projectId, reading) {
  const detail = reportForView(report, context, projectId);
  const projects = detail.projects || [], primary = projects[0] || {};
  const role = context.audience;
  const subtitle = role === 'customer'
    ? [primary.name || context.selectedProject?.name || context.title, primary.stageName].filter(Boolean).join(' · ')
    : [context.enterprise?.name, '仅自己可见'].filter(Boolean).join(' · ');
  const period = reading?.period || (kind === 'weekly'
    ? [dateLabel(report.periodStart), dateLabel(new Date(Date.parse(report.periodEnd) - 1))].filter(Boolean).join('—')
    : [dateLabel(report.periodStart), report.cutoffAt ? '截至' + (dateLabel(report.periodStart) === dateLabel(report.cutoffAt)
      ? dateLabel(report.cutoffAt, true).split(' ').at(-1) : dateLabel(report.cutoffAt, true)) : ''].filter(Boolean).join(' · '));
  const scopeName = role !== 'boss' && role !== 'customer' ? context.selectedProject?.name || '' : '';
  const snapshots = projects.map(p => ({ key: p.id,
    title: projects.length > 1 ? p.name : '',
    progress: p.progress,
    notes: (p.publishedRecordItems || []).flatMap(r => [r.pending, r.coordination].filter(Boolean)).filter((text, i, items) => items.indexOf(text) === i),
    arrangements: p.arrangements,
  }));
  const originals = projects.flatMap(p => p.originalIds.map(id => {
    const record = (p.records || []).find(r => r.id === id) || (p.publishedRecordItems || []).find(r => r.recordId === id);
    return { key: p.id + ':' + id, id, projectId: p.id, room: record?.room || '',
      at: dateLabel(record?.publishedAt, true) };
  }));
  const { reportId, revision, available, ready, readAt, readToken, deliveryState } = detail;
  const view = { title: reading?.title || titles[role], subtitle, scopeName, period, kind, role,
    projects: reading ? [] : snapshots, originals, reading: reading || null,
    detail: { reportId, revision, available, ready, readAt, readToken, deliveryState, readingKey: reading?.key || '' },
    photos: [], actions: [], truncated: detail.truncated,
    status: !detail.available ? '这份简报已不可查看。' : detail.ready ? '' : detail.stateLabel };
  if (workbench?.role !== role || !detail.ready) return view;
  if (role === 'customer') {
    view.photos = workbench.photos.map(photoView);
    view.decisions = workbench.decisions.filter(p => p.canDecide);
    view.decided = workbench.decisions.filter(p => !p.canDecide);
  } else if (role === 'designer') {
    const rows = workbench.review.map(item => ({
      ...item, key: item.projectId + ':' + item.issueId, photo: item.photo ? photoView(item.photo) : null,
      path: projectRoutes.issue(item.projectId, item.issueId),
    }));
    view.review = rows.filter(item => !item.replied);
    view.replied = rows.filter(item => item.replied);
    view.photos = view.review.slice(0, 1).flatMap(item => item.photo ? [item.photo] : []);
    view.actions = rows;
  } else if (role === 'worker') {
    view.records = workbench.records.map(item => ({
      ...item, key: item.projectId + ':' + item.recordId,
      label: item.resubmittedRecordId ? '已补交' : item.label,
      path: projectRoutes.record(item.projectId, item.resubmittedRecordId || item.recordId),
    }));
    view.returned = view.records.filter(item => item.canResubmit);
    view.receipts = view.records.filter(item => !view.returned.includes(item));
    view.next = workbench.next.map(item => ({ ...item, key: item.projectId + ':issue:' + item.issueId, path: projectRoutes.issue(item.projectId, item.issueId) }));
    view.actions = [...view.records, ...view.next];
    const captureProject = projectId || (projects.length === 1 ? primary.id : '');
    view.captureProject = workbench.captureProjects.includes(captureProject) ? captureProject : '';
  } else if (role === 'boss') {
    const items = workbench.items;
    view.closed = workbench.closedComplete ? String(workbench.closed) : '≥' + workbench.closed;
    if (!reading) view.stats = [
      { label: '在建工地', value: (detail.truncated ? '≥' : '') + items.filter(item => item.status === 'active').length },
      { label: '需介入', value: (detail.truncated ? '≥' : '') + items.reduce((sum, item) => sum + (item.late ? 1 : 0) + (item.coordinationCount || 0), 0) },
      { label: kind === 'weekly' ? '本期已关闭' : '当期已关闭', value: view.closed },
    ];
    view.actions = [
      ...items.filter(item => item.late).map(item => ({ ...item.late, projectId: item.projectId, name: item.name, key: item.projectId + ':node',
        tag: '进度落后', late: true, path: projectRoutes.node(item.projectId, item.late.nodeKey) })),
      ...items.flatMap(item => (item.coordination || []).map(issue => ({ ...issue, projectId: item.projectId, name: item.name,
        key: item.projectId + ':' + issue.issueId, tag: '待协调', path: projectRoutes.issue(item.projectId, issue.issueId) }))),
    ];
    view.unverified = items.some(item => item.unverified);
    if (!reading) view.plans = projects.flatMap(p => p.arrangements.map(line => ({ ...line, key: p.id + ':' + line.key, projectName: p.name })));
  }
  if (reading) view.siteDetails = Object.fromEntries(snapshots.map(project => [project.key, { ...project,
    originals: originals.filter(item => item.projectId === project.key),
    photos: view.photos.filter(item => item.projectId === project.key),
    actions: view.actions.filter(item => item.projectId === project.key) }]));
  return view;
}

const reportBoardMethods = {
  ...reportBookMethods,
  async showReportBoard(identity, mode, session) {
    const options = this._options, owner = validId(options.reportProject) && validId(options.leadId);
    const projectId = owner ? options.reportProject : validId(options.staffProjectId) ? options.staffProjectId : '';
    this._boardScope = { projectId, leadId: owner ? options.leadId : '' };
    const staffRole = identity.staffRole || identity.role;
    const role = owner ? 'customer' : ['enterprise_admin', 'admin', 'super_admin'].includes(staffRole) ? 'boss' : staffRole === 'designer' ? 'designer' : 'worker';
    const kind = this._boardKind || (options.kind === 'weekly' || role === 'boss' ? 'weekly' : 'daily');
    this.setData({ reportBoard: true, reportBoardRole: role, reportBoardTitle: titles[role], reportBoardKind: kind,
      reportBoardLoading: true, reportBoardError: '', ownerSiteReport: owner, professionalFollowup: !owner,
      followupActive: true, loading: false, reportBoardScroll: this._boardScroll || 0 });
    const scope = this._boardScope;
    const current = () => this._alive && this._shown && scope === this._boardScope && session === this.followups.identity();
    try {
      if (!session || owner && mode && mode !== 'customer' || !owner && mode === 'customer') {
        if (current()) this.setData({ reportBoardError: '当前身份无法查看这些施工简报。' });
        return;
      }
      if (owner) {
        const entry = await this.controller.client.read('/entry-context', { leadId: scope.leadId }, {}, 'POST');
        if (!current()) return;
        this._ownerReportToken = entry.entryToken;
      } else this.prepareFollowupEnterprise(identity);
      await this.followups.show({ board: true, projectId, bindingId: validId(options.bindingId) ? options.bindingId : '' });
      if (!current()) return;
      const context = this.followups.state.followupContext;
      if (!context) return;
      this.setData({ reportBoardRole: context.audience, reportBoardTitle: titles[context.audience] });
      await this.loadReportBoard(this._boardKind || (options.kind === 'weekly' || context.audience === 'boss' ? 'weekly' : 'daily'));
    } catch (error) {
      if (current()) this.setData({ reportBoardError: errorCopy(error) });
    } finally {
      if (current()) this.setData({ reportBoardLoading: false });
    }
  },
  async loadReportBoard(kind = this.data.reportBoardKind) {
    const followups = this.followups, context = followups.state.followupContext, scope = this._boardScope;
    if (!context || !scope || !followups.current() || !['daily', 'weekly'].includes(kind)) return;
    const ticket = this._boardTicket = (this._boardTicket || 0) + 1, epoch = followups.epoch;
    const current = () => this._alive && this._shown && ticket === this._boardTicket && followups.current(epoch);
    this._boardKind = kind;
    this.boardMedia?.clear();
    this.setData({ ...this.clearReportBook(), reportBoardKind: kind, reportBoardLoading: true, reportBoardError: '',
      reportBoardView: null, reportBoardPhotoError: '', reportBoardExpandedSite: '' });
    const path = '/followups/' + context.bindingId + '/reports';
    const filter = scope.projectId ? { projectId: scope.projectId } : {};
    try {
      const headers = await followups.headers();
      const list = await followups.client.read(path, { ...filter, kind }, headers);
      if (!current()) return;
      const items = (list.items || []).filter(item => item.kind === kind && item.available && item.deliveryState !== 'muted')
        .sort((a, b) => Date.parse(b.periodStart) - Date.parse(a.periodStart));
      const item = items[0];
      if (!item) {
        if (list.items?.some(saved => !saved.available)) this.setData({ reportBoardError: '这期简报暂不可查看，来源或权限可能已变化。' });
        return;
      }
      const result = await followups.client.read(path + '/' + item.reportId + '/workbench', { ...filter, revision: item.revision }, headers);
      if (!current()) return;
      const view = boardView(result.report, result.workbench, context, kind, scope.projectId, result.reading);
      this.setData({ reportBoardView: view, reportBoardTitle: view.title, reportBoardLoading: false }, () => {
        if (!current()) return;
        this.measureReportBook();
        if (view.detail.ready) void this.loadReportBookImage();
        if (this.data.followupHistoryOpen) return;
        if (this._boardScroll) this.setData({ reportBoardScroll: this._boardScroll });
        const detail = { ...view.detail, bindingId: context.bindingId };
        void followups.renderedReport(detail);
      });
      if (view.photos.length) {
        this.boardMedia ||= new FollowupRecordMedia({ identity: followups.identity, headers: () => followups.headers(),
          emit: patch => {
            if (this._alive && this._shown) this.setData({ reportBoardPaths: patch.siteRecordPaths || {},
              ...(patch.siteRecordError !== undefined ? { reportBoardPhotoError: patch.siteRecordError } : {}) });
          } });
        void this.boardMedia.loadReportPhotos(context.bindingId, result.report, view.photos);
      }
    } catch (error) {
      if (current()) this.setData({ reportBoardError: errorCopy(error) });
    } finally {
      if (current()) this.setData({ reportBoardLoading: false });
    }
  },
  hideReportBoard() {
    if (!this.data.reportBoard) return;
    this._boardTicket = (this._boardTicket || 0) + 1;
    this._boardScope = null;
    this.boardMedia?.clear();
    this.setData({ ...this.clearReportBook(true), reportBoardView: null, reportBoardPaths: {}, reportBoardLoading: true,
      reportBoardDecision: '', reportBoardExpandedSite: '', reportBoardRefreshing: false, reportBoardScroll: 0 });
  },
  switchReportBoard(e) {
    const kind = e.currentTarget.dataset.kind;
    if (kind === this.data.reportBoardKind) return;
    this._boardKind = kind;
    this._boardScroll = 0;
    this.setData({ reportBoardKind: kind, reportBoardScroll: 0 });
    return this.loadReportBoard(kind);
  },
  scrollReportBoard(e) { this._boardScroll = e.detail.scrollTop; },
  async refreshReportBoard() {
    this.setData({ reportBoardRefreshing: true });
    try {
      if (this.followups.state.followupContext) await this.loadReportBoard();
      else {
        const app = getApp().globalData, current = app.bootstrap?.current;
        await this.showReportBoard(current?.context || app.userInfo || {}, current?.mode, this.followups.identity());
      }
    } finally {
      if (this._alive && this._shown) this.setData({ reportBoardRefreshing: false });
    }
  },
  async reportBoardHistory() {
    const scope = this._boardScope, context = this.followups.state.followupContext;
    if (!context) return;
    this.followups.historyOptions(context);
    if (!this._boardHistoryOpened && scope?.projectId) {
      this.followups.set({ followupHistoryFilters: { ...this.followups.state.followupHistoryFilters, projectId: scope.projectId } });
    }
    this._boardHistoryOpened = true;
    return this.followups.openHistory();
  },
  async openReportBoardDetail(e) {
    const view = this.data.reportBoardView, r = view?.detail, scope = this._boardScope, ticket = this._boardTicket;
    if (!r?.available || !scope || !this.followups.current()) return;
    const key = e?.currentTarget?.dataset?.original;
    const original = view.originals.find(item => item.key === key);
    if (key && !original) return;
    await this.followups.readReport(r.reportId, r.revision, this.followups.selected, original?.projectId || scope.projectId);
    const opened = this.followups.state.followupDetail;
    if (original && this._boardScope === scope && this._boardTicket === ticket && opened?.ready
      && opened.reportId === r.reportId && opened.revision === r.revision && opened.projects.some(p => p.id === original.projectId))
      await this.followups.original(original.projectId, original.id);
  },
  toggleReportBoardSite(e) {
    const projectId = e.currentTarget.dataset.project;
    if (!this.data.reportBoardView?.siteDetails?.[projectId] || !this.followups.current()) return;
    this.setData({ reportBoardExpandedSite: this.data.reportBoardExpandedSite === projectId ? '' : projectId });
  },
  openReportBoardAction(e) {
    const action = this.data.reportBoardView?.actions.find(item => item.key === e.currentTarget.dataset.key);
    if (action && this.followups.current()) wx.navigateTo({ url: action.path });
  },
  captureReportBoard() {
    const projectId = this.data.reportBoardView?.captureProject;
    if (validId(projectId) && this.followups.current()) wx.navigateTo({ url: base + 'report/report?projectId=' + projectId });
  },
  reportBoardProjects() { wx.navigateTo({ url: base + 'projects/projects' }); },
  askReportBoard() {
    const r = this.data.reportBoardView?.detail, scope = this._boardScope;
    if (!r?.ready || !scope?.leadId || !this.followups.current()) return;
    const query = { ownerReport: r.reportId, revision: r.revision, bindingId: this.followups.selected,
      projectId: scope.projectId, leadId: scope.leadId, focusReport: 1 };
    wx.navigateTo({ url: '/packages/assistant/chat/chat?' + Object.entries(query).map(([key,value]) => key + '=' + encodeURIComponent(value)).join('&') });
  },
  openReportBoardDecision(e) {
    const view = this.data.reportBoardView;
    const plan = [...(view?.decisions || []), ...(view?.decided || [])].find(item => item.id === e.currentTarget.dataset.id);
    if (!plan || !this.followups.current()) return;
    this.setData({ reportBoardDecision: plan.id });
    this.openSheet('reportDecision');
    return this.plans.open(plan.conversationId, plan.id);
  },
};

module.exports = { initialBoard, reportBoardMethods, boardView };
