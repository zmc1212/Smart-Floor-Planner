const test = require('node:test');
const assert = require('node:assert/strict');
const reference = require('./fixtures/survey-kernel-phase3/read-model-reference.js');
const referenceFaces = require('./fixtures/survey-kernel-phase3/wall-faces-reference.js');
const baseline = require('./fixtures/survey-kernel-baseline/expected-behavior.json');
const mini = require('../packages/surveying/utils/surveyWallGraph.js');
const admin = require('../../admin/src/lib/survey-runtime/surveyWallGraph.js');
const miniFaces = require('../packages/surveying/utils/survey/read-model/wall-faces.js');
const adminFaces = require('../../admin/src/lib/survey-runtime/survey/read-model/wall-faces.js');
const miniWalls = require('../packages/surveying/utils/survey/read-model/wall-geometry.js');
const adminWalls = require('../../admin/src/lib/survey-runtime/survey/read-model/wall-geometry.js');
const miniBoundary = require('../packages/surveying/utils/survey/read-model/space-boundary.js');
const adminBoundary = require('../../admin/src/lib/survey-runtime/survey/read-model/space-boundary.js');
const miniDimensions = require('../packages/surveying/utils/survey/read-model/space-dimensions.js');
const adminDimensions = require('../../admin/src/lib/survey-runtime/survey/read-model/space-dimensions.js');
const miniTopology = require('../packages/surveying/utils/survey/topology/closed-boundary.js');
const adminTopology = require('../../admin/src/lib/survey-runtime/survey/topology/closed-boundary.js');

const clone = (value) => structuredClone(value);

// A proxy catches writes even inside non-strict CommonJS code, where a frozen
// object's assignment could fail silently. Returned node/wall references stay
// allowed: the compatibility contract promises reads, not detached copies.
function readOnly(value, cache = new WeakMap()) {
  if (!value || typeof value !== 'object') return value;
  if (cache.has(value)) return cache.get(value);
  const reject = () => { throw new Error('Read-model attempted an input write'); };
  const proxy = new Proxy(value, {
    get(target, key) { return readOnly(Reflect.get(target, key), cache); },
    set: reject,
    deleteProperty: reject,
    defineProperty: reject,
    setPrototypeOf: reject,
    preventExtensions: reject
  });
  cache.set(value, proxy);
  return proxy;
}

function outcome(fn, args) {
  try {
    return { value: fn(...args) };
  } catch (error) {
    return { error: { name: error.name, message: error.message, code: error.code } };
  }
}

function compareCall(name, args, implementations, label) {
  const expectedArgs = clone(args);
  const expectedBefore = clone(expectedArgs);
  const expected = outcome((reference[name] || referenceFaces[name]), readOnly(expectedArgs));
  assert.deepEqual(expectedArgs, expectedBefore, `${label}: reference mutated input`);
  for (const [runtime, implementation] of implementations) {
    assert.equal(typeof implementation[name], 'function', `${runtime}.${name}`);
    const actualArgs = clone(args);
    const before = clone(actualArgs);
    const guarded = readOnly(actualArgs);
    const actual = outcome(implementation[name], guarded);
    assert.deepEqual(actual, expected, `${label}: ${runtime}.${name}`);
    assert.deepEqual(outcome(implementation[name], guarded), actual, `${label}: repeat ${runtime}.${name}`);
    assert.deepEqual(actualArgs, before, `${label}: ${runtime} mutated input`);
  }
}

function callsForDraft(draft) {
  const floor = draft.floors[0];
  const calls = [];
  const add = (name, ...args) => calls.push({ name, args });
  const thicknessMap = Object.fromEntries(floor.walls.map((wall, index) => [wall.id, 60 + index * 47]));
  add('buildWallJoinRenderGeometries', floor);
  add('buildWallJoinRenderGeometries', floor, { renderThicknessMmMap: thicknessMap });
  floor.walls.forEach((wall) => {
    const start = floor.nodes.find((node) => node.id === wall.startNodeId);
    const end = floor.nodes.find((node) => node.id === wall.endNodeId);
    add('buildWallSnapGeometry', floor, wall);
    for (const options of [undefined, { renderThicknessMm: 30 }, { renderThicknessMm: 700 },
      { renderThicknessMm: 900, renderThicknessMmMap: thicknessMap },
      { previousWall: null, nextWall: null },
      { previousWall: floor.walls.at(-1), nextWall: floor.walls[0], renderThicknessMmMap: thicknessMap }]) {
      add('buildWallRenderGeometry', floor, wall, options);
    }
    for (const centroid of [null, { xMm: 1800.5, yMm: 2300.25 }]) {
      add('projectWallFaces', wall, start, end, wall.thicknessMm, centroid);
      add('resolveBodyNormal', wall, start, end, centroid);
    }
    add('wallFrame', start, end);
    add('projectWorkingFace', wall, start, end);
    add('measuredReadingMm', 4267.8, wall);
    add('intersectWorkingLines', { start, end }, { start: { xMm: 500, yMm: -500 }, end: { xMm: 500, yMm: 900 } });
  });
  floor.spaces.forEach((space) => {
    add('buildSpaceBoundaryPoints', floor, space.wallIds);
    add('buildSpaceBoundaryPoints', floor, [...space.wallIds].reverse());
    const overrides = Object.fromEntries(space.wallIds.map((id, index) => [id, index % 2 ? 'offset' : 'topology']));
    for (const input of [space.wallIds, space, { ...space, wallFaceOverrides: overrides }]) {
      add('buildSpaceInnerBoundaryPoints', floor, input);
      add('buildSpaceRenderBoundaryPoints', floor, input);
      add('buildSpaceDimensionPlan', floor, input);
    }
    add('calculateSpaceAreaMm2', draft, space.id);
  });
  for (const input of [undefined, [], ['missing-wall'], floor.walls.slice(0, 2).map((wall) => wall.id)]) {
    add('buildSpaceBoundaryPoints', floor, input);
    add('buildSpaceInnerBoundaryPoints', floor, input);
    add('buildSpaceRenderBoundaryPoints', floor, input);
    add('buildSpaceDimensionPlan', floor, input);
  }
  add('calculateSpaceAreaMm2', draft);
  add('calculateSpaceAreaMm2', draft, 'missing-space');
  return calls;
}

const publicImplementations = [
  ['Mini Program facade', { ...mini, ...miniFaces }],
  ['Admin facade', { ...admin, ...adminFaces }],
  ['Mini Program standalone', { ...miniWalls, ...miniBoundary, ...miniDimensions, ...miniFaces }],
  ['Admin standalone', { ...adminWalls, ...adminBoundary, ...adminDimensions, ...adminFaces }]
];
const representativeCalls = Object.entries(baseline.fixtures).flatMap(([id, fixture]) => (
  callsForDraft(clone(fixture.draft)).map((call) => ({ ...call, label: id }))
));
const publicNames = [...new Set(representativeCalls.map((call) => call.name))].sort();

for (const name of publicNames) {
  test(`Phase 3 ${name}: frozen outputs, read-only inputs, repeatability and Mini/Admin parity`, () => {
    representativeCalls.filter((call) => call.name === name).forEach((call) => {
      compareCall(name, call.args, publicImplementations, call.label);
    });
  });
}

test('Phase 3 covers all 11 frozen representative graphs and every public read model', () => {
  assert.equal(Object.keys(baseline.fixtures).length, 11);
  assert.equal(publicNames.length, 14);
  assert.ok(representativeCalls.length > 600);
});

test('Phase 3 deterministic geometry variants preserve inset, body-side, face override and join semantics', () => {
  const fixtures = Object.values(baseline.fixtures).filter((entry) => entry.draft.floors[0].walls.length);
  let seed = 0x345678;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let index = 0; index < 48; index += 1) {
    const draft = clone(fixtures[index % fixtures.length].draft);
    const floor = draft.floors[0];
    const radians = random() * Math.PI * 2;
    floor.nodes.forEach((node) => {
      const x = node.xMm;
      const y = node.yMm;
      node.xMm = Math.cos(radians) * x - Math.sin(radians) * y + 17.4;
      node.yMm = Math.sin(radians) * x + Math.cos(radians) * y - 53.7;
    });
    floor.walls.forEach((wall, wallIndex) => {
      wall.thicknessMm = [0, 1, 40, 200, 480][(index + wallIndex) % 5];
      wall.measurementSide = wallIndex % 2 ? 'left' : 'right';
      wall.bodyNormalSide = ['', 'left', 'right'][index % 3];
      wall.measurementStartInsetMm = Math.round(random() * 150);
      wall.measurementEndInsetMm = Math.round(random() * 150);
      wall.measurementStartExtensionMm = Math.round(random() * 150);
      if (index % 2) delete wall.lengthMm;
    });
    callsForDraft(draft).forEach(({ name, args }) => compareCall(name, args, publicImplementations, `seeded-${index}`));
  }
});

test('Phase 3 degenerate and missing inputs preserve null, empty and historical error boundaries', () => {
  const draft = clone(baseline.fixtures['single-wall'].draft);
  const floor = draft.floors[0];
  const wall = floor.walls[0];
  const cases = [
    ['buildWallJoinRenderGeometries', [null]],
    ['buildSpaceDimensionPlan', [null, []]],
    ['calculateSpaceAreaMm2', [{ floors: [] }]],
    ['calculateSpaceAreaMm2', [{}]],
    ['projectWallFaces', [wall, null, null, 200, null]],
    ['wallFrame', [null, null]],
    ['resolveBodyNormal', [wall, null, null, null]],
    ['projectWorkingFace', [wall, null, null]],
    ['intersectWorkingLines', [null, null]],
    ['measuredReadingMm', [0, wall]]
  ];
  for (const variant of ['missing-node', 'zero-length', 'consumed-inset']) {
    const modified = clone(floor);
    if (variant === 'missing-node') modified.nodes.pop();
    if (variant === 'zero-length') Object.assign(modified.nodes[1], { xMm: modified.nodes[0].xMm, yMm: modified.nodes[0].yMm });
    if (variant === 'consumed-inset') Object.assign(modified.walls[0], { measurementStartInsetMm: 8000, measurementEndInsetMm: 8000 });
    cases.push(['buildWallSnapGeometry', [modified, modified.walls[0]]]);
    cases.push(['buildWallRenderGeometry', [modified, modified.walls[0]]]);
  }
  cases.forEach(([name, args]) => compareCall(name, args, publicImplementations, 'degenerate'));
});

test('Phase 3 shared internal read helpers and topology queries stay read-only and match the frozen formulas', () => {
  const implementations = [
    ['Mini Program', { ...miniWalls, ...miniBoundary, ...miniTopology }],
    ['Admin', { ...adminWalls, ...adminBoundary, ...adminTopology }]
  ];
  for (const [id, fixture] of Object.entries(baseline.fixtures)) {
    const floor = clone(fixture.draft.floors[0]);
    floor.walls.forEach((wall) => {
      compareCall('buildBaseWallSegment', [floor, wall], implementations, id);
      compareCall('buildBaseWallSegment', [floor, wall, { renderThicknessMm: 333 }], implementations, id);
      compareCall('buildResolvedSegment', [floor, wall], implementations, id);
      const start = reference.getNode(floor, wall.startNodeId);
      const end = reference.getNode(floor, wall.endNodeId);
      compareCall('resolveClosedBoundaryInsetMm', [floor, start, end, { excludedWallId: wall.id }], implementations, id);
      compareCall('findClosedSpaceForWall', [floor, wall.id], implementations, id);
      compareCall('findClosedSpacesForWall', [floor, wall.id], implementations, id);
    });
    for (const ids of [[], ['missing'], ...floor.spaces.map((space) => space.wallIds)]) {
      compareCall('traceClosedSpaceWallChain', [floor, ids, false], implementations, id);
      compareCall('traceClosedSpaceWallChain', [floor, ids, true], implementations, id);
      compareCall('buildClosedSpaceWallChain', [floor, ids], implementations, id);
      compareCall('calculateBoundaryCentroid', [floor, ids], implementations, id);
      compareCall('buildSpaceWallFaceSegments', [floor, ids], implementations, id);
      const faces = reference.buildSpaceWallFaceSegments(floor, ids);
      for (const keys of [['innerStart', 'innerEnd'], ['oppositeStart', 'oppositeEnd']]) {
        compareCall('buildFaceBoundaryPlan', [faces, ...keys], implementations, id);
        compareCall('buildFaceBoundaryPoints', [faces, ...keys], implementations, id);
      }
    }
  }
});
