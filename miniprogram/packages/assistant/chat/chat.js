const { ChatController, initial } = require('../lib/chat');
const { goToLogin } = require('../../../utils/session');
const { MediaController } = require('../lib/media');
const { ReferenceImage } = require('../lib/reference-image');
const { RecommendationController } = require('../lib/portfolio');
const { SiteRecordMedia } = require('../lib/site-records');
const { PublicChatController, initialPublic } = require('../lib/public-sites');
const { PlanChatController, initialPlans } = require('../lib/plans');

function sessionToken() {
  const app = getApp();
  return app.globalData.token || wx.getStorageSync('token') || '';
}

Page({
  data: {
    ...initial(), navigationTop: 47, navigationHeight: 44, navigationRight: 100,
    ...initialPublic(),
    ...initialPlans(),
    viewportHeight: 844, keyboardHeight: 0, sheet: '', sheetOpen: false,
    scrollTarget: '', prompts: ['水电开工前，我需要确认什么？', '装修报价里，哪些项目要问清楚？', '厨房用电需求，哪些要提前想好？'],
    mediaItems: [], mediaPaths: {}, mediaLoading: false, mediaBusy: false, mediaPending: false, mediaError: '', mediaKind: 0, mediaRoom: '',
    formalPlans: [], formalRooms: [], formalIndex: 0, formalRoomIndex: 0, mediaPendingFormal: false,
    portfolioItems: [], portfolioImages: {}, portfolioError: '', portfolioNotice: '', portfolioLoading: false,
  },

  onLoad(options) {
    this._options = options || {};
    this._alive = true;
    this.measureWindow();
    this.referenceImages = new ReferenceImage();
    this.siteRecords = new SiteRecordMedia({ identity: sessionToken, emit: patch => { if (this._alive && this._shown) this.setData(patch); } });
    this.recommendations = new RecommendationController({ identity: sessionToken, emit: patch => { if (this._alive) this.setData(patch); } });
    this.controller = new ChatController({
      identity: sessionToken,
      referenceImage: value => this.referenceImages.materialize(value),
      emit: patch => {
        if (!this._alive) return;
        const previous = this.data.messages;
        this.setData(patch, () => {
          if (patch.fatal || patch.needsLogin) {
            this.siteRecords.clear();
            this.recommendations.clear();
            if (this.publicSites) this.publicSites.clear();
            if (this.plans) this.plans.clear();
            this.referenceImages.clear();
            if (this.media) this.media.dispose(); this.media = null;
            this.setData({ mediaPaths: {}, mediaItems: [], sheet: '' });
          } else if (patch.messages) {
            if (this._shown) this.siteRecords.load(this.controller.conversationId, patch.messages);
            if (this._shown && this.publicSites) this.publicSites.load(this.controller.conversationId, this.data.enterpriseId, patch.messages);
            if (this._shown && this.plans) this.plans.load(this.controller.conversationId, patch.messages);
            this.loadMessageImages(patch.messages);
            const key = (this.data.conversation?.id || '') + ':' + (patch.messages[patch.messages.length - 1]?.id || '');
            if (this._shown && key !== this._portfolioKey) {
              this._portfolioKey = key;
              this.recommendations.load(patch.messages.length ? this.data.conversation?.id : null);
            }
          }
          if (patch.conversation === null) { this._portfolioKey = ''; this.recommendations.clear(); if (this.publicSites) this.publicSites.clear(); if (this.plans) this.plans.clear(); }
          const next = patch.messages;
          if (next && next.length && (!previous.length || next[next.length - 1].id !== previous[previous.length - 1].id)) {
            this.scrollBottom();
          }
        });
      },
    });
  },

  async onShow() {
    if (!this.plans) this.plans = new PlanChatController({ identity: sessionToken, client: this.controller.client, emit: p => { if (this._alive && this._shown) this.setData(p); } });
    if (!this.publicSites) this.publicSites = new PublicChatController({ identity: sessionToken, client: this.controller.client, emit: p => { if (this._alive && this._shown) this.setData(p); } });
    this._portfolioKey = '';
    this._shown = true;
    const app = getApp();
    if (app.globalData.sessionHydrationPromise) await app.globalData.sessionHydrationPromise;
    if (this.media && this.media.session !== sessionToken()) {
      this.media.dispose(); this.media = null;
      this.setData({ mediaItems: [], mediaPaths: {}, mediaPending: false, mediaBusy: false, mediaError: '' });
    }
    if (this._alive && this._shown) {
      await this.controller.show(this._options);
      if (this._alive && this._shown && !this.data.fatal && this._options.publicSiteId) {
        const cid = this.controller.conversationId || await this.controller.handoffConversation();
        if (cid && await this.publicSites.attach(cid, this.data.enterpriseId, this._options.publicSiteId, this._options.publicVersionId)) {
          delete this._options.publicSiteId; delete this._options.publicVersionId;
          await this.controller.refresh();
          if (this._options.findDesigner === '1') { delete this._options.findDesigner; await this.openHandoff(); }
        }
      }
      if (this._alive && this._shown && this._options.prompt && !this.data.draft && !this.data.pendingSend && !this.data.fatal) {
        this.controller.input(this._options.prompt); delete this._options.prompt;
      }
    }
  },
  onHide() { this._shown = false; this.controller.hide(); this.siteRecords.clear(); this.recommendations.clear(); if (this.publicSites) this.publicSites.clear(); if (this.plans) this.plans.clear(); this.closeSheet(); this.setData({ keyboardHeight: 0, siteRecordPaths: {}, siteRecordError: '', ...initialPublic(), ...initialPlans() }); },
  onUnload() {
    this._alive = false; clearTimeout(this._sheetTimer);
    this.controller.dispose();
    this.siteRecords.clear();
    this.referenceImages.clear();
    this.recommendations.clear();
    if (this.publicSites) this.publicSites.clear();
    if (this.plans) this.plans.clear();
    if (this.media) this.media.dispose();
  },
  onResize() { if (!this.data.keyboardHeight) this.measureWindow(); },
  measureWindow() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    let capsule;
    try { capsule = wx.getMenuButtonBoundingClientRect(); } catch (_) { capsule = null; }
    // Center the two-line brand beside the native capsule, never through it.
    const navigationHeight = Math.max(44, capsule && capsule.height || 32);
    const capsuleTop = capsule && capsule.top || info.statusBarHeight || 24;
    this.setData({
      viewportHeight: info.windowHeight,
      navigationTop: Math.max(info.statusBarHeight || 24, capsuleTop + ((capsule && capsule.height || 32) - navigationHeight) / 2),
      navigationHeight,
      navigationRight: Math.max(96, info.windowWidth - (capsule && capsule.left || info.windowWidth - 96) + 10),
    });
  },
  keyboardChange(event) { this.setData({ keyboardHeight: Math.max(0, Number(event.detail.height) || 0) }); this.scrollBottom(); },
  input(event) { this.controller.input(event.detail.value); },
  pickPrompt(event) { this.controller.input(event.currentTarget.dataset.text); },
  chooseOption(event) { return this.controller.chooseOption(event.currentTarget.dataset.key, event.currentTarget.dataset.text); },
  confirmOptions() { return this.controller.confirmOptions(); },
  send() { return this.controller.send(); },
  async planDecision(e) {
    const { id, action } = e.currentTarget.dataset;
    let reason = '';
    if (action === 'request-changes') {
      const result = await new Promise(resolve => wx.showModal({ title: '希望怎样修改', content: this.plans.reason(String(id)), editable: true, placeholderText: '说明需要调整的内容', success: resolve, fail: () => resolve({ confirm: false }) }));
      if (!result.confirm || !String(result.content || '').trim()) return;
      reason = String(result.content).trim();
    }
    if (await this.plans.decide(String(id), action, reason)) {
      if (action !== 'preview') await this.controller.refresh();
      this.scrollBottom();
    }
  },
  async retryPlan() { if (await this.plans.retry()) await this.controller.refresh(); },
  previewPlan(e) { return this.plans.preview(String(e.currentTarget.dataset.id)); },
  cancelSiteWatch(e) { return this.controller.cancelSiteWatch(e.currentTarget.dataset.message); },
  previewSiteRecord(e) { const d = e.currentTarget.dataset; return this.siteRecords.preview(String(d.record), Number(d.version), String(d.media)); },
  refresh() { return this.controller.refresh(); },
  login() { goToLogin(); },
  back() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) });
  },
  scrollBottom() {
    this.setData({ scrollTarget: '' }, () => this.setData({ scrollTarget: 'conversation-end' }));
  },
  openSheet(sheet) {
    wx.hideKeyboard(); clearTimeout(this._sheetTimer);
    this.setData({ sheet, sheetOpen: false, keyboardHeight: 0 }, () => {
      this._sheetTimer = setTimeout(() => this.setData({ sheetOpen: true }), 25);
    });
  },
  async openMedia() {
    if (this.data.mediaBusy) return;
    let id = this.data.conversation && this.data.conversation.id;
    if (!id) id = await this.controller.handoffConversation();
    if (!id || !this._alive) return;
    if (!this.media || this.media.id !== id) {
      if (this.media) this.media.dispose();
      this.media = new MediaController({ identity: sessionToken, emit: p => { if (this._alive) this.setData(p); } });
      this.setData({ formalPlans: [], formalRooms: [], formalIndex: 0, formalRoomIndex: 0, mediaRoom: '', mediaError: '' });
    }
    await this.media.load(id);
    if (!this.data.mediaError) this.pickImage();
  },
  mediaKind(event) { if (!this.data.mediaPending && !this.data.mediaBusy) this.setData({ mediaKind: Number(event.detail.value) }); },
  mediaRoom(event) { if (!this.data.mediaPending && !this.data.mediaBusy) this.setData({ mediaRoom: event.detail.value }); },
  async pickImage() {
    if (!this.media || this.data.mediaBusy || this.data.mediaPending || this.data.readOnly || !this.data.canSend) return;
    const owner = this.media, session = sessionToken();
    wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['compressed'],
      success: async result => {
        if (!this._alive || session !== sessionToken() || owner !== this.media) return;
        const file = result.tempFiles[0];
        if (!file || file.size > 4 * 1024 * 1024) { this.setData({ mediaError: '请选择4MB以内的JPEG或PNG图片。' }); return; }
        const ok = await owner.upload(file.tempFilePath, 'image', '');
        if (ok && this._alive) { await owner.load(owner.id); await this.controller.refresh(); }
      },
      fail: error => { if (this._alive && !String(error.errMsg).includes('cancel')) this.setData({ mediaError: '未能选择图片，请检查相册或相机权限后重试。' }); },
    });
  },
  async retryMedia() {
    if (!this.media) return;
    if (this.data.mediaPending) {
      const ok = this.data.mediaPendingFormal ? await this.media.attachFormal() : await this.media.upload();
      if (ok) { await this.media.load(this.media.id); await this.controller.refresh(); }
    } else await this.media.load(this.media.id);
  },
  previewMedia(event) { return this.media && this.media.preview(event.currentTarget.dataset.id); },
  loadFormalPlans() { return this.media && this.media.floorPlans(); },
  formalPlanChange(event) {
    const index = Number(event.detail.value);
    this.setData({ formalIndex: index, formalRoomIndex: 0, formalRooms: [{ id: '', name: '完整户型' }, ...(this.data.formalPlans[index]?.rooms || [])] });
  },
  formalRoomChange(event) { this.setData({ formalRoomIndex: Number(event.detail.value) }); },
  async attachFormal() {
    if (!this.media || this.data.mediaBusy || this.data.mediaPending) return;
    const plan = this.data.formalPlans[this.data.formalIndex], room = this.data.formalRooms[this.data.formalRoomIndex];
    if (!plan || !room) return;
    if (await this.media.attachFormal(plan, room.id)) { await this.media.load(this.media.id); await this.controller.refresh(); }
  },
  removeMedia(event) {
    const owner = this.media, id = event.currentTarget.dataset.id;
    wx.showModal({ title: '删除这张图片？', content: '删除后，本次会话和接待人将无法再次读取。', success: result => {
      if (result.confirm && this._alive && owner === this.media) owner.remove(id).then(() => this.controller.refresh());
    } });
  },
  closeSheet() {
    clearTimeout(this._sheetTimer);
    this.controller.citationRequest = (this.controller.citationRequest || 0) + 1;
    this.referenceImages.clear();
    this.controller.set({ citation: null });
    this.setData({ sheetOpen: false });
    this._sheetTimer = setTimeout(() => {
      if (this._alive) this.setData({ sheet: '' });
    }, 260);
  },
  swallow() {},
  async loadMessageImages(messages) {
    const id = this.controller.conversationId;
    if (!id || (!messages.some(m => m.mediaId) && !this.controller.client.pending.has('media:' + id) && !this.controller.client.pending.has('media-formal:' + id))) return;
    if (!this.media || this.media.id !== id) {
      if (this.media) this.media.dispose();
      this.setData({ mediaPaths: {} });
      this.media = new MediaController({ identity: sessionToken, emit: p => { if (this._alive) this.setData(p); } });
      await this.media.load(id);
    }
    const owner = this.media, session = sessionToken();
    for (const message of messages.filter(m => m.mediaId)) {
      const path = message.mediaAvailable ? await owner.thumbnail(message.mediaId) : '';
      if (!this._alive || owner !== this.media || session !== sessionToken()) return;
      this.setData({ ['mediaPaths.' + message.mediaId]: path });
    }
  },
  openHistory() { this.openSheet('history'); return this.controller.loadHistory(); },
  openRequirements() {
    if (!this.data.conversation || this.data.busy || this.data.pendingSend || this.data.pendingAction) return;
    wx.navigateTo({ url: '/packages/assistant/requirements/requirements?conversationId=' + encodeURIComponent(this.data.conversation.id) });
  },
  async openHandoff() {
    if (this.data.conversation && ['human', 'handoff_requested'].includes(this.data.conversation.mode)) return;
    return this.controller.handoff();
  },
  async contactKeeper(event) {
    const { project, message } = event.currentTarget.dataset;
    const phone = await this.controller.constructionContact(String(project), String(message));
    if (!phone || !this._alive || !this._shown) return;
    wx.makePhoneCall({ phoneNumber: phone, fail: error => {
      if (this._alive && !/cancel/i.test(error.errMsg || '')) wx.showToast({ title: '电话未拨出，请重试', icon: 'none' });
    } });
  },
  endHandoff() {
    const waiting = this.data.conversation?.mode === 'handoff_requested';
    wx.showModal({ title: waiting ? '取消等待？' : '结束接续？', content: '结束后设计师将无法继续查看本次咨询，小K恢复回复。',
      success: result => { if (result.confirm && this._alive) this.controller.handoff(waiting ? 'cancel' : 'end'); } });
  },
  voiceUnavailable() { wx.showToast({ title: '语音暂不可用，可以打字或发图', icon: 'none' }); },
  moreHistory() { return this.controller.loadHistory(true); },
  selectHistory(event) {
    if (this.data.mediaBusy || this.data.mediaPending) return;
    if (this.data.busy || this.data.pendingSend || this.data.pendingAction) return;
    this.closeSheet(); return this.controller.selectConversation(event.currentTarget.dataset.id);
  },
  newConversation() {
    if (this.data.mediaBusy || this.data.mediaPending) return;
    if (this.data.busy || this.data.pendingSend || this.data.pendingAction) return;
    this.closeSheet(); return this.controller.newConversation();
  },
  olderMessages() { return this.controller.olderMessages(); },
  stop() { return this.controller.action('cancel'); },
  retryRun() { return this.controller.action('retry'); },
  confirmAction() { return this.controller.action(this.data.pendingAction); },
  archive() {
    if (!this.data.conversation || this.data.busy || this.data.pendingSend || this.data.pendingAction) return;
    wx.showModal({
      title: '结束这段对话？', content: '正在生成的回答会停止，记录仍可在历史对话中查看。', confirmText: '结束对话',
      success: result => { if (result.confirm && this._alive) this.controller.action('archive'); },
    });
  },
  openCitation(event) {
    this._citationId = event.currentTarget.dataset.id;
    this.openSheet('citation'); return this.controller.openCitation(this._citationId);
  },
  retryCitation() { return this.controller.openCitation(this._citationId); },
  loadDesigners() { return this.recommendations.load(this.data.conversation?.id, true); },
  browseSites() {
    if (!this.data.enterpriseId) return;
    const cid = this.controller.conversationId;
    wx.navigateTo({ url: '/packages/construction/public-sites/public-sites?enterpriseId='+this.data.enterpriseId+(cid ? '&conversationId='+cid : '') });
  },
  openPublicSite(e) {
    const d = e.currentTarget.dataset;
    wx.navigateTo({ url: '/packages/construction/public-site/public-site?enterpriseId='+this.data.enterpriseId+'&siteId='+d.id+'&versionId='+d.version+(this.controller.conversationId ? '&conversationId='+this.controller.conversationId : '') });
  },
  async publicDecision(e) {
    const d = e.currentTarget.dataset;
    const ok = await this.publicSites.decide(d.key, d.action);
    if (ok && d.action !== 'preview') await this.controller.refresh();
  },
  laterPublic() { this.publicSites.later(); },
  async retryPublic() { if (this.data.publicPending) { if (await this.publicSites.retry()) await this.controller.refresh(); } else await this.controller.refresh(); },
  previewPublic(e) { return this.publicSites.media.preview(e.currentTarget.dataset.key); },
  openDesigner(event) {
    const item = this.data.portfolioItems.find(i => i.authorId === String(event.currentTarget.dataset.id));
    if (!item || !this.data.conversation) return;
    wx.navigateTo({ url: `/packages/assistant/designer/designer?conversationId=${encodeURIComponent(this.data.conversation.id)}&authorId=${item.authorId}&sourceWorkId=${item.work.id}` });
  },
  onShareAppMessage() {
    const token = this.data.shareReferenceEntry;
    return { title: '聊聊你的装修想法 · 家客来小K', path: token ? '/packages/assistant/chat/chat?referenceEntry=' + encodeURIComponent(token) : '/pages/index/index',
      imageUrl: '/packages/assistant/assets/xiaok-consultation.png' };
  },
});
