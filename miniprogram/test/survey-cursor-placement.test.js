const test = require('node:test');
const assert = require('node:assert/strict');
const surveyGraph = require('../utils/surveyWallGraph.js');

function createWallDraft() {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  draft = surveyGraph.startPreview(draft, { xMm: 3000, yMm: 0 });
  return surveyGraph.commitPreviewLength(draft, 3000, 'manual');
}

function commitWall(draft, point, lengthMm) {
  return surveyGraph.commitPreviewLength(
    surveyGraph.startPreview(draft, point),
    lengthMm,
    'manual'
  );
}

function createClosedDraft() {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  draft = commitWall(draft, { xMm: 3000, yMm: 0 }, 3000);
  draft = commitWall(draft, { xMm: 3000, yMm: 2000 }, 2000);
  draft = commitWall(draft, { xMm: 0, yMm: 2000 }, 3000);
  draft = commitWall(draft, { xMm: 0, yMm: 0 }, 2000);
  return surveyGraph.confirmClosure(draft);
}

test('cursor placement prefers an existing vertex over a nearby wall segment', () => {
  const floor = surveyGraph.getActiveFloor(createWallDraft());
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    { xMm: 80, yMm: 20 },
    surveyGraph.CLOSE_TOLERANCE_MM
  );

  assert.equal(target.type, 'vertex');
  assert.deepEqual(target.pointMm, { xMm: 0, yMm: 0 });
  assert.ok(target.nodeId);
});

test('cursor placement falls back to a wall point outside vertex tolerance', () => {
  const floor = surveyGraph.getActiveFloor(createWallDraft());
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    { xMm: 1500, yMm: 120 },
    surveyGraph.CLOSE_TOLERANCE_MM
  );

  assert.equal(target.type, 'wall');
  assert.deepEqual(target.pointMm, { xMm: 1500, yMm: 0 });
});

test('cursor placement away from walls returns a free target without mutating the wall graph', () => {
  const draft = createWallDraft();
  const floor = surveyGraph.getActiveFloor(draft);
  const nodeCount = floor.nodes.length;
  const wallCount = floor.walls.length;
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    { xMm: 1500, yMm: 1000 },
    surveyGraph.CLOSE_TOLERANCE_MM
  );

  assert.equal(target.type, 'free');
  assert.deepEqual(target.pointMm, { xMm: 1500, yMm: 1000 });
  assert.equal(floor.nodes.length, nodeCount);
  assert.equal(floor.walls.length, wallCount);
});

test('free cursor placement starts a separate wall chain without changing completed geometry', () => {
  const closedDraft = createClosedDraft();
  const before = surveyGraph.getActiveFloor(closedDraft);
  const next = surveyGraph.placeNewWallChainCursor(
    surveyGraph.startWallSnap(closedDraft),
    { xMm: 4800, yMm: 1200 }
  );
  const floor = surveyGraph.getActiveFloor(next);
  const anchor = surveyGraph.getNode(floor, floor.session.anchorNodeId);

  assert.equal(floor.walls.length, before.walls.length);
  assert.equal(floor.spaces.length, before.spaces.length);
  assert.equal(floor.spaces[0].closed, true);
  assert.equal(floor.session.state, 'cursorPlaced');
  assert.equal(floor.session.activeSpaceStartWallIndex, before.walls.length);
  assert.deepEqual({ xMm: anchor.xMm, yMm: anchor.yMm }, { xMm: 4800, yMm: 1200 });
});

test('cancelling a selected wall clears the selection and resumes the wall state', () => {
  const draft = createWallDraft();
  const wallId = surveyGraph.getActiveFloor(draft).walls[0].id;
  const selectedDraft = surveyGraph.selectWall(draft, wallId);
  const next = surveyGraph.cancelPending(selectedDraft);
  const session = surveyGraph.getActiveFloor(next).session;

  assert.equal(session.state, 'wallCommitted');
  assert.equal(session.selectedWallId, '');
  assert.equal(session.selectedOpeningId, '');
});

test('snapping a new cursor preserves existing closed spaces and walls', () => {
  const closedDraft = createClosedDraft();
  const before = surveyGraph.getActiveFloor(closedDraft);
  const next = surveyGraph.snapCursorToWall(
    surveyGraph.startWallSnap(closedDraft),
    { xMm: 0, yMm: 0 }
  );
  const floor = surveyGraph.getActiveFloor(next);

  assert.equal(floor.walls.length, before.walls.length);
  assert.equal(floor.spaces.length, before.spaces.length);
  assert.equal(floor.spaces[0].closed, true);
  assert.equal(floor.session.state, 'cursorPlaced');
  assert.ok(floor.session.anchorNodeId);
});

test('phone angle measurement keeps the preview length and applies the dragged turn side', () => {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  draft = commitWall(draft, { xMm: 3000, yMm: 0 }, 3000);
  draft = surveyGraph.setMode(draft, 'diagonal');
  draft = surveyGraph.startPreview(draft, { xMm: 4000, yMm: 1000 });

  const before = surveyGraph.getActiveFloor(draft).session.previewLengthMm;
  const next = surveyGraph.applyPreviewInteriorAngle(draft, 120, 'phone-motion');
  const session = surveyGraph.getActiveFloor(next).session;

  assert.equal(session.state, 'awaitingLength');
  assert.equal(session.previewLengthMm, before);
  assert.equal(session.previewAngleSource, 'phone-motion');
  assert.equal(session.previewInteriorAngleDeg, 120);
  assert.equal(Math.round(session.previewAngleDeg), 60);
});

test('confirming a diagonal preview for continuation advances the next wall anchor to its endpoint', () => {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  draft = commitWall(draft, { xMm: 3000, yMm: 0 }, 3000);
  draft = surveyGraph.setMode(draft, 'diagonal');
  draft = surveyGraph.startPreview(draft, { xMm: 4000, yMm: 1000 });
  const firstPreviewLength = surveyGraph.getActiveFloor(draft).session.previewLengthMm;
  draft = surveyGraph.commitPreviewLength(draft, firstPreviewLength, 'preview-continuation');
  draft = surveyGraph.startPreview(draft, { xMm: 4700, yMm: 2200 });

  const floor = surveyGraph.getActiveFloor(draft);
  const previousWall = floor.walls[1];
  const anchor = surveyGraph.getNode(floor, floor.session.anchorNodeId);

  assert.equal(floor.walls.length, 2);
  assert.equal(previousWall.inputSource, 'preview-continuation');
  assert.equal(anchor.id, previousWall.endNodeId);
  assert.notEqual(floor.session.previewPoint.xMm, anchor.xMm);
  assert.notEqual(floor.session.previewPoint.yMm, anchor.yMm);
});

test('a new diagonal snaps to the previous diagonal direction within the tolerance', () => {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  draft = commitWall(draft, { xMm: 3000, yMm: 0 }, 3000);
  draft = surveyGraph.setMode(draft, 'diagonal');
  draft = surveyGraph.startPreview(draft, { xMm: 4000, yMm: 1000 });
  const firstDiagonalLength = surveyGraph.getActiveFloor(draft).session.previewLengthMm;
  draft = surveyGraph.commitPreviewLength(draft, firstDiagonalLength, 'manual');
  draft = surveyGraph.startPreview(draft, { xMm: 5000, yMm: 2120 });

  const session = surveyGraph.getActiveFloor(draft).session;
  assert.equal(Math.round(session.previewAngleDeg), 45);
  assert.equal(session.alignmentSnapGuide.type, 'previous-diagonal-direction');
});

test('pythagorean angle metadata is stored when the preview wall is committed', () => {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  draft = commitWall(draft, { xMm: 3000, yMm: 0 }, 3000);
  draft = surveyGraph.setMode(draft, 'diagonal');
  draft = surveyGraph.startPreview(draft, { xMm: 4000, yMm: -1000 });
  draft = surveyGraph.applyPreviewInteriorAngle(draft, 120, 'pythagorean');
  const previewLength = surveyGraph.getActiveFloor(draft).session.previewLengthMm;
  draft = surveyGraph.commitPreviewLength(draft, previewLength, 'ble');
  const wall = surveyGraph.getActiveFloor(draft).walls[1];

  assert.equal(wall.angleSource, 'pythagorean');
  assert.equal(wall.angleInteriorDeg, 120);
  assert.equal(Math.round(wall.angleDeg), -60);
});

test('the latest confirmed diagonal can reopen as an angle preview without an orphan endpoint', () => {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  draft = commitWall(draft, { xMm: 3000, yMm: 0 }, 3000);
  draft = surveyGraph.setMode(draft, 'diagonal');
  draft = surveyGraph.startPreview(draft, { xMm: 4000, yMm: 1732 });
  draft = surveyGraph.applyPreviewInteriorAngle(draft, 120, 'manual');
  const previewLength = surveyGraph.getActiveFloor(draft).session.previewLengthMm;
  draft = surveyGraph.commitPreviewLength(draft, previewLength, 'manual');

  const next = surveyGraph.reopenLastDiagonalWallForAngle(draft);
  const floor = surveyGraph.getActiveFloor(next);
  const session = floor.session;

  assert.equal(floor.walls.length, 1);
  assert.equal(session.state, 'awaitingLength');
  assert.equal(session.mode, 'diagonal');
  assert.equal(session.previewLengthMm, previewLength);
  assert.equal(session.previewInteriorAngleDeg, 120);
  assert.equal(floor.nodes.some((node) => node.xMm === 4000 && node.yMm === 1732), false);
});
