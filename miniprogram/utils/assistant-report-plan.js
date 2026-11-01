const BASE = '/followups/plan';
const fields = ['enabled','stageEnabled','dailyTime','weeklyTime','weeklyDay','projectIds','stageKeys','audiences','inactivePolicy'];
const roles = [{ id: 'customer', name: '业主' }, { id: 'worker', name: '工人' }, { id: 'designer', name: '设计师' }, { id: 'boss', name: '老板' }];
const days = ['周一','周二','周三','周四','周五','周六','周日'];
const initialPlan = () => ({ followupPlanOpen: false, followupPlan: null, followupPlanDraft: null, followupPlanDirty: false,
  followupPlanConflict: false, followupPlanLoading: false, followupPlanNotice: '', followupPlanProjects: [], followupPlanCursor: null,
  followupPlanChoice: '', followupPlanChoices: [], followupPlanAll: false, followupPlanProjectLabel: '', followupPlanRoleLabel: '',
  followupPlanWeekLabel: '', followupPlanWeekValue: [0,8,0], followupPlanWeekRange: [days, Array.from({ length: 24 }, (_, i) => String(i).padStart(2,'0')), Array.from({ length: 60 }, (_, i) => String(i).padStart(2,'0'))] });
const draftOf = plan => Object.fromEntries(fields.map(k => [k, Array.isArray(plan[k]) ? [...plan[k]] : plan[k]]));
const same = (a, b) => JSON.stringify(draftOf(a)) === JSON.stringify(draftOf(b));
const planMethods = {
  async openPlan() {
    if (!this.current() || this.state.followupBusy || this.state.followupPending && !this.operation) return;
    this.set({ followupPlanOpen: true, followupManageOpen: false, followupPlanNotice: '', followupError: '' });
    const saved = [...this.client.pending.entries()].find(([slot]) => slot.startsWith('followup:plan:'));
    if (saved && !this.operation) this.operation = { slot: saved[0], ...saved[1], kind: 'plan' };
    if (this.operation) this.set({ followupPending: true });
    await this.loadPlan();
  },
  async loadPlan({ more = false, rebase = false } = {}) {
    if (!this.current() || this.state.followupPlanLoading) return;
    const epoch = this.epoch; this.set({ followupPlanLoading: true });
    try {
      const result = await this.client.read(BASE, more ? { beforeId: this.state.followupPlanCursor } : {}, await this.headers());
      if (!this.current(epoch)) return;
      if (!result.settings || result.settings.timezone !== 'Asia/Shanghai' || !Array.isArray(result.projects)) throw { code: 'invalid_response' };
      const previous = this.state.followupPlan, draft = this.state.followupPlanDraft, dirty = this.state.followupPlanDirty;
      const projects = [...new Map([...(more ? this.state.followupPlanProjects : []), ...result.projects, ...result.selectedProjects].map(p => [p.id, p])).values()];
      const keep = previous && previous.enterpriseId === result.settings.enterpriseId && dirty;
      this.set({ followupPlan: keep && !rebase ? previous : result.settings, followupPlanDraft: keep ? draft : draftOf(result.settings),
        followupPlanDirty: !!keep, followupPlanConflict: !!keep && !rebase && previous.version !== result.settings.version,
        followupPlanProjects: projects, followupPlanCursor: result.nextCursor, followupEnterpriseName: result.enterprise.name, followupError: '' });
      this.planLabels();
      if (this.state.followupPlanChoice) this.planChoices(this.state.followupPlanChoice, true);
    } catch (e) { if (this.current(epoch)) this.failure(e); }
    finally { if (this.current(epoch)) this.set({ followupPlanLoading: false }); }
  },
  planLabels() {
    const draft = this.state.followupPlanDraft; if (!draft) return;
    const first = this.state.followupPlanProjects.find(p => p.id === draft.projectIds[0]);
    this.set({ followupPlanProjectLabel: !draft.projectIds.length ? '全部适用工地' : `${first?.name || '已选工地'}等${draft.projectIds.length}个工地`,
      followupPlanRoleLabel: roles.filter(r => draft.audiences.includes(r.id)).map(r => r.name).join('、'),
      followupPlanWeekLabel: `每${days[draft.weeklyDay - 1]} ${draft.weeklyTime}`, followupPlanWeekValue: [draft.weeklyDay-1, ...draft.weeklyTime.split(':').map(Number)] });
  },
  editPlan(field, value) {
    if (!this.state.followupPlanDraft || !fields.includes(field) || this.state.followupBusy || this.state.followupPending) return;
    const draft = { ...this.state.followupPlanDraft, [field]: value };
    this.set({ followupPlanDraft: draft, followupPlanDirty: !same(draft, this.state.followupPlan), followupPlanNotice: '' }); this.planLabels();
  },
  planChoices(field, preserve = false) {
    if (!['projectIds','audiences'].includes(field) || !this.state.followupPlanDraft || this.state.followupBusy || this.state.followupPending) return;
    const chosen = preserve ? this.state.followupPlanChoices.filter(p => p.checked).map(p => p.id) : this.state.followupPlanDraft[field];
    const items = field === 'audiences' ? roles : this.state.followupPlanProjects;
    this.set({ followupPlanChoice: field, followupPlanChoices: items.map(p => ({ ...p, checked: chosen.includes(p.id) })),
      followupPlanAll: preserve ? this.state.followupPlanAll : field === 'projectIds' && !chosen.length });
  },
  commitPlanChoices() {
    const field = this.state.followupPlanChoice;
    if (!field || this.state.followupBusy || this.state.followupPending) return;
    const value = field === 'projectIds' && this.state.followupPlanAll ? [] : this.state.followupPlanChoices.filter(p => p.checked).map(p => p.id);
    if ((!value.length && !(field === 'projectIds' && this.state.followupPlanAll)) || (field === 'projectIds' && value.length > 20)) {
      this.set({ followupPlanNotice: field === 'projectIds' ? '请选择1至20个工地，或使用全部适用工地。' : '请至少选择一个接收角色。' }); return;
    }
    this.editPlan(field, value); this.set({ followupPlanChoice: '', followupPlanChoices: [] });
  },
  savePlan() {
    const plan = this.state.followupPlan;
    if (!plan || !this.state.followupPlanDirty || this.state.followupPlanConflict || this.state.followupBusy || this.state.followupPending) return;
    return this.write('followup:plan:' + plan.enterpriseId, BASE, { expectedVersion: plan.version, ...draftOf(this.state.followupPlanDraft) }, 'plan');
  },
  async finishPlanWrite(op, result) {
    this.set({ followupPlan: result, followupPlanDraft: draftOf(result), followupPlanDirty: false, followupPlanConflict: false }); this.planLabels();
    this.set({ followupPlanNotice: '计划已保存，对后续任务生效。' });
    await this.loadPlan();
  },
};
const planPageMethods = {
  async openReportPlan() {
    if (!this.data.followupPlanManager || !await this.confirmFollowupDraft()) return;
    this.closeSheet(); this.setData({ followupHistoryOpen: false }); return this.followups.openPlan();
  },
  async closeReportPlan() {
    if (this.data.followupBusy || this.data.followupPending) return;
    if (this.data.followupPlanChoice) { this.followups.set({ followupPlanChoice: '', followupPlanChoices: [], followupPlanNotice: '' }); return; }
    if (await this.confirmFollowupDraft()) this.followups.set({ followupPlanOpen: false });
  },
  editReportPlan(e) { this.followups.editPlan(e.currentTarget.dataset.field, e.detail.value); },
  editReportPlanWeek(e) {
    const [day, hour, minute] = e.detail.value;
    this.followups.editPlan('weeklyDay', Number(day) + 1);
    this.followups.editPlan('weeklyTime', `${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`);
  },
  chooseReportPlan(e) { this.followups.planChoices(e.currentTarget.dataset.field); },
  changeReportPlanChoices(e) {
    const chosen = e.detail.value; this.followups.set({ followupPlanChoices: this.data.followupPlanChoices.map(p => ({ ...p, checked: chosen.includes(p.id) })) });
  },
  changeReportPlanAll(e) { this.followups.set({ followupPlanAll: !!e.detail.value }); },
  commitReportPlanChoices() { return this.followups.commitPlanChoices(); },
  moreReportPlanProjects() { if (this.data.followupPlanCursor) return this.followups.loadPlan({ more: true }); },
  refreshReportPlan() { return this.followups.loadPlan({ rebase: true }); },
  saveReportPlan() { return this.followups.savePlan(); },
  explainReportPlanLifecycle() { wx.showModal({ title: '暂停发送', content: '停工、完工、入住或归档后暂停后续自动简报；恢复在建后按计划继续。历史报告仍按原权限查看。', showCancel: false }); },
};
module.exports = { initialPlan, planMethods, planPageMethods };
