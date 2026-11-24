const api = require('../../../utils/api');
const { canAccessRoute } = require('../../../utils/identity-navigation');
const { loadSiteFont } = require('../lib/site-font');
const { confirmInspectionPin } = require('../lib/inspection-location');
const { siteMessageTime, errorText } = require('../chat/site-client');

const route = '/packages/construction/inspection/inspection';
const base = '/miniprogram/construction/inspection';
const options = { suppressUnauthorized: true };
const modes = { required: '必须到场', onsite: '建议到场', remote: '可线上审核', manual: '待人工判断' };
const validId = value => /^[1-9]\d*$/.test(String(value || ''));
function session() {
  const global = getApp().globalData || {};
  const context = global.bootstrap?.current?.context || global.userInfo || {};
  return { bootstrap: global.bootstrap || global.userInfo,
    key: [context.enterpriseId, context.staffId || context.adminId].filter(Boolean).join(':'),
    token: global.token || wx.getStorageSync('token') };
}
function grouped(items) {
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.projectId)) groups.set(item.projectId, { id: item.projectId, name: item.projectName, items: [] });
    const stages = (item.stages || []).map(stage => stage.name).filter(Boolean).join('、');
    groups.get(item.projectId).items.push({ ...item, modeLabel: item.inspection.mode === 'onsite' && item.inspection.source === 'staff'
      ? '需到场' : modes[item.inspection.mode],
      meta: [item.author, siteMessageTime(item.submittedAt), stages,
        item.photoCount && item.photoCount + ' 张照片', item.hasVoice && '语音'].filter(Boolean).join(' · ') });
  }
  return [...groups.values()];
}
Page({
  data: { navTop: 24, navHeight: 32, navRight: 96, view: 'todo', groups: [], stops: [],
    loading: true, error: '', moreError: '', cursor: '', pinBusy: '', notice: '', stationOnly: false, onsiteOnly: false },
  onLoad(query) {
    this._projectId = validId(query.projectId) ? String(query.projectId) : '';
    this._onsite = Boolean(this._projectId && query.onsite === '1');
    this.setData({ stationOnly: Boolean(this._projectId), onsiteOnly: this._onsite });
    loadSiteFont();
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    let capsule;
    try { capsule = wx.getMenuButtonBoundingClientRect(); } catch { /* Native safe fallback. */ }
    this.setData({ navTop: Math.max(windowInfo.statusBarHeight || 24, capsule?.top || 46),
      navHeight: capsule?.height || 32, navRight: windowInfo.windowWidth - (capsule?.left || windowInfo.windowWidth - 94) + 10 });
  },
  async onShow() {
    this._visible = true;
    const app = getApp();
    if (app.hydrateStoredSession) await app.hydrateStoredSession();
    if (!this._visible) return;
    this._session = session();
    if (!this.current()) { this.setData({ error: '请使用有审核权限的员工身份登录。', loading: false }); return; }
    await this.load();
  },
  onHide() {
    this._visible = false;
    this._generation = (this._generation || 0) + 1;
    this._items = [];
    this.setData({ groups: [], stops: [], cursor: '', notice: '', loading: true, pinBusy: '' });
  },
  onUnload() { this.onHide(); },
  current(generation) {
    const actor = session();
    return this._visible && actor.token && actor.key && actor.key === this._session?.key && actor.token === this._session?.token
      && canAccessRoute(route, actor.bootstrap) && (generation === undefined || this._generation === generation);
  },
  async load(more = false) {
    if (!this.current()) return;
    const generation = this._generation = (this._generation || 0) + 1;
    const map = this.data.view === 'map';
    const query = [this._projectId && 'projectId=' + this._projectId, this._onsite && 'onsite=1',
      more && this.data.cursor && 'cursor=' + encodeURIComponent(this.data.cursor)].filter(Boolean).join('&');
    this.setData({ loading: !more, loadingMore: more, error: '', moreError: '', ...(more ? {} : { groups: [], stops: [] }) });
    try {
      const result = await api.request(base + (map ? '/stops' : query ? '?' + query : ''), 'GET', {}, options);
      if (!this.current(generation)) return;
      if (map) {
        this.setData({ stops: result.data, loading: false });
        return;
      }
      const current = more ? this._items : [];
      this._items = [...new Map([...current, ...result.data.items].map(item => [item.recordId, item])).values()];
      this.setData({ groups: grouped(this._items), cursor: result.data.nextCursor || '', loading: false, loadingMore: false });
    } catch (error) {
      if (!this.current(generation)) return;
      if (more && ![401, 403, 404].includes(error.statusCode)) {
        this.setData({ loadingMore: false, moreError: errorText(error) });
      } else {
        this._items = [];
        this.setData({ cursor: '', groups: [], stops: [], loading: false, loadingMore: false, error: errorText(error) });
      }
    }
  },
  retry() { return this.load(); },
  nextPage() { if (this.data.cursor && !this.data.loading && !this.data.loadingMore) return this.load(true); },
  async onPullDownRefresh() { try { await this.load(); } finally { wx.stopPullDownRefresh(); } },
  switchView(event) {
    const next = event.currentTarget.dataset.view;
    if (!['todo', 'map'].includes(next) || next === this.data.view || !this.current()) return;
    this.setData({ view: next, notice: '', cursor: '', pinBusy: '' });
    return this.load();
  },
  openRecord(event) {
    const { record, project } = event.currentTarget.dataset;
    if (this.current() && this._items?.some(item => item.recordId === record && item.projectId === project)) {
      wx.navigateTo({ url: '/packages/construction/inspection-record/inspection-record?projectId=' + project + '&recordId=' + record });
    }
  },
  openMap() {
    if (this.current() && this.data.stops.length) wx.navigateTo({ url: '/packages/construction/inspection-map/inspection-map' });
  },
  async setPin(event) {
    const stop = this.data.stops.find(item => item.projectId === event.currentTarget.dataset.project);
    if (!this.current() || !stop?.canSetPin || this.data.pinBusy) return;
    const generation = this._generation;
    this.setData({ pinBusy: stop.projectId, notice: '' });
    try {
      if (await confirmInspectionPin(stop, () => this.current(generation)) && this.current(generation)) {
        this.setData({ notice: '工地入口已保存。' });
        await this.load();
      }
    } catch (error) {
      if (this.current(generation)) {
        if ([401, 403, 404, 409].includes(error.statusCode)) await this.load();
        if (this.current()) this.setData({ notice: errorText(error) });
      }
    } finally { if (this.current()) this.setData({ pinBusy: '' }); }
  },
  back() { wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) }); },
});
