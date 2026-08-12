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

test('formal save and restore preserves optional measurement insets', () => {
  const graph = surveyGraph.createSurveyDraft();
  const floor = surveyGraph.getActiveFloor(graph);
  floor.nodes = [
    { id: 'a', xMm: 0, yMm: 0 },
    { id: 'b', xMm: 3200, yMm: 0 }
  ];
  floor.walls = [{
    id: 'wall-a',
    startNodeId: 'a',
    endNodeId: 'b',
    lengthMm: 3000,
    thicknessMm: 200,
    measurementStartInsetMm: 200,
    measurementEndInsetMm: 0
  }];

  const layout = surveyLayout.createFormalSurveyLayout(graph, 'draft');
  const restored = surveyLayout.getActiveFloor(JSON.parse(JSON.stringify(layout)));
  assert.equal(restored.walls[0].measurementStartInsetMm, 200);
  assert.equal(restored.walls[0].measurementEndInsetMm, 0);
  assert.equal(restored.walls[0].lengthMm, 3000);
});

test('formal save and restore preserves per-space wall-face overrides', () => {
  const graph = surveyGraph.createSurveyDraft();
  const floor = surveyGraph.getActiveFloor(graph);
  floor.spaces = [{
    id: 'space-a',
    wallIds: ['wall-a'],
    wallFaceOverrides: { 'wall-a': 'topology' },
    closed: true
  }];

  const layout = surveyLayout.createFormalSurveyLayout(graph, 'draft');
  const restored = surveyLayout.getActiveFloor(JSON.parse(JSON.stringify(layout)));
  assert.deepEqual(restored.spaces[0].wallFaceOverrides, { 'wall-a': 'topology' });
});
