const shared = require('../../../utils/assistant-followups');
const api = require('../../../utils/api');
const { errorCopy } = require('../../../utils/assistant-client');

function stageNote(project) {
  for (const standard of project.standards || []) {
    const citation = standard.citations?.find(c => project.knowledgeSources?.some(source => source.sourceId === c.sourceId));
    const quote = citation?.quote?.trim().replace(/\r\n/g, '\n');
    if (!quote) continue;
    let note = quote;
    if (quote.startsWith('专业类型：')) {
      const split = quote.indexOf('\n\n');
      const body = split === -1 ? '' : quote.slice(split + 2);
      const checklist = /^(?:内部测试参考。)?适用条件：([^\n]+)\n核对事项：([^\n]+)$/u.exec(body);
      const faq = /^问：[^\n]+\n答：([^\n]+)$/u.exec(body);
      note = checklist ? checklist[1].replace(/。$/u, '') + '时，' + checklist[2] : faq?.[1] || '';
    }
    if (note.length <= 80 && /[。！？]$/u.test(note) && !/SHA-256|\n/u.test(note)) return note;
  }
  return project.knowledgeSources?.length ? '可查看本阶段的工艺核对要点。' : '';
}

function stageForView(report) {
  if (report.kind !== 'stage' || !report.ready || !report.available) return report;
  const name = report.projects[0]?.stageName;
  return { ...report, stageReminder: true,
    projects: report.projects.map(project => ({ ...project, stageNote: stageNote(project) })),
    cardTitle: name ? name + (name.endsWith('阶段') ? '' : '阶段') + '开始了' : report.kindLabel };
}
class FollowupController extends shared.FollowupController {
  set(patch) {
    if (patch.followupReports) patch.followupReports = patch.followupReports.map(stageForView);
    super.set(patch);
    if (!this.sourceRef) return;
    const r = this.sourceRef;
    if (patch.followupError) return this.clearSource(patch.followupError);
    const changed = Object.prototype.hasOwnProperty.call(patch, r.card ? 'followupReports' : 'followupDetail');
    if (r.card && (Object.prototype.hasOwnProperty.call(patch, 'followupDetail') || patch.followupActive === false)) return this.clearSource();
    if (!changed) return;
    const d = this.sourceReport(r.card ? r.reportId : '', r.revision);
    if (!this.hasSource(d, r.projectId, r.sourceId) || (r.card ? this.selected : d.bindingId) !== r.bindingId) this.clearSource();
    else if (!this.fileBusy && !this.state.reportSourceLoading && !this.state.reportSourceError) this.loadSource();
  }
  sourceReport(reportId = '', revision) {
    return reportId ? this.state.followupReports.find(r => r.reportId === reportId && r.revision === revision) : this.state.followupDetail;
  }
  hasSource(d, projectId, sourceId) {
    return d?.available && d.projects?.some(p => p.id === projectId && p.knowledgeSources?.some(s => s.sourceId === sourceId));
  }
  sourceState(reportSource = null, reportSourceLoading = false, reportSourceError = '') {
    super.set({ reportSource, reportSourceLoading, reportSourceError });
  }
  clearSource(error = '') {
    this.sourceRef = null;
    this.sourceTicket = (this.sourceTicket || 0) + 1;
    this.sourceState(null, false, error);
  }
  sourceCurrent(ref, epoch, ticket) { return this.current(epoch) && this.sourceRef === ref && ticket === this.sourceTicket; }
  sourcePath(ref) { return `/followups/${ref.bindingId}/reports/${ref.reportId}/projects/${ref.projectId}/sources/${ref.sourceId}`; }
  readSource(projectId, sourceId, reportId = '', revision) {
    const d = this.sourceReport(reportId, revision);
    if (!this.current() || !this.hasSource(d, projectId, sourceId) || reportId && (!d.stageReminder || !this.state.followupActive)) return;
    this.sourceRef = { bindingId: reportId ? this.selected : d.bindingId, reportId: d.reportId, revision: d.revision, projectId, sourceId, card: !!reportId };
    return this.loadSource();
  }
  async loadSource() {
    const ref = this.sourceRef, epoch = this.epoch, ticket = this.sourceTicket = (this.sourceTicket || 0) + 1;
    if (!ref || !this.current(epoch)) return;
    this.sourceState(null, true);
    try {
      const citation = await this.client.read(this.sourcePath(ref), { revision: ref.revision }, await this.headers());
      if (this.sourceCurrent(ref, epoch, ticket)) { this.sourceState(citation); return citation; }
    } catch (e) {
      if (this.sourceCurrent(ref, epoch, ticket)) this.sourceState(null, false, errorCopy(e));
    }
  }
  async openSourceFile() {
    if (this.fileBusy || !this.sourceRef || !this.current()) return;
    this.fileBusy = true;
    const ref = this.sourceRef, epoch = this.epoch;
    let file;
    try {
      const citation = await this.loadSource(), ticket = this.sourceTicket;
      if (!citation?.originalAvailable || !this.sourceCurrent(ref, epoch, ticket)) return;
      this.sourceState(citation, true);
      file = await api.downloadFile('/miniprogram/assistant' + this.sourcePath(ref) + '/original?revision=' + ref.revision,
        { headers: await this.headers(), suppressUnauthorized: true });
      if (!this.sourceCurrent(ref, epoch, ticket)) return;
      await new Promise((resolve, reject) => wx.openDocument({ filePath: file.tempFilePath, fileType: citation.sourceFile.format,
        showMenu: false, success: resolve, fail: reject }));
    } catch (e) { if (this.sourceRef === ref && this.current(epoch)) this.sourceState(null, false, errorCopy(e)); }
    finally {
      this.fileBusy = false;
      if (this.sourceRef === ref && this.current(epoch)) super.set({ reportSourceLoading: false });
      if (file?.tempFilePath) wx.getFileSystemManager().unlink({ filePath: file.tempFilePath, fail() {} });
    }
  }
}
module.exports = { ...shared, FollowupController };
