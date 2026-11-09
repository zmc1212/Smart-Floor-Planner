const { AssistantClient, errorCopy, uncertain } = require('./client');
const { toursForView } = require('./tour');
const { designerAvatarPath } = require('../../../utils/designer-avatar');
const ID = /^[1-9]\d{0,18}$/;
const pathFor = id => `/conversations/${encodeURIComponent(id)}/portfolio`;
const savedEntryKey = 'assistant-portfolio-reentry-v1';
const SPACE_ORDER = ['客厅', '餐厅', '主卧', '次卧', '儿童房', '书房', '厨房', '卫生间', '阳台', '玄关', '其他'];
// Same business taxonomy order as admin/src/lib/portfolio/options.ts; unknown labels remain visible.
const LAYOUT_ORDER = ['小户型', '两居', '三居', '四居及以上', '大平层', '复式/跃层', '别墅', '旧房改造', '精装改造', '毛坯新房', '局部改造', '其他'];
const studioDefaults = () => ({ style: 'all', layout: 'all', tourOnly: false });
const initial = () => ({ loading: true, busy: false, error: '', needsLogin: false, unavailable: false,
  conversationId: '', designer: null, work: null, works: [], visibleCount: 6, images: {}, imageError: '',
  portraitPath: '', designerFilter: 'all', filterOptions: [], totalWorks: 0, spaceFilter: 'all',
  featuredWork: null, closingWork: null, catalogWorks: [], styleOptions: [], layoutOptions: [], studioFilters: studioDefaults(),
  hasStudioFilters: false, matchingCount: 0, remainingWorks: 0, studioCountLabel: '', studioResultLabel: '', catalogCompleteLabel: '',
  sharePath: '', shareTitle: '', pendingAction: '', readOnly: false, feedback: '',
  publicContact: null, contactAuthor: null, contactBusy: false, contactQrPath: '', contactError: '' });

function textList(values, max, length) {
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    if (typeof value !== 'string') continue;
    const text = value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, length);
    if (text && !result.includes(text)) result.push(text);
    if (result.length >= max) break;
  }
  return result;
}

class PortfolioImages {
  constructor(client) { this.client = client; this.epoch = 0; this.paths = []; }
  clear() {
    this.epoch += 1;
    for (const filePath of this.paths) wx.getFileSystemManager().unlink({ filePath, fail() {} });
    this.paths = [];
  }
  async load(conversationId, work, assetId) {
    if (![conversationId, work.id, work.versionId, assetId].every(v => ID.test(String(v)))) throw { code: 'invalid_response' };
    return this.loadJpeg(`${pathFor(conversationId)}/works/${work.id}/assets/${assetId}`,
      { versionId: work.versionId }, `portfolio-${work.id}-${work.versionId}-${assetId}`);
  }
  async loadPortrait(conversationId, authorId) {
    if (![conversationId, authorId].every(v => ID.test(String(v)))) throw { code: 'invalid_response' };
    return this.loadJpeg(`${pathFor(conversationId)}/designers/${authorId}/portrait`, {}, `portrait-${authorId}`);
  }
  async loadContactQr(conversationId, work, revision) {
    if (![conversationId, work.id, work.versionId, work.authorId].every(v => ID.test(String(v)))
      || !Number.isSafeInteger(revision) || revision < 1) throw { code: 'invalid_response' };
    return this.loadJpeg(`${pathFor(conversationId)}/designers/${work.authorId}/contact-qr`,
      { workId: work.id, versionId: work.versionId, revision }, `contact-${work.authorId}-${revision}`);
  }
  async loadJpeg(url, query, name) {
    const epoch = this.epoch;
    const data = await this.client.read(url, { ...query, format: 'base64' });
    if (data.mimeType !== 'image/jpeg' || typeof data.imageBase64 !== 'string' || data.imageBase64.length > 409600
      || !/^\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(data.imageBase64)) throw { code: 'invalid_response' };
    if (epoch !== this.epoch) throw { code: 'context_changed' };
    const filePath = `${wx.env.USER_DATA_PATH}/assistant-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
    await new Promise((resolve, reject) => wx.getFileSystemManager().writeFile({ filePath, data: data.imageBase64, encoding: 'base64', success: resolve, fail: reject }));
    if (epoch !== this.epoch) { wx.getFileSystemManager().unlink({ filePath, fail() {} }); throw { code: 'context_changed' }; }
    this.paths.push(filePath); return filePath;
  }
}

function contactView(value) {
  if (!value) return null;
  const contact = { revision: Number.isSafeInteger(value.revision) ? value.revision : 0,
    wechatId: typeof value.wechatId === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(value.wechatId) ? value.wechatId : '',
    phone: typeof value.phone === 'string' && /^\+?\d{7,15}$/.test(value.phone) ? value.phone : '',
    qrAvailable: value.qrAvailable === true, allowInApp: value.allowInApp !== false };
  return { ...contact, channelLabel: [contact.wechatId || contact.qrAvailable ? '工作微信' : '',
    contact.phone ? '电话' : '', contact.allowInApp ? '站内咨询' : ''].filter(Boolean).join('、') };
}

function authorView(value, fallback) {
  const source = value || fallback;
  const name = textList([source.name], 1, 60)[0] || '设计师';
  return { id: String(source.id || ''), name, fallbackAvatar: designerAvatarPath(source.defaultAvatar),
    byline: textList([source.title, source.enterpriseName, source.city], 3, 60).join(' · '),
    portraitAvailable: source.portraitAvailable === true };
}

function spaceGroupsFor(images) {
  const counts = new Map();
  for (const image of images) if (image.space) counts.set(image.space, (counts.get(image.space) || 0) + 1);
  const groups = SPACE_ORDER.filter(space => counts.has(space)).map(space => ({ key: space, label: space, count: counts.get(space) }));
  for (const space of counts.keys()) if (!SPACE_ORDER.includes(space)) groups.push({ key: space, label: space, count: counts.get(space) });
  const unlabeled = images.filter(image => !image.space).length;
  if (unlabeled) groups.push({ key: '', label: '未标注', count: unlabeled });
  return groups;
}

function galleryFor(images, coverAssetId) {
  const main = images.find(image => image.space === '客厅') || images.find(image => image.assetId === coverAssetId) || images[0];
  const ordered = main ? [main, ...images.filter(image => image !== main)] : [];
  return ordered.map((image, index) => ({ ...image, galleryWide: index === 0 || (index === ordered.length - 1 && ordered.length % 2 === 0) }));
}
function applySpace(work, filter) {
  const pick = images => (images || []).filter(image => filter === 'all' || (filter === '' ? !image.space : image.space === filter));
  return { ...work, renders: galleryFor(pick(work.allRenders), work.coverAssetId), photos: galleryFor(pick(work.allPhotos), work.coverAssetId) };
}

function workForView(work) {
  const images = (work.images || []).map(image => ({ ...image, label: imageLabel(image), space: textList([image.space], 1, 20)[0] || '' }));
  const allRenders = images.filter(image => image.kind === 'render');
  const allPhotos = images.filter(image => image.kind === 'photo');
  const layoutTypes = textList(work.layoutTypes, 3, 20);
  const styleTags = textList([work.primaryStyle, ...(work.secondaryStyles || [])], 3, 20);
  const tours = toursForView(work);
  const highlights = textList(work.highlights, 6, 60);
  const materials = textList(work.materials, 6, 40);
  const palette = (Array.isArray(work.palette) ? work.palette : []).filter(color => color && typeof color.hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(color.hex))
    .map(color => ({ name: textList([color.name], 1, 20)[0] || '', hex: color.hex })).slice(0, 6);
  const comparison = work.planComparison || {};
  const planDrawings = [['originalAssetId', '原始户型'], ['designAssetId', '平面 CAD 方案']]
    .filter(([key]) => ID.test(String(comparison[key] || ''))).map(([key, label]) => ({ assetId: String(comparison[key]), label }));
  const planChanges = planDrawings.length === 2 && Array.isArray(comparison.changes) ? comparison.changes.slice(0, 6)
    .map((change, index) => ({ ordinal: String(index + 1).padStart(2, '0'), title: textList([change?.title], 1, 60)[0] || '', text: textList([change?.text], 1, 180)[0] || '' })).filter(change => change.title) : [];
  const materialViews = materials.map(name => ({ name, texture: /橡木/.test(name) ? '../assets/work-v5-material-oak.png'
    : /亚麻/.test(name) ? '../assets/work-v5-material-linen.png' : /微水泥/.test(name) ? '../assets/work-v5-material-microcement.png' : '' }));
  return { ...work, authorCard: authorView(work.authorCard, { id: work.authorId, name: work.authorName, city: work.cityName }),
    layoutTypes, styleTags, tours, tourCount: tours.length, planDrawings, planChanges,
    plansAligned: planDrawings.length === 2 && comparison.aligned === true, materialViews,
    materialSamples: [...materialViews.map((item, index) => ({ ...item, key: 'material-' + index })),
      ...palette.map((item, index) => ({ ...item, key: 'color-' + index, texture: '' }))],
    detailAssetId: images.find(image => image.assetId !== work.coverAssetId)?.assetId || '',
    notebookNote: highlights[0] || '',
    tourProviderLabel: textList(tours.map(tour => tour.provider), 3, 30).join(' / '),
    highlights, materials, palette, tags: [...styleTags.slice(0, 1), ...layoutTypes.slice(0, 2)],
    coverLabel: imageLabel((work.images || []).find(image => image.assetId === work.coverAssetId) || {}),
    metadata: [work.primaryStyle, work.area ? work.area + '㎡' : '', work.rooms].filter(Boolean).join(' · '),
    studioMeta: [work.area ? work.area + '㎡' : '', work.rooms, work.primaryStyle].filter(Boolean).join(' / '),
    directoryMeta: [work.area ? work.area + '㎡' : '', work.rooms].filter(Boolean).join(' / '),
    chatMeta: [work.area ? work.area + '㎡' : '', work.rooms].filter(Boolean).join(' · '),
    cardMeta: [work.cityName, work.area ? work.area + '㎡' : '', work.rooms].filter(Boolean).join(' · '),
    allRenders, allPhotos, renders: galleryFor(allRenders, work.coverAssetId), photos: galleryFor(allPhotos, work.coverAssetId),
    spaceGroups: spaceGroupsFor(images), hasSpaceTags: images.some(image => image.space) };
}

function designerForView(designer, sourceWorkId) {
  const works = (designer.works || []).map(workForView);
  if (sourceWorkId) works.sort((a, b) => Number(b.id === sourceWorkId) - Number(a.id === sourceWorkId));
  works.forEach((work, index) => { work.ordinal = String(index + 1).padStart(2, '0'); });
  return { ...designer, authorCard: authorView(designer.authorCard, { id: designer.id, name: designer.name, title: designer.professionalTitle,
      city: designer.cities?.[0]?.name, portraitAvailable: designer.portraitAvailable, defaultAvatar: designer.defaultAvatar }), contact: contactView(designer.contact),
    template: designer.template === 'notebook' ? 'notebook' : 'gallery', works, styles: textList(designer.styles, 8, 20), layoutSpecialties: textList(designer.layoutSpecialties, 6, 20),
    cityLabel: (designer.cities || []).map(city => city.name).join(' / '),
    professionalLine: [designer.professionalTitle, designer.experienceLabel].filter(Boolean).join(' · '),
    portraitAvailable: designer.portraitAvailable === true };
}

function filterOptionsFor(works) {
  const styles = [], layouts = [], options = [{ key: 'all', label: '全部' }];
  for (const work of works) {
    for (const style of work.styleTags) if (!styles.includes(style)) styles.push(style);
    for (const layout of work.layoutTypes) if (!layouts.includes(layout)) layouts.push(layout);
  }
  styles.forEach(style => options.push({ key: 'style:' + style, label: style }));
  layouts.forEach(layout => options.push({ key: 'layout:' + layout, label: layout }));
  if (works.some(work => work.tours.length)) options.push({ key: 'tour', label: '有 3D' });
  return options;
}

function filterWorks(works, key) {
  if (key && typeof key === 'object') return works.filter(work =>
    (key.style === 'all' || work.styleTags.includes(key.style))
    && (key.layout === 'all' || work.layoutTypes.includes(key.layout))
    && (!key.tourOnly || work.tours.length));
  if (key === 'all') return works;
  if (key === 'tour') return works.filter(work => work.tours.length);
  if (key.startsWith('style:')) { const value = key.slice(6); return works.filter(work => work.styleTags.includes(value)); }
  if (key.startsWith('layout:')) { const value = key.slice(7); return works.filter(work => work.layoutTypes.includes(value)); }
  return works;
}

function normalizeStudioFilters(works, input = {}) {
  return {
    style: works.some(work => work.styleTags.includes(input.style)) ? input.style : 'all',
    layout: works.some(work => work.layoutTypes.includes(input.layout)) ? input.layout : 'all',
    tourOnly: input.tourOnly === true,
  };
}

function studioCatalog(works, input = studioDefaults(), visibleCount = 6, template = 'gallery') {
  const studioFilters = normalizeStudioFilters(works, input);
  const hasStudioFilters = studioFilters.style !== 'all' || studioFilters.layout !== 'all' || studioFilters.tourOnly;
  const notebookEnding = template === 'notebook' && !hasStudioFilters && works.length > 7;
  const matches = filterWorks(works, studioFilters), catalogWorks = hasStudioFilters ? matches : works.slice(1, notebookEnding ? -1 : undefined);
  const options = filterOptionsFor(works);
  const count = Number.isSafeInteger(visibleCount) ? Math.max(6, visibleCount) : 6;
  const styleOptions = [{ key: 'all', label: '全部', count: works.length },
    ...options.filter(option => option.key.startsWith('style:')).map(option => ({ key: option.label, label: option.label,
      count: works.filter(work => work.styleTags.includes(option.label)).length }))];
  const layoutOptions = [{ key: 'all', label: '不限' },
    ...options.filter(option => option.key.startsWith('layout:')).map(option => ({ key: option.label, label: option.label }))
      .sort((a, b) => (LAYOUT_ORDER.includes(a.key) ? LAYOUT_ORDER.indexOf(a.key) : LAYOUT_ORDER.length)
        - (LAYOUT_ORDER.includes(b.key) ? LAYOUT_ORDER.indexOf(b.key) : LAYOUT_ORDER.length))];
  return { featuredWork: works[0] || null, closingWork: notebookEnding && count >= catalogWorks.length ? works[works.length - 1] : null,
    works: matches, catalogWorks, totalWorks: works.length, visibleCount: count,
    studioFilters, styleOptions, layoutOptions, filterOptions: options, hasStudioFilters, matchingCount: matches.length,
    remainingWorks: Math.max(0, catalogWorks.length - count),
    studioCountLabel: hasStudioFilters ? `匹配${matches.length}套` : `共${works.length}套`,
    studioResultLabel: hasStudioFilters ? `${studioFilters.style === 'all' ? '全部风格' : studioFilters.style} · ${matches.length}套` : '全部作品',
    catalogCompleteLabel: hasStudioFilters ? `已展示本次筛选的${matches.length}套作品` : `${works.length}套作品已全部展示`,
    designerFilter: studioFilters.style !== 'all' ? 'style:' + studioFilters.style : studioFilters.layout !== 'all' ? 'layout:' + studioFilters.layout : studioFilters.tourOnly ? 'tour' : 'all' };
}

function imageLabel(image) { return image.kind === 'photo' ? image.showroom ? '样板间实拍' : '实拍图' : '效果图'; }
class PortfolioController {
  constructor({ emit, identity, client = new AssistantClient(), images }) {
    this.emit = emit; this.identity = identity; this.client = client; this.images = images || new PortfolioImages(client);
    this.contactImages = new PortfolioImages(client);
    this.state = initial(); this.epoch = 0; this.contactEpoch = 0;
  }
  set(patch) { Object.assign(this.state, patch); this.emit(patch); }
  valid(epoch) { return epoch === this.epoch && this.session === this.identity() && this.visible; }
  studioContext() { return [this.session, this.conversationId, this.authorId].join('\u001f'); }
  rememberStudioView() {
    if (this.kind === 'designer' && this.fullWorks && this.state.designer && !this.state.loading && !this.state.unavailable) {
      // Only view choices survive a detail visit. Authorized data and media must be fetched again.
      this.studioView = { context: this.studioContext(), template: this.state.designer.template, filters: { ...this.state.studioFilters }, visibleCount: this.state.visibleCount, scrollTop: this.scrollTop || 0 };
    }
  }
  recordScroll(value) { if (Number.isFinite(value) && value >= 0) this.scrollTop = value; }
  rememberWorkView() {
    if (this.kind === 'work' && this.state.work && !this.state.loading && !this.state.unavailable) this.workView = {
      context: [this.session, this.conversationId, this.state.work.id, this.state.work.versionId].join('\u001f'),
      filter: this.state.spaceFilter, scrollTop: this.scrollTop || 0,
    };
  }
  hide() { this.rememberStudioView(); this.rememberWorkView(); this.visible = false; this.showTicket = (this.showTicket || 0) + 1; this.epoch += 1; this.images.clear(); this.closeContact(); this.fullWorks = null; this.set({ images: {}, portraitPath: '', sharePath: '', publicContact: null, contactAuthor: null }); }
  async show(options = {}, kind = 'designer') {
    const ticket = this.showTicket = (this.showTicket || 0) + 1;
    if (this.flight) await this.flight;
    if (ticket !== this.showTicket) return;
    this.visible = true; this.options = options; this.kind = kind;
    const session = this.identity();
    if (this.session && this.session !== session) { this.client.pending.clear(); this.conversationId = ''; this.studioView = null; this.workView = null; this.scrollTop = 0; this.images.clear(); this.set(initial()); }
    this.session = session;
    if (!session) { this.set({ ...initial(), loading: false, needsLogin: true, error: '登录后查看作品，并回到自己的装修咨询。' }); return; }
    return this.load();
  }
  fail(error, epoch) {
    if (!this.valid(epoch)) return;
    const denied = [401, 403, 404].includes(error.statusCode) || ['identity_context_invalid', 'entry_context_invalid', 'portfolio_not_found', 'assistant_resource_not_found'].includes(error.code);
    if (denied) { this.epoch += 1; this.images.clear(); this.closeContact(); this.fullWorks = null; this.studioView = null; this.workView = null; this.restoreScrollTop = 0; this.set({ ...studioCatalog([]), designer: null, work: null, spaceFilter: 'all', images: {}, portraitPath: '', sharePath: '', publicContact: null, contactAuthor: null, unavailable: true }); }
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
    this.rememberStudioView(); this.rememberWorkView(); this.restoreScrollTop = 0;
    const epoch = ++this.epoch;
    this.images.clear(); this.closeContact(); this.fullWorks = null;
    this.set({ ...studioCatalog([]), designer: null, work: null, loading: true, busy: false, needsLogin: false, error: '', unavailable: false, images: {}, portraitPath: '',
      sharePath: '', imageError: '', designerFilter: 'all', filterOptions: [], totalWorks: 0, spaceFilter: 'all', publicContact: null, contactAuthor: null });
    try {
      if (!await this.resolveConversation(epoch) || !this.valid(epoch)) return;
      const base = pathFor(this.conversationId);
      if (this.kind === 'work') {
        if (!ID.test(String(this.options.workId)) || !ID.test(String(this.options.versionId))) throw { code: 'entry_context_invalid', statusCode: 422 };
        const data = await this.client.read(`${base}/works/${this.options.workId}`, { versionId: this.options.versionId });
        if (!this.valid(epoch)) return;
        this.authorId = data.authorId;
        const view = workForView(data), context = [this.session, this.conversationId, view.id, view.versionId].join('\u001f');
        const saved = this.workView?.context === context ? this.workView : null;
        const filter = saved && (saved.filter === 'all' || view.spaceGroups.some(group => group.key === saved.filter)) ? saved.filter : 'all';
        this.restoreScrollTop = saved?.scrollTop || 0;
        this.set({ work: applySpace(view, filter), spaceFilter: filter, contactAuthor: view.authorCard });
      } else {
        if (!ID.test(String(this.authorId))) throw { code: 'entry_context_invalid', statusCode: 422 };
        const designer = await this.client.read(`${base}/designers/${this.authorId}`);
        if (!this.valid(epoch)) return;
        const { contact, ...viewer } = designerForView(designer, this.sourceWorkId);
        this.fullWorks = viewer.works;
        const saved = this.studioView?.context === this.studioContext() && this.studioView.template === viewer.template ? this.studioView : null;
        this.restoreScrollTop = saved?.scrollTop || 0;
        this.set({ designer: viewer, publicContact: contact, contactAuthor: viewer.authorCard,
          ...studioCatalog(viewer.works, saved?.filters, saved?.visibleCount, viewer.template) });
      }
      const work = this.state.work || this.state.featuredWork;
      if (work) {
        const pending = this.client.pending.get('portfolio-write:' + this.conversationId + ':' + work.id);
        this.set({ pendingAction: pending ? pending.path.endsWith('/contact') ? 'contact' : pending.body.sentiment : '' });
      }
      this.set({ loading: false });
      const portrait = this.state.contactAuthor?.portraitAvailable ? this.loadPortrait(epoch, this.state.contactAuthor.id) : Promise.resolve();
      await Promise.all([this.loadImages(epoch), portrait]);
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
    const covers = [this.state.featuredWork, ...this.state.catalogWorks.slice(0, this.state.visibleCount), this.state.closingWork].filter(Boolean);
    const tasks = work ? [...new Map([...(work.images || []), ...(work.planDrawings || [])].map(i => [i.assetId, [work, i.assetId]])).values()]
      : [...new Map(covers.map(w => [w.id, [w, w.coverAssetId]])).values()];
    const featured = this.state.featuredWork;
    if (!work && this.state.designer?.template === 'notebook' && featured?.detailAssetId) tasks.push([featured, featured.detailAssetId]);
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
  async loadPortrait(epoch, authorId) {
    try {
      const filePath = await this.images.loadPortrait(this.conversationId, authorId);
      if (this.valid(epoch)) this.set({ portraitPath: filePath });
    } catch (_) {
      if (this.valid(epoch)) this.set({ portraitPath: '' });
    }
  }
  closeContact() {
    this.contactEpoch += 1;
    this.contactImages.clear();
    this.set({ contactBusy: false, contactQrPath: '', contactError: '' });
  }
  async refreshContact({ qr = false, apply } = {}) {
    const work = this.state.work || this.state.featuredWork;
    const epoch = this.epoch;
    if (!this.valid(epoch) || this.state.loading || this.state.unavailable || this.state.contactBusy || !work) return;
    const ticket = ++this.contactEpoch;
    const valid = () => this.valid(epoch) && this.contactEpoch === ticket;
    this.set({ contactBusy: true, contactError: '' });
    let contact;
    try {
      const result = await this.client.read(`${pathFor(this.conversationId)}/designers/${work.authorId}/contact`,
        { workId: work.id, versionId: work.versionId });
      if (!valid()) return;
      if (String(result.author?.id) !== String(work.authorId)) throw { code: 'invalid_response' };
      contact = contactView(result);
      if (contact.revision !== this.state.publicContact?.revision || !contact.qrAvailable || qr) {
        this.contactImages.clear(); this.set({ contactQrPath: '' });
      }
      this.set({ publicContact: contact, contactAuthor: authorView(result.author, this.state.contactAuthor) });
      if (qr && contact.qrAvailable) {
        const filePath = await this.contactImages.loadContactQr(this.conversationId, work, contact.revision);
        if (!valid()) return;
        this.set({ contactQrPath: filePath });
      }
      if (apply && valid()) await apply(contact, this.state.contactQrPath);
    } catch (error) {
      if (!valid()) return;
      if (!contact || [401, 403, 404].includes(error.statusCode)) {
        this.contactImages.clear(); this.set({ publicContact: null, contactQrPath: '' });
      }
      this.set({ contactError: errorCopy(error) });
    } finally { if (valid()) this.set({ contactBusy: false }); }
  }
  setFilter(key) {
    if (this.kind !== 'designer' || !this.fullWorks) return;
    const value = typeof key === 'string' && this.state.filterOptions.some(option => option.key === key) ? key : 'all';
    return this.setStudioFilters({ ...studioDefaults(), ...(value.startsWith('style:') ? { style: value.slice(6) }
      : value.startsWith('layout:') ? { layout: value.slice(7) } : value === 'tour' ? { tourOnly: true } : {}) });
  }
  previewStudioFilters(input) {
    const filters = normalizeStudioFilters(this.fullWorks || [], input);
    return { filters, count: filterWorks(this.fullWorks || [], filters).length };
  }
  setStudioFilters(input) {
    if (this.kind !== 'designer' || !this.fullWorks || !this.valid(this.epoch) || this.state.loading || this.state.unavailable) return;
    this.set(studioCatalog(this.fullWorks, input, 6, this.state.designer?.template));
    return this.loadImages();
  }
  setSpace(key) {
    const work = this.state.work;
    if (!work) return;
    const value = key === 'all' || work.spaceGroups.some(group => group.key === key) ? key : 'all';
    this.set({ work: applySpace(work, value), spaceFilter: value });
  }
  more() {
    if (this.kind !== 'designer' || !this.fullWorks || !this.valid(this.epoch) || this.state.loading || !this.state.remainingWorks) return;
    this.set(studioCatalog(this.fullWorks, this.state.studioFilters, this.state.visibleCount + 6, this.state.designer?.template)); return this.loadImages();
  }
  write(action) {
    if (this.flight) return this.flight;
    this.flight = this.performWrite(action).finally(() => { this.flight = null; });
    return this.flight;
  }
  async performWrite(action) {
    const work = this.state.work || this.state.featuredWork;
    if (!work || this.state.busy || this.state.readOnly || this.state.unavailable || this.state.loading || (this.state.pendingAction && this.state.pendingAction !== action)) return;
    const epoch = this.epoch, slot = 'portfolio-write:' + this.conversationId + ':' + work.id;
    this.set({ busy: true, error: '', feedback: '' });
    try {
      const data = await this.client.mutate(slot, `${pathFor(this.conversationId)}/works/${work.id}/${action === 'contact' ? 'contact' : 'preference'}`,
        action === 'contact' ? { versionId: work.versionId } : { versionId: work.versionId, sentiment: action, expectedVersion: work.preferenceVersion });
      if (!this.valid(epoch)) return;
      const contactFeedback = action === 'contact' ? {
        waiting: '接待请求已提交，等待企业接待；尚未接通或预约。',
        active: data.handoff.ownerAvailable === false ? '当前接待人暂不可用，你可以结束接续回到小K' : '接待人员已接入本次咨询。',
        cancelled: '本次接待请求已取消，需求保留。', ended: '本次接待已结束。',
      }[data.handoff.state] : '';
      this.set({ pendingAction: '', feedback: action === 'contact' ? contactFeedback : '已记下这个方向，随时可以更正。',
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
  async load(conversationId, explicit = false, replyId) {
    this.clear();
    if (!ID.test(String(conversationId))) return;
    const epoch = this.epoch, session = this.identity();
    const valid = () => this.epoch === epoch && session === this.identity();
    this.emit({ portfolioLoading: explicit });
    try {
      const result = await this.client.read(pathFor(conversationId) + '/recommendations', replyId ? { replyId } : undefined);
      if (!valid()) return;
      const items = (result.items || []).map(i => ({ ...i, work: workForView(i.work),
        initial: String(i.authorName || '设').slice(0, 1),
        titleLabel: [i.professionalTitle, i.experienceLabel].filter(Boolean).join(' · ') }));
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
module.exports = { PortfolioController, PortfolioImages, RecommendationController, workForView, designerForView,
  filterOptionsFor, filterWorks, studioCatalog, studioDefaults, applySpace, pathFor, initial };
