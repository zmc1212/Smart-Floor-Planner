const test = require('node:test');
const assert = require('node:assert/strict');
const graph = require('../packages/surveying/utils/surveyWallGraph.js');
const { nodeIntersections } = require('../packages/surveying/utils/survey/operations/node-intersections.js');
const { runSurveyTransaction } = require('../packages/surveying/utils/survey/operations/transaction.js');
const { syncFloorSpaces } = require('../packages/surveying/utils/survey/operations/wall-mutation-helpers.js');
const layout = require('../utils/surveyLayout.js');

function draftFromLines(lines) {
  const draft = graph.createSurveyDraft();
  const floor = graph.getActiveFloor(draft);
  lines.forEach(([a, b], i) => {
    const start = { id: `a${i}`, xMm: a[0], yMm: a[1] };
    const end = { id: `b${i}`, xMm: b[0], yMm: b[1] };
    floor.nodes.push(start, end);
    const lengthMm = Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]));
    floor.walls.push({ id: `w${i}`, startNodeId: start.id, endNodeId: end.id,
      lengthMm, rawMeasuredLengthMm: lengthMm, closureAdjustmentMm: 0, thicknessMm: 100 });
  });
  return draft;
}
function node(draft) {
  return runSurveyTransaction(draft, 'test-node', working => {
    const floor = graph.getActiveFloor(working);
    nodeIntersections(floor);
    syncFloorSpaces(floor);
    return working;
  }, { mode: 'full' });
}
function validReload(draft) {
  const saved = JSON.stringify(layout.createFormalSurveyLayout(draft, 'draft'));
  const restored = layout.parseFormalSurveyLayout(saved).surveyGraph;
  assert.deepEqual(graph.validateSurveyDraft(restored, { mode: 'full' }).errors, []);
  return restored;
}
const rectangle = (x, y, w, h) => [
  [[x, y], [x + w, y]], [[x + w, y], [x + w, y + h]],
  [[x + w, y + h], [x, y + h]], [[x, y + h], [x, y]]
];

for (let rotation = 0; rotation < 4; rotation += 1) {
  for (const mirror of [false, true]) {
    for (const [name, lines, expectedWalls, degree] of [
      ['T', [[[0, 0], [6000, 0]], [[3000, 0], [3000, 2000]]], 3, 3],
      ['X', [[[0, 0], [6000, 0]], [[3000, -2000], [3000, 2000]]], 4, 4],
      ['diagonal X', [[[0, 0], [6000, 6000]], [[0, 6000], [6000, 0]]], 4, 4]
    ]) {
      test(`P0 ${name} nodes one junction: rotation=${rotation}, mirror=${mirror}`, () => {
        const transform = ([x0, y0]) => {
          let x = mirror ? -x0 : x0, y = y0;
          for (let i = 0; i < rotation; i += 1) [x, y] = [-y, x];
          return [x + 17000, y - 9000];
        };
        const input = draftFromLines(lines.map(line => line.map(transform)));
        const before = JSON.stringify(input);
        const result = node(input);
        assert.equal(JSON.stringify(input), before);
        const floor = graph.getActiveFloor(validReload(result));
        assert.equal(floor.walls.length, expectedWalls);
        const junctions = floor.nodes.filter(n => floor.walls.filter(w =>
          w.startNodeId === n.id || w.endNodeId === n.id).length === degree);
        assert.equal(junctions.length, 1);
        assert.equal(floor.walls.reduce((sum, w) => sum + w.rawMeasuredLengthMm, 0),
          input.floors[0].walls.reduce((sum, w) => sum + w.rawMeasuredLengthMm, 0));
        assert.equal(JSON.stringify(node(result).floors), JSON.stringify(result.floors), 'repeated node operation is idempotent');
      });
    }
  }
}

test('P0 unordered, repeated and disconnected room boundaries are rejected by validator and reader', () => {
  const base = node(draftFromLines(rectangle(0, 0, 6000, 6000)));
  const ids = base.floors[0].spaces[0].wallIds;
  for (const order of [[ids[0], ids[2], ids[1], ids[3]], [ids[0], ids[1], ids[1], ids[3]]]) {
    const draft = structuredClone(base);
    draft.floors[0].spaces[0].wallIds = order;
    for (const mode of ['quick', 'full']) assert.ok(graph.validateSurveyDraft(draft, { mode }).errors
      .some(error => error.code === 'BROKEN_SPACE_CYCLE'));
    assert.deepEqual(graph.buildSpaceBoundaryPoints(draft.floors[0], order), []);
  }
  for (const order of [ids.slice().reverse(), ids.slice(2).concat(ids.slice(0, 2))]) {
    const draft = structuredClone(base);
    draft.floors[0].spaces[0].wallIds = order;
    validReload(draft);
    const points = graph.buildSpaceBoundaryPoints(draft.floors[0], order);
    // Independent shoelace oracle: 6m x 6m, not a Face-extractor self-check.
    const twiceArea = points.reduce((sum, p, i) => {
      const q = points[(i + 1) % points.length];
      return sum + p.xMm * q.yMm - q.xMm * p.yMm;
    }, 0);
    assert.equal(Math.abs(twiceArea) / 2, 36000000);
  }
});

test('P0 nested 6m and 1m loops reject atomically instead of reporting 37 square metres', () => {
  const input = draftFromLines([...rectangle(0, 0, 6000, 6000), ...rectangle(2000, 2000, 1000, 1000)]);
  const before = JSON.stringify(input);
  assert.throws(() => node(input), { code: 'UNSUPPORTED_NESTED_SPACE' });
  assert.equal(JSON.stringify(input), before);
});

test('P0 disjoint rooms and an exact divider remain valid; shared walls are counted once', () => {
  const disjoint = node(draftFromLines([...rectangle(0, 0, 6000, 6000), ...rectangle(8000, 0, 1000, 1000)]));
  assert.equal(disjoint.floors[0].spaces.length, 2);
  const divided = node(draftFromLines([...rectangle(0, 0, 6000, 6000), [[3000, 0], [3000, 6000]]]));
  const floor = divided.floors[0];
  assert.equal(floor.spaces.length, 2);
  assert.equal(floor.spaces[0].wallIds.filter(id => floor.spaces[1].wallIds.includes(id)).length, 1);
  validReload(divided);
});

test('P0 fractional crossings and overlapping walls reject without altering input', () => {
  for (const [lines, code] of [
    [[[[0, 0], [3000, 3000]], [[0, 1001], [3000, 0]]], 'UNSUPPORTED_INTERSECTION_PRECISION'],
    [[[[0, 0], [6000, 0]], [[2000, 0], [8000, 0]]], 'OVERLAPPING_WALLS']
  ]) {
    const input = draftFromLines(lines);
    const before = JSON.stringify(input);
    assert.throws(() => node(input), { code });
    assert.equal(JSON.stringify(input), before);
  }
});

test('P0 T splits preserve an opening world position and reject a cut through its span', () => {
  for (const centerOffsetMm of [1000, 3000]) {
    const input = draftFromLines([[[0, 0], [6000, 0]], [[3000, 0], [3000, 2000]]]);
    input.floors[0].openings.push({ id: 'door', wallId: 'w0', type: 'door', widthMm: 800, centerOffsetMm });
    const before = JSON.stringify(input);
    if (centerOffsetMm === 3000) assert.throws(() => node(input), { code: 'OPENING_SPLIT_CONFLICT' });
    else {
      const floor = node(input).floors[0];
      const opening = floor.openings[0];
      const host = graph.getWall(floor, opening.wallId);
      assert.equal(graph.getNode(floor, host.startNodeId).xMm + opening.centerOffsetMm, centerOffsetMm);
    }
    assert.equal(JSON.stringify(input), before);
  }
});

test('P0 public commit creates an exact room in one snapshot and preserves near-closure confirmation', () => {
  for (const lastLength of [4000, 3950]) {
    let draft = graph.placeCursor(graph.createSurveyDraft(), { xMm: 0, yMm: 0 });
    for (const [point, length] of [[{ xMm: 6000, yMm: 0 }, 6000], [{ xMm: 6000, yMm: 4000 }, 4000],
      [{ xMm: 0, yMm: 4000 }, 6000]]) draft = graph.commitPreviewLength(graph.startPreview(draft, point), length);
    const undo = structuredClone(draft);
    draft = graph.commitPreviewLength(graph.startPreview(draft, { xMm: 0, yMm: 0 }), lastLength);
    const redo = validReload(draft);
    assert.equal(undo.floors[0].spaces.length, 0);
    if (lastLength === 4000) {
      assert.equal(redo.floors[0].spaces.length, 1);
      assert.equal(redo.floors[0].session.state, 'spaceClosed');
      assert.deepEqual(graph.confirmClosure(redo).floors, redo.floors);
    } else {
      assert.equal(redo.floors[0].spaces.length, 0);
      assert.equal(redo.floors[0].session.state, 'wallPreview');
      assert.equal(redo.floors[0].session.pendingMeasuredClosure.lengthMm, 3950);
      assert.equal(graph.confirmClosure(redo).floors[0].spaces.length, 1);
    }
  }
});

test('P0 public commits node T connections and retain nearest-wall clamping before save', () => {
  for (const y of [0, 2000]) {
    let draft = draftFromLines([[[0, 0], [6000, 0]]]);
    const floor = draft.floors[0];
    floor.nodes.push({ id: 'cursor', xMm: 3000, yMm: -2000 });
    Object.assign(floor.session, { state: 'cursorPlaced', anchorNodeId: 'cursor',
      activeSpaceStartNodeId: 'cursor', activeSpaceStartWallIndex: 1 });
    draft = graph.startPreview(draft, { xMm: 3000, yMm: y });
    const snapshot = JSON.stringify(draft);
    const result = graph.commitPreviewLength(draft, y + 2000);
    assert.equal(JSON.stringify(draft), snapshot);
    const restored = validReload(result).floors[0];
    // The existing straight-ray planner clamps an overrun at the first wall.
    assert.equal(restored.walls.length, 3);
    const junction = restored.nodes.filter(n => n.xMm === 3000 && n.yMm === 0);
    assert.equal(junction.length, 1);
    assert.equal(restored.walls.filter(w => [w.startNodeId, w.endNodeId].includes(junction[0].id)).length, 3);
  }
});
