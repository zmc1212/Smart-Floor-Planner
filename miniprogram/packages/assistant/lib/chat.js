const { AssistantClient, entryInput, errorCopy, uncertain, messagesForView } = require('./client');
const ACTIVE = ['queued', 'running'];
const WELCOME = '你好，我是小K。\n先聊聊你的装修想法吧。';
function historyForView(items) {
  return (items || []).map(item => {
    const time = new Date(item.createdAt);
    const pad = value => String(value).padStart(2, '0');
    const createdLabel = Number.isNaN(time.getTime()) ? '装修咨询' : `${time.getFullYear()}/${pad(time.getMonth() + 1)}/${pad(time.getDate())} ${pad(time.getHours())}:${pad(time.getMinutes())}`;
    return { ...item, createdLabel, createdDateLabel: Number.isNaN(time.getTime()) ? '' : createdLabel.split(' ')[0] };
  });
}
const WINDOW = 30;
const MAX_BACKLOG = 200;
const FULL_SYNC_MS = 60000;
const DELTA_PAGES = 3;
// `seq` is a bigint rendered as a decimal string; Number arithmetic would lose
// precision above Number.MAX_SAFE_INTEGER.
function seqOrder(left, right) {
  const a = String(left || '0'), b = String(right || '0');
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}
function previousSeq(value) {
  const digits = String(value).split('');
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    if (digits[index] !== '0') { digits[index] = String(Number(digits[index]) - 1); break; }
    digits[index] = '9';
  }
  return digits.join('').replace(/^0+(?=\d)/, '');
}
function withinBacklog(from, to, max) {
  let current = String(to);
  for (let step = 0; step <= max; step += 1) {
    if (current === String(from)) return true;
    current = previousSeq(current);
  }
  return false;
}
function mergeMessages(window, incoming) {
  const merged = new Map();
  for (const item of window || []) merged.set(String(item.id), item);
  for (const item of incoming || []) if (!merged.has(String(item.id))) merged.set(String(item.id), item);
  return [...merged.values()].sort((left, right) => seqOrder(left.seq, right.seq));
}
// A pure append reaches the view through `messages[n]` paths so the runtime
// never serializes the whole list again. Anything else ships the full array.
function appendPatch(patch, previousLength) {
  const from = patch.messagesAppendFrom;
  const fallback = { ...patch };
  delete fallback.messagesAppendFrom;
  if (typeof from !== 'number' || from !== previousLength || !Array.isArray(patch.messages) || from > patch.messages.length) return fallback;
  const next = { ...fallback };
  delete next.messages;
  for (let index = from; index < patch.messages.length; index += 1) next[`messages[${index}]`] = patch.messages[index];
  return next;
}
const initial = () => ({
  loading: true, busy: false, error: '', fatal: false, needsLogin: false,
  enterpriseId: '', enterpriseName: '', canSend: false, maxChars: 4000,
  shareReferenceEntry: '',
  welcomeText: WELCOME, guidanceEnabled: false, guidance: null, selectedOptions: [], selectedOptionMap: {},
  conversation: null, readOnly: false, messages: [], messageCursor: null, run: null, sending: false,
  history: [], historyCursor: null, historyLoading: false, historyError: '',
  draft: '', pendingText: '', pendingSend: false, pendingAction: '', handoffBusy: false,
  runLabel: '', retryable: false, generating: false, uncertainRun: false,
  citation: null, citationLoading: false, citationError: '',
  contactLoading: false,
});

class ChatController {
  constructor({ emit, client = new AssistantClient(), identity = () => '', schedule = setTimeout, unschedule = clearTimeout, referenceImage = async value => value,
    resumeConversationId = '', onResumeInvalid = null }) {
    this.emit = emit; this.client = client; this.identity = identity;
    this.schedule = schedule; this.unschedule = unschedule;
    this.referenceImage = referenceImage;
    this.resumeConversationId = String(resumeConversationId || ''); this.onResumeInvalid = onResumeInvalid;
    this.state = initial(); this.epoch = 0; this.visible = false; this.hidden = false; this.ready = false;
    this.latestSeq = ''; this.seqConversationId = ''; this.rawMessages = null; this.lastFullSyncAt = 0; this.seqSupported = false;
  }

  resetWindow() { this.latestSeq = ''; this.seqConversationId = ''; this.rawMessages = null; this.lastFullSyncAt = 0; this.seqSupported = false; }

  set(patch) { Object.assign(this.state, patch); this.emit(patch); }
  valid(epoch) { return this.epoch === epoch && this.session === this.identity(); }
  hide() { this.visible = false; this.hidden = true; this.showTicket = (this.showTicket || 0) + 1; this.unschedule(this.timer); }
  dispose() { this.hide(); this.epoch += 1; }
  clear() {
    this.operationalDraft = null;
    this.dispose(); this.client.pending.clear(); this.entry = null; this.entryExpiry = 0;
    this.ready = false; this.resetWindow();
    this.conversationId = ''; this.startedNew = false; this.set(initial());
  }

  async show(options) {
    const ticket = this.showTicket = (this.showTicket || 0) + 1;
    // Finish the same in-memory write across a background/foreground cycle.
    // Discarding an accepted response here could make a draft look unsent.
    if (this.flight) await this.flight;
    if (ticket !== this.showTicket) return;
    const identity = this.identity();
    const hidden = !!this.hidden;
    if (this.session && this.session !== identity) this.clear();
    this.hidden = false;
    this.session = identity;
    this.visible = true;
    this.options = options || this.options || {};
    this.set({ busy: false, citation: null, citationLoading: false, citationError: '', historyLoading: false });
    if (!identity) {
      this.set({ ...initial(), loading: false, fatal: true, needsLogin: true, error: '登录后，小K就能为你保存装修咨询记录。' });
      return;
    }
    const target = this.conversationId || (!this.startedNew && (this.options.conversationId || this.entry?.resumeConversationId));
    // A visible chat stays usable while only its current server projection is
    // synced. An empty welcome screen needs no request until its entry expires.
    if (this.ready && !this.state.fatal && !this.state.error && !target && this.entry && Date.now() < this.entryExpiry) return;
    // Only a page hide followed by show with a conversation on screen is a real
    // resume. Revoked access reprojects messages without advancing `lastSeq`,
    // so the resumed view must re-read the full window instead of trusting the
    // 60s idle sync. Repeated show calls while already visible stay incremental.
    const resume = hidden && this.ready && !this.state.fatal && !!target;
    return this.refresh({ forceEntry: !this.ready || this.state.fatal, background: this.ready && !this.state.fatal, resume });
  }

  async ensureEntry(force = false) {
    if (!force && this.entry && Date.now() < this.entryExpiry) return this.entry;
    const epoch = this.epoch;
    if (this.entryFlight && this.entryEpoch === epoch && this.valid(epoch)) return this.entryFlight;
    this.entryEpoch = epoch;
    const flight = this.readEntry(epoch).finally(() => {
      if (this.entryFlight === flight) this.entryFlight = null;
    });
    this.entryFlight = flight;
    return flight;
  }

  async readEntry(epoch) {
    try {
      return await this.readEntryContext(epoch);
    } catch (error) {
      const code = error && (error.code || error.error);
      if (code !== 'assistant_resource_not_found' || !this.resumeConversationId || !this.options
        || String(this.options.conversationId || '') !== this.resumeConversationId) throw error;
      // A remembered conversation can be archived or revoked on another
      // device; fall back to the plain entry instead of blocking the chat.
      const stale = this.resumeConversationId;
      this.resumeConversationId = '';
      delete this.options.conversationId;
      if (this.onResumeInvalid) this.onResumeInvalid(stale);
      return this.readEntryContext(epoch);
    }
  }

  async readEntryContext(epoch) {
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

  refresh({ forceEntry = true, background, resume = false } = {}) {
    if (!this.visible || this.state.busy) return Promise.resolve();
    // A real resume supersedes any in-flight idle refresh: returning that
    // flight could keep a delta/no-op read and miss the server's current
    // projection. The new epoch invalidates the older snapshot.
    if (!resume && this.refreshFlight && this.valid(this.refreshEpoch)) return this.refreshFlight;
    const epoch = ++this.epoch;
    this.refreshEpoch = epoch;
    this.unschedule(this.timer);
    // A re-sync of a conversation that is already on screen (page re-entry,
    // location or media refresh) must not blank the rendered history. Only the
    // first read of a view shows the loader.
    const silent = background === undefined
      ? this.ready || !!this.state.conversation || this.state.messages.length > 0
      : background;
    this.set({ loading: !silent, error: '', fatal: false, contactLoading: false });
    const flight = this.refreshState(epoch, forceEntry, !!background, resume).finally(() => {
      if (this.refreshFlight === flight) this.refreshFlight = null;
    });
    this.refreshFlight = flight;
    return flight;
  }

  async refreshState(epoch, forceEntry, background, resume = false) {
    try {
      const entry = await this.ensureEntry(forceEntry);
      if (!this.valid(epoch) || !entry) return;
      // History is read by loadHistory when its sheet is opened, independently
      // of the conversation's critical path and availability.
      const target = this.conversationId || (!this.startedNew && (this.options.conversationId || this.entry.resumeConversationId));
      if (target) await this.snapshot(target, epoch, background, resume);
      if (!this.valid(epoch)) return;
      this.ready = true;
      this.setIf(epoch, { loading: false, error: this.state.pendingSend
        ? '发送结果尚未确认，请确认同一条消息的发送结果。'
        : this.state.pendingAction ? '操作结果尚未确认，请核对同一次操作。' : '' });
    } catch (error) { this.fail(error, epoch, !background); }
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
      this.ready = false; this.resetWindow();
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

  async snapshot(id, epoch, background = false, resume = false) {
    const ticket = this.snapshotTicket = (this.snapshotTicket || 0) + 1;
    // A conversation this view has never synced has no cursor to seek from, so
    // its full window is known upfront and still loads alongside the metadata.
    // A server that did not report `lastSeq` cannot answer a delta either. A
    // real resume always reprojects the window: access can be revoked without
    // any new sequence.
    const full = !resume && this.seqConversationId === id && this.latestSeq && this.seqSupported
      ? null
      : this.client.read(`/conversations/${id}/messages`, { limit: WINDOW });
    // A stale or backgrounded snapshot can discard this read before awaiting it.
    if (full) full.catch(() => {});
    const conversation = await this.client.read(`/conversations/${id}`);
    if (!this.valid(epoch) || ticket !== this.snapshotTicket) return;
    if (background && (!this.visible || this.state.busy || this.state.pendingSend || this.state.pendingAction)) {
      this.scheduleConversation(id, epoch); return;
    }
    const window = await this.readWindow(id, conversation, full, resume);
    if (!this.valid(epoch) || ticket !== this.snapshotTicket) return;
    if (background && (!this.visible || this.state.busy || this.state.pendingSend || this.state.pendingAction)) {
      this.scheduleConversation(id, epoch); return;
    }
    const sameQuestion = this.conversationId === id && this.state.guidance?.questionKey === conversation.guidance?.questionKey;
    this.conversationId = id;
    const pendingMessage = this.client.pending.get('send:' + id), pendingHandoff = this.client.pending.get('handoff:' + id);
    if (pendingMessage) this.set({ pendingSend: true, pendingText: pendingMessage.body.content.blocks[0].text, draft: pendingMessage.body.content.blocks[0].text });
    if (pendingHandoff) this.set({ pendingAction: 'handoff:' + pendingHandoff.body.action });
    this.set({ conversation, readOnly: conversation.status !== 'open' || !['ai', 'human', 'handoff_requested'].includes(conversation.mode) });
    if (window) this.commitWindow(window);
    this.set({ welcomeText: conversation.guidanceOpening || WELCOME, guidanceEnabled: !!conversation.guidanceEnabled, guidance: conversation.guidance || null,
      ...(!sameQuestion ? { selectedOptions: [], selectedOptionMap: {} } : {}) });
    this.applyRun(conversation.mode === 'ai' ? conversation.latestRun : null);
    if (this.visible && conversation.status === 'open' && (['handoff_requested', 'human'].includes(conversation.mode) || !this.state.run || this.state.run.status === 'succeeded')) {
      this.scheduleConversation(id, epoch, conversation.mode === 'ai' ? 7000 : 3000);
    }
  }

  // Reads the authoritative conversation metadata, then only the messages that
  // this view does not already render. Returns null when the rendered window is
  // still current, so an idle poll never rewrites the message list. Otherwise it
  // returns `{ view, cache }` without touching any internal state: a read can
  // finish after a newer snapshot (or after the conversation lost access), and
  // its projection must never become the baseline a later delta merges into.
  // `commitWindow` performs that write only while the request is still current.
  async readWindow(id, conversation, full, resume = false) {
    const latest = conversation.lastSeq === undefined || conversation.lastSeq === null ? '' : String(conversation.lastSeq);
    const seqSupported = latest !== '';
    const synced = this.seqConversationId === id ? this.latestSeq : '';
    // Withdrawn sources and media never advance a sequence, so the window is
    // reprojected in full at a bounded interval even while nothing is appended.
    const stale = Date.now() - this.lastFullSyncAt >= FULL_SYNC_MS;
    // A resume is an explicit re-read: skip the cursor shortcut and the delta
    // path entirely so the server's current projection replaces the rendered
    // one even when `lastSeq` and the full-sync clock say it is still current.
    if (!resume) {
      if (latest && synced && latest === synced && !stale) return null;
      if (!stale && latest && synced && withinBacklog(synced, latest, MAX_BACKLOG)) {
        const delta = await this.readDelta(id, synced);
        if (delta) return delta;
      }
    }
    const data = await (full || this.client.read(`/conversations/${id}/messages`, { limit: WINDOW }));
    const items = data.items || [];
    const latestSeq = data.latestSeq !== undefined
      ? String(data.latestSeq)
      : items.reduce((newest, item) => seqOrder(item.seq, newest) > 0 ? String(item.seq) : newest, latest);
    return {
      view: { messages: messagesForView(items), messageCursor: data.nextCursor },
      cache: { rawMessages: items, seqConversationId: id, lastFullSyncAt: Date.now(), latestSeq, seqSupported },
    };
  }

  // Every page of a burst is read before anything is returned, so a discarded
  // delta leaves no partially merged cursor behind.
  async readDelta(id, cursor) {
    let after = cursor, incoming = [], latestSeq = cursor, drained = false;
    for (let page = 0; page < DELTA_PAGES; page += 1) {
      const data = await this.client.read(`/conversations/${id}/messages`, { limit: WINDOW, afterSeq: after });
      // Only the delta contract echoes a usable cursor. A reset or an older
      // server response falls back to the authoritative full window.
      if (data.reset === true || data.afterCursor === undefined || data.afterCursor === null) return null;
      const items = data.items || [];
      // These fields decide which earlier bubble owns the latest decision card;
      // reprojecting the whole window is the only stable answer.
      if (items.some(item => item.planDecision || item.publicConsent)) return null;
      incoming = incoming.concat(items);
      after = String(data.afterCursor);
      if (data.latestSeq !== undefined && seqOrder(data.latestSeq, latestSeq) > 0) latestSeq = String(data.latestSeq);
      if (!data.hasMore) { drained = true; break; }
    }
    // Filtered sequences can advance last_seq without a visible message; the
    // window read below then advances the cursor without a redraw.
    if (!incoming.length) return null;
    const raw = mergeMessages(this.rawMessages || [], incoming);
    return {
      view: { messages: this.windowView(raw), messageCursor: this.state.messageCursor, appended: incoming.length },
      cache: { rawMessages: raw, seqConversationId: id, latestSeq: drained && seqOrder(latestSeq, after) > 0 ? latestSeq : after },
    };
  }

  // The single write point for a read result. Callers must have re-checked the
  // epoch, conversation and snapshot ticket first.
  commitWindow(window) {
    Object.assign(this, window.cache);
    if (window.view) this.applyWindow(window.view);
  }

  // A delta that only grew the tail keeps the rendered prefix untouched and
  // ships as `messages[n]` paths; any other window replaces the array whole.
  applyWindow(window) {
    const appended = window.appended || 0;
    const from = window.messages.length - appended;
    const pureAppend = appended > 0 && from === this.state.messages.length;
    Object.assign(this.state, { messages: window.messages, messageCursor: window.messageCursor });
    this.emit(pureAppend ? { messages: window.messages, messageCursor: window.messageCursor, messagesAppendFrom: from } : { messages: window.messages, messageCursor: window.messageCursor });
  }

  // Rebuild the rendered list from the merged window while keeping earlier
  // pages the customer already pulled above it.
  windowView(raw) {
    const view = messagesForView(raw);
    const cutoff = raw.length ? String(raw[0].seq || '0') : '';
    if (!cutoff) return view;
    const rendered = new Set(raw.map(item => String(item.id)));
    return this.state.messages
      .filter(item => !rendered.has(String(item.id)) && seqOrder(item.seq, cutoff) < 0)
      .concat(view);
  }

  applyRun(run) {
    const status = run && run.status;
    this.set({ run, generating: ACTIVE.includes(status), uncertainRun: status === 'indeterminate' && run.usageReconciled !== true,
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
    if (this.state.busy || this.state.pendingSend || (this.state.pendingAction && this.state.pendingAction !== 'handoff:' + action)) return false;
    this.set({ handoffBusy: true });
    try {
      const id = this.conversationId || await this.handoffConversation();
      if (!id) return false;
      const epoch = ++this.epoch;
      this.unschedule(this.timer);
      this.set({ busy: true, error: '' });
      try {
        const body = { action };
        if (this.state.conversation && this.state.conversation.reviewWorkflow === 'langgraph') {
          body.expectedVersion = this.state.conversation.version;
          if (action === 'request') Object.assign(body, { consent: true, mediaConsent: true, contactConsent: false, phone: '' });
        }
        const receipt = await this.client.mutate('handoff:' + id, `/conversations/${id}/handoff`, body);
        if (!this.valid(epoch)) return false;
        this.set({ pendingAction: '' });
        // The write receipt already carries the committed mode. For a new
        // reception request, apply it before the message snapshot so the
        // reception label flips on commit instead of waiting for two more
        // reads. Cancel/end keep the banner until the snapshot lands, so the
        // banner removal and the closing system message render together.
        if (action === 'request' && receipt && receipt.mode && this.state.conversation) {
          this.set({ conversation: { ...this.state.conversation, mode: receipt.mode,
            status: receipt.status || this.state.conversation.status,
            version: typeof receipt.version === 'number' ? receipt.version : this.state.conversation.version } });
        }
        await this.snapshot(id, epoch);
        return this.valid(epoch);
      } catch (error) {
        this.setIf(epoch, { pendingAction: uncertain(error) ? 'handoff:' + action : '' });
        this.fail(error, epoch);
        return false;
      } finally { this.setIf(epoch, { busy: false }); }
    } finally { this.set({ handoffBusy: false }); }
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
    // `sending` keeps the approved conversation view (optimistic message and
    // run state) in place until the authoritative projection of this send is
    // applied. `messages` and `pendingText` are both transiently empty between
    // the accepted write and that read, which must not re-render the welcome
    // screen the customer already left.
    this.set({ busy: true, error: '', pendingText: text, sending: true });
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
        content: { version: 1, blocks: [{ type: 'text', text }],
          ...(s.conversation?.mode === 'ai' && s.conversation.reportContext?.selected ? { reportContextVersion: s.conversation.reportContext.version } : {}) },
        ...(this.speechInput ? { speech: this.speechInput } : {}),
      });
      if (!this.valid(epoch)) return;
      committed = true;
      this.speechInput = null;
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
    } finally { this.setIf(epoch, { busy: false, sending: false }); }
  }

  async selectConversation(id) {
    if (this.state.busy || this.state.pendingSend || this.state.pendingAction) return;
    this.unschedule(this.timer);
    const epoch = ++this.epoch;
    this.conversationId = id;
    this.resetWindow();
    this.set({ loading: true, messages: [], conversation: null, run: null, draft: '', error: '', fatal: false, citation: null, shareReferenceEntry: '' });
    try { await this.snapshot(id, epoch); this.setIf(epoch, { loading: false }); }
    catch (error) { this.fail(error, epoch, true); }
  }

  newConversation() {
    if (this.state.busy || this.state.pendingSend || this.state.pendingAction) return;
    this.unschedule(this.timer); this.epoch += 1; this.conversationId = '';
    this.startedNew = true;
    this.resetWindow();
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

module.exports = { ChatController, initial, appendPatch };
