const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PortfolioController, PortfolioImages, RecommendationController, workForView, designerForView, filterOptionsFor, filterWorks, applySpace } = require('../packages/assistant/lib/portfolio');
const { AssistantClient, entryInput, messagesForView, latestDesignerCard } = require('../packages/assistant/lib/client');
const { page } = require('../packages/assistant/lib/portfolio-page');
const work = () => ({ id: '12', versionId: '13', authorId: '14', authorName: '真实设计师', title: '公开原木作品', description: '作品说明', primaryStyle: '原木风', area: 90, rooms: '两室', coverAssetId: '15', images: [{ assetId: '15', kind: 'render', aiGenerated: true }, { assetId: '16', kind: 'photo', showroom: true }], preference: null, preferenceVersion: 0 });
function fixture() {
  let token = 'session-a', current = work(); const calls = [];
  const client = { pending: new Map(), async read(path, input, headers, method) {
    calls.push({ path, input, method });
    if (path === '/conversations/11') return { id: '11', status: 'open' };
    if (path.endsWith('/designers/14')) return { id: '14', name: '真实设计师', bio: '本人资料', cities: [{ name: '杭州市' }], works: [current] };
    if (path.endsWith('/share')) return { path: '/packages/assistant/designer/designer?portfolioEntry=signed' };
    if (path.endsWith('/works/12')) return { ...current };
    throw Error(path);
  }, async mutate(slot, path, body) { calls.push({ slot, path, body }); current = { ...current, preference: body.sentiment, preferenceVersion: current.preferenceVersion + 1 }; return { sentiment: current.preference, preferenceVersion: current.preferenceVersion }; } };
  const images = { clear() {}, async load(cid, w, assetId) { return '/private/' + assetId + '.jpg'; } };
  const controller = new PortfolioController({ emit() {}, client, identity: () => token, images });
  return { controller, client, calls, setIdentity: value => { token = value; } };
}
test('portfolio detail loads current exact version, real grouped images and explicit preferences survive reentry/correction', async () => {
  const { controller: c, calls } = fixture(), options = { conversationId: '11', workId: '12', versionId: '13' };
  await c.show(options, 'work'); assert.equal(c.state.work.renders[0].label, '效果图'); assert.equal(c.state.work.renders[0].aiGenerated, true); assert.equal(c.state.work.photos[0].label, '样板间实拍');
  assert.equal(c.state.work.preference, null); assert.ok(c.state.images.i15); assert.ok(!calls.some(x => x.slot));
  await c.write('like'); assert.equal(c.state.work.preference, 'like');
  c.hide(); assert.deepEqual(c.state.images, {}); await c.show(options, 'work'); assert.equal(c.state.work.preference, 'like');
  await c.write('dislike'); assert.equal(c.state.work.preference, 'dislike');
  assert.deepEqual(calls.filter(x => x.slot).map(x => x.body), [{ versionId: '13', sentiment: 'like', expectedVersion: 0 }, { versionId: '13', sentiment: 'dislike', expectedVersion: 1 }]);
});
test('studio uses real identity and only its published works; forwarding never exports conversation or local images', async () => {
  const { controller: c } = fixture(); await c.show({ conversationId: '11', authorId: '14' });
  assert.equal(c.state.designer.name, '真实设计师'); assert.equal(c.state.works.length, 1);
  const shared = page('designer').onShareAppMessage.call({ data: c.state });
  assert.equal(shared.path, '/packages/assistant/designer/designer?portfolioEntry=signed'); assert.ok(!JSON.stringify(shared).includes('11')); assert.equal(shared.imageUrl, '/packages/assistant/assets/designer-studio-book.png');
  assert.deepEqual(entryInput({ portfolioEntry: 'signed' }), { portfolioEntry: 'signed' });
  assert.throws(() => entryInput({ portfolioEntry: 'signed', conversationId: '11' }));
});
test('revocation and identity change prevent late source/image results from resurfacing', async () => {
  const { controller: c, client, setIdentity } = fixture(); let resolve;
  const original = client.read; client.read = path => path.endsWith('/works/12') ? new Promise(r => { resolve = r; }) : original(path);
  const pending = c.show({ conversationId: '11', workId: '12', versionId: '13' }, 'work');
  for (let i = 0; i < 10 && !resolve; i++) await new Promise(r => setImmediate(r));
  assert.ok(resolve, 'work request should start'); setIdentity('session-b'); resolve(work()); await pending; assert.equal(c.state.work, null);
  const second = fixture(); await second.controller.show({ conversationId: '11', workId: '12', versionId: '13' }, 'work');
  second.controller.fail({ statusCode: 404, code: 'portfolio_not_found' }, second.controller.epoch);
  assert.equal(second.controller.state.work, null); assert.deepEqual(second.controller.state.images, {}); assert.equal(second.controller.state.sharePath, '');
});
test('unknown mutation outcome retains key and body, reentry recovers the same explicit preference', async () => {
  const f = fixture(); let fail = true, sent = []; const client = new AssistantClient(async (path, method, body, options) => {
    if (method === 'POST' && path.endsWith('/preference')) { sent.push({ body: JSON.parse(JSON.stringify(body)), key: options.headers['Idempotency-Key'] }); if (fail) throw { statusCode: 503 }; return { success: true, data: { sentiment: 'like', preferenceVersion: 1 } }; }
    return { success: true, data: await f.client.read(path.replace('/miniprogram/assistant', ''), body) };
  });
  const c = new PortfolioController({ emit() {}, identity: () => 'session', client, images: { clear() {}, load: async () => '/private/test.jpg' } });
  const options = { conversationId: '11', workId: '12', versionId: '13' };
  await c.show(options, 'work'); await c.write('like'); assert.equal(c.state.pendingAction, 'like'); c.hide(); await c.show(options, 'work'); assert.equal(c.state.pendingAction, 'like');
  fail = false; await c.write(c.state.pendingAction); assert.deepEqual(sent[0], sent[1]); assert.equal(c.state.pendingAction, '');
});
test('authorized JPEG downloads bind the exact work and version and discard a late result', async () => {
  const previous = global.wx, removed = []; let finish;
  global.wx = { getFileSystemManager: () => ({ unlink: args => removed.push(args.filePath) }) };
  try {
    const calls = [], images = new PortfolioImages(null, (path, options) => {
      calls.push({ path, options });
      return new Promise(resolve => { finish = resolve; });
    });
    const loading = images.load('11', work(), '15');
    assert.ok(finish, 'authorized JPEG should use the binary download');
    images.clear(); finish({ tempFilePath: '/private/cover.jpg' });
    await assert.rejects(loading, e => e.code === 'context_changed');
    assert.deepEqual(removed, ['/private/cover.jpg']);
    assert.deepEqual(calls, [{ path: '/miniprogram/assistant/conversations/11/portfolio/works/12/assets/15?versionId=13', options: { suppressUnauthorized: true } }]);
    assert.equal(workForView(work()).metadata, '原木风 · 90㎡ · 两室');
  } finally { global.wx = previous; }
});

test('native portfolio preview keeps the current gallery files through page hide and clears them on return', async () => {
  const oldWx = global.wx, oldApp = global.getApp;
  const removed = [], authorizations = [], viewer = [];
  global.getApp = () => ({ globalData: { token: 'session-a' } });
  const fixture = page('work');
  const data = workForView(work());
  const files = new PortfolioImages(null, async path => ({ tempFilePath: '/private/' + path.match(/\/assets\/(\d+)/)[1] + '.jpg' }));
  const shown = { i15: await files.load('11', data, '15'), i16: await files.load('11', data, '16') };
  const other = await files.load('11', data, '17');
  const p = { ...fixture, _alive: true, _shown: true, data: { work: data, images: shown, conversationId: '11' },
    controller: { epoch: 1, session: 'session-a', images: files, valid(epoch) { return epoch === this.epoch; },
      client: { read: async (route, query) => { authorizations.push({ route, query }); } },
      hide(paths) { this.epoch++; files.clear(paths); p.data.images = {}; },
      async show() { files.clear(); },
    } };
  global.wx = {
    getFileSystemManager: () => ({ unlink: ({ filePath }) => removed.push(filePath) }),
    previewImage(request) { viewer.push(request); p.onHide(); },
  };
  try {
    await p.preview({ currentTarget: { dataset: { id: '16' } } });
    assert.deepEqual(authorizations, [{ route: '/conversations/11/portfolio/works/12', query: { versionId: '13' } }]);
    assert.equal(viewer[0].current, shown.i16);
    assert.deepEqual(viewer[0].urls, [shown.i15, shown.i16]);
    assert.deepEqual(removed, [other]);
    await p.onShow();
    assert.deepEqual(removed, [other, shown.i15, shown.i16]);
  } finally { global.wx = oldWx; global.getApp = oldApp; }
});
test('C01 reads recommendations without preference/contact writes and clears revoked cards', async () => {
  const state = {}, calls = []; let revoked = false;
  const c = new RecommendationController({ emit: p => Object.assign(state, p), identity: () => 'session', images: { clear() {}, load: async () => '/private/cover.jpg' }, client: { read: async path => { calls.push(path); if (revoked) throw { statusCode: 404, code: 'portfolio_not_found' }; return { items: [{ authorId: '14', work: work(), reason: '同城风格作品' }] }; } } });
  await c.load('11'); assert.equal(state.portfolioItems.length, 1); assert.equal(calls.length, 1);
  revoked = true; await c.load('11', true); assert.deepEqual(state.portfolioItems, []); assert.deepEqual(state.portfolioImages, {}); assert.ok(state.portfolioError);
});
test('return to consultation uses the matching original chat stack and does not start another conversation', () => {
  const oldWx = global.wx, oldPages = global.getCurrentPages; let back;
  global.wx = { navigateBack: x => { back = x; } }; global.getCurrentPages = () => [{ route: 'packages/assistant/chat/chat', data: { conversation: { id: '11' } } }, { route: 'packages/assistant/designer/designer' }, { route: 'packages/assistant/work/work' }];
  try { page('work').continueChat.call({ data: { conversationId: '11' } }); assert.deepEqual(back, { delta: 2 }); }
  finally { global.wx = oldWx; global.getCurrentPages = oldPages; }
});
test('shared-studio reentry restores only this account own consultation and a different identity creates its own', async () => {
  const oldWx = global.wx, storage = new Map(); let session = 'account-a', creates = 0;
  global.wx = { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value) };
  const f = fixture();
  const client = { pending: new Map(), read: async (path, input, headers, method) => {
    if (path === '/entry-context') return { entryToken: 'entry', portfolio: { authorId: '14', workId: '12' } };
    if (/^\/conversations\/2\d$/.test(path)) return { status: 'open' };
    return f.client.read(path, input, headers, method);
  }, mutate: async () => { creates += 1; return { id: String(20 + creates) }; } };
  const make = () => new PortfolioController({ emit() {}, identity: () => session, client, images: { clear() {}, load: async () => '/private/x.jpg' } });
  try {
    const c = make(); await c.show({ portfolioEntry: 'signed' }); assert.equal(c.state.conversationId, '21'); c.hide();
    const reopened = make(); await reopened.show({ portfolioEntry: 'signed' }); assert.equal(reopened.state.conversationId, '21'); assert.equal(creates, 1);
    session = 'account-b'; await reopened.show({ portfolioEntry: 'signed' }); assert.equal(reopened.state.conversationId, '22'); assert.equal(creates, 2);
  } finally { global.wx = oldWx; }
});
test('hiding during recovery of an uncertain write cannot restart a background page or publish late data', async () => {
  const f = fixture(); let finish;
  await f.controller.show({ conversationId: '11', workId: '12', versionId: '13' }, 'work');
  f.client.mutate = () => new Promise(resolve => { finish = resolve; });
  const write = f.controller.write('like'); f.controller.hide();
  const show = f.controller.show({ conversationId: '11', workId: '12', versionId: '13' }, 'work'); f.controller.hide();
  finish({ sentiment: 'like', preferenceVersion: 1 }); await write; await show;
  assert.equal(f.controller.visible, false); assert.deepEqual(f.controller.state.images, {});
});
test('work enrichment keeps bounded taxonomy, stable space groups, filtered tours and authorized hex palettes', () => {
  const enriched = workForView({ ...work(), layoutTypes: ['三居', '三居', '大平层', '叠墅'], secondaryStyles: ['奶油风', '现代简约', '极简', '侘寂'],
    highlights: ['A', 'B', 'C', 'D', 'E', 'F', 'G'], materials: ['橡木', '微水泥'],
    palette: [{ name: '奶油白', hex: '#F5F0E6' }, { name: 'bad', hex: 'red' }, { name: '炭黑', hex: '#1F1F1F' }, { name: '', hex: '#FFFFFF' }],
    tours: [{ url: 'http://bad.example.com' }, { url: 'https://kuula.co/a', provider: 'Kuula' }, { url: 'https://my.matterport.com/b', provider: 'Matterport' }],
    images: [{ assetId: '15', kind: 'render', space: '客厅', aiGenerated: true }, { assetId: '16', kind: 'photo', space: '主卧', showroom: true }, { assetId: '17', kind: 'render', space: '客厅' }, { assetId: '18', kind: 'photo' }] });
  assert.deepEqual(enriched.styleTags, ['原木风', '奶油风', '现代简约']);
  assert.deepEqual(enriched.layoutTypes, ['三居', '大平层', '叠墅']);
  assert.deepEqual(enriched.tags, ['原木风', '三居', '大平层']);
  assert.equal(enriched.highlights.length, 6); assert.deepEqual(enriched.materials, ['橡木', '微水泥']);
  assert.deepEqual(enriched.palette.map(color => color.hex), ['#F5F0E6', '#1F1F1F', '#FFFFFF']);
  assert.equal(enriched.tourCount, 2); assert.equal(enriched.tourProviderLabel, 'Kuula / Matterport');
  assert.deepEqual(enriched.spaceGroups, [{ key: '客厅', label: '客厅', count: 2 }, { key: '主卧', label: '主卧', count: 1 }, { key: '', label: '未标注', count: 1 }]);
  assert.equal(enriched.hasSpaceTags, true);
  const living = applySpace(enriched, '客厅'); assert.equal(living.renders.length, 2); assert.equal(living.photos.length, 0);
  const unlabeled = applySpace(enriched, ''); assert.equal(unlabeled.renders.length, 0); assert.equal(unlabeled.photos.length, 1);
  assert.equal(enriched.cardMeta, '90㎡ · 两室');
});

test('designer view exposes real title, specialties and filterable published works without inventing values', () => {
  const second = { ...work(), id: '22', versionId: '23', coverAssetId: '25', primaryStyle: '奶油风', secondaryStyles: [], layoutTypes: ['两居'], tours: [{ url: 'http://unsafe' }], images: [{ assetId: '25', kind: 'render' }] };
  const view = designerForView({ id: '14', name: '林知夏', bio: '本人资料', cities: [{ name: '杭州市' }, { name: '绍兴市' }], styles: ['原木风', '奶油风'], layoutSpecialties: ['三居', '旧房改造'], professionalTitle: '资深家装设计师', experienceLabel: '9年设计经验', portraitAvailable: true, defaultAvatar: 'female',
    works: [{ ...work(), tours: [{ url: 'https://my.matterport.com/a', provider: 'Matterport' }], layoutTypes: ['三居'] }, second] });
  assert.equal(view.authorCard.fallbackAvatar, '/packages/assistant/assets/designer-avatar-female.png');
  assert.equal(view.professionalLine, '资深家装设计师 · 9年设计经验');
  assert.equal(view.cityLabel, '杭州市 / 绍兴市'); assert.equal(view.portraitAvailable, true);
  const options = filterOptionsFor(view.works);
  assert.deepEqual(options.map(option => option.key), ['all', 'style:原木风', 'style:奶油风', 'layout:三居', 'layout:两居', 'tour']);
  assert.deepEqual(filterWorks(view.works, 'tour').map(item => item.id), ['12']);
  assert.deepEqual(filterWorks(view.works, 'style:奶油风').map(item => item.id), ['22']);
  assert.deepEqual(filterWorks(view.works, 'layout:三居').map(item => item.id), ['12']);
  assert.deepEqual(filterWorks(view.works, 'unknown').map(item => item.id), ['12', '22']);
});

test('designer page loads only the authorized portrait and resets portrait, filters and covers when hidden', async () => {
  let portraitCalls = 0;
  const designer = { id: '14', name: '林知夏', bio: '本人资料', cities: [{ name: '杭州市' }], styles: ['原木风'], layoutSpecialties: ['三居'], professionalTitle: '资深家装设计师', experienceLabel: '9年设计经验', portraitAvailable: true,
    works: [{ ...work(), layoutTypes: ['三居'], tours: [{ url: 'https://my.matterport.com/a', provider: 'Matterport' }] }] };
  const client = { pending: new Map(), async read(path) {
    if (path === '/conversations/11') return { id: '11', status: 'open' };
    if (path.endsWith('/designers/14')) return designer;
    if (path.endsWith('/share')) return { path: '/packages/assistant/designer/designer?portfolioEntry=signed' };
    throw Error(path);
  } };
  const images = { clear() {}, async load() { return '/private/cover.jpg'; }, async loadPortrait(cid, authorId) { portraitCalls += 1; assert.equal(cid, '11'); assert.equal(authorId, '14'); return '/private/portrait.jpg'; } };
  const c = new PortfolioController({ emit() {}, identity: () => 'session', client, images });
  await c.show({ conversationId: '11', authorId: '14' });
  assert.equal(c.state.portraitPath, '/private/portrait.jpg'); assert.equal(portraitCalls, 1);
  assert.equal(c.state.filterOptions.length, 4); assert.equal(c.state.totalWorks, 1);
  c.setFilter('tour'); assert.equal(c.state.works.length, 1); assert.equal(c.state.designerFilter, 'tour');
  c.setFilter('bogus'); assert.equal(c.state.designerFilter, 'all'); assert.equal(c.state.works.length, 1);
  c.hide(); assert.equal(c.state.portraitPath, ''); assert.deepEqual(c.state.images, {});
});

test('portrait bytes bind the exact designer and are deleted with the portfolio context', async () => {
  const previous = global.wx, removed = [], calls = [];
  global.wx = { env: { USER_DATA_PATH: '/private' }, getFileSystemManager: () => ({ writeFile(args) { args.success(); }, unlink(args) { removed.push(args.filePath); } }) };
  try {
    const images = new PortfolioImages({ read: async (path, input) => { calls.push({ path, input }); return { mimeType: 'image/jpeg', imageBase64: '/9j/AA==' }; } });
    const filePath = await images.loadPortrait('11', '14');
    assert.match(filePath, /assistant-portrait-14-/); assert.deepEqual(calls[0].input, { format: 'base64' });
    images.clear(); assert.equal(removed.length, 1);
    await assert.rejects(images.loadPortrait('11', '0'), error => error.code === 'invalid_response');
    const wrong = new PortfolioImages({ read: async () => ({ mimeType: 'image/png', imageBase64: '/9j/AA==' }) });
    await assert.rejects(wrong.loadPortrait('11', '14'), error => error.code === 'invalid_response');
  } finally { global.wx = previous; }
});

test('chat shows only bounded, sanitized designer cards from the latest assistant message', () => {
  const card = (overrides = {}) => ({ authorId: '14', authorName: '林知夏', professionalTitle: '资深家装设计师', experienceLabel: '9年设计经验', layoutSpecialties: ['三居'], portraitAvailable: true,
    work: { id: '12', versionId: '13', title: '原木三居', coverAssetId: '15', primaryStyle: '原木风', secondaryStyles: ['奶油风'], layoutTypes: ['三居'], cityName: '杭州', district: '西湖区', communityName: '云栖里', tourCount: 9 },
    reason: '同城风格', match: '三居 · 原木风', ...overrides });
  const message = (id, rec) => ({ id, seq: id, authorKind: 'assistant', content: { blocks: [{ type: 'text', text: '推荐' }] }, designerRecommendation: rec });
  const items = messagesForView([
    message('1', { items: [card({ defaultAvatar: 'male' }), card({ authorId: '0' }), card({ authorName: '\u0001' })], notice: 'n'.repeat(300) }),
    message('2', { items: [card({ authorId: '22', professionalTitle: '\u0001主创', portraitAvailable: 'yes', defaultAvatar: 'https://example.invalid/avatar' })] }),
    { id: '3', seq: '3', authorKind: 'user', content: { blocks: [{ type: 'text', text: '好' }] } },
    message('4', { items: [card({ authorId: '44', work: { ...card().work, id: '32', versionId: '33', coverAssetId: '35', tourCount: 99 } })], notice: '已按杭州三居筛选' }),
    { id: '5', seq: '5', authorKind: 'assistant', content: { blocks: [{ type: 'text', text: '补充' }] }, designerRecommendation: { items: [] } },
  ]);
  const first = items.find(item => item.id === '1').designerRecommendation;
  assert.equal(first.items.length, 2); assert.equal(first.notice.length, 200);
  assert.equal(first.items[1].authorName, '设计师');
  assert.equal(first.items[0].fallbackAvatar, '/packages/assistant/assets/designer-avatar-male.png');
  assert.equal(first.items[1].fallbackAvatar, '/packages/assistant/assets/designer-avatar-neutral.png');
  assert.equal(first.items[0].work.tourCount, 3); assert.equal(first.items[0].work.communityName, '云栖里');
  const stripped = items.find(item => item.id === '2').designerRecommendation.items[0];
  assert.equal(stripped.fallbackAvatar, '/packages/assistant/assets/designer-avatar-neutral.png');
  assert.equal(stripped.professionalTitle, '主创'); assert.equal(stripped.portraitAvailable, false);
  assert.equal(items.find(item => item.id === '5').designerRecommendation, null);
  assert.equal(latestDesignerCard(items).id, '4');
  assert.equal(latestDesignerCard([message('6', { items: [card()] }), message('7', { items: [card({ authorId: '44' })] })]).id, '7');
  const unavailable = messagesForView([{ ...message('8', { items: [card()] }), available: false }]);
  assert.equal(unavailable[0].designerRecommendation, null);
});

test('malformed preference/create receipts retain their original operation instead of falsely reporting success', async () => {
  let complete = false; const receipts = [];
  const client = new AssistantClient(async (path, method, body, options) => {
    receipts.push(options.headers['Idempotency-Key']);
    return { success: true, data: complete ? { sentiment: 'like', preferenceVersion: 1 } : {} };
  });
  const slot = 'portfolio-write:11:12', body = { versionId: '13', sentiment: 'like', expectedVersion: 0 };
  await assert.rejects(client.mutate(slot, '/conversations/11/portfolio/works/12/preference', body), e => e.code === 'invalid_response');
  assert.ok(client.pending.has(slot)); complete = true; await client.mutate(slot, '/ignored', {}); assert.equal(receipts[0], receipts[1]);
  complete = false; await assert.rejects(client.mutate('portfolio-create:signed', '/conversations', { entryToken: 'entry' }), e => e.code === 'invalid_response');
  assert.ok(client.pending.has('portfolio-create:signed'));
});

test('studio tour binds the displayed publication; multiple tours and detail retain the exact work and never put URLs in navigation', () => {
  const oldWx = global.wx, navigation = [], sheets = [];
  global.wx = { navigateTo: input => navigation.push(input.url), showActionSheet: input => sheets.push(input) };
  try {
    const first = workForView({ ...work(), tours: [{ url: 'https://kuula.co/share/one', title: '客厅' }, { url: 'https://kuula.co/share/two', title: '餐厅' }] });
    const shown = workForView({ ...work(), id: '22', versionId: '23', tours: [{ url: 'https://kuula.co/share/selected', title: '全屋' }] });
    const studio = page('designer'); studio.data = { loading: false, unavailable: false, conversationId: '11', featuredWork: shown, works: [shown, first] };
    studio.openStudioTour();
    assert.equal(navigation[0], '/packages/assistant/tour-view/tour-view?conversationId=11&workId=22&versionId=23&index=0');
    studio.data.featuredWork = first; studio.openStudioTour(); assert.equal(sheets.length, 1);
    sheets[0].success({ tapIndex: 1 }); assert.ok(navigation[1].endsWith('workId=12&versionId=13&index=1'));
    const detail = page('work'); detail.data = { conversationId: '11', work: shown }; detail.openTour();
    assert.equal(navigation[2], navigation[0]);
    studio.data.unavailable = true; studio.openStudioTour(); assert.equal(navigation.length, 3);
    assert.ok(!navigation.some(url => url.includes('kuula') || url.includes('https')));
  } finally { global.wx = oldWx; }
});

test('studio never opens a filter sheet or navigates a hidden or revoked page', () => {
  const studio = page('designer'); studio._alive = true; studio._shown = false;
  studio.data.designer = { name: '设计师' }; studio.data.loading = false;
  studio.showStudioFilters(); assert.equal(studio.data.studioSheetVisible, false);
  studio.alignStudioCatalog();
  studio._shown = true; studio.data.unavailable = true;
  studio.showStudioFilters(); assert.equal(studio.data.studioSheetVisible, false);
  studio.alignStudioCatalog();
});
