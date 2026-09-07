const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const facade = require('../packages/surveying/utils/surveyWallGraph.js');
const legacy = require('../packages/surveying/utils/survey/legacy-kernel.js');
const frozen = require('./fixtures/survey-kernel-phase4d/closure-reference.js');
const adminFacade = require('../../admin/src/lib/survey-runtime/surveyWallGraph.js');
const adminLegacy = require('../../admin/src/lib/survey-runtime/survey/legacy-kernel.js');
const closure = require('../packages/surveying/utils/survey/operations/closure.js');
const plans = require('../packages/surveying/utils/survey/topology/closure-plans.js');
const candidates = require('../packages/surveying/utils/survey/topology/closure-candidates.js');
const { applyClosureCandidatePlan } = require('../packages/surveying/utils/survey/operations/closure-candidate.js');
const { wrapOperation } = require('../packages/surveying/utils/survey/operations/transaction.js');
const { buildModuleGraph } = require('../scripts/audit-survey-kernel.js');
const { createScenarioCatalog } = require('../../surveying-h5/src/scenarios.js');
const { captureReadModels } = require('./fixtures/survey-kernel-baseline/capture.js');
const { assertSurveyKernelDifferential, captureError } = require('./helpers/survey-kernel-differential-harness.js');
const { compareSurveyDrafts, formatSurveyDifferences } = require('./helpers/survey-kernel-semantics.js');

const clone = value => structuredClone(value);
const floorOf = draft => facade.getActiveFloor(draft);
const side = implementation => ({ implementation, validateSurveyDraft: facade.validateSurveyDraft, captureReadModels });
const frozenConfirm = wrapOperation('confirmClosure', frozen.confirmClosure, { mode: 'full' });
// The historical commit body is compared under the explicitly approved P0
// transaction postcondition; independent P0 tests verify that postcondition.
const { finalizeCommittedTopology } = require('../packages/surveying/utils/survey/operations/finalize-commit.js');
const { adaptLegacySurveyOperation } = require('../packages/surveying/utils/survey/compat/legacy-error-messages.js');
const frozenCommit = wrapOperation('commitPreviewLength', adaptLegacySurveyOperation((draft, ...args) => {
  const previousCount = floorOf(draft).spaces.filter(space => space.closed).length;
  return finalizeCommittedTopology(frozen.commitPreviewLength(draft, ...args), previousCount);
}), { mode: 'full' });
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function compare(expected, actual, label) {
  const result = compareSurveyDrafts(expected, actual);
  assert.ok(result.equal, label + '\n' + formatSurveyDifferences(result.differences));
}
const samples = new Map();
const outcomes = new Map();
let closureComparisons = 0;
function differentialCall(name, reference, candidate, input, args = []) {
  const before = JSON.stringify(input);
  let expected, actual, expectedError, actualError;
  try { expected = reference(input, ...args); } catch (error) { expectedError = error; }
  assert.equal(JSON.stringify(input), before, name + ': frozen input mutation');
  try { actual = candidate(input, ...args); } catch (error) { actualError = error; }
  assert.equal(JSON.stringify(input), before, name + ': candidate input mutation');
  if (name === 'confirmClosure' && expectedError && expectedError.code === 'ZERO_LENGTH_WALL' && !actualError) {
    // P0 explicitly fixes retracting a noded outer-face tail. Keep the frozen
    // failure as evidence, then check the replacement's independent invariants.
    const oldFloor = floorOf(input), nextFloor = floorOf(actual);
    const tail = oldFloor.walls.at(-1);
    assert.ok(tail.topologySourceWallId);
    assert.ok(!oldFloor.spaces.some(space => space.wallIds.includes(tail.id)));
    assert.ok(!nextFloor.walls.some(wall => wall.id === tail.id));
    assert.equal(nextFloor.walls.reduce((sum, wall) => sum + (wall.rawMeasuredLengthMm || 0), 0),
      oldFloor.walls.reduce((sum, wall) => sum + (wall.rawMeasuredLengthMm || 0), 0));
    assert.deepEqual(facade.validateSurveyDraft(actual, { mode: 'full' }).errors, []);
    return actual;
  }
  assert.deepEqual(actualError && captureError(actualError), expectedError && captureError(expectedError), name);
  if (actualError) throw actualError;
  compare(expected, actual, name);
  return actual;
}
function checkedConfirm(input) {
  closureComparisons++;
  try {
    const plan = plans.planConfirmClosure(input);
    if (!samples.has(plan.type)) samples.set(plan.type, clone(input));
  } catch { /* Rejected plans are checked against the frozen operation below. */ }
  try {
    const output = differentialCall('confirmClosure', frozenConfirm, facade.confirmClosure, input);
    outcomes.set('success', (outcomes.get('success') || 0) + 1);
    return output;
  } catch (error) {
    if (error.name === 'AssertionError') throw error;
    outcomes.set(error.code, (outcomes.get(error.code) || 0) + 1);
    throw error;
  }
}

// Reuse all 4,096 formal cases, keeping their geometric/renderer assertions.
// Interception changes only the operation under test, not the scenario source
// or require cache. The old function bodies are a checked-in Phase 4C fixture.
const matrixFile = path.join(__dirname, 'survey-closure-scenario-matrix.test.js');
const matrixRequire = createRequire(matrixFile);
vm.runInNewContext(fs.readFileSync(matrixFile, 'utf8'), {
  require(request) {
    if (request === 'node:test') return (name, run) => test('Phase 4D frozen matrix: ' + name, run);
    if (request.endsWith('/surveyWallGraph.js')) return { ...facade, confirmClosure: checkedConfirm };
    return matrixRequire(request);
  }
}, { filename: matrixFile });

test('Phase 4D H5 catalog preserves preview and commit candidates against frozen bodies', () => {
  let comparisons = 0;
  const graph = {
    ...facade,
    startPreview(input, ...args) {
      comparisons++;
      return differentialCall('startPreview', frozen.startPreview, facade.startPreview, input, args);
    },
    commitPreviewLength(input, ...args) {
      comparisons++;
      return differentialCall('commitPreviewLength', frozenCommit, facade.commitPreviewLength, input, args);
    },
    confirmClosure: checkedConfirm
  };
  const catalog = createScenarioCatalog(graph);
  for (const scenario of catalog) scenario.build();
  assert.ok(catalog.length >= 30);
  assert.ok(comparisons >= 200);
  assert.ok(closureComparisons >= 4096);
  assert.ok(outcomes.get('OPENING_SPLIT_CONFLICT') > 0);
  assert.ok(outcomes.get('success') > 0);
  // Exact partitions now finish inside commit; the matrix checks both child rooms.
  for (const type of ['preview', 'direct', 'merge']) assert.ok(samples.has(type), type);
});

test('Phase 4D closure plans are clock-free, deterministic and do not normalize or alias input', () => {
  samples.set('noop', facade.createSurveyDraft());
  for (const input of samples.values()) {
    const draft = clone(input);
    delete floorOf(draft).session.previewMeasurementSide;
    freeze(draft);
    const before = JSON.stringify(draft);
    const OriginalDate = global.Date;
    let first, second;
    try {
      global.Date = class ForbiddenDate { constructor() { throw Error('planner read clock'); } static now() { throw Error('planner read clock'); } };
      first = plans.planConfirmClosure(draft);
      second = plans.planConfirmClosure(draft);
    } finally { global.Date = OriginalDate; }
    assert.deepEqual(first, second);
    assert.equal(JSON.stringify(draft), before);
    assert.doesNotMatch(JSON.stringify(first), /floorAfter|createdAt|measuredAt/);
    if (first.type !== 'preview') {
      freeze(first);
      const left = clone(input), right = clone(input);
      closure.applyClosurePlan(left, first);
      closure.applyClosurePlan(right, first);
      compare(left, right, first.type);
      assert.throws(() => closure.applyClosurePlan(clone(input), { ...first, floorId: 'wrong' }), TypeError);
    }
  }
});

test('Phase 4D candidate patches are pure values and apply without retaining plan aliases', () => {
  const draft = samples.get('direct');
  const floor = floorOf(draft), session = floor.session;
  const start = facade.getNode(floor, session.activeSpaceStartNodeId) || floor.nodes[0];
  const end = facade.getNode(floor, session.anchorNodeId);
  const projection = { wall: floor.walls[0], point: { xMm: 100, yMm: 0 }, sourceSpace: { id: 'source-room' } };
  const context = freeze({
    activeStartNode: start, endNode: end, anchor: end, previewPoint: start,
    activeWallCount: 3, directCloseWallCount: 3, inferredMergeWallCount: 3,
    minimumMergeWallCount: 3, sharedProjection: projection
  });
  freeze(draft);
  for (const planner of [candidates.planPreviewClosureCandidate, candidates.planCommittedClosureCandidate]) {
    const before = JSON.stringify({ draft, context });
    const plan = freeze(planner(floor, session, context));
    assert.deepEqual(plan, planner(floor, session, context));
    assert.equal(JSON.stringify({ draft, context }), before);
    const target = clone(session);
    applyClosureCandidatePlan(target, plan);
    target.closeCandidatePoint.xMm++;
    assert.equal(plan.sessionPatch.closeCandidatePoint.xMm, 100);
  }
});

test('Phase 4D bridge intentions preserve axis snap, bridge and tolerance rejection', () => {
  const floor = { nodes: [
    { id: 'a', xMm: 0, yMm: 0 }, { id: 'b', xMm: 1000, yMm: 0 },
    { id: 'c', xMm: 1000, yMm: 10 }, { id: 'd', xMm: 990, yMm: 10 }
  ] };
  const wall = { id: 'ab', startNodeId: 'a', endNodeId: 'b', mode: 'straight' };
  freeze(floor); freeze(wall);
  assert.equal(plans.planClosureBridge(floor, wall, floor.nodes[1]).kind, 'noop');
  assert.equal(plans.planClosureBridge(floor, wall, floor.nodes[0]).kind, 'snap');
  assert.equal(plans.planClosureBridge(floor, wall, floor.nodes[2]).kind, 'bridge');
  assert.throws(() => plans.planClosureBridge(floor, wall, floor.nodes[3]), { code: 'CLOSURE_OUT_OF_TOLERANCE' });
});

test('Phase 4D frozen differential covers both clients, repeat and snapshot undo/redo', () => {
  for (const [type, input] of samples) {
    for (const implementation of [facade, adminFacade, legacy, adminLegacy]) {
      const reference = implementation === legacy || implementation === adminLegacy ? frozen : frozenConfirm;
      assertSurveyKernelDifferential({
        caseId: type, operationName: 'confirmClosure', input,
        legacy: side(reference), candidate: side(implementation)
      });
    }
    const before = JSON.stringify(input);
    const output = facade.confirmClosure(input);
    if (type !== 'preview') {
      compare(output, closure.createClosureOperations().confirmClosure(input), type + '-without-preview-callback');
    }
    const history = { undo: [clone(input)], redo: [clone(output)] };
    compare(input, history.undo.pop(), 'undo');
    compare(output, history.redo.pop(), 'redo');
    assert.equal(JSON.stringify(input), before);
    assertSurveyKernelDifferential({
      caseId: type + '-repeat-on-output', operationName: 'confirmClosure', input: output,
      legacy: side(frozenConfirm), candidate: side(facade)
    });
  }
});

test('Phase 4D late full-validation failure rolls back graph, session and caller history', () => {
  const input = clone(samples.get('direct'));
  floorOf(input).session.fixedNodeId = 'missing-node';
  const history = [clone(input)];
  const before = JSON.stringify({ input, history });
  assertSurveyKernelDifferential({
    caseId: 'late-invariant', operationName: 'confirmClosure', input, expectedOutcome: 'error',
    legacy: side(frozenConfirm), candidate: side(facade)
  });
  assert.throws(() => facade.confirmClosure(input), error => error.name === 'SurveyInvariantError');
  assert.equal(JSON.stringify({ input, history }), before);
});

test('Phase 4D closure dependency closure is acyclic, client-free and cannot load the kernel', () => {
  const root = path.resolve(__dirname, '../..');
  const graph = buildModuleGraph();
  const visited = new Set();
  function visit(file, stack = []) {
    assert.ok(!stack.includes(file), 'cycle: ' + [...stack, file].join(' -> '));
    assert.doesNotMatch(file, /legacy-kernel|surveyWallGraph|surveying-editor|bluetooth/);
    if (visited.has(file)) return;
    visited.add(file);
    assert.doesNotMatch(fs.readFileSync(path.join(root, file), 'utf8'), /\bwx\s*\.|\b(?:window|document|globalThis)\s*\./);
    graph.edges.filter(edge => edge.from === file).forEach(edge => visit(edge.to, [...stack, file]));
  }
  for (const entry of ['operations/closure.js', 'topology/closure-candidates.js', 'topology/closure-plans.js']) {
    visit('miniprogram/packages/surveying/utils/survey/' + entry);
  }
  assert.ok([...visited].some(file => file.endsWith('/transaction.js')));
  execFileSync(process.execPath, ['-e', [
    "const Module = require('node:module'); const load = Module._load;",
    "Module._load = function(request, ...args) { if (/legacy-kernel|surveyWallGraph|surveying-editor|bluetooth/.test(request)) throw Error(request); return load.call(this, request, ...args); };",
    "for (const root of ['./miniprogram/packages/surveying/utils/', './admin/src/lib/survey-runtime/']) {",
    "const closure = require(root + 'survey/operations/closure.js');",
    "const draft = require(root + 'survey/core/draft.js').createSurveyDraft();",
    "closure.createClosureOperations().confirmClosure(draft); }"
  ].join('\n')], { cwd: root, stdio: 'pipe' });
});
