const { errorCopy, uncertain } = require('../lib/client');

const reasons = [
  { key: 'incorrect', text: '内容有误' }, { key: 'off_topic', text: '答非所问' },
  { key: 'unclear', text: '说得不清楚' }, { key: 'other', text: '其他' },
];
const initialSearch = () => ({ historyQuery: '', historyTerm: '', historyMatches: [], historySearchCursor: null, historySearching: false, historySearchError: '' });
const initialReplyActions = () => ({
  ...initialSearch(), copiedAnswerId: '', feedbackBusyId: '', replyTarget: '',
  feedbackReasons: reasons, feedbackReason: '', feedbackNote: '', feedbackError: '',
  feedbackSaved: false, feedbackPending: false, interactionKeyboard: 0,
  replyVersionChoice: {}, moreError: '', canRegenerateAnswer: false, canReadAnswer: false,
  regenerationPending: false, replyAudioId: '', replyAudioState: '',
});
const messageId = event => String(event.currentTarget.dataset.message || '');

const replyActionsMethods = {
  interactionKeyboardChange(event) {
    this.setData({ interactionKeyboard: Math.max(0, Number(event.detail.height) || 0) });
  },
  copyAnswer(event) {
    const id = messageId(event);
    const text = this.controller.answerText(id);
    if (!text) return;
    const conversationId = this.controller.conversationId;
    wx.setClipboardData({
      data: text, showToast: false,
      success: () => {
        if (!this._alive || !this._shown || this.controller.conversationId !== conversationId) return;
        this.setData({ copiedAnswerId: id });
        clearTimeout(this._copyAnswerTimer);
        this._copyAnswerTimer = setTimeout(() => { if (this._alive) this.setData({ copiedAnswerId: '' }); }, 1800);
      },
      fail: () => { if (this._alive && this._shown) wx.showToast({ title: '复制失败，可长按选取文字', icon: 'none' }); },
    });
  },
  markHelpful(event) {
    const id = messageId(event);
    const item = this.data.messages.find(message => message.id === id);
    if (!item?.replyActions) return;
    return this.saveAnswerFeedback(id, { rating: item.replyActions.feedback?.rating === 'helpful' ? 'clear' : 'helpful' });
  },
  openAnswerFeedback(event) {
    const id = messageId(event);
    const item = this.data.messages.find(message => message.id === id);
    if (!item?.replyActions || !this.controller.answerText(id)) return;
    const previous = item.replyActions.feedback?.rating === 'issue' ? item.replyActions.feedback : null;
    const pending = this.controller.client.pending.get('answer-feedback:' + this.controller.conversationId + ':' + id)?.body;
    const draft = pending?.rating === 'issue' ? pending : previous;
    this.setData({ replyTarget: id, feedbackReason: draft?.reason || '', feedbackNote: draft?.note || '',
      feedbackSaved: !!previous, feedbackPending: !!pending, feedbackError: '', interactionKeyboard: 0 });
    this.openSheet('answerFeedback');
  },
  pickFeedbackReason(event) {
    if (!this.data.feedbackBusyId && !this.data.feedbackPending) this.setData({ feedbackReason: event.currentTarget.dataset.reason, feedbackError: '' });
  },
  inputFeedbackNote(event) { this.setData({ feedbackNote: event.detail.value }); },
  submitAnswerFeedback() {
    if (!this.data.feedbackReason && !this.data.feedbackPending) return;
    return this.saveAnswerFeedback(this.data.replyTarget, {
      rating: 'issue', reason: this.data.feedbackReason, note: this.data.feedbackNote,
    });
  },
  clearAnswerFeedback() { return this.saveAnswerFeedback(this.data.replyTarget, { rating: 'clear' }); },
  async saveAnswerFeedback(id, body) {
    if (!id || this.data.feedbackBusyId) return;
    const conversationId = this.controller.conversationId;
    const current = () => this._alive && this._shown && this.controller.conversationId === conversationId;
    this.setData({ feedbackBusyId: id, feedbackError: '' });
    try {
      if (await this.controller.updateAnswerFeedback(id, body) && current()) {
        if (this.data.sheet === 'answerFeedback' && this.data.replyTarget === id) this.closeSheet();
        if (body.rating !== 'clear') wx.showToast({ title: '谢谢反馈', icon: 'none' });
      }
    } catch (error) {
      if (current()) {
        const text = errorCopy(error);
        if (this.data.sheet === 'answerFeedback') this.setData({ feedbackError: text, feedbackPending: uncertain(error) });
        else wx.showToast({ title: text, icon: 'none' });
      }
    } finally {
      if (this._alive && this.data.feedbackBusyId === id) this.setData({ feedbackBusyId: '' });
    }
  },
  openAnswerMore(event) {
    const id = messageId(event);
    const item = this.data.messages.find(message => message.id === id);
    if (!item?.replyActions || !this.controller.answerText(id)) return;
    const pending = this.controller.client.pending.get('answer-regenerate:' + this.controller.conversationId + ':' + id);
    this.setData({ replyTarget: id, moreError: '', regenerationPending: !!pending,
      canRegenerateAnswer: !!pending || this.data.conversation?.regenerateMessageId === id,
      canReadAnswer: item.replyActions.readAloud === true });
    this.openSheet('answerMore');
  },
  async regenerateSelectedAnswer() {
    const id = this.data.replyTarget, conversationId = this.controller.conversationId;
    const current = () => this._alive && this._shown && this.controller.conversationId === conversationId
      && this.data.sheet === 'answerMore' && this.data.replyTarget === id;
    try {
      if (await this.controller.regenerateAnswer(id) && current()) {
        const item = this.data.messages.find(message => message.id === id);
        if (item?.replyVersion) this.setData({ ['replyVersionChoice.r' + item.replyVersion.root]: '' });
        this.closeSheet();
        this.scrollBottom();
      }
    } catch (error) {
      if (current()) this.setData({ moreError: errorCopy(error), regenerationPending: uncertain(error) });
    }
  },
  async readSelectedAnswer() {
    const id = this.data.replyTarget, conversationId = this.controller.conversationId;
    if (!this.data.canReadAnswer || !this.controller.answerText(id)) return;
    if (this.data.replyAudioId === id && this.data.replyAudioState) {
      if (this.data.replyAudioState !== 'loading') this.speechController.togglePlayback(this.data.replyAudioState === 'paused');
      return;
    }
    if (!await this.prepareSpeech() || this.controller.conversationId !== conversationId || this.data.replyTarget !== id) return;
    return this.speechController.playProtected(`/miniprogram/assistant/conversations/${conversationId}/messages/${id}/audio`,
      state => { if (this._alive && (this._shown || !state)) this.setData({ replyAudioId: state ? id : '', replyAudioState: state }); },
      () => { if (this._alive && this._shown) wx.showToast({ title: '朗读暂时不可用，请重试', icon: 'none' }); });
  },
  selectAnswerVersion(event) {
    const { root, version } = event.currentTarget.dataset;
    if (!this.data.messages.some(item => item.id === version && item.replyVersion?.root === root)) return;
    this.setData({ ['replyVersionChoice.r' + root]: version, scrollTarget: '' }, () => this.setData({ scrollTarget: 'message-' + version }));
  },
  async editQuestionText(id) {
    const text = this.controller.questionText(id);
    if (!text || !this.data.canSend || this.data.busy || this.data.pendingSend || this.data.pendingAction || this.data.generating) return;
    const conversationId = this.controller.conversationId;
    const current = () => this._alive && this._shown && this.controller.conversationId === conversationId && this.controller.questionText(id) === text;
    const choose = (method, options) => new Promise(resolve => wx[method]({ ...options, success: resolve, fail: () => resolve(null) }));
    const choice = await choose('showActionSheet', { itemList: ['编辑后重发'] });
    if (choice?.tapIndex !== 0 || !current()) return;
    const draft = this.data.draft;
    if (draft && draft !== text && !(await choose('showModal', { title: '替换当前草稿？', content: '确认后把这条原问题带回输入框。', confirmText: '替换' }))?.confirm) return;
    if (!current() || this.data.draft !== draft) return;
    this.controller.input(text);
    this.clearStageInput();
  },
  resetHistorySearch() {
    clearTimeout(this._historySearchTimer);
    this._historySearchSequence = (this._historySearchSequence || 0) + 1;
    this.setData(initialSearch());
  },
  inputHistorySearch(event) {
    const query = event.detail.value;
    const term = query.replace(/\s+/gu, ' ').trim();
    if (term === this.data.historyTerm) { this.setData({ historyQuery: query }); return; }
    this.resetHistorySearch();
    this.setData({ historyQuery: query, historyTerm: term, historySearching: !!term });
    if (term) this._historySearchTimer = setTimeout(() => this.searchHistory(), 260);
  },
  clearHistorySearch() { this.resetHistorySearch(); },
  confirmHistorySearch() {
    wx.hideKeyboard();
    return this.searchHistory();
  },
  moreHistorySearch() { return this.searchHistory(true); },
  async searchHistory(more = false) {
    clearTimeout(this._historySearchTimer);
    const term = this.data.historyTerm;
    if (!this._shown || this.data.sheet !== 'history' || !term || (more && (!this.data.historySearchCursor || this.data.historySearching))) return;
    const sequence = this._historySearchSequence = (this._historySearchSequence || 0) + 1;
    const current = () => this._alive && this._shown && this.data.sheet === 'history' && this._historySearchSequence === sequence;
    this.setData({ historySearching: true, historySearchError: '' });
    try {
      const page = await this.controller.historyPage(more ? this.data.historySearchCursor : null, term);
      if (!page || !current()) return;
      const items = page.items.map(item => {
        const date = new Date(item.createdAt);
        const dateLabel = Number.isNaN(date.getTime()) ? '' : `${date.getMonth() + 1}月${date.getDate()}日`;
        return { ...item, dateLabel };
      });
      this.setData({ historyMatches: more ? this.data.historyMatches.concat(items) : items, historySearchCursor: page.nextCursor });
    } catch (error) {
      if (current()) this.setData({ historySearchError: errorCopy(error) });
    } finally {
      if (current()) this.setData({ historySearching: false });
    }
  },
  retryHistorySearch() { return this.searchHistory(); },
};

module.exports = { initialReplyActions, replyActionsMethods };
