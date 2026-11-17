const api = require('../../../utils/api');
const { openAIDesignTab } = require('../../../utils/aiDesignNavigation');
const { canAccessRoute } = require('../../../utils/identity-navigation');
const { loadSiteFont } = require('../lib/site-font');
const { siteMessageTime, errorText } = require('../chat/site-client');

const base = '/miniprogram/construction/workbench';
const projects = '/packages/construction/projects/projects';
const chat = '/packages/construction/chat/chat';
const reports = '/packages/assistant/chat/chat?followup=1';
const options = { suppressUnauthorized: true };
const titles = { worker: '施工工作台', manager: '项目经理工作台', designer: '设计师工作台', boss: '老板工作台' };
const statusLabels = { organizing: '待整理', draft: '等经理核对', published: '已发布', changes_requested: '待补拍', withdrawn: '已撤回' };

function session() {
  const app = getApp(), global = app.globalData;
  const context = global.bootstrap?.current?.context || global.userInfo || {};
  return { token: global.token || wx.getStorageSync('token'),
    key: [context.enterpriseId, context.staffId || context.adminId].filter(Boolean).join(':'),
    identity: global.bootstrap || global.userInfo };
}

function viewForRole(role) {
  return role === 'enterprise_admin' ? 'boss' : role === 'designer' ? 'designer' : 'worker';
}

function dashboard(data) {
  const items = data.items || [];
  const late = items.filter(item => item.late);
  const exceptions = [
    ...late.map(item => ({ ...item.late, id: item.projectId, name: item.name, kind: 'late', key: 'late-' + item.projectId })),
    ...items.flatMap(item => (item.coordination || []).map(issue => ({
      ...issue, id: item.projectId, name: item.name, kind: 'coordination', key: 'issue-' + issue.issueId,
    }))),
  ];
  const day = new Date(Date.parse(data.asOf) + 8 * 3600000);
  return { ...data, date: Number.isNaN(+day) ? '' : (day.getUTCMonth() + 1) + '月' + day.getUTCDate() + '日',
    totals: [items.filter(item => item.status === 'active').length, late.length,
      items.reduce((count, item) => count + (item.coordinationCount || 0), 0)], exceptions: exceptions.slice(0, 4),
    unverified: items.some(item => item.status === 'active' && item.progress?.overall?.color === 'gray') };
}

function decorate(data) {
  const record = item => item ? { ...item, time: siteMessageTime(item.at).replace(/^今天 /, ''), label: statusLabels[item.status] || '' } : null;
  return data.view === 'boss' ? dashboard(data)
    : { ...data, draft: record(data.draft), receipt: record(data.receipt) };
}

function discardPhoto(path) {
  if (path) wx.getFileSystemManager?.().unlink({ filePath: path, fail() {} });
}

Component({
  properties: { role: { type: String, observer() { if (this._visible) this.load(); } } },
  data: { model: null, photo: '', loading: true, error: '', notice: '', selectedIndex: 0, navTop: 46, navHeight: 32, navRight: 96 },
  lifetimes: {
    attached() { this.measure(); void loadSiteFont(); this.show(); },
    detached() { this.hide(); },
  },
  pageLifetimes: {
    show() { this.show(); },
    hide() { this.hide(); },
    resize() { this.measure(); },
  },
  methods: {
    measure() {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      let capsule;
      try { capsule = wx.getMenuButtonBoundingClientRect(); } catch { /* The fallback still reserves the capsule lane. */ }
      this.setData({ navTop: Math.max(info.statusBarHeight || 24, capsule?.top || 46),
        navHeight: capsule?.height || 32, navRight: info.windowWidth - (capsule?.left || info.windowWidth - 94) + 10 });
    },
    show() { if (!this._visible) { this._visible = true; return this.load(); } },
    hide() {
      this._visible = false;
      this._generation = (this._generation || 0) + 1;
      discardPhoto(this.data.photo);
      this.setData({ model: null, photo: '', loading: true, error: '', notice: '' });
    },
    current(generation, binding) {
      const current = session();
      return this._visible && this._generation === generation && current.token === binding.token && current.key === binding.key;
    },
    async load(projectId) {
      const generation = this._generation = (this._generation || 0) + 1;
      discardPhoto(this.data.photo);
      this.setData({ model: null, photo: '', loading: true, error: '', notice: '', title: titles[viewForRole(this.data.role)] });
      await getApp().globalData.sessionHydrationPromise;
      const binding = session(), current = () => this.current(generation, binding);
      if (!current()) return;
      this._binding = binding;
      if (!binding.token || !canAccessRoute(projects, binding.identity)) {
        this.setData({ loading: false, error: '请使用有工地权限的员工身份登录。' }); return;
      }
      const key = 'site-workbench:project:' + binding.key + ':' + this.data.role;
      const saved = projectId || wx.getStorageSync(key);
      const selected = this.data.role !== 'enterprise_admin' && /^[1-9]\d*$/.test(String(saved)) ? saved : '';
      try {
        let data, notice = '';
        try {
          ({ data } = await api.request(base + (selected ? '?projectId=' + encodeURIComponent(selected) : ''), 'GET', {}, options));
        } catch (error) {
          if (!current() || !selected || error.statusCode !== 404) throw error;
          wx.removeStorageSync(key);
          ({ data } = await api.request(base, 'GET', {}, options));
          notice = '原工地已不可访问，已更新工地列表。';
        }
        if (!current()) return;
        if (data.project) wx.setStorageSync(key, data.project.id);
        const model = decorate(data);
        this.setData({ model, title: titles[model.view], selectedIndex: Math.max(0, (model.choices || []).findIndex(item => item.id === model.project?.id)),
          loading: false, notice });
        const photoId = (model.draft || model.receipt)?.photoId;
        if (photoId) {
          try {
            const file = await api.downloadFile('/miniprogram/construction/projects/' + model.project.id + '/chat/media/' + photoId, options);
            if (current()) this.setData({ photo: file.tempFilePath });
            else discardPhoto(file.tempFilePath);
          } catch { /* The source record stays accessible through its authorized detail. */ }
        }
      } catch (error) {
        if (current()) this.setData({ loading: false, error: errorText(error) });
      }
    },
    retry() { return this.load(); },
    async refresh() {
      this.setData({ refreshing: true });
      try { await this.load(); }
      finally { if (this._visible) this.setData({ refreshing: false }); }
    },
    changeProject(event) {
      const choice = this.data.model?.choices[Number(event.detail.value)];
      if (choice && choice.id !== this.data.model.project.id) return this.load(choice.id);
    },
    navigate(url, captureAction) {
      if (!this._binding || !this.current(this._generation, this._binding) || this._navigating) return;
      this._navigating = true;
      wx.navigateTo({ url, success: ({ eventChannel }) => { if (captureAction) eventChannel?.emit('workbenchCapture', captureAction); },
        fail: () => wx.showToast({ title: '暂时无法打开，请重试', icon: 'none' }),
        complete: () => { this._navigating = false; } });
    },
    openProject() { const id = this.data.model?.project?.id; if (id) this.navigate(projects + '?project=' + id); },
    openAll() { this.navigate(projects); },
    openTask() {
      const task = this.data.model?.task;
      if (task?.issueId) this.openIssue({ currentTarget: { dataset: { issue: task.issueId } } });
      else if (task) this.openProject();
    },
    capture(event) {
      const { project, canCapture } = this.data.model || {};
      const action = event.currentTarget.dataset.action;
      if (canCapture && ['photo', 'voice'].includes(action)) this.navigate(chat + '?projectId=' + project.id, action);
    },
    openRecord(event) {
      const project = this.data.model?.project, id = event.currentTarget.dataset.record;
      if (project && id) this.navigate(chat + '?projectId=' + project.id + '&recordId=' + id);
    },
    openIssue(event) {
      const { issue, project, record } = event.currentTarget.dataset;
      if (record) { this.openRecord(event); return; }
      const id = project || this.data.model?.project?.id;
      if (issue && id) this.navigate(chat + '?projectId=' + id + '&issueId=' + issue + '&mode=review');
    },
    openNode(event) {
      const { project, node } = event.currentTarget.dataset;
      if (project && node) this.navigate(projects + '?project=' + project + '&scheduleNode=' + encodeURIComponent(node));
    },
    openReports() {
      const project = this.data.model?.project?.id;
      this.navigate(reports + (project ? '&staffProjectId=' + project : ''));
    },
    openDesign() {
      if (this.data.role === 'designer' && canAccessRoute('/pages/ai-design/ai-design', session().identity)) openAIDesignTab();
    },
  },
});
