const { PublicSiteClient, PublicMedia, imagePath, viewMaterial, validId, publicError } = require('../../../utils/public-site-client');
const initial = () => ({ loading: true, error: '', unavailable: false, items: [], site: null, publicPaths: {}, areas: [], areaIndex: 0, areaLabel: '选择片区', tab: 'records', draft: '' });
class PublicSitesController {
  constructor({ emit, identity = () => '', client = new PublicSiteClient(), media }) {
    Object.assign(this, { emit, identity, client }); this.state = initial(); this.epoch = 0;
    this.media = media || new PublicMedia({ identity, emit: patch => { if (patch.publicMediaRevoked) this.set({ items: [], site: null, unavailable: true }); this.set(patch); } });
  }
  set(p) { Object.assign(this.state, p); this.emit(p); }
  valid(epoch) { return this.visible && epoch === this.epoch && this.session === this.identity(); }
  async show(options = {}, detail = false) {
    this.visible = true;
    this.epoch++;
    if (this.session !== this.identity()) { this.media.clear(); this.set(initial()); }
    this.session = this.identity(); this.options = options; this.detail = detail;
    this.entryValid = validId(options.enterpriseId) && (!detail || validId(options.siteId) && validId(options.versionId));
    if (!this.entryValid) { this.media.clear(); this.set({ ...initial(), loading: false, unavailable: true, error: '请从有效的公开工地入口进入。' }); return; }
    return this.load();
  }
  hide() { this.visible = false; this.epoch++; this.media.clear(); this.set({ items: [], site: null }); }
  async load() {
    if (!this.visible || !this.entryValid) return; const epoch = ++this.epoch, eid = this.options.enterpriseId;
    this.set({ loading: true, error: '', unavailable: false });
    try {
      if (this.detail) {
        const value = await this.client.read(eid, 'sites/' + this.options.siteId, { versionId: this.options.versionId });
        if (!this.valid(epoch)) return; this.set({ site: viewMaterial(value), loading: false });
      } else {
        const data = await this.client.read(eid, 'areas'); if (!this.valid(epoch)) return;
        const areas = [{ label: '所有服务片区', cityCode: '', district: '' }, ...(data.items || [])];
        const prior = this.state.areas[this.state.areaIndex] || this.options;
        let index = areas.findIndex(a => a.cityCode === prior.cityCode && a.district === prior.district);
        if (index < 0 || index >= areas.length) index = 0;
        const selected = areas[index]; this.set({ areas, areaIndex: index, areaLabel: selected.label });
        const list = await this.client.read(eid, 'sites', selected.cityCode ? { cityCode: selected.cityCode, district: selected.district } : {});
        if (!this.valid(epoch)) return; this.set({ items: (list.items || []).map(viewMaterial), loading: false });
      }
      const items = this.detail ? [this.state.site] : this.state.items;
      await this.media.load(items.filter(Boolean).flatMap(item => (this.detail ? item.photos : item.photos.slice(0, 1)).map(photo => ({ key: photo.key, path: imagePath(eid, item, photo) }))));
    } catch (error) { if (this.valid(epoch)) { this.media.clear(); this.set({ loading: false, error: publicError(error), items: [], site: null, unavailable: [401,403,404].includes(error.statusCode) }); } }
  }
  area(index) { if (!Number.isInteger(index) || index < 0 || index >= this.state.areas.length) return; this.set({ areaIndex: index }); return this.load(); }
  privateChat(site, designer = false) {
    const values = { ...(validId(this.options.conversationId) ? { conversationId: this.options.conversationId } : { publicEnterpriseId: this.options.enterpriseId }),
      ...(site ? { publicSiteId: site.id, publicVersionId: site.versionId, publicEnterpriseId: this.options.enterpriseId } : {}),
      ...(designer ? { findDesigner: '1' } : {}), ...(this.state.draft ? { prompt: this.state.draft } : {}) };
    return '/packages/assistant/chat/chat?' + Object.entries(values).map(([k,v]) => k + '=' + encodeURIComponent(v)).join('&');
  }
}
module.exports = { PublicSitesController, initial };
