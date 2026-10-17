const api = require('../../../utils/api');
const ACTIVE = ['queued', 'running'];
const key = () => 'site-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
function errorText(e) {
  if (e && e.statusCode === 401) return '登录已过期，请返回后重新登录。';
  const code = e && (e.error || e.code || e.message);
  return ({ version_conflict: '记录已被更新，已读取最新版，请核对后再提交。', context_changed: '原材料或权限已变化，请重新读取并核对。',
    construction_forbidden: '当前身份没有这项工地权限。', construction_not_found: '工地已不可访问，请返回列表。', assistant_resource_not_found: '工地或原材料已不可访问。',
    assistant_disabled: '企业暂未开放小K整理，请联系负责人。', assistant_quota_exceeded: '本次整理额度暂不可用，内容已保留。',
    site_retry_unavailable: '本次整理仍在核对结果，可先人工修改草稿。', site_review_required: '请先核对并补充本条现场内容。',
    media_limit: '本工地图片数量已达当前上限，请联系负责人。', media_invalid: '请选择4MB以内的JPEG或PNG图片。',
    construction_media_unavailable: '照片已不可访问，请重新读取。', idempotency_conflict: '本次操作内容不一致，请重新读取。',
  })[code] || (e && e.statusCode === 403 ? '当前身份已无此工地权限，请返回工地列表。' : e && e.statusCode === 404 ? '工地或原材料已不可访问，请返回列表。' : '暂时未能完成，请保留内容后重试。');
}
function upload(path, filePath, requestKey) {
  return new Promise((resolve, reject) => {
    const token = getApp().globalData.token || wx.getStorageSync('token');
    wx.uploadFile({ url: api.getBaseUrls()[0] + path, filePath, name: 'file', timeout: 30000,
      header: { Authorization: 'Bearer ' + token, 'Idempotency-Key': requestKey },
      success(res) { let value; try { value = JSON.parse(res.data); } catch { reject({ statusCode: res.statusCode }); return; }
        if (res.statusCode >= 200 && res.statusCode < 300 && value.success) resolve(value.data);
        else reject({ ...value, statusCode: res.statusCode }); }, fail: reject });
  });
}
function decorate(item) {
  if (!item.record) return { ...item, record: { id: '', media: item.response && item.response.media || [] },
    text: (item.message.content.blocks || []).map(b => b.text || b.fallbackText || '').join('\n'),
    time: new Date(item.message.created_at).toLocaleString('zh-CN', { hour12: false }) };
  const r = item.record, data = r.data || {};
  const updated = new Date(r.updated_at);
  const generating = r.status === 'organizing' && ACTIVE.includes(r.run_status);
  const failed = r.status === 'organizing' && !generating;
  const labels = { organizing: generating ? '正在整理' : '整理未完成', draft: '待核对', published: '已发布', withdrawn: '已撤回' };
  return { ...item, text: (item.message.content.blocks || []).map(b => b.text || b.fallbackText || '').join('\n'),
    time: new Date(item.message.created_at).toLocaleString('zh-CN', { hour12: false }),
    record: { ...r, data, generating, failed, label: labels[r.status], updatedLabel: r.updated_at && !Number.isNaN(updated.getTime()) ? updated.toLocaleString('zh-CN', { hour12: false }) : '',
      canRetry: failed && ['failed', 'cancelled'].includes(r.run_status) && !r.pending_cost,
      scopeLabel: r.audience === 'customer' ? '项目成员和本项目业主可查看' : '仅本项目成员可查看',
      rows: [{ label: '施工部位', value: r.room_name_snapshot || '待核对' }, { label: '本次完成', value: data.completed || '待核对' },
        { label: '尚未完成', value: data.pending || '未说明' }, { label: '待沟通', value: data.coordination || '未说明', coordination: true }] } };
}
/** A pending command keeps its original body/version/key across reentry, scoped to staff + enterprise + project. */
class SiteClient {
  constructor({ emit, identity, storage = { get: k => wx.getStorageSync(k), set: (k, v) => wx.setStorageSync(k, v), remove: k => wx.removeStorageSync(k) },
    request = api.request, uploadFile = upload, download = api.downloadFile }) {
    Object.assign(this, { emit, identity, storage, request, uploadFile, download }); this.epoch = 0; this.paths = new Set();
    this.state = { loading: true, busy: false, error: '', fatal: false, items: [], mediaPaths: {}, draft: '', attachments: [], pending: null };
  }
  set(p) { Object.assign(this.state, p); this.emit(p); }
  current(epoch) { const s = this.identity(); return this.visible && s.token === this.session.token && s.key === this.session.key && epoch === this.epoch; }
  clean() { for (const path of this.paths) { try { wx.getFileSystemManager().unlink({ filePath: path, fail() {} }); } catch { /* Page teardown. */ } } this.paths.clear(); }
  hide() { this.visible = false; ++this.epoch; this.clean(); this.set({ items: [], mediaPaths: {}, project: null, rooms: [], sheet: '', versions: [], edit: {}, conflict: null, write: false, draft: '', attachments: [] }); }
  async show(projectId) {
    this.clean(); this.session = this.identity(); this.projectId = projectId; this.visible = true; const epoch = ++this.epoch;
    this.base = '/miniprogram/construction/projects/' + projectId + '/chat';
    this.storageKey = 'site:pending:' + this.session.key + ':' + projectId; this.draftKey = 'site:draft:' + this.session.key + ':' + projectId;
    const saved = this.storage.get(this.draftKey) || {};
    this.set({ loading: true, busy: false, fatal: false, error: '', conflict: null, items: [], mediaPaths: {}, sheet: '', draft: saved.text || '', attachments: saved.attachments || [], pending: this.storage.get(this.storageKey) || null });
    await this.load(false, epoch);
    if (this.current(epoch) && !this.state.fatal && this.state.pending) await this.reconcile();
  }
  saveDraft() { this.storage.set(this.draftKey, { text: this.state.draft, attachments: this.state.attachments }); }
  input(text) { if (!this.state.pending && !this.state.busy) { this.set({ draft: text }); this.saveDraft(); } }
  async load(older = false, epoch = this.epoch) {
    if (!this.current(epoch) || (older && !this.state.nextCursor)) return;
    const readSeq = this.readSeq = (this.readSeq || 0) + 1, valid = () => this.current(epoch) && readSeq === this.readSeq;
    try {
      const r = await this.request(this.base + (older ? '?beforeSeq=' + this.state.nextCursor + '&limit=30' : '?limit=' + Math.min(100, Math.max(30, this.state.items.length))), 'GET', {}, { suppressUnauthorized: true });
      if (!valid()) return;
      const data = r.data, fresh = data.items.map(decorate);
      // Previously loaded history is refreshed as well: edits/revocations cannot remain as stale cards.
      let items = fresh;
      if (older) items = [...fresh, ...this.state.items.filter(i => !fresh.some(n => n.message.id === i.message.id))];
      this.set({ ...data, items, nextCursor: data.nextCursor, loading: false, error: '', fatal: false });
      const mids = new Set([...items.flatMap(i => i.record.media.map(m => String(m.id))), ...this.state.attachments.map(String)]);
      const mediaPaths = { ...this.state.mediaPaths };
      for (const mid of Object.keys(mediaPaths)) if (!mids.has(mid)) { this.unlink(mediaPaths[mid]); delete mediaPaths[mid]; }
      this.set({ mediaPaths });
      for (const mid of mids) if (!mediaPaths[mid]) {
        try {
          const d = await this.download(this.base + '/media/' + mid, { suppressUnauthorized: true });
          if (!valid()) { this.unlink(d.tempFilePath); return; }
          this.paths.add(d.tempFilePath); mediaPaths[mid] = d.tempFilePath; this.set({ mediaPaths: { ...mediaPaths } });
        } catch (e) { if (valid()) this.set({ error: errorText(e) }); }
      }
    } catch (e) {
      if (!valid()) return;
      const fatal = [401, 403, 404].includes(e.statusCode);
      if (fatal) { this.clean(); this.set({ items: [], mediaPaths: {}, project: null, rooms: [], attachments: [], draft: '', sheet: '' }); }
      this.set({ loading: false, fatal, error: errorText(e) });
    }
  }
  unlink(path) { if (!path) return; this.paths.delete(path); try { wx.getFileSystemManager().unlink({ filePath: path, fail() {} }); } catch { /* Native temp file already expired. */ } }
  async perform(op, epoch = this.epoch) {
    if (!this.current(epoch) || this.state.busy || this.state.fatal) return;
    this.storage.set(this.storageKey, op); this.set({ pending: op, busy: true, error: '' });
    try {
      const result = op.kind === 'upload' ? await this.uploadFile(this.base + '/media', op.filePath, op.key)
        : (await this.request(this.base + op.path, 'POST', op.body, { suppressUnauthorized: true, headers: { 'Idempotency-Key': op.key } })).data;
      if (this.current(epoch)) await this.receipt(op, result, epoch);
    } catch (e) {
      if (this.current(epoch)) {
        const known = e.statusCode >= 400 && e.statusCode < 500;
        if (known) { this.storage.remove(this.storageKey); this.set({ pending: null }); }
        this.set({ error: known ? errorText(e) : '提交结果待核对。请核对同一次操作，内容已保留。' });
        if ([401, 403, 404].includes(e.statusCode)) { this.clean(); this.set({ fatal: true, items: [], mediaPaths: {}, project: null, rooms: [], draft: '', attachments: [], sheet: '' }); }
        if (e.error === 'version_conflict' || e.code === 'version_conflict') {
          await this.load(false, epoch);
          if (this.current(epoch)) { const id = op.path.split('/')[2], latest = this.state.items.find(i => i.record.id === id)?.record;
            this.set({ error: errorText(e), conflict: latest ? { ...latest, action: op.kind } : null }); }
        }
      }
    } finally { if (this.current(epoch)) this.set({ busy: false }); }
  }
  async receipt(op, result, epoch) {
    if (!this.current(epoch)) return;
    this.storage.remove(this.storageKey);
    if (op.kind === 'upload') { this.set({ attachments: [...new Set([...this.state.attachments, String(result.id)])] }); this.saveDraft(); }
    if (op.kind === 'photo-remove') { this.set({ attachments: this.state.attachments.filter(id => id !== String(result.id)) }); this.saveDraft(); }
    if (op.kind === 'send') { this.set({ draft: '', attachments: [] }); this.storage.remove(this.draftKey); }
    this.set({ pending: null, conflict: null, sheet: '', success: op.kind === 'send' ? (result.runId ? '原材料已保存，小K正在整理。' : '原话和回复已保存。') : op.kind === 'upload' ? '照片已上传，发送后随原文保存。' : '操作已保存。' });
    await this.load(false, epoch);
  }
  async reconcile() {
    const op = this.state.pending, epoch = this.epoch;
    if (!op || !this.current(epoch) || this.state.busy || this.state.fatal) return;
    this.set({ busy: true, error: '' });
    try {
      const r = await this.request(this.base + '/operations/' + encodeURIComponent(op.key), 'GET', {}, { suppressUnauthorized: true });
      if (!this.current(epoch)) return;
      if (r.data.found) await this.receipt(op, r.data.result, epoch);
      else { this.set({ busy: false }); await this.perform(op, epoch); }
    } catch (e) { if (this.current(epoch)) { this.set({ error: errorText(e) }); if ([401,403,404].includes(e.statusCode)) { this.clean(); this.set({ fatal: true, items: [], mediaPaths: {}, project: null, rooms: [], draft: '', attachments: [], sheet: '' }); } } }
    finally { if (this.current(epoch)) this.set({ busy: false }); }
  }
  send() {
    if (!this.state.write || this.state.pending || this.state.busy || (!this.state.draft.trim() && !this.state.attachments.length)) return;
    return this.perform({ kind: 'send', path: '/messages', key: key(), body: { text: this.state.draft.trim(), mediaIds: this.state.attachments.slice() } });
  }
  addPhoto(file) { if (!this.state.write || this.state.pending || this.state.busy || this.state.attachments.length >= 4) return; return this.perform({ kind: 'upload', key: key(), filePath: file }); }
  removePhoto(id) { if (this.state.busy || this.state.pending || !this.state.attachments.includes(String(id))) return; return this.perform({ kind: 'photo-remove', key: key(), path: '/media/' + id + '/remove', body: {} }); }
  mutate(record, action, body = {}) {
    if (!record || this.state.pending || this.state.busy || !record.canEdit) return;
    return this.perform({ kind: action, path: '/records/' + record.id + '/' + action, key: key(), body: { ...body, expectedVersion: record.version } });
  }
}
module.exports = { SiteClient, decorate, errorText, key };
