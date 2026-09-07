const test = require('node:test');
const assert = require('node:assert/strict');
const { snapRoundSegments, hotPixelIntersects } = require('../packages/surveying/utils/survey/geometry/snap-rounding.js');
const graph = require('../packages/surveying/utils/surveyWallGraph.js');
const { nodeIntersections } = require('../packages/surveying/utils/survey/operations/node-intersections.js');
const { runSurveyTransaction } = require('../packages/surveying/utils/survey/operations/transaction.js');
const { syncFloorSpaces } = require('../packages/surveying/utils/survey/operations/wall-mutation-helpers.js');
const layout = require('../utils/surveyLayout.js');

const point = ([xMm, yMm]) => ({ xMm, yMm });
const lines = coordinates => coordinates.map(([a, b], id) => ({ id: `w${id}`, start: point(a), end: point(b) }));
const key = p => `${p.xMm},${p.yMm}`;

// Independent integer oracle: determinants use BigInt, never production
// floating point relations, line intersection, validator or Face extraction.
function orient(a, b, c) {
  return BigInt(b.xMm - a.xMm) * BigInt(c.yMm - a.yMm) -
    BigInt(b.yMm - a.yMm) * BigInt(c.xMm - a.xMm);
}
function interior(p, a, b) {
  return orient(a, b, p) === 0n && key(p) !== key(a) && key(p) !== key(b) &&
    p.xMm >= Math.min(a.xMm, b.xMm) && p.xMm <= Math.max(a.xMm, b.xMm) &&
    p.yMm >= Math.min(a.yMm, b.yMm) && p.yMm <= Math.max(a.yMm, b.yMm);
}
function assertNoded(paths) {
  const edges = paths.flatMap(path => path.points.slice(1).map((p, i) => [path.points[i], p]));
  edges.forEach(([a, b], i) => {
    assert.notEqual(key(a), key(b));
    for (const [c, d] of edges.slice(i + 1)) {
      assert.ok(!(orient(a, b, c) * orient(a, b, d) < 0n && orient(c, d, a) * orient(c, d, b) < 0n),
        `unnoded crossing ${JSON.stringify([a, b, c, d])}`);
      for (const [p, s, e] of [[a, c, d], [b, c, d], [c, a, b], [d, a, b]]) {
        assert.ok(!interior(p, s, e), `unnoded T ${JSON.stringify([p, s, e])}`);
      }
    }
  });
}
function makeDraft(coordinates) {
  const draft = graph.createSurveyDraft(), floor = draft.floors[0];
  for (const line of lines(coordinates)) {
    const a = { id: `${line.id}a`, ...line.start }, b = { id: `${line.id}b`, ...line.end };
    floor.nodes.push(a, b);
    const lengthMm = Math.round(Math.hypot(b.xMm - a.xMm, b.yMm - a.yMm));
    floor.walls.push({ id: line.id, startNodeId: a.id, endNodeId: b.id, thicknessMm: 100,
      lengthMm, rawMeasuredLengthMm: lengthMm, closureAdjustmentMm: 0 });
  }
  return draft;
}
function node(draft, runtime = { graph, nodeIntersections, runSurveyTransaction, syncFloorSpaces }) {
  return runtime.runSurveyTransaction(draft, 'snap-round', working => {
    runtime.nodeIntersections(working.floors[0]);
    runtime.syncFloorSpaces(working.floors[0]);
    return working;
  }, { mode: 'full' });
}
function floorPaths(floor) {
  return floor.walls.map(w => ({ points: [graph.getNode(floor, w.startNodeId), graph.getNode(floor, w.endNodeId)] }));
}

test('S4-B half-open hot pixel owns only its lower-left tangent corner', () => {
  const pixel = point([0, 0]);
  for (const [a, b, expected] of [
    [[-1, 0], [0, -1], true], [[-1, 0], [0, 1], false],
    [[0, 1], [1, 0], false], [[0, -1], [1, 0], false],
    [[-1, -1], [1, 1], true], [[-1, 1], [1, -1], true],
    [[-10, 0], [10, 0], true], [[0, -10], [0, 10], true],
    [[-10, 1], [10, 1], false]
  ]) {
    assert.equal(hotPixelIntersects(point(a), point(b), pixel), expected);
    assert.equal(hotPixelIntersects(point(b), point(a), pixel), expected);
  }
});

test('S4-B endpoint hot pixels node a nearby third line without an exact intersection', () => {
  const result = snapRoundSegments(lines([[[0, 0], [2000, 1]], [[1000, 1], [1000, 1000]]]));
  assert.ok(result.paths[0].points.some(p => key(p) === '1000,1'));
  assertNoded(result.paths);
});

test('S4-B exact rational rounding handles negative half ties and large safe-integer translations', () => {
  for (const offset of [0, -1000000000000, 1000000000000, Number.MAX_SAFE_INTEGER - 10]) {
    const result = snapRoundSegments(lines([
      [[offset - 2, offset - 2], [offset + 1, offset + 1]],
      [[offset - 2, offset + 1], [offset + 1, offset - 2]]
    ]));
    assert.deepEqual(result.paths[0].points[1], point([offset, offset]));
    assert.deepEqual(result.paths[1].points[1], point([offset, offset]));
    assertNoded(result.paths);
  }
});

test('S4-B several fractional crossings in the same pixel share one arrangement node', () => {
  const source = lines([[[0, 0], [1000, 1001]], [[0, 1001], [1000, 0]],
    [[500, -1000], [500, 2000]]]);
  const result = snapRoundSegments(source);
  result.paths.forEach(path => assert.deepEqual(path.points[1], point([500, 501])));
  assert.equal(result.pixels.filter(p => key(p) === '500,501').length, 1);
  assertNoded(result.paths);
});

test('S4-B fractional crossing commits, reloads, conserves raw readings and is repeatable', () => {
  const coordinates = [[[0, 0], [3000, 3000]], [[0, 1001], [3000, 0]]];
  for (let turn = 0; turn < 4; turn += 1) for (const mirror of [1, -1]) {
    const transformed = coordinates.map(line => line.map(([x0, y0]) => {
      let x = x0 * mirror, y = y0;
      for (let i = 0; i < turn; i += 1) [x, y] = [-y, x];
      return [x + 17000, y - 9000];
    }));
    const input = makeDraft(transformed), before = JSON.stringify(input);
    const output = node(input), floor = output.floors[0];
    assert.equal(JSON.stringify(input), before);
    assert.equal(floor.walls.length, 4);
    assertNoded(floorPaths(floor));
    for (const source of input.floors[0].walls) {
      const children = floor.walls.filter(w => w.topologySourceWallId === source.id);
      assert.equal(children.reduce((sum, w) => sum + w.rawMeasuredLengthMm, 0), source.rawMeasuredLengthMm);
      children.forEach(w => assert.equal(w.lengthMm, w.rawMeasuredLengthMm + w.closureAdjustmentMm));
    }
    const saved = layout.createFormalSurveyLayout(output, 'draft');
    const restored = layout.parseFormalSurveyLayout(JSON.stringify(saved)).surveyGraph;
    assert.deepEqual(graph.validateSurveyDraft(restored, { mode: 'full' }).errors, []);
    assert.equal(JSON.stringify(node(output).floors), JSON.stringify(output.floors));
  }
});

test('S4-B distinct adjacent pixels retain their 1mm fragment', () => {
  const output = node(makeDraft([[[0, 0], [6000, 0]], [[3000, -2000], [3000, 2000]],
    [[3001, 0], [3001, 2000]]]));
  assertNoded(floorPaths(output.floors[0]));
  assert.ok(output.floors[0].walls.some(w => w.lengthMm === 1));
});

test('S4-B a bend-induced endpoint pixel is processed in the same plan', () => {
  const source = lines([[[122, 138], [117, 124]], [[131, 169], [39, -123]]]);
  const result = snapRoundSegments(source);
  assert.deepEqual(result.paths[1].points, [[131, 169], [122, 138], [117, 124], [39, -123]].map(point));
  assertNoded(result.paths);
  // The two physical walls collapse to a duplicate fragment; the transaction
  // must reject that ambiguity, not allow a later commit to change its topology.
  const draft = makeDraft(source.map(line => [[line.start.xMm, line.start.yMm], [line.end.xMm, line.end.yMm]]));
  const before = JSON.stringify(draft);
  assert.throws(() => node(draft), { code: 'DUPLICATE_WALL' });
  assert.equal(JSON.stringify(draft), before);
});

test('S4-B fractional host splits preserve safe openings within the 1mm grid and reject protected cuts', () => {
  for (const reverse of [false, true]) for (const conflict of [false, true]) {
    const draft = makeDraft([[[0, 0], [6000, 1]], [[3000, -2000], [3000, 2000]]]);
    const floor = draft.floors[0];
    floor.session.thicknessMm = 100;
    floor.walls[1].thicknessMm = 400;
    floor.openings.push({ id: 'door', wallId: 'w0', type: 'door', widthMm: 600,
      centerOffsetMm: conflict ? 2450 : 4500 });
    if (reverse) floor.walls.reverse();
    const before = JSON.stringify(draft);
    if (conflict) assert.throws(() => node(draft), { code: 'OPENING_SPLIT_CONFLICT' });
    else {
      const result = node(draft).floors[0], opening = result.openings[0];
      const host = graph.getWall(result, opening.wallId);
      const start = graph.getNode(result, host.startNodeId), end = graph.getNode(result, host.endNodeId);
      const t = opening.centerOffsetMm / Math.hypot(end.xMm - start.xMm, end.yMm - start.yMm);
      assert.ok(Math.hypot(start.xMm + t * (end.xMm - start.xMm) - 4500,
        start.yMm + t * (end.yMm - start.yMm) - 0.75) <= 1);
      assert.equal(opening.widthMm, 600);
    }
    assert.equal(JSON.stringify(draft), before);
  }
});

test('S4-B fractional partition forms faces and preserves immutable undo/redo snapshots', () => {
  const draft = makeDraft([[[0, 0], [6000, 1]], [[6000, 1], [6000, 6000]],
    [[6000, 6000], [0, 6000]], [[0, 6000], [0, 0]], [[3000, 1], [3000, 6000]]]);
  const undo = JSON.stringify(draft), result = node(draft);
  assert.equal(result.floors[0].spaces.length, 2);
  assertNoded(floorPaths(result.floors[0]));
  const redo = JSON.stringify(result);
  assert.equal(JSON.stringify(draft), undo);
  assert.deepEqual(graph.validateSurveyDraft(JSON.parse(redo), { mode: 'full' }).errors, []);
  assert.equal(JSON.stringify(node(result).floors), JSON.stringify(result.floors));
});

test('S4-B Mini Program and Admin execute the same fractional arrangement', () => {
  const root = '../../admin/src/lib/survey-runtime/';
  const runtime = {
    graph: require(root + 'surveyWallGraph.js'),
    ...require(root + 'survey/operations/node-intersections.js'),
    ...require(root + 'survey/operations/transaction.js'),
    ...require(root + 'survey/operations/wall-mutation-helpers.js')
  };
  const draft = makeDraft([[[0, 0], [6000, 1]], [[3000, -2000], [3000, 2000]]]);
  const mini = node(draft), admin = node(draft, runtime);
  const signature = value => floorPaths(value.floors[0]).map(path => path.points.map(key).join(':')).sort();
  assert.deepEqual(signature(mini), signature(admin));
  assert.deepEqual(mini.floors[0].walls.map(w => [w.lengthMm, w.rawMeasuredLengthMm, w.closureAdjustmentMm]),
    admin.floors[0].walls.map(w => [w.lengthMm, w.rawMeasuredLengthMm, w.closureAdjustmentMm]));
});

test('S4-B dense integer fragment rounding cannot create an unbounded audit correction', () => {
  const draft = makeDraft([[[0, 0], [200, 200]],
    ...Array.from({ length: 199 }, (_, i) => [[i + 1, -1000], [i + 1, 1000]])]);
  const before = JSON.stringify(draft);
  assert.throws(() => node(draft), { code: 'MEASUREMENT_ADJUSTMENT_BUDGET_EXCEEDED' });
  assert.equal(JSON.stringify(draft), before);
});

test('S4-B deterministic small-grid arrangements are fully noded and order independent', () => {
  let seed = 0x54b;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % 41 - 20; };
  for (let sample = 0; sample < 2000; sample += 1) {
    const source = lines(Array.from({ length: 6 }, () => [[random(), random()], [random(), random()]]))
      .filter(line => key(line.start) !== key(line.end));
    const before = JSON.stringify(source), result = snapRoundSegments(source);
    assert.equal(JSON.stringify(source), before);
    if (result.conflict) continue;
    assertNoded(result.paths);
    const edges = result.paths.flatMap(path => path.points.slice(1).map((end, i) => ({
      id: `${path.id}-${i}`, start: path.points[i], end
    })));
    const again = snapRoundSegments(edges);
    // Coincident rounded physical fragments are rejected by the business
    // validator; every unambiguous arrangement must be a fixed point.
    if (!again.conflict) assert.ok(again.paths.every(path => path.points.length === 2));
    const reversed = snapRoundSegments(source.slice().reverse().map(line => ({ ...line, start: line.end, end: line.start })));
    assert.deepEqual(reversed.paths.slice().reverse().map(path => ({ ...path, points: path.points.slice().reverse() })), result.paths);
  }
});
