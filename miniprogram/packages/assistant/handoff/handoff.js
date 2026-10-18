const { HandoffController, initial } = require('../lib/handoff');
const { MediaController } = require('../lib/media');
Page({
  data: { ...initial(), navigationTop: 47, navigationHeight: 44, navigationRight: 100, viewportHeight: 844, keyboardHeight: 0, staffScrollTarget: '', portalLabel: '设计师端', queueCounts: { waiting: 0, active: 0 }, mediaItems: [], mediaPaths: {}, mediaError: '', mediaLoading: false,
    tab: 'chat', queueTab: 'waiting', editor: '', fieldIndex: 0, sourceIndex: 0, editText: '', editNote: '',
    fieldLabels: ['房屋', '居住', '风格', '预算', '时间', '房间', '空间偏好', '用途', '频率', '设备'],
    candidateLabels: ['暂不关联'], candidateIndex: 0, roomLabels: ['完整户型'], roomIndex: 0,
    categoryLabels: ['暂不确定', '现场照片', '参考照片', '户型参考'], categoryIndex: 0, editRoom: '', editingMediaId: '', sourceLabels: [] },
  onLoad(options) {
    this.options = options || {}; this.alive = true;
    if (this.options.staff !== '1') {
      this.redirected = true;
      wx.redirectTo({ url: '/packages/assistant/chat/chat?conversationId=' + encodeURIComponent(this.options.conversationId || '') });
      return;
    }
    this.measureWindow();
    this.controller = new HandoffController({ identity: () => getApp().globalData.token || wx.getStorageSync('token') || '', emit: patch => {
      if (!this.alive) return;
      const view = { ...patch };
      if (Array.isArray(patch.items)) view.queueCounts = patch.items.reduce((counts, item) => { if (item.handoff && ['waiting', 'active'].includes(item.handoff.state)) counts[item.handoff.state]++; return counts; }, { waiting: 0, active: 0 });
      const last = patch.messages && patch.messages[patch.messages.length - 1];
      const nextMessage = last && last.id !== this._lastMessage;
      if (last) this._lastMessage = last.id;
      if (nextMessage) view.staffScrollTarget = '';
      this.setData(view, () => { if (nextMessage && this.alive) this.setData({ staffScrollTarget: 'staff-conversation-end' }); });
      if (patch.fatal || (patch.detail === null)) { this.clearMedia(); this.setData({ editor: '', editText: '', editNote: '', sourceLabels: [], candidateLabels: ['暂不关联'] }); }
      if (patch.candidates && !this.data.editor) this.prepareCandidates(patch.candidates);
      if (patch.detail?.handoff?.state === 'active' && this.data.tab === 'media' && !this.data.mediaLoading && !this.data.editor) this.openMedia();
    } });
  },
  async onShow() {
    if (this.redirected) return;
    this.setData({ editor: '', keyboardHeight: 0 });
    this.clearMedia();
    this.shown = true;
    const app = getApp(); if (app.globalData.sessionHydrationPromise) await app.globalData.sessionHydrationPromise;
    const current = app.globalData.bootstrap && app.globalData.bootstrap.current;
    this.setData({ portalLabel: current && (current.role === 'enterprise_admin' || current.context && current.context.staffRole === 'enterprise_admin') ? '经营端' : '设计师端' });
    if (this.media && this.media.session !== (app.globalData.token || wx.getStorageSync('token') || '')) this.clearMedia();
    if (this.alive && this.shown) await this.controller.show(this.options);
  },
  onHide() { this.shown = false; if (this.controller) this.controller.hide(); },
  onUnload() { this.alive = false; if (this.controller) this.controller.dispose(); if (this.media) this.media.dispose(); },
  onResize() { this.measureWindow(); },
  measureWindow() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    let capsule;
    try { capsule = wx.getMenuButtonBoundingClientRect(); } catch (_) { capsule = null; }
    const navigationHeight = Math.max(44, capsule && capsule.height || 32);
    this.setData({ navigationHeight, viewportHeight: info.windowHeight || this.data.viewportHeight,
      navigationTop: Math.max(info.statusBarHeight || 24, (capsule && capsule.top || info.statusBarHeight || 24) + ((capsule && capsule.height || 32) - navigationHeight) / 2),
      navigationRight: Math.max(96, info.windowWidth - (capsule && capsule.left || info.windowWidth - 96) + 10),
    });
  },
  openRequirements() { wx.navigateTo({ url: '/packages/assistant/requirements/requirements?conversationId=' + encodeURIComponent(this.controller.id) }); },
  async openMedia() {
    this.clearMedia();
    this.media = new MediaController({ identity: () => getApp().globalData.token || wx.getStorageSync('token') || '', emit: patch => { if (this.alive) this.setData(patch); } });
    const owner = this.media;
    await owner.load(this.controller.id, this.data.staff);
    if (!this.alive || owner !== this.media) return;
    for (const item of this.data.mediaItems) {
      const path = await owner.thumbnail(item.id);
      if (!this.alive || owner !== this.media) return;
      this.setData({ ['mediaPaths.' + item.id]: path });
    }
  },
  previewMedia(event) { return this.media && this.media.preview(event.currentTarget.dataset.id); },
  select(event) { this.clearMedia(); return this.controller.select(event.currentTarget.dataset.id); },
  clearMedia() { if (this.media) this.media.dispose(); this.media = null; this.setData({ mediaItems: [], mediaPaths: {}, mediaError: '', mediaLoading: false }); },
  queueTab(event) {
    if (this.data.busy || this.data.pending) return;
    this.setData({ queueTab: event.currentTarget.dataset.tab });
    if (this.controller.id) { this.clearMedia(); return this.controller.select(''); }
  },
  switchTab(event) { wx.hideKeyboard(); this.setData({ tab: event.currentTarget.dataset.tab, keyboardHeight: 0 }); if (this.data.tab === 'media') this.openMedia(); },
  keyboardChange(event) { this.setData({ keyboardHeight: Math.max(0, Number(event.detail.height) || 0), staffScrollTarget: 'staff-conversation-end' }); },
  voiceUnavailable() { wx.showToast({ title: '语音暂未接入，可以先用文字回复', icon: 'none' }); },
  jumpToMessage(event) {
    const id = event.currentTarget.dataset.id;
    if (!this.data.messages.some(m => m.id === id)) { wx.showToast({ title: '原话不在近期消息中，请先查看需求中的原文', icon: 'none' }); return; }
    this.setData({ tab: 'chat', staffScrollTarget: 'message-' + id });
  },
  moreActions() {
    if (this.data.busy || this.data.pending) return;
    wx.showActionSheet({ itemList: ['退出接待，回到等待', '结束接续，恢复小K'], success: r => {
      const release = r.tapIndex === 0;
      wx.showModal({ title: release ? '退出本次接待？' : '结束本次接续？', content: release ? '你将失去本次资料访问权限，客户回到等待接待，小K保持暂停。' : '你将失去本次资料访问权限，客户回到小K对话。',
        success: answer => { if (answer.confirm && this.alive) this.controller.act(release ? 'release' : 'end'); } });
    } });
  },
  prepareCandidates(candidates) {
    const previousId = this._candidates?.[this.data.candidateIndex - 1]?.id;
    this._candidates = candidates;
    const candidateIndex = previousId ? Math.max(0, candidates.findIndex(c => c.id === previousId) + 1) : 0;
    this.setData({ candidateLabels: ['暂不关联', ...candidates.map(c => `${c.name} · ${c.community || '服务档案'} #${c.id}${c.planName ? ' · ' + c.planName : ''}`)], candidateIndex,
      roomIndex: 0, roomLabels: ['完整户型', ...(candidates[candidateIndex - 1]?.rooms || []).map(r => r.name)] });
  },
  candidateChange(event) {
    if (this.data.busy || this.data.pending) return;
    const candidateIndex = Number(event.detail.value), c = this._candidates[candidateIndex - 1];
    this.setData({ candidateIndex, roomIndex: 0, roomLabels: ['完整户型', ...(c?.rooms || []).map(r => r.name)] });
  },
  roomChange(event) { if (!this.data.busy && !this.data.pending) this.setData({ roomIndex: Number(event.detail.value) }); },
  categoryChange(event) { if (!this.data.busy && !this.data.pending) this.setData({ categoryIndex: Number(event.detail.value) }); },
  fieldChange(event) { if (!this.data.busy && !this.data.pending) this.setData({ fieldIndex: Number(event.detail.value) }); },
  sourceChange(event) { if (!this.data.busy && !this.data.pending) this.setData({ sourceIndex: Number(event.detail.value) }); },
  editInput(event) { if (!this.data.busy && !this.data.pending) this.setData({ [event.currentTarget.dataset.key]: event.detail.value }); },
  editRequirements() {
    this._sources = this.data.messages.filter(m => m.authorKind === 'user' && m.text);
    this.setData({ editor: 'requirements', fieldIndex: 0, sourceIndex: 0, editText: '', editNote: '', sourceLabels: this._sources.map(m => m.text.slice(0, 80)) });
  },
  editMedia(event) {
    this.prepareCandidates(this.data.candidates);
    const id = event.currentTarget.dataset.id, annotation = this.data.detail.handoff.packet.mediaAnnotations?.[id];
    const candidateIndex = Math.max(0, this._candidates.findIndex(c => c.id === annotation?.leadId && c.floorPlanId === annotation?.floorPlanId) + 1);
    const rooms = this._candidates[candidateIndex - 1]?.rooms || [];
    this.setData({ editor: 'media', editingMediaId: id, editRoom: annotation?.roomName || '', candidateIndex,
      roomIndex: Math.max(0, rooms.findIndex(r => r.id === annotation?.roomId) + 1), roomLabels: ['完整户型', ...rooms.map(r => r.name)],
      categoryIndex: Math.max(0, ['', 'site', 'reference', 'floorplan'].indexOf(annotation?.category || '')) });
  },
  closeEditor() { if (!this.data.busy && !this.data.pending) this.setData({ editor: '', editText: '', editNote: '' }); },
  async saveEditor() {
    if (this.data.pending) { const result = await this.controller.act(this.data.pending); if (result && this.alive) this.closeEditor(); return result; }
    let result;
    if (this.data.editor === 'requirements') {
      const source = this._sources[this.data.sourceIndex];
      if (!source || !this.data.editText.trim()) { wx.showToast({ title: '请填写内容并选择客户原话', icon: 'none' }); return; }
      result = await this.controller.review('correct', { field: ['housing','household','style','budget','timeline','room','space','usage','frequency','devices'][this.data.fieldIndex],
        text: this.data.editText, note: this.data.editNote, sourceMessageId: source.id });
    } else {
      const c = this._candidates[this.data.candidateIndex - 1], room = c?.rooms[this.data.roomIndex - 1];
      result = await this.controller.review('associate', { mediaId: this.data.editingMediaId, category: ['', 'site', 'reference', 'floorplan'][this.data.categoryIndex],
        roomName: room?.name || this.data.editRoom, leadId: c?.id || null, floorPlanId: c?.floorPlanId || null, roomId: room?.id || null });
    }
    if (result && this.alive) this.closeEditor();
  },
  linkLead() {
    const c = this._candidates[this.data.candidateIndex - 1];
    wx.showModal({ title: '核对服务档案', content: c ? `${c.name} · ${c.community || ''} #${c.id}。仅关联本次咨询，不合并或改变档案归属。` : '取消本次咨询的档案关联？',
      success: r => { if (r.confirm && this.alive) this.controller.review('link', { leadId: c?.id || null }); } });
  },
  input(event) { this.controller.input(event.currentTarget.dataset.key, event.detail.value); },
  recipient(event) { this.controller.input('recipientIndex', Number(event.detail.value)); },
  lead(event) { this.controller.input('leadIndex', Number(event.detail.value)); },
  consent(event) { this.controller.input(event.currentTarget.dataset.key, !!event.detail.value.length); },
  action(event) { return this.controller.act(event.currentTarget.dataset.action); },
  retry() { return this.data.pending ? this.controller.act(this.data.pending) : this.controller.refresh(); },
  openChat() {
    const pages = getCurrentPages(), id = this.controller.id;
    const index = pages.findIndex(page => page.route === 'packages/assistant/chat/chat' && String(page.data.conversation?.id || '') === id);
    const fallback = () => wx.redirectTo({ url: '/packages/assistant/chat/chat?conversationId=' + encodeURIComponent(id) });
    if (index >= 0 && index < pages.length - 1) wx.navigateBack({ delta: pages.length - 1 - index, fail: fallback });
    else fallback();
  },
  appointment() {
    const d = this.data.detail; if (!d) return;
    if (d.appointmentNeedsArchive) wx.showModal({ title: '预约需要服务档案', content: '将打开已有的留资流程，由你填写并确认资料；不会自动创建档案或改变来源。', success: r => { if (r.confirm) wx.navigateTo({ url: d.appointmentUrl }); } });
    else wx.navigateTo({ url: d.appointmentUrl });
  },
  back() {
    if (this.data.pending || this.data.busy) { wx.showToast({ title: '请先确认本次操作结果', icon: 'none' }); return; }
    if (this.data.staff && this.controller.id) { this.clearMedia(); this.controller.id = ''; return this.controller.refresh(); }
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) });
  },
});
