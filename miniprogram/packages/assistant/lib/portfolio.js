const { AssistantClient, errorCopy, uncertain } = require('./client');
const ID = /^[1-9]\d{0,18}$/;
const pathFor = id => `/conversations/${encodeURIComponent(id)}/portfolio`;
const savedEntryKey = 'assistant-portfolio-reentry-v1';
const initial = () => ({ loading: true, busy: false, error: '', needsLogin: false, unavailable: false,
  conversationId: '', designer: null, work: null, works: [], visibleCount: 6, images: {}, imageError: '',
  sharePath: '', shareTitle: '', pendingAction: '', readOnly: false, feedback: '' });

class PortfolioImages {
  constructor(client) { this.client = client; this.epoch = 0; this.paths = []; }
  clear() {
    this.epoch += 1;
    for (const filePath of this.paths) wx.getFileSystemManager().unlink({ filePath, fail() {} });
    this.paths = [];
  }
  async load(conversationId, work, assetId) {
    if (![conversationId, work.id, work.versionId, assetId].every(v => ID.test(String(v)))) throw { code: 'invalid_response' };
    const epoch = this.epoch;
    const data = await this.client.read(`${pathFor(conversationId)}/works/${work.id}/assets/${assetId}`, { versionId: work.versionId, format: 'base64' });
    if (data.mimeType !== 'image/jpeg' || typeof data.imageBase64 !== 'string' || data.imageBase64.length > 409600
      || !/^\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(data.imageBase64)) throw { code: 'invalid_response' };
    if (epoch !== this.epoch) throw { code: 'context_changed' };
    const filePath = `${wx.env.USER_DATA_PATH}/assistant-portfolio-${work.id}-${work.versionId}-${assetId}-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
    await new Promise((resolve, reject) => wx.getFileSystemManager().writeFile({ filePath, data: data.imageBase64, encoding: 'base64', success: resolve, fail: reject }));
    if (epoch !== this.epoch) { wx.getFileSystemManager().unlink({ filePath, fail() {} }); throw { code: 'context_changed' }; }
    this.paths.push(filePath); return filePath;
  }
}
function workForView(work) {
  return { ...work, coverLabel: imageLabel((work.images || []).find(i => i.assetId === work.coverAssetId) || {}),
    metadata: [work.primaryStyle, work.area ? work.area + '㎡' : '', work.rooms].filter(Boolean).join(' · '),
    renders: (work.images || []).filter(i => i.kind === 'render').map(i => ({ ...i, label: imageLabel(i) })),
    photos: (work.images || []).filter(i => i.kind === 'photo').map(i => ({ ...i, label: imageLabel(i) })) };
}
function imageLabel(image) { return image.kind === 'photo' ? image.showroom ? '样板间实拍' : '实拍图' : image.aiGenerated ? 'AI生成效果图' : '效果图'; }
class PortfolioController {
  constructor({ emit, identity, client = new AssistantClient(), images }) {
    this.emit = emit; this.identity = identity; this.client = client; this.images = images || new PortfolioImages(client);
    this.state = initial(); this.epoch = 0;
  }
  set(patch) { Object.assign(this.state, patch); this.emit(patch); }
  valid(epoch) { return epoch === this.epoch && this.session === this.identity() && this.visible; }
  hide() { this.visible = false; this.showTicket = (this.showTicket || 0) + 1; this.epoch += 1; this.images.clear(); this.set({ images: {}, sharePath: '' }); }
  async show(options = {}, kind = 'designer') {
    const ticket = this.showTicket = (this.showTicket || 0) + 1;
    if (this.flight) await this.flight;
    if (ticket !== this.showTicket) return;
    this.visible = true; this.options = options; this.kind = kind;
    const session = this.identity();
    if (this.session && this.session !== session) { this.client.pending.clear(); this.conversationId = ''; this.images.clear(); this.set(initial()); }
    this.session = session;
    if (!session) { this.set({ ...initial(), loading: false, needsLogin: true, error: '登录后查看作品，并回到自己的装修咨询。' }); return; }
    return this.load();
  }
  fail(error, epoch) {
    if (!this.valid(epoch)) return;
    const denied = [401, 403, 404].includes(error.statusCode) || ['identity_context_invalid', 'entry_context_invalid', 'portfolio_not_found', 'assistant_resource_not_found'].includes(error.code);
    if (denied) { this.epoch += 1; this.images.clear(); this.set({ designer: null, work: null, works: [], images: {}, sharePath: '', unavailable: true }); }
    this.set({ loading: false, busy: false, error: errorCopy(error), needsLogin: error.statusCode === 401 });
  }
  async resolveConversation(epoch) {
    const options = this.options;
    if (options.portfolioEntry) {
      if (options.conversationId || options.authorId || options.workId || options.versionId) throw { code: 'entry_context_invalid', statusCode: 422 };
      const entry = await this.client.read('/entry-context', { portfolioEntry: options.portfolioEntry }, {}, 'POST');
      if (!this.valid(epoch)) return null;
      if (!entry.portfolio || !ID.test(entry.portfolio.authorId)) throw { code: 'invalid_response' };
      this.authorId = entry.portfolio.authorId; this.sourceWorkId = entry.portfolio.workId;
      let saved;
      try { saved = wx.getStorageSync(savedEntryKey); } catch (_) { /* Memory remains usable. */ }
      if (!this.conversationId && saved?.session === this.session && saved.token === options.portfolioEntry) this.conversationId = saved.conversationId;
      if (!this.conversationId) {
        const created = await this.client.mutate('portfolio-create:' + options.portfolioEntry, '/conversations', { entryToken: entry.entryToken });
        if (!this.valid(epoch)) return null;
        if (!ID.test(String(created.id))) throw { code: 'invalid_response' };
        this.conversationId = String(created.id);
        try { wx.setStorageSync(savedEntryKey, { session: this.session, token: options.portfolioEntry, conversationId: this.conversationId }); } catch (_) { /* Current page retains reentry. */ }
      }
    } else {
      if (!ID.test(String(options.conversationId))) throw { code: 'entry_context_invalid', statusCode: 422 };
      this.conversationId = String(options.conversationId);
      this.authorId = options.authorId; this.sourceWorkId = options.sourceWorkId;
    }
    const conversation = await this.client.read('/conversations/' + this.conversationId);
    if (!this.valid(epoch)) return null;
    this.set({ conversationId: this.conversationId, readOnly: conversation.status !== 'open' });
    return conversation;
  }
  async load() {
    const epoch = ++this.epoch;
    this.images.clear(); this.set({ loading: true, busy: false, needsLogin: false, error: '', unavailable: false, images: {}, sharePath: '', imageError: '' });
    try {
      if (!await this.resolveConversation(epoch) || !this.valid(epoch)) return;
      const base = pathFor(this.conversationId);
      if (this.kind === 'work') {
        if (!ID.test(String(this.options.workId)) || !ID.test(String(this.options.versionId))) throw { code: 'entry_context_invalid', statusCode: 422 };
        const data = await this.client.read(`${base}/works/${this.options.workId}`, { versionId: this.options.versionId });
        if (!this.valid(epoch)) return;
        this.authorId = data.authorId; this.set({ work: workForView(data) });
      } else {
        if (!ID.test(String(this.authorId))) throw { code: 'entry_context_invalid', statusCode: 422 };
        const designer = await this.client.read(`${base}/designers/${this.authorId}`);
        if (!this.valid(epoch)) return;
        const works = (designer.works || []).map(workForView);
        if (this.sourceWorkId) works.sort((a, b) => Number(b.id === this.sourceWorkId) - Number(a.id === this.sourceWorkId));
        this.set({ designer: { ...designer, cityLabel: (designer.cities || []).map(c => c.name).join(' / '), initial: String(designer.name || '设').slice(0, 1) }, works });
      }
      const work = this.state.work || this.state.works[0];
      if (work) {
        const pending = this.client.pending.get('portfolio-write:' + this.conversationId + ':' + work.id);
        this.set({ pendingAction: pending ? pending.path.endsWith('/contact') ? 'contact' : pending.body.sentiment : '' });
      }
      this.set({ loading: false });
      await this.loadImages(epoch);
      if (work && this.valid(epoch)) {
        try {
          const share = await this.client.read(`${base}/works/${work.id}/share`, { versionId: work.versionId }, {}, 'POST');
          if (this.valid(epoch)) this.set({ sharePath: share.path, shareTitle: (this.state.designer?.name || work.authorName) + '的设计室 · 家客来' });
        } catch (error) { if ([401,403,404].includes(error.statusCode)) this.fail(error, epoch); }
      }
    } catch (error) { this.fail(error, epoch); }
  }
  async loadImages(epoch = this.epoch) {
    const work = this.state.work;
    const tasks = work ? (work.images || []).map(i => [work, i.assetId]) : this.state.works.slice(0, this.state.visibleCount).map(w => [w, w.coverAssetId]);
    let index = 0;
    const worker = async () => {
      while (index < tasks.length && this.valid(epoch)) {
        const [w, assetId] = tasks[index++], imageKey = 'i' + assetId;
        if (this.state.images[imageKey]) continue;
        try {
          const filePath = await this.images.load(this.conversationId, w, assetId);
          if (this.valid(epoch)) this.set({ images: { ...this.state.images, [imageKey]: filePath } });
        } catch (error) {
          if ([401,403,404].includes(error.statusCode)) { this.fail(error, epoch); return; }
          if (this.valid(epoch)) this.set({ imageError: '部分图片暂未加载，点此重试。' });
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  }
  more() { this.set({ visibleCount: this.state.visibleCount + 6 }); return this.loadImages(); }
  write(action) {
    if (this.flight) return this.flight;
    this.flight = this.performWrite(action).finally(() => { this.flight = null; });
    return this.flight;
  }
  async performWrite(action) {
    const work = this.state.work || this.state.works[0];
    if (!work || this.state.busy || this.state.readOnly || this.state.unavailable || this.state.loading || (this.state.pendingAction && this.state.pendingAction !== action)) return;
    const epoch = this.epoch, slot = 'portfolio-write:' + this.conversationId + ':' + work.id;
    this.set({ busy: true, error: '', feedback: '' });
    try {
      const data = await this.client.mutate(slot, `${pathFor(this.conversationId)}/works/${work.id}/${action === 'contact' ? 'contact' : 'preference'}`,
        action === 'contact' ? { versionId: work.versionId } : { versionId: work.versionId, sentiment: action, expectedVersion: work.preferenceVersion });
      if (!this.valid(epoch)) return;
      this.set({ pendingAction: '', feedback: action === 'contact' ? '已提交联系意向，请回原咨询继续沟通。' : '已记下这个方向，随时可以更正。',
        ...(action !== 'contact' ? { work: { ...work, preference: data.sentiment, preferenceVersion: data.preferenceVersion } } : {}) });
      return action === 'contact' ? this.conversationId : null;
    } catch (error) {
      if (this.valid(epoch)) { this.set({ pendingAction: uncertain(error) ? action : '' }); this.fail(error, epoch); }
    } finally { if (this.valid(epoch)) this.set({ busy: false }); }
  }
}
class RecommendationController {
  constructor({ emit, identity, client = new AssistantClient(), images }) {
    this.emit = emit; this.identity = identity; this.client = client; this.images = images || new PortfolioImages(client); this.epoch = 0;
  }
  clear() { this.epoch += 1; this.images.clear(); this.emit({ portfolioItems: [], portfolioImages: {}, portfolioError: '', portfolioNotice: '', portfolioLoading: false }); }
  async load(conversationId, explicit = false) {
    this.clear();
    if (!ID.test(String(conversationId))) return;
    const epoch = this.epoch, session = this.identity();
    const valid = () => this.epoch === epoch && session === this.identity();
    this.emit({ portfolioLoading: explicit });
    try {
      const result = await this.client.read(pathFor(conversationId) + '/recommendations');
      if (!valid()) return;
      const items = (result.items || []).map(i => ({ ...i, work: workForView(i.work) }));
      this.emit({ portfolioItems: items, portfolioNotice: items.length || explicit ? result.notice : '', portfolioLoading: false });
      const paths = {};
      for (const item of items) {
        try {
          const filePath = await this.images.load(conversationId, item.work, item.work.coverAssetId);
          if (!valid()) return;
          paths['i' + item.work.coverAssetId] = filePath;
          this.emit({ portfolioImages: { ...paths } });
        } catch (error) {
          if ([401,403,404].includes(error.statusCode)) throw error;
          if (valid()) this.emit({ portfolioError: '部分作品图片暂未加载，可以重新读取。' });
        }
      }
      if (!items.length && explicit && !result.needContext) this.emit({ portfolioNotice: '当前服务范围暂无匹配作品，可以继续聊聊或调整风格、地区。' });
    } catch (error) {
      if (valid()) { this.clear(); this.emit({ portfolioError: errorCopy(error) }); }
    } finally { if (valid()) this.emit({ portfolioLoading: false }); }
  }
}
module.exports = { PortfolioController, PortfolioImages, RecommendationController, workForView, pathFor, initial };
