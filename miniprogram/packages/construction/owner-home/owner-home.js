const api = require('../../../utils/api');
const ownerReminders = require('../../../utils/owner-reminders');
const { loadSiteFont } = require('../lib/site-font');
const { displayName } = require('../lib/family-view');
const { initialCameraLive, privateCameraLiveMethods } = require('../lib/private-camera-live');
const { ownerLiveAuthorizationPath } = require('../../../utils/owner-live-authorization');
const { aiEntriesEnabled } = require('../../../utils/ai-entries');
const nativePreview = require('../../../utils/native-preview');
const { shanghaiDate } = require('./renovation-overview');
const { emptyRenovation, renovationMethods } = require('./renovation-methods');

const base = '/miniprogram/construction/owner-sites';
const familyBase = '/miniprogram/construction/customer-projects';
const readOptions = { suppressUnauthorized: true };
const emptyReminders = { remindersOpen: false, siteReminders: [], remindersLoading: false, remindersError: '',
  reminderSelected: '', reminderDetail: null, reminderReading: false, reminderReadError: '' };
const emptyProject = { project: null, report: null, reportPhoto: '', latestProgress: null, nextStep: null, notebookTask: null, camera: null, projectLoading: false, projectError: '', cameraLoading: false, cameraError: '',
  liveApplication: null, liveError: '', schedule: null, scheduleLoading: false, scheduleError: '', scheduleOpen: false,
  siteMoreOpen: false, familyVisible: false, ...emptyReminders };
const emptyAccount = { ...emptyProject, ...emptyRenovation, projects: [], familyProjects: [] };

// A family viewer keeps the owner-owned Site data out of this page and only
// gets a read-only entry into the approved cloud-site family view.
function sharedFamilyProjects(items, listed) {
  return (Array.isArray(items) ? items : []).reduce((projects, item) => {
    const projectId = String(item?.id || '');
    if (item?.role !== 'family' || !/^[1-9]\d*$/.test(projectId) || listed.has(projectId)
      || projects.some(project => project.id === projectId)) return projects;
    projects.push({ id: projectId, name: displayName(item.name, '未命名工地') });
    return projects;
  }, []);
}

function session() {
  return getApp().globalData.token || wx.getStorageSync('token');
}

function ownerTask(decision, application) {
  if (decision?.id) return { label: '待我确认', title: decision.title, button: '查看待确认事项', kind: 'decision' };
  if (application?.canDecide) return { label: '待我确认', title: '直播公开申请 · ' + application.alias, button: '查看申请', kind: 'live' };
  return null;
}

Component({
  properties: { requestedFamilyProjectId: String, aiEntriesEnabled: Boolean, renovationOverview: Boolean },
  data: { ...emptyAccount, ...initialCameraLive, siteDetail: false, selectedIndex: 0,
    loading: true, error: '', needsLogin: false, navTop: 32, navHeight: 32, navRight: 96 },
  lifetimes: {
    attached() { this.measureNav(); void loadSiteFont(); this.showSite(); },
    detached() { this.clearPrivateLive(); this.clearReportPhoto(); this.clearRenovationFiles(); this._visible = false; this._generation++; },
  },
  pageLifetimes: {
    show() {
      if (this.data.renovationOverview && nativePreview.shownAfterPreview(nativePreview.currentPage())) return;
      this.showSite();
    },
    hide() {
      if (this.data.renovationOverview && nativePreview.hiddenByPreview(nativePreview.currentPage())) return;
      this.clearPrivateLive();
      this.clearReportPhoto();
      this.clearRenovationFiles();
      this._resumeFamily = this.data.familyVisible && this.data.project && this.current(this._generation, this._projectSession)
        ? { projectId: this.data.project.id, token: this._projectSession } : null;
      this._visible = false;
      this._generation++;
      this._renovationService = null;
      this._ownerDecision = null;
      this.setData({ ...emptyAccount, loading: true, error: '', needsLogin: false });
    },
    resize() { this.measureNav(); },
  },
  methods: {
    ...renovationMethods(session, emptyProject),
    ...privateCameraLiveMethods(api, session, {
      current: page => page.current(page._generation, page._projectSession),
      selection: page => ({ projectId: page.data.project?.id, bindingId: page.data.camera?.bindingId }),
      recheck: page => page.readCover(page._projectId, page._generation, page._projectSession),
      // The private gateway can wait 45 seconds for a cold stream's first byte.
      firstFrameTimeoutMs: 50000,
      retryPlaybackError: true,
    }),
    measureNav() {
      const window = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const capsule = wx.getMenuButtonBoundingClientRect?.();
      this.setData({ navTop: Math.max(window.statusBarHeight || 24, capsule?.top || 32), navHeight: capsule?.height || 32,
        navRight: Math.max(96, window.windowWidth - (capsule?.left || window.windowWidth - 94) + 10) });
    },
    showSite() {
      if (this._visible) return;
      this._visible = true;
      return this.load();
    },
    current(generation, token) {
      return this._visible && this._generation === generation && session() === token;
    },
    async load() {
      this.clearPrivateLive();
      this.clearReportPhoto();
      this.clearRenovationFiles();
      const generation = this._generation = (this._generation || 0) + 1;
      this.setData({ ...emptyAccount, loading: true, needsLogin: false, error: '' });
      await getApp().globalData.sessionHydrationPromise;
      const token = session();
      if (!this.current(generation, token)) return;
      if (!token) { this.setData({ loading: false, needsLogin: true }); return; }
      void ownerReminders.refreshSummary();
      const overview = this.data.renovationOverview;
      const requested = this.data.requestedFamilyProjectId;
      const resume = this._resumeFamily?.token === token ? this._resumeFamily.projectId : '';
      const familyProjectId = requested || resume;
      try {
        const [sites, shared, serviceIndex] = await Promise.all([
          api.request(base, 'GET', {}, readOptions),
          // Owner-site data never carries a family grant. Read the shared-site
          // list separately so an invited family account can reopen it here.
          api.request(familyBase, 'GET', {}, readOptions).then(({ data }) => {
            if (!Array.isArray(data)) throw new Error('Invalid shared-site list');
            return { items: data };
          }).catch(error => ({ error })),
          overview && !familyProjectId && !this._siteDetailId ? this.listRenovations() : [],
        ]);
        if (!this.current(generation, token)) return;
        const projects = sites.data.items.map(project => ({ ...project, name: displayName(project.name, '未命名工地') }));
        this._resumeFamily = null;
        // A failed shared read cannot establish that the account has no sites.
        if (shared.error && !projects.length && !serviceIndex.length && !familyProjectId) throw shared.error;
        const familyProjects = sharedFamilyProjects(shared.items, new Set(projects.map(project => project.id)));
        if (overview && !familyProjectId && !this._siteDetailId) {
          this.setData({ projects, familyProjects, loading: false });
          return this.openRenovations(serviceIndex, projects);
        }
        if (overview && this._siteDetailId && !familyProjectId && !projects.some(project => project.id === this._siteDetailId)) {
          this._siteDetailId = '';
          this.setData({ siteDetail: false });
          return this.load();
        }
        const selectedProjectId = familyProjectId || (overview ? this._siteDetailId : this._projectId || ownerReminders.summary()?.unreadProjectId);
        const index = projects.findIndex(project => project.id === selectedProjectId);
        const selected = index >= 0 ? projects[index] : familyProjectId ? { id: familyProjectId } : projects[0];
        if (overview) this._siteDetailId = selected?.id || '';
        this.setData({ projects, familyProjects, selectedIndex: Math.max(index, 0), loading: false,
          projectLoading: !!selected, ...(overview ? { siteDetail: !!selected } : {}) });
        if (requested) this.triggerEvent('familyentryconsumed');
        if (selected) await this.readProject(selected, selected.id === familyProjectId);
      } catch (error) {
        if (this.current(generation, token)) this.setData({ loading: false, needsLogin: error.statusCode === 401,
          error: error.statusCode === 401 ? '' : overview ? '装修资料暂时无法读取' : '工地暂时无法读取' });
      }
    },
    selectProject(event) {
      const index = Number(event.detail.value), selected = this.data.projects[index];
      if (!selected || selected.id === this._projectId || this.data.familyVisible) return;
      if (this.data.renovationOverview) this._siteDetailId = selected.id;
      this.setData({ selectedIndex: index });
      return this.readProject(selected);
    },
    retryProject() { return this.load(); },
    toggleSiteMore() {
      if (!this.data.project?.progressAccess || this.data.familyVisible || !this.current(this._generation, this._projectSession)) return;
      if (this.data.siteMoreOpen) {
        this._reminderAction = (this._reminderAction || 0) + 1;
        this.setData({ ...emptyReminders, siteMoreOpen: false });
      } else {
        this.setData({ siteMoreOpen: true });
      }
    },
    toggleSiteReminders() {
      if (!this.data.project?.progressAccess || !this.current(this._generation, this._projectSession)) return;
      this._reminderAction = (this._reminderAction || 0) + 1;
      const remindersOpen = !this.data.remindersOpen;
      this.setData({ ...emptyReminders, remindersOpen });
      if (remindersOpen) return this.loadSiteReminders();
    },
    async loadSiteReminders() {
      const projectId = this.data.project?.id, generation = this._generation, token = this._projectSession;
      if (!this.data.project?.progressAccess || !this.data.remindersOpen || this.data.remindersLoading || !this.current(generation, token)) return;
      const action = this._reminderAction;
      const current = () => this.current(generation, token) && this._reminderAction === action;
      this.setData({ remindersLoading: true, remindersError: '' });
      try {
        const items = await ownerReminders.list(projectId);
        if (current()) this.setData({ siteReminders: items.map(item => ({ ...item,
          dateLabel: item.deliveredAt ? shanghaiDate(item.deliveredAt, true) : '' })) });
      } catch (error) {
        if (current()) this.setData({ remindersError: error.statusCode === 404 ? '当前工地提醒不可查看。' : '提醒暂时无法读取。' });
      } finally {
        if (current()) this.setData({ remindersLoading: false });
      }
    },
    async openSiteReminder(event) {
      const id = String(event.currentTarget.dataset.id);
      const item = this.data.siteReminders.find(reminder => reminder.reminderId === id);
      const generation = this._generation, token = this._projectSession;
      if (!item || this.data.reminderReading || !this.current(generation, token)) return;
      if (this.data.reminderDetail?.reminderId === id) {
        this.setData({ reminderSelected: '', reminderDetail: null });
        return;
      }
      const action = this._reminderAction = (this._reminderAction || 0) + 1;
      const current = () => this.current(generation, token) && this._reminderAction === action;
      this.setData({ reminderSelected: id, reminderReading: true, reminderDetail: null, reminderReadError: '' });
      try {
        const detail = await ownerReminders.read(item);
        if (current()) {
          const readAt = detail.readAt;
          this.setData({ reminderDetail: detail,
            siteReminders: this.data.siteReminders.map(row => row.reminderId === id ? { ...row, readAt } : row) });
        }
      } catch (error) {
        if (current()) this.setData({ reminderReadError: ownerReminders.readError(error) });
      } finally {
        if (current()) this.setData({ reminderReading: false });
      }
    },
    async readProject(selected, openFamily = false) {
      const token = session(), generation = this._generation = (this._generation || 0) + 1;
      this._projectSession = token;
      const projectId = this._projectId = selected.id;
      this._ownerDecision = null;
      this.clearPrivateLive();
      this.clearReportPhoto();
      this.setData({ ...emptyProject, projectLoading: true });
      try {
        const { data } = await api.request(`${base}/${projectId}`, 'GET', {}, readOptions);
        if (!this.current(generation, token)) return;
        if (!data.project || data.project.id !== projectId) throw new Error('project mismatch');
        const { communityName, area, ...site } = data.project;
        const project = { ...site, name: displayName(site.name, '未命名工地') };
        const residence = project.progressAccess && displayName(communityName, '');
        const roundedArea = Math.round(Number(area));
        if (residence) {
          project.communityName = residence;
          if (Number.isFinite(roundedArea) && roundedArea > 0) project.areaLabel = `${roundedArea}㎡`;
        }
        this._ownerDecision = project.progressAccess ? data.decision : null;
        const report = project.progressAccess && data.report ? { ...data.report,
          dateLabel: data.report.publishedAt ? shanghaiDate(data.report.publishedAt, true) + ' 发布' : shanghaiDate(data.report.periodStart),
          pending: (data.report.pending || []).filter(item => typeof item.text === 'string' && item.text.trim()),
        } : null;
        const nextStep = report?.pending?.find(item => item.coordination) || report?.pending?.[0] || null;
        const latestProgress = project.progressAccess && data.latestProgress?.text
          ? { ...data.latestProgress, dateLabel: shanghaiDate(data.latestProgress.publishedAt, true) + ' 发布' } : null;
        const projects = this.data.projects;
        const unlisted = openFamily && !projects.some(item => item.id === projectId);
        this.setData({ project, report, latestProgress, nextStep, notebookTask: ownerTask(this._ownerDecision), projectLoading: false, cameraLoading: true,
          ...(unlisted ? { projects: [...projects, { id: projectId, name: project.name }], selectedIndex: projects.length } : {}) });
        if (openFamily) this.openFamilySheet();
        await Promise.all([
          this.readCover(projectId, generation, token),
          project.progressAccess && this.readLiveApplication(projectId, generation, token),
          project.progressAccess && this.readSchedule(),
          latestProgress?.mediaId
            ? this.readProgressPhoto(projectId, latestProgress, generation, token)
            : !latestProgress && report?.progress?.[0] && report.photo && this.readReportPhoto(projectId, report, generation, token),
        ]);
      } catch (error) {
        if (this.current(generation, token)) this.setData({ ...emptyProject,
          projectError: error.statusCode === 404 ? '这个工地目前不可查看' : '工地资料暂时无法读取' });
      }
    },
    async readReportPhoto(projectId, report, generation, token) {
      const { recordId, mediaId } = report.photo;
      const ids = [report.bindingId, report.reportId, projectId, recordId, mediaId];
      if (!ids.every(value => /^[1-9]\d{0,18}$/.test(String(value))) || !Number.isSafeInteger(report.revision) || report.revision < 1) return;
      const path = `/miniprogram/assistant/followups/${report.bindingId}/reports/${report.reportId}/projects/${projectId}/records/${recordId}/media/${mediaId}?revision=${report.revision}`;
      await this.readSitePhoto(path, generation, token);
    },
    async readProgressPhoto(projectId, progress, generation, token) {
      const { recordId, version, mediaId } = progress;
      if (![projectId, recordId, mediaId].every(value => /^[1-9]\d{0,18}$/.test(String(value))) || !Number.isSafeInteger(version) || version < 1) return;
      await this.readSitePhoto(`${base}/${projectId}/progress/${recordId}/${version}/media/${mediaId}`, generation, token);
    },
    async readSitePhoto(path, generation, token) {
      try {
        const file = await api.downloadFile(path, readOptions);
        if (this.current(generation, token)) this.setData({ reportPhoto: file.tempFilePath });
        else this.clearReportPhoto(file.tempFilePath);
      } catch { /* Keep the progress excerpt when its photo is unavailable. */ }
    },
    clearReportPhoto(path = this.data.reportPhoto) {
      if (!path) return;
      try { wx.getFileSystemManager?.().unlink({ filePath: path, fail: () => {} }); } catch { /* Temporary file. */ }
    },
    runNotebookTask() {
      const task = this.data.notebookTask;
      if (task?.kind === 'decision') this.openOwnerDecision();
      if (task?.kind === 'live') this.openLiveApplication();
    },
    openOwnerDecision() {
      const { project, report } = this.data, decision = this._ownerDecision;
      if (!project?.progressAccess || !decision?.id || !this.current(this._generation, this._projectSession)) return;
      this.navigate(this.ownerReportPath({ reportBoard: 1, reportProject: project.id,
        leadId: project.leadId, ownerDecision: decision.id, ...(report ? { bindingId: report.bindingId } : {}) }));
    },
    async readSchedule() {
      const { project, scheduleLoading } = this.data;
      const generation = this._generation, token = this._projectSession;
      if (!project?.progressAccess || scheduleLoading || !this.current(generation, token)) return;
      this.setData({ scheduleLoading: true, scheduleError: '' });
      try {
        const { data } = await api.request('/miniprogram/construction/projects/' + project.id + '/progress', 'GET', {}, readOptions);
        if (!this.current(generation, token)) return;
        if (data.projectId !== project.id || data.access !== 'owner') throw new Error('owner schedule mismatch');
        const progress = data.progress;
        const stage = progress?.construction;
        const stageNode = stage?.stageKey && stage.stageName === project.stageName
          && progress?.nodes?.find(node => !node.roomId && node.stageKey === stage.stageKey
            && ['in_progress', 'completed'].includes(node.constructionStatus));
        const stageStatus = { in_progress: '进行中', completed: '已完成' }[stageNode?.constructionStatus] || '';
        const nodes = (progress?.nodes || []).map(node => ({
          key: node.key,
          roomName: displayName(node.roomName, ''),
          stageName: displayName(node.stageName, '施工阶段'),
          label: node.label,
          color: node.color,
          timeText: node.timeText,
          plannedStart: node.plannedStart,
          plannedEnd: node.plannedEnd,
          constructionStatus: node.constructionStatus,
        }));
        const day = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
        const next = nodes.filter(node => /^\d{4}-\d{2}-\d{2}$/.test(node.plannedStart || '') && node.plannedStart >= day
          && !['in_progress', 'completed'].includes(node.constructionStatus))
          .sort((a, b) => a.plannedStart.localeCompare(b.plannedStart))[0];
        this.setData({ scheduleOpen: this.data.scheduleOpen || Boolean(this._openDetailSchedule && nodes.length),
          schedule: { label: progress?.overall?.label || '未排期', color: progress?.overall?.color || 'gray', nodes, stageStatus,
          next: next && { ...next, date: shanghaiDate(next.plannedStart) } } });
      } catch (error) {
        if (this.current(generation, token)) this.setData({
          schedule: null, scheduleOpen: false,
          scheduleError: [401, 403, 404].includes(error.statusCode) ? '排期暂时不可查看' : '排期读取失败',
        });
      } finally {
        if (this.current(generation, token)) this.setData({ scheduleLoading: false });
      }
    },
    toggleSchedule() {
      if (this.data.scheduleError) return this.readSchedule();
      if (this.data.schedule?.nodes.length && this.current(this._generation, this._projectSession)) {
        this._openDetailSchedule = !this.data.scheduleOpen;
        this.setData({ scheduleOpen: !this.data.scheduleOpen });
      }
    },
    async readLiveApplication(projectId, generation, token) {
      try {
        const { data } = await api.request(`${base}/${projectId}/public-live`, 'GET', {}, readOptions);
        if (this.current(generation, token)) this.setData({ liveApplication: data.item, notebookTask: ownerTask(this._ownerDecision, data.item), liveError: '' });
      } catch (error) {
        if (this.current(generation, token)) this.setData({ liveApplication: null, notebookTask: ownerTask(this._ownerDecision),
          liveError: [401, 403, 404].includes(error.statusCode) ? '' : '直播申请暂时无法读取' });
      }
    },
    retryLiveApplication() {
      if (!this.data.project?.progressAccess || !this.current(this._generation, this._projectSession)) return;
      this.setData({ liveError: '' });
      return this.readLiveApplication(this._projectId, this._generation, this._projectSession);
    },
    openLiveApplication() {
      if (!this.current(this._generation, this._projectSession)) return;
      const path = ownerLiveAuthorizationPath(this.data.project?.id, this.data.liveApplication);
      if (path) this.navigate(path);
    },
    async readCover(projectId, generation, token) {
      try {
        const { data } = await api.request(`${base}/${projectId}/cover`, 'GET', {}, readOptions);
        if (!this.current(generation, token)) return;
        const camera = data.camera;
        const bindingId = String(camera?.bindingId || '');
        if (this.data.livePhase !== 'idle' && this.data.camera?.bindingId !== bindingId) this.clearPrivateLive();
        this.setData({ camera: camera ? { name: camera.name, ...(bindingId ? { bindingId } : {}), dateLabel: shanghaiDate(camera.cover?.capturedAt, true),
          src: camera.cover?.jpeg ? 'data:image/jpeg;base64,' + camera.cover.jpeg : '' } : null });
      } catch (error) {
        if (!this.current(generation, token)) return;
        this.clearPrivateLive();
        if (error.statusCode === 401) this.setData({ ...emptyAccount, needsLogin: true });
        else this.setData({ camera: null, cameraError: error.statusCode === 404 ? '' : '监控信息暂时无法读取' });
      } finally {
        if (this.current(generation, token)) this.setData({ cameraLoading: false });
      }
    },
    retryCover() {
      if (!this._visible || !this.data.project || this.data.cameraLoading) return;
      this.setData({ cameraLoading: true, cameraError: '' });
      return this.readCover(this._projectId, this._generation, session());
    },
    cameraImageFailed(event) {
      const { camera } = this.data;
      if (camera && event.detail.key === `${camera.bindingId || ''}:${camera.dateLabel}`)
        this.setData({ 'camera.src': '', 'camera.dateLabel': '' });
    },
    navigate(url) {
      if (this._navigating) return;
      this._navigating = true;
      wx.navigateTo({ url, fail: () => wx.showToast({ title: '暂时无法打开，请重试', icon: 'none' }),
        complete: () => { this._navigating = false; } });
    },
    login() { this.navigate('/packages/business/login/login'); },
    playCamera() {
      if (!this.current(this._generation, this._projectSession) || !this.data.camera) return;
      if (!/^(?:[1-9]\d{0,18}|test-pattern)$/.test(this.data.camera.bindingId || '')) {
        this.failPrivateLive();
        return;
      }
      return this.startPrivateLive();
    },
    restoreCameraCover() { this.clearPrivateLive(); },
    openCamera() {
      if (!this.current(this._generation, this._projectSession) || !this.data.camera || !this.data.project) return;
      this.navigate('/packages/construction/camera/camera?projectId=' + this.data.project.id);
    },
    openFamilyProject(event) {
      const projectId = String(event.currentTarget.dataset.id || '');
      if (!this._visible || !/^[1-9]\d*$/.test(projectId)) return;
      this.navigate('/packages/construction/family/family?projectId=' + encodeURIComponent(projectId));
    },
    openFamilySheet() {
      if (!this.data.project?.progressAccess || !this.current(this._generation, this._projectSession)) return;
      this.setData({ familyVisible: true });
    },
    closeFamilySheet() { this.setData({ familyVisible: false }); },
    familyInviteShare() {
      const { familyVisible, project } = this.data;
      if (!familyVisible || !project?.progressAccess || !this.current(this._generation, this._projectSession)) return null;
      return this.selectComponent('#owner-family-sheet')?.shareInvite(project);
    },
    ownerReportPath(params) {
      const query = Object.entries(params).map(([key, value]) => key + '=' + encodeURIComponent(value)).join('&');
      return '/packages/assistant/chat/chat?' + query;
    },
    openReport(event) {
      const { project, report } = this.data;
      if (!this.current(this._generation, this._projectSession) || !project?.progressAccess) return;
      const recordId = String(event.currentTarget.dataset.record || '');
      if (!recordId) {
        this.navigate(this.ownerReportPath({ reportBoard: 1, reportProject: project.id, leadId: project.leadId,
          ...(report ? { bindingId: report.bindingId } : {}) }));
        return;
      }
      if (!report?.pending.some(item => item.recordId === recordId)) return;
      this.navigate(this.ownerReportPath({ ownerReport: report.reportId, bindingId: report.bindingId, revision: report.revision,
        projectId: project.id, leadId: project.leadId, ...(recordId ? { recordId } : {}) }));
    },
    askXiaok() {
      if (!aiEntriesEnabled()) return;
      const { project, report } = this.data;
      if (!this.current(this._generation, this._projectSession) || !project || !report) return;
      this.navigate(this.ownerReportPath({ ownerReport: report.reportId, bindingId: report.bindingId, revision: report.revision,
        projectId: project.id, leadId: project.leadId, ask: '1', prompt: '今天工地做了什么？' }));
    },
  },
});
