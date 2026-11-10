const api = require('./api');
const emptyFollowupChat = () => ({ conversation: null, messages: [], draft: '', loading: false, busy: false, pendingSend: false, pendingAction: '', error: '', fatal: false, mediaPaths: {}, mediaBusy: false, mediaPending: false, mediaError: '', citation: null, citationLoading: false, citationError: '', runLabel: '', generating: false, retryable: false, uncertainRun: false });

/** Reuse C01's controller and journal, keeping its ordinary draft/destination
 * untouched. The transport resolves only the verified private binding. */
class FollowupChat {
  constructor({ Controller, Media, client, identity, headers, emit, referenceImage }) {
    Object.assign(this, { Controller, Media, client, identity, headers, emit, referenceImage });
    this.state = emptyFollowupChat();
  }
  set(patch) {
    if (patch.messages && this.audience !== 'customer') patch.messages = patch.messages.map(m => ({ ...m, isUser: m.authorKind === 'admin' }));
    if (!this.visible) patch = { ...patch, conversation: null, messages: [], mediaPaths: {}, citation: null };
    Object.assign(this.state, patch);
    this.state.reception = ['human','handoff_requested'].includes(this.state.conversation?.mode);
    this.state.canCompose = this.canSend();
    this.state.canDraft = this.state.canCompose || this.visible && this.session === this.identity() && this.state.conversation?.mode === 'ai' && this.state.conversation.status === 'open' && !this.state.fatal;
    if (this.visible && this.session === this.identity()) this.emit({ followupChat: { ...this.state } });
  }
  path(value) {
    if (/^\/runs\/[1-9]\d{0,18}(?:\/(?:cancel|retry))?$/.test(value)) return '/followups/' + this.bid + '/conversation' + value;
    if (/^\/citations\/(?:[1-9]\d{0,18}|w:[1-9]\d{0,18}:\d{1,2}(?::\d{1,2})?)$/.test(value)) return '/followups/' + this.bid + '/conversation' + value;
    const prefix = '/conversations/' + this.cid;
    if (value !== prefix && !value.startsWith(prefix + '/')) throw { statusCode: 403, code: 'assistant_capability_forbidden' };
    return '/followups/' + this.bid + '/conversation' + value.slice(prefix.length);
  }
  async open(context) {
    if (!context || !['customer','worker','designer','boss'].includes(context.audience)) return this.hide();
    this.audience = context.audience;
    const session = this.identity(), cid = context.conversationId, bid = context.bindingId, reentry = !this.visible;
    if (this.session && this.session !== session) { this.dispose(); this.chat = null; }
    this.session = session; this.visible = true;
    if (this.chat && this.cid === cid && this.bid === bid) {
      this.chat.visible = true; this.set({});
      try { await this.chat.snapshot(cid, this.chat.epoch, !reentry); }
      catch (e) { this.chat.fail(e, this.chat.epoch); }
      finally { this.set({ loading: false }); }
      return;
    }
    this.dispose(); this.visible = true; this.cid = cid; this.bid = bid; this.state = emptyFollowupChat();
    const prefix = '/followups/' + bid + '/conversation';
    const pending = { get: slot => this.client.pending.get(slot), has: slot => this.client.pending.has(slot),
      clear: () => { for (const [slot, op] of this.client.pending) if (op.path === prefix || op.path.startsWith(prefix + '/')) this.client.pending.delete(slot); } };
    const facade = { pending,
      read: async (p, body, _headers, method) => this.client.read(this.path(p), body, await this.headers(), method),
      mutate: async (slot, p, body, method) => this.client.mutate(slot, this.path(p), body, method, await this.headers()) };
    this.chat = new this.Controller({ client: facade, identity: this.identity, referenceImage: this.referenceImage, emit: p => {
      this.set(p); if (p.messages && this.visible) this.loadImages(p.messages);
    } });
    this.chat.visible = true; this.chat.session = session; this.chat.set({ canSend: true });
    this.media = new this.Media({ client: facade, identity: this.identity, emit: p => this.set(p),
      download: async (p, options) => api.downloadFile('/miniprogram/assistant' + this.path(p.replace('/miniprogram/assistant', '')), { ...options, headers: await this.headers() }) });
    return this.chat.selectConversation(cid);
  }
  hide() { this.visible = false; this.clearCitation(); this.chat?.hide(); this.media?.dispose(); Object.assign(this.state, { conversation: null, messages: [], mediaPaths: {}, loading: true, canCompose: false, reception: false }); this.emit({ followupChat: emptyFollowupChat() }); }
  dispose() { this.hide(); this.chat?.dispose(); this.media?.dispose(); }
  input(value) { if (this.visible) this.chat?.input(value); }
  canSend() { const c = this.state.conversation; return this.visible && this.session === this.identity() && c?.status === 'open'
    && (['human','handoff_requested'].includes(c.mode) || c.mode === 'ai' && !!c.reportContext?.selected && !c.reportContext.invalidated)
    && c.ownerAvailable !== false && !this.state.fatal; }
  async send() {
    if (!this.canSend() && !this.state.pendingSend) return;
    return this.chat.send();
  }
  handoff(action) { if (this.visible && !this.state.loading && !this.state.fatal) return this.chat.handoff(action); }
  recover() { return this.state.pendingAction ? this.state.pendingAction.startsWith('handoff:') ? this.handoff(this.state.pendingAction.split(':')[1]) : this.action(this.state.pendingAction) : this.send(); }
  action(value) { if (this.visible && !this.state.loading && !this.state.fatal && this.state.conversation?.mode === 'ai' && (value !== 'retry' || this.state.pendingAction || this.canSend())) return this.chat.action(value); }
  citation(id) { if (this.visible && !this.state.fatal) return this.chat?.openCitation(id); }
  clearCitation() { if (this.chat) { this.chat.citationRequest = (this.chat.citationRequest || 0) + 1; this.chat.set({ citation: null, citationLoading: false, citationError: '' }); } }
  async refresh() { if (this.visible && this.chat) return this.chat.snapshot(this.cid, this.chat.epoch).catch(e => this.chat.fail(e, this.chat.epoch)); }
  async loadImages(messages) {
    if (!this.media || !messages.some(m => m.mediaId)) return;
    const media = this.media, session = this.session;
    await media.load(this.cid);
    for (const m of messages.filter(m => m.mediaId && m.mediaAvailable)) {
      const file = await media.thumbnail(m.mediaId);
      if (this.visible && media === this.media && session === this.identity()) this.set({ mediaPaths: { ...media.thumbnailPaths, [m.mediaId]: file } });
    }
  }
  async image(filePath) {
    if (!this.canSend() || !this.state.reception || this.state.busy || this.state.pendingSend || this.state.pendingAction || this.state.mediaBusy) return;
    const media = this.media;
    if (media.id !== this.cid) await media.load(this.cid);
    if (await media.upload(filePath, 'image', '')) await this.refresh();
  }
  async recoverImage() { if (this.media && await this.media.upload()) await this.refresh(); }
  preview(id) { return this.media?.preview(id); }
}
const followupChatMethods = {
  inputFollowup(event) { this.followupChatController.input(event.detail.value); },
  sendFollowup() { return this.followupChatController.send(); },
  recoverFollowupChat() { return this.followupChatController.recover(); },
  refreshFollowupChat() { return this.followupChatController.refresh(); },
  stopFollowup() { return this.followupChatController.action('cancel'); },
  retryFollowupRun() { return this.followupChatController.action('retry'); },
  openFollowupCitation(event) {
    this._followupCitationId = event.currentTarget.dataset.id;
    this.openSheet('followupCitation'); return this.followupChatController.citation(this._followupCitationId);
  },
  retryFollowupCitation() { return this.followupChatController.citation(this._followupCitationId); },
  openFollowupHandoff() {
    const chat = this.followupChatController, c = chat.state.conversation;
    if (!c || chat.state.busy || chat.state.pendingSend || chat.state.pendingAction) return;
    if (['human','handoff_requested'].includes(c.mode)) { this.setData({ followupScrollTarget: 'followup-reception' }); return; }
    const cid = chat.cid;
    wx.showModal({ title: '请设计师接着聊？', content: '将本次文字对话、图片资料及后续会话消息分享给企业接待团队。接待期间小K暂停自动回复，已保存的简报仍可查看。',
      success: r => { if (r.confirm && this._alive && chat.visible && chat.cid === cid) chat.handoff('request'); } });
  },
  endFollowupHandoff() {
    const chat = this.followupChatController, c = chat.state.conversation;
    if (!c || chat.state.busy || chat.state.pendingSend || chat.state.pendingAction) return;
    const waiting = c.mode === 'handoff_requested', cid = chat.cid;
    wx.showModal({ title: waiting ? '取消等待？' : '结束接续？', content: '结束后设计师将无法继续查看本次咨询，小K恢复回复。',
      success: async r => {
        if (!r.confirm || !this._alive || !chat.visible || chat.cid !== cid) return;
        await chat.handoff(waiting ? 'cancel' : 'end');
        if (this._alive && chat.visible && chat.cid === cid && chat.state.conversation?.mode === 'ai') {
          setTimeout(() => {
            if (!this._alive || !chat.visible || chat.cid !== cid) return;
            this.setData({ followupScrollTarget: '' }, () => {
              if (this._alive && chat.visible && chat.cid === cid) this.setData({ followupScrollTarget: 'followup-conversation-end' });
            });
          }, 100);
        }
      } });
  },
  pickFollowupImage() {
    const chat = this.followupChatController, session = chat.session, cid = chat.cid;
    if (!chat.canSend() || !chat.state.reception || chat.state.mediaBusy || chat.state.mediaPending) return;
    wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album','camera'], sizeType: ['compressed'], success: result => {
      if (!this._alive || !chat.visible || chat.session !== session || chat.cid !== cid) return;
      const file = result.tempFiles[0];
      if (!file || file.size > 4 * 1024 * 1024) return chat.set({ mediaError: '请选择4MB以内的JPEG或PNG图片。' });
      return chat.image(file.tempFilePath);
    }, fail: e => { if (chat.visible && !String(e.errMsg).includes('cancel')) chat.set({ mediaError: '未能选择图片，请检查相册或相机权限后重试。' }); } });
  },
  recoverFollowupImage() { return this.followupChatController.recoverImage(); },
  previewFollowupImage(event) { return this.followupChatController.preview(event.currentTarget.dataset.id); },
};
module.exports = { FollowupChat, emptyFollowupChat, followupChatMethods };
