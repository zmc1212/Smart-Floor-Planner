const { ChatController, initial } = require('../lib/chat');
const { goToLogin } = require('../../../utils/session');
const { MediaController } = require('../lib/media');
const { ReferenceImage } = require('../lib/reference-image');
const { RecommendationController, PortfolioImages } = require('../lib/portfolio');
const { NearbyLocationController } = require('../lib/location');
const { latestDesignerCard } = require('../lib/client');
const { SiteRecordMedia } = require('../lib/site-records');
const { PublicChatController, initialPublic } = require('../lib/public-sites');
const { PlanChatController, initialPlans } = require('../lib/plans');
const { SpeechController } = require('../lib/speech');

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
    latestDesignerMessageId: '', hasDesignerRecommendation: false,
    designerCardImages: {}, designerCardPortraits: {}, designerCardError: '',
  },

  onLoad(options) {
    this._options = options || {};
    this._alive = true;
    this.speechController = new SpeechController({ identity: sessionToken, emit: patch => { if (this._alive && this._shown) this.setData(patch); },
      getDraft: () => this.data.draft || '', setDraft: text => this.controller.input(text), reload: () => this.controller.refresh() });
    this.measureWindow();
    this.referenceImages = new ReferenceImage();
    this.siteRecords = new SiteRecordMedia({ identity: sessionToken, emit: patch => { if (this._alive && this._shown) this.setData(patch); } });
    this.recommendations = new RecommendationController({ identity: sessionToken, emit: patch => { if (this._alive) this.setData(patch); } });
    this._designerCardConversation = ''; this._designerCardKey = '';
    this.controller = new ChatController({
      identity: sessionToken,
      referenceImage: value => this.referenceImages.materialize(value),
      emit: patch => {
        if (!this._alive) return;
        if (patch.fatal || patch.needsLogin) this.speechController.hide();
        const previous = this.data.messages;
        this.setData(patch, () => {
          if (patch.fatal || patch.needsLogin) {
            this.siteRecords.clear();
            this.recommendations.clear();
            this.resetDesignerCards();
            if (this.publicSites) this.publicSites.clear();
            if (this.plans) this.plans.clear();
            this.referenceImages.clear();
            if (this.media) this.media.dispose(); this.media = null;
            this.setData({ mediaPaths: {}, mediaItems: [], sheet: '' });
          } else if (patch.messages) {
            if (this._shown) this.siteRecords.load(this.controller.conversationId, patch.messages);
            if (this._shown && this.publicSites) this.publicSites.load(this.controller.conversationId, this.data.enterpriseId, patch.messages);
            if (this._shown && this.plans) this.plans.load(this.controller.conversationId, patch.messages);
            if (this._shown) this.loadDesignerCards(patch.messages);
            this.loadMessageImages(patch.messages);
            const key = (this.data.conversation?.id || '') + ':' + (patch.messages[patch.messages.length - 1]?.id || '');
            if (this._shown && key !== this._portfolioKey) {
              this._portfolioKey = key;
              this.recommendations.load(patch.messages.length ? this.data.conversation?.id : null);
            }
          }
          if (patch.conversation === null) { this._portfolioKey = ''; this.recommendations.clear(); this.resetDesignerCards(); if (this.publicSites) this.publicSites.clear(); if (this.plans) this.plans.clear(); }
          const next = patch.messages;
          if (next && next.length && (!previous.length || next[next.length - 1].id !== previous[previous.length - 1].id)) {
            this.scrollBottom();
          }
        });
      },
    });
  },

  async onShow() {
    if (!this.location) this.location = new NearbyLocationController({ identity: sessionToken, client: this.controller.client });
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
      if (this._alive && this._shown && !this.data.fatal && this.controller.conversationId)
        await this.speechController.show('/miniprogram/assistant/conversations/' + this.controller.conversationId + '/speech');
      if (this._alive && this._shown && !this.data.fatal && !this.data.generating && !this.data.readOnly) await this.syncLocation();
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
  onHide() { this._shown = false; if (this.speechController) this.speechController.hide(); if (this.location) this.location.clear(); this.controller.hide(); this.siteRecords.clear(); this.recommendations.clear(); this.resetDesignerCards(); if (this.publicSites) this.publicSites.clear(); if (this.plans) this.plans.clear(); this.closeSheet(); this.setData({ speechBusy: false, keyboardHeight: 0, siteRecordPaths: {}, siteRecordError: '', ...initialPublic(), ...initialPlans() }); },
  onUnload() {
    this._alive = false; clearTimeout(this._sheetTimer);
    if (this.speechController) this.speechController.hide();
    if (this.location) this.location.clear();
    this.controller.dispose();
    this.siteRecords.clear();
    this.referenceImages.clear();
    this.recommendations.clear();
    this.resetDesignerCards();
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
  async send() {
    if (this.data.speechBusy) return;
    this.controller.speechInput = this.speechController?.binding();
    if (!this.data.conversation?.id && this.data.draft && this.data.canSend && !this.data.busy && !this.data.pendingSend && !this.data.pendingAction && !this.data.generating && !this.data.readOnly) {
      if (!await this.controller.handoffConversation()) return;
    }
    const location = await this.syncLocation();
    if (location.blocked) { this.setData({ portfolioNotice: location.notice }); return; }
    if (this._alive && this._shown) { const result = await this.controller.send(); if (!this.data.pendingSend && this.speechController?.visible) await this.speechController.afterSend(); return result; }
  },
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
  async voiceInput() {
    if (this.data.fatal || this.data.readOnly || this.data.busy || this.data.pendingSend || this.data.pendingAction || this.data.generating) return;
    const cid = this.controller.conversationId || await this.controller.handoffConversation(); if (!cid || !this._alive || !this._shown) return;
    const base = '/miniprogram/assistant/conversations/' + cid + '/speech';
    if (!this.speechController.visible || this.speechController.base !== base) await this.speechController.show(base);
    return this.speechController.microphone();
  },
  voiceMessage(event) { return this.speechController?.messageMenu(event.currentTarget.dataset.message); },
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
  async syncLocation(requestPermission = false) {
    const cid = this.data.conversation?.id, session = sessionToken();
    if (!cid || !this.location || this.data.generating || this.data.readOnly || this.data.busy || this.data.pendingSend || this.data.pendingAction || this.data.uncertainRun) return {};
    const result = await this.location.ensure(cid, requestPermission);
    if (!this._alive || !this._shown || cid !== this.data.conversation?.id || session !== sessionToken()) return {};
    if (result.changed) await this.controller.refresh();
    return result;
  },
  async loadDesigners() {
    if (this._locatingDesigners || this.data.busy || this.data.generating) return;
    this._locatingDesigners = true; this.setData({ portfolioLoading: true });
    try {
      const location = await this.syncLocation(true);
      if (!this._alive || !this._shown) return;
      if (!location.blocked) await this.recommendations.load(this.data.conversation?.id, true);
      if (location.notice && !this.data.portfolioItems.length) this.setData({ portfolioNotice: location.notice });
    } finally { this._locatingDesigners = false; if (this._alive && this._shown) this.setData({ portfolioLoading: false }); }
  },
  resetDesignerCards() {
    if (this.designerCardMedia) this.designerCardMedia.clear();
    this.designerCardMedia = null; this._designerCardConversation = ''; this._designerCardKey = '';
    if (this._alive) this.setData({ latestDesignerMessageId: '', hasDesignerRecommendation: false, designerCardImages: {}, designerCardPortraits: {}, designerCardError: '' });
  },
  async loadDesignerCards(messages) {
    if (!this._alive) return;
    const latest = latestDesignerCard(messages);
    const conversationId = this.controller.conversationId;
    if (this._designerCardConversation !== conversationId) {
      if (this.designerCardMedia) this.designerCardMedia.clear();
      this.designerCardMedia = conversationId ? new PortfolioImages(this.controller.client) : null;
      this._designerCardConversation = conversationId; this._designerCardKey = '';
      this.setData({ designerCardImages: {}, designerCardPortraits: {}, designerCardError: '' });
    }
    const key = latest ? String(latest.id) : '';
    this.setData({ latestDesignerMessageId: key, hasDesignerRecommendation: !!latest });
    if (key === this._designerCardKey) return;
    this._designerCardKey = key;
    if (!latest || !conversationId || !this.designerCardMedia) return;
    const owner = this.designerCardMedia, session = sessionToken();
    const valid = () => this._alive && owner === this.designerCardMedia && session === sessionToken()
      && this._designerCardKey === key && this.controller.conversationId === conversationId;
    for (const card of latest.designerRecommendation.items) {
      if (!this.data.designerCardImages['i' + card.work.coverAssetId]) {
        try {
          const filePath = await owner.load(conversationId, card.work, card.work.coverAssetId);
          if (!valid()) return;
          this.setData({ ['designerCardImages.i' + card.work.coverAssetId]: filePath });
        } catch (error) {
          if (!valid()) return;
          if ([401, 403, 404].includes(error.statusCode)) { this.setData({ designerCardImages: {}, designerCardPortraits: {} }); this._designerCardKey = ''; return; }
          this.setData({ designerCardError: '部分作品图片暂未加载，点此重试。' });
        }
      }
      if (card.portraitAvailable && !this.data.designerCardPortraits[card.authorId]) {
        try {
          const filePath = await owner.loadPortrait(conversationId, card.authorId);
          if (!valid()) return;
          this.setData({ ['designerCardPortraits.' + card.authorId]: filePath });
        } catch (_) { if (!valid()) return; }
      }
    }
  },
  retryDesignerCards() {
    this.setData({ designerCardError: '' });
    this._designerCardKey = '';
    return this.loadDesignerCards(this.data.messages);
  },
  openCardDesigner(event) {
    const data = event.currentTarget.dataset, id = this.controller.conversationId;
    if (!id || !/^[1-9]\d{0,18}$/.test(String(data.id))) return;
    wx.navigateTo({ url: `/packages/assistant/designer/designer?conversationId=${encodeURIComponent(id)}&authorId=${encodeURIComponent(data.id)}&sourceWorkId=${encodeURIComponent(data.work || '')}` });
  },
  openCardWork(event) {
    const data = event.currentTarget.dataset, id = this.controller.conversationId;
    if (!id || !/^[1-9]\d{0,18}$/.test(String(data.work)) || !/^[1-9]\d{0,18}$/.test(String(data.version))) return;
    wx.navigateTo({ url: `/packages/assistant/work/work?conversationId=${encodeURIComponent(id)}&workId=${encodeURIComponent(data.work)}&versionId=${encodeURIComponent(data.version)}` });
  },
  async browseSites() {
    const location = await this.syncLocation(true);
    if (!this._alive || !this._shown || location.blocked) return;
    if (!this.data.enterpriseId) return;
    const cid = this.controller.conversationId;
    const region = location.region;
    wx.navigateTo({ url: '/packages/construction/public-sites/public-sites?enterpriseId='+this.data.enterpriseId+(cid ? '&conversationId='+cid : '')
      +(region ? '&cityCode='+encodeURIComponent(region.cityCode)+'&district='+encodeURIComponent(region.district || '') : '') });
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
