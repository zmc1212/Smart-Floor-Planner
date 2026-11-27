const { SiteClient, errorText, key, siteMessageTime } = require('../chat/site-client');
const { canAccessRoute } = require('../../../utils/identity-navigation');
const nativePreview = require('../../../utils/native-preview');
const { loadSiteFont } = require('../lib/site-font');
const { readInspectionFix } = require('../lib/inspection-location');

const route = '/packages/construction/inspection-record/inspection-record';
const validId = value => /^[1-9]\d*$/.test(String(value || ''));
const sheetTitles = { publish: '确认审核', request_changes: '退回补充', inspection_triage: '确认审核方式', edit: '修改整理内容', withdraw: '撤回发布' };
const statusLabels = { published: '审核通过', changes_requested: '需补充', withdrawn: '已撤回', draft: '待审核', organizing: '待审核' };
const reportStateLabels = { pending: '待生成', generated: '已生成', not_enabled: '未开通' };
const editFields = [{ key: 'title', label: '标题', limit: 80 }, { key: 'completed', label: '本次完成', limit: 1000 },
  { key: 'pending', label: '尚未完成', limit: 1000 }, { key: 'coordination', label: '待沟通', limit: 1000 }, { key: 'note', label: '补充说明', limit: 2000 }];
function identity() {
  const global = getApp().globalData || {}, context = global.bootstrap?.current?.context || global.userInfo || {};
  return { key: [context.enterpriseId, context.staffId || context.adminId].filter(Boolean).join(':'),
    token: global.token || wx.getStorageSync('token'), bootstrap: global.bootstrap || global.userInfo };
}

Page({
  data: { navTop: 24, navHeight: 32, navRight: 96, loading: true, item: null, error: '', mediaPaths: {},
    sheet: '', sheetTitle: '', editFields, note: '', busy: false, checking: false, pending: null, playing: false },
  onLoad(query) {
    loadSiteFont();
    this.projectId = validId(query.projectId) ? String(query.projectId) : '';
    this.recordId = validId(query.recordId) ? String(query.recordId) : '';
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    let capsule;
    try { capsule = wx.getMenuButtonBoundingClientRect(); } catch { /* Native safe fallback. */ }
    this.setData({ navTop: Math.max(info.statusBarHeight || 24, capsule?.top || 46), navHeight: capsule?.height || 32,
      navRight: info.windowWidth - (capsule?.left || info.windowWidth - 94) + 10 });
    this.client = new SiteClient({ identity, emit: patch => this.apply(patch) });
    this.client.reviewOnly = true;
    this.client.recordId = this.recordId;
  },
  apply(patch) {
    if (!this._visible) return;
    const next = {};
    for (const field of ['project', 'loading', 'error', 'fatal', 'mediaPaths', 'busy', 'pending', 'success', 'sheet', 'resubmit', 'draft', 'attachments', 'rooms']) {
      if (field in patch) next[field] = patch[field];
    }
    if ('items' in patch) {
      const item = patch.items[0], r = item?.record;
      next.item = r ? { ...item, statusLabel: r.resubmittedRecordId ? '已补交' : statusLabels[r.status],
        publication: r.publicationReceipt ? { ...r.publicationReceipt, dailyLabel: reportStateLabels[r.publicationReceipt.daily],
          weeklyLabel: reportStateLabels[r.publicationReceipt.weekly] } : null,
        stages: (r.stage_snapshot || []).map(stage => stage.name).join('、'),
        approvedAt: r.published_at ? siteMessageTime(r.published_at) : '' } : null;
    }
    if (patch.conflict) {
      this._target = null;
      next.sheet = '';
      next.error = '记录已更新。请核对当前内容后重新选择审核操作。';
    }
    this.setData(next);
  },
  async onShow() {
    this._visible = true;
    if (nativePreview.shownAfterPreview(this)) { await this.reload(); return; }
    const app = getApp();
    if (app.hydrateStoredSession) await app.hydrateStoredSession();
    if (!this._visible) return;
    const s = identity();
    if (!this.projectId || !this.recordId || !s.token || !s.key || !canAccessRoute(route, s.bootstrap)) {
      this.setData({ loading: false, error: '当前上报不可访问，请返回工地。' }); return;
    }
    await this.client.show(this.projectId);
    this.poll();
  },
  onHide(force) {
    if (force !== true && nativePreview.hiddenByPreview(this)) return;
    this._visible = false;
    this._target = null;
    clearTimeout(this._timer);
    this.stopVoice();
    this.client?.hide();
    this.setData({ item: null, sheet: '', playing: false, checking: false, success: '' });
  },
  onUnload() { this.onHide(true); },
  poll() {
    clearTimeout(this._timer);
    if (!this._visible || !this.data.item?.record.generating) return;
    this._timer = setTimeout(async () => { if (!this.data.busy && !this.data.sheet) await this.client.load(); this.poll(); }, 4500);
  },
  async reload() { await this.client.load(); this.poll(); },
  async onPullDownRefresh() { try { await this.reload(); } finally { wx.stopPullDownRefresh(); } },
  back() { wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) }); },
  preview(event) {
    const path = this.data.mediaPaths[event.currentTarget.dataset.id];
    if (path) nativePreview.previewImage({ current: path, urls: this.data.item.record.media.map(photo => this.data.mediaPaths[photo.id]).filter(Boolean) }, this);
  },
  async playVoice() {
    if (this._audio) { this.stopVoice(); return; }
    const epoch = this.client.epoch, speech = this.data.item?.record.speech;
    if (!speech?.id || this._audioLoading) return;
    this._audioLoading = true;
    try {
      const result = await this.client.download(this.client.base + '/speech/' + speech.id, { suppressUnauthorized: true });
      if (!this.client.current(epoch)) { this.client.unlink(result.tempFilePath); return; }
      this.client.paths.add(result.tempFilePath);
      const audio = this._audio = wx.createInnerAudioContext();
      audio.src = result.tempFilePath;
      audio.onEnded(() => this.stopVoice());
      audio.onError(() => { this.stopVoice(); this.client.set({ error: '语音暂时无法回听，请重试。' }); });
      audio.play();
      this.setData({ playing: true });
    } catch (error) { if (this.client.current(epoch)) this.client.set({ error: errorText(error) }); }
    finally { this._audioLoading = false; }
  },
  stopVoice() {
    if (!this._audio) return;
    this._audio.destroy();
    this._audio = null;
    if (this._visible) this.setData({ playing: false });
  },
  openAction(event) {
    const action = event.currentTarget.dataset.action, r = this.data.item?.record;
    if (!r || this.data.busy || this.data.pending || this.data.checking) return;
    const allowed = { publish: r.canPublish, request_changes: r.canRequestChanges, inspection_triage: r.canTriageInspection,
      edit: r.canEdit && r.canReview, withdraw: r.canEdit && r.canReview && r.status === 'published' };
    if (!allowed[action]) return;
    this._target = r;
    this.setData({ sheetTitle: sheetTitles[action], note: '', publishCustomer: false, edit: { ...r.data },
      roomChoices: [{ id: null, name: '部位待核对' }, ...(this.data.rooms || [])],
      roomIndex: Math.max(0, (this.data.rooms || []).findIndex(room => room.id === r.data.roomId) + 1),
      inspectionMode: r.inspection?.requiresOnsite ? 'onsite' : '', mustVisit: r.inspection?.requiresOnsite === true, pinned: r.hasInspectionPin });
    this.client.set({ sheet: action, error: '', conflict: null, success: '' });
  },
  closeSheet() {
    if (this.data.busy || this.data.pending || this.data.checking) return;
    this._target = null;
    this.client.set({ sheet: '', error: '' });
  },
  inputNote(e) { this.setData({ note: e.detail.value }); },
  pickMode(e) {
    const mode = e.currentTarget.dataset.mode;
    if (mode === 'onsite' || (mode === 'remote' && this._target?.inspection.mode !== 'required')) this.setData({ inspectionMode: mode });
  },
  pickAudience(e) { this.setData({ publishCustomer: e.detail.value }); },
  editInput(e) { this.setData({ ['edit.' + e.currentTarget.dataset.field]: e.detail.value }); },
  pickRoom(e) {
    const roomIndex = Number(e.detail.value);
    this.setData({ roomIndex, 'edit.roomId': this.data.roomChoices[roomIndex]?.id || null });
  },
  async confirm() {
    const r = this._target, action = this.data.sheet, note = this.data.note.trim();
    if (!r || this.data.busy || this.data.pending || this.data.checking) return;
    if (action === 'edit') return this.client.mutate(r, action, { data: this.data.edit });
    if (action === 'request_changes' && note) return this.client.mutate(r, action, { requirements: note });
    if (action === 'inspection_triage' && note && this.data.inspectionMode) return this.client.mutate(r, action, { mode: this.data.inspectionMode, reason: note });
    if (action === 'withdraw' && note) return this.client.mutate(r, action, { reason: note });
    if (action !== 'publish') return;
    const body = { audience: this.data.publishCustomer ? 'customer' : 'internal' };
    if (!this.data.mustVisit) return this.client.mutate(r, action, body);
    if (!note || !this.data.pinned) return;
    const epoch = this.client.epoch;
    this.client.set({ error: '' });
    this.setData({ checking: true });
    try {
      const fix = await readInspectionFix();
      if (!this.client.current(epoch)) return;
      const { data } = await this.client.request(this.client.base + '/records/' + r.id + '/inspection_checkin', 'POST',
        { ...fix, expectedVersion: r.version }, { suppressUnauthorized: true, headers: { 'Idempotency-Key': key() } });
      if (!this.client.current(epoch) || this._target !== r) return;
      if (!data?.token) throw Error('inspection_proof_required');
      await this.client.mutate(r, action, { ...body, inspection: { note, token: data.token } });
    } catch (error) {
      if (this.client.current(epoch)) {
        if ([401, 403, 404, 409].includes(error.statusCode)) {
          this.client.set({ sheet: '' }); this._target = null; await this.client.load(false, epoch);
        }
        if (this.client.current(epoch)) this.client.set({ error: errorText(error) });
      }
    } finally { if (this.client.current(epoch)) this.setData({ checking: false }); }
  },
  async reconcile() { await this.client.reconcile(); this.poll(); },
  beginRework() { this.client.beginResubmit(this.data.item?.record); },
  reworkInput(e) { this.client.input(e.detail.value); },
  pickPhoto() {
    if (this.data.busy || this.data.pending || this.data.attachments.length >= 4) return;
    const epoch = this.client.epoch;
    wx.chooseMedia({ count: 1, mediaType: ['image'], success: result => {
      const photo = result.tempFiles?.[0]?.tempFilePath;
      if (photo && this.client.current(epoch)) void this.client.addPhoto(photo);
    } });
  },
  removePhoto(e) { return this.client.removePhoto(e.currentTarget.dataset.id); },
  async sendRework() { await this.client.send(); this.poll(); },
  openRework() {
    const child = this.data.item?.record.resubmittedRecordId;
    if (validId(child)) wx.navigateTo({ url: route + '?projectId=' + this.projectId + '&recordId=' + child });
  },
  stop() {},
});
