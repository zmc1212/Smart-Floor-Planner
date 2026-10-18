const { SiteClient, errorText } = require('./site-client');
const { canAccessRoute } = require('../../../utils/identity-navigation');
const route = '/packages/construction/chat/chat';
function identity() {
  const g = getApp().globalData || {}, context = g.bootstrap && g.bootstrap.current && g.bootstrap.current.context || {};
  return { key: [context.enterpriseId, context.staffId].filter(Boolean).join(':'), token: g.token || wx.getStorageSync('token'), bootstrap: g.bootstrap || g.userInfo };
}
function metrics() {
  const w = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync(); let capsule;
  try { capsule = wx.getMenuButtonBoundingClientRect(); } catch { /* Native safe fallback. */ }
  return { navTop: capsule && capsule.top || w.statusBarHeight || 24, navHeight: capsule && capsule.height || 32,
    navRight: Math.max(96, w.windowWidth - (capsule && capsule.left || w.windowWidth - 94) + 10), viewportHeight: w.windowHeight || 844 };
}
Page({
  data: { ...metrics(), keyboardHeight: 0, loading: true, busy: false, fatal: false, items: [], mediaPaths: {}, attachments: [], draft: '', sheet: '', edit: {}, roomOptions: [], selectedRoom: 0 },
  onLoad(options) {
    this.projectId = /^[1-9]\d*$/.test(String(options.projectId)) ? String(options.projectId) : '';
    this.client = new SiteClient({ identity, emit: patch => {
      if (!this._visible) return;
      if (patch.sheet === '' && this.data.sheet) { const copy = { ...patch }; delete copy.sheet; this.setData(copy); this.closeSheet(true); }
      else this.setData(patch);
      if (patch.items) this.setData({ scrollTarget: patch.items.length ? 'source-' + patch.items[patch.items.length - 1].message.id : '' });
    } });
  },
  async onShow() {
    this._visible = true;
    const app = getApp(); if (app.hydrateStoredSession) await app.hydrateStoredSession();
    if (!this._visible) return;
    const current = identity();
    if (!this.projectId || !current.key || !current.token || !canAccessRoute(route, current.bootstrap)) {
      this.setData({ loading: false, fatal: true, error: '请使用有工地权限的员工身份进入。', items: [], mediaPaths: {}, sheet: '' }); return;
    }
    const context = getApp().globalData.bootstrap?.current;
    const portalLabel = ({ designer: '设计端', construction_staff: '施工端', enterprise_admin: '经营端' })[context?.context?.staffRole || context?.role] || '项目协作';
    this.setData({ ...metrics(), sheet: '', keyboardHeight: 0, portalLabel });
    await this.client.show(this.projectId); this.poll();
  },
  onHide() { this._visible = false; this._record = null; clearTimeout(this._timer); clearTimeout(this._sheetTimer); if (this.client) this.client.hide(); this.setData({ items: [], mediaPaths: {}, sheet: '', sheetOpen: false, project: null, rooms: [], draft: '', edit: {}, versions: [], withdrawalReason: '', conflict: null, attachments: [], write: false }); },
  onUnload() { this.onHide(); },
  onResize() { if (!this.data.keyboardHeight) this.setData(metrics()); },
  poll() { clearTimeout(this._timer); if (!this._visible) return; this._timer = setTimeout(async () => { if (!this.client.state.busy && !this.data.sheet) await this.client.load(); this.poll(); }, 4000); },
  refresh() { return this.client.load(); }, older() { return this.client.load(true); },
  back() { wx.navigateBack({ fail: () => wx.redirectTo({ url: '/packages/construction/projects/projects' }) }); },
  input(e) { this.client.input(e.detail.value); }, send() { return this.client.send(); }, reconcile() { return this.client.reconcile(); },
  keyboard(e) { this.setData({ keyboardHeight: Math.max(0, e.detail.height || 0) }); },
  photo() {
    if (this.data.busy || this.data.pending || !this.data.write || this.data.attachments.length >= 4) return;
    const epoch = this.client.epoch;
    wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['camera', 'album'], sizeType: ['compressed'],
      success: async r => { const f = r.tempFiles && r.tempFiles[0]; if (!this.client.current(epoch)) return;
        if (!f || f.size > 4 * 1024 * 1024) { this.setData({ error: '请选择4MB以内的JPEG或PNG图片。' }); return; }
        await this.client.addPhoto(f.tempFilePath); },
      fail: e => { if (this.client.current(epoch) && !String(e.errMsg).includes('cancel')) this.setData({ error: '无法选择照片，请检查相机或相册权限后重试。' }); } });
  },
  removePhoto(e) { this.client.removePhoto(e.currentTarget.dataset.id); },
  async preview(e) {
    const epoch = this.client.epoch, id = String(e.currentTarget.dataset.id);
    try { const r = await this.client.download(this.client.mediaUrl(id), { suppressUnauthorized: true });
      if (!this.client.current(epoch)) { this.client.unlink(r.tempFilePath); return; } this.client.paths.add(r.tempFilePath); wx.previewImage({ urls: [r.tempFilePath] });
    } catch (error) { if (this.client.current(epoch)) this.setData({ error: errorText(error) }); }
  },
  voice() { wx.showToast({ title: '语音暂未接通，请发文字或照片', icon: 'none' }); },
  record(e) { return this.data.items.find(i => i.record.id === String(e.currentTarget.dataset.id))?.record; },
  openEdit(e) {
    const r = this.record(e); if (!r || !r.canEdit || this.data.busy || this.data.pending) return;
    const roomOptions = [{ id: '', name: '部位待核对 / 多房间' }, ...(this.data.rooms || [])];
    const source = this.data.items.find(i => i.record.id === r.id);
    this._record = r; this.openSheet('edit', { roomOptions, selectedRoom: Math.max(0, roomOptions.findIndex(room => room.id === r.data.roomId)),
      edit: { title: '现场施工进展', roomId: null, completed: '', pending: '', coordination: '', note: r.failed ? source.text.slice(0, 2000) : '', ...r.data } });
  },
  editInput(e) { this.setData({ ['edit.' + e.currentTarget.dataset.field]: e.detail.value }); },
  roomChange(e) { this.setData({ selectedRoom: Number(e.detail.value), 'edit.roomId': this.data.roomOptions[Number(e.detail.value)].id || null }); },
  saveEdit() { return this.client.mutate(this._record, 'edit', { data: this.data.edit }); },
  adoptLatest() {
    const latest = this.data.conflict;
    if (!latest || latest.id !== this._record?.id || !latest.canEdit || this.data.pending || this.data.busy) return;
    if ((this.data.sheet === 'publish' && latest.status !== 'draft') || (this.data.sheet === 'withdraw' && latest.status !== 'published')) { this.closeSheet(true); this.client.set({ conflict: null, error: '记录状态已变化，请从最新版重新选择操作。' }); return; }
    this._record = latest;
    if (this.data.sheet === 'publish') this.setData({ publishCustomer: false, publishCanCustomer: latest.canPublishCustomer && this.data.project.customerAccess });
    this.client.set({ conflict: null, error: '' });
  },
  openPublish(e) { const r = this.record(e); if (!r || !r.canEdit || r.status !== 'draft' || this.data.pending || this.data.busy) return;
    this._record = r; this.openSheet('publish', { publishCustomer: false, publishCanCustomer: r.canPublishCustomer && this.data.project.customerAccess }); },
  publishScope(e) { this.setData({ publishCustomer: e.detail.value }); },
  publish() { return this.client.mutate(this._record, 'publish', { audience: this.data.publishCustomer ? 'customer' : 'internal' }); },
  openWithdraw(e) { const r = this.record(e); if (!r || !r.canEdit || this.data.pending || this.data.busy) return; this._record = r; this.openSheet('withdraw', { withdrawalReason: '' }); },
  reason(e) { this.setData({ withdrawalReason: e.detail.value }); },
  withdraw() { if (this.data.withdrawalReason.trim()) return this.client.mutate(this._record, 'withdraw', { reason: this.data.withdrawalReason.trim() }); },
  retry(e) { const r = this.record(e); if (r && r.canRetry) return this.client.mutate(r, 'retry'); },
  async versions(e) {
    const r = this.record(e), epoch = this.client.epoch; if (!r || this.data.pending || this.data.busy) return;
    this.openSheet('versions', { versions: [], versionsLoading: true });
    try { const response = await this.client.request(this.client.base + '/records/' + r.id + '/versions', 'GET', {}, { suppressUnauthorized: true });
      if (this.client.current(epoch)) this.setData({ versions: response.data.items });
    } catch (error) { if (this.client.current(epoch)) this.setData({ error: errorText(error) }); }
    finally { if (this.client.current(epoch)) this.setData({ versionsLoading: false }); }
  },
  openSheet(sheet, patch = {}) { clearTimeout(this._sheetTimer); this.client.set({ conflict: null, error: '' }); this.setData({ ...patch, sheet, sheetOpen: false }); this._sheetTimer = setTimeout(() => { if (this._visible && this.data.sheet === sheet) this.setData({ sheetOpen: true }); }, 20); },
  closeSheet(force = false) { if (force !== true && (this.data.busy || this.data.pending)) return; clearTimeout(this._sheetTimer); this.setData({ sheetOpen: false }); this._sheetTimer = setTimeout(() => { if (this._visible) this.setData({ sheet: '' }); }, 260); }, stop() {},
});
