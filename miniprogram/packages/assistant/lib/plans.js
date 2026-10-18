const { AssistantClient, uncertain, errorCopy } = require('./client');
const { PublicMedia, validId } = require('../../../utils/public-site-client');
const labels = { pending_customer: '待你决定', deferred: '稍后决定', approved: '已同意这一版', declined: '未同意这一版', changes_requested: '已要求修改' };
const initialPlans = () => ({ planCards: {}, planPaths: {}, planExpanded: '', planBusy: false, planPending: null, planError: '' });
function planView(p) {
  if (!p || !validId(p.id) || !validId(p.issueId) || !validId(p.mediaId) || !Number.isSafeInteger(p.revision) || p.revision < 1
    || !Number.isSafeInteger(p.number) || p.number < 1 || !Number.isSafeInteger(p.costDeltaCents) || !Number.isSafeInteger(p.scheduleDeltaDays)
    || !labels[p.status] || typeof p.title !== 'string' || typeof p.difference !== 'string') throw { code: 'invalid_response' };
  return { ...p, key: p.id + '_' + p.revision, statusLabel: labels[p.status], canDecide: ['pending_customer','deferred'].includes(p.status),
    costLabel: (p.costDeltaCents >= 0 ? '+' : '') + (p.costDeltaCents / 100).toFixed(2) + '元',
    scheduleLabel: (p.scheduleDeltaDays >= 0 ? '+' : '') + p.scheduleDeltaDays + '天', summary: p.difference.slice(0, 120) };
}
class PlanChatController {
  constructor({ emit, identity, client = new AssistantClient(), media }) {
    Object.assign(this, { emit, identity, client }); this.state = initialPlans(); this.epoch = 0; this.reasons = {};
    this.media = media || new PublicMedia({ identity, emit: p => {
      if (p.publicMediaRevoked) this.set({ planCards: {}, planExpanded: '', planError: '方案原件已更新或不可用，请刷新对话。' });
      if (p.publicPaths) this.set({ planPaths: p.publicPaths });
      if (p.publicError) this.set({ planError: '方案原件暂时无法读取，请重新连接。' });
    } });
  }
  set(p) { Object.assign(this.state, p); this.emit(p); }
  valid(epoch) { return epoch === this.epoch && this.session === this.identity(); }
  clear() { this.epoch++; this.media.clear(); this.cid = ''; this.reasons = {}; this.set(initialPlans()); }
  reason(id) { return this.client.pending.get('plan-decision:' + this.cid + ':' + id)?.body.reason || this.reasons[id] || ''; }
  pending() { const p = [...this.client.pending].find(([k]) => k.startsWith('plan-decision:' + this.cid + ':')); return p ? { slot: p[0], ...p[1] } : null; }
  async load(cid, messages) {
    if (!validId(cid)) { this.clear(); return; }
    if (cid !== this.cid || this.session !== this.identity()) this.clear();
    this.cid = cid; this.session = this.identity();
    if (this.state.planBusy) return;
    const cards = {};
    for (const m of messages) if (m.available !== false && m.planDecision) {
      const p = planView(m.planDecision), old = this.state.planCards[p.id];
      cards[p.id] = { ...p, full: old?.revision === p.revision ? old.full : null };
    }
    this.set({ planCards: cards, planPending: this.pending(), planError: '',
      planExpanded: cards[this.state.planExpanded]?.full ? this.state.planExpanded : '' });
    await this.loadMedia();
  }
  loadMedia() { return this.media.load(Object.values(this.state.planCards).filter(p => p.full).map(p => ({ key: p.key, path: '/miniprogram/assistant/conversations/' + this.cid + '/plans/' + p.id + '/media' }))); }
  async decide(id, action, reason) {
    const card = this.state.planCards[id];
    if (!card || this.state.planBusy || this.pending()) return false;
    if (action === 'request-changes' && reason) this.reasons[id] = reason;
    if (action === 'details') {
      const epoch = this.epoch; this.set({ planBusy: true, planError: '' });
      try {
        const p = planView(await this.client.read('/conversations/' + this.cid + '/plans/' + id));
        if (!this.valid(epoch)) return false;
        if (p.id !== id) throw { code: 'invalid_response' };
        this.set({ planCards: { ...this.state.planCards, [id]: { ...p, full: p } }, planExpanded: id });
        await this.loadMedia(); return true;
      } catch (error) {
        if (this.valid(epoch)) { this.media.clear(); this.set({ planCards: {}, planExpanded: '', planError: errorCopy(error) }); }
        return false;
      } finally { if (this.valid(epoch)) this.set({ planBusy: false }); }
    }
    if (action === 'approve' && (!card.full || this.state.planExpanded !== id || !this.state.planPaths[card.key])) return false;
    return this.write('plan-decision:' + this.cid + ':' + id, '/conversations/' + this.cid + '/plans/' + id + '/' + action,
      { expectedRevision: card.revision, ...(reason ? { reason } : {}) });
  }
  async write(slot, path, body) {
    const epoch = this.epoch, cid = this.cid; this.set({ planBusy: true, planError: '' });
    try {
      const result = await this.client.mutate(slot, path, body);
      if (!this.valid(epoch) || cid !== this.cid) return false;
      delete this.reasons[result.id];
      const old = this.state.planCards[result.id];
      if (old) {
        const p = result.material ? planView(result.material) : planView({ ...old, ...result });
        const preview = path.endsWith('/preview');
        this.set({ planCards: { ...this.state.planCards, [p.id]: { ...p, full: preview ? p : null } }, planExpanded: preview ? p.id : '', planPending: null });
        await this.loadMedia();
      }
      return true;
    } catch (error) {
      if (this.valid(epoch)) {
        if ([401,403,404].includes(error.statusCode) || ['plan_unavailable','context_changed'].includes(error.code || error.error)) { this.media.clear(); this.set({ planCards: {}, planExpanded: '' }); }
        this.set({ planPending: this.pending(), planError: uncertain(error) ? '结果尚未确认，请核对同一次方案决定。' : errorCopy(error) });
      }
      return false;
    } finally { if (this.valid(epoch)) this.set({ planBusy: false }); }
  }
  retry() { const p = this.pending(); return p ? this.write(p.slot, p.path, p.body) : Promise.resolve(false); }
  preview(id) { const card = this.state.planCards[id]; return card?.full ? this.media.preview(card.key) : Promise.resolve(); }
}
module.exports = { PlanChatController, initialPlans, planView };
