const test = require('node:test');
const assert = require('node:assert/strict');
const surveyGraph = require('../utils/surveyWallGraph.js');
const surveyLayout = require('../utils/surveyLayout.js');

test('formal layout stores only the survey graph contract', () => {
  const graph = surveyGraph.createSurveyDraft();
  const layout = surveyLayout.createFormalSurveyLayout(graph, 'draft');
  assert.equal(layout.version, 4);
  assert.equal(layout.measurementMode, 'surveying');
  assert.equal(layout.surveyGraph.kind, 'survey-wall-graph');
  assert.equal(Object.hasOwn(layout, 'rooms'), false);
  assert.deepEqual(Object.keys(layout).sort(), ['measurementMode', 'surveyGraph', 'version']);
  assert.equal(surveyLayout.isFormalSurveyLayout(layout), true);
  assert.equal(surveyLayout.isFormalSurveyLayout({ ...layout, rooms: [] }), false);
  assert.equal(surveyLayout.isFormalSurveyLayout({ ...layout, draftState: {} }), false);
});

test('closed wall graph survives formal save and restore', () => {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  draft = surveyGraph.startPreview(draft, { xMm: 3000, yMm: 0 });
  draft = surveyGraph.commitPreviewLength(draft, 3000, 'manual');
  draft = surveyGraph.startPreview(draft, { xMm: 3000, yMm: 2000 });
  draft = surveyGraph.commitPreviewLength(draft, 2000, 'manual');
  draft = surveyGraph.startPreview(draft, { xMm: 0, yMm: 2000 });
  draft = surveyGraph.commitPreviewLength(draft, 3000, 'manual');
  draft = surveyGraph.startPreview(draft, { xMm: 0, yMm: 0 });
  draft = surveyGraph.commitPreviewLength(draft, 2000, 'manual');
  draft = surveyGraph.confirmClosure(draft);
  const layout = surveyLayout.createFormalSurveyLayout(draft, 'completed');
  const restored = surveyLayout.getActiveFloor(layout);
  assert.equal(restored.spaces.filter((space) => space.closed).length, 1);
  assert.equal(layout.surveyGraph.status, 'completed');
});
