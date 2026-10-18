const { AssistantClient, entryInput, errorCopy, uncertain, messagesForView } = require('./client');
const ACTIVE = ['queued', 'running'];
const WELCOME = '你好，我是小K。\n先聊聊你的装修想法吧。';
function historyForView(items) {
  return (items || []).map(item => {
    const time = new Date(item.createdAt);
    const pad = value => String(value).padStart(2, '0');
    const createdLabel = Number.isNaN(time.getTime()) ? '装修咨询' : `${time.getFullYear()}/${pad(time.getMonth() + 1)}/${pad(time.getDate())} ${pad(time.getHours())}:${pad(time.getMinutes())}`;
    return { ...item, createdLabel };
  });
}
const initial = () => ({
  loading: true, busy: false, error: '', fatal: false, needsLogin: false,
  enterpriseId: '', enterpriseName: '', canSend: false, maxChars: 4000,
  shareReferenceEntry: '',
  welcomeText: WELCOME, guidanceEnabled: false, guidance: null, selectedOptions: [], selectedOptionMap: {},
  conversation: null, readOnly: false, messages: [], messageCursor: null, run: null,
  history: [], historyCursor: null, historyLoading: false, historyError: '',
  draft: '', pendingText: '', pendingSend: false, pendingAction: '',
  runLabel: '', retryable: false, generating: false, uncertainRun: false,
  citation: null, citationLoading: false, citationError: '',
  contactLoading: false,
});

class ChatController {
  constructor({ emit, client = new AssistantClient(), identity = () => '', schedule = setTimeout, unschedule = clearTimeout, referenceImage = async value => value }) {
    this.emit = emit; this.client = client; this.identity = identity;
    this.schedule = schedule; this.unschedule = unschedule;
    this.referenceImage = referenceImage;
    this.state = initial(); this.epoch = 0; this.visible = false;
  }

  set(patch) { Object.assign(this.state, patch); this.emit(patch); }
  valid(epoch) { return this.epoch === epoch && this.session === this.identity(); }
  hide() { this.visible = false; this.showTicket = (this.showTicket || 0) + 1; this.unschedule(this.timer); }
  dispose() { this.hide(); this.epoch += 1; }
  clear() {
    this.operationalDraft = null;
    this.dispose(); this.client.pending.clear(); this.entry = null; this.entryExpiry = 0;
    this.conversationId = ''; this.startedNew = false; this.set(initial());
  }

  async show(options) {
    const ticket = this.showTicket = (this.showTicket || 0) + 1;
    // Finish the same in-memory write across a background/foreground cycle.
    // Discarding an accepted response here could make a draft look unsent.
    if (this.flight) await this.flight;
    if (ticket !== this.showTicket) return;
    const identity = this.identity();
    if (this.session && this.session !== identity) this.clear();
    this.session = identity;
    this.visible = true;
    this.options = options || this.options || {};
    this.set({ busy: false, citation: null, citationLoading: false, citationError: '', historyLoading: false });
    if (!identity) {
      this.set({ ...initial(), loading: false, fatal: true, needsLogin: true, error: '登录后，小K就能为你保存装修咨询记录。' });
      return;
    }
    return this.refresh();
  }

  async ensureEntry(force = false) {
    if (!force && this.entry && Date.now() < this.entryExpiry) return this.entry;
    const epoch = this.epoch;
    const entry = await this.client.read('/entry-context', entryInput(this.options), {}, 'POST');
    if (!this.valid(epoch)) return null;
    this.entry = entry;
    this.entryExpiry = Date.now() + Math.max(0, Number(entry.expiresIn || 900) - 30) * 1000;
    this.set({ enterpriseId: entry.enterprise.id, enterpriseName: entry.enterprise.name, canSend: entry.canSend !== false, maxChars: Math.min(4000, Number(entry.maxMessageChars) || 4000), shareReferenceEntry: entry.referenceEntry || '' });
    if (!this.state.conversation) this.set({ welcomeText: entry.guidanceOpening || WELCOME, guidanceEnabled: !!entry.guidanceEnabled, guidance: entry.guidance || null });
    return entry;
  }

  async historyPage(cursor) {
    const entry = await this.ensureEntry();
    if (!entry) return null;
    try {
      return await this.client.read('/conversations', { limit: 20, ...(cursor ? { cursor } : {}) }, { 'X-Assistant-Entry': entry.entryToken });
    } catch (error) {
      // Refresh an expired entry token once, but never silently change an entry.
      if ((error.code || error.error) !== 'entry_context_invalid') throw error;
      const refreshed = await this.ensureEntry(true);
      if (!refreshed) return null;
      return this.client.read('/conversations', { limit: 20, ...(cursor ? { cursor } : {}) }, { 'X-Assistant-Entry': refreshed.entryToken });
    }
  }

  async refresh() {
    if (!this.visible || this.state.busy) return;
    const epoch = ++this.epoch;
    this.unschedule(this.timer);
    this.set({ loading: true, error: '', fatal: false, contactLoading: false });
    try {
      await this.ensureEntry(true);
      if (!this.valid(epoch)) return;
      const history = await this.historyPage();
      if (!this.valid(epoch) || !history) return;
      this.set({ history: historyForView(history.items), historyCursor: history.nextCursor, historyError: '' });
      const target = this.conversationId || (!this.startedNew && (this.options.conversationId || this.entry.resumeConversationId));
      if (target) await this.snapshot(target, epoch);
      this.setIf(epoch, { loading: false, error: this.state.pendingSend
        ? '发送结果尚未确认，请确认同一条消息的发送结果。'
        : this.state.pendingAction ? '操作结果尚未确认，请核对同一次操作。' : '' });
    } catch (error) { this.fail(error, epoch, true); }
  }

  setIf(epoch, patch) { if (this.valid(epoch)) this.set(patch); }
  fail(error, epoch, fatal = false) {
    if (!this.valid(epoch)) return;
    const code = error.code || error.error;
    const denied = error.statusCode === 401 || ['assistant_capability_forbidden', 'assistant_resource_not_found', 'entry_context_invalid', 'identity_context_invalid'].includes(code);
    if (denied) {
      this.epoch += 1;
      this.unschedule(this.timer); this.client.pending.clear();
      this.entry = null; this.entryExpiry = 0; this.conversationId = '';
      this.set({ ...initial(), loading: false });
    }
    this.set({ loading: false, error: errorCopy(error), fatal: fatal || denied, needsLogin: error.statusCode === 401,
      ...(code === 'assistant_disabled' ? { canSend: false } : {}) });
  }

  scheduleConversation(id, epoch, delay = 7000) {
    this.unschedule(this.timer);
    if (!this.visible || !this.valid(epoch) || this.conversationId !== id) return;
    this.timer = this.schedule(() => {
      if (!this.visible || !this.valid(epoch) || this.conversationId !== id) return;
      if (this.state.busy || this.state.pendingSend || this.state.pendingAction) return this.scheduleConversation(id, epoch, delay);
      return this.snapshot(id, epoch, true).catch(error => this.fail(error, epoch));
    }, delay);
  }

  async snapshot(id, epoch, background = false) {
    const ticket = this.snapshotTicket = (this.snapshotTicket || 0) + 1;
    const [conversation, messages] = await Promise.all([
      this.client.read(`/conversations/${id}`),
      this.client.read(`/conversations/${id}/messages`, { limit: 30 }),
    ]);
    if (!this.valid(epoch) || ticket !== this.snapshotTicket) return;
    if (background && (!this.visible || this.state.busy || this.state.pendingSend || this.state.pendingAction)) {
      this.scheduleConversation(id, epoch); return;
    }
    const sameQuestion = this.conversationId === id && this.state.guidance?.questionKey === conversation.guidance?.questionKey;
    this.conversationId = id;
    const pendingMessage = this.client.pending.get('send:' + id), pendingHandoff = this.client.pending.get('handoff:' + id);
    if (pendingMessage) this.set({ pendingSend: true, pendingText: pendingMessage.body.content.blocks[0].text, draft: pendingMessage.body.content.blocks[0].text });
    if (pendingHandoff) this.set({ pendingAction: 'handoff:' + pendingHandoff.body.action });
    this.set({ conversation, readOnly: conversation.status !== 'open' || !['ai', 'human', 'handoff_requested'].includes(conversation.mode), messages: messagesForView(messages.items), messageCursor: messages.nextCursor });
    this.set({ welcomeText: conversation.guidanceOpening || WELCOME, guidanceEnabled: !!conversation.guidanceEnabled, guidance: conversation.guidance || null,
      ...(!sameQuestion ? { selectedOptions: [], selectedOptionMap: {} } : {}) });
    this.applyRun(conversation.mode === 'ai' ? conversation.latestRun : null);
    if (this.visible && conversation.status === 'open' && (['handoff_requested', 'human'].includes(conversation.mode) || !this.state.run || this.state.run.status === 'succeeded')) {
      this.scheduleConversation(id, epoch, conversation.mode === 'ai' ? 7000 : 3000);
    }
  }

  applyRun(run) {
    const status = run && run.status;
    this.set({ run, generating: ACTIVE.includes(status), uncertainRun: status === 'indeterminate',
      retryable: !!(run && run.retryable),
      runLabel: ({ queued: '小K正在查找企业装修资料…', running: '小K正在整理回答…',
        cancelled: '已停止回答', failed: '这次回答没有完成',
        indeterminate: '回答结果正在核实，暂时不能重复生成。' })[status] || '',
    });
    this.unschedule(this.timer);
    if (this.visible && ACTIVE.includes(status)) this.timer = this.schedule(() => this.poll(), Math.max(1500, Number(run.nextPollMs) || 1500));
  }

  async poll() {
    if (!this.visible || !this.state.run || !this.valid(this.epoch)) return;
    const epoch = this.epoch, id = this.state.run.id;
    try {
      const run = await this.client.read(`/runs/${id}`);
      if (!this.valid(epoch) || id !== this.state.run.id) return;
      this.set({ error: '' });
      if (ACTIVE.includes(run.status)) this.applyRun(run);
      else await this.snapshot(this.conversationId, epoch);
    } catch (error) { this.fail(error, epoch); }
  }

  input(value) {
    if (!this.state.pendingSend && !this.state.busy) this.set({ draft: String(value).slice(0, this.state.maxChars), pendingText: '' });
  }

  send() {
    if (this.flight) return this.flight;
    this.flight = this.sendMessage().finally(() => { this.flight = null; });
    return this.flight;
  }

  async handoffConversation() {
    if (this.state.busy || this.state.pendingSend || this.state.pendingAction || this.state.loading || this.state.fatal || !this.state.canSend) return null;
    if (this.conversationId) return this.conversationId;
    const epoch = this.epoch; this.set({ busy: true });
    try {
      const entry = await this.ensureEntry();
      if (!entry || !this.valid(epoch)) return null;
      const c = await this.client.mutate('create', '/conversations', { entryToken: entry.entryToken });
      if (!this.valid(epoch)) return null;
      this.conversationId = c.id; this.set({ conversation: c }); return c.id;
    } catch (error) { this.fail(error, epoch); return null; }
    finally { this.setIf(epoch, { busy: false }); }
  }

  async handoff(action = 'request') {
    if (this.state.busy || this.state.pendingSend || (this.state.pendingAction && this.state.pendingAction !== 'handoff:' + action)) return;
    const id = this.conversationId || await this.handoffConversation();
    if (!id) return;
    const epoch = ++this.epoch;
    this.unschedule(this.timer);
    this.set({ busy: true, error: '' });
    try {
      await this.client.mutate('handoff:' + id, `/conversations/${id}/handoff`, { action });
      this.setIf(epoch, { pendingAction: '' });
      await this.snapshot(id, epoch);
    } catch (error) {
      this.setIf(epoch, { pendingAction: uncertain(error) ? 'handoff:' + action : '' });
      this.fail(error, epoch);
    } finally { this.setIf(epoch, { busy: false }); }
  }

  chooseOption(key, text) {
    const s = this.state;
    if (!s.guidance || key !== s.guidance.questionKey || !s.guidance.options.includes(text)
      || s.draft || s.loading || s.busy || s.fatal || !s.canSend || s.readOnly || (s.run && s.run.status !== 'succeeded') || s.generating || s.uncertainRun || s.pendingSend || s.pendingAction) return;
    if (s.guidance.answerType === 'multiple') {
      let selected = s.selectedOptions.includes(text) ? s.selectedOptions.filter(x => x !== text) : [...s.selectedOptions, text];
      if (text === '暂时没有') selected = selected.includes(text) ? [text] : [];
      else selected = selected.filter(x => x !== '暂时没有');
      this.set({ selectedOptions: selected, selectedOptionMap: Object.fromEntries(selected.map(x => [x, true])) });
      return;
    }
    this.input(text);
    return this.send();
  }

  confirmOptions() {
    const s = this.state;
    if (s.guidance?.answerType !== 'multiple' || !s.selectedOptions.length || s.draft || s.busy || s.loading || s.readOnly || s.pendingSend || s.pendingAction || s.generating) return;
    this.input(s.selectedOptions.join('、'));
    return this.send();
  }

  async sendMessage() {
    const s = this.state;
    if (!this.visible || s.busy || s.loading || s.fatal || s.pendingAction) return;
    if (!s.pendingSend && (!s.canSend || (this.operationalDraft == null && (s.generating || s.uncertainRun)) || (s.conversation && (s.conversation.status !== 'open' || !['ai', 'human', 'handoff_requested'].includes(s.conversation.mode))))) return;
    const text = s.pendingText || s.draft.trim();
    if (!text || text.length > s.maxChars) return;
    const epoch = this.epoch;
    let committed = false;
    this.set({ busy: true, error: '', pendingText: text });
    try {
      if (!this.conversationId) {
        const entry = await this.ensureEntry();
        if (!this.valid(epoch) || !entry) return;
        const created = await this.client.mutate('create', '/conversations', { entryToken: entry.entryToken });
        if (!this.valid(epoch)) return;
        this.conversationId = created.id;
        this.set({ conversation: created });
      }
      const result = await this.client.mutate(`send:${this.conversationId}`, `/conversations/${this.conversationId}/messages`, {
        content: { version: 1, blocks: [{ type: 'text', text }] },
      });
      if (!this.valid(epoch)) return;
      committed = true;
      this.set({ draft: this.operationalDraft == null ? '' : this.operationalDraft, pendingText: '', pendingSend: false });
      this.operationalDraft = null;
      this.applyRun({ ...result, id: result.runId });
      await this.snapshot(this.conversationId, epoch);
    } catch (error) {
      if (this.valid(epoch)) {
        this.set({ pendingSend: !committed && uncertain(error), ...(committed ? { pendingText: '' } : {}) });
        this.fail(error, epoch);
        if (!committed && uncertain(error)) this.set({ error: '发送结果尚未确认。点“确认发送结果”会核对同一条消息，不会重复提交。' });
      }
    } finally { this.setIf(epoch, { busy: false }); }
  }

  async selectConversation(id) {
    if (this.state.busy || this.state.pendingSend || this.state.pendingAction) return;
    this.unschedule(this.timer);
    const epoch = ++this.epoch;
    this.conversationId = id;
    this.set({ loading: true, messages: [], conversation: null, run: null, draft: '', error: '', fatal: false, citation: null, shareReferenceEntry: '' });
    try { await this.snapshot(id, epoch); this.setIf(epoch, { loading: false }); }
    catch (error) { this.fail(error, epoch, true); }
  }

  newConversation() {
    if (this.state.busy || this.state.pendingSend || this.state.pendingAction) return;
    this.unschedule(this.timer); this.epoch += 1; this.conversationId = '';
    this.startedNew = true;
    // Preserve the validated enterprise when arriving from an old conversation.
    this.set({ conversation: null, readOnly: false, messages: [], messageCursor: null, draft: '', pendingText: '', loading: false, error: '', fatal: false });
    this.set({ welcomeText: this.entry && this.entry.guidanceOpening || WELCOME, guidanceEnabled: !!(this.entry && this.entry.guidanceEnabled), guidance: this.entry && this.entry.guidance || null });
    this.applyRun(null);
    return this.refresh();
  }

  async loadHistory(more = false) {
    if (this.state.historyLoading) return;
    const epoch = this.epoch;
    this.set({ historyLoading: true, historyError: '' });
    try {
      const result = await this.historyPage(more ? this.state.historyCursor : null);
      if (!this.valid(epoch) || !result) return;
      this.set({ history: more ? this.state.history.concat(historyForView(result.items)) : historyForView(result.items), historyCursor: result.nextCursor });
    } catch (error) {
      if (error.statusCode === 401 || error.statusCode === 403) this.fail(error, epoch);
      else this.setIf(epoch, { historyError: errorCopy(error) });
    } finally { this.setIf(epoch, { historyLoading: false }); }
  }

  async olderMessages() {
    if (!this.state.messageCursor || this.state.busy) return;
    const epoch = this.epoch;
    this.set({ busy: true });
    try {
      const result = await this.client.read(`/conversations/${this.conversationId}/messages`, { limit: 30, beforeSeq: this.state.messageCursor });
      if (!this.valid(epoch)) return;
      const ids = new Set(this.state.messages.map(item => item.id));
      this.set({ messages: messagesForView(result.items.filter(item => !ids.has(item.id))).concat(this.state.messages), messageCursor: result.nextCursor });
    } catch (error) { this.fail(error, epoch); }
    finally { this.setIf(epoch, { busy: false }); }
  }

  action(action) {
    if (action.startsWith('handoff:')) return this.handoff(action.slice(8));
    if (this.flight) return this.flight;
    this.flight = this.performAction(action).finally(() => { this.flight = null; });
    return this.flight;
  }

  async performAction(action) {
    if (!this.visible || !this.valid(this.epoch) || this.state.busy || this.state.pendingSend || !this.conversationId || (this.state.pendingAction && this.state.pendingAction !== action)) return;
    if (!this.state.pendingAction && action === 'retry' && (!this.state.retryable || !this.state.canSend || this.state.readOnly)) return;
    if (!this.state.pendingAction && action === 'cancel' && !this.state.generating) return;
    const epoch = ++this.epoch, id = this.conversationId;
    if (!this.state.pendingAction) this.actionRunId = this.state.run && this.state.run.id;
    const runId = this.actionRunId;
    let committed = false;
    this.set({ busy: true, error: '', historyLoading: false }); this.unschedule(this.timer);
    try {
      if (action === 'archive') {
        await this.client.mutate(`archive:${id}`, `/conversations/${id}`, { action: 'archive', expectedVersion: this.state.conversation.version }, 'PATCH');
      } else {
        await this.client.mutate(`${action}:${runId}`, `/runs/${runId}/${action}`);
      }
      committed = true;
      this.setIf(epoch, { pendingAction: '' });
      await this.snapshot(id, epoch);
    } catch (error) {
      this.setIf(epoch, { pendingAction: !committed && uncertain(error) ? action : '' });
      this.fail(error, epoch);
    } finally { this.setIf(epoch, { busy: false }); }
  }

  async openCitation(id) {
    const epoch = this.epoch;
    this.citationRequest = (this.citationRequest || 0) + 1;
    const request = this.citationRequest;
    this.set({ citation: null, citationLoading: true, citationError: '' });
    try {
      const data = await this.client.read(`/citations/${id}`);
      if (!this.valid(epoch) || request !== this.citationRequest) return;
      const citation = await this.referenceImage(data);
      if (!this.valid(epoch) || request !== this.citationRequest) return;
      this.set({ citation });
      if (!citation.available) await this.snapshot(this.conversationId, epoch);
    } catch (error) {
      if (error.statusCode === 401 || error.statusCode === 403 || error.statusCode === 404) this.fail(error, epoch);
      else if (request === this.citationRequest) this.setIf(epoch, { citationError: errorCopy(error) });
    } finally { if (request === this.citationRequest) this.setIf(epoch, { citationLoading: false }); }
  }

  async constructionContact(projectId, messageId) {
    if (!this.visible || this.state.fatal || this.state.loading || this.state.contactLoading || !this.conversationId) return null;
    const message = this.state.messages.find(m => m.id === String(messageId));
    const action = message?.constructionContacts?.find(c => c.projectId === String(projectId));
    if (!action || message.available === false) return null;
    const epoch = this.epoch, cid = this.conversationId;
    this.set({ contactLoading: true, error: '' });
    try {
      const contact = await this.client.read(`/conversations/${cid}/construction-contact`, { projectId: String(projectId), messageId: String(messageId) });
      if (!this.visible || !this.valid(epoch) || this.conversationId !== cid) return null;
      if (contact.projectId !== String(projectId) || contact.stageKey !== action.stageKey || !/^\+?\d{5,20}$/.test(contact.phone || '')) throw { code: 'construction_contact_unavailable' };
      return contact.phone;
    } catch (error) {
      if ((error.code || error.error) === 'construction_contact_unavailable') this.setIf(epoch, { error: '当前阶段联系人已变更或暂不可用，请刷新后再联系。' });
      else this.fail(error, epoch);
      return null;
    } finally { this.setIf(epoch, { contactLoading: false }); }
  }
  cancelSiteWatch(messageId) {
    if (!this.visible || this.state.busy || this.state.pendingSend || this.state.pendingAction || this.state.loading || this.state.fatal) return;
    const watch = this.state.messages.find(m => m.id === String(messageId) && m.available !== false)?.siteWatch;
    if (!watch || !watch.cancelText) return;
    this.operationalDraft = this.state.draft;
    this.set({ pendingText: watch.cancelText });
    return this.send();
  }
}

module.exports = { ChatController, initial };
