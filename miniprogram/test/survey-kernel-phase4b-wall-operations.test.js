const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const baseline = require('./fixtures/survey-kernel-baseline/expected-behavior.json');
const frozen = require('./fixtures/survey-kernel-phase4b/wall-operation-reference.js');
const facade = require('../packages/surveying/utils/surveyWallGraph.js');
const legacy = require('../packages/surveying/utils/survey/legacy-kernel.js');
const adminFacade = require('../../admin/src/lib/survey-runtime/surveyWallGraph.js');
const adminLegacy = require('../../admin/src/lib/survey-runtime/survey/legacy-kernel.js');
const split = require('../packages/surveying/utils/survey/operations/wall-split.js');
const adminSplit = require('../../admin/src/lib/survey-runtime/survey/operations/wall-split.js');
const { wrapOperation } = require('../packages/surveying/utils/survey/operations/transaction.js');
const { syncFloorSpaces } = require('../packages/surveying/utils/survey/operations/wall-mutation-helpers.js');
const { adaptLegacySurveyOperation } = require('../packages/surveying/utils/survey/compat/legacy-error-messages.js');
const { assertSurveyKernelDifferential } = require('./helpers/survey-kernel-differential-harness.js');
const { compareSurveyDrafts, formatSurveyDifferences } = require('./helpers/survey-kernel-semantics.js');
const { buildModuleGraph } = require('../scripts/audit-survey-kernel.js');
const deletion = require('../packages/surveying/utils/survey/operations/wall-deletion.js');
const suggestions = require('../packages/surveying/utils/survey/topology/closure-queries.js');

const clone = value => structuredClone(value);
const fixture = name => clone(baseline.fixtures[name].draft);
const floorOf = draft => facade.getActiveFloor(draft);
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function compare(expected, actual) {
  const result = compareSurveyDrafts(expected, actual);
  assert.ok(result.equal, formatSurveyDifferences(result.differences));
}
function readModels(draft) {
  const floor = floorOf(draft);
  return {
    walls: floor.walls.map(wall => facade.buildWallRenderGeometry(floor, wall)),
    spaces: floor.spaces.filter(space => space.closed).map(space => ({
      boundary: facade.buildSpaceRenderBoundaryPoints(floor, space),
      dimensions: facade.buildSpaceDimensionPlan(floor, space),
      area: facade.calculateSpaceAreaMm2(draft, space.id)
    }))
  };
}
const side = implementation => ({ implementation, validateSurveyDraft: facade.validateSurveyDraft, captureReadModels: readModels });
function splitAdapter(implementation, transactional) {
  const operation = adaptLegacySurveyOperation((draft, wallId, cuts) => {
    const next = facade.cloneDraft(draft);
    implementation.splitWallAtNodes(floorOf(next), wallId, cuts);
    if (transactional) syncFloorSpaces(floorOf(next));
    return next;
  });
  return transactional ? wrapOperation('splitWallAtNodes', operation, { mode: 'full' }) : operation;
}
function addCuts(draft, wallIndex, fractions) {
  const floor = floorOf(draft);
  const wall = floor.walls[wallIndex];
  const start = facade.getNode(floor, wall.startNodeId);
  const end = facade.getNode(floor, wall.endNodeId);
  return fractions.map((t, index) => {
    const id = `cut-${index}`;
    floor.nodes.push({ id, xMm: Math.round(start.xMm + (end.xMm - start.xMm) * t), yMm: Math.round(start.yMm + (end.yMm - start.yMm) * t) });
    return id;
  });
}
function splitCases() {
  const cases = [];
  for (const name of ['single-wall', 'closed-rectangle', 'shared-wall', 'diagonal-wall', 'remeasured-wall']) {
    for (const fractions of [[0.5], [0.75, 0.25, 0.5]]) {
      const draft = fixture(name);
      const index = name === 'shared-wall' ? 1 : 0;
      cases.push({ id: `${name}-${fractions.length}-cuts`, draft, args: [floorOf(draft).walls[index].id, addCuts(draft, index, fractions)], outcome: 'success' });
    }
  }
  for (const cuts of [[], ['missing-node'], ['node-1-1', 'node-1-2']]) {
    cases.push({ id: `no-interior-${JSON.stringify(cuts)}`, draft: fixture('single-wall'), args: ['wall-1-1', cuts], outcome: 'success' });
  }
  cases.push({ id: 'missing-wall', draft: fixture('single-wall'), args: ['missing-wall', []], outcome: 'noop' });
  const duplicate = fixture('closed-rectangle');
  const cuts = addCuts(duplicate, 0, [0.5]);
  cases.push({ id: 'duplicate-cut-ids', draft: duplicate, args: ['wall-1-1', cuts.concat(cuts)], outcome: 'success' });
  for (const center of [800, 1800, 1801, 2600, 3400, 3401, 4400]) {
    const draft = fixture('wall-with-openings');
    const floor = floorOf(draft);
    floor.openings = [{ ...floor.openings[0], wallId: floor.walls[0].id, centerOffsetMm: center, widthMm: 1200 }];
    floor.session.selectedOpeningId = floor.openings[0].id;
    floor.session.thicknessMm = 200;
    cases.push({ id: `opening-clearance-${center}`, draft, args: [floor.walls[0].id, addCuts(draft, 0, [0.5])], outcome: center >= 1800 && center <= 3400 ? 'error' : 'success' });
  }
  const audited = fixture('single-wall');
  Object.assign(floorOf(audited).walls[0], { rawMeasuredLengthMm: 4193, closureAdjustmentMm: 7, adjustmentSource: 'closure-balance' });
  cases.push({ id: 'audited-rounding-tail', draft: audited, args: ['wall-1-1', addCuts(audited, 0, [0.25, 0.5, 0.75])], outcome: 'success' });
  for (const metadata of [{ rawMeasuredLengthMm: 4100 }, { closureAdjustmentMm: 10 }, { rawMeasuredLengthMm: 'invalid', closureAdjustmentMm: 10 }]) {
    const draft = fixture('single-wall');
    Object.assign(floorOf(draft).walls[0], metadata);
    cases.push({ id: `incomplete-audit-${JSON.stringify(metadata)}`, draft, args: ['wall-1-1', addCuts(draft, 0, [0.5])], outcome: 'success' });
  }
  const inset = fixture('wall-with-openings');
  const insetFloor = floorOf(inset);
  Object.assign(insetFloor.walls[0], { measurementStartInsetMm: 200, measurementStartExtensionMm: 100, measurementEndInsetMm: 150, lengthMm: 4950 });
  insetFloor.openings = [{ ...insetFloor.openings[0], wallId: 'wall-1-1', centerOffsetMm: 3900, widthMm: 600 }];
  insetFloor.session.selectedOpeningId = insetFloor.openings[0].id;
  cases.push({ id: 'opening-measurement-origin-insets-extension', draft: inset, args: ['wall-1-1', addCuts(inset, 0, [0.25, 0.5])], outcome: 'success' });
  return cases;
}

for (const c of splitCases()) {
  test(`Phase 4B frozen split matches standalone step and full transaction: ${c.id}`, () => {
    for (const runtime of [split, adminSplit]) {
      for (const transactional of [false, true]) {
        assertSurveyKernelDifferential({
          caseId: c.id, operationName: 'splitWallAtNodes', input: c.draft, args: c.args,
          expectedOutcome: c.outcome,
          legacy: side(splitAdapter(frozen, transactional)),
          candidate: side(transactional ? runtime.splitWall : splitAdapter(runtime, false))
        });
      }
    }
  });
}

test('Phase 4B split plans are read-only and replayable; segment lookup retains both directions', () => {
  const draft = fixture('shared-wall');
  const cuts = addCuts(draft, 1, [0.5]);
  const floor = floorOf(draft);
  freeze(draft);
  const plan = freeze(split.planWallSplit(floor, 'wall-1-2', cuts));
  const first = clone(draft);
  const second = clone(draft);
  const result = split.applyWallSplitPlan(floorOf(first), plan);
  split.applyWallSplitPlan(floorOf(second), plan);
  assert.equal(result.kind, 'split-wall');
  assert.equal(result.changed, true);
  assert.deepEqual(first, second);
  const host = floorOf(first).walls.find(w => w.id === 'wall-1-2');
  assert.equal(result.getSegmentBetween(host.startNodeId, host.endNodeId).wall, host);
  assert.equal(result.getSegmentBetween(host.endNodeId, host.startNodeId).wall, host);
  assert.throws(() => split.applyWallSplitPlan({ ...floorOf(first), id: 'other-floor' }, plan), TypeError);
});

test('Phase 4B split preserves aggregate audit values and safe opening world position', () => {
  const c = splitCases().find(c => c.id === 'audited-rounding-tail');
  const output = split.splitWall(c.draft, ...c.args);
  assert.equal(floorOf(output).walls.reduce((sum, wall) => sum + wall.rawMeasuredLengthMm, 0), 4193);
  assert.equal(floorOf(output).walls.reduce((sum, wall) => sum + wall.closureAdjustmentMm, 0), 7);
  const safe = splitCases().find(c => c.id === 'opening-clearance-4400');
  const after = floorOf(split.splitWall(safe.draft, ...safe.args));
  const opening = after.openings[0];
  const host = facade.getWall(after, opening.wallId);
  assert.equal(facade.getNode(after, host.startNodeId).xMm + opening.centerOffsetMm, 4400);
});

function deletionCases() {
  const cases = [];
  for (const name of Object.keys(baseline.fixtures)) {
    const input = fixture(name);
    const floor = floorOf(input);
    for (const wall of floor.walls) {
      cases.push({ id: `${name}-${wall.id}`, operationName: 'deleteWall', input, args: [wall.id], expectedOutcome: 'success' });
    }
    for (const space of floor.spaces.filter(s => s.closed)) {
      cases.push({ id: `${name}-${space.id}`, operationName: 'deleteClosedSpace', input, args: [space.id], expectedOutcome: 'success' });
    }
  }
  for (const operationName of ['deleteWall', 'deleteClosedSpace']) {
    cases.push({ id: `${operationName}-missing`, operationName, input: fixture('empty-graph'), args: ['missing'], expectedOutcome: 'noop' });
    const input = fixture('wall-with-openings');
    const floor = floorOf(input);
    floor.session.selectedWallId = floor.walls[0].id;
    floor.session.selectedSpaceId = floor.spaces[0].id;
    floor.session.fixedNodeId = floor.walls[0].endNodeId;
    floor.session.lastWallSnapNodeId = floor.walls[0].endNodeId;
    floor.session.lastWallSnapWallId = floor.walls[0].id;
    cases.push({ id: `${operationName}-selection-fallback-and-stale-snap`, operationName, input, args: [''], expectedOutcome: 'success' });
  }
  const input = fixture('shared-wall');
  const cuts = addCuts(input, 1, [0.5]);
  const cutResult = frozen.splitWallAtNodes(floorOf(input), 'wall-1-2', cuts);
  for (const wallId of cutResult.segmentIds) {
    cases.push({ id: `shared-collinear-run-${wallId}`, operationName: 'deleteWall', input, args: [wallId], expectedOutcome: 'success' });
  }
  const { createLargeGridDraft } = require('./fixtures/survey-kernel-baseline/representative-fixtures.js');
  const grid = createLargeGridDraft(3, 3);
  const center = floorOf(grid).spaces[4];
  cases.push({ id: 'shared-only-room-retains-geometry', operationName: 'deleteClosedSpace', input: facade.selectSpace(grid, center.id), args: [center.id], expectedOutcome: 'success' });
  return cases;
}

for (const c of deletionCases()) {
  test(`Phase 4B frozen deletion preserves graph/session/read models: ${c.id}`, () => {
    for (const implementation of [legacy, adminLegacy, facade, adminFacade]) {
      const transactional = implementation === facade || implementation === adminFacade;
      assertSurveyKernelDifferential({
        ...c,
        legacy: side(transactional ? wrapOperation(c.operationName, frozen[c.operationName], { mode: 'full' }) : frozen),
        candidate: side(implementation)
      });
    }
  });
}

test('Phase 4B deletion plans do not normalize input sessions or alias plans into results', () => {
  for (const [planner, apply, id] of [
    [deletion.planDeleteWall, deletion.applyDeleteWallPlan, 'wall-1-2'],
    [deletion.planDeleteClosedSpace, deletion.applyDeleteClosedSpacePlan, 'space-1-1']
  ]) {
    const draft = fixture('shared-wall');
    delete floorOf(draft).session.activeSpaceStartWallIndex;
    freeze(draft);
    const plan = freeze(planner(draft, id));
    const first = clone(draft);
    const second = clone(draft);
    const result = apply(first, plan);
    apply(second, plan);
    compare(first, second);
    assert.equal(result.changed, true);
    assert.equal(result.kind, plan.kind);
    assert.deepEqual(result.wallIds, plan.wallIds);
    assert.throws(() => apply(clone(draft), { ...plan, floorId: 'wrong' }), TypeError);
  }
});

test('Phase 4B successful operations round-trip editor snapshot undo/redo and repeat on their output', () => {
  const scenarios = deletionCases().map(c => ({ input: c.input, operation: facade[c.operationName], reference: wrapOperation(c.operationName, frozen[c.operationName], { mode: 'full' }), args: c.args }));
  scenarios.push(...splitCases().filter(c => c.outcome !== 'error').map(c => ({ input: c.draft, operation: split.splitWall, reference: splitAdapter(frozen, true), args: c.args })));
  for (const c of scenarios) {
    const history = { undo: [clone(c.input)], redo: [] };
    const output = c.operation(c.input, ...c.args);
    history.redo.push(clone(output));
    compare(c.input, history.undo.pop());
    compare(output, history.redo.pop());
    // Repeating an operation on a new state is distinct from harness repeatability.
    // A source wall ID survives a split, so the second split follows legacy semantics.
    // Old cuts can now lie beyond that shortened host; retain atomic full-validator
    // rejection as well as successful/no-op repeats, rather than invent idempotency.
    assertSurveyKernelDifferential({ operationName: 'repeat-on-output', input: output, args: c.args, legacy: side(c.reference), candidate: side(c.operation) });
  }
});

test('Phase 4B late invariant failures and opening conflicts preserve the entire draft and caller history', () => {
  const scenarios = [];
  const input = fixture('multiple-spaces');
  floorOf(input).walls.find(w => w.id === 'wall-1-4').endNodeId = 'missing-node';
  for (const [operationName, args] of [['deleteWall', ['wall-1-8']], ['deleteClosedSpace', ['space-1-1']]]) {
    scenarios.push({ input, operation: facade[operationName], reference: wrapOperation(operationName, frozen[operationName], { mode: 'full' }), args });
  }
  const lateSplit = fixture('single-wall');
  const cuts = addCuts(lateSplit, 0, [0.5]);
  floorOf(lateSplit).session.fixedNodeId = 'missing-node';
  scenarios.push({ input: lateSplit, operation: split.splitWall, reference: splitAdapter(frozen, true), args: ['wall-1-1', cuts] });
  const conflict = splitCases().find(c => c.id === 'opening-clearance-2600');
  scenarios.push({ input: conflict.draft, operation: split.splitWall, reference: splitAdapter(frozen, true), args: conflict.args });
  for (const c of scenarios) {
    const history = { undo: [clone(c.input)], redo: [{ retained: true }] };
    const before = JSON.stringify({ draft: c.input, history });
    assertSurveyKernelDifferential({ operationName: 'rejection', input: c.input, args: c.args, expectedOutcome: 'error', legacy: side(c.reference), candidate: side(c.operation) });
    assert.throws(() => { const next = c.operation(c.input, ...c.args); history.undo.push(clone(next)); });
    assert.equal(JSON.stringify({ draft: c.input, history }), before);
  }
});

test('Phase 4B closure suggestions used by chain restoration remain read-only', () => {
  for (const name of Object.keys(baseline.fixtures)) {
    const draft = freeze(fixture(name));
    const floor = floorOf(draft);
    const anchor = facade.getNode(floor, floor.session.anchorNodeId);
    const first = floor.nodes[0];
    const last = floor.walls.at(-1);
    assert.deepEqual(suggestions.findMergeClosurePlan(floor, floor.session, anchor), suggestions.findMergeClosurePlan(floor, floor.session, anchor));
    assert.deepEqual(suggestions.resolveStraightClosurePlan(floor, floor.session, last, first), suggestions.resolveStraightClosurePlan(floor, floor.session, last, first));
  }
});

test('Phase 4B structural operations load without kernel/clients and have an acyclic dependency closure', () => {
  const repoRoot = path.resolve(__dirname, '../..');
  const graph = buildModuleGraph();
  const visited = new Set();
  const visit = (file, stack) => {
    assert.ok(!stack.includes(file), `cycle: ${[...stack, file].join(' -> ')}`);
    assert.doesNotMatch(file, /legacy-kernel|surveyWallGraph|surveying-editor|bluetooth/);
    if (visited.has(file)) return;
    visited.add(file);
    assert.doesNotMatch(fs.readFileSync(path.join(repoRoot, file), 'utf8'), /\bwx\s*\.|\b(?:window|document|globalThis)\s*\./);
    graph.edges.filter(e => e.from === file).forEach(e => visit(e.to, [...stack, file]));
  };
  for (const name of ['wall-split', 'wall-deletion']) visit(`miniprogram/packages/surveying/utils/survey/operations/${name}.js`, []);
  assert.ok([...visited].some(f => f.endsWith('/transaction.js')));
  assert.ok([...visited].some(f => f.endsWith('/space-sync.js')));
  assert.ok([...visited].some(f => f.endsWith('/face-extractor.js')));
  execFileSync(process.execPath, ['-e', `
    const Module = require('node:module');
    const original = Module._load;
    Module._load = function(request, ...args) {
      if (/legacy-kernel|surveyWallGraph|surveying-editor|bluetooth/.test(request)) throw Error(request);
      return original.call(this, request, ...args);
    };
    for (const root of ['miniprogram/packages/surveying/utils/survey', 'admin/src/lib/survey-runtime/survey']) {
      require('./' + root + '/operations/wall-split.js');
      require('./' + root + '/operations/wall-deletion.js').createWallDeletionOperations();
    }
  `], { cwd: repoRoot, stdio: 'pipe' });
  const kernel = fs.readFileSync(path.join(repoRoot, 'miniprogram/packages/surveying/utils/survey/legacy-kernel.js'), 'utf8');
  for (const name of ['splitWallAtNodes', 'deleteWall', 'deleteClosedSpace', 'remapOpeningsForSplitWall', 'restoreOpenedSpaceChain']) {
    assert.doesNotMatch(kernel, new RegExp(`^function ${name}\\(`, 'm'));
  }
  const wrapper = fs.readFileSync(path.join(repoRoot, 'miniprogram/packages/surveying/utils/survey/operations/wall-operations.js'), 'utf8');
  assert.doesNotMatch(wrapper, /kernel\.(?:deleteWall|deleteClosedSpace)/);
});
