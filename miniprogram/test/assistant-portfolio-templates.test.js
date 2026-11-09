const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PortfolioController, designerForView, studioCatalog, studioDefaults } = require('../packages/assistant/lib/portfolio');

const works = () => Array.from({ length: 8 }, (_, index) => ({ id: String(20 + index), versionId: String(120 + index),
  authorId: '14', title: '合成作品' + index, primaryStyle: index % 2 ? '原木风' : '现代简约', coverAssetId: String(220 + index),
  images: [{ assetId: String(220 + index), kind: 'render', aiGenerated: true }],
  highlights: ['真实公开的设计说明'], palette: [{ name: '橡木', hex: '#ba9d72' }], materials: ['棉麻'], tours: [],
}));

test('legacy/unknown templates keep the gallery; notebook uses the same public works and sanitized materials', () => {
  const raw = works(); raw[0].images.push({ assetId: '300', kind: 'photo' });
  for (const template of [undefined, 'future-template']) assert.equal(designerForView({ template, works: raw }).template, 'gallery');
  const notebook = designerForView({ template: 'notebook', works: raw });
  assert.equal(notebook.template, 'notebook'); assert.equal(notebook.works[0].detailAssetId, '300');
  assert.equal(notebook.works[1].detailAssetId, '');
  const gallery = studioCatalog(notebook.works), book = studioCatalog(notebook.works, studioDefaults(), 6, notebook.template);
  assert.equal(gallery.closingWork, null); assert.equal(gallery.remainingWorks, 1);
  assert.deepEqual(book.catalogWorks.map(w => w.ordinal), ['02', '03', '04', '05', '06', '07']);
  assert.equal(book.closingWork.ordinal, '08'); assert.equal(book.remainingWorks, 0);
  const filtered = studioCatalog(notebook.works, { ...studioDefaults(), style: '现代简约' }, 6, 'notebook');
  assert.equal(filtered.closingWork, null); assert.ok(filtered.catalogWorks.some(w => w.ordinal === '01'));
  assert.equal(studioCatalog(notebook.works.slice(0, 1), studioDefaults(), 6, 'notebook').closingWork, null);
});

test('notebook reads actual detail/ending images, switches on service reentry and clears every private file on revocation', async () => {
  let template, revoked = false; const loaded = [], cleared = [];
  const raw = works(); raw[0].images.push({ assetId: '300', kind: 'photo' });
  const client = { pending: new Map(), async read(path) {
    if (path === '/conversations/11') return { id: '11', status: 'open' };
    if (path.endsWith('/designers/14')) { if (revoked) throw { statusCode: 404 }; return { id: '14', name: '合成设计师', template, works: raw }; }
    if (path.endsWith('/share')) return { path: '/safe-share' };
    throw Error(path);
  } };
  const c = new PortfolioController({ client, emit() {}, identity: () => 'same-account', images: {
    clear() { cleared.push(true); }, async load(cid, work, assetId) { loaded.push([work.id, work.versionId, assetId]); return '/private/' + assetId; },
  } });
  const options = { conversationId: '11', authorId: '14' };
  await c.show(options); assert.equal(c.state.designer.template, 'gallery'); assert.ok(!loaded.some(row => row[2] === '300'));
  c.recordScroll(620); c.hide(); template = 'notebook'; await c.show(options);
  assert.equal(c.restoreScrollTop, 0); assert.equal(c.state.designer.template, 'notebook');
  assert.ok(c.state.images.i300); assert.ok(c.state.images.i227); assert.equal(c.state.closingWork.ordinal, '08');
  await c.setStudioFilters({ ...studioDefaults(), style: '原木风' }); c.recordScroll(920); c.hide(); await c.show(options);
  assert.equal(c.restoreScrollTop, 920); assert.equal(c.state.studioFilters.style, '原木风');
  c.hide(); template = 'gallery'; await c.show(options);
  assert.equal(c.restoreScrollTop, 0); assert.equal(c.state.designer.template, 'gallery'); assert.equal(c.state.images.i300, undefined);
  c.hide(); revoked = true; await c.show(options);
  assert.equal(c.state.designer, null); assert.equal(c.state.closingWork, null); assert.deepEqual(c.state.images, {});
  assert.ok(cleared.length >= 5);
});
