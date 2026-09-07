const test = require('node:test');
const assert = require('node:assert/strict');
const graph = require('../packages/surveying/utils/surveyWallGraph.js');
const { wrapFormalDraftStorage, getDraftGeometryFingerprint } = require('../packages/surveying/utils/surveyDraftAutosave.js');

function pendingDraft() {
  let draft = graph.placeCursor(graph.createSurveyDraft(), { xMm: 0, yMm: 0 });
  for (const [xMm, yMm, length] of [[6000, 0, 6000], [6000, 4000, 4000], [0, 4000, 6000], [0, 0, 3950]]) {
    draft = graph.commitPreviewLength(graph.startPreview(draft, { xMm, yMm }), length, 'manual');
  }
  return draft;
}

function withEditor(run) {
  const previous = { Page: global.Page, wx: global.wx, getApp: global.getApp };
  const storage = new Map();
  let editor;
  global.Page = definition => { editor = definition; };
  global.getApp = () => ({ globalData: {} });
  global.wx = { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, structuredClone(value)) };
  const file = require.resolve('../packages/surveying/editor/surveying-editor.js');
  delete require.cache[file];
  try {
    require(file);
    run(editor, storage);
  } finally {
    delete require.cache[file];
    Object.entries(previous).forEach(([key, value]) => {
      if (value === undefined) delete global[key]; else global[key] = value;
    });
  }
}

test('P0 rejected local topology preserves original draft and diagnostics before an empty fallback', () => withEditor((editor, storage) => {
  const bad = pendingDraft();
  bad.floors[0].walls[0].endNodeId = 'missing';
  const stored = wrapFormalDraftStorage(bad, 10);
  storage.set('draft', stored);
  const page = { ...editor, formalDraftKey: 'draft', data: {} };
  assert.equal(page.loadFormalDraft('', null, 'draft'), null);
  assert.deepEqual(storage.get('draft'), stored);
  assert.deepEqual(storage.get('draft_recovery').draft, bad);
  assert.equal(storage.get('draft_recovery').validation.valid, false);
  page.draft = graph.createSurveyDraft();
  assert.equal(page.persistFormalDraft(), false);
  assert.deepEqual(storage.get('draft'), stored);
}));

test('P0 invalid graph cannot replace local storage or enter a cloud draft write', () => withEditor((editor, storage) => {
  const page = { ...editor, formalDraftKey: 'draft', data: {}, draft: pendingDraft() };
  assert.equal(page.persistFormalDraft(), true);
  const before = structuredClone(storage.get('draft'));
  page.draft.floors[0].walls[0].endNodeId = 'missing';
  assert.equal(page.persistFormalDraft(), false);
  assert.deepEqual(storage.get('draft'), before);
  assert.throws(() => page.buildFormalCloudLayoutData('draft'), { code: 'MISSING_WALL_END_NODE' });
}));

test('P0 pending measured closure survives local and cloud draft reload and keeps the approved close action', () => withEditor((editor, storage) => {
  const page = { ...editor, formalDraftKey: 'draft', data: {}, draft: pendingDraft(),
    canvasRect: { width: 390, height: 600 }, mmToCanvasPoint: p => ({ x: p.xMm / 20 + 20, y: p.yMm / 20 + 20 }) };
  assert.equal(page.persistFormalDraft(), true);
  const restored = page.loadFormalDraft('', null, 'draft');
  assert.deepEqual(restored.floors[0].session.pendingMeasuredClosure, { lengthMm: 3950, inputSource: 'manual' });
  const floor = restored.floors[0];
  assert.equal(page.buildClosureRender(floor, floor.session).actionVisible, true);
  assert.deepEqual(page.buildFormalCloudLayoutData('draft').surveyGraph.floors[0].session.pendingMeasuredClosure,
    floor.session.pendingMeasuredClosure);
  assert.throws(() => page.buildFormalCloudLayoutData('completed'), { code: 'PENDING_MEASURED_CLOSURE' });
  assert.equal(graph.confirmClosure(restored).floors[0].spaces.length, 1);
  assert.ok(storage.get('draft'));
}));

test('P0 pending measurement is fingerprinted and cancelled/replaced without leaking stale confirmation', () => {
  const pending = pendingDraft();
  const edited = structuredClone(pending);
  edited.floors[0].session.pendingMeasuredClosure.lengthMm = 3960;
  assert.notEqual(getDraftGeometryFingerprint(pending), getDraftGeometryFingerprint(edited));
  for (const next of [graph.cancelPending(pending), graph.startPreview(pending, { xMm: -2000, yMm: 4000 }),
    graph.selectWall(pending, pending.floors[0].walls[0].id), graph.startWallSnap(pending),
    graph.deleteWall(pending, pending.floors[0].walls.at(-1).id)]) {
    assert.equal(next.floors[0].session.pendingMeasuredClosure, undefined);
    assert.deepEqual(graph.validateSurveyDraft(next, { mode: 'full' }).errors, []);
  }
  assert.equal(pending.floors[0].session.pendingMeasuredClosure.lengthMm, 3950);
});

test('P1 malformed local elements retain recovery evidence and cannot enter cloud writes', () => withEditor((editor, storage) => {
  const bad = pendingDraft(); bad.floors[0].nodes.push(null);
  const stored = wrapFormalDraftStorage(bad, 20); storage.set('draft', stored);
  const page = { ...editor, formalDraftKey: 'draft', data: {}, draft: bad };
  assert.equal(page.loadFormalDraft('', null, 'draft'), null);
  assert.deepEqual(storage.get('draft'), stored);
  assert.ok(storage.get('draft_recovery').validation.errors.some(e => e.code === 'INVALID_COLLECTION_ELEMENT'));
  assert.throws(() => page.buildFormalCloudLayoutData('draft'), { code: 'INVALID_COLLECTION_ELEMENT' });
  assert.equal(page.persistFormalDraft(), false);
  assert.deepEqual(storage.get('draft'), stored);
}));

test('P1 editor saves a valid open-chain draft but cannot mark that plan complete', () => withEditor((editor, storage) => {
  const draft = graph.confirmClosure(pendingDraft()), floor = draft.floors[0];
  floor.nodes.push({ id: 'x', xMm: 9000, yMm: 0 }, { id: 'y', xMm: 10000, yMm: 0 });
  floor.walls.push({ id: 'xy', startNodeId: 'x', endNodeId: 'y', lengthMm: 1000, thicknessMm: 100 });
  const page = { ...editor, formalDraftKey: 'draft', data: {}, draft };
  assert.equal(page.persistFormalDraft(), true);
  const saved = structuredClone(storage.get('draft'));
  assert.ok(page.buildFormalCloudLayoutData('draft'));
  assert.throws(() => page.buildFormalCloudLayoutData('completed'), { code: 'INCOMPLETE_WALL_CHAIN' });
  assert.deepEqual(storage.get('draft'), saved);
}));
