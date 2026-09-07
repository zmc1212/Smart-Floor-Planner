const test = require('node:test');
const assert = require('node:assert/strict');
const graph = require('../packages/surveying/utils/surveyWallGraph.js');
const autosave = require('../packages/surveying/utils/surveyDraftAutosave.js');
const { nodeIntersections } = require('../packages/surveying/utils/survey/operations/node-intersections.js');
const { syncFloorSpaces } = require('../packages/surveying/utils/survey/operations/wall-mutation-helpers.js');
const { buildSpaceWallFaceSegments, buildFaceBoundaryPlan } = require('../packages/surveying/utils/survey/read-model/space-boundary.js');
const { boundaryInteriorNormal } = require('../packages/surveying/utils/survey/topology/closed-boundary.js');
const { buildBaseWallSegment } = require('../packages/surveying/utils/survey/read-model/wall-geometry.js');
const { createFormalSurveyLayout } = require('../utils/surveyLayout.js');

function room(points = [[0, 0], [6000, 0], [6000, 6000], [0, 6000]]) {
  const draft = graph.createSurveyDraft();
  const floor = draft.floors[0];
  floor.nodes = points.map(([xMm, yMm], i) => ({ id: `n${i}`, xMm, yMm }));
  floor.walls = floor.nodes.map((node, i) => {
    const end = floor.nodes[(i + 1) % points.length];
    const lengthMm = Math.round(Math.hypot(end.xMm - node.xMm, end.yMm - node.yMm));
    return { id: `w${i}`, startNodeId: node.id, endNodeId: end.id, lengthMm,
      rawMeasuredLengthMm: lengthMm, closureAdjustmentMm: 0, thicknessMm: 100 };
  });
  floor.spaces = [{ id: 'original', name: '客厅', closed: true, wallIds: floor.walls.map(w => w.id) }];
  return draft;
}
function codes(draft, options = {}) {
  return graph.validateSurveyDraft(draft, { mode: 'full', ...options }).errors.map(e => e.code);
}
function reload(draft) {
  const restored = JSON.parse(JSON.stringify(createFormalSurveyLayout(draft, 'draft'))).surveyGraph;
  assert.deepEqual(codes(restored), []);
  return restored;
}
function branch(floor, x = 9000) {
  floor.nodes.push({ id: 'a', xMm: x, yMm: 0 }, { id: 'b', xMm: x, yMm: 1000 });
  floor.walls.push({ id: 'branch', startNodeId: 'a', endNodeId: 'b', lengthMm: 1000, thicknessMm: 100 });
}

test('P1 autosave tracks actual opening coordinates, dimensions, faces and audits, ignoring view and clocks', () => {
  const draft = room();
  draft.floors[0].openings = [{ id: 'o', wallId: 'w0', type: 'door', widthMm: 800, centerOffsetMm: 2000 }];
  const fingerprint = autosave.getDraftGeometryFingerprint(draft);
  for (const mutate of [
    d => { d.floors[0].openings[0].centerOffsetMm += 100; },
    d => { d.floors[0].openings[0].sillHeightMm = 800; },
    d => { d.floors[0].walls[0].rawMeasuredLengthMm -= 10; d.floors[0].walls[0].closureAdjustmentMm = 10; },
    d => { d.floors[0].spaces[0].wallFaceOverrides = { w0: 'offset' }; }
  ]) {
    const next = structuredClone(draft); mutate(next);
    assert.notEqual(autosave.getDraftGeometryFingerprint(next), fingerprint);
    assert.equal(autosave.shouldAutosaveSurveyDraft(next, { lastCloudFingerprint: fingerprint }), true);
    assert.equal(autosave.shouldKeepLocalSurveyDraft(next, 20, draft, 10), true);
  }
  draft.updatedAt = 'later'; draft.floors[0].walls[0].measuredAt = 'later';
  draft.floors[0].viewport.scale = 99; draft.floors[0].session.selectedWallId = 'w0';
  assert.equal(autosave.getDraftGeometryFingerprint(draft), fingerprint);
});

for (const kind of ['nodes', 'walls', 'spaces', 'openings']) {
  for (const value of [null, 1, 'bad', []]) test(`P1 malformed ${kind} ${JSON.stringify(value)} returns a structured error`, () => {
    const draft = room(); draft.floors[0][kind].push(value);
    const before = JSON.stringify(draft);
    for (const mode of ['quick', 'full']) {
      const result = graph.validateSurveyDraft(draft, { mode });
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.code === 'INVALID_COLLECTION_ELEMENT' && e.path.startsWith('floors[0].')));
    }
    assert.equal(JSON.stringify(draft), before);
  });
}
for (const [field, value] of [['xMm', null], ['xMm', '0'], ['xMm', 0.5], ['lengthMm', 6000.25]]) {
  test(`P1 persisted ${field}=${value} cannot enter geometry`, () => {
    const draft = room(); (field === 'xMm' ? draft.floors[0].nodes[0] : draft.floors[0].walls[0])[field] = value;
    assert.ok(codes(draft).length);
  });
}

test('P1 session space and malformed reference types are checked', () => {
  const draft = room(); draft.floors[0].session.selectedSpaceId = 'missing';
  assert.ok(codes(draft).includes('MISSING_SESSION_SPACE'));
  draft.floors[0].session.selectedSpaceId = null;
  assert.ok(codes(draft).includes('INVALID_REFERENCE_ID'));
});

for (let rotation = 0; rotation < 4; rotation++) for (const mirror of [false, true]) {
  test(`P1 C-room local faces and independent 28m2 area: rotation=${rotation}, mirror=${mirror}`, () => {
    const points = [[0,0],[6000,0],[6000,2000],[2000,2000],[2000,4000],[6000,4000],[6000,6000],[0,6000]].map(([a,b]) => {
      let x = mirror ? -a : a, y = b;
      for (let i = 0; i < rotation; i++) [x,y] = [-y,x];
      return [x + 11000, y - 3000];
    });
    const draft = reload(room(points)), floor = draft.floors[0], space = floor.spaces[0];
    for (const wall of floor.walls) {
      const inward = boundaryInteriorNormal(floor, space.wallIds, wall.id);
      const base = buildBaseWallSegment(floor, wall);
      assert.ok(base.normal.x * inward.x + base.normal.y * inward.y < -0.99);
    }
    assert.equal(graph.calculateSpaceAreaMm2(draft, space.id), 28000000);
    assert.ok(buildSpaceWallFaceSegments(floor, space.wallIds).every(face => face.face === 'topology'));
  });
}

test('P1 thick opposing walls reject reversed edges even when signed area stays positive', () => {
  const draft = room([[0,0],[1000,0],[1000,1000],[0,1000]]), floor = draft.floors[0];
  floor.walls.forEach(wall => { wall.bodyNormalSide = 'right'; wall.thicknessMm = 700; });
  const faces = buildSpaceWallFaceSegments(floor, floor.spaces[0].wallIds);
  assert.equal(buildFaceBoundaryPlan(faces, 'innerStart', 'innerEnd').points.length, 4);
  assert.ok(codes(draft).includes('INVALID_SPACE_INNER_BOUNDARY'));
});

test('P1 remeasurement budgets reject 6m to 20m atomically and allow 120mm only once', () => {
  const draft = room();
  Object.assign(draft.floors[0].session, { state: 'remeasureAwaitingInput', selectedWallId: 'w0', fixedNodeId: 'n0' });
  const before = JSON.stringify(draft);
  for (const length of [20000, 6121]) assert.throws(() => graph.remeasureSelectedWall(draft, length), { code: 'MEASUREMENT_ADJUSTMENT_BUDGET_EXCEEDED' });
  assert.equal(JSON.stringify(draft), before);
  const accepted = reload(graph.remeasureSelectedWall(draft, 6120));
  assert.equal(accepted.floors[0].walls.find(w => w.id === 'w2').closureAdjustmentMm, 120);
  Object.assign(accepted.floors[0].session, { state: 'remeasureAwaitingInput', selectedWallId: 'w0', fixedNodeId: 'n0' });
  assert.throws(() => graph.remeasureSelectedWall(accepted, 6121), { code: 'MEASUREMENT_ADJUSTMENT_BUDGET_EXCEEDED' });
});

test('P1 opening overlap and contact reject updates atomically; one millimetre gap is valid', () => {
  let draft = graph.addOpeningToWall(room(), 'w0', 'door');
  const first = draft.floors[0].openings[0];
  draft = graph.updateOpening(draft, first.id, { widthMm: 800, centerOffsetMm: 1000 });
  draft = graph.addOpeningToWall(draft, 'w0', 'window');
  const second = draft.floors[0].openings[1];
  const before = JSON.stringify(draft);
  for (const centerOffsetMm of [1000, 1800]) assert.throws(() => graph.updateOpening(draft, second.id, { widthMm: 800, centerOffsetMm }), { code: 'OPENING_OCCUPANCY_CONFLICT' });
  assert.equal(JSON.stringify(draft), before);
  reload(graph.updateOpening(draft, second.id, { widthMm: 800, centerOffsetMm: 1801 }));
});

test('P1 completion rejects other open chains while draft persistence remains possible', () => {
  const draft = room(); branch(draft.floors[0]); reload(draft);
  assert.ok(codes(draft, { requireComplete: true }).includes('INCOMPLETE_WALL_CHAIN'));
  assert.deepEqual(codes(room(), { requireComplete: true }), []);
});

for (const x of [3000, 2000]) test(`P1 split identity uses largest area then coordinate key at x=${x}`, () => {
  const results = [];
  for (const reverse of [false, true]) {
    const draft = room(), floor = draft.floors[0];
    floor.nodes.push({ id:'cutA', xMm:x, yMm:0 }, { id:'cutB', xMm:x, yMm:6000 });
    floor.walls.push({ id:'divider', startNodeId:'cutA', endNodeId:'cutB', lengthMm:6000, thicknessMm:100 });
    if (reverse) { floor.walls.reverse(); floor.nodes.reverse(); }
    nodeIntersections(floor); syncFloorSpaces(floor); reload(draft);
    const retained = floor.spaces.find(s => s.id === 'original');
    assert.equal(retained.name, '客厅');
    results.push(graph.buildSpaceBoundaryPoints(floor, retained.wallIds).map(p => [p.xMm,p.yMm]).sort());
    const minX = Math.min(...results.at(-1).map(p => p[0]));
    assert.equal(minX, x === 3000 ? 0 : 2000);
  }
  assert.deepEqual(results[0], results[1]);
});

for (const x of [3000, 2000, 4000]) test(`P1 merge retains larger original identity with deterministic tie x=${x}`, () => {
  for (const reverse of [false, true]) {
    const draft = room(), floor = draft.floors[0];
    floor.nodes.push({ id:'cutA', xMm:x, yMm:0 }, { id:'cutB', xMm:x, yMm:6000 });
    floor.walls.push({ id:'divider', startNodeId:'cutA', endNodeId:'cutB', lengthMm:6000, thicknessMm:100 });
    nodeIntersections(floor); syncFloorSpaces(floor);
    floor.spaces.forEach(space => {
      const left = graph.buildSpaceBoundaryPoints(floor, space.wallIds).some(p => p.xMm === 0);
      space.id = left ? 'left' : 'right'; space.name = left ? '客厅' : '卧室';
    });
    if (reverse) { floor.spaces.reverse(); floor.walls.reverse(); }
    const before = JSON.stringify(draft);
    const merged = reload(graph.deleteWall(draft, 'divider'));
    assert.equal(JSON.stringify(draft), before);
    assert.equal(merged.floors[0].spaces.length, 1);
    assert.equal(merged.floors[0].spaces[0].id, x >= 3000 ? 'left' : 'right');
    // Undo/redo snapshots retain the selected identity through JSON persistence.
    const history = [JSON.parse(before), merged];
    assert.equal(reload(history[0]).floors[0].spaces.length, 2);
    assert.equal(reload(history[1]).floors[0].spaces.length, 1);
  }
});

test('P1 malformed graph transactions fail with diagnostics before any mutation', () => {
  const draft = room(); draft.floors[0].walls.push(null);
  const before = JSON.stringify(draft);
  assert.throws(() => graph.deleteWall(draft, 'w0'), error => error.code === 'INVALID_COLLECTION_ELEMENT' && !!error.validation.errors[0].path);
  assert.equal(JSON.stringify(draft), before);
});
