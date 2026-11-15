const api = require('../../../utils/api');
const { canAccessRoute } = require('../../../utils/identity-navigation');
const { errorText } = require('../projects/projects-model');
const { loadSiteFont } = require('../lib/site-font');
const route = '/packages/construction/brief/brief';
const closedIssueStatuses = ['closed', 'resolved', 'dismissed', 'cancelled'];
function decorateProject(project) {
  const issues = Array.isArray(project.issues) ? project.issues : [];
  const pending = issues.filter(item => !closedIssueStatuses.includes(item.status));
  const fixed = issues.filter(item => item.status === 'closed' || item.status === 'resolved');
  return {
    ...project,
    pendingCount: pending.length,
    pendingFacts: pending.slice(0, 3).map(item => ({ issueId: item.issueId, label: item.label || item.status,
      waitingFor: item.waitingFor || '', reason: item.reason || '' })),
    fixedCount: fixed.length,
    fixedFacts: fixed.slice(0, 2).map(item => ({ issueId: item.issueId, label: item.label || item.status })),
  };
}
function identity() {
  const g = getApp().globalData || {}, c = g.bootstrap && g.bootstrap.current && g.bootstrap.current.context || {};
  return { key: [c.enterpriseId, c.staffId].filter(Boolean).join(':'), token: g.token || wx.getStorageSync('token'), bootstrap: g.bootstrap || g.userInfo };
}
Page({
  data: { navTop: 24, navHeight: 32, navRight: 96, loading: true, error: '', items: [], asOf: '' },
  onLoad() {
    loadSiteFont();
    const w = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync(); let capsule;
    try { capsule = wx.getMenuButtonBoundingClientRect(); } catch { /* Native safe fallback. */ }
    this.setData({ navTop: Math.max(w.statusBarHeight || 24, (capsule && capsule.top || 30) - 6), navHeight: capsule && capsule.height || 32,
      navRight: Math.max(96, w.windowWidth - (capsule && capsule.left || w.windowWidth - 94) + 10) });
  },
  async onShow() {
    this._visible = true;
    const app = getApp(); if (app.hydrateStoredSession) await app.hydrateStoredSession();
    if (!this._visible) return;
    const c = identity(); this._key = c.key; this._token = c.token;
    if (!c.key || !c.token || !canAccessRoute(route, c.bootstrap)) { this.setData({ loading: false, error: '请使用有工地权限的员工身份登录。', items: [] }); return; }
    await this.load(); this.poll();
  },
  current(g) { const c = identity(); return this._visible && this._key === c.key && this._token === c.token && canAccessRoute(route, c.bootstrap) && (g === undefined || g === this._generation); },
  onHide() { this._visible = false; this._generation = (this._generation || 0) + 1; clearTimeout(this._timer); this.setData({ items: [], asOf: '', error: '', loading: true }); },
  onUnload() { this.onHide(); },
  poll() { clearTimeout(this._timer); if (this._visible) this._timer = setTimeout(async () => { await this.load(true); this.poll(); }, 5000); },
  async onPullDownRefresh() { try { await this.load(); } finally { wx.stopPullDownRefresh(); } },
  async load(quiet = false) {
    quiet = quiet === true;
    if (!this.current()) return;
    const g = this._generation = (this._generation || 0) + 1;
    if (!quiet) this.setData({ loading: true, error: '', items: [] });
    try {
      const result = await api.request('/miniprogram/construction/brief', 'GET');
      if (!this.current(g)) return;
      const d = result.data;
      const stamp = new Date(d.asOf), pad = n => String(n).padStart(2, '0');
      this.setData({ items: (d.items || []).map(decorateProject), version: d.version, hasMoreProjects: d.hasMoreProjects,
        asOf: `${stamp.getMonth() + 1}月${stamp.getDate()}日 ${pad(stamp.getHours())}:${pad(stamp.getMinutes())}`, error: '', loading: false });
    } catch (e) { if (this.current(g)) this.setData({ loading: false, items: [], asOf: '', error: errorText(e) }); }
  },
  openProject(e) {
    const pid = String(e.currentTarget.dataset.project), issueId = String(e.currentTarget.dataset.issue || '');
    const p = this.data.items.find(p => p.projectId === pid);
    if (!this.current() || !p || issueId && !p.issues.some(i => i.issueId === issueId)) return;
    wx.navigateTo({ url: '/packages/construction/chat/chat?projectId=' + pid + (issueId ? '&issueId=' + issueId : '') });
  },
  openProjects() {
    if (this.current()) wx.navigateTo({ url: '/packages/construction/projects/projects' });
  },
  openProjectIssues(e) {
    const pid = String(e.currentTarget.dataset.project || '');
    if (!this.current() || !/^[1-9]\d*$/.test(pid) || !this.data.items.some(p => p.projectId === pid)) return;
    wx.navigateTo({ url: '/packages/construction/projects/projects?project=' + pid });
  },
  ask() {
    const items = this.data.items.slice(0, 6), generation = this._generation;
    if (!this.current() || !items.length) return;
    wx.showActionSheet({ itemList: items.map(p => p.name), success: ({ tapIndex }) => {
      const p = items[tapIndex]; if (p && this.current(generation)) this.openProject({ currentTarget: { dataset: { project: p.projectId, issue: p.focusIssueId } } });
    } });
  },
  back() { wx.navigateBack({ fail: () => wx.redirectTo({ url: '/packages/construction/projects/projects' }) }); },
});
