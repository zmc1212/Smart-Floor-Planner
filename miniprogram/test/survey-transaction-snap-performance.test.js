const test = require('node:test');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const surveyGraph = require('../utils/surveyWallGraph.js');
const { runSurveyTransaction } = require('../utils/survey/operations/transaction.js');
const { createTopologyIndex } = require('../utils/survey/topology/topology-index.js');
const snapEngine = require('../utils/survey/snap/snap-engine.js');

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
