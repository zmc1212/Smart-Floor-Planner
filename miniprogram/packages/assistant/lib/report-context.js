const { errorCopy, uncertain } = require('./client');
const emptyReportQuestion = () => ({ conversationId: '', selected: null, version: 0, invalidated: false, title: '', busy: false, pending: false, error: '' });
function reportQuestionView(value) {
  const s = value?.selected, d = s && new Date(new Date(s.periodStart).getTime() + 8 * 3600000);
  return { ...value, title: s ? `${d.getUTCMonth() + 1}月${d.getUTCDate()}日${s.kind === 'weekly' ? '周报' : s.kind === 'daily' ? '日报' : '阶段提醒'} · ${s.projectName}` : '' };
}
/** The existing journal owns keys/bodies. Selection is per conversation and
 * never clears a draft or changes the report delivery destination. */
class ReportQuestionController {
  constructor({ client, identity, emit, headers, openTopic }) { Object.assign(this, { client, identity, emit, headers, openTopic }); this.state = emptyReportQuestion(); }
  set(p) { Object.assign(this.state, p); this.emit({ reportQuestion: { ...this.state } }); }
  bind(chat, base) {
    const c = chat?.state.conversation, session = this.identity();
    if (!chat?.visible || !c || !session || chat.session !== session) { this.chat = null; this.set(emptyReportQuestion()); return; }
    if (session !== this.session || c.id !== this.cid || base !== this.base) {
      this.session = session; this.cid = c.id; this.base = base; this.set(emptyReportQuestion());
    }
    this.chat = chat;
    const pending = this.client.pending.has('report-context:' + this.cid) || this.client.pending.has('report-topic:' + this.cid);
    this.set({ ...reportQuestionView(c.reportContext || { conversationId: c.id, version: 0, selected: null, invalidated: false }), pending, disabled: !this.canChange() });
  }
  canChange() { const s = this.chat?.state; return this.chat?.visible && this.identity() === this.session && s?.conversation?.id === this.cid
    && s.conversation.mode === 'ai' && s.conversation.status === 'open' && !s.busy && !s.loading && !s.pendingSend && !s.pendingAction && !s.generating && !s.uncertainRun; }
  async select(selection) { return this.write('report-context', { expectedVersion: this.state.version, selection }); }
  topic() { if (this.state.topicAvailable !== false) return this.write('report-topic', {}); }
  recover() { return this.write(this.client.pending.has('report-topic:' + this.cid) ? 'report-topic' : 'report-context'); }
  async write(kind, body) {
    if (!this.canChange() || this.state.busy || this.state.pending && !this.client.pending.has(kind + ':' + this.cid)) return;
    const cid = this.cid, base = this.base, chat = this.chat, session = this.session, slot = kind + ':' + cid;
    this.set({ busy: true, error: '' });
    try {
      const result = await this.client.mutate(slot, base + '/' + kind, body, 'POST', await this.headers());
      if (this.cid !== cid || this.base !== base || this.identity() !== session || this.chat !== chat) return;
      this.set({ pending: false });
      if (kind === 'report-topic') { await this.openTopic(result.id); return; }
      chat.set({ conversation: { ...chat.state.conversation, reportContext: result } });
      this.set(reportQuestionView(result));
    } catch (e) {
      if (this.cid !== cid || this.identity() !== session || this.chat !== chat) return;
      const denied = [401,403,404].includes(e.statusCode);
      this.set({ pending: uncertain(e), error: errorCopy(e), ...(denied ? { selected: null, title: '', invalidated: true } : {}) });
      if (!uncertain(e)) await chat.snapshot(cid, chat.epoch).catch(error => chat.fail(error, chat.epoch));
    } finally { if (this.cid === cid && this.chat === chat && this.identity() === session) this.set({ busy: false }); }
  }
}
const reportQuestionMethods = {
  syncReportQuestion() {
    if (!this.reportQuestions) return;
    const followup = this.data.followupActive, chat = followup ? this.followupChatController?.chat : this.controller;
    this.reportQuestions.bind(chat, followup ? '/followups/' + this.followups.selected + '/conversation' : '/conversations/' + chat?.conversationId);
    if (this.reportQuestions.state.invalidated && this.data.followupDetail) this.followups.closeReport();
  },
  askFollowupReport(event) {
    if (!this.data.followupActive && this.data.reportQuestion.selected) { this.followups.closeReport(); return; }
    const c = this.data.followupContext;
    if (!c || !['customer','worker','designer','boss'].includes(c.audience) || !this.reportQuestions.canChange()) return;
    const d = event.currentTarget.dataset, report = d.report ? this.data.followupReports.find(r => r.reportId === String(d.report) && r.revision === Number(d.revision)) : this.data.followupDetail;
    if (!report?.available || !report.ready || !report.projects?.length) return;
    const select = project => this.reportQuestions.select({ bindingId: c.bindingId, reportId: report.reportId, revision: report.revision, projectId: project.id })
      .then(() => { if (this.reportQuestions.state.selected) this.followups.closeReport(); });
    if (report.projects.length === 1) return select(report.projects[0]);
    wx.showActionSheet({ itemList: report.projects.map(p => p.name), success: r => select(report.projects[r.tapIndex]) });
  },
  removeReportQuestion() { return this.reportQuestions.select(null); },
  recoverReportQuestion() { return this.reportQuestions.recover(); },
  newReportTopic() { return this.reportQuestions.topic(); },
  viewReportQuestion() { const s = this.data.reportQuestion.selected; if (s) return this.followups.readReport(s.reportId, s.revision, s.bindingId); },
};
module.exports = { ReportQuestionController, reportQuestionMethods, emptyReportQuestion, reportQuestionView };
