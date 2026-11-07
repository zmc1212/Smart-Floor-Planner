const { key, errorText } = require('./site-client');
const clone = value => JSON.parse(JSON.stringify(value));
const emptyDraft = () => ({ text: '', photos: [], voice: null, quick: { workId: '', roomId: '', location: null, progress: '' } });
const fileCall = (name, options) => new Promise((resolve, reject) => wx.getFileSystemManager()[name]({ ...options, success: resolve, fail: reject }));
const nativeFiles = {
  async save(source, kind) {
    const folder = wx.env.USER_DATA_PATH + '/site-capture';
    try { wx.getFileSystemManager().mkdirSync(folder, true); } catch (_) { /* Existing directory; copy still verifies writability. */ }
    const path = folder + '/' + key() + (kind === 'voice' ? '.wav' : '.jpg');
    await fileCall('copyFile', { srcPath: source, destPath: path });
    try {
      const info = await fileCall('stat', { path });
      if (!info.stats.size || info.stats.size > (kind === 'voice' ? 2 : 4) * 1024 * 1024) throw Error('file_size');
      return path;
    } catch (error) { await fileCall('unlink', { filePath: path }).catch(() => {}); throw error; }
  },
  read: path => fileCall('readFile', { filePath: path, encoding: 'base64' }).then(r => r.data),
  remove: path => fileCall('unlink', { filePath: path }).catch(() => {}),
};
const labels = { done: '做完了', partial: '做了一部分', not_started: '还没做', unsure: '说不准' };

/** Local originals + one immutable send key per record. Remote records remain the shared service's authority. */
class SiteCapture {
  constructor({ site, emit, files = nativeFiles }) { Object.assign(this, { site, emit, files }); this.epoch = 0; }
  valid(epoch = this.epoch) { return this.visible && epoch === this.epoch && this.site.current(this.siteEpoch); }
  show() {
    this.visible = true; ++this.epoch; this.siteEpoch = this.site.epoch;
    this.storageKey = 'site:capture:' + this.site.session.key + ':' + this.site.projectId;
    try {
      const saved = this.site.storage.get(this.storageKey);
      this.value = saved && saved.version === 1 ? clone(saved) : { version: 1, draft: emptyDraft(), queue: [] };
      this.render(); this.accepted(this.site.state.items);
    } catch (_) { this.value = null; this.emit({ captureError: '本机记录暂时无法读取，请重进后再试。' }); }
  }
  hide() { this.visible = false; ++this.epoch; this.emit({ capturePhotos: [], captureVoice: null, captureQueue: [], captureText: '', captureSaving: false, captureSending: false }); }
  persist(next) {
    // Never show “saved on phone” or clear inputs before this durable write succeeds.
    this.site.storage.set(this.storageKey, next); this.value = next; this.render();
  }
  render() {
    if (!this.valid() || !this.value) return;
    const draft = this.value.draft;
    const pending = this.site.state.items || [];
    this.emit({ captureText: draft.text, capturePhotos: draft.photos, captureVoice: draft.voice, quickChoice: draft.quick,
      captureQueue: this.value.queue.filter(e => !pending.some(i => i.message.client_message_id === e.key)).map(e => ({ ...e,
        received: !!e.receipt, uncertain: !e.receipt && e.dispatched, uploading: this.activeKey === e.key,
        text: e.displayText || (e.voice ? '语音上报' : '现场照片 · ' + e.photos.length + '张') })), captureSending: !!this.activeKey });
  }
  writeDraft(patch) {
    if (!this.valid() || !this.value || this.site.state.fatal) return false;
    const next = { ...this.value, draft: { ...this.value.draft, ...patch } };
    try { this.persist(next); this.emit({ captureError: '' }); return true; }
    catch (_) { this.value = next; this.render(); this.emit({ captureError: '本机保存未完成，请保留当前页面并重试。' }); return false; }
  }
  input(text) { return this.writeDraft({ text }); }
  choose(patch) { return this.writeDraft({ quick: { ...this.value.draft.quick, ...patch } }); }
  async addFile(source, kind, durationMs = 0) {
    if (!this.valid() || !this.value || this.saving || this.site.state.fatal) return;
    if (kind === 'photo' && this.value.draft.photos.length >= 4 || kind === 'voice' && this.value.draft.voice) return;
    const epoch = this.epoch; this.saving = true; this.emit({ captureSaving: true, captureError: '' });
    let path;
    try {
      path = await this.files.save(source, kind);
      if (!this.valid(epoch)) { await this.files.remove(path); return; }
      const item = { id: key(), path, ...(kind === 'voice' ? { durationMs, durationSeconds: Math.max(1, Math.ceil(durationMs / 1000)) } : { uploadKey: key() }) };
      this.writeDraft(kind === 'voice' ? { voice: item } : { photos: [...this.value.draft.photos, item] });
    } catch (_) { if (this.valid(epoch)) this.emit({ captureError: '未能把材料保存在手机，请检查存储空间后重新添加。' }); }
    finally { this.saving = false; if (this.valid(epoch)) this.emit({ captureSaving: false }); }
  }
  async removeFile(id) {
    if (!this.valid() || !this.value || this.saving) return;
    const d = this.value.draft, file = d.voice?.id === id ? d.voice : d.photos.find(p => p.id === id);
    if (!file) return;
    if (this.writeDraft(d.voice?.id === id ? { voice: null } : { photos: d.photos.filter(p => p.id !== id) })) await this.files.remove(file.path);
  }
  submit(quick = false) {
    if (!this.valid() || !this.value || this.saving || !this.site.state.write || this.site.state.fatal) return false;
    const d = this.value.draft, selection = d.quick;
    if (quick && (!selection.workId || !selection.progress || selection.roomId === '')) { this.emit({ captureError: '请选择工作、部位和进度。' }); return false; }
    if (quick && d.voice) { this.emit({ captureError: '当前有一段录音，请先发送这条材料，再选择常用工作。' }); return false; }
    if (!quick && !d.text.trim() && !d.photos.length && !d.voice) return false;
    if (this.value.queue.length >= 20) { this.emit({ captureError: '待上传记录较多，请先联网续传。' }); return false; }
    const capture = quick ? { kind: 'quick', ...selection } : { kind: 'free' };
    const room = this.site.state.rooms?.find(r => r.id === selection.roomId);
    const work = this.site.state.quickWorks?.find(w => w.id === selection.workId);
    const entry = { key: key(), createdAt: new Date().toISOString(), text: d.text.trim(), photos: clone(d.photos), voice: d.voice && clone(d.voice), capture,
      displayText: quick ? `${room?.name || (selection.location === 'whole' ? '全屋' : '部位待核对')} · ${work?.label || ''} · ${labels[selection.progress]}${d.text.trim() ? '\n' + d.text.trim() : ''}` : d.text.trim(), dispatched: false };
    try {
      this.persist({ ...this.value, draft: emptyDraft(), queue: [...this.value.queue, entry] });
      this.emit({ captureError: '', captureSubmitted: entry.key });
      void this.flush(); return true;
    } catch (_) { this.emit({ captureError: '本机保存未完成，材料仍在输入区，请重试。' }); return false; }
  }
  update(id, patch) {
    const next = clone(this.value), entry = next.queue.find(e => e.key === id);
    if (!entry) throw Error('local_entry_missing');
    Object.assign(entry, patch); this.persist(next); return entry;
  }
  async accepted(items = []) {
    if (!this.valid() || !this.value) return;
    const received = this.value.queue.filter(e => items.some(i => i.message.client_message_id === e.key));
    if (!received.length) { this.render(); return; }
    try {
      this.persist({ ...this.value, queue: this.value.queue.filter(e => !received.includes(e)) });
      for (const e of received) for (const p of [...e.photos, ...(e.voice ? [e.voice] : [])]) await this.files.remove(p.path);
    } catch (_) { this.emit({ captureError: '材料已收到，本机缓存稍后清理。' }); }
  }
  async revoke() {
    if (!this.value) return;
    const entries = [this.value.draft, ...this.value.queue];
    try { this.site.storage.remove(this.storageKey); } catch (_) { /* Always clear visible originals and owned files after revocation. */ }
    this.value = { version: 1, draft: emptyDraft(), queue: [] }; this.render();
    for (const e of entries) for (const p of [...e.photos, ...(e.voice ? [e.voice] : [])]) await this.files.remove(p.path);
  }
  async flush() {
    if (!this.valid() || !this.value) return;
    if (this.flushing) { this.flushAgain = true; return; }
    const epoch = this.epoch; this.flushing = true;
    try {
      await this.site.load();
      if (!this.valid(epoch) || !this.site.state.write || this.site.state.fatal) return;
      for (const original of this.value.queue.slice()) {
        if (!this.valid(epoch)) return;
        if (original.receipt) continue;
        let e = this.value.queue.find(x => x.key === original.key); if (!e) continue;
        this.activeKey = e.key; this.render();
        try {
          let result;
          if (e.dispatched) {
            const lookup = await this.site.request(this.site.base + '/operations/' + encodeURIComponent(e.key), 'GET', {}, { suppressUnauthorized: true });
            if (!this.valid(epoch)) return;
            if (lookup.data.found) result = lookup.data.result;
          }
          if (!result) {
            for (let i = 0; i < e.photos.length; i++) if (!e.photos[i].mediaId) {
              const photo = e.photos[i], upload = await this.site.uploadFile(this.site.base + '/media', photo.path, photo.uploadKey);
              if (!this.valid(epoch)) return;
              if (!/^[1-9]\d*$/.test(String(upload?.id))) throw Error('invalid_upload_receipt');
              const photos = clone(e.photos); photos[i].mediaId = String(upload.id); e = this.update(e.key, { photos });
            }
            if (!e.body) e = this.update(e.key, { body: { text: e.text, mediaIds: e.photos.map(p => p.mediaId), capture: e.capture } });
            const body = clone(e.body);
            if (e.voice) body.recording = await this.files.read(e.voice.path);
            if (!this.valid(epoch)) return;
            e = this.update(e.key, { dispatched: true, error: '' });
            result = (await this.site.request(this.site.base + '/messages', 'POST', body, { suppressUnauthorized: true, headers: { 'Idempotency-Key': e.key } })).data;
            if (!this.valid(epoch)) return;
          }
          if (result?.status !== 'received' || result.requestKey !== e.key || !(result.recordId === null || /^[1-9]\d*$/.test(String(result.recordId)))
            || !/^[1-9]\d*$/.test(String(result.messageId)) || JSON.stringify(result.mediaIds) !== JSON.stringify(e.body?.mediaIds || [])) throw Error('invalid_capture_receipt');
          this.update(e.key, { receipt: result, error: '' });
          await this.site.load();
          if (this.valid(epoch)) await this.accepted(this.site.state.items);
        } catch (error) {
          if (!this.valid(epoch)) return;
          if ([401, 403, 404].includes(error.statusCode)) {
            await this.site.load();
            if (this.site.state.fatal) { if (this.site.state.fatalStatus === 401) this.hide(); else await this.revoke(); }
          }
          if (!this.valid(epoch) || !this.value.queue.some(x => x.key === e.key)) return;
          const known = error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 408;
          this.update(e.key, { ...(known ? { dispatched: false } : {}), error: known ? errorText(error) : e.dispatched ? '送达结果待核对' : '待上传 · 已留在手机' });
          break;
        }
      }
    } catch (_) { if (this.valid(epoch)) this.emit({ captureError: '暂时未能续传，原材料已保留，请重试。' }); }
    finally {
      this.flushing = false; this.activeKey = ''; if (this.valid(epoch)) this.render();
      const again = this.flushAgain; this.flushAgain = false;
      if (again && this.valid()) void this.flush();
    }
  }
}
module.exports = { SiteCapture, nativeFiles, labels };
