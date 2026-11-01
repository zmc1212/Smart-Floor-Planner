const { errorCopy, uncertain } = require('./assistant-client');
const { SiteRecordMedia } = require('./assistant-site-records');
const api = require('./api');
const { initialSettings, settingsMethods, operationKind } = require('./assistant-followup-settings');
const { initialPlan, planMethods } = require('./assistant-report-plan');
const BASE = '/followups';
const initialFollowups = () => ({ followupActive: false, followupBindings: [], followupListLoading: false, followupLoading: false,
  followupError: '', followupBusy: false, followupPending: false, followupContext: null, followupReports: [], followupCursor: null,
  followupDetail: null, followupOriginal: null, followupOriginalLoading: false, followupHasCards: false, ...initialSettings(), ...initialPlan() });
function dateLabel(value, time = false) {
  if (value === null || value === undefined || value === '') return '';
  const d = new Date(new Date(value).getTime() + 8 * 3600000), pad = n => String(n).padStart(2, '0');
  if (!Number.isFinite(d.getTime())) return '';
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日${time ? ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) : ''}`;
}
function projectForView(p, context) {
  const stages = context && context.stages || [], stage = stages.find(s => s.key === p.stageKey);
  const records = (p.records || []).map(r => ({ ...r, key: r.id + ':' + r.version, label: `${r.room || '工地'} · 记录${r.id} · 版本${r.version}` }));
  const progress = records.filter(r => r.data.completed).map(r => ({ key: r.key, text: r.data.completed }));
  const published = p.publishedRecordItems;
  const pending = published ? published.flatMap(r => ['pending','coordination'].filter(k => r[k]).map(k => ({ key: r.recordId + ':' + k,
    recordId: r.recordId, text: r[k], carriedOver: r.carriedOver }))) : (p.issues || []).map(i => ({ key: i.id, text: i.text, carriedOver: i.carriedOver }));
  if (!published && !p.issues) for (const r of records) for (const field of ['pending','coordination']) if (r.data[field]) pending.push({ key: r.key + ':' + field, text: r.data[field] });
  const arrangements = (p.arrangements || []).map(a => ({ key: a.id, text: `${a.title}\n${a.difference}`, carriedOver: a.carriedOver }));
  return { ...p, stageName: stage && stage.name || '', records, progress, pending, arrangements,
    highlights: [...progress, ...pending].slice(0, 2), originalIds: [...new Set([...records.map(r => r.id), ...(published || []).map(r => r.recordId)])] };
}
function reportForView(report, context) {
  if (!report.available) return { reportId: report.reportId, revision: report.revision, available: false, title: '这份简报已不可用', stateLabel: '来源或权限已变化' };
  const kindLabel = { daily: '施工日报', weekly: '施工周报', stage: '阶段提醒' }[report.kind] || '施工简报';
  const projects = (report.facts && report.facts.projects || []).map(p => projectForView(p, context));
  return { ...report, projects, kindLabel, title: dateLabel(report.periodStart) + ' · ' + kindLabel,
    periodLabel: dateLabel(report.periodStart, true) + '—' + dateLabel(report.periodEnd, true), cutoffLabel: dateLabel(report.cutoffAt, true),
    generatedLabel: dateLabel(report.generatedAt, true), dateLabel: dateLabel(report.generatedAt || report.scheduledAt, true),
    stateLabel: report.state === 'facts_ready' ? '现场记录已保存' : ({ queued: '正在读取现场记录…', running: '正在读取现场记录…', failed: '这次简报未完成', indeterminate: '结果正在核对', cancelled: '这次简报已停止' }[report.state] || '正在核对结果'),
    factsOnly: report.contentStatus === 'facts_only', ready: report.state === 'facts_ready' && !!report.facts,
    summary: projects.flatMap(p => p.highlights).slice(0, 2), truncated: !!(report.facts && report.facts.projectsTruncated),
  };
}

/** Shares the original request journal, but never changes the ordinary chat's
 * draft, focus, scroll or destination while refreshing private report state. */
class FollowupController {
  constructor({ client, emit, identity, headers = async () => ({}), schedule = setTimeout, unschedule = clearTimeout }) {
    this.client = client; this.emit = emit; this.identity = identity; this.headers = headers; this.state = initialFollowups(); this.epoch = 0;
    this.schedule = schedule; this.unschedule = unschedule;
  }
  set(patch) { if (patch.followupReports) patch.followupHasCards = patch.followupReports.some(r => r.deliveryState !== 'muted'); Object.assign(this.state, patch); this.emit(patch); }
  current(epoch = this.epoch) { return this.visible && epoch === this.epoch && this.session === this.identity(); }
  hide() {
    this.planReentry = this.state.followupPlanOpen ? { plan: this.state.followupPlan, draft: this.state.followupPlanDraft, dirty: this.state.followupPlanDirty } : null;
    this.settingsReentry = this.state.followupManageOpen ? { setting: this.state.followupSetting, draft: this.state.followupPreferenceDraft, dirty: this.state.followupPreferenceDirty } : null;
    this.visible = false; this.epoch++; this.unschedule(this.timer); this.set(initialFollowups());
  }
  leave() { this.selected = ''; this.epoch++; this.set({ followupActive: false, followupContext: null, followupDetail: null, followupOriginal: null, followupReports: [] }); }
  async show({ autoOpen = false } = {}) {
    if (this.session && this.session !== this.identity()) { this.selected = ''; this.operation = null;
      this.settingsReentry = null;
      this.planReentry = null;
      if (this.client.pending.session !== this.identity()) this.client.pending.clear(); this.set(initialFollowups()); }
    this.session = this.identity(); this.visible = true;
    if (!this.session) return;
    await this.loadList();
    if (!this.current() || this.state.followupError) return;
    this.startPolling();
    if ([...this.client.pending.keys()].some(slot => slot.startsWith('followup:plan:')) || this.planReentry) {
      if (autoOpen) this.set({ followupActive: true });
      const saved = this.planReentry; this.planReentry = null;
      await this.openPlan();
      if (saved?.dirty && this.state.followupPlan?.enterpriseId === saved.plan.enterpriseId) {
        this.set({ followupPlanConflict: this.state.followupPlan.version !== saved.plan.version, followupPlan: saved.plan, followupPlanDraft: saved.draft, followupPlanDirty: true }); this.planLabels();
      }
      return;
    }
    const pendingSetting = [...this.client.pending.keys()].some(slot => slot.startsWith('followup:preferences:') || slot.startsWith('followup:manage:'));
    if (pendingSetting || this.settingsReentry) {
      if (autoOpen) this.set({ followupActive: true });
      const saved = this.settingsReentry; this.settingsReentry = null;
      await this.openSettings(saved?.setting?.bindingId);
      if (saved?.dirty && this.state.followupManagement.some(b => b.bindingId === saved.setting.bindingId)) this.set({ followupSetting: saved.setting,
        followupPreferenceDraft: saved.draft, followupPreferenceDirty: true,
        followupSettingsConflict: this.state.followupManagement.find(b => b.bindingId === saved.setting.bindingId).version !== saved.setting.version });
      return;
    }
    if (this.operation) { this.set({ followupPending: true, followupActive: !!this.selected }); return; }
    if (this.selected) return this.state.followupBindings.some(b => b.bindingId === this.selected) ? this.select(this.selected) : this.openSettings(this.selected);
    if (autoOpen) {
      const available = this.state.followupBindings.filter(b => b.status !== 'deleted');
      if (available.length === 1) return this.select(available[0].bindingId);
      if (!available.length) {
        this.set({ followupActive: true });
        await this.openSettings();
        if (!this.current() || this.state.followupManagement.length || this.state.followupError) return;
        this.set({ followupManageOpen: false });
        try { const result = await this.client.mutate('followup:open', BASE + '/open', {}, 'POST', await this.headers()); await this.loadList(); return this.select(result.bindingId); }
        catch (e) { this.failure(e); }
      }
    }
  }
  startPolling() {
    this.unschedule(this.timer);
    if (!this.current()) return;
    this.timer = this.schedule(async () => {
      if (!this.current()) return;
      if (!this.state.followupBusy && !this.state.followupPending && !this.state.followupLoading) {
        await this.loadList();
        if (this.current() && this.state.followupManageOpen) await this.loadManagement();
        if (this.current() && this.state.followupPlanOpen) await this.loadPlan();
        if (this.current() && this.selected && this.state.followupActive) await this.sync();
      }
      this.startPolling();
    }, 7000);
  }
  async sync() {
    const epoch = this.epoch, bid = this.selected;
    try {
      const headers = await this.headers(), context = await this.client.read(`${BASE}/${bid}`, {}, headers);
      const reports = await this.client.read(`${BASE}/${bid}/reports`, {}, headers);
      if (!this.current(epoch) || this.state.followupBusy || this.state.followupPending) return;
      this.set({ followupContext: context, followupReports: reports.items.map(r => reportForView(r, context)), followupCursor: reports.nextCursor });
      const old = this.state.followupDetail;
      if (old) {
        const latest = await this.client.read(`${BASE}/${bid}/reports/${old.reportId}`, { revision: old.revision }, headers);
        if (this.current(epoch) && this.state.followupDetail === old) this.set({ followupDetail: reportForView(latest, context), ...(!latest.available ? { followupOriginal: null } : {}) });
      }
    } catch (e) { if (this.current(epoch)) this.failure(e); }
  }
  failure(e) {
    if (!this.current()) return;
    const denied = e.statusCode === 401 || e.statusCode === 403 || ['assistant_resource_not_found','identity_context_invalid'].includes(e.code || e.error);
    if (denied) { this.planReentry = null; this.set({ ...initialFollowups(), followupActive: !!this.selected }); }
    this.set({ followupError: ['assistant_capability_forbidden','construction_forbidden'].includes(e.code || e.error)
      ? '当前身份无法查看这些施工跟进，请重新选择身份。' : errorCopy(e) });
  }
  async loadList() {
    if (!this.current()) return;
    const epoch = this.epoch; this.set({ followupListLoading: true });
    try {
      const list = await this.client.read(BASE, {}, await this.headers()); if (!this.current(epoch)) return;
      this.set({ followupBindings: (list.items || []).map(b => ({ ...b, latestDateLabel: b.latestReport ? dateLabel(b.latestReport.generatedAt, true) : '' })), followupError: '' });
    } catch (e) { if (this.current(epoch)) this.failure(e); }
    finally { if (this.current(epoch)) this.set({ followupListLoading: false }); }
  }
  async select(bindingId) {
    if (this.state.followupBusy || this.state.followupPending || !this.visible) return;
    const epoch = ++this.epoch; this.selected = String(bindingId);
    const stored = [...this.client.pending.entries()].find(([slot, op]) => slot.startsWith('followup:') && op.path.startsWith(`${BASE}/${this.selected}/`));
    if (stored && !this.operation) { const [slot, op] = stored; this.operation = { slot, ...op,
      kind: operationKind({ slot, ...op }) }; }
    this.set({ followupActive: true, followupLoading: true, followupContext: null, followupDetail: null, followupOriginal: null, followupReports: [], followupError: '' });
    try {
      const headers = await this.headers();
      const [context, reports] = await Promise.all([this.client.read(BASE + '/' + bindingId, {}, headers), this.client.read(BASE + '/' + bindingId + '/reports', {}, headers)]);
      if (!this.current(epoch)) return;
      this.set({ followupContext: context, followupReports: reports.items.map(r => reportForView(r, context)), followupCursor: reports.nextCursor,
        followupPending: !!this.operation });
    } catch (e) { if (this.current(epoch)) this.failure(e); }
    finally { if (this.current(epoch)) this.set({ followupLoading: false }); }
  }
  async more() {
    if (!this.state.followupCursor || this.state.followupLoading || !this.current()) return;
    const epoch = this.epoch, bid = this.selected; this.set({ followupLoading: true });
    try {
      const result = await this.client.read(`${BASE}/${bid}/reports`, { beforeId: this.state.followupCursor }, await this.headers());
      if (this.current(epoch) && bid === this.selected) this.set({ followupReports: this.state.followupReports.concat(result.items.map(r => reportForView(r, this.state.followupContext))), followupCursor: result.nextCursor });
    } catch (e) { if (this.current(epoch)) this.failure(e); }
    finally { if (this.current(epoch)) this.set({ followupLoading: false }); }
  }
  async readReport(reportId, revision) {
    if (!this.current() || this.state.followupBusy || this.state.followupPending) return;
    const epoch = this.epoch, bid = this.selected; this.set({ followupLoading: true, followupDetail: null, followupOriginal: null, followupError: '' });
    try {
      const report = await this.client.read(`${BASE}/${bid}/reports/${reportId}`, revision ? { revision } : {}, await this.headers());
      if (this.current(epoch) && bid === this.selected) this.set({ followupDetail: reportForView(report, this.state.followupContext) });
    } catch (e) { if (this.current(epoch)) this.failure(e); }
    finally { if (this.current(epoch)) this.set({ followupLoading: false }); }
  }
  closeReport() { this.set({ followupDetail: null, followupOriginal: null }); }
  async write(slot, path, body, kind) {
    if (!this.current() || this.state.followupBusy || this.state.followupPending && !this.operation) return;
    if (this.operation && this.operation.slot !== slot) return;
    const epoch = this.epoch; this.operation = this.operation || { slot, path, body, kind };
    const op = this.operation; this.set({ followupBusy: true, followupError: '' });
    try {
      const result = await this.client.mutate(op.slot, op.path, op.body, 'POST', await this.headers());
      if (!this.current(epoch)) return;
      this.operation = null; this.set({ followupPending: false });
      if (op.kind === 'read' && this.state.followupDetail && result.reportId === this.state.followupDetail.reportId) this.set({ followupDetail: { ...this.state.followupDetail, readAt: true } });
      if (op.kind === 'plan') { this.set({ followupBusy: false }); await this.finishPlanWrite(op, result); }
      else if (op.kind === 'preferences' || op.kind === 'managementChange') { this.set({ followupBusy: false }); await this.finishSettingsWrite(op, result); }
      else if (op.kind === 'change') { this.set({ followupBusy: false }); if (['archive','delete'].includes(op.path.split('/').pop())) this.leave(); else await this.select(this.selected); }
      else if (!this.state.followupContext && this.selected) { this.set({ followupBusy: false }); await this.select(this.selected); }
      await this.loadList(); return result;
    } catch (e) {
      if (!this.current(epoch)) return;
      this.set({ followupPending: uncertain(e) }); if (!uncertain(e)) this.operation = null;
      if ((e.code || e.error) === 'context_changed') this.set({ followupDetail: null, followupOriginal: null, followupReports: [] });
      if (op.kind === 'preferences' && ['version_conflict','context_changed'].includes(e.code || e.error)) this.set({ followupSettingsConflict: true });
      if (op.kind === 'plan' && ['version_conflict','context_changed'].includes(e.code || e.error)) this.set({ followupPlanConflict: true });
      this.failure(e);
    } finally { if (this.current(epoch)) this.set({ followupBusy: false }); }
  }
  recover() { if (this.operation) return this.write(this.operation.slot, this.operation.path, this.operation.body, this.operation.kind); }
  renderedReport() {
    const r = this.state.followupDetail;
    if (!r || !r.available || !r.ready || r.readAt || !r.readToken || !['delivered','muted'].includes(r.deliveryState) || this.state.followupBusy || this.state.followupPending) return;
    return this.write(`followup:read:${this.selected}:${r.reportId}`, `${BASE}/${this.selected}/reports/${r.reportId}/acknowledge`, { revision: r.revision, readToken: r.readToken }, 'read');
  }
  visibleCard(reportId) {
    const r = this.state.followupReports.find(r => r.reportId === reportId), c = this.state.followupContext;
    if (!r || !r.available || !r.sequence || !c || this.state.followupBusy || this.state.followupPending) return;
    if (this.seen && this.seen[c.conversationId] && BigInt(this.seen[c.conversationId]) >= BigInt(r.sequence)) return;
    return this.write(`followup:seen:${this.selected}`, `${BASE}/${this.selected}/seen`, { throughSequence: r.sequence, conversationId: c.conversationId }, 'seen')
      .then(result => { if (result) { this.seen = this.seen || {}; this.seen[c.conversationId] = result.throughSequence; } });
  }
  change(action) {
    const c = this.state.followupContext; if (!c || this.state.followupBusy || this.state.followupPending) return;
    return this.write(`followup:change:${this.selected}`, `${BASE}/${this.selected}/${action}`, { expectedVersion: c.version }, 'change');
  }
  async original(projectId, recordId) {
    const r = this.state.followupDetail; if (!r || !r.available || this.state.followupOriginalLoading || !this.current()) return;
    const epoch = this.epoch; this.set({ followupOriginalLoading: true, followupError: '' });
    try {
      const original = await this.client.read(`${BASE}/${this.selected}/reports/${r.reportId}/projects/${projectId}/records/${recordId}`, { revision: r.revision }, await this.headers());
      if (this.current(epoch) && this.state.followupDetail === r) this.set({ followupOriginal: original });
    } catch (e) { if (this.current(epoch)) { this.set({ followupOriginal: null }); this.failure(e); } }
    finally { if (this.current(epoch)) this.set({ followupOriginalLoading: false }); }
  }
}
Object.assign(FollowupController.prototype, settingsMethods);
Object.assign(FollowupController.prototype, planMethods);
/** Only the locator changes; reuse original authenticated image/cache/revocation behavior. */
class FollowupRecordMedia extends SiteRecordMedia {
  constructor({ identity, emit, headers = async () => ({}), download = api.downloadFile }) {
    super({ identity, emit, download: async (url, options) => download(url, { ...options, headers: { ...await headers(), ...options.headers } }) });
  }
  loadOriginal(context, report, original) {
    this.location = { bindingId: context.bindingId, reportId: report.reportId, revision: report.revision, projectId: original.projectId };
    return this.load([context.bindingId, report.reportId, report.revision, original.projectId].join(':'), [
      { siteRecord: { available: true, id: original.id, version: original.version, assets: original.media.map(m => m.id) } },
    ]);
  }
  url(w) {
    const l = this.location;
    return `/miniprogram/assistant/followups/${l.bindingId}/reports/${l.reportId}/projects/${l.projectId}/records/${w.recordId}/media/${w.mediaId}?revision=${l.revision}`;
  }
}
module.exports = { FollowupController, FollowupRecordMedia, initialFollowups, reportForView, dateLabel };
