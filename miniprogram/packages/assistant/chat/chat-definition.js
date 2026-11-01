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
const { FloorplanContextController, initialContext } = require('../lib/floorplan-context');
const { FollowupController, FollowupRecordMedia, initialFollowups } = require('../lib/followups');
const { initialEnterprise, enterpriseMethods } = require('../../../utils/assistant-followup-enterprise');
const { settingsPageMethods } = require('../../../utils/assistant-followup-settings');
const { historyPageMethods } = require('../../../utils/assistant-report-history');
const { planPageMethods } = require('../../../utils/assistant-report-plan');
const { FollowupChat, emptyFollowupChat, followupChatMethods } = require('../../../utils/assistant-followup-chat');
const { ReportQuestionController, reportQuestionMethods, emptyReportQuestion } = require('../lib/report-context');

function sessionToken() {
  const app = getApp();
  return app.globalData.token || wx.getStorageSync('token') || '';
}

module.exports = () => ({
  ...enterpriseMethods,
  ...settingsPageMethods,
  ...historyPageMethods,
  ...planPageMethods,
  ...followupChatMethods,
  ...reportQuestionMethods,
  data: {
    ...initial(), navigationTop: 47, navigationHeight: 44, navigationRight: 100,
    ...initialPublic(), reportQuestion: emptyReportQuestion(),
    ...initialPlans(),
    ...initialContext(),
    ...initialFollowups(), ...initialEnterprise(), followupChat: emptyFollowupChat(), followupScrollTarget: '', professionalFollowup: false, followupHistoryOpen: false, followupManageOpen: false, followupOriginalPaths: {}, followupOriginalError: '',
    viewportHeight: 844, keyboardHeight: 0, inputFocused: false, bottomInset: 34, sheet: '', sheetOpen: false,
    embedded: false, scrollTarget: '',
    topics: [
      { title: '旧房改造', helper: '从哪开始', icon: 'requirement-home', text: '旧房改造有哪些需要先考虑？' },
      { title: '装修风格', helper: '找找灵感', icon: 'requirement-style', text: '想聊聊适合我家的装修风格' },
      { title: '预算安排', helper: '先聊想法', icon: 'requirement-budget', text: '想聊聊装修预算怎么安排' },
    ],
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
            if (this.floorplans) this.floorplans.clear();
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
          if (patch.conversation === null) { if (this.floorplans) this.floorplans.clear(); this._portfolioKey = ''; this.recommendations.clear(); this.resetDesignerCards(); if (this.publicSites) this.publicSites.clear(); if (this.plans) this.plans.clear(); }
          if (patch.conversation?.id && this.floorplans && this._shown && this.floorplans.id !== String(patch.conversation.id)) this.floorplans.show(String(patch.conversation.id));
          if (patch.conversation !== undefined && !this.data.followupActive) this.syncReportQuestion();
          const next = patch.messages;
          if (next && next.length && (!previous.length || next[next.length - 1].id !== previous[previous.length - 1].id)) {
            this.scrollBottom();
          }
        });
      },
    });
    this.floorplans = new FloorplanContextController({ client: this.controller.client, identity: sessionToken,
      emit: patch => { if (this._alive) this.setData(patch); } });
    this.followups = new FollowupController({ client: this.controller.client, identity: sessionToken,
      headers: async () => {
        if (this._options.followup === '1') return {};
        const entry = await this.controller.ensureEntry(); return entry ? { 'X-Assistant-Entry': entry.entryToken } : {};
      },
      emit: patch => {
        if (!this._alive) return;
        const wasActive = this.data.followupActive;
        this.setData(patch, () => {
          if (wasActive && patch.followupActive === false && this._shown && !this.data.followupEnterpriseBusy) {
            if (this.data.professionalFollowup) { this.setData({ followupManageOpen: false, followupHistoryOpen: false }); this.back(); }
            else { this.controller.visible = true; this.setData({ followupManageOpen: false, followupHistoryOpen: false }); this.controller.refresh({ forceEntry: false, background: true }); }
          }
          if (patch.followupReports || patch.followupActive !== undefined) this.observeFollowupCards();
          if (patch.followupContext && patch.followupActive !== false) this.followupChatController?.open(patch.followupContext);
          if (patch.followupContext === null || patch.followupActive === false) this.followupChatController?.hide();
          if (patch.followupDetail && !patch.followupDetail.readAt) wx.nextTick(() => { if (this._alive && this._shown) this.followups.renderedReport(); });
          if (patch.followupOriginal === null && this.followupMedia) this.followupMedia.clear();
          if (patch.followupOriginal && this.followupMedia && this.data.followupDetail && (this.data.followupDetail.sourceContext || this.data.followupContext))
            this.followupMedia.loadOriginal(this.data.followupDetail.sourceContext || this.data.followupContext, this.data.followupDetail, patch.followupOriginal);
          if (patch.followupActive === false) this.syncReportQuestion();
        });
      } });
    this.followupChatController = new FollowupChat({ Controller: ChatController, Media: MediaController, client: this.controller.client, identity: sessionToken,
      referenceImage: value => this.referenceImages.materialize(value),
      headers: () => this.followups.headers(), emit: patch => { if (this._alive) this.setData(patch, () => this.syncReportQuestion()); } });
    this.reportQuestions = new ReportQuestionController({ client: this.controller.client, identity: sessionToken, headers: () => this.followups.headers(),
      emit: patch => { if (this._alive) this.setData(patch); }, openTopic: async id => {
        this.followups.leave(); this.closeSheet(); this.controller.visible = true; await this.controller.selectConversation(id);
      } });
    this.followupMedia = new FollowupRecordMedia({ identity: sessionToken, headers: () => this.followups.headers(), emit: patch => {
      if (this._alive) this.setData({ ...(patch.siteRecordPaths ? { followupOriginalPaths: patch.siteRecordPaths } : {}),
        ...(patch.siteRecordError !== undefined ? { followupOriginalError: patch.siteRecordError } : {}) });
    } });
  },

  async onShow() {
    if (!this.location) this.location = new NearbyLocationController({ identity: sessionToken, client: this.controller.client });
    if (!this.plans) this.plans = new PlanChatController({ identity: sessionToken, client: this.controller.client, emit: p => { if (this._alive && this._shown) this.setData(p); } });
    if (!this.publicSites) this.publicSites = new PublicChatController({ identity: sessionToken, client: this.controller.client, emit: p => { if (this._alive && this._shown) this.setData(p); } });
    this._portfolioKey = '';
    this._shown = true;
    const app = getApp();
    if (app.globalData.sessionHydrationPromise) await app.globalData.sessionHydrationPromise;
    const currentIdentity = app.globalData.bootstrap?.current?.context || app.globalData.userInfo || {};
    const selectedMode = app.globalData.bootstrap?.current?.mode || currentIdentity.mode;
    if (selectedMode === 'staff') this._options.followup = '1';
    else if (selectedMode === 'customer') { delete this._options.followup; this.setData({ professionalFollowup: false }); }
    if (this._options.followup === '1') {
      this.setData({ professionalFollowup: true, loading: false });
      this.prepareFollowupEnterprise(currentIdentity);
      if (this.data.followupPlatform && !currentIdentity.enterpriseId) { this.followups.hide(); this.setData({ followupActive: true }); return; }
      await this.followups.show({ autoOpen: true }); return;
    }
    if (this.media && this.media.session !== sessionToken()) {
      this.media.dispose(); this.media = null;
      this.setData({ mediaItems: [], mediaPaths: {}, mediaPending: false, mediaBusy: false, mediaError: '' });
    }
    if (this._alive && this._shown) {
      await this.controller.show(this._options);
      if (this._alive && this._shown && !this.data.fatal) await this.floorplans.show(this.controller.conversationId);
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
      if (this._alive && this._shown) await this.followups.show();
    }
  },
  onHide() { this._shown = false; this.followupChatController?.hide(); this._enterpriseEpoch = (this._enterpriseEpoch || 0) + 1; this.followups.hide(); if (this._followupObserver) this._followupObserver.disconnect(); clearTimeout(this._followupObserveTimer); this.setData({ ...initialEnterprise(), followupHistoryOpen: false, followupManageOpen: false }); if (this.speechController) this.speechController.hide(); if (this.location) this.location.clear(); this.controller.hide(); this.siteRecords.clear(); this.recommendations.clear(); this.resetDesignerCards(); if (this.publicSites) this.publicSites.clear(); if (this.plans) this.plans.clear(); this.closeSheet(); this.setData({ speechBusy: false, keyboardHeight: 0, siteRecordPaths: {}, siteRecordError: '', ...initialPublic(), ...initialPlans() }); },
  onUnload() {
    this._alive = false; clearTimeout(this._sheetTimer);
    this.followupChatController?.dispose();
    this._enterpriseEpoch = (this._enterpriseEpoch || 0) + 1;
    clearTimeout(this._followupObserveTimer); if (this.followupMedia) this.followupMedia.clear();
    if (this.followups) this.followups.hide(); if (this._followupObserver) this._followupObserver.disconnect();
    if (this.floorplans) this.floorplans.clear();
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
      bottomInset: info.safeArea ? Math.max(0, info.screenHeight - info.safeArea.bottom) : 34,
      navigationTop: Math.max(info.statusBarHeight || 24, capsuleTop + ((capsule && capsule.height || 32) - navigationHeight) / 2),
      navigationHeight,
      navigationRight: Math.max(96, info.windowWidth - (capsule && capsule.left || info.windowWidth - 96) + 10),
    });
  },
  syncKeyboardTab() {
    const page = getCurrentPages().slice(-1)[0];
    const tab = page && page.selectComponent && page.selectComponent('#customer-nav');
    if (this.data.embedded && tab) tab.setData({ keyboardHidden: !!this.data.keyboardHeight || !!this.data.sheet });
  },
  keyboardChange(event) {
    const keyboardHeight = Math.max(0, Number(event.detail.height) || 0);
    this.setData({ keyboardHeight, ...(!keyboardHeight && this.data.keyboardHeight ? { inputFocused: false } : {}) });
    this.syncKeyboardTab();
    if (this.data.messages.length || this.data.pendingText) this.scrollBottom();
  },
  focusInput() { this.setData({ inputFocused: true }); },
  blurInput() { if (!this.data.keyboardHeight) this.setData({ inputFocused: false }); },
  input(event) { this.controller.input(event.detail.value); },
  async pickPrompt(event) {
    if (this._promptSending) return;
    if (this.data.needsLogin) return this.send();
    if (!this.data.canSend || this.data.loading || this.data.busy || this.data.pendingSend || this.data.pendingAction
      || this.data.generating || this.data.uncertainRun || this.data.readOnly || this.data.fatal
      || this.data.contextBusy || this.data.contextPending || this.data.speechBusy) return;
    this._promptSending = true;
    try {
      this.controller.input(event.currentTarget.dataset.text);
      return await this.send();
    } finally { this._promptSending = false; }
  },
  chooseOption(event) { return this.controller.chooseOption(event.currentTarget.dataset.key, event.currentTarget.dataset.text); },
  confirmOptions() { return this.controller.confirmOptions(); },
  async send() {
    if (this.data.needsLogin) { this.login(); return; }
    if (this.data.contextBusy || this.data.contextPending) return;
    if (this.data.speechBusy) return;
    this.controller.speechInput = this.speechController?.binding();
    if (!this.data.conversation?.id && this.data.draft && this.data.canSend && !this.data.busy && !this.data.pendingSend && !this.data.pendingAction && !this.data.generating && !this.data.readOnly) {
      if (!await this.controller.handoffConversation()) return;
    }
    if (this.controller.conversationId && !await this.floorplans.show(this.controller.conversationId)) return;
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
  async openFloorplanPicker() {
    if (this.data.contextBusy || this.data.generating || this.data.pendingSend || this.data.pendingAction || this.data.readOnly) return;
    const id = this.controller.conversationId || await this.controller.handoffConversation();
    if (!id || !this._alive || !this._shown) return;
    this.setData({ contextBrowseOnly: false }); this.openSheet('floorplan');
    await this.floorplans.show(id);
  },
  async browseFloorplan() {
    if (this.data.contextBusy) return;
    await this.openFloorplanPicker();
    this.setData({ contextBrowseOnly: true });
    if (this.floorplans.selected && this.data.sheet === 'floorplan') await this.floorplans.detail(this.floorplans.selected);
  },
  viewFloorplan(event) {
    const plan = this.data.contextItems[Number(event.currentTarget.dataset.index)];
    if (plan) return this.floorplans.detail(plan);
  },
  floorplanList() { this.setData({ contextDetail: null }); },
  async chooseFloorplan(event) {
    const index = event.currentTarget.dataset.index;
    const plan = index === 'detail' ? this.data.contextDetail : index === 'none' ? null : this.data.contextItems[Number(index)];
    if (index !== 'none' && !plan || this.data.contextBusy || this.data.readOnly || this.data.generating || this.data.pendingSend || this.data.pendingAction) return;
    if (await this.floorplans.select(plan)) this.closeSheet();
  },
  async reloadFloorplanContext() {
    if (this.floorplans.id) return this.floorplans.retry();
    return this.openFloorplanPicker();
  },
  openFullArchive() {
    const plan = this.data.contextDetail;
    if (plan) wx.navigateTo({ url: '/packages/business/customer-project/customer-project?leadId=' + encodeURIComponent(plan.leadId) });
  },
  login() { goToLogin(); },
  back() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) });
  },
  scrollBottom() {
    this.setData({ scrollTarget: '' }, () => this.setData({ scrollTarget: 'conversation-end' }));
  },
  openSheet(sheet) {
    wx.hideKeyboard(); clearTimeout(this._sheetTimer);
    this.setData({ sheet, sheetOpen: false, keyboardHeight: 0, inputFocused: false }, () => {
      this.syncKeyboardTab();
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
    if (this.data.sheet === 'publicSite' && this.publicSites) this.publicSites.closeDetail();
    this.controller.citationRequest = (this.controller.citationRequest || 0) + 1;
    this.followupChatController?.clearCitation();
    this.referenceImages.clear();
    this.controller.set({ citation: null });
    this.setData({ sheetOpen: false });
    this._sheetTimer = setTimeout(() => {
      if (this._alive) { this.setData({ sheet: '' }); this.syncKeyboardTab(); }
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
  openHistory() { this.openSheet('history'); this.followups.loadList(); return this.data.professionalFollowup ? null : this.controller.loadHistory(); },
  selectFollowup(event) {
    if (this.data.busy || this.data.pendingSend || this.data.pendingAction || this.data.mediaBusy || this.data.mediaPending) return;
    this.setData({ followupHistoryOpen: false, followupManageOpen: false }); this.closeSheet(); this.controller.hide(); return this.followups.select(String(event.currentTarget.dataset.id));
  },
  refreshFollowup() { return this.followups.select(this.followups.selected); },
  readFollowupReport(event) { const d = event.currentTarget.dataset; this.setData({ followupManageOpen: false }); return this.followups.readReport(String(d.report), Number(d.revision), this.followups.selected, d.project ? String(d.project) : ''); },
  closeFollowupReport() { this.followups.closeReport(); },
  moreFollowupReports() { return this.followups.more(); },
  recoverFollowup() { return this.followups.recover(); },
  readFollowupOriginal(event) { return this.followups.original(String(event.currentTarget.dataset.project), String(event.currentTarget.dataset.record)); },
  closeFollowupOriginal() { this.setData({ followupOriginal: null }); this.followups.set({ followupOriginal: null }); },
  previewFollowupOriginal(event) { const r = this.data.followupOriginal; if (r) return this.followupMedia.preview(r.id, r.version, String(event.currentTarget.dataset.media)); },
  observeFollowupCards() {
    if (this._followupObserver) this._followupObserver.disconnect();
    if (!this._alive || !this._shown || !this.data.followupActive || !this.data.followupReports.length) return;
    clearTimeout(this._followupObserveTimer);
    if (this.data.sheet) { this._followupObserveTimer = setTimeout(() => this.observeFollowupCards(), 300); return; }
    wx.nextTick(() => {
      if (!this._alive || !this._shown || !this.data.followupActive || this.data.followupDetail || !wx.createIntersectionObserver) return;
      this._followupObserver = wx.createIntersectionObserver(this, { observeAll: true, thresholds: [0.5] });
      this._followupObserver.relativeTo('.followup-scroll').observe('.followup-card-marker', r => {
        if (r.intersectionRatio >= 0.5 && this._shown && !this.data.sheet && !this.data.followupDetail && !this.data.followupHistoryOpen && !this.data.followupManageOpen)
          this.followups.visibleCard(String(r.dataset.report));
      });
    });
  },
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
    this.followups.leave(); this.controller.visible = true; this.closeSheet(); return this.controller.selectConversation(event.currentTarget.dataset.id);
  },
  newConversation() {
    if (this.data.mediaBusy || this.data.mediaPending) return;
    if (this.data.busy || this.data.pendingSend || this.data.pendingAction) return;
    this.followups.leave(); this.closeSheet(); const result = this.controller.newConversation();
    return this.controller.visible ? result : this.controller.show(this._options);
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
    if (this._browsingSites || this.data.publicLoading || this.data.publicBusy || this.data.loading || this.data.fatal || this.data.busy || this.data.generating || this.data.pendingSend || this.data.pendingAction || this.data.uncertainRun) return;
    const cid = this.controller.conversationId, eid = this.data.enterpriseId, session = sessionToken();
    if (!cid || !eid) return;
    this._browsingSites = true;
    try {
      const location = await this.syncLocation(true);
      if (!this._alive || !this._shown || location.blocked || cid !== this.controller.conversationId || session !== sessionToken()) return;
      await this.publicSites.browse(cid, eid, this.data.messages, location.notice);
      if (this._alive && this._shown && cid === this.controller.conversationId && session === sessionToken()) this.scrollBottom();
    } finally { this._browsingSites = false; }
  },
  openPublicSite(e) {
    const d = e.currentTarget.dataset;
    if (!this.controller.conversationId || this.data.fatal || !/^[1-9]\d{0,18}$/.test(String(d.id)) || !/^[1-9]\d{0,18}$/.test(String(d.version))) return;
    this.openSheet('publicSite');
    return this.publicSites.openDetail(this.controller.conversationId, this.data.enterpriseId, String(d.id), String(d.version));
  },
  async askPublicSite() {
    const item = this.data.publicDetail, cid = this.controller.conversationId;
    if (!item || this._askingPublicSite || !this.data.canSend || this.data.publicDetailLoading || this.data.publicBusy || this.data.publicPending || this.data.loading || this.data.fatal || this.data.readOnly || this.data.busy || this.data.generating || this.data.pendingSend || this.data.pendingAction || this.data.uncertainRun || this.data.contextBusy || this.data.contextPending || this.data.speechBusy) return;
    this._askingPublicSite = true;
    try {
      if (await this.publicSites.attach(cid, this.data.enterpriseId, item.id, item.versionId)) {
        if (!this._alive || !this._shown || cid !== this.controller.conversationId) return;
        this.closeSheet(); await this.controller.refresh(); this.scrollBottom();
      }
    } finally { this._askingPublicSite = false; }
  },
  async publicDecision(e) {
    const d = e.currentTarget.dataset;
    const ok = await this.publicSites.decide(d.key, d.action);
    if (ok && d.action !== 'preview') await this.controller.refresh();
  },
  laterPublic() { this.publicSites.later(); },
  async retryPublic() {
    if (this.data.publicPending) { if (await this.publicSites.retry()) { if (this.data.sheet === 'publicSite') this.closeSheet(); await this.controller.refresh(); } }
    else if (this.data.sheet === 'publicSite') await this.publicSites.readDetail();
    else if (this.data.publicBrowsing) await this.browseSites();
    else await this.controller.refresh();
  },
  previewPublic(e) { return this.publicSites.media.preview(e.currentTarget.dataset.key); },
  previewPublicDetail(e) { return this.publicSites.detailMedia.preview(e.currentTarget.dataset.key); },
  openDesigner(event) {
    const item = this.data.portfolioItems.find(i => i.authorId === String(event.currentTarget.dataset.id));
    if (!item || !this.data.conversation) return;
    wx.navigateTo({ url: `/packages/assistant/designer/designer?conversationId=${encodeURIComponent(this.data.conversation.id)}&authorId=${item.authorId}&sourceWorkId=${item.work.id}` });
  },
  onShareAppMessage() {
    const token = this.data.shareReferenceEntry;
    return { title: '聊聊你的装修想法 · 家客来小K', path: token ? '/packages/assistant/chat/chat?referenceEntry=' + encodeURIComponent(token) : '/pages/index/index',
      imageUrl: '/packages/assistant/assets/chat-notebook-mascot.png' };
  },
});
