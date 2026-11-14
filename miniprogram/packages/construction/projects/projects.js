const api = require('../../../utils/api.js');
const { canAccessRoute } = require('../../../utils/identity-navigation.js');
const { decorateProject, decorateDetail, errorText, roleLabels, operationKey } = require('./projects-model.js');
const { decorate } = require('../chat/site-client');
const { loadSiteFont } = require('../lib/site-font');
const route = '/packages/construction/projects/projects';
function unlinkPreview(path) { try { wx.getFileSystemManager().unlink({ filePath: path, fail() {} }); } catch (_) { /* Native temp file. */ } }
function identity() {
  const g = getApp().globalData || {}, c = (g.bootstrap && g.bootstrap.current && g.bootstrap.current.context) || g.userInfo || {};
  return { key: [c.enterpriseId, c.staffId].filter(Boolean).join(':'), token: g.token || wx.getStorageSync('token'), bootstrap: g.bootstrap || g.userInfo,
    name: c.staffDisplayName || (g.userInfo && g.userInfo.nickname) || '员工',
    portalLabel: ({ designer: '设计端', construction_staff: '施工端', enterprise_admin: '经营端' })[c.staffRole || (g.bootstrap && g.bootstrap.current && g.bootstrap.current.role)] || '项目协作' };
}
function navigationMetrics() {
  const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
  let capsule; try { capsule = wx.getMenuButtonBoundingClientRect(); } catch { /* Use the same safe fallback as onboarding. */ }
  return { navTop: Math.max(info.statusBarHeight || 24, (capsule && capsule.top || 30) - 6), navHeight: capsule && capsule.height || 32,
    navRight: Math.max(96, info.windowWidth - (capsule && capsule.left || info.windowWidth - 94) + 10) };
}
Page({
  data: { navTop: 24, navHeight: 32, navRight: 96, name: '', loading: true, error: '', items: [], detail: null, projectId: '',
    pending: null, busy: false, sheet: '', staffOptions: [], roleOptions: [], selectedStaff: 0, selectedRole: 0, selectedStage: 0,
    workLabel: '', note: '', sendReminder: false, selectedIds: [], primaryOptions: [], selectedPrimary: 0, assignmentOptions: [],
    sheetOpen: false, statusFilter: 'all', filteredItems: [], activeCount: 0, preview: null, previewPhotos: [], previewLoading: false, previewError: '',
    stageAnswer: null, stageAnswerBusy: false, stageAnswerError: '',
    reminders: [], reminderPaused: false, remindersLoading: false, remindersError: '' },
  onLoad() { loadSiteFont(); this.setData(navigationMetrics()); },
  async onShow() {
    this._visible = true;
    this.setData({ busy: false });
    const app = getApp();
    if (app.hydrateStoredSession) await app.hydrateStoredSession();
    if (!this._visible) return;
    const current = identity();
    if (!current.key || !current.token || !canAccessRoute(route, current.bootstrap)) {
      this.clearPreview();
      this._generation = (this._generation || 0) + 1; this._identityKey = null; this._token = null;
      this.setData({ loading: false, error: '请使用有工地权限的员工身份登录。', items: [], detail: null, pending: null, sheet: '' }); return;
    }
    if (current.key !== this._identityKey || current.token !== this._token) {
      this.clearPreview();
      this._identityKey = current.key; this._token = current.token;
      this._storageKey = 'construction:pending:' + current.key;
      this.setData({ projectId: '', detail: null, items: [], sheet: '', name: current.name, portalLabel: current.portalLabel, pending: wx.getStorageSync(this._storageKey) || null });
    }
    await this.load();
  },
  onHide() { this._visible = false; this._generation = (this._generation || 0) + 1; this.clearPreview(); clearTimeout(this._sheetTimer); this.setData({ sheet: '', sheetOpen: false }); },
  onUnload() { this.onHide(); },
  current(g) { const c = identity(); return this._visible && this._token === c.token && this._identityKey === c.key && canAccessRoute(route, c.bootstrap) && (g == null || g === this._generation); },
  async onPullDownRefresh() { try { await this.load(); } finally { wx.stopPullDownRefresh(); } },
  async load(quiet = false) {
    if (!this.current()) return;
    const g = this._generation = (this._generation || 0) + 1, pid = this.data.projectId;
    if (quiet !== true) this.setData({ loading: true, error: '' });
    try {
      const response = await api.request('/miniprogram/construction/projects' + (pid ? '/' + pid : ''), 'GET');
      if (!this.current(g)) return;
      const data = response.data;
      if (pid) { this.setData({ detail: decorateDetail(data) }); void this.loadPreview(g); void this.loadReminders(g); }
      else { const items = data.items.map(p => decorateProject(p, data.stages || [])); this.clearPreview();
        this.setData({ items, owner: data.owner, detail: null, managementBrief: data.collaboration && (data.owner || items.some(p => p.my_role === 'manager')), activeCount: items.filter(p => p.status === 'active').length,
          filteredItems: items.filter(p => this.data.statusFilter !== 'active' || p.status === 'active'),
          canBrief: data.owner || data.items.some(p => p.status !== 'archived') }); }
    } catch (error) { if (this.current(g)) { this.clearPreview(); this.setData({ error: errorText(error), detail: null, items: [], filteredItems: [] }); } }
    finally { if (this.current(g)) this.setData({ loading: false }); }
  },
  chooseStatus(e) { const statusFilter = e.currentTarget.dataset.status; if (!['all','active'].includes(statusFilter)) return;
    this.setData({ statusFilter, filteredItems: this.data.items.filter(p => statusFilter !== 'active' || p.status === 'active') }); },
  openProject(e) { if (this.data.busy || this.data.pending || !this.current()) return; this.clearPreview(); this.setData({ projectId: String(e.currentTarget.dataset.id), detail: null, stageAnswer: null, stageAnswerError: '' }); this.load(); },
  async loadReminders(g) {
    const pid = this.data.projectId;
    if (!pid || !this.current(g)) return;
    this.setData({ remindersLoading: true, remindersError: '' });
    try {
      const response = await api.request('/miniprogram/xiaok/reminders?projectId=' + encodeURIComponent(pid), 'GET');
      if (!this.current(g) || this.data.projectId !== pid) return;
      const labels = { pending: '待发送', delivered: '已送达', failed: '发送失败', paused: '已暂停' };
      this.setData({ reminders: (response.data.items || []).map(item => ({ ...item, statusLabel: labels[item.status] || item.status })),
        reminderPaused: !!response.data.paused });
    } catch (error) {
      if (this.current(g) && this.data.projectId === pid) this.setData({ remindersError: errorText(error) });
    } finally {
      if (this.current(g) && this.data.projectId === pid) this.setData({ remindersLoading: false });
    }
  },
  async toggleReminders() {
    const pid = this.data.projectId, g = this._generation;
    if (!pid || !this.current(g) || this.data.busy || this.data.pending || this.data.remindersLoading) return;
    this.setData({ remindersLoading: true, remindersError: '' });
    try {
      await api.request('/miniprogram/xiaok/reminders', 'POST', { projectId: pid, action: this.data.reminderPaused ? 'resume' : 'pause' });
      if (this.current(g)) await this.loadReminders(g);
    } catch (error) {
      if (this.current(g)) this.setData({ remindersError: errorText(error) });
    } finally {
      if (this.current(g)) this.setData({ remindersLoading: false });
    }
  },
  async askStageKnowledge() {
    if (!this.current() || this.data.busy || this.data.pending || this.data.stageAnswerBusy || !this.data.detail) return;
    const g = this._generation;
    this.setData({ stageAnswerBusy: true, stageAnswerError: '' });
    try {
      const response = await api.request('/miniprogram/xiaok/stage-answer', 'POST',
        { projectId: this.data.projectId, question: '本阶段需要关注什么？' });
      if (this.current(g)) this.setData({ stageAnswer: response.data });
    } catch (error) {
      if (this.current(g)) this.setData({ stageAnswerError: errorText(error) });
    } finally {
      if (this.current(g)) this.setData({ stageAnswerBusy: false });
    }
  },
  openSiteCamera(e) { const p = this.data.items.find(p => p.id === String(e.currentTarget.dataset.id));
    if (this.current() && !this.data.busy && !this.data.pending && p?.status === 'active') wx.navigateTo({ url: '/packages/construction/camera/camera?projectId=' + encodeURIComponent(p.id) }); },
  openSiteChat(e) { const p = this.data.items.find(p => p.id === String(e.currentTarget.dataset.id));
    if (this.current() && !this.data.busy && !this.data.pending && p && p.status !== 'archived') wx.navigateTo({ url: '/packages/construction/chat/chat?projectId=' + encodeURIComponent(p.id) }); },
  releasePreviewPhotos() { (this._previewPaths || []).forEach(unlinkPreview); this._previewPaths = []; },
  clearPreview() { clearTimeout(this._previewTimer); this._previewEpoch = (this._previewEpoch || 0) + 1; this.releasePreviewPhotos();
    this.setData({ preview: null, previewPhotos: [], previewLoading: false, previewError: '' }); },
  refreshPreview() { if (this.current()) return this.loadPreview(this._generation); },
  async loadPreview(g) {
    clearTimeout(this._previewTimer); const pid = this.data.projectId, epoch = this._previewEpoch = (this._previewEpoch || 0) + 1;
    if (!pid || !this.current(g) || !this.data.detail || this.data.detail.project.status === 'archived') return;
    const projectPath = '/miniprogram/construction/projects/' + encodeURIComponent(pid);
    const valid = () => this.current(g) && epoch === this._previewEpoch && this.data.projectId === pid;
    this.setData({ previewLoading: true, previewError: '' });
    const paths = [];
    try {
      const response = await api.request(projectPath + '/chat?limit=30', 'GET', {}, { suppressUnauthorized: true });
      if (!valid()) return;
      const rows = (response.data.items || []).filter(i => i.record?.id);
      const latest = rows.sort((a,b) => Date.parse(b.message.created_at) - Date.parse(a.message.created_at))[0];
      const preview = latest ? decorate(latest) : null, previewPhotos = [];
      for (const media of (preview?.record.media || []).slice(0,2)) {
        if (!/^[1-9]\d*$/.test(String(media.id)) || typeof api.downloadFile !== 'function') continue;
        const file = await api.downloadFile(projectPath + '/chat/media/' + media.id, { suppressUnauthorized: true });
        paths.push(file.tempFilePath);
        if (!valid()) { paths.forEach(unlinkPreview); return; }
        previewPhotos.push({ id: String(media.id), path: file.tempFilePath });
      }
      this.releasePreviewPhotos(); this._previewPaths = paths;
      this.setData({ preview, previewPhotos, previewLoading: false });
      this._previewTimer = setTimeout(() => {
        if (valid() && this.data.detail?.progress && !this.data.pending && !this.data.busy) void this.load(true);
        else if (valid()) void this.loadPreview(g);
      }, 15000); this._previewTimer?.unref?.();
    } catch (error) {
      paths.forEach(unlinkPreview);
      if (!valid()) return;
      this.releasePreviewPhotos();
      const restricted = [401, 403, 404].includes(error.statusCode);
      this.setData({ preview: null, previewPhotos: [], previewLoading: false, previewError: restricted ? '现场记录或照片暂不可用。' : errorText(error) });
      if (!restricted) return;
      // A missing photo or closed conversation does not determine access to the project itself.
      this.setData({ loading: true, detail: null, sheet: '', sheetOpen: false });
      try {
        const response = await api.request(projectPath, 'GET', {}, { suppressUnauthorized: true });
        if (valid()) this.setData({ detail: decorateDetail(response.data) });
      } catch (detailError) {
        if (valid()) this.setData({ items: [], filteredItems: [], error: errorText(detailError) });
      } finally { if (valid()) this.setData({ loading: false }); }
    }
  },
  previewPhoto(e) { if (this.current() && this.data.previewPhotos.some(p => p.path === e.currentTarget.dataset.path)) wx.previewImage({ current: e.currentTarget.dataset.path, urls: this.data.previewPhotos.map(p => p.path) }); },
  openManagement() { if (this.data.detail?.manage && !this.data.busy && !this.data.pending) this.showSheet({ sheet: 'manage' }); },
  openStageList() { if (this.data.detail && !this.data.busy) this.showSheet({ sheet: 'stages' }); },
  openMembers() { if (this.data.detail && !this.data.busy) this.showSheet({ sheet: 'members' }); },
  back() {
    if (this.data.projectId) { this.clearPreview(); this.setData({ projectId: '', detail: null, sheet: '' }); this.load(); }
    else wx.switchTab({ url: '/pages/mine/mine' });
  },
  openMine() { wx.switchTab({ url: '/pages/mine/mine' }); },
  openBrief() { if (this.current() && this.data.canBrief && !this.data.pending) wx.navigateTo({ url: this.data.managementBrief ? '/packages/construction/brief/brief' : '/packages/assistant/chat/chat?followup=1' }); },
  openChat() { const project = this.data.detail?.project;
    if (this.current() && project && project.status !== 'archived' && !this.data.busy && !this.data.pending) wx.navigateTo({ url: '/packages/construction/chat/chat?projectId=' + encodeURIComponent(project.id) }); },
  openIssue(e) {
    const id = String(e.currentTarget.dataset.id || ''), project = this.data.detail?.project;
    if (!this.current() || !/^[1-9]\d*$/.test(id) || !project || project.status === 'archived' || this.data.busy || this.data.pending) return;
    wx.navigateTo({ url: '/packages/construction/chat/chat?projectId=' + encodeURIComponent(project.id) + '&issueId=' + id + '&mode=review' });
  },
  openPlan(e) {
    const detail = this.data.detail, planId = String(e.currentTarget.dataset.id || '');
    const roomId = detail?.approvedPlans?.find(plan => plan.id === planId)?.roomId;
    if (!this.current() || !detail?.project || detail.project.status === 'archived' || this.data.busy || this.data.pending) return;
    const room = String(e.currentTarget.dataset.room || '').slice(0, 50);
    const scope = /^[1-9]\d*$/.test(String(roomId)) ? '&roomId=' + roomId
      : !planId && room ? '&room=' + encodeURIComponent(room) : '';
    if (scope) wx.navigateTo({ url: '/packages/construction/chat/chat?projectId=' + encodeURIComponent(detail.project.id) + '&mode=plan' + scope });
  },
  openCamera() { if (this.current() && this.data.detail && !this.data.busy && !this.data.pending && this.data.detail.project.status === 'active') wx.navigateTo({ url: '/packages/construction/camera/camera?projectId=' + encodeURIComponent(this.data.detail.project.id) }); },
  openIdentities() { wx.navigateTo({ url: '/packages/business/identity-switch/identity-switch' }); },
  showSheet(values) { clearTimeout(this._sheetTimer); const epoch = this._sheetEpoch = (this._sheetEpoch || 0) + 1; this.setData({ ...values, sheetOpen: false }); this._sheetTimer = setTimeout(() => { if (this._visible && epoch === this._sheetEpoch) this.setData({ sheetOpen: true }); }, 20); this._sheetTimer?.unref?.(); },
  closeSheet() { if (this.data.busy) return; clearTimeout(this._sheetTimer); const epoch = this._sheetEpoch = (this._sheetEpoch || 0) + 1; this.setData({ sheetOpen: false }); this._sheetTimer = setTimeout(() => { if (epoch === this._sheetEpoch) this.setData({ sheet: '' }); }, 260); this._sheetTimer?.unref?.(); },
  openProgress() {
    const d = this.data.detail; if (!d || !d.manage || this.data.pending) return;
    this.showSheet({ sheet: 'progress', selectedStage: Math.max(0, d.stages.findIndex(s => s.key === d.project.current_stage_key)), note: d.project.progress_note, sendReminder: false });
  },
  openMember() {
    const d = this.data.detail; if (!d || !d.manage || this.data.pending) return;
    this.showSheet({ sheet: 'member', staffOptions: d.staff.map(s => ({ ...s, label: `${s.display_name || '员工'}${s.construction_trades.length ? ' · ' + s.construction_trades.join('/') : ''}` })),
      roleOptions: (d.owner ? ['worker', 'designer', 'observer', 'manager'] : ['worker', 'designer', 'observer']).map(key => ({ key, label: roleLabels[key] })), selectedStaff: 0, selectedRole: 0, workLabel: '' });
  },
  openAssignment(e) {
    const d = this.data.detail, stageKey = e.currentTarget.dataset.key;
    if (!d || !d.manage || this.data.pending) return;
    const a = d.assignments.filter(a => a.stage_key === stageKey), ids = a.map(a => a.admin_id);
    this.showSheet({ sheet: 'contact', stageKey, stageName: d.stages.find(s => s.key === stageKey).name,
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
