const api = require('../../../utils/api.js');
const { canAccessRoute } = require('../../../utils/identity-navigation.js');
const { decorateProject, decorateDetail, errorText, roleLabels, operationKey } = require('./projects-model.js');
const route = '/packages/construction/projects/projects';
function identity() {
  const g = getApp().globalData || {}, c = (g.bootstrap && g.bootstrap.current && g.bootstrap.current.context) || g.userInfo || {};
  return { key: [c.enterpriseId, c.staffId].filter(Boolean).join(':'), token: g.token || wx.getStorageSync('token'), bootstrap: g.bootstrap || g.userInfo,
    name: c.staffDisplayName || (g.userInfo && g.userInfo.nickname) || '员工',
    portalLabel: ({ designer: '设计端', construction_staff: '施工端', enterprise_admin: '经营端' })[c.staffRole || (g.bootstrap && g.bootstrap.current && g.bootstrap.current.role)] || '项目协作' };
}
function navigationMetrics() {
  const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
  let capsule; try { capsule = wx.getMenuButtonBoundingClientRect(); } catch { /* Use the same safe fallback as onboarding. */ }
  return { navTop: capsule && capsule.top || info.statusBarHeight || 24, navHeight: capsule && capsule.height || 32,
    navRight: Math.max(96, info.windowWidth - (capsule && capsule.left || info.windowWidth - 94) + 10) };
}
Page({
  data: { navTop: 24, navHeight: 32, navRight: 96, name: '', loading: true, error: '', items: [], detail: null, projectId: '',
    pending: null, busy: false, sheet: '', staffOptions: [], roleOptions: [], selectedStaff: 0, selectedRole: 0, selectedStage: 0,
    workLabel: '', note: '', sendReminder: false, selectedIds: [], primaryOptions: [], selectedPrimary: 0, assignmentOptions: [] },
  onLoad() { this.setData(navigationMetrics()); },
  async onShow() {
    this._visible = true;
    this.setData({ busy: false });
    const app = getApp();
    if (app.hydrateStoredSession) await app.hydrateStoredSession();
    if (!this._visible) return;
    const current = identity();
    if (!current.key || !current.token || !canAccessRoute(route, current.bootstrap)) {
      this._generation = (this._generation || 0) + 1; this._identityKey = null; this._token = null;
      this.setData({ loading: false, error: '请使用有工地权限的员工身份登录。', items: [], detail: null, pending: null, sheet: '' }); return;
    }
    if (current.key !== this._identityKey || current.token !== this._token) {
      this._identityKey = current.key; this._token = current.token;
      this._storageKey = 'construction:pending:' + current.key;
      this.setData({ projectId: '', detail: null, items: [], sheet: '', name: current.name, portalLabel: current.portalLabel, pending: wx.getStorageSync(this._storageKey) || null });
    }
    await this.load();
  },
  onHide() { this._visible = false; this._generation = (this._generation || 0) + 1; },
  onUnload() { this.onHide(); },
  current(g) { const c = identity(); return this._visible && this._token === c.token && this._identityKey === c.key && canAccessRoute(route, c.bootstrap) && (g == null || g === this._generation); },
  async onPullDownRefresh() { try { await this.load(); } finally { wx.stopPullDownRefresh(); } },
  async load() {
    if (!this.current()) return;
    const g = this._generation = (this._generation || 0) + 1, pid = this.data.projectId;
    this.setData({ loading: true, error: '' });
    try {
      const response = await api.request('/miniprogram/construction/projects' + (pid ? '/' + pid : ''), 'GET');
      if (!this.current(g)) return;
      const data = response.data;
      if (pid) this.setData({ detail: decorateDetail(data) });
      else this.setData({ items: data.items.map(p => decorateProject(p, data.stages || [])), owner: data.owner, detail: null });
    } catch (error) { if (this.current(g)) this.setData({ error: errorText(error), detail: null, items: [] }); }
    finally { if (this.current(g)) this.setData({ loading: false }); }
  },
  openProject(e) { if (this.data.busy) return; this.setData({ projectId: String(e.currentTarget.dataset.id), detail: null }); this.load(); },
  back() {
    if (this.data.projectId) { this.setData({ projectId: '', detail: null, sheet: '' }); this.load(); }
    else wx.switchTab({ url: '/pages/mine/mine' });
  },
  openMine() { wx.switchTab({ url: '/pages/mine/mine' }); },
  openChat() { if (this.data.detail && !this.data.busy && !this.data.pending) wx.navigateTo({ url: '/packages/construction/chat/chat?projectId=' + encodeURIComponent(this.data.detail.project.id) }); },
  openIdentities() { wx.navigateTo({ url: '/packages/business/identity-switch/identity-switch' }); },
  closeSheet() { if (!this.data.busy) this.setData({ sheet: '' }); },
  openProgress() {
    const d = this.data.detail; if (!d || !d.manage || this.data.pending) return;
    this.setData({ sheet: 'progress', selectedStage: Math.max(0, d.stages.findIndex(s => s.key === d.project.current_stage_key)), note: d.project.progress_note, sendReminder: false });
  },
  openMember() {
    const d = this.data.detail; if (!d || !d.manage || this.data.pending) return;
    this.setData({ sheet: 'member', staffOptions: d.staff.map(s => ({ ...s, label: `${s.display_name || '员工'}${s.construction_trades.length ? ' · ' + s.construction_trades.join('/') : ''}` })),
      roleOptions: (d.owner ? ['worker', 'designer', 'observer', 'manager'] : ['worker', 'designer', 'observer']).map(key => ({ key, label: roleLabels[key] })), selectedStaff: 0, selectedRole: 0, workLabel: '' });
  },
  openAssignment(e) {
    const d = this.data.detail, stageKey = e.currentTarget.dataset.key;
    if (!d || !d.manage || this.data.pending) return;
    const a = d.assignments.filter(a => a.stage_key === stageKey), ids = a.map(a => a.admin_id);
    this.setData({ sheet: 'contact', stageKey, stageName: d.stages.find(s => s.key === stageKey).name,
      assignmentOptions: d.members.filter(m => m.available).map(m => ({ ...m, selected: ids.includes(m.admin_id) })), selectedIds: ids });
    this.updatePrimaryOptions(ids, (a.find(a => a.is_primary) || {}).admin_id);
  },
  updatePrimaryOptions(ids, preferred) {
    const options = [{ id: '', label: '暂不指定' }, ...this.data.detail.members.filter(m => ids.includes(m.admin_id) && m.available).map(m => ({ id: m.admin_id, label: m.display_name }))];
    const chosen = ids.length === 1 ? ids[0] : preferred;
    this.setData({ primaryOptions: options, selectedPrimary: Math.max(0, options.findIndex(o => o.id === chosen)) });
  },
  onIds(e) { const ids = e.detail.value; const old = this.data.primaryOptions[this.data.selectedPrimary]; this.setData({ selectedIds: ids, assignmentOptions: this.data.assignmentOptions.map(m => ({ ...m, selected: ids.includes(m.admin_id) })) }); this.updatePrimaryOptions(ids, old && old.id); },
  onPicker(e) { const name = e.currentTarget.dataset.field; if (['selectedStage','selectedStaff','selectedRole','selectedPrimary'].includes(name)) this.setData({ [name]: Number(e.detail.value) }); },
  onInput(e) { const name = e.currentTarget.dataset.field; if (['note','workLabel'].includes(name)) this.setData({ [name]: e.detail.value }); },
  onReminder(e) { this.setData({ sendReminder: e.detail.value }); },
  async removeMember(e) {
    const member = this.data.detail.members.find(m => m.admin_id === String(e.currentTarget.dataset.id));
    if (!member || !member.canRemove || this.data.busy || this.data.pending) return;
    const g = this._generation;
    const accepted = await new Promise(resolve => wx.showModal({ title: '移出工地', content: `移出${member.display_name}后，同时撤销其阶段分工和电话入口。`, success: r => resolve(r.confirm), fail: () => resolve(false) }));
    if (accepted && this.current(g)) this.queue('member', { adminId: member.admin_id, role: member.role, active: false, workLabel: member.work_label });
  },
  submit() {
    const s = this.data, d = s.detail; if (!d || s.busy || s.pending) return;
    if (s.sheet === 'progress') return this.queue('progress', { stageKey: d.stages[s.selectedStage].key, note: s.note || '', sendReminder: s.sendReminder });
    if (s.sheet === 'contact') return this.queue('contact', { stageKey: s.stageKey, staffIds: s.selectedIds, primaryStaffId: (s.primaryOptions[s.selectedPrimary] || {}).id || null });
    if (s.sheet === 'member' && s.staffOptions[s.selectedStaff]) return this.queue('member', { adminId: s.staffOptions[s.selectedStaff].id, role: s.roleOptions[s.selectedRole].key, active: true, workLabel: s.workLabel });
    wx.showToast({ title: '请先选择员工', icon: 'none' });
  },
  queue(action, body) {
    if (!this.current()) return;
    const pending = { path: '/miniprogram/construction/projects/' + this.data.detail.project.id + '/' + action,
      body: { ...body, expectedVersion: this.data.detail.project.version }, key: operationKey(), identityKey: this._identityKey };
    try { wx.setStorageSync(this._storageKey, pending); } catch { wx.showToast({ title: '无法保留提交记录，请稍后重试', icon: 'none' }); return; }
    this.setData({ pending }); this.sendPending();
  },
  async sendPending() {
    const pending = this.data.pending;
    if (!pending || pending.identityKey !== this._identityKey || this.data.busy || !this.current()) return;
    const token = this._token, identityKey = this._identityKey;
    const accepts = () => this.current() && this._token === token && this._identityKey === identityKey;
    this.setData({ busy: true });
    try {
      const result = await api.request(pending.path, 'POST', pending.body, { headers: { 'Idempotency-Key': pending.key } });
      if (!result.data || !result.data.id || !Number.isInteger(result.data.version)) throw new Error('incomplete receipt');
      if (!accepts()) return;
      wx.removeStorageSync(this._storageKey); this.setData({ pending: null, sheet: '' });
      wx.showToast({ title: '工地资料已保存', icon: 'success' }); await this.load();
    } catch (error) {
      if (!accepts()) return;
      const knownFailure = error.statusCode >= 400 && error.statusCode < 500;
      if (knownFailure) { wx.removeStorageSync(this._storageKey); this.setData({ pending: null }); }
      wx.showToast({ title: knownFailure ? errorText(error) : '提交结果待核对，请核对同一次操作', icon: 'none' });
      if (knownFailure && [401, 403, 404, 409].includes(error.statusCode)) {
        if (error.statusCode !== 409) this.setData({ sheet: '', detail: null, items: [] });
        await this.load();
        if (!accepts()) return;
        if (!this.data.detail) this.setData({ sheet: '' });
        else if (this.data.sheet === 'progress' && pending.body.stageKey) {
          const index = this.data.detail.stages.findIndex(s => s.key === pending.body.stageKey);
          if (index < 0) this.setData({ sheet: '' });
          else this.setData({ selectedStage: index });
        }
      }
    } finally { if (accepts()) this.setData({ busy: false }); }
  },
  stop() {},
});
