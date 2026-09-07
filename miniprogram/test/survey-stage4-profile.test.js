const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateBudget, evaluateDeviceSample, profile } = require('../scripts/profile-survey-stage4.js');
const graph = require('../packages/surveying/utils/surveyWallGraph.js');

test('stage 4 profiler returns frame and memory evidence without claiming device bridge time', () => {
  const draft = graph.createSurveyDraft();
  const result = profile(draft, { frames: 3 });
  assert.equal(result.frames, 3);
  assert.equal(result.deviceCanvasBridgeMeasured, false);
  assert.ok(Number.isFinite(result.frameP95Ms));
  assert.equal(result.budget.passed, true);
});

test('stage 4 budget rejects slow frames and excessive heap growth', () => {
  const result = evaluateBudget({ frameP95Ms: 34, frameMaxMs: 51, heapDeltaBytes: 9 * 1024 * 1024 });
  assert.deepEqual(result.checks, { frameP95: false, frameMax: false, heap: false });
  assert.equal(result.passed, false);
});

test('stage 4 keeps device acceptance incomplete until Canvas bridge evidence exists', () => {
  assert.equal(evaluateDeviceSample({ frameP95Ms: 1 }).status, 'incomplete');
  const result = evaluateDeviceSample({ canvasBridgeP95Ms: 20, canvasBridgeMaxMs: 40, heapDeltaBytes: 2 * 1024 * 1024, frames: 300 });
  assert.equal(result.status, 'complete');
  assert.equal(result.passed, true);
});
