const api = require('../../../utils/api');
/** Customer photos always use a reviewed record/version grant; no internal chat or reusable public URL. */
class SiteRecordMedia {
  constructor({ identity, emit, download = api.downloadFile }) { Object.assign(this, { identity, emit, download }); this.epoch = 0; this.paths = {}; }
  clean() { for (const path of Object.values(this.paths)) this.unlink(path); this.paths = {}; }
  unlink(path) { try { wx.getFileSystemManager().unlink({ filePath: path, fail() {} }); } catch { /* Expired native temp file. */ } }
  clear() { ++this.epoch; this.clean(); this.emit({ siteRecordPaths: {} }); }
  async load(conversationId, messages) {
    const epoch = ++this.epoch, session = this.identity();
    if (this.session !== session || this.id !== conversationId) this.clean();
    this.session = session; this.id = conversationId;
    const valid = () => epoch === this.epoch && session === this.identity();
    const wanted = [];
    for (const message of messages || []) if (message.available !== false) for (const r of message.siteRecordList || (message.siteRecord?.available ? [message.siteRecord] : [])) {
      for (const mid of r.assets || []) wanted.push({ key: r.id + '_' + r.version + '_' + mid, recordId: r.id, version: r.version, mediaId: mid });
    }
    for (const [key, path] of Object.entries(this.paths)) if (!wanted.some(w => w.key === key)) { this.unlink(path); delete this.paths[key]; }
    this.emit({ siteRecordPaths: { ...this.paths }, siteRecordError: '' });
    for (const w of wanted) if (!this.paths[w.key]) {
      try {
        const d = await this.download(this.url(w), { suppressUnauthorized: true });
        if (!valid()) { this.unlink(d.tempFilePath); return; }
        this.paths[w.key] = d.tempFilePath; this.emit({ siteRecordPaths: { ...this.paths } });
      } catch { if (valid()) this.emit({ siteRecordError: '本条照片暂不可读取，刷新会重新核对权限。' }); }
    }
  }
  url(w) { return '/miniprogram/assistant/conversations/' + this.id + '/construction-records/' + w.recordId + '/media/' + w.mediaId + '?version=' + w.version; }
  async preview(recordId, version, mediaId) {
    const epoch = this.epoch, session = this.identity();
    const key = recordId + '_' + version + '_' + mediaId;
    if (!this.paths[key]) return;
    try {
      const d = await this.download(this.url({ recordId, version, mediaId }), { suppressUnauthorized: true });
      if (epoch !== this.epoch || session !== this.identity()) { this.unlink(d.tempFilePath); return; }
      this.unlink(this.paths[key]); this.paths[key] = d.tempFilePath; this.emit({ siteRecordPaths: { ...this.paths } });
      wx.previewImage({ urls: [d.tempFilePath], current: d.tempFilePath });
    } catch { if (epoch === this.epoch && session === this.identity()) { this.unlink(this.paths[key]); delete this.paths[key]; this.emit({ siteRecordPaths: { ...this.paths }, siteRecordError: '本条照片已不可访问，请重新读取。' }); } }
  }
}
module.exports = { SiteRecordMedia };
