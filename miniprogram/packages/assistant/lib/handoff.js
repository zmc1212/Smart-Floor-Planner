const { AssistantClient, errorCopy, uncertain } = require('./client');
const { rowsFor } = require('./requirements');
const initial = () => ({ loading: true, busy: false, error: '', fatal: false, pending: '', staff: false,
  items: [], detail: null, recipients: [], recipientIndex: 0, leads: [], leadIndex: 0, consent: false, contactConsent: false,
  archiveConsent: false, phone: '', text: '', fields: [], packetMessages: [], messages: [], candidates: [], corrections: [], reviewInput: null, feedback: '' });
class HandoffController {
  constructor({ emit, identity, client = new AssistantClient(), schedule = setTimeout, unschedule = clearTimeout }) {
    Object.assign(this, { emit, identity, client, schedule, unschedule }); this.state = initial(); this.epoch = 0;
  }
  set(patch) { Object.assign(this.state, patch); this.emit(patch); }
  valid(epoch) { return this.visible && epoch === this.epoch && this.session === this.identity(); }
  hide() { this.visible = false; this.unschedule(this.timer); }
  dispose() { this.hide(); this.epoch++; }
  async show(options) {
    if (this.flight) await this.flight;
    const session = this.identity();
    if (this.session && session !== this.session) { this.epoch++; this.id = ''; this.client.pending.clear(); this.set(initial()); }
    this.session = session; this.visible = true; this.options = options;
    this.set({ staff: options.staff === '1', loading: true });
    this.id = options.conversationId || this.id || '';
    const pending = this.client.pending.get('handoff:' + this.id);
    if (pending) this.set({ pending: pending.body.action, text: pending.body.action === 'reply' ? pending.body.text : '' });
    return this.refresh();
  }
  fail(error, epoch) {
    if (!this.valid(epoch)) return;
    if (error.statusCode === 401 || ['assistant_capability_forbidden', 'assistant_resource_not_found', 'identity_context_invalid'].includes(error.code || error.error)) {
      this.client.pending.clear(); this.unschedule(this.timer); this.set({ ...initial(), loading: false, staff: this.state.staff, fatal: true, error: '当前身份已无法访问，请返回并重新登录或切换身份。' }); this.epoch++; return;
    }
    this.set({ error: errorCopy(error), loading: false });
  }
  async refresh() {
    if (!this.visible || this.state.busy) return;
    const epoch = this.epoch;
    this.unschedule(this.timer);
    try {
      if (this.state.staff && !this.id) {
        const result = await this.client.read('/handoffs');
        if (this.valid(epoch)) this.set({ items: result.items, detail: null, loading: false, error: '' });
      } else {
        const result = await this.client.read(this.state.staff ? '/handoffs/' + this.id : '/conversations/' + this.id + '/handoff');
        if (!this.valid(epoch)) return;
        const packet = result.handoff && result.handoff.packet || {};
        // Preview the customer's existing summary before consent; never create a draft here.
        const preview = !this.state.staff && (!result.handoff || ['ended', 'cancelled'].includes(result.handoff.state))
          ? await this.client.read('/conversations/' + this.id + '/requirements') : null;
        if (!this.valid(epoch)) return;
        const summary = packet.summary;
        const currentSummary = preview && (preview.latest || preview.confirmed);
        const corrections = packet.corrections || [];
        const fields = preview ? (currentSummary && currentSummary.status !== 'redacted' ? rowsFor(currentSummary) : []) : summary ? rowsFor({ status: summary.status, draftFields: summary.draft_fields, confirmedFields: summary.confirmed_fields }) : [];
        for (const field of fields) {
          const correction = corrections.filter(c => c.field === field.key).slice(-1)[0];
          field.sourceMessageId = summary?.draft_fields?.[field.key]?.sourceMessageId || '';
          if (correction) { field.text = correction.text; field.sourceMessageId = correction.sourceMessageId; field.internal = true; }
        }
        this.set({ detail: result, recipients: [{ id: '', name: '企业接待团队' }, ...(result.recipients || [])],
          leads: result.leads || [],
          fields, candidates: result.candidates || [], corrections,
          packetMessages: packet.messages || [], messages: result.messages || [], loading: false, error: '' });
      }
      const active = this.state.detail && this.state.detail.handoff;
      // Keep pre-consent recipient/lead choices stable; the server revalidates them on submit.
      if (this.valid(epoch) && !this.state.pending && (this.state.staff || (active && ['waiting', 'active'].includes(active.state)))) this.timer = this.schedule(() => this.refresh(), 3000);
    } catch (error) { this.fail(error, epoch); }
  }
  select(id) { this.id = id; this.set({ loading: true, detail: null, fields: [], packetMessages: [], messages: [], text: '' }); return this.refresh(); }
  input(key, value) { if (!this.state.busy && !this.state.pending && !this.state.fatal) this.set({ [key]: value }); }
  act(action) {
    if (this.flight) return this.flight;
    this.flight = this.perform(action).finally(() => { this.flight = null; }); return this.flight;
  }
  async perform(action) {
    const s = this.state, epoch = this.epoch;
    if (!this.valid(epoch) || s.fatal || s.loading || s.busy || !this.id || (s.pending && s.pending !== action)) return;
    let body = { action };
    if (['correct', 'associate', 'link'].includes(action)) body = { ...body, ...s.reviewInput };
    if (action === 'request') {
      if (!s.consent) { this.set({ error: '请先阅读并同意分享本次咨询资料。' }); return; }
      body = { ...body, consent: true, mediaConsent: true, contactConsent: s.contactConsent, phone: s.contactConsent ? s.phone : '', recipientId: s.recipients[s.recipientIndex]?.id || null };
      if (s.archiveConsent && s.leads[s.leadIndex]) { body.leadId = s.leads[s.leadIndex].id; body.archiveConsent = true; }
    }
    if (action === 'reply') { if (!s.text.trim()) return; body.text = s.text.trim(); }
    this.unschedule(this.timer); this.set({ busy: true, error: '' });
    let committed = false;
    try {
      await this.client.mutate('handoff:' + this.id, s.staff ? '/handoffs/' + this.id : '/conversations/' + this.id + '/handoff', body);
      committed = true;
      if (epoch !== this.epoch || this.session !== this.identity()) return;
      this.set({ pending: '', text: action === 'reply' ? '' : s.text, reviewInput: null,
        feedback: ['correct', 'associate', 'link'].includes(action) ? '已保存，仅更新本次咨询的内部记录。' : '' });
      if (s.staff && ['end', 'release'].includes(action)) { this.id = ''; this.set({ detail: null, fields: [], packetMessages: [], messages: [] }); }
    } catch (error) {
      if (epoch === this.epoch && this.session === this.identity()) { this.set({ pending: uncertain(error) ? action : '' }); this.fail(error, epoch); }
    } finally {
      if (epoch === this.epoch && this.session === this.identity()) this.set({ busy: false });
    }
    if (committed && this.valid(epoch)) await this.refresh();
    return committed;
  }
  review(action, input) {
    if (this.state.busy || this.state.pending || this.state.fatal) return;
    this.set({ reviewInput: { ...input, expectedVersion: this.state.detail.version } });
    return this.act(action);
  }
}
module.exports = { HandoffController, initial };
