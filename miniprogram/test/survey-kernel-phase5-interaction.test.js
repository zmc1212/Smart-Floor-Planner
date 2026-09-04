const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const graph = require('../packages/surveying/utils/surveyWallGraph.js');
const legacy = require('../packages/surveying/utils/survey/legacy-kernel.js');
const frozen = require('./fixtures/survey-kernel-phase5/interaction-reference.js');
const frozenIndex = require('./fixtures/survey-kernel-phase5/cursor-index-reference.js');
const admin = require('../../admin/src/lib/survey-runtime/surveyWallGraph.js');
const adminLegacy = require('../../admin/src/lib/survey-runtime/survey/legacy-kernel.js');
const { wrapOperation } = require('../packages/surveying/utils/survey/operations/transaction.js');
const { planPreview } = require('../packages/surveying/utils/survey/interaction/preview.js');
const { planCommitPreview } = require('../packages/surveying/utils/survey/interaction/commit-preview.js');
const { planWallSnap } = require('../packages/surveying/utils/survey/interaction/wall-snap.js');
const { planBearingPreview } = require('../packages/surveying/utils/survey/interaction/direction-lock.js');
const { applyCommitPreviewPlan } = require('../packages/surveying/utils/survey/operations/commit-preview.js');
const machine = require('../packages/surveying/utils/survey/session/state-machine.js');
const sessionCore = require('../packages/surveying/utils/survey/core/session.js');
const snap = require('../packages/surveying/utils/survey/snap/snap-engine.js');
const policy = require('../packages/surveying/utils/survey/snap/candidate-policy.js');
const cursorIndex = require('../packages/surveying/utils/surveyCursorPlacementIndex.js');
const renderer = require('../packages/surveying/utils/surveyCanvasRenderer.js');
const { REPRESENTATIVE_FIXTURES, buildSingleWall } = require('./fixtures/survey-kernel-baseline/representative-fixtures.js');
const { compareSurveyDrafts, formatSurveyDifferences } = require('./helpers/survey-kernel-semantics.js');
const { captureError } = require('./helpers/survey-kernel-differential-harness.js');
const { buildModuleGraph } = require('../scripts/audit-survey-kernel.js');
const { createScenarioCatalog } = require('../../surveying-h5/src/scenarios.js');

const clone = value => structuredClone(value);
const floorOf = draft => graph.getActiveFloor(draft);
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function compare(expected, actual, label) {
  const diff = compareSurveyDrafts(expected, actual);
  assert.ok(diff.equal, label + '\n' + formatSurveyDifferences(diff.differences));
}
const frozenCommit = wrapOperation('commitPreviewLength', frozen.commitPreviewLength, draft => {
  const session = floorOf(draft).session;
  const mode = session.fullValidationAfterClosedSplit ? 'full' : 'quick';
  delete session.fullValidationAfterClosedSplit;
  return { mode, allowPendingClosure: mode === 'full' && session.closeCandidateType === 'partition' };
});
const frozenSnap = wrapOperation('snapCursorToWall', frozen.snapCursorToWall);
function differential(name, reference, candidate, input, args = [], rethrow = false) {
  const before = JSON.stringify({ input, args });
  let expected, actual, expectedError, actualError;
  try { expected = reference(input, ...args); } catch (error) { expectedError = error; }
  assert.equal(JSON.stringify({ input, args }), before, name + ': reference mutation');
  try { actual = candidate(input, ...args); } catch (error) { actualError = error; }
  assert.equal(JSON.stringify({ input, args }), before, name + ': candidate mutation');
  assert.deepEqual(actualError && captureError(actualError), expectedError && captureError(expectedError), name);
  if (actualError) {
    if (rethrow) throw actualError;
    return { error: actualError };
  }
  compare(expected, actual, name);
  return { output: actual };
}

// Independent state contract, including all allowed destinations and every
// disallowed pair. Graph eligibility is exercised by the command tests below.
const states = ['idle', 'cursorPlaced', 'wallPreview', 'awaitingLength', 'wallCommitted',
  'closing', 'mergeClosing', 'spaceClosed', 'wallSelected', 'wallSnapPending', 'remeasureAwaitingInput'];
const contract = {
  PREVIEW_STARTED: [states, ['wallPreview']],
  LENGTH_HELD: [['wallPreview'], ['awaitingLength']],
  DIRECTION_LOCKED: [states, ['awaitingLength']],
  DIRECTION_CLEARED: [['awaitingLength'], ['idle', 'cursorPlaced', 'wallCommitted']],
  ANGLE_PREVIEW_UPDATED: [['wallPreview'], ['awaitingLength']],
  DIAGONAL_REOPENED: [['wallCommitted'], ['awaitingLength']],
  OBJECT_SELECTED: [states, ['wallSelected']],
  WALL_SNAP_STARTED: [states, ['wallSnapPending']],
  CURSOR_PLACED: [states, ['cursorPlaced', 'wallCommitted']],
  CURSOR_RESET: [states, ['cursorPlaced', 'wallCommitted', 'spaceClosed']],
  PENDING_CANCELLED: [states, ['idle', 'cursorPlaced', 'wallCommitted', 'spaceClosed']],
  REMEASURE_STARTED: [states, ['remeasureAwaitingInput']],
  WALL_COMMITTED: [['wallPreview', 'awaitingLength'], ['wallCommitted', 'closing', 'mergeClosing']],
  CLOSURE_CANDIDATE_RESOLVED: [states, ['wallCommitted', 'closing', 'mergeClosing']],
  CLOSURE_COMPLETED: [states, ['spaceClosed']],
  CLOSURE_JOINED: [states, ['closing']],
  OPEN_CHAIN_RESUMED: [states, ['wallCommitted', 'closing', 'mergeClosing']],
  WALL_DELETED: [states, ['idle', 'cursorPlaced', 'wallCommitted', 'spaceClosed', 'wallSelected']],
  REMEASURE_COMPLETED: [states, ['wallCommitted', 'spaceClosed']]
};
for (const [event, [fromStates, toStates]] of Object.entries(contract)) {
  for (const from of fromStates) for (const to of toStates) {
    test(`Phase 5 transition ${event}: ${from} -> ${to}`, () => {
      const input = freeze({ ...sessionCore.createSession(), state: from });
      const expected = { ok: true, from, event, to };
      assert.deepEqual(machine.evaluateSessionTransition(input, event, to), expected);
      assert.deepEqual(machine.evaluateSessionTransition(input, event, to), expected);
      const working = clone(input);
      machine.transitionSessionState(working, event, to);
      assert.deepEqual(working, { ...input, state: to });
    });
  }
}
test('Phase 5 rejects every illegal state/event pair atomically and preserves the historical opening overlay alias', () => {
  assert.deepEqual(Object.keys(machine.SESSION_TRANSITIONS).sort(), Object.keys(contract).sort());
  for (const [event, [fromStates, toStates]] of Object.entries(contract)) {
    for (const from of states.concat('unknown')) for (const to of states.concat('unknown')) {
      if (fromStates.includes(from) && toStates.includes(to)) continue;
      const session = { state: from, previewPoint: { xMm: 13, yMm: 29 } };
      const before = clone(session);
      const result = machine.evaluateSessionTransition(session, event, to);
      assert.equal(result.ok, false);
      assert.equal(result.error.code, 'INVALID_SESSION_TRANSITION');
      assert.throws(() => machine.transitionSessionState(session, event, to), { code: 'INVALID_SESSION_TRANSITION' });
      assert.deepEqual(session, before);
    }
  }
  for (const event of ['unknown', 'constructor', '__proto__']) {
    assert.equal(machine.evaluateSessionTransition({ state: 'idle' }, event, 'idle').ok, false);
  }
  assert.equal(machine.evaluateSessionTransition({ state: 'openingSelected' }, 'OBJECT_SELECTED', 'wallSelected').ok, true);
});

test('Phase 5 groups exactly 42 session fields without changing the flat stored schema or optional absence', () => {
  const { SESSION_FIELD_GROUPS, SESSION_DEFAULTS, OPTIONAL_SESSION_FIELDS, readSessionGroups } = sessionCore;
  assert.deepEqual(Object.keys(SESSION_FIELD_GROUPS), ['preview', 'selection', 'closure', 'measurement', 'viewport']);
  const fields = Object.values(SESSION_FIELD_GROUPS).flat();
  assert.equal(fields.length, 42);
  assert.equal(new Set(fields).size, 42);
  assert.deepEqual(fields.slice().sort(), Object.keys(SESSION_DEFAULTS).concat(OPTIONAL_SESSION_FIELDS).sort());
  const input = sessionCore.createSession();
  input.previewPoint = { xMm: 11, yMm: 22 };
  const groups = readSessionGroups(freeze(input));
  assert.equal(Object.hasOwn(groups.preview, 'bleLockedBearingDeg'), false);
  assert.deepEqual(Object.assign({}, ...Object.values(groups)), input);
  groups.preview.previewPoint.xMm++;
  assert.equal(input.previewPoint.xMm, 11);
});

const samples = REPRESENTATIVE_FIXTURES.map(fixture => ({ id: fixture.id, draft: fixture.build() }));
const commands = {
  setMode: () => [['straight'], ['diagonal'], ['invalid']],
  placeCursor: () => [[{ xMm: 120, yMm: -70 }]],
  placeNewWallChainCursor: () => [[{ xMm: 12500, yMm: 11000 }]],
  startPreview: () => [[{ xMm: 2000, yMm: 2000 }]],
  startPreviewFromBearing: () => [[90], [0, { stubLengthMm: 2700 }], [45]],
  lockPreviewBearing: () => [[-90], [360], [45], [NaN]],
  clearBleLockedBearing: () => [[]], materializeLockedPreview: () => [[]], holdPreviewForInput: () => [[]],
  applyPreviewInteriorAngle: () => [[90, 'manual'], [0], [270]],
  reopenLastDiagonalWallForAngle: () => [[]], cancelPending: () => [[]],
  selectWall: f => [[f.walls[0]?.id || 'missing'], ['missing']],
  selectOpening: f => [[f.openings[0]?.id || 'missing'], ['missing']],
  selectSpace: f => [[f.spaces[0]?.id || 'missing'], ['missing']],
  startWallSnap: () => [[]], startRemeasure: () => [[]],
  setFixedNode: f => [[f.nodes[0]?.id || '']], resetCursor: () => [[]],
  updateViewport: () => [[{ scale: 0.2, offsetX: 100, offsetY: -50, rotationRad: 1.5 }], [{}]]
};
for (const [name, makeArgs] of Object.entries(commands)) {
  test(`Phase 5 frozen ${name}: both clients, every state, repeat, no-op/error and snapshot undo/redo`, () => {
    for (const { id, draft } of samples) for (const state of states) {
      const input = clone(draft);
      const floor = floorOf(input);
      floor.session.state = state;
      floor.session.selectedWallId = floor.walls[0]?.id || '';
      if (state === 'awaitingLength') floor.session.bleLockedBearingDeg = 90;
      for (const args of makeArgs(floor)) {
        for (const candidate of [graph, legacy, admin, adminLegacy]) {
          const label = `${id}/${state}/${name}`;
          const first = differential(label, frozen[name], candidate[name], freeze(input), freeze(args));
          const again = differential(label, frozen[name], candidate[name], input, args);
          if (!first.output) continue;
          compare(first.output, again.output, label + '/repeat');
          differential(label + '/next', frozen[name], candidate[name], first.output, args);
          const history = [clone(input), clone(first.output)];
          compare(history[0], input, label + '/undo');
          compare(history[1], again.output, label + '/redo');
        }
      }
    }
  });
}

let matrixPreviews = 0, matrixCommits = 0;
const observedPlans = new Map();
function checked(name, reference, candidate) {
  return (input, ...args) => {
    if (name === 'startPreview') matrixPreviews++;
    if (name === 'commitPreviewLength') {
      matrixCommits++;
      try {
        const plan = planCommitPreview(floorOf(input), ...args);
        const key = plan.kind === 'retract-wall' ? plan.kind :
          plan.shortenLastWall ? 'shorten' : plan.extendLastWall ? 'extend' :
            plan.partitionProjection ? 'partition' : plan.outerFaceProjection ? 'outer' :
              plan.sharedProjection ? 'shared' : 'new';
        if (!observedPlans.has(key)) observedPlans.set(key, { input: clone(input), args: clone(args) });
      } catch { /* A rejected planner is still compared at the public boundary. */ }
    }
    return differential(name, reference, candidate, input, args, true).output;
  };
}
const checkedGraph = { ...graph,
  startPreview: checked('startPreview', frozen.startPreview, graph.startPreview),
  commitPreviewLength: checked('commitPreviewLength', frozenCommit, graph.commitPreviewLength),
  snapCursorToWall: checked('snapCursorToWall', frozenSnap, graph.snapCursorToWall)
};
// Keep all geometry, opening, full-validator and Canvas assertions in the 4,096
// scenario matrix, while comparing each preview/commit/snap against frozen code.
const matrixFile = path.join(__dirname, 'survey-closure-scenario-matrix.test.js');
const matrixRequire = createRequire(matrixFile);
vm.runInNewContext(fs.readFileSync(matrixFile, 'utf8'), {
  require(request) {
    if (request === 'node:test') return (name, run) => test('Phase 5 frozen matrix: ' + name, run);
    if (request.endsWith('/surveyWallGraph.js')) return checkedGraph;
    return matrixRequire(request);
  }
}, { filename: matrixFile });

test('Phase 5 H5 catalog and measured confirmation plans preserve deterministic values, audit and transaction atomicity', () => {
  createScenarioCatalog(checkedGraph).forEach(scenario => scenario.build());
  const single = buildSingleWall();
  checkedGraph.commitPreviewLength(checkedGraph.startPreview(single, { xMm: 5400, yMm: 0 }), 1200, 'manual');
  checkedGraph.commitPreviewLength(checkedGraph.startPreview(single, { xMm: 3500, yMm: 0 }), 700, 'manual');
  const corner = checkedGraph.commitPreviewLength(checkedGraph.startPreview(single, { xMm: 4200, yMm: 2400 }), 2400, 'manual');
  checkedGraph.commitPreviewLength(checkedGraph.startPreview(corner, { xMm: 4200, yMm: 0 }), 2400, 'manual');
  assert.ok(matrixPreviews > 4096);
  assert.ok(matrixCommits > 4096);
  for (const key of ['new', 'extend', 'shorten', 'retract-wall', 'partition', 'outer', 'shared']) assert.ok(observedPlans.has(key), key);
  for (const { input, args } of observedPlans.values()) {
    freeze(input); freeze(args);
    const before = JSON.stringify(input);
    const OriginalDate = global.Date;
    let plan;
    try {
      global.Date = class ForbiddenDate { constructor() { throw Error('planner reads clock'); } static now() { throw Error('planner reads clock'); } };
      plan = planCommitPreview(floorOf(input), ...args);
      assert.deepEqual(plan, planCommitPreview(floorOf(input), ...args));
    } finally { global.Date = OriginalDate; }
    assert.equal(JSON.stringify(input), before);
    assert.doesNotMatch(JSON.stringify(plan), /createdAt|measuredAt|floorAfter|surveyGraph/);
    freeze(plan);
    compare(applyCommitPreviewPlan(clone(input), plan), applyCommitPreviewPlan(clone(input), plan), 'plan replay');
    assert.throws(() => applyCommitPreviewPlan(clone(input), { ...plan, floorId: 'wrong' }), TypeError);
    for (const candidate of [graph, admin]) differential('commit/both', frozenCommit, candidate.commitPreviewLength, input, args);
  }
  const input = buildSingleWall();
  const direction = graph.lockPreviewBearing(input, 90);
  const preview = graph.materializeLockedPreview(direction);
  for (const candidate of [graph, admin]) {
    differential('direction commit', frozenCommit, candidate.commitPreviewLength, direction, [2500, 'ble']);
    const bad = clone(preview);
    floorOf(bad).session.fixedNodeId = 'missing-node';
    const history = [clone(input), clone(bad)];
    const before = JSON.stringify({ bad, history });
    differential('late invariant failure', frozenCommit, candidate.commitPreviewLength, bad, [2500, 'manual']);
    assert.throws(() => candidate.commitPreviewLength(bad, 2500, 'manual'), { code: 'MISSING_SESSION_NODE' });
    assert.equal(JSON.stringify({ bad, history }), before);
  }
});

test('Phase 5 preview, bearing and wall-snap planners do not mutate or alias frozen geometry/session', () => {
  const empty = graph.createSurveyDraft();
  assert.deepEqual(planPreview(freeze(floorOf(empty)), { xMm: 4.5, yMm: 8.2 }),
    { kind: 'place-preview-anchor', point: { xMm: 5, yMm: 8 } });
  for (const { draft } of samples) {
    const floor = freeze(floorOf(draft));
    const before = JSON.stringify(floor);
    for (const point of [{ xMm: 130, yMm: 70 }, { xMm: 5800, yMm: 3900 }, { xMm: 9100, yMm: -220 }]) {
      const plan = planPreview(floor, point);
      assert.deepEqual(plan, planPreview(floor, point));
      const target = snap.getCursorPlacementTarget(floor, point, 350);
      const snapPlan = planWallSnap(floor, point, target);
      assert.deepEqual(snapPlan, planWallSnap(floor, point, target));
      if (plan.session?.previewPoint) plan.session.previewPoint.xMm++;
      if (snapPlan.projection?.point) snapPlan.projection.point.xMm++;
      assert.equal(JSON.stringify(floor), before);
    }
  }
  const floor = freeze(floorOf(graph.placeCursor(graph.createSurveyDraft(), { xMm: 0, yMm: 0 })));
  for (const bearing of [0, 90, 180, 270]) {
    assert.deepEqual(planBearingPreview(floor, bearing), planBearingPreview(floor, bearing));
  }
});

test('Phase 5 snap policy preserves frozen graph/index priority and pixel acquire/release boundaries', () => {
  assert.equal(policy.preferOuterVertex({ distanceMm: 180 }, { distanceMm: 81 }, 200), false);
  assert.equal(policy.preferOuterVertex({ distanceMm: 180 }, { distanceMm: 80 }, 200), true);
  assert.equal(policy.preferOuterProjection({ distanceMm: 200 }, { snapLine: 'outer', distanceMm: 1 }, 350, 200), false);
  assert.equal(policy.preferOuterProjection({ distanceMm: 201 }, { snapLine: 'outer', distanceMm: 1 }, 350, 200), true);
  assert.deepEqual(['vertex', 'wall', 'alignment', 'free'].map(type => policy.targetPriority({ type })), [3, 2, 1, 0]);
  for (const { draft } of samples) {
    const floor = floorOf(draft);
    const scene = renderer.createSurveyRenderScene({ floor, session: floor.session,
      viewport: { scale: 0.1, offsetX: 0, offsetY: 0 }, rect: { width: 1000, height: 800 } });
    const index = cursorIndex.createCursorPlacementIndex({ floor, scene });
    const oldIndex = frozenIndex.createCursorPlacementIndex({ floor, scene });
    for (const node of floor.nodes) for (const dx of [-351, -200, -80, 0, 80, 200, 351]) {
      const point = { xMm: node.xMm + dx, yMm: node.yMm + dx / 2 };
      for (const tolerance of [0, 80, 200, 350]) {
        assert.deepEqual(snap.getCursorPlacementTarget(floor, point, tolerance), frozen.getCursorPlacementTarget(floor, point, tolerance));
        const target = cursorIndex.resolveCursorPlacementTarget(index, point, tolerance);
        assert.deepEqual(target, frozenIndex.resolveCursorPlacementTarget(oldIndex, point, tolerance));
        assert.deepEqual(cursorIndex.resolveCursorPlacementLock(index, point, target, 350, 200),
          frozenIndex.resolveCursorPlacementLock(oldIndex, point, target, 350, 200));
      }
    }
  }
  for (const scale of [0.02, 0.1, 1]) {
    const candidate = { type: 'vertex', pointMm: { xMm: 0, yMm: 0 } };
    const acquired = snap.resolveSnap({ scale, candidate, rawPointMm: { xMm: snap.SNAP_ACQUIRE_PX / scale, yMm: 0 } });
    assert.equal(acquired.acquired, true);
    assert.equal(snap.resolveSnap({ scale, candidate, rawPointMm: { xMm: snap.SNAP_ACQUIRE_PX / scale + 1, yMm: 0 } }).acquired, false);
    assert.equal(snap.resolveSnap({ scale, previousLock: acquired.lock, rawPointMm: { xMm: snap.SNAP_RELEASE_PX / scale, yMm: 0 } }).retained, true);
    assert.equal(snap.resolveSnap({ scale, previousLock: acquired.lock, rawPointMm: { xMm: snap.SNAP_RELEASE_PX / scale + 1, yMm: 0 } }).lock, null);
  }
});

test('Phase 5 architecture keeps interaction read-only and all operation dependencies kernel/client-free in both runtimes', () => {
  const root = path.resolve(__dirname, '../..');
  const moduleGraph = buildModuleGraph();
  const entries = moduleGraph.nodes.filter(node => /\/(interaction|session|snap)\//.test(node.file));
  const visited = new Set();
  function visit(file, stack) {
    assert.ok(!stack.includes(file), 'cycle: ' + [...stack, file].join(' -> '));
    assert.doesNotMatch(file, /\/operations\/|legacy-kernel|surveyWallGraph|surveying-editor|bluetooth|runtime-id/);
    if (visited.has(file)) return;
    visited.add(file);
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(source, /\bwx\s*\.|\b(?:window|document|globalThis)\s*\./, file);
    moduleGraph.edges.filter(edge => edge.from === file).forEach(edge => visit(edge.to, stack.concat(file)));
  }
  entries.forEach(entry => visit(entry.file, []));
  for (const entry of entries.filter(entry => entry.file.includes('/interaction/'))) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, entry.file), 'utf8'), /\b(?:touchDraft|addNode|splitWallAtNodes|runSurveyTransaction|nextId)\s*\(/);
  }
  execFileSync(process.execPath, ['-e', `
    const Module = require('node:module');
    const load = Module._load;
    Module._load = function(request, ...args) {
      if (/legacy-kernel|surveyWallGraph|surveying-editor|bluetooth/.test(request)) throw Error(request);
      return load.call(this, request, ...args);
    };
    for (const root of ['miniprogram/packages/surveying/utils/survey', 'admin/src/lib/survey-runtime/survey']) {
      const { createSurveyDraft } = require('./' + root + '/core/draft.js');
      const actions = require('./' + root + '/operations/interaction-operations.js');
      const walls = require('./' + root + '/operations/wall-operations.js').createWallOperations();
      let draft = actions.placeCursor(createSurveyDraft(), { xMm: 0, yMm: 0 });
      draft = actions.lockPreviewBearing(draft, 90);
      draft = walls.commitPreviewLength(draft, 2400, 'ble');
      if (draft.floors[0].walls.length !== 1) throw Error('No wall');
    }
  `], { cwd: root, stdio: 'pipe' });
});
