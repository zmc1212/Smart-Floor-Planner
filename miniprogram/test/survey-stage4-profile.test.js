const test = require('node:test');
const assert = require('node:assert/strict');
const { profile } = require('../scripts/profile-survey-stage4.js');
const graph = require('../packages/surveying/utils/surveyWallGraph.js');

test('stage 4 profiler returns frame and memory evidence without claiming device bridge time', () => {
  const draft = graph.createSurveyDraft();
  const result = profile(draft, { frames: 3 });
  assert.equal(result.frames, 3);
  assert.equal(result.deviceCanvasBridgeMeasured, false);
  assert.ok(Number.isFinite(result.frameP95Ms));
});
