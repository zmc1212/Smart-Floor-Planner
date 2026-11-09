const { AssistantClient, uncertain } = require('./client');
const { PublicSiteClient, PublicMedia, imagePath, viewMaterial, validId, publicError } = require('../../../utils/public-site-client');
const initialPublic = () => ({ publicItems: [], publicPaths: {}, publicCards: {}, publicExpanded: '', publicError: '', publicBusy: false, publicPending: null,
  publicReplyId: '', publicBrowsing: false, publicLoading: false, publicNotice: '', publicDetail: null, publicDetailLoading: false, publicDetailError: '', publicDetailPaths: {} });
class PublicChatController {
  constructor({ emit, identity, client = new AssistantClient(), media, catalog = new PublicSiteClient(), detailMedia }) {
    Object.assign(this, { emit, identity, client, catalog }); this.state = initialPublic(); this.epoch = 0; this.detailEpoch = 0;
    this.media = media || new PublicMedia({ identity, emit: p => { if (p.publicMediaRevoked) this.set({ publicItems: [], publicCards: {}, publicExpanded: '' }); this.set(p); } });
    this.detailMedia = detailMedia || new PublicMedia({ identity, emit: p => {
      if (p.publicMediaRevoked) this.revokeDetail();
      this.set({ ...(p.publicPaths ? { publicDetailPaths: p.publicPaths } : {}), ...(p.publicError ? { publicDetailError: p.publicError } : {}) });
    } });
  }
  set(p) { Object.assign(this.state, p); this.emit(p); }
  clear() { this.epoch++; this.closeDetail(); this.media.clear(); this.set(initialPublic()); this.cid = ''; }
  valid(epoch) { return this.epoch === epoch && this.session === this.identity(); }
  pending() {
    const entry = [...this.client.pending].find(([k]) => k.startsWith('public-owner:'+this.cid+':') || k === 'public-context:'+this.cid);
    return entry ? { slot: entry[0], path: entry[1].path, body: entry[1].body } : null;
  }
  async load(cid, eid, messages) {
    if (!validId(cid) || !validId(eid)) { this.clear(); return; }
    if (this.cid !== cid || this.session !== this.identity()) this.clear();
    this.cid = cid; this.eid = eid; this.session = this.identity();
    if (this.state.publicBusy) return;
    const epoch = ++this.epoch;
    const cards = {};
    for (const message of messages) if (message.available !== false && message.publicConsent) {
      const value = viewMaterial(message.publicConsent);
      const old = this.state.publicCards[value.key];
      cards[value.key] = { ...value, summaryPhotos: value.photos.slice(0, 2), full: old?.full && old.revision === value.revision ? old.full : null };
    }
    const selected = messages.find(message => message.id === this.state.publicReplyId && message.discovery?.sites);
    const browsing = this.state.publicBrowsing && !!selected;
    const replyId = browsing ? selected.id : messages.reduce((last, message) => message.discovery?.sites ? message.id : last, '');
    this.set({ publicCards: cards, publicPending: this.pending(), publicError: '', publicReplyId: replyId,
      publicBrowsing: browsing, publicLoading: browsing,
      ...(replyId !== this.state.publicReplyId ? { publicItems: [], publicNotice: '' } : {}) });
    try {
      if (replyId) {
        const result = await this.client.read('/conversations/'+cid+'/public-sites/recommendations', { replyId });
        if (!this.valid(epoch)) return;
        const list = browsing ? await this.catalog.read(eid, 'sites', result.region ? { cityCode: result.region.cityCode, district: result.region.district || '' } : {}) : result;
        if (!this.valid(epoch)) return;
        const items = (list.items || []).map(viewMaterial);
        this.set({ publicItems: items, publicNotice: browsing ? (!items.length ? '这一片区暂时没有授权公开的工地，可以先聊聊你家的装修。' : this.browseNotice || (result.needRegion ? '当前展示所有服务片区的授权公开工地。' : '')) : '' });
      }
      const wanted = [...Object.values(cards).flatMap(item => item.photos.map(photo => ({ key: photo.key, path: imagePath(eid,item,photo,cid) }))),
        ...this.state.publicItems.flatMap(item => item.photos.slice(0,1).map(photo => ({ key: photo.key, path: imagePath(eid,item,photo) })))];
      await this.media.load(wanted);
      if (this.detailRef) await this.readDetail();
    } catch (error) { if (this.valid(epoch)) { this.media.clear(); if ([401,403,404].includes(error.statusCode)) { this.closeDetail(); this.set({ publicCards: {}, publicExpanded: '' }); } this.set({ publicItems: [], publicNotice: '', publicError: publicError(error) }); } }
    finally { if (this.valid(epoch)) this.set({ publicLoading: false }); }
  }
  browse(cid, eid, messages, notice, replyId) {
    if (![cid,eid,replyId].every(validId) || !messages.some(message => message.id === replyId && message.discovery?.sites)
      || this.state.publicBusy || this.state.publicLoading) return Promise.resolve(false);
    if (this.cid !== cid || this.session !== this.identity()) this.clear();
    this.cid = cid; this.eid = eid; this.session = this.identity();
    this.browseNotice = notice;
    this.set({ publicBrowsing: true, publicReplyId: replyId,
      ...(replyId !== this.state.publicReplyId ? { publicItems: [], publicNotice: '' } : {}) });
    return this.load(cid, eid, messages);
  }
  closeDetail() {
    this.detailEpoch++; this.detailRef = null; this.detailMedia.clear();
    this.set({ publicDetail: null, publicDetailLoading: false, publicDetailError: '', publicDetailPaths: {} });
  }
  revokeDetail() {
    this.media.clear();
    this.set({ publicDetail: null, publicItems: this.state.publicItems.filter(item => item.id !== this.detailRef?.sid || item.versionId !== this.detailRef?.versionId) });
  }
  openDetail(cid, eid, sid, versionId) {
    if (![cid,eid,sid,versionId].every(validId)) return Promise.resolve(false);
    if (this.cid !== cid || this.session !== this.identity()) this.clear();
    this.cid = cid; this.eid = eid; this.session = this.identity();
    this.closeDetail(); this.detailRef = { sid, versionId };
    return this.readDetail();
  }
  async readDetail() {
    if (!this.detailRef) return false;
    const ref = this.detailRef, epoch = ++this.detailEpoch, session = this.identity(), cid = this.cid, eid = this.eid;
    const valid = () => epoch === this.detailEpoch && session === this.identity() && cid === this.cid;
    this.set({ publicDetailLoading: true, publicDetailError: '' });
    try {
      const item = viewMaterial(await this.catalog.read(eid, 'sites/' + ref.sid, { versionId: ref.versionId }));
      if (!valid()) return false;
      this.set({ publicDetail: item });
      await this.detailMedia.load(item.photos.map(photo => ({ key: photo.key, path: imagePath(eid, item, photo) })));
      return valid() && !!this.state.publicDetail;
    } catch (error) {
      if (valid()) { this.detailMedia.clear(); if ([401,403,404].includes(error.statusCode)) this.revokeDetail(); this.set({ publicDetail: null, publicDetailError: publicError(error) }); }
      return false;
    } finally { if (valid()) this.set({ publicDetailLoading: false }); }
  }
  async decide(key, action) {
    const card = this.state.publicCards[key]; if (!card || this.state.publicBusy || this.pending()) return false;
    if (action === 'approve' && (!card.full || this.state.publicExpanded !== key)) return false;
    const slot = 'public-owner:'+this.cid+':'+card.id;
    return this.write(slot, '/conversations/'+this.cid+'/public-sites/'+card.id+'/'+action,
      { versionId: card.versionId, expectedRevision: card.revision });
  }
  async attach(cid, eid, sid, versionId) {
    if (![cid,eid,sid,versionId].every(validId)) return false;
    if (this.cid !== cid || this.session !== this.identity()) this.clear();
    this.cid = cid; this.eid = eid; this.session = this.identity();
    if (this.state.publicBusy) return false;
    const pending = this.pending();
    if (pending && pending.slot !== 'public-context:'+cid) { this.set({ publicPending: pending }); return false; }
    return this.write('public-context:'+cid, '/conversations/'+cid+'/public-sites/'+sid+'/context', { versionId });
  }
  async write(slot, path, body) {
    const epoch = this.epoch, session = this.session, cid = this.cid;
    this.set({ publicBusy: true, publicError: '' });
    try {
      const data = await this.client.mutate(slot, path, body);
      if (!this.valid(epoch) || session !== this.identity() || cid !== this.cid) return false;
      const key = data.id + '_' + data.versionId, previous = this.state.publicCards[key];
      if (previous) {
        const card = { ...previous, revision: data.revision, status: data.status,
          statusLabel: ({pending_owner:'待你决定',owner_approved:'已同意这一版，待企业审核',declined:'暂不公开',withdrawn:'已撤回'})[data.status] || previous.statusLabel,
          canDecide: data.status === 'pending_owner', canWithdraw: ['pending_owner','owner_approved','published'].includes(data.status),
          full: data.material ? viewMaterial(data.material) : previous.full };
        this.set({ publicCards: { ...this.state.publicCards, [key]: card }, ...(data.material ? { publicExpanded: key } : { publicExpanded: '' }) });
      }
      this.set({ publicPending: null }); return true;
    } catch (error) {
      if (this.valid(epoch)) {
        if ([401,403,404].includes(error.statusCode) || (error.code || error.error) === 'public_source_unavailable') { this.media.clear(); this.closeDetail(); this.set({ publicCards: {}, publicExpanded: '' }); }
        this.set({ publicError: uncertain(error) ? '结果尚未确认，请核对同一次操作。' : publicError(error), publicPending: this.pending() });
      }
      return false;
    } finally { if (this.valid(epoch)) this.set({ publicBusy: false }); }
  }
  retry() { const pending = this.pending(); return pending ? this.write(pending.slot, pending.path, pending.body) : Promise.resolve(false); }
  later() { if (!this.state.publicBusy) this.set({ publicExpanded: '' }); }
}
module.exports = { PublicChatController, initialPublic };
