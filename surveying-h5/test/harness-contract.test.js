const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');
const h5Source = fs.readFileSync(path.join(root, 'surveying-h5/src/main.js'), 'utf8');
const surveyGraph = require(path.join(root, 'miniprogram/utils/surveyWallGraph.js'));
const surveyRenderer = require(path.join(root, 'miniprogram/packages/surveying/utils/surveyCanvasRenderer.js'));

function buildClosedDraft(points) {
  let draft = surveyGraph.resetCursor(surveyGraph.createSurveyDraft());
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  points.forEach((point, index) => {
    draft = surveyGraph.startPreview(draft, point);
    if (index === points.length - 1) {
      draft = surveyGraph.confirmClosure(draft);
    } else {
      const floor = surveyGraph.getActiveFloor(draft);
      draft = surveyGraph.commitPreviewLength(draft, floor.session.previewLengthMm, 'h5-contract-test');
    }
  });
  return draft;
}

test('browser harness imports the production editor, graph and renderer', () => {
  assert.match(h5Source, /miniprogram\/packages\/surveying\/editor\/surveying-editor\.js/);
  assert.match(h5Source, /miniprogram\/utils\/surveyWallGraph\.js/);
  assert.match(h5Source, /miniprogram\/packages\/surveying\/utils\/surveyCanvasRenderer\.js/);
  assert.doesNotMatch(h5Source, /pages\/editor\/editor|restoreFloorPlan|surveying_prototype/);
});

test('rectangle scenario closes through the production wall graph', () => {
  const draft = buildClosedDraft([
    { xMm: 4000, yMm: 0 },
    { xMm: 4000, yMm: 3000 },
    { xMm: 0, yMm: 3000 },
    { xMm: 0, yMm: 0 }
  ]);
  const floor = surveyGraph.getActiveFloor(draft);
  assert.equal(floor.session.state, 'spaceClosed');
  assert.equal(floor.walls.length, 4);
  assert.equal(floor.spaces.filter((space) => space.closed).length, 1);
  assert.equal(surveyGraph.calculateSpaceAreaMm2(draft), 12_000_000);
});

test('H5 Canvas scene uses the current production renderer revision', () => {
  const draft = buildClosedDraft([
    { xMm: 4800, yMm: 0 },
    { xMm: 4800, yMm: 1800 },
    { xMm: 2900, yMm: 1800 },
    { xMm: 2900, yMm: 3600 },
    { xMm: 0, yMm: 3600 },
    { xMm: 0, yMm: 0 }
  ]);
  const floor = surveyGraph.getActiveFloor(draft);
  const scene = surveyRenderer.createSurveyRenderScene({
    floor,
    session: floor.session,
    viewport: floor.viewport,
    rect: { width: 1000, height: 760 }
  });
  assert.equal(surveyRenderer.RENDER_REVISION, 'degree-aware-branch-far-face-v13');
  assert.equal(scene.walls.length, 6);
  assert.ok(scene.wallSolidPlans.closed.rings.length > 0);
});
