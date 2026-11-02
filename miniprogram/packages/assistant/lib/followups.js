const shared = require('../../../utils/assistant-followups');
const api = require('../../../utils/api');
const { errorCopy } = require('../../../utils/assistant-client');
class FollowupController extends shared.FollowupController {
  set(patch) {
    super.set(patch);
    if (!this.sourceRef) return;
    if (Object.prototype.hasOwnProperty.call(patch, 'followupDetail')) {
      const d = patch.followupDetail, r = this.sourceRef;
      if (!d?.available || d.bindingId !== r.bindingId || d.reportId !== r.reportId || d.revision !== r.revision
        || !d.projects.some(p => p.id === r.projectId && p.knowledgeSources?.some(s => s.sourceId === r.sourceId))) this.clearSource();
      else if (!this.fileBusy) this.loadSource();
    } else if (patch.followupError) this.clearSource(patch.followupError);
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
  readSource(projectId, sourceId) {
    const d = this.state.followupDetail;
    if (!this.current() || !d?.available || !d.projects.some(p => p.id === projectId && p.knowledgeSources?.some(s => s.sourceId === sourceId))) return;
    this.sourceRef = { bindingId: d.bindingId, reportId: d.reportId, revision: d.revision, projectId, sourceId };
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
