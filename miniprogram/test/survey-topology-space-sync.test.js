const test = require('node:test');
const assert = require('node:assert/strict');
const surveyGraph = require('../packages/surveying/utils/surveyWallGraph.js');
const { extractFaces } = require('../packages/surveying/utils/survey/topology/face-extractor.js');
const { inspectDraftFaceShadow } = require('../packages/surveying/utils/survey/topology/face-shadow.js');
const { syncClosedSpacesFromFaces } = require('../packages/surveying/utils/survey/topology/space-sync.js');

function commitPreview(draft, rawPoint) {
  const preview = surveyGraph.startPreview(draft, rawPoint);
  const floor = surveyGraph.getActiveFloor(preview);
  return surveyGraph.commitPreviewLength(preview, floor.session.previewLengthMm, 'space-sync');
}

function closedRectangle() {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.setThickness(draft, 200);
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  draft = commitPreview(draft, { xMm: 6000, yMm: 0 });
  draft = commitPreview(draft, { xMm: 6000, yMm: 4000 });
  draft = commitPreview(draft, { xMm: 0, yMm: 4000 });
  draft = commitPreview(draft, { xMm: 0, yMm: 0 });
  return surveyGraph.confirmClosure(draft);
}

test('confirmClosure writes closed spaces from half-edge faces', () => {
  const draft = closedRectangle();
  const floor = surveyGraph.getActiveFloor(draft);
  const faces = extractFaces(floor).faces;
  assert.equal(floor.spaces.filter((space) => space.closed).length, 1);
  assert.equal(faces.length, 1);
  assert.deepEqual(
    floor.spaces[0].wallIds.slice().sort(),
    faces[0].wallIds.slice().sort()
  );
  assert.equal(inspectDraftFaceShadow(draft).ok, true);
});

test('deleting one shared divider in a three-room row keeps the unrelated room', () => {
  let draft = closedRectangle();
  draft = surveyGraph.snapCursorToWall(
    surveyGraph.startWallSnap(draft),
    { xMm: 3000, yMm: 0 },
    surveyGraph.getCursorPlacementTarget(
      surveyGraph.getActiveFloor(draft),
      { xMm: 3000, yMm: 0 },
      surveyGraph.CLOSE_TOLERANCE_MM
    )
  );
  draft = commitPreview(draft, { xMm: 3000, yMm: 4000 });
  draft = surveyGraph.confirmClosure(draft);
  draft = surveyGraph.snapCursorToWall(
    surveyGraph.startWallSnap(draft),
    { xMm: 4500, yMm: 0 },
    surveyGraph.getCursorPlacementTarget(
      surveyGraph.getActiveFloor(draft),
      { xMm: 4500, yMm: 0 },
      surveyGraph.CLOSE_TOLERANCE_MM
    )
  );
  draft = commitPreview(draft, { xMm: 4500, yMm: 4000 });
  draft = surveyGraph.confirmClosure(draft);

  let floor = surveyGraph.getActiveFloor(draft);
  assert.equal(floor.spaces.filter((space) => space.closed).length, 3);
  const divider = floor.walls.find((wall) => {
    const start = surveyGraph.getNode(floor, wall.startNodeId);
    const end = surveyGraph.getNode(floor, wall.endNodeId);
    return start.xMm === 3000 && end.xMm === 3000;
  });
  const unaffected = floor.spaces.find((space) => (
    space.closed && space.wallIds.indexOf(divider.id) === -1
  ));
  const unaffectedId = unaffected.id;
  const unaffectedWalls = unaffected.wallIds.slice().sort();

  draft = surveyGraph.deleteWall(draft, divider.id);
  floor = surveyGraph.getActiveFloor(draft);
  assert.equal(floor.spaces.filter((space) => space.closed).length, 2);
  const remaining = floor.spaces.find((space) => space.id === unaffectedId);
  assert.ok(remaining && remaining.closed);
  assert.deepEqual(remaining.wallIds.slice().sort(), unaffectedWalls);
  assert.equal(inspectDraftFaceShadow(draft).ok, true);
});

test('syncClosedSpacesFromFaces rebuilds a missing closed space from the graph', () => {
  const draft = closedRectangle();
  const floor = surveyGraph.getActiveFloor(draft);
  floor.spaces = [];
  const seed = { current: 0 };
  syncClosedSpacesFromFaces(floor, {
    nextId: (prefix) => `${prefix}-rebuilt-${seed.current += 1}`
  });
  assert.equal(floor.spaces.length, 1);
  assert.equal(floor.spaces[0].closed, true);
  assert.equal(extractFaces(floor).faces.length, 1);
});
