const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PortfolioController, designerForView, studioCatalog, studioDefaults } = require('../packages/assistant/lib/portfolio');
const { page } = require('../packages/assistant/lib/portfolio-page');

function works() {
  return Array.from({ length: 8 }, (_, index) => ({
    id: String(12 + index), versionId: String(112 + index), authorId: '14', title: '合成测试作品' + (index + 1),
    coverAssetId: String(212 + index), primaryStyle: ['原木风', '现代简约', '奶油风'][index % 3], secondaryStyles: [],
    layoutTypes: [index === 1 ? '两居' : '三居'], area: 90 + index, rooms: index === 1 ? '两室两厅' : '三室两厅',
    tours: index === 0 ? [{ url: 'https://kuula.co/share/synthetic' }] : [], images: [{ assetId: String(212 + index), kind: 'render', aiGenerated: true }],
  }));
}
function fixture() {
  let token = 'account-a', available = true, list = works(), reads = 0, deletes = 0;
  const writes = [], imageReads = [];
  const client = { pending: new Map(), async read(path) {
    if (path === '/conversations/11') return { id: '11', status: 'open' };
    if (path.endsWith('/designers/14')) {
      reads += 1;
      if (!available) throw { statusCode: 404, code: 'portfolio_not_found' };
      return { id: '14', name: '测试设计师', works: list };
    }
    if (path.endsWith('/share')) return { path: '/packages/assistant/designer/designer?portfolioEntry=synthetic' };
    throw Error(path);
  }, async mutate(slot, path, body) { writes.push({ slot, path, body }); return { conversationId: '11' }; } };
  const controller = new PortfolioController({ client, identity: () => token, emit() {}, images: {
    clear() { deletes += 1; }, async load(cid, work, assetId) { imageReads.push([work.id, work.versionId, assetId]); return '/private/' + reads + '-' + assetId + '.jpg'; },
  } });
  return { controller, writes, imageReads, reads: () => reads, deletes: () => deletes, changeIdentity(value) { token = value; }, revoke() { available = false; }, replace(value) { list = value; } };
}
const options = { conversationId: '11', authorId: '14' };

test('eight public works keep stable ordinals, a separate feature and six directory entries per expansion', async () => {
  const f = fixture(), c = f.controller;
  await c.show(options);
  assert.equal(c.state.featuredWork.id, '12');
  assert.deepEqual(c.state.catalogWorks.map(w => w.ordinal), ['02', '03', '04', '05', '06', '07', '08']);
  assert.equal(c.state.visibleCount, 6); assert.equal(c.state.remainingWorks, 1);
  assert.equal(f.imageReads.length, 7); // Featured 01 plus directory 02–07, not six images total.
  await c.more(); assert.equal(c.state.remainingWorks, 0); assert.equal(f.imageReads.length, 8);
  assert.equal(c.state.catalogCompleteLabel, '8套作品已全部展示');
  await c.more(); assert.equal(f.imageReads.length, 8);
});

test('all style/layout options use distinct published works, including secondary styles beyond the former cutoff', () => {
  const raw = works();
  raw[6].secondaryStyles = ['侘寂', '极简']; raw[7].primaryStyle = '法式'; raw[7].layoutTypes = ['复式'];
  const view = designerForView({ name: '测试', works: raw }), state = studioCatalog(view.works);
  assert.deepEqual(state.styleOptions.map(o => o.label), ['全部', '原木风', '现代简约', '奶油风', '侘寂', '极简', '法式']);
  assert.equal(state.styleOptions[0].count, 8);
  assert.ok(state.layoutOptions.some(o => o.key === '复式'));
  const lastStyle = studioCatalog(view.works, { ...studioDefaults(), style: '极简' });
  assert.deepEqual(lastStyle.catalogWorks.map(w => w.ordinal), ['07']);
  assert.equal(lastStyle.matchingCount, 1);
});

test('combined filters include the first matching work and featured-only results, without moving the exhibit or writing preferences', async () => {
  const f = fixture(), c = f.controller; await c.show(options);
  const preview = c.previewStudioFilters({ style: '现代简约', layout: '三居', tourOnly: false });
  assert.equal(preview.count, 2); assert.equal(c.state.hasStudioFilters, false);
  await c.setStudioFilters(preview.filters);
  assert.deepEqual(c.state.catalogWorks.map(w => w.ordinal), ['05', '08']);
  assert.equal(c.state.featuredWork.ordinal, '01');
  await c.setStudioFilters({ ...studioDefaults(), tourOnly: true });
  assert.deepEqual(c.state.catalogWorks.map(w => w.ordinal), ['01']);
  await c.setStudioFilters({ style: '现代简约', layout: 'all', tourOnly: true });
  assert.equal(c.state.matchingCount, 0); assert.equal(c.state.catalogWorks.length, 0); assert.equal(f.writes.length, 0);
  await c.write('contact'); assert.equal(f.writes.length, 1);
  assert.ok(f.writes[0].path.endsWith('/works/12/contact'));
  assert.deepEqual(f.writes[0].body, { versionId: '112' });
});

test('detail return restores only view choices after fresh authorization, while clearing and rereading every media file', async () => {
  const f = fixture(), c = f.controller; await c.show(options); await c.more(); c.recordScroll(610);
  const oldImage = c.state.images.i212; c.hide();
  assert.deepEqual(c.state.images, {}); assert.equal(c.fullWorks, null);
  assert.deepEqual(Object.keys(c.studioView).sort(), ['context', 'filters', 'scrollTop', 'template', 'visibleCount']);
  await c.show(options); assert.equal(f.reads(), 2); assert.equal(c.state.visibleCount, 12); assert.equal(c.restoreScrollTop, 610);
  assert.notEqual(c.state.images.i212, oldImage);
  await c.setStudioFilters({ style: '现代简约', layout: '三居', tourOnly: false }); c.recordScroll(480); c.hide();
  await c.show(options); assert.deepEqual(c.state.catalogWorks.map(w => w.ordinal), ['05', '08']); assert.equal(c.restoreScrollTop, 480);
  f.replace(works().filter(w => w.id !== '16')); c.hide(); await c.show(options);
  assert.ok(!c.state.catalogWorks.some(w => w.id === '16')); assert.equal(c.state.images.i216, undefined);
  assert.ok(f.deletes() >= 6);
});

test('identity changes and revoked sources discard saved selections and cannot reveal old media or a stale catalog', async () => {
  const f = fixture(), c = f.controller; await c.show(options);
  await c.setStudioFilters({ ...studioDefaults(), style: '现代简约' }); c.recordScroll(500); c.hide();
  f.changeIdentity('account-b'); await c.show(options);
  assert.deepEqual(c.state.studioFilters, studioDefaults()); assert.equal(c.restoreScrollTop, 0);
  c.hide(); f.revoke(); await c.show(options);
  assert.equal(c.state.unavailable, true); assert.equal(c.state.featuredWork, null); assert.deepEqual(c.state.catalogWorks, []);
  assert.deepEqual(c.state.images, {}); assert.equal(c.studioView, null);
  await c.setStudioFilters(studioDefaults()); await c.more(); assert.deepEqual(c.state.catalogWorks, []);
});

test('filter sheet drafts, reset and cancellation preserve the applied list; confirmation applies once and guards hidden pages', async () => {
  const previous = global.wx;
  global.wx = { getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844 }) };
  const f = fixture(), c = f.controller; await c.show(options);
  const p = page('designer'); p._alive = p._shown = true; p.controller = c;
  p.setData = patch => Object.assign(p.data, patch); Object.assign(p.data, c.state); c.emit = patch => p.setData(patch);
  let aligns = 0; p.alignStudioCatalog = () => { aligns += 1; };
  const select = (group, key) => p.selectStudioDraft({ currentTarget: { dataset: { group, key } } });
  try {
    p.showStudioFilters(); select('style', '现代简约'); select('layout', '三居');
    assert.equal(p.data.studioDraftCount, 2); assert.equal(c.state.hasStudioFilters, false);
    p.dismissStudioFilters(); assert.equal(c.state.hasStudioFilters, false);
    p.showStudioFilters(); assert.deepEqual(p.data.studioDraft, studioDefaults());
    select('style', '现代简约'); select('layout', '三居'); await p.applyStudioFilters();
    assert.deepEqual(c.state.catalogWorks.map(w => w.ordinal), ['05', '08']); assert.equal(aligns, 1);
    p.showStudioFilters(); p.resetStudioDraft(); assert.equal(p.data.studioDraftCount, 8); assert.equal(c.state.matchingCount, 2);
    p._shown = false; await p.applyStudioFilters(); assert.equal(aligns, 1); assert.equal(c.state.matchingCount, 2);
  } finally { p.dismissStudioFilters(); global.wx = previous; }
});
