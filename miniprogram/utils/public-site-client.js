const api = require('./api');
const ID = /^[1-9]\d{0,18}$/;
function validId(value) { return ID.test(String(value || '')); }
function publicPath(eid, suffix) {
  if (!validId(eid)) throw { code: 'public_site_unavailable', statusCode: 404 };
  return '/public/construction/' + eid + '/' + suffix;
}
function materialKey(item) { return item.id + '_' + item.versionId; }
function imageKey(item, photo) { return materialKey(item) + '_' + photo.id; }
function imagePath(eid, item, photo, cid) {
  if (![item.id, item.versionId, photo.id].every(validId)) throw { code: 'invalid_response' };
  const base = cid ? '/miniprogram/assistant/conversations/' + cid + '/public-sites/' + item.id : publicPath(eid, 'sites/' + item.id);
  return base + '/media/' + photo.id + '?versionId=' + item.versionId;
}
function viewMaterial(item) {
  if (!item || ![item.id, item.versionId].every(validId) || !Array.isArray(item.photos) || !Array.isArray(item.excerpts)) throw { code: 'invalid_response' };
  const time = new Date(item.updatedAt), pad = n => String(n).padStart(2, '0');
  return { ...item, key: materialKey(item), dateLabel: Number.isNaN(time.getTime()) ? '' : `${pad(time.getMonth() + 1)}月${pad(time.getDate())}日更新`,
    photos: item.photos.filter(p => validId(p.id)).slice(0, 4).map(p => ({ ...p, key: imageKey(item, p) })),
    excerpts: item.excerpts.slice(0, 8).map((e, index) => { const d = new Date(e.date); return { ...e, key: index, dateLabel: Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}月${d.getDate()}日` }; }) };
}
function publicError(error) {
  const code = error && (error.code || error.error);
  if (error?.statusCode === 401) return '登录已失效，请重新登录后继续。';
  return ({ public_site_unavailable: '这份公开内容已撤回或更新，可以返回看看其他工地。', public_consent_unavailable: '这份公开预览已更新或失效，请重新读取。',
    public_source_unavailable: '原始材料已有变化，请重新核对最新内容。', public_consent_required: '需业主明确同意这一版，再由企业审核公开。',
    public_preview_required: '请先查看这一版的全部公开内容。', public_state_conflict: '材料状态已变化，请重新读取。',
    public_material_sensitive: '内容中仍有联系方式或门牌，请先完成脱敏。', version_conflict: '材料已有更新，请重新读取后核对，不会沿用旧版决定。',
    invalid_public_material: '请核对材料、片区和版本后再操作。', identity_context_invalid: '身份已变化，请重新登录后继续。',
  })[code] || '暂时无法连接，请重新读取；已输入的内容会保留。';
}
class PublicSiteClient {
  constructor(request = api.request) { this.request = request; }
  async read(eid, path, params = {}) {
    const result = await this.request(publicPath(eid, path), 'GET', params, { suppressUnauthorized: true });
    if (!result?.success || !result.data || typeof result.data !== 'object') throw { code: 'invalid_response' };
    return result.data;
  }
}
class PublicMedia {
  constructor({ identity, emit, download = api.downloadFile }) { Object.assign(this, { identity, emit, download }); this.epoch = 0; this.paths = {}; this.wanted = []; }
  unlink(filePath) { if (!filePath) return; try { wx.getFileSystemManager().unlink({ filePath, fail() {} }); } catch (_) { /* Native temp file already expired. */ } }
  clear() { this.epoch++; for (const p of Object.values(this.paths)) this.unlink(p); this.paths = {}; this.wanted = []; this.emit({ publicPaths: {} }); }
  async load(wanted) {
    const epoch = ++this.epoch, session = this.identity(); this.wanted = wanted;
    const valid = () => this.epoch === epoch && session === this.identity();
    for (const [key, file] of Object.entries(this.paths)) if (!wanted.some(w => w.key === key)) { this.unlink(file); delete this.paths[key]; }
    this.emit({ publicPaths: { ...this.paths } });
    let index = 0;
    const worker = async () => { while (index < wanted.length && valid()) {
      const w = wanted[index++]; if (this.paths[w.key]) continue;
      try { const result = await this.download(w.path, { suppressUnauthorized: true }); if (!valid()) { this.unlink(result.tempFilePath); return; }
        this.paths[w.key] = result.tempFilePath; this.emit({ publicPaths: { ...this.paths } });
      } catch (error) { if (valid()) { if ([401,403,404].includes(error.statusCode)) { this.clear(); this.emit({ publicError: publicError(error), publicMediaRevoked: true }); return; } this.emit({ publicError: '部分公开照片未能加载，可以重新读取。' }); } }
    } };
    await Promise.all([worker(), worker()]);
  }
  async preview(key) {
    const item = this.wanted.find(w => w.key === key); if (!item) return;
    const epoch = this.epoch, session = this.identity();
    try { const result = await this.download(item.path, { suppressUnauthorized: true }); if (epoch !== this.epoch || session !== this.identity()) { this.unlink(result.tempFilePath); return; }
      this.unlink(this.paths[key]); this.paths[key] = result.tempFilePath; this.emit({ publicPaths: { ...this.paths } }); wx.previewImage({ urls: [result.tempFilePath], current: result.tempFilePath });
    } catch (error) { if (epoch === this.epoch && session === this.identity()) { this.clear(); this.emit({ publicError: publicError(error), publicMediaRevoked: true }); } }
  }
}
module.exports = { PublicSiteClient, PublicMedia, publicPath, imagePath, imageKey, materialKey, viewMaterial, validId, publicError };
