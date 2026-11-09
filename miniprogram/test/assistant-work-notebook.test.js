const test = require('node:test');
const assert = require('node:assert/strict');
const { workForView, applySpace } = require('../packages/assistant/lib/portfolio');

const work = { id: '1', versionId: '2', title: '真实作品', coverAssetId: '10', images: [
  { assetId: '10', kind: 'render', space: '厨房' }, { assetId: '11', kind: 'render', space: '客厅' },
  { assetId: '12', kind: 'render', space: '主卧' }, { assetId: '13', kind: 'photo', space: '客厅' },
] };
test('notebook shows a living room as the largest render while preserving all real image groups', () => {
  const view = workForView(work);
  assert.equal(view.renders[0].assetId, '11'); assert.equal(view.renders[0].galleryWide, true);
  assert.equal(view.renders.length, 3); assert.equal(view.photos.length, 1);
  const kitchen = applySpace(view, '厨房');
  assert.deepEqual(kitchen.renders.map(image => image.assetId), ['10']); assert.equal(kitchen.photos.length, 0);
  assert.equal(applySpace(view, 'all').renders.length, 3);
});
test('legacy or single drawings never fabricate a comparison or annotations', () => {
  assert.deepEqual(workForView(work).planDrawings, []);
  const single = workForView({ ...work, planComparison: { originalAssetId: '20', aligned: true, changes: [{ title: '不应出现' }] } });
  assert.equal(single.planDrawings.length, 1); assert.equal(single.plansAligned, false); assert.deepEqual(single.planChanges, []);
  const pair = workForView({ ...work, planComparison: { originalAssetId: '20', designAssetId: '21', aligned: true, changes: [{ title: '连通', text: '实际说明' }] } });
  assert.deepEqual(pair.planDrawings.map(item => item.assetId), ['20', '21']);
  assert.equal(pair.plansAligned, true); assert.equal(pair.planChanges[0].ordinal, '01');
  assert.equal(pair.preference, undefined);
});
