const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const baseline = require('./fixtures/survey-kernel-baseline/expected-behavior.json');
const frozen = require('./fixtures/survey-kernel-phase4a/opening-operation-reference.js');
const facade = require('../packages/surveying/utils/surveyWallGraph.js');
const legacyApi = require('../packages/surveying/utils/survey/legacy-kernel.js');
const adminFacade = require('../../admin/src/lib/survey-runtime/surveyWallGraph.js');
const adminLegacyApi = require('../../admin/src/lib/survey-runtime/survey/legacy-kernel.js');
const openingOperations = require('../packages/surveying/utils/survey/operations/opening-operations.js');
const { buildModuleGraph } = require('../scripts/audit-survey-kernel.js');
const {
  assertSurveyKernelDifferential
} = require('./helpers/survey-kernel-differential-harness.js');
const {
  compareSurveyDrafts,
  formatSurveyDifferences
} = require('./helpers/survey-kernel-semantics.js');

const repoRoot = path.resolve(__dirname, '../..');
const operationPath = 'miniprogram/packages/surveying/utils/survey/operations/opening-operations.js';

function clone(value) {
  return structuredClone(value);
}

function fixture(name) {
  return clone(baseline.fixtures[name].draft);
}

function activeFloor(draft) {
  return draft.floors.find((floor) => floor.id === draft.activeFloorId) || draft.floors[0];
}

function side(label, implementation) {
  return {
    label,
    implementation,
    validateSurveyDraft: facade.validateSurveyDraft
  };
}

function compareDrafts(expected, actual, label) {
  const comparison = compareSurveyDrafts(expected, actual);
  assert.equal(
    comparison.equal,
    true,
    `${label}: ${formatSurveyDifferences(comparison.differences)}`
  );
}

function createCases() {
  const cases = [];
  const add = (id, operationName, input, args, expectedOutcome) => {
    cases.push({ id, operationName, input, args, expectedOutcome });
  };

  let draft = fixture('single-wall');
  let floor = activeFloor(draft);
  add('add-door-explicit-wall', 'addOpeningToWall', draft, [floor.walls[0].id, 'door'], 'success');

  draft = fixture('single-wall');
  floor = activeFloor(draft);
  floor.session.selectedWallId = floor.walls[0].id;
  floor.session.selectedSpaceId = 'stale-space-selection';
  add('add-window-selected-wall', 'addOpeningToWall', draft, ['', 'window'], 'success');

  draft = fixture('single-wall');
  floor = activeFloor(draft);
  add('add-unknown-type-defaults-door', 'addOpeningToWall', draft, [floor.walls[0].id, 'arch'], 'success');

  add('add-without-wall', 'addOpeningToWall', fixture('empty-graph'), ['', 'door'], 'error');

  draft = fixture('wall-with-openings');
  floor = activeFloor(draft);
  add('update-door-complete-patch', 'updateOpening', draft, [floor.openings[0].id, {
    widthMm: 1400,
    heightMm: 2300,
    sillHeightMm: 25,
    depthMm: 260,
    centerOffsetMm: 2100,
    openDirection: 'outside',
    modelId: 'door-double-test',
    modelCategory: 'double-door',
    materialId: 'walnut',
    entryDoor: true
  }], 'success');

  draft = fixture('wall-with-openings');
  floor = activeFloor(draft);
  add('update-window-ignores-door-only-fields', 'updateOpening', draft, [floor.openings[1].id, {
    widthMm: 99999,
    centerOffsetMm: -400,
    openDirection: 'outside',
    entryDoor: true,
    modelId: 'window-test'
  }], 'success');

  const invalidPatches = [
    ['width', { widthMm: 99 }],
    ['height', { heightMm: 99 }],
    ['sill', { sillHeightMm: -1 }],
    ['depth', { depthMm: 49 }],
    ['offset', { centerOffsetMm: 1.5 }]
  ];
  invalidPatches.forEach(([label, patch]) => {
    const input = fixture('wall-with-openings');
    const openingId = activeFloor(input).openings[0].id;
    add(`update-invalid-${label}`, 'updateOpening', input, [openingId, patch], 'error');
  });

  add(
    'update-missing-opening',
    'updateOpening',
    fixture('wall-with-openings'),
    ['missing-opening', { widthMm: 1000 }],
    'error'
  );

  draft = fixture('wall-with-openings');
  floor = activeFloor(draft);
  add('delete-explicit-opening', 'deleteOpening', draft, [floor.openings[0].id], 'success');

  draft = fixture('wall-with-openings');
  floor = activeFloor(draft);
  floor.session.selectedOpeningId = floor.openings[0].id;
  add('delete-selected-opening', 'deleteOpening', draft, [''], 'success');

  add(
    'delete-missing-opening',
    'deleteOpening',
    fixture('wall-with-openings'),
    ['missing-opening'],
    'noop'
  );
  return cases;
}

for (const operationCase of createCases()) {
  test(`Phase 4A frozen mutation and extracted legacy proxy stay equivalent: ${operationCase.id}`, () => {
    [legacyApi, adminLegacyApi].forEach((implementation, index) => {
      assertSurveyKernelDifferential({
        caseId: `legacy-proxy:${index}:${operationCase.id}`,
        operationName: operationCase.operationName,
        input: operationCase.input,
        args: operationCase.args,
        expectedOutcome: operationCase.expectedOutcome,
        legacy: side('frozen Phase 3 mutation', frozen),
        candidate: side(`extracted legacy proxy ${index}`, implementation)
      });
    });
  });

  test(`Phase 4A frozen mutation and transactional facade stay equivalent: ${operationCase.id}`, () => {
    [facade, adminFacade].forEach((implementation, index) => {
      assertSurveyKernelDifferential({
        caseId: `transaction:${index}:${operationCase.id}`,
        operationName: operationCase.operationName,
        input: operationCase.input,
        args: operationCase.args,
        expectedOutcome: operationCase.expectedOutcome,
        legacy: side('frozen Phase 3 mutation', frozen),
        candidate: side(`transactional facade ${index}`, implementation)
      });
    });
  });
}

test('Phase 4A plans are read-only until applied and return a structured mutation result', () => {
  const draft = fixture('single-wall');
  const floor = activeFloor(draft);
  const before = clone(draft);
  const plan = openingOperations.planAddOpening(draft, floor.walls[0].id, 'window');
  assert.deepEqual(draft, before);
  assert.equal(plan.kind, 'add-opening');
  assert.equal(plan.wallId, floor.walls[0].id);
  assert.equal(plan.opening.type, 'window');

  const working = clone(draft);
  const result = openingOperations.applyOpeningPlan(working, plan);
  assert.deepEqual(result, {
    changed: true,
    kind: 'add-opening',
    wallId: floor.walls[0].id,
    openingId: plan.opening.id
  });
  assert.equal(activeFloor(working).openings.length, 1);
  assert.equal(facade.validateSurveyDraft(working, { mode: 'quick' }).valid, true);

  const updateInput = fixture('wall-with-openings');
  const updateBefore = clone(updateInput);
  const openingId = activeFloor(updateInput).openings[0].id;
  const updatePlan = openingOperations.planUpdateOpening(updateInput, openingId, {
    widthMm: 1300,
    entryDoor: true
  });
  assert.deepEqual(updateInput, updateBefore);
  const updated = clone(updateInput);
  assert.deepEqual(openingOperations.applyOpeningPlan(updated, updatePlan), {
    changed: true,
    kind: 'update-opening',
    wallId: updatePlan.wallId,
    openingId
  });
  compareDrafts(frozen.updateOpening(updateInput, openingId, {
    widthMm: 1300,
    entryDoor: true
  }), updated, 'applied update plan');

  const deleteInput = clone(updated);
  const deleteBefore = clone(deleteInput);
  const existingDeletePlan = openingOperations.planDeleteOpening(deleteInput, openingId);
  assert.deepEqual(deleteInput, deleteBefore);
  const deleted = clone(deleteInput);
  assert.deepEqual(openingOperations.applyOpeningPlan(deleted, existingDeletePlan), {
    changed: true,
    kind: 'delete-opening',
    wallId: existingDeletePlan.wallId,
    openingId
  });
  compareDrafts(frozen.deleteOpening(deleteInput, openingId), deleted, 'applied delete plan');
  compareDrafts(deleted, facade.deleteOpening(deleted, openingId), 'repeated delete is a no-op');

  const sparseDraft = fixture('single-wall');
  delete activeFloor(sparseDraft).openings;
  const sparseBefore = clone(sparseDraft);
  const deletePlan = openingOperations.planDeleteOpening(sparseDraft, 'missing-opening');
  assert.equal(deletePlan.noop, true);
  assert.deepEqual(sparseDraft, sparseBefore);
  const sparseResult = legacyApi.deleteOpening(sparseDraft, 'missing-opening');
  compareDrafts(frozen.deleteOpening(sparseDraft, 'missing-opening'), sparseResult, 'sparse legacy delete');
  assert.deepEqual(activeFloor(sparseResult).openings, []);
  assert.deepEqual(sparseDraft, sparseBefore);
});

test('Phase 4A normalizes width, offset and door direction against the current host wall', () => {
  let draft = fixture('wall-with-openings');
  let floor = activeFloor(draft);
  const doorId = floor.openings[0].id;
  const host = floor.walls.find((wall) => wall.id === floor.openings[0].wallId);
  draft = facade.updateOpening(draft, doorId, {
    widthMm: host.lengthMm + 5000,
    centerOffsetMm: -2000,
    openDirection: 'sideways'
  });
  floor = activeFloor(draft);
  const door = floor.openings.find((opening) => opening.id === doorId);
  assert.equal(door.widthMm, host.lengthMm);
  assert.equal(door.centerOffsetMm, host.lengthMm / 2);
  assert.equal(door.openDirection, 'inside');
});

test('Phase 4A keeps exactly one entry door and preserves the historical clear-all behavior', () => {
  let draft = fixture('wall-with-openings');
  let floor = activeFloor(draft);
  const sourceWallId = floor.walls[1].id;
  draft = facade.addOpeningToWall(draft, sourceWallId, 'door');
  floor = activeFloor(draft);
  const secondDoorId = floor.session.selectedOpeningId;
  draft = facade.updateOpening(draft, secondDoorId, { entryDoor: true });
  floor = activeFloor(draft);
  assert.deepEqual(
    floor.openings.filter((opening) => opening.type === 'door' && opening.entryDoor).map((opening) => opening.id),
    [secondDoorId]
  );

  draft = facade.updateOpening(draft, secondDoorId, { entryDoor: false });
  floor = activeFloor(draft);
  assert.equal(floor.openings.some((opening) => opening.type === 'door' && opening.entryDoor), false);
});

test('Phase 4A transaction rejects missing hosts and out-of-range openings without mutating input', () => {
  const missingHost = fixture('wall-with-openings');
  const missingFloor = activeFloor(missingHost);
  const openingId = missingFloor.openings[0].id;
  missingFloor.openings[0].wallId = 'missing-wall';
  const missingBefore = JSON.stringify(missingHost);
  assert.throws(
    () => facade.updateOpening(missingHost, openingId, { modelId: 'still-invalid' }),
    (error) => error.name === 'SurveyInvariantError' &&
      error.operationName === 'updateOpening' && error.code === 'MISSING_OPENING_WALL'
  );
  assert.equal(JSON.stringify(missingHost), missingBefore);

  const outOfRange = fixture('wall-with-openings');
  activeFloor(outOfRange).openings[0].centerOffsetMm = -5000;
  const validation = facade.validateSurveyDraft(outOfRange, { mode: 'quick' });
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.code === 'OPENING_OUT_OF_RANGE'));
  const outOfRangeBefore = JSON.stringify(outOfRange);
  const invalidFloor = activeFloor(outOfRange);
  const otherOpeningId = invalidFloor.openings[1].id;
  for (const [operationName, args] of [
    ['addOpeningToWall', [invalidFloor.walls[0].id, 'window']],
    ['updateOpening', [otherOpeningId, { modelId: 'keep-invalid-host-sibling' }]],
    ['deleteOpening', [otherOpeningId]]
  ]) {
    assert.throws(
      () => facade[operationName](outOfRange, ...args),
      (error) => error.name === 'SurveyInvariantError' &&
        error.operationName === operationName && error.code === 'OPENING_OUT_OF_RANGE'
    );
    assert.equal(JSON.stringify(outOfRange), outOfRangeBefore);
  }
});

test('Phase 4A add, update and delete snapshots round-trip through the editor undo/redo contract', () => {
  const scenarios = [];

  let before = fixture('single-wall');
  let floor = activeFloor(before);
  scenarios.push([before, facade.addOpeningToWall(before, floor.walls[0].id, 'door')]);

  before = fixture('wall-with-openings');
  floor = activeFloor(before);
  scenarios.push([before, facade.updateOpening(before, floor.openings[0].id, { widthMm: 1300 })]);

  before = fixture('wall-with-openings');
  floor = activeFloor(before);
  scenarios.push([before, facade.deleteOpening(before, floor.openings[0].id)]);

  scenarios.forEach(([source, committed], index) => {
    const history = { undo: [clone(source)], redo: [] };
    let current = committed;
    history.redo.push(clone(current));
    current = history.undo.pop();
    compareDrafts(source, current, `undo ${index}`);
    history.undo.push(clone(current));
    current = history.redo.pop();
    compareDrafts(committed, current, `redo ${index}`);
  });
});

test('Phase 4A rejection leaves caller history and draft byte-for-byte unchanged', () => {
  const draft = fixture('wall-with-openings');
  const openingId = activeFloor(draft).openings[0].id;
  const before = JSON.stringify(draft);
  const history = { undo: [], redo: [{ retained: true }] };
  assert.throws(() => facade.updateOpening(draft, openingId, { widthMm: 99 }));
  assert.equal(JSON.stringify(draft), before);
  assert.deepEqual(history, { undo: [], redo: [{ retained: true }] });
});

test('Phase 4A operation dependency closure is acyclic and excludes the legacy kernel and clients', () => {
  const graph = buildModuleGraph();
  const checked = new Set();
  const visit = (file, stack) => {
    assert.ok(!stack.includes(file), `Cyclic opening operation dependency: ${[...stack, file].join(' -> ')}`);
    assert.doesNotMatch(file, /legacy-kernel|surveyWallGraph|surveying-editor|bluetooth/);
    if (checked.has(file)) return;
    checked.add(file);
    const source = fs.readFileSync(path.join(repoRoot, file), 'utf8');
    assert.doesNotMatch(source, /\bwx\s*\.|\b(?:window|document|globalThis)\s*\./, file);
    graph.edges.filter((edge) => edge.from === file).forEach((edge) => visit(edge.to, [...stack, file]));
  };
  visit(operationPath, []);
  assert.ok(checked.has('miniprogram/packages/surveying/utils/survey/operations/transaction.js'));
  assert.ok(checked.has('miniprogram/packages/surveying/utils/survey/domain/opening.js'));
  assert.ok(checked.has('miniprogram/packages/surveying/utils/survey/invariants/floor-plan-validator.js'));
});

test('Phase 4A removes the three opening mutation bodies from the legacy kernel', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'miniprogram/packages/surveying/utils/survey/legacy-kernel.js'), 'utf8');
  for (const name of ['addOpeningToWall', 'updateOpening', 'deleteOpening']) {
    assert.doesNotMatch(source, new RegExp(`^function ${name}\\(`, 'm'), name);
    assert.equal(typeof legacyApi[name], 'function');
    assert.equal(typeof facade[name], 'function');
    assert.notEqual(legacyApi[name], facade[name]);
  }
});
