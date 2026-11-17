const api = require('../../../utils/api');
const { loadSiteFont } = require('../lib/site-font');

const base = '/miniprogram/construction/owner-sites';
const readOptions = { suppressUnauthorized: true };
const emptyProject = { project: null, report: null, camera: null, projectLoading: false, projectError: '', cameraLoading: false, cameraError: '' };

function session() {
  return getApp().globalData.token || wx.getStorageSync('token');
}

function shanghaiDate(value, includeTime = false) {
  const date = new Date(Date.parse(value) + 8 * 3600000);
  if (Number.isNaN(date.getTime())) return '';
  const day = `${date.getUTCMonth() + 1}月${date.getUTCDate()}日`;
  return includeTime ? day + ' ' + date.toISOString().slice(11, 16) : day;
}

Component({
  data: { ...emptyProject, projects: [], selectedIndex: 0, loading: true, error: '', needsLogin: false, navTop: 32, navHeight: 32, navRight: 96 },
  lifetimes: {
    attached() { this.measureNav(); void loadSiteFont(); this.showSite(); },
    detached() { this._visible = false; this._generation++; },
  },
  pageLifetimes: {
    show() { this.showSite(); },
    hide() {
      this._visible = false;
      this._generation++;
      this.setData({ ...emptyProject, projects: [], loading: true, error: '', needsLogin: false });
    },
    resize() { this.measureNav(); },
  },
  methods: {
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
      const generation = this._generation = (this._generation || 0) + 1;
      this.setData({ ...emptyProject, projects: [], loading: true, needsLogin: false, error: '' });
      await getApp().globalData.sessionHydrationPromise;
      const token = session();
      if (!this.current(generation, token)) return;
      if (!token) { this.setData({ loading: false, needsLogin: true }); return; }
      try {
        const { data } = await api.request(base, 'GET', {}, readOptions);
        if (!this.current(generation, token)) return;
        const projects = data.items;
        const selectedIndex = Math.max(projects.findIndex(project => project.id === this._projectId), 0);
        this.setData({ projects, selectedIndex, loading: false });
        if (projects.length) await this.readProject(projects[selectedIndex]);
      } catch (error) {
        if (this.current(generation, token)) this.setData({ loading: false, needsLogin: error.statusCode === 401,
          error: error.statusCode === 401 ? '' : '工地暂时无法读取' });
      }
    },
    selectProject(event) {
      const index = Number(event.detail.value), selected = this.data.projects[index];
      if (!selected || selected.id === this._projectId) return;
      this.setData({ selectedIndex: index });
      return this.readProject(selected);
    },
    retryProject() { return this.load(); },
    async readProject(selected) {
      const token = session(), generation = this._generation = (this._generation || 0) + 1;
      this._projectSession = token;
      const projectId = this._projectId = selected.id;
      this.setData({ ...emptyProject, projectLoading: true });
      try {
        const { data } = await api.request(`${base}/${projectId}`, 'GET', {}, readOptions);
        if (!this.current(generation, token)) return;
        if (!data.project || data.project.id !== projectId) throw new Error('project mismatch');
        const report = data.report ? { ...data.report, dateLabel: shanghaiDate(data.report.periodStart) } : null;
        this.setData({ project: data.project, report, projectLoading: false, cameraLoading: true });
        await this.readCover(projectId, generation, token);
      } catch (error) {
        if (this.current(generation, token)) this.setData({ ...emptyProject,
          projectError: error.statusCode === 404 ? '这个工地目前不可查看' : '工地资料暂时无法读取' });
      }
    },
    async readCover(projectId, generation, token) {
      try {
        const { data } = await api.request(`${base}/${projectId}/cover`, 'GET', {}, readOptions);
        if (!this.current(generation, token)) return;
        const camera = data.camera;
        this.setData({ camera: camera ? { name: camera.name, dateLabel: shanghaiDate(camera.cover?.capturedAt, true),
          src: camera.cover?.jpeg ? 'data:image/jpeg;base64,' + camera.cover.jpeg : '' } : null });
      } catch (error) {
        if (!this.current(generation, token)) return;
        if (error.statusCode === 401) this.setData({ ...emptyProject, projects: [], needsLogin: true });
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
      if (this.data.camera?.dateLabel === event.currentTarget.dataset.date) this.setData({ 'camera.src': '', 'camera.dateLabel': '' });
    },
    navigate(url) {
      if (this._navigating) return;
      this._navigating = true;
      wx.navigateTo({ url, fail: () => wx.showToast({ title: '暂时无法打开，请重试', icon: 'none' }),
        complete: () => { this._navigating = false; } });
    },
    login() { this.navigate('/packages/business/login/login'); },
    openCamera() {
      if (!this.current(this._generation, this._projectSession) || !this.data.camera || !this.data.project) return;
      this.navigate('/packages/construction/camera/camera?projectId=' + this.data.project.id);
    },
    openReport(event) {
      const { project, report } = this.data;
      if (!this.current(this._generation, this._projectSession) || !project || !report) return;
      const recordId = String(event.currentTarget.dataset.record || '');
      if (recordId && !report.pending.some(item => item.recordId === recordId)) return;
      const params = { ownerReport: report.reportId, bindingId: report.bindingId, revision: report.revision,
        projectId: project.id, leadId: project.leadId, ...(recordId ? { recordId } : {}) };
      const query = Object.entries(params).map(([key, value]) => key + '=' + encodeURIComponent(value)).join('&');
      this.navigate('/packages/assistant/chat/chat?' + query);
    },
  },
});
