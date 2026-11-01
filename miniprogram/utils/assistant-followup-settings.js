const BASE = '/followups';
const initialSettings = () => ({ followupManageOpen: false, followupManagement: [], followupManagementCursor: null,
  followupManageLoading: false, followupSetting: null, followupPreferenceDraft: null, followupPreferenceDirty: false,
  followupSettingsConflict: false, followupSettingsNotice: '' });
const same = (a, b) => a && b && ['stage', 'daily', 'weekly'].every(k => a[k] === b[k]);
const operationKind = op => op.path.endsWith('/preferences') ? 'preferences' : op.slot.startsWith('followup:manage:') ? 'managementChange'
  : op.path.endsWith('/acknowledge') ? 'read' : op.path.endsWith('/seen') ? 'seen' : 'change';
const settingsMethods = {
  async openSettings(preferred) {
    if (!this.current() || this.state.followupBusy || this.state.followupPending && !this.operation) return;
    this.set({ followupManageOpen: true, followupSettingsNotice: '', followupError: '' });
    const saved = [...this.client.pending.entries()].find(([slot]) => slot.startsWith('followup:preferences:') || slot.startsWith('followup:manage:'));
    if (saved && !this.operation) this.operation = { slot: saved[0], ...saved[1], kind: operationKind({ slot: saved[0], ...saved[1] }) };
    if (this.operation) this.set({ followupPending: true });
    await this.loadManagement({ preferred: this.operation?.path.split('/')[2] || preferred || this.selected });
  },
  async loadManagement({ more = false, preferred, rebase = false } = {}) {
    if (!this.current() || this.state.followupManageLoading) return;
    const epoch = this.epoch; this.set({ followupManageLoading: true });
    try {
      const result = await this.client.read(BASE + '/manage', more ? { beforeId: this.state.followupManagementCursor } : {}, await this.headers());
      if (!this.current(epoch)) return;
      const items = more ? this.state.followupManagement.concat(result.items) : result.items;
      this.set({ followupManagement: items, followupManagementCursor: result.nextCursor, followupError: '' });
      const previous = this.state.followupSetting, next = items.find(b => b.bindingId === (preferred || previous?.bindingId)) || (!previous && items[0]);
      if (!next) {
        // Never retain a revoked project's label or draft in the selector.
        this.set({ followupSetting: null, followupPreferenceDraft: null, followupPreferenceDirty: false, followupSettingsConflict: false });
      } else if (previous?.bindingId === next.bindingId && this.state.followupPreferenceDirty) {
        this.set({ followupSetting: rebase ? next : previous, followupSettingsConflict: !rebase && previous.version !== next.version });
      } else this.chooseSetting(next.bindingId, true);
    } catch (e) { if (this.current(epoch)) this.failure(e); }
    finally { if (this.current(epoch)) this.set({ followupManageLoading: false }); }
  },
  chooseSetting(bindingId, recovery = false) {
    if (!recovery && (this.state.followupBusy || this.state.followupPending)) return;
    const b = this.state.followupManagement.find(b => b.bindingId === bindingId);
    this.set({ followupSetting: b || null, followupPreferenceDraft: b ? { ...b.preferences } : null,
      followupPreferenceDirty: false, followupSettingsConflict: false, followupSettingsNotice: '' });
  },
  editPreference(name, value) {
    const b = this.state.followupSetting;
    if (!b || !['stage', 'daily', 'weekly'].includes(name) || typeof value !== 'boolean' || this.state.followupBusy || this.state.followupPending) return;
    const draft = { ...this.state.followupPreferenceDraft, [name]: value };
    this.set({ followupPreferenceDraft: draft, followupPreferenceDirty: !same(draft, b.preferences), followupSettingsNotice: '' });
  },
  discardPreferences() {
    const b = this.state.followupSetting;
    this.set({ followupPreferenceDraft: b ? { ...b.preferences } : null, followupPreferenceDirty: false, followupSettingsConflict: false });
  },
  savePreferences() {
    const b = this.state.followupSetting;
    if (!b || !this.state.followupPreferenceDirty || this.state.followupSettingsConflict || this.state.followupBusy || this.state.followupPending) return;
    return this.write('followup:preferences:' + b.bindingId, `${BASE}/${b.bindingId}/preferences`,
      { expectedVersion: b.version, preferences: { ...this.state.followupPreferenceDraft } }, 'preferences');
  },
  manageChange(action) {
    const b = this.state.followupSetting;
    if (!b || this.state.followupPreferenceDirty || this.state.followupBusy || this.state.followupPending) return;
    return this.write('followup:manage:' + b.bindingId, `${BASE}/${b.bindingId}/${action}`, { expectedVersion: b.version }, 'managementChange');
  },
  async finishSettingsWrite(op, result) {
    const bid = result.bindingId, epoch = this.epoch;
    if (op.kind === 'preferences') this.set({ followupPreferenceDirty: false, followupPreferenceDraft: { ...result.preferences } });
    if (op.kind === 'managementChange' && op.path.endsWith('/delete') && this.selected === bid) {
      this.selected = ''; this.set({ followupContext: null, followupReports: [], followupDetail: null, followupOriginal: null });
    }
    await this.loadManagement({ preferred: bid });
    if (!this.current(epoch)) return;
    this.set({ followupSettingsNotice: op.kind === 'preferences' ? '提醒偏好已保存' : '跟进设置已更新' });
    if (op.kind === 'managementChange' && op.path.endsWith('/resume')) await this.select(bid);
    else if (this.selected && this.state.followupActive) await this.sync();
  },
};

const confirm = (title, content) => new Promise(resolve => wx.showModal({ title, content, success: r => resolve(!!r.confirm), fail: () => resolve(false) }));
const settingsPageMethods = {
  manageFollowup() { this.setData({ followupHistoryOpen: false }); this.closeSheet(); return this.followups.openSettings(); },
  async confirmFollowupDraft() {
    if (this.data.followupBusy || this.data.followupPending) return false;
    if (this.data.followupPlanDirty) {
      const identity = this.followups.identity();
      if (!await confirm('报告计划尚未保存', '继续会放弃本次未保存的选择；取消可保留并保存。') || !this._alive || !this._shown || identity !== this.followups.identity()) return false;
      this.followups.set({ followupPlanDraft: { ...this.data.followupPlan }, followupPlanDirty: false, followupPlanConflict: false }); this.followups.planLabels();
    }
    if (!this.data.followupPreferenceDirty) return true;
    const identity = this.followups.identity();
    const ok = await confirm('提醒偏好尚未保存', '继续会放弃本次未保存的选择；取消可保留并保存。');
    if (!ok || !this._alive || !this._shown || identity !== this.followups.identity()) return false;
    this.followups.discardPreferences(); return true;
  },
  async closeFollowupManage() { if (await this.confirmFollowupDraft()) this.followups.set({ followupManageOpen: false, followupSetting: null, followupSettingsNotice: '' }); },
  async selectFollowupSetting(e) {
    if (await this.confirmFollowupDraft()) {
      const b = this.data.followupManagement[Number(e.detail.value)]; if (b) this.followups.chooseSetting(b.bindingId);
    }
  },
  editFollowupPreference(e) { this.followups.editPreference(e.currentTarget.dataset.preference, e.detail.value); },
  saveFollowupPreferences() { return this.followups.savePreferences(); },
  refreshFollowupSettings() { return this.followups.loadManagement({ rebase: true }); },
  moreFollowupSettings() { return this.followups.loadManagement({ more: true }); },
  async changeFollowup(e) {
    const action = e.currentTarget.dataset.action, b = this.data.followupSetting;
    if (!b || !await this.confirmFollowupDraft()) return;
    const copy = { archive: ['收起会话？', '自动跟进仍开启，有新报告时会重新显示。'],
      stop: ['停止自动跟进？', '停止后不再接收，可在这里重新开启；工地原记录保留。'],
      delete: ['删除会话？', '删除同时停止跟进，不会次日自动重建；工地原记录保留。重新开启会建立新的会话。'],
      resume: ['重新开启跟进？', b.status === 'deleted' || b.retentionRedacted ? '将建立新的跟进会话，旧消息和未读不会恢复。工地原记录保留。' : '按当前获权范围继续接收，工地原记录保留。'] }[action];
    if (!copy) return;
    const identity = this.followups.identity();
    if (await confirm(...copy) && this._alive && this._shown && identity === this.followups.identity()
      && this.data.followupSetting?.bindingId === b.bindingId && this.data.followupSetting.version === b.version) return this.followups.manageChange(action);
  },
};
module.exports = { initialSettings, settingsMethods, settingsPageMethods, operationKind };
