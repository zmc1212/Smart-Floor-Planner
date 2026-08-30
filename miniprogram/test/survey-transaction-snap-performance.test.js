const test = require('node:test');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const surveyGraph = require('../packages/surveying/utils/surveyWallGraph.js');
const { runSurveyTransaction } = require('../packages/surveying/utils/survey/operations/transaction.js');
const { createTopologyIndex } = require('../packages/surveying/utils/survey/topology/topology-index.js');
const snapEngine = require('../packages/surveying/utils/survey/snap/snap-engine.js');

function createOpenWallDraft(lengthMm) {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  draft = surveyGraph.startPreview(draft, { xMm: lengthMm, yMm: 0 });
  return surveyGraph.commitPreviewLength(draft, lengthMm, 'manual');
}

function createLinearDraft(wallCount) {
  const draft = surveyGraph.createSurveyDraft();
  const floor = surveyGraph.getActiveFloor(draft);
  floor.nodes = Array.from({ length: wallCount + 1 }, (_, index) => ({
    id: `n-${index}`,
    xMm: index * 100,
    yMm: 0
  }));
  floor.walls = Array.from({ length: wallCount }, (_, index) => ({
    id: `w-${index}`,
    startNodeId: `n-${index}`,
    endNodeId: `n-${index + 1}`,
    thicknessMm: 200,
    lengthMm: 100
  }));
  return draft;
}

function createClosedRemeasureDraft(kind) {
  const draft = surveyGraph.createSurveyDraft();
  const floor = surveyGraph.getActiveFloor(draft);
  floor.nodes = [
    { id: 'a', xMm: 0, yMm: 0 },
    { id: 'b', xMm: 4000, yMm: 0 },
    { id: 'c', xMm: 4000, yMm: 3000 },
    { id: 'd', xMm: 0, yMm: 3000 }
  ];
  floor.walls = [
    { id: 'ab', startNodeId: 'a', endNodeId: 'b', lengthMm: 4000, thicknessMm: 200 },
    { id: 'bc', startNodeId: 'b', endNodeId: 'c', lengthMm: 3000, thicknessMm: 200 },
    { id: 'cd', startNodeId: 'c', endNodeId: 'd', lengthMm: 4000, thicknessMm: 200 },
    { id: 'da', startNodeId: 'd', endNodeId: 'a', lengthMm: 3000, thicknessMm: 200 }
  ];
  floor.openings = [
    { id: 'door', wallId: 'cd', type: 'door', centerOffsetMm: 1200, widthMm: 900 }
  ];
  floor.spaces = [
    { id: 'room', name: '客厅', wallIds: ['ab', 'bc', 'cd', 'da'], closed: true }
  ];

  if (kind === 'overlap') {
    floor.nodes.push(
      { id: 'fixed', xMm: 5000, yMm: 0 },
      { id: 'moving', xMm: 4500, yMm: 0 }
    );
    floor.walls.push({
      id: 'target', startNodeId: 'fixed', endNodeId: 'moving', lengthMm: 500, thicknessMm: 200
    });
  } else {
    floor.nodes.push(
      { id: 'fixed', xMm: 2000, yMm: -2000 },
      { id: 'moving', xMm: 2000, yMm: -500 }
    );
    floor.walls.push({
      id: 'target', startNodeId: 'fixed', endNodeId: 'moving', lengthMm: 1500, thicknessMm: 200
    });
  }

  floor.session.state = 'remeasureAwaitingInput';
  floor.session.selectedWallId = 'target';
  floor.session.fixedNodeId = 'fixed';
  draft.measurementHistory = [{ auditId: 'existing-audit', distanceMm: 4000 }];
  return draft;
}

test('transaction failure leaves the input byte-for-byte unchanged', () => {
  const draft = createOpenWallDraft(3000);
  const before = JSON.stringify(draft);
  assert.throws(() => runSurveyTransaction(draft, 'forcedFailure', (working) => {
    surveyGraph.getActiveFloor(working).walls[0].startNodeId = 'missing';
    throw new Error('forced failure');
  }), /forced failure/);
  assert.equal(JSON.stringify(draft), before);
});

test('public transactional operations commit one immutable result', () => {
  const draft = createOpenWallDraft(3000);
  const before = JSON.stringify(draft);
  const floor = surveyGraph.getActiveFloor(draft);
  const next = surveyGraph.addOpeningToWall(draft, floor.walls[0].id, 'door');
  assert.equal(JSON.stringify(draft), before);
  assert.equal(surveyGraph.getActiveFloor(next).openings.length, 1);
  assert.equal(surveyGraph.validateSurveyDraft(next, { mode: 'quick' }).valid, true);
});

test('failed remeasurement cannot mutate the selected draft', () => {
  let draft = createOpenWallDraft(3000);
  const wallId = surveyGraph.getActiveFloor(draft).walls[0].id;
  draft = surveyGraph.startRemeasure(surveyGraph.selectWall(draft, wallId));
  const before = JSON.stringify(draft);
  assert.throws(() => surveyGraph.remeasureSelectedWall(draft, 0, 'manual'));
  assert.equal(JSON.stringify(draft), before);
});

test('manual and BLE remeasurements atomically reject T, crossing and overlapping walls', () => {
  const cases = [
    { kind: 't', lengthMm: 2000, code: 'UNSPLIT_WALL_T_JUNCTION' },
    { kind: 'cross', lengthMm: 3000, code: 'UNSPLIT_WALL_INTERSECTION' },
    { kind: 'overlap', lengthMm: 3000, code: 'OVERLAPPING_WALLS' }
  ];

  for (const inputSource of ['manual', 'ble']) {
    cases.forEach(({ kind, lengthMm, code }) => {
      const draft = createClosedRemeasureDraft(kind);
      const before = JSON.stringify(draft);
      assert.throws(
        () => surveyGraph.remeasureSelectedWall(draft, lengthMm, inputSource),
        (error) => error && error.code === code,
        `${inputSource}:${kind}`
      );
      assert.equal(JSON.stringify(draft), before, `${inputSource}:${kind} mutated source`);
    });
  }
});

test('legal closed-room remeasurement preserves topology, space and opening semantics', () => {
  const draft = createClosedRemeasureDraft('t');
  const floor = surveyGraph.getActiveFloor(draft);
  floor.walls.pop();
  floor.nodes.splice(-2);
  floor.session.selectedWallId = 'ab';
  floor.session.fixedNodeId = 'a';
  const originalOpening = JSON.parse(JSON.stringify(floor.openings[0]));
  const originalSpace = JSON.parse(JSON.stringify(floor.spaces[0]));

  const next = surveyGraph.remeasureSelectedWall(draft, 3500, 'manual');
  const nextFloor = surveyGraph.getActiveFloor(next);

  assert.deepEqual(nextFloor.openings[0], originalOpening);
  assert.deepEqual(nextFloor.spaces[0], originalSpace);
  assert.deepEqual(surveyGraph.getNode(nextFloor, 'a'), { id: 'a', xMm: 0, yMm: 0 });
  assert.deepEqual(surveyGraph.getNode(nextFloor, 'b'), { id: 'b', xMm: 3500, yMm: 0 });
  assert.equal(surveyGraph.getWall(nextFloor, 'ab').lengthMm, 3500);
  assert.equal(nextFloor.session.state, 'spaceClosed');
  assert.equal(nextFloor.session.selectedWallId, 'ab');
  assert.equal(surveyGraph.validateSurveyDraft(next, { mode: 'full' }).valid, true);
});

test('snap engine acquires at 16px, retains until 26px and returns integer millimetres', () => {
  const candidate = { type: 'vertex', nodeId: 'n1', pointMm: { xMm: 300.4, yMm: 0.2 } };
  const acquired = snapEngine.resolveSnap({
    scale: 0.05,
    rawPointMm: { xMm: 0, yMm: 0 },
    candidate
  });
  assert.equal(acquired.acquired, true);
  assert.deepEqual(acquired.candidate.pointMm, { xMm: 300, yMm: 0 });

  const retained = snapEngine.resolveSnap({
    scale: 0.05,
    rawPointMm: { xMm: 800, yMm: 0 },
    previousLock: acquired.lock
  });
  assert.equal(retained.retained, true);

  const released = snapEngine.resolveSnap({
    scale: 0.05,
    rawPointMm: { xMm: 850, yMm: 0 },
    previousLock: acquired.lock
  });
  assert.equal(released.candidate, null);
  assert.equal(released.lock, null);
});

test('topology index invalidates explicitly and quick validation stays linear at 500 walls', () => {
  const draft = createLinearDraft(500);
  const floor = surveyGraph.getActiveFloor(draft);
  const startedAt = performance.now();
  const index = createTopologyIndex(floor);
  const validation = surveyGraph.validateSurveyDraft(draft, { mode: 'quick' });
  const elapsedMs = performance.now() - startedAt;
  assert.equal(index.wallsById.size, 500);
  assert.equal(index.wallsByNodeId.get('n-250').length, 2);
  assert.equal(validation.valid, true);
  assert.ok(elapsedMs < 250, `500-wall quick validation took ${elapsedMs.toFixed(2)}ms`);
  index.invalidate();
  assert.equal(index.invalidated, true);
});
