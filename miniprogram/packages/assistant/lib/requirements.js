const { AssistantClient, errorCopy, uncertain } = require('./client');
const FIELDS = [
  ['housing', '房屋情况', 'requirement-home'], ['household', '居住需求', 'requirement-household'],
  ['style', '风格偏好', 'requirement-style'], ['budget', '预算范围', 'requirement-budget'],
  ['timeline', '装修时间', 'requirement-time'],
  ['room', '房间', 'requirement-home'], ['space', '空间偏好', 'requirement-home'],
  ['usage', '使用方式', 'requirement-household'], ['frequency', '使用频率', 'requirement-time'],
  ['devices', '设备需求', 'requirement-household'],
];
const initial = () => ({ loading: true, busy: false, error: '', needsLogin: false, fatal: false,
  enterpriseName: '', writable: false, summary: null, confirmed: false, dirty: false,
  rows: [], editingKey: '', pending: '', stale: false, redacted: false, confirmedLabel: '', proposal: null, selectedFields: [], reviewMode: false, reviewedSourceSeq: '' });
function rowsFor(summary, seed, changedFields = []) {
  // Schema v3 contains empty optional keys; their presence is not a room brief.
  // Keep the five PPT summary rows, then only optional fields with actual evidence/values.
  return FIELDS.filter(([key]) => ['housing', 'household', 'style', 'budget', 'timeline'].includes(key)
    || changedFields.includes(key) || [summary.draftFields?.[key]?.text, summary.confirmedFields?.[key], seed?.[key]].some(value => String(value || '').trim())).map(([key, label, icon]) => {
    const source = summary.draftFields && summary.draftFields[key] || {};
    const text = seed ? seed[key] : (summary.confirmedFields || {})[key] ?? source.text;
    return { key, label, icon, text: String(text || ''), sourceText: String(source.text || ''), truncated: !!source.truncated };
  });
}
class RequirementsController {
  constructor({ emit, client = new AssistantClient(), identity = () => '' }) {
    this.emit = emit; this.client = client; this.identity = identity; this.state = initial(); this.epoch = 0;
  }
  set(patch) { Object.assign(this.state, patch); this.emit(patch); }
  valid(epoch) { return !this.disposed && this.epoch === epoch && this.session === this.identity(); }
  dispose() { this.disposed = true; this.epoch++; }
  install(summary, seed) {
    const redacted = summary && summary.status === 'redacted';
    this.set({ summary, rows: summary && !redacted ? rowsFor(summary, seed) : [],
      redacted: !!redacted, confirmed: !!summary && summary.status === 'confirmed', dirty: !!seed, editingKey: '', stale: false,
      confirmedLabel: summary && summary.confirmedAt ? '已确认保存' : '', selectedFields: [] });
  }
  installProposal(result, selection = []) {
    const proposal = result.proposal, base = result.latest || { draftFields: {} };
    const selectedFields = FIELDS.map(([k]) => k).filter(k => selection.includes(k) && proposal.diff.some(d => d.field === k));
    const seed = Object.fromEntries(FIELDS.map(([k]) => [k, selectedFields.includes(k)
      ? proposal.summary.draftFields?.[k]?.text || '' : base.draftFields?.[k]?.text || '']));
    this.install(proposal.summary);
    this.set({ proposal, selectedFields, dirty: selectedFields.length > 0,
      rows: rowsFor(base, seed, proposal.diff.map(d => d.field)).map(row => {
        const change = proposal.diff.find(d => d.field === row.key);
        return { ...row, proposalChange: !!change, sourceText: change
          ? `当前：${change.before || '尚未保存'}\n拟改为：${change.after || '删除此项'}\n依据：${change.restoresHistory ? '较早的聊天原话，恢复前需再次确认' : '聊天原话'}` : row.sourceText };
      }) });
    this.proposalResult = result;
  }
  proposalContext() {
    const s = this.state;
    if (!this.valid(this.epoch) || !s.proposal || !s.writable || s.loading || s.busy || s.pending || s.stale || s.fatal) return '';
    return JSON.stringify([this.epoch, s.proposal.id, s.proposal.digest, s.selectedFields]);
  }
  chooseProposal(key, adopt, context) {
    if (!context || context !== this.proposalContext() || !this.state.proposal.diff.some(d => d.field === key)) return;
    const selected = this.state.selectedFields.filter(k => k !== key);
    if (adopt) selected.push(key);
    this.installProposal(this.proposalResult, selected);
  }
  selectedRestorations() {
    return (this.state.proposal?.diff || []).filter(d => d.restoresHistory && this.state.selectedFields.includes(d.field));
  }
  fail(error, epoch) {
    if (!this.valid(epoch)) return;
    const code = error.code || error.error;
    const denied = error.statusCode === 401 || ['assistant_capability_forbidden', 'assistant_resource_not_found', 'identity_context_invalid'].includes(code);
    if (denied) { this.epoch++; this.client.pending.clear(); this.proposalResult = null; this.set({ ...initial(), loading: false, writable: false, fatal: true }); }
    this.set({ error: errorCopy(error), needsLogin: error.statusCode === 401 || code === 'identity_context_invalid',
      ...(code === 'assistant_disabled' ? { writable: false } : {}),
      ...(['requirements_stale', 'version_conflict', 'requirement_target_changed', 'context_changed'].includes(code) ? { stale: true } : {}) });
  }
  async show(id) {
    if (this.flight) await this.flight;
    if (this.disposed) return;
    const session = this.identity();
    if (this.session !== session || this.id !== id) {
      this.epoch++;
      if ((this.session !== undefined && this.session !== session)
        || (this.client.pending.session && this.client.pending.session !== session)) this.client.pending.clear();
      this.set(initial()); this.draftSeed = null; this.proposalResult = null;
    }
    this.session = session; this.id = id;
    if (!session || !/^[1-9]\d{0,18}$/.test(String(id || ''))) {
      this.set({ loading: false, fatal: true, needsLogin: !session, error: !session ? '登录后查看你的装修需求。' : '请从小K对话打开需求摘要。' }); return;
    }
    const epoch = ++this.epoch;
    this.set({ loading: true, error: '', fatal: false });
    try {
      const [entry, conversation, result] = await Promise.all([
        this.client.read('/entry-context', { conversationId: id }, {}, 'POST'),
        this.client.read(`/conversations/${id}`), this.client.read(`/conversations/${id}/requirements`),
      ]);
      if (!this.valid(epoch)) return;
      const writable = entry.canSend && conversation.status === 'open' && conversation.mode === 'ai';
      this.set({ enterpriseName: entry.enterprise.name, writable: !!writable, loading: false });
      // Preserve in-memory edits on background/foreground, but never across identities.
      this.set({ reviewMode: result.reviewMode === true, reviewedSourceSeq: result.sourceSeq || '' });
      const journal = this.client.pending.get(`requirements:${id}`);
      if (result.proposal) {
        const same = this.state.proposal?.id === result.proposal.id && this.state.proposal?.digest === result.proposal.digest;
        const original = journal?.body;
        const originalSelection = original?.action === 'apply_proposal' && original.proposalId === result.proposal.id
          && original.digest === result.proposal.digest ? original.selectedFields : null;
        this.installProposal(result, originalSelection || (same ? this.state.selectedFields : []));
      } else if (this.state.proposal || (!this.state.dirty && !this.state.pending)) {
        this.install(result.latest || result.confirmed); this.set({ proposal: null }); this.proposalResult = null;
      }
      if (journal && journal.path === `/conversations/${id}/requirements`
        && ['draft', 'confirm', 'apply_proposal'].includes(journal.body?.action)) {
        this.set({ pending: journal.body.action === 'draft' ? 'draft' : 'confirm',
          error: '操作结果暂未确认，请点“确认上次操作结果”。会核对同一次操作，不会重复保存。' });
      }
      if (!result.latest && !result.proposal && !result.reviewMode && writable && !this.state.pending) await this.act('draft');
    } catch (error) { this.fail(error, epoch); }
    finally { if (this.valid(epoch)) this.set({ loading: false }); }
  }
  fields() { return Object.fromEntries(this.state.rows.map(row => [row.key, row.text])); }
  input(key, value) {
    if (!this.valid(this.epoch) || this.state.loading || this.state.fatal || !this.state.writable || this.state.busy || this.state.pending || this.state.confirmed || this.state.redacted || this.state.proposal) return;
    this.set({ rows: this.state.rows.map(row => row.key === key ? { ...row, text: Array.from(String(value)).slice(0, 1000).join('') } : row), dirty: true });
  }
  async edit(key) {
    if (!this.valid(this.epoch) || this.state.loading || this.state.fatal || !this.state.writable || this.state.busy || this.state.pending || this.state.redacted) return;
    if (this.state.proposal || (this.state.reviewMode && this.state.confirmed)) return;
    if (this.state.confirmed) {
      this.draftSeed = this.fields();
      await this.act('draft');
    }
    if (!this.state.error && !this.state.confirmed && !this.state.pending) this.set({ editingKey: key });
  }
  act(kind, restoreConsent = false) {
    if (this.flight) return this.flight;
    this.flight = this.perform(kind, restoreConsent).finally(() => { this.flight = null; }); return this.flight;
  }
  async perform(kind, restoreConsent) {
    const s = this.state;
    if (!this.id || !this.valid(this.epoch) || s.busy || s.loading || s.fatal || s.redacted || !s.writable || (s.pending && s.pending !== kind)) return false;
    if (kind === 'confirm' && !s.pending && (!s.summary || s.confirmed || s.stale)) return false;
    const fields = this.fields();
    if (kind === 'confirm' && !s.pending && s.proposal && !s.selectedFields.length) { this.set({ error: '请点铅笔选择要采用的更改；未选的需求会保留原样。' }); return false; }
    if (kind === 'confirm' && !s.pending && !s.proposal && !Object.values(fields).some(v => v.trim())) { this.set({ error: '请至少填写一项装修想法后再确认。' }); return false; }
    const epoch = this.epoch;
    this.set({ busy: true, error: '', editingKey: '' });
    try {
      if (kind === 'draft' && s.reviewMode) return false;
      const original = this.client.pending.get(`requirements:${this.id}`);
      const body = original?.body || (s.proposal ? { action: 'apply_proposal', proposalId: s.proposal.id, digest: s.proposal.digest, consent: true, restoreConsent, selectedFields: s.selectedFields.slice() }
        : kind === 'draft' ? { action: 'draft' } : { action: 'confirm', draftId: s.summary.id, expectedVersion: s.summary.version, fields, consent: true,
          ...(s.reviewMode ? { reviewedSourceSeq: s.reviewedSourceSeq } : {}) });
      const summary = await this.client.mutate(`requirements:${this.id}`, `/conversations/${this.id}/requirements`, body);
      if (!this.valid(epoch)) return false;
      this.install(summary, kind === 'draft' ? this.draftSeed : null); this.draftSeed = null;
      this.proposalResult = null; this.set({ pending: '', error: '', proposal: null }); return true;
    } catch (error) {
      if (this.valid(epoch)) {
        this.set({ pending: uncertain(error) ? kind : '' }); this.fail(error, epoch);
        if (this.valid(epoch) && uncertain(error)) this.set({ error: '操作结果暂未确认，请点“确认上次操作结果”。会核对同一次操作，不会重复保存。' });
      }
      return false;
    } finally { if (this.valid(epoch)) this.set({ busy: false }); }
  }
}
module.exports = { RequirementsController, initial, rowsFor };
