const { SiteClient, errorText } = require('./site-client');
const { SiteCapture } = require('./site-capture');
const { SpeechController } = require('../../../utils/speech');
const { canAccessRoute } = require('../../../utils/identity-navigation');
const route = '/packages/construction/chat/chat';
function identity() {
  const g = getApp().globalData || {}, context = g.bootstrap && g.bootstrap.current && g.bootstrap.current.context || {};
  return { key: [context.enterpriseId, context.staffId].filter(Boolean).join(':'), token: g.token || wx.getStorageSync('token'), bootstrap: g.bootstrap || g.userInfo };
}
function metrics() {
  const w = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync(); let capsule;
  try { capsule = wx.getMenuButtonBoundingClientRect(); } catch { /* Native safe fallback. */ }
  return { navTop: Math.max(w.statusBarHeight || 24, (capsule && capsule.top || 30) - 6), navHeight: capsule && capsule.height || 32,
    navRight: Math.max(96, w.windowWidth - (capsule && capsule.left || w.windowWidth - 94) + 10), viewportHeight: w.windowHeight || 844 };
}
Page({
  data: { ...metrics(), keyboardHeight: 0, loading: true, busy: false, fatal: false, items: [], mediaPaths: {}, attachments: [], draft: '', resubmit: null, sheet: '', edit: {}, roomOptions: [], selectedRoom: 0,
    captureText: '', capturePhotos: [], captureVoice: null, captureQueue: [], captureSaving: false, captureSending: false, captureError: '', textMode: false,
    quickChoice: {}, quickWorks: [], quickRooms: [], quickRoomIndex: 0, progressOptions: [{ id: 'done', label: '做完了' }, { id: 'partial', label: '做了一部分' }, { id: 'not_started', label: '还没做' }, { id: 'unsure', label: '说不准' }] },
  onLoad(options) {
    this.speechController = new SpeechController({ identity: () => identity().token || '', emit: patch => { if (this._visible) this.setData(patch); },
      getDraft: () => this.data.draft || '', setDraft: value => this.client.input(value), reload: () => this.client.load(),
      captureAudio: result => this.capture.addFile(result.tempFilePath, 'voice', result.duration || 0) });
    this.projectId = /^[1-9]\d*$/.test(String(options.projectId)) ? String(options.projectId) : '';
    this._briefIssueId = /^[1-9]\d*$/.test(String(options.issueId)) ? String(options.issueId) : '';
    this.client = new SiteClient({ identity, emit: patch => {
      if (!this._visible) return;
      if (patch.fatal && this.speechController) this.speechController.hide();
      if (patch.fatal && this.capture?.visible) { if (patch.fatalStatus === 401) this.capture.hide(); else void this.capture.revoke(); }
      if (patch.sheet === '' && this.data.sheet) { const copy = { ...patch }; delete copy.sheet; this.setData(copy); this.closeSheet(true); }
      else this.setData(patch);
      if (patch.items) {
        if (this.capture?.visible) void this.capture.accepted(patch.items);
        const retake = this._retakeMessageId && patch.items.find(i => i.message.id === this._retakeMessageId && i.record.canResubmit);
        const queued = this.data.captureQueue[this.data.captureQueue.length - 1];
        this.setData({ scrollTarget: retake ? 'source-' + retake.message.id : queued ? 'capture-' + queued.key : patch.items.length ? 'source-' + patch.items[patch.items.length - 1].message.id : '' });
      }
    } });
    this.capture = new SiteCapture({ site: this.client, emit: patch => {
      if (!this._visible) return;
      this.setData(patch);
      if (patch.captureSubmitted) this.setData({ scrollTarget: 'capture-' + patch.captureSubmitted, textMode: false });
    } });
    this._networkChange = state => { if (state.isConnected && this._visible) void this.capture.flush(); };
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
    await this.client.show(this.projectId);
    if (this._visible && !this.data.fatal) { this.capture.show(); wx.onNetworkStatusChange?.(this._networkChange); void this.capture.flush(); }
    if (this._visible && !this.data.fatal) await this.speechController.show('/miniprogram/construction/projects/' + this.projectId + '/chat/speech');
    if (this._briefIssueId && !this.client.state.pending && this.client.state.write) {
      this._conversationInput = true; this.setData({ textMode: true }); this.client.input('事项' + this._briefIssueId + '现在在等谁？为什么？'); this._briefIssueId = '';
    }
    this.poll();
  },
  onHide() { this._visible = false; wx.offNetworkStatusChange?.(this._networkChange); this.capture?.hide(); if (this.speechController) this.speechController.hide(); this._retakeMessageId = null; this._record = null; clearTimeout(this._timer); clearTimeout(this._sheetTimer); if (this.client) this.client.hide(); this.setData({ speechBusy: false, items: [], mediaPaths: {}, sheet: '', sheetOpen: false, project: null, rooms: [], draft: '', edit: {}, versions: [], withdrawalReason: '', conflict: null, attachments: [], write: false, pendingRetakeCount: 0, pendingRetakeTarget: '', captureText: '', capturePhotos: [], captureVoice: null, captureQueue: [], captureError: '', textMode: false }); },
  onUnload() { this.onHide(); },
  onResize() { if (!this.data.keyboardHeight) this.setData(metrics()); },
  poll() { clearTimeout(this._timer); if (!this._visible) return; this._timer = setTimeout(async () => {
    const canRefresh = !this.data.sheet || (this.data.sheet === 'source' && !this.data.citationLoading);
    if (!this.client.state.busy && canRefresh) await this.client.load(); this.poll();
  }, 4000); },
  refresh() { return this.client.load(); }, older() { return this.client.load(true); },
  async openCitation(e) {
    const id = String(e.currentTarget.dataset.id), epoch = this.client.epoch;
    if (!/^[1-9]\d*$/.test(id) || this.data.busy || this.data.pending || this.data.fatal) return;
    this._citationId = id;
    this.client.set({ citation: null, citationLoading: true, citationError: '' });
    this.openSheet('source', { citation: null, citationLoading: true, citationError: '' });
    try {
      const response = await this.client.request(this.client.base + '/citations/' + id, 'GET', {}, { suppressUnauthorized: true });
      if (this.client.current(epoch) && !this.data.fatal && this._citationId === id && this.data.sheet === 'source') this.client.set({ citation: response.data });
    } catch (error) {
      if (this.client.current(epoch) && this._citationId === id) {
        this.client.set({ citation: null, citationError: errorText(error) });
        if ([401, 403, 404].includes(error.statusCode)) await this.client.load();
      }
    } finally { if (this.client.current(epoch) && this._citationId === id) this.client.set({ citationLoading: false }); }
  },
  retryCitation() { if (this._citationId) return this.openCitation({ currentTarget: { dataset: { id: this._citationId } } }); },
  back() { wx.navigateBack({ fail: () => wx.redirectTo({ url: '/packages/construction/projects/projects' }) }); },
  input(e) { if (this.data.resubmit || this.data.draft || this.data.attachments.length || this._conversationInput) this.client.input(e.detail.value); else this.capture.input(e.detail.value); },
  async send() { if (this.data.speechBusy || this.data.captureSaving) return;
    if (!this.data.resubmit && !this.data.draft && !this.data.attachments.length && !this._conversationInput) return this.capture.submit();
    this.client.speechInput = this.speechController?.binding(); const result = await this.client.send(); if (!this.data.pending) this._conversationInput = false; return result; },
  retryCapture() { return this.capture.flush(); },
  typeReport() { if (this.data.write && !this.data.fatal) this.setData({ textMode: true, inputFocus: true }); },
  removeCapture(e) { return this.capture.removeFile(String(e.currentTarget.dataset.id)); },
  previewCapture(e) { const path = e.currentTarget.dataset.path; if (path && this._visible) wx.previewImage({ urls: [path] }); },
  playCapture(e) { const path = e.currentTarget.dataset.path || this.data.captureVoice?.path; if (path && this._visible) this.speechController.playLocal(path); },
  openQuickWork() {
    if (!this.data.write || this.data.fatal || this.data.busy || this.data.pending || this.data.resubmit) return;
    wx.hideKeyboard?.(); this.setData({ inputFocus: false });
    const quickRooms = [{ id: '', name: '请选择部位', location: null }, ...this.data.rooms.map(r => ({ ...r, location: null })), { id: null, name: '全屋', location: 'whole' }, { id: null, name: '部位待核对', location: 'unsure' }];
    const q = this.data.quickChoice;
    if (q.workId && !this.data.quickWorks.some(w => w.id === q.workId)) this.capture.choose({ workId: '' });
    this.openSheet('quick', { quickRooms, quickRoomIndex: Math.max(0, quickRooms.findIndex(r => r.id === q.roomId && r.location === q.location)), captureError: '' });
  },
  selectQuickWork(e) { this.capture.choose({ workId: String(e.currentTarget.dataset.id) }); },
  selectQuickProgress(e) { this.capture.choose({ progress: String(e.currentTarget.dataset.id) }); },
  quickRoomChange(e) { const quickRoomIndex = Number(e.detail.value), room = this.data.quickRooms[quickRoomIndex]; if (room) { this.capture.choose({ roomId: room.id, location: room.location }); this.setData({ quickRoomIndex }); } },
  submitQuickWork() { if (this.capture.submit(true)) this.closeSheet(true); },
  quickToText() { this.closeSheet(true); this.typeReport(); },
  reconcile() { return this.client.reconcile(); },
  keyboard(e) { this.setData({ keyboardHeight: Math.max(0, e.detail.height || 0) }); },
  photo() {
    if (this.data.busy || this.data.pending || this.data.captureSaving || !this.data.write || (this.data.resubmit ? this.data.attachments.length : this.data.capturePhotos.length) >= 4) return;
    const epoch = this.client.epoch;
    wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['camera', 'album'], sizeType: ['compressed'],
      success: async r => { const f = r.tempFiles && r.tempFiles[0]; if (!this.client.current(epoch)) return;
        if (!f || f.size > 4 * 1024 * 1024) { this.setData({ error: '请选择4MB以内的JPEG或PNG图片。' }); return; }
        if (this.data.resubmit || this.data.attachments.length) await this.client.addPhoto(f.tempFilePath);
        else await this.capture.addFile(f.tempFilePath, 'photo'); },
      fail: e => { if (this.client.current(epoch) && !String(e.errMsg).includes('cancel')) this.setData({ error: '无法选择照片，请检查相机或相册权限后重试。' }); } });
  },
  removePhoto(e) { this.client.removePhoto(e.currentTarget.dataset.id); },
  async preview(e) {
    const epoch = this.client.epoch, id = String(e.currentTarget.dataset.id);
    try { const r = await this.client.download(this.client.mediaUrl(id), { suppressUnauthorized: true });
      if (!this.client.current(epoch)) { this.client.unlink(r.tempFilePath); return; } this.client.paths.add(r.tempFilePath); wx.previewImage({ urls: [r.tempFilePath] });
    } catch (error) { if (this.client.current(epoch)) this.setData({ error: errorText(error) }); }
  },
  voice() { if (!this.data.write || this.data.busy || this.data.pending || this.data.fatal || this.data.resubmit || this.data.captureSaving) return;
    if (this.data.captureVoice) return this.speechController.playLocal(this.data.captureVoice.path);
    return this.speechController.microphone(); },
  voiceMessage(event) { return this.speechController?.messageMenu(event.currentTarget.dataset.message); },
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
    if ((this.data.sheet === 'publish' && (latest.status !== 'draft' || !latest.canPublish)) || (this.data.sheet === 'withdraw' && latest.status !== 'published')
      || this.data.sheet === 'request_changes' && !latest.canRequestChanges) { this.closeSheet(true); this.client.set({ conflict: null, error: '记录状态已变化，请从最新版重新选择操作。' }); return; }
    this._record = latest;
    if (this.data.sheet === 'publish') this.setData({ publishCustomer: false, publishCanCustomer: latest.canPublishCustomer && this.data.project.customerAccess });
    this.client.set({ conflict: null, error: '' });
  },
  openPublish(e) { const r = this.record(e); if (!r || !r.canPublish || r.status !== 'draft' || this.data.pending || this.data.busy) return;
    this._record = r; this.openSheet('publish', { publishCustomer: false, publishCanCustomer: r.canPublishCustomer && this.data.project.customerAccess }); },
  publishScope(e) { this.setData({ publishCustomer: e.detail.value }); },
  publish() { return this.client.mutate(this._record, 'publish', { audience: this.data.publishCustomer ? 'customer' : 'internal' }); },
  openWithdraw(e) { const r = this.record(e); if (!r || !r.canEdit || this.data.pending || this.data.busy) return; this._record = r; this.openSheet('withdraw', { withdrawalReason: '' }); },
  reason(e) { this.setData({ withdrawalReason: e.detail.value }); },
  withdraw() { if (this.data.withdrawalReason.trim()) return this.client.mutate(this._record, 'withdraw', { reason: this.data.withdrawalReason.trim() }); },
  retry(e) { const r = this.record(e); if (r && r.canRetry) return this.client.mutate(r, 'retry'); },
  openRequestChanges(e) { const r = this.record(e); if (!r?.canRequestChanges || this.data.pending || this.data.busy) return;
    this._record = r; this.openSheet('request_changes', { reworkRequirements: '' }); },
  requirementsInput(e) { this.setData({ reworkRequirements: e.detail.value }); },
  requestChanges() { if (this.data.reworkRequirements.trim()) return this.client.mutate(this._record, 'request_changes', { requirements: this.data.reworkRequirements.trim() }); },
  beginResubmit(e) { this.client.beginResubmit(this.record(e)); },
  cancelResubmit() { this.client.cancelResubmit(); },
  showRetake() { const id = this.data.pendingRetakeTarget; if (!id) return; this._retakeMessageId = id;
    this.setData({ scrollTarget: '' }, () => { if (this._visible) this.setData({ scrollTarget: 'source-' + id }); }); },
  async versions(e) {
    const r = this.record(e), epoch = this.client.epoch; if (!r || this.data.pending || this.data.busy) return;
    this.openSheet('versions', { versions: [], versionsLoading: true });
    try { const response = await this.client.request(this.client.base + '/records/' + r.id + '/versions', 'GET', {}, { suppressUnauthorized: true });
      if (this.client.current(epoch)) { const versions = response.data.items.map(v => ({ ...v, key: (v.record_id || r.id) + '-' + v.version,
        originalText: (v.original_content?.blocks || []).map(b => b.text || b.fallbackText || '').join('\n') }));
        this.client.set({ versions }); await this.client.versionPhotos(versions, epoch); }
    } catch (error) { if (this.client.current(epoch)) this.setData({ error: errorText(error) }); }
    finally { if (this.client.current(epoch)) this.setData({ versionsLoading: false }); }
  },
  openSheet(sheet, patch = {}) { clearTimeout(this._sheetTimer); this.client.set({ conflict: null, error: '' }); this.setData({ ...patch, sheet, sheetOpen: false }); this._sheetTimer = setTimeout(() => { if (this._visible && this.data.sheet === sheet) this.setData({ sheetOpen: true }); }, 20); },
  closeSheet(force = false) { if (force !== true && (this.data.busy || this.data.pending)) return; if (this.data.sheet === 'source') { this._citationId = ''; this.client.set({ citation: null, citationLoading: false, citationError: '' }); } clearTimeout(this._sheetTimer); this.setData({ sheetOpen: false }); this._sheetTimer = setTimeout(() => { if (this._visible) this.setData({ sheet: '' }); }, 260); }, stop() {},
});
