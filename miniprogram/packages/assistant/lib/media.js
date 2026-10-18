const api = require('../../../utils/api');
const { AssistantClient, errorCopy } = require('./client');

// Private media is downloaded with the current bearer token, never a public URL.
class MediaController {
  constructor({ identity, emit, client = new AssistantClient(), download = api.downloadFile }) {
    Object.assign(this, { identity, emit, client, download });
    this.epoch = 0; this.session = identity(); this.items = []; this.paths = []; this.thumbnailPaths = {};
  }
  valid(epoch) { return epoch === this.epoch && this.session === this.identity(); }
  async load(conversationId, staff = false) {
    const epoch = ++this.epoch; this.session = this.identity(); this.staff = staff;
    this.id = conversationId; this.base = staff ? '/handoffs/' + conversationId : '/conversations/' + conversationId;
    const pending = this.client.pending.has('media:' + conversationId), formal = this.client.pending.has('media-formal:' + conversationId);
    this.emit({ mediaLoading: true, mediaItems: [], mediaError: '', mediaPending: pending || formal, mediaPendingFormal: formal });
    try {
      const data = await this.client.read(this.base + '/media');
      if (this.valid(epoch)) { this.items = data.items; this.emit({ mediaItems: data.items }); }
    } catch (e) { if (this.valid(epoch)) this.emit({ mediaItems: [], mediaError: errorCopy(e) }); }
    finally { if (this.valid(epoch)) this.emit({ mediaLoading: false }); }
  }
  async upload(filePath, kind, roomName) {
    if (this.busy || this.staff) return false;
    const epoch = this.epoch; this.busy = true; this.emit({ mediaBusy: true, mediaError: '' });
    try {
      // Read only for the first attempt; uncertain retries retain both bytes and operation key.
      if (!this.client.pending.has('media:' + this.id)) {
        const data = await new Promise((resolve, reject) => wx.getFileSystemManager().readFile({ filePath, encoding: 'base64', success: r => resolve(r.data), fail: reject }));
        if (!this.valid(epoch)) return false;
        if (data.length > 5592408) throw { code: 'media_invalid', statusCode: 422 };
        this.body = { data, kind, roomName };
      }
      await this.client.mutate('media:' + this.id, this.base + '/media', this.body);
      if (!this.valid(epoch)) return false;
      this.body = null; this.emit({ mediaPending: false }); return true;
    } catch (e) {
      if (this.valid(epoch)) this.emit({ mediaError: errorCopy(e), mediaPending: this.client.pending.has('media:' + this.id) });
      return false;
    } finally { this.busy = false; if (this.valid(epoch)) this.emit({ mediaBusy: false }); }
  }
  async remove(id) {
    if (this.busy || this.staff) return;
    const epoch = this.epoch; this.busy = true; this.emit({ mediaBusy: true, mediaError: '' });
    try {
      await this.client.read(this.base + '/media/' + id, {}, {}, 'DELETE');
      if (this.valid(epoch)) { this.items = this.items.filter(i => i.id !== id); this.emit({ mediaItems: this.items }); }
    } catch (e) { if (this.valid(epoch)) this.emit({ mediaError: errorCopy(e) }); }
    finally { this.busy = false; if (this.valid(epoch)) this.emit({ mediaBusy: false }); }
  }
  async floorPlans() {
    const epoch = this.epoch;
    try {
      const data = await this.client.read(this.base + '/media/floorplans');
      if (this.valid(epoch)) this.emit({ formalPlans: data.items, formalIndex: 0, formalRooms: [{ id: '', name: '完整户型' }, ...(data.items[0]?.rooms || [])], formalRoomIndex: 0,
        mediaError: data.items.length ? '' : '还没有可选的已完成正式户型，可以先上传户型参考图。' });
    } catch (e) { if (this.valid(epoch)) this.emit({ mediaError: errorCopy(e) }); }
  }
  async attachFormal(plan, roomId = '') {
    if (this.busy || this.staff) return false;
    const epoch = this.epoch; this.busy = true; this.emit({ mediaBusy: true, mediaError: '' });
    try {
      await this.client.mutate('media-formal:' + this.id, this.base + '/media/floorplans', plan ? {
        leadId: plan.leadId, floorPlanId: plan.id, layoutHash: plan.layoutHash, roomId,
      } : {});
      if (!this.valid(epoch)) return false;
      this.emit({ mediaPending: false, mediaPendingFormal: false }); return true;
    } catch (e) {
      if (this.valid(epoch)) this.emit({ mediaError: errorCopy(e), mediaPending: this.client.pending.has('media-formal:' + this.id), mediaPendingFormal: this.client.pending.has('media-formal:' + this.id) });
      return false;
    } finally { this.busy = false; if (this.valid(epoch)) this.emit({ mediaBusy: false }); }
  }
  async preview(id) {
    const epoch = this.epoch;
    try {
      const result = await this.download('/miniprogram/assistant' + this.base + '/media/' + id, { suppressUnauthorized: true });
      this.paths.push(result.tempFilePath);
      if (!this.valid(epoch)) { this.cleanPaths(); return; }
      wx.previewImage({ urls: [result.tempFilePath], current: result.tempFilePath });
    } catch (e) { if (this.valid(epoch)) this.emit({ mediaError: errorCopy(e) }); }
  }
  async thumbnail(id) {
    const epoch = this.epoch;
    try {
      const result = await this.download('/miniprogram/assistant' + this.base + '/media/' + id, { suppressUnauthorized: true });
      this.paths.push(result.tempFilePath);
      if (!this.valid(epoch)) { this.cleanPaths(); return ''; }
        const previous = this.thumbnailPaths[id];
        if (previous) { wx.getFileSystemManager().unlink({ filePath: previous, fail() {} }); this.paths = this.paths.filter(p => p !== previous); }
        this.thumbnailPaths[id] = result.tempFilePath;
      return result.tempFilePath;
    } catch (_) { return ''; }
  }
  cleanPaths() {
    this.thumbnailPaths = {};
    const fs = wx.getFileSystemManager();
    for (const filePath of this.paths.splice(0)) fs.unlink({ filePath, fail() {} });
  }
  dispose() { this.epoch++; this.body = null; this.items = []; this.cleanPaths(); }
}
module.exports = { MediaController };
