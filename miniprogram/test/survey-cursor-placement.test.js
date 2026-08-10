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

function createClosedCornerCollinearClosureDraft() {
  let draft = createClosedDraft();
  const floor = surveyGraph.getActiveFloor(draft);
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    { xMm: 0, yMm: 2000 },
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  draft = surveyGraph.snapCursorToWall(
    surveyGraph.startWallSnap(draft),
    target.pointMm,
    target
  );
  draft = commitWall(draft, { xMm: 0, yMm: 5000 }, 3000);
  draft = commitWall(draft, { xMm: 3000, yMm: 5200 }, 3000);
  return commitWall(draft, { xMm: 3000, yMm: 4000 }, 1200);
}

test('repeated forward drags extend one collinear wall instead of creating segments', () => {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  draft = commitWall(draft, { xMm: 1011, yMm: 0 }, 1011);
  const wallId = surveyGraph.getActiveFloor(draft).walls[0].id;
  draft = commitWall(draft, { xMm: 2344, yMm: 0 }, 1333);
  draft = commitWall(draft, { xMm: 3927, yMm: 0 }, 1583);

  const floor = surveyGraph.getActiveFloor(draft);
  const wall = floor.walls[0];
  const start = surveyGraph.getNode(floor, wall.startNodeId);
  const end = surveyGraph.getNode(floor, wall.endNodeId);

  assert.equal(floor.walls.length, 1);
  assert.equal(floor.nodes.length, 2);
  assert.equal(wall.id, wallId);
  assert.equal(wall.lengthMm, 3927);
  assert.deepEqual({ xMm: start.xMm, yMm: start.yMm }, { xMm: 0, yMm: 0 });
  assert.deepEqual({ xMm: end.xMm, yMm: end.yMm }, { xMm: 3927, yMm: 0 });
  assert.equal(floor.session.anchorNodeId, wall.endNodeId);
});

test('a reverse drag shortens the editable terminal wall instead of reporting overlap', () => {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  draft = commitWall(draft, { xMm: 3900, yMm: 0 }, 3900);
  const initialWall = surveyGraph.getActiveFloor(draft).walls[0];
  const wallId = initialWall.id;
  const endNodeId = initialWall.endNodeId;

  draft = commitWall(draft, { xMm: 2400, yMm: 0 }, 1500);

  const floor = surveyGraph.getActiveFloor(draft);
  const wall = floor.walls[0];
  const end = surveyGraph.getNode(floor, wall.endNodeId);

  assert.equal(floor.walls.length, 1);
  assert.equal(wall.id, wallId);
  assert.equal(wall.endNodeId, endNodeId);
  assert.equal(wall.lengthMm, 2400);
  assert.deepEqual({ xMm: end.xMm, yMm: end.yMm }, { xMm: 2400, yMm: 0 });
  assert.equal(floor.session.anchorNodeId, wall.endNodeId);
});

test('terminal third-wall edits retain rectangle alignment for forward and reverse drags', () => {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  draft = commitWall(draft, { xMm: 3000, yMm: 0 }, 3000);
  draft = commitWall(draft, { xMm: 3000, yMm: 2000 }, 2000);
  draft = commitWall(draft, { xMm: 1200, yMm: 2000 }, 1800);

  draft = surveyGraph.startPreview(draft, { xMm: 20, yMm: 2000 });
  let floor = surveyGraph.getActiveFloor(draft);
  assert.deepEqual(floor.session.previewPoint, { xMm: 0, yMm: 2000 });
  assert.equal(floor.session.alignmentSnapGuide.type, 'rectangle-third-wall');

  draft = surveyGraph.cancelPending(draft);
  draft = commitWall(draft, { xMm: -1000, yMm: 2000 }, 2200);
  draft = surveyGraph.startPreview(draft, { xMm: 20, yMm: 2000 });
  floor = surveyGraph.getActiveFloor(draft);
  assert.deepEqual(floor.session.previewPoint, { xMm: 0, yMm: 2000 });
  assert.equal(floor.session.alignmentSnapGuide.type, 'rectangle-third-wall');

  draft = surveyGraph.commitPreviewLength(draft, floor.session.previewLengthMm, 'manual');
  const terminalWall = surveyGraph.getActiveFloor(draft).walls[2];
  const terminalEnd = surveyGraph.getNode(surveyGraph.getActiveFloor(draft), terminalWall.endNodeId);
  assert.equal(terminalWall.lengthMm, 3000);
  assert.deepEqual({ xMm: terminalEnd.xMm, yMm: terminalEnd.yMm }, { xMm: 0, yMm: 2000 });
});

test('deleting the current third wall retains rectangle alignment from the preceding wall', () => {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  draft = commitWall(draft, { xMm: 3000, yMm: 0 }, 3000);
  draft = commitWall(draft, { xMm: 3000, yMm: 2000 }, 2000);
  draft = commitWall(draft, { xMm: 1200, yMm: 2000 }, 1800);
  const thirdWallId = surveyGraph.getActiveFloor(draft).walls[2].id;

  draft = surveyGraph.deleteWall(surveyGraph.selectWall(draft, thirdWallId));
  let floor = surveyGraph.getActiveFloor(draft);
  assert.equal(floor.walls.length, 2);
  assert.equal(floor.session.activeSpaceStartWallIndex, 0);

  draft = surveyGraph.startPreview(draft, { xMm: 20, yMm: 2000 });
  floor = surveyGraph.getActiveFloor(draft);
  assert.deepEqual(floor.session.previewPoint, { xMm: 0, yMm: 2000 });
  assert.equal(floor.session.alignmentSnapGuide.type, 'rectangle-third-wall');
});

test('a direction change after extending a wall still creates a new wall', () => {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  draft = commitWall(draft, { xMm: 1000, yMm: 0 }, 1000);
  draft = commitWall(draft, { xMm: 2200, yMm: 0 }, 1200);
  draft = commitWall(draft, { xMm: 2200, yMm: 900 }, 900);

  const floor = surveyGraph.getActiveFloor(draft);
  assert.equal(floor.walls.length, 2);
  assert.equal(floor.walls[0].lengthMm, 2200);
  assert.equal(floor.walls[1].lengthMm, 900);
});

test('two confirmed perpendicular straight walls immediately offer a rectangular closure', () => {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  draft = commitWall(draft, { xMm: 3000, yMm: 0 }, 3000);
  draft = commitWall(draft, { xMm: 3000, yMm: 2000 }, 2000);

  const pendingFloor = surveyGraph.getActiveFloor(draft);
  assert.equal(pendingFloor.session.state, 'mergeClosing');
  assert.equal(pendingFloor.session.closeCandidateType, 'merge');
  assert.deepEqual(
    surveyGraph.getClosurePath(pendingFloor, pendingFloor.session).map(({ xMm, yMm }) => ({ xMm, yMm })),
    [
      { xMm: 3000, yMm: 2000 },
      { xMm: 0, yMm: 2000 },
      { xMm: 0, yMm: 0 }
    ]
  );

  const closedFloor = surveyGraph.getActiveFloor(surveyGraph.confirmClosure(draft));
  assert.equal(closedFloor.session.state, 'spaceClosed');
  assert.equal(closedFloor.spaces.filter((space) => space.closed).length, 1);
  assert.equal(closedFloor.walls.length, 4);
});

test('dragging the fourth straight wall onto the start vertex snaps and closes directly', () => {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  draft = commitWall(draft, { xMm: 3000, yMm: 0 }, 3000);
  draft = commitWall(draft, { xMm: 3000, yMm: 2000 }, 2000);
  draft = commitWall(draft, { xMm: 0, yMm: 2000 }, 3000);
  draft = surveyGraph.startPreview(draft, { xMm: 140, yMm: 80 });

  const previewFloor = surveyGraph.getActiveFloor(draft);
  assert.deepEqual(previewFloor.session.previewPoint, { xMm: 0, yMm: 0 });
  assert.equal(previewFloor.session.closeCandidateType, 'start');
  assert.equal(previewFloor.session.alignmentSnapGuide.type, 'start-vertex-closure');

  const closedFloor = surveyGraph.getActiveFloor(surveyGraph.confirmClosure(draft));
  assert.equal(closedFloor.session.state, 'spaceClosed');
  assert.equal(closedFloor.walls.length, 4);
  assert.equal(closedFloor.spaces.filter((space) => space.closed).length, 1);
});

test('a projected close candidate does not become a direct start-vertex snap', () => {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  draft = commitWall(draft, { xMm: 3000, yMm: 0 }, 3000);
  draft = commitWall(draft, { xMm: 3000, yMm: 2000 }, 2000);
  draft = commitWall(draft, { xMm: 0, yMm: 2000 }, 3000);
  draft = surveyGraph.startPreview(draft, { xMm: 400, yMm: 100 });

  const floor = surveyGraph.getActiveFloor(draft);
  assert.deepEqual(floor.session.previewPoint, { xMm: 0, yMm: 100 });
  assert.equal(floor.session.closeCandidateType, 'start');
  assert.notEqual(
    floor.session.alignmentSnapGuide && floor.session.alignmentSnapGuide.type,
    'start-vertex-closure'
  );
});

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
  assert.equal(target.snapLine, 'inner');
});

test('cursor placement can snap to the outer wall edge', () => {
  const draft = createWallDraft();
  const floor = surveyGraph.getActiveFloor(draft);
  const wall = floor.walls[0];
  const geometry = surveyGraph.buildWallSnapGeometry(floor, wall);
  const outerMidpoint = {
    xMm: Math.round((geometry.outerStart.xMm + geometry.outerEnd.xMm) / 2),
    yMm: Math.round((geometry.outerStart.yMm + geometry.outerEnd.yMm) / 2)
  };
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    outerMidpoint,
    surveyGraph.CLOSE_TOLERANCE_MM
  );

  assert.equal(target.type, 'wall');
  assert.equal(target.snapLine, 'outer');
  assert.deepEqual(target.pointMm, outerMidpoint);
});

test('cursor placement snaps a visible mitered outer corner to its topology node', () => {
  const draft = createClosedDraft();
  const floor = surveyGraph.getActiveFloor(draft);
  const wall = floor.walls[0];
  const geometry = surveyGraph.buildWallRenderGeometry(floor, wall);
  const nodeCount = floor.nodes.length;
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    geometry.outerStart,
    surveyGraph.CLOSE_TOLERANCE_MM
  );

  assert.equal(target.type, 'vertex');
  assert.equal(target.snapLine, 'outer');
  assert.equal(target.wallId, wall.id);
  assert.equal(target.nodeId, wall.startNodeId);
  assert.deepEqual(target.pointMm, geometry.outerStart);

  const next = surveyGraph.snapCursorToWall(
    surveyGraph.startWallSnap(draft),
    target.pointMm,
    target
  );
  const nextFloor = surveyGraph.getActiveFloor(next);
  assert.equal(nextFloor.nodes.length, nodeCount);
  assert.equal(nextFloor.session.anchorNodeId, wall.startNodeId);
  assert.equal(nextFloor.session.activeSpaceSharedSnapLine, 'outer');
  assert.equal(nextFloor.session.activeSpaceSharedStartT, 0);
});

test('an outer endpoint keeps its measurement side while the graph anchor stays on the topology node', () => {
  const draft = createWallDraft();
  const floor = surveyGraph.getActiveFloor(draft);
  const wall = floor.walls[0];
  const geometry = surveyGraph.buildWallSnapGeometry(floor, wall);
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    geometry.outerStart,
    surveyGraph.CLOSE_TOLERANCE_MM
  );

  assert.equal(target.type, 'vertex');
  assert.equal(target.snapLine, 'outer');

  const next = surveyGraph.snapCursorToWall(
    surveyGraph.startWallSnap(draft),
    target.pointMm,
    target
  );
  const nextFloor = surveyGraph.getActiveFloor(next);
  const anchor = surveyGraph.getNode(nextFloor, nextFloor.session.anchorNodeId);
  const sourceStart = surveyGraph.getNode(nextFloor, wall.startNodeId);
  assert.equal(nextFloor.session.activeSpaceSharedSnapLine, 'outer');
  assert.deepEqual({ xMm: anchor.xMm, yMm: anchor.yMm }, {
    xMm: sourceStart.xMm,
    yMm: sourceStart.yMm
  });
});

test('outer wall snap keeps rectangle guide and shared closure on one graph coordinate', () => {
  let draft = createClosedDraft();
  let floor = surveyGraph.getActiveFloor(draft);
  const wall = floor.walls[0];
  const geometry = surveyGraph.buildWallSnapGeometry(floor, wall);
  const outerPoint = {
    xMm: Math.round((geometry.outerStart.xMm + geometry.outerEnd.xMm) / 2),
    yMm: Math.round((geometry.outerStart.yMm + geometry.outerEnd.yMm) / 2)
  };
  const target = surveyGraph.getCursorPlacementTarget(floor, outerPoint, surveyGraph.CLOSE_TOLERANCE_MM);
  draft = surveyGraph.snapCursorToWall(surveyGraph.startWallSnap(draft), target.pointMm, target);
  draft = commitWall(draft, { xMm: outerPoint.xMm, yMm: outerPoint.yMm - 2000 }, 2000);
  draft = commitWall(draft, { xMm: outerPoint.xMm + 1200, yMm: outerPoint.yMm - 2000 }, 1200);
  draft = surveyGraph.startPreview(draft, { xMm: outerPoint.xMm + 1200, yMm: outerPoint.yMm + 100 });
  floor = surveyGraph.getActiveFloor(draft);

  assert.deepEqual(floor.session.previewPoint, floor.session.closeCandidatePoint);
  assert.equal(floor.session.alignmentSnapGuide.type, 'rectangle-third-wall');
  draft = surveyGraph.confirmClosure(draft);
  floor = surveyGraph.getActiveFloor(draft);
  assert.ok(floor.spaces.filter((space) => space.closed).length >= 2);
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

test('an open-wall snapped continuation does not reopen the initial measurement-side choice', () => {
  let draft = createWallDraft();
  draft = surveyGraph.snapCursorToWall(
    surveyGraph.startWallSnap(draft),
    { xMm: 0, yMm: 0 }
  );
  draft = commitWall(draft, { xMm: 0, yMm: 2000 }, 2000);

  const floor = surveyGraph.getActiveFloor(draft);
  const snappedWall = floor.walls[1];
  const originalSide = snappedWall.measurementSide;

  assert.ok(floor.session.activeSpaceSharedWallId);
  assert.equal(surveyGraph.canSetInitialMeasurementSide(floor, floor.session, snappedWall.id), false);

  const unchanged = surveyGraph.setMeasurementSide(
    draft,
    originalSide === 'left' ? 'right' : 'left',
    snappedWall.id
  );
  assert.equal(surveyGraph.getActiveFloor(unchanged).walls[1].measurementSide, originalSide);
});

test('closed-room inner and outer lower-left corners infer right and left measurement sides', () => {
  const closedDraft = createClosedDraft();
  const closedFloor = surveyGraph.getActiveFloor(closedDraft);
  const lowerLeftWall = closedFloor.walls.find((wall) => {
    const start = surveyGraph.getNode(closedFloor, wall.startNodeId);
    const end = surveyGraph.getNode(closedFloor, wall.endNodeId);
    return start && end && start.xMm === 0 && end.xMm === 0;
  });
  const outerCorner = surveyGraph.buildWallSnapGeometry(closedFloor, lowerLeftWall).outerStart;

  const cases = [
    {
      point: { xMm: 0, yMm: 2000 },
      expectedSnapLine: 'inner',
      expectedSide: 'right',
      expectedStartInsetMm: 200,
      expectedPreviewLengthMm: 2800
    },
    {
      point: outerCorner,
      expectedSnapLine: 'outer',
      expectedSide: 'left',
      expectedStartInsetMm: 200,
      expectedPreviewLengthMm: 2800
    }
  ];

  cases.forEach(({
    point,
    expectedSnapLine,
    expectedSide,
    expectedStartInsetMm,
    expectedPreviewLengthMm
  }) => {
    const target = surveyGraph.getCursorPlacementTarget(
      closedFloor,
      point,
      surveyGraph.CLOSE_TOLERANCE_MM
    );
    let draft = surveyGraph.snapCursorToWall(
      surveyGraph.startWallSnap(closedDraft),
      target.pointMm,
      target
    );
    draft = surveyGraph.startPreview(draft, { xMm: 0, yMm: 5000 });
    const floor = surveyGraph.getActiveFloor(draft);

    assert.equal(floor.session.activeSpaceSharedSnapLine, expectedSnapLine);
    assert.equal(floor.session.previewMeasurementSide, expectedSide);
    assert.equal(floor.session.measurementSide, expectedSide);
    assert.equal(floor.session.previewMeasurementStartInsetMm, expectedStartInsetMm);
    assert.equal(floor.session.previewLengthMm, expectedPreviewLengthMm);
    assert.equal(floor.session.closeCandidateType, '');
    assert.equal(surveyGraph.canSetInitialMeasurementSide(floor, floor.session), true);
  });
});

test('shared-corner measurement-side switching updates preview, committed wall, and following wall', () => {
  let draft = createClosedDraft();
  let floor = surveyGraph.getActiveFloor(draft);
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    { xMm: 0, yMm: 2000 },
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  draft = surveyGraph.snapCursorToWall(surveyGraph.startWallSnap(draft), target.pointMm, target);
  draft = surveyGraph.startPreview(draft, { xMm: 0, yMm: 5000 });
  draft = surveyGraph.setMeasurementSide(draft, 'left');
  floor = surveyGraph.getActiveFloor(draft);
  assert.equal(floor.session.previewMeasurementSide, 'left');

  draft = surveyGraph.commitPreviewLength(draft, 3000, 'manual');
  floor = surveyGraph.getActiveFloor(draft);
  const committedWall = floor.walls.at(-1);
  const committedStart = surveyGraph.getNode(floor, committedWall.startNodeId);
  const committedEnd = surveyGraph.getNode(floor, committedWall.endNodeId);
  assert.equal(committedWall.measurementSide, 'left');
  assert.equal(committedWall.measurementStartInsetMm, 200);
  assert.equal(committedWall.lengthMm, 3000);
  assert.equal(Math.hypot(
    committedEnd.xMm - committedStart.xMm,
    committedEnd.yMm - committedStart.yMm
  ), 3200);
  assert.equal(floor.session.measurementSide, 'left');
  assert.equal(floor.session.state, 'wallCommitted');
  assert.equal(floor.session.closeCandidateType, '');
  assert.equal(
    surveyGraph.canSetInitialMeasurementSide(floor, floor.session, floor.walls.at(-1).id),
    true
  );

  draft = surveyGraph.setMeasurementSide(draft, 'right', floor.walls.at(-1).id);
  floor = surveyGraph.getActiveFloor(draft);
  assert.equal(floor.walls.at(-1).measurementSide, 'right');

  draft = surveyGraph.startPreview(draft, { xMm: 1800, yMm: 5200 });
  floor = surveyGraph.getActiveFloor(draft);
  assert.equal(floor.session.previewMeasurementSide, 'right');
});

test('remeasuring an inset wall changes only the measured segment length', () => {
  let draft = createClosedDraft();
  let floor = surveyGraph.getActiveFloor(draft);
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    { xMm: 0, yMm: 2000 },
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  draft = surveyGraph.snapCursorToWall(surveyGraph.startWallSnap(draft), target.pointMm, target);
  draft = commitWall(draft, { xMm: 0, yMm: 5200 }, 3000);
  floor = surveyGraph.getActiveFloor(draft);
  const wallId = floor.walls.at(-1).id;

  draft = surveyGraph.startRemeasure(surveyGraph.selectWall(draft, wallId));
  draft = surveyGraph.remeasureSelectedWall(draft, 2800, 'manual');
  floor = surveyGraph.getActiveFloor(draft);
  const wall = floor.walls.at(-1);
  const start = surveyGraph.getNode(floor, wall.startNodeId);
  const end = surveyGraph.getNode(floor, wall.endNodeId);

  assert.equal(wall.lengthMm, 2800);
  assert.equal(wall.measurementStartInsetMm, 200);
  assert.equal(end.yMm - start.yMm, 3000);
});

test('a reset cursor can close a room with one wall between existing shared boundaries', () => {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  draft = commitWall(draft, { xMm: 3000, yMm: 0 }, 3000);
  draft = commitWall(draft, { xMm: 3000, yMm: 2000 }, 2000);
  draft = commitWall(draft, { xMm: 0, yMm: 2000 }, 3000);

  const beforeReset = surveyGraph.getActiveFloor(draft);
  const target = surveyGraph.getCursorPlacementTarget(
    beforeReset,
    { xMm: 1500, yMm: 0 },
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  draft = surveyGraph.snapCursorToWall(surveyGraph.startWallSnap(draft), target.pointMm, target);
  draft = commitWall(draft, { xMm: 1500, yMm: 2000 }, 2000);

  const pendingClosure = surveyGraph.getActiveFloor(draft);
  assert.equal(pendingClosure.session.state, 'closing');
  assert.equal(pendingClosure.session.closeCandidateType, 'shared-wall');

  const closed = surveyGraph.confirmClosure(draft);
  const closedFloor = surveyGraph.getActiveFloor(closed);
  assert.equal(closedFloor.session.state, 'spaceClosed');
  assert.equal(closedFloor.spaces.filter((space) => space.closed).length, 1);
});

test('a reset cursor offers the missing closing edge after two measured walls', () => {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.placeCursor(draft, { xMm: 3000, yMm: 0 });
  draft = commitWall(draft, { xMm: 0, yMm: 0 }, 3000);
  draft = commitWall(draft, { xMm: 0, yMm: 2000 }, 2000);

  const beforeReset = surveyGraph.getActiveFloor(draft);
  const target = surveyGraph.getCursorPlacementTarget(
    beforeReset,
    { xMm: 0, yMm: 2000 },
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  draft = surveyGraph.snapCursorToWall(surveyGraph.startWallSnap(draft), target.pointMm, target);
  draft = commitWall(draft, { xMm: 3000, yMm: 2000 }, 3000);

  const pendingClosure = surveyGraph.getActiveFloor(draft);
  assert.equal(pendingClosure.session.state, 'mergeClosing');
  assert.equal(pendingClosure.session.closeCandidateType, 'merge');

  const closed = surveyGraph.confirmClosure(draft);
  const closedFloor = surveyGraph.getActiveFloor(closed);
  assert.equal(closedFloor.session.state, 'spaceClosed');
  assert.equal(closedFloor.spaces.filter((space) => space.closed).length, 1);
});

test('a closed-room second wall snaps to inner and outer corners without offering closure', () => {
  let draft = createClosedDraft();
  let floor = surveyGraph.getActiveFloor(draft);
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    { xMm: 0, yMm: 2000 },
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  draft = surveyGraph.snapCursorToWall(
    surveyGraph.startWallSnap(draft),
    target.pointMm,
    target
  );
  draft = commitWall(draft, { xMm: 0, yMm: 5000 }, 3000);
  const innerDraft = surveyGraph.startPreview(draft, { xMm: 2900, yMm: 5200 });
  const innerSession = surveyGraph.getActiveFloor(innerDraft).session;
  assert.equal(
    surveyGraph.getMinimumClosureSuggestionWallCount(
      surveyGraph.getActiveFloor(innerDraft),
      innerSession
    ),
    3
  );
  assert.deepEqual(innerSession.previewPoint, { xMm: 3000, yMm: 5200 });
  assert.equal(innerSession.alignmentSnapGuide.snapLine, 'inner');
  assert.equal(innerSession.closeCandidateType, '');

  const outerDraft = surveyGraph.startPreview(draft, { xMm: 3170, yMm: 5200 });
  const outerSession = surveyGraph.getActiveFloor(outerDraft).session;
  assert.deepEqual(outerSession.previewPoint, { xMm: 3200, yMm: 5200 });
  assert.equal(outerSession.alignmentSnapGuide.snapLine, 'outer');
  assert.equal(outerSession.closeCandidateType, '');
});

test('a collinear closed-corner closure stays aligned and extends the current wall', () => {
  const pendingDraft = createClosedCornerCollinearClosureDraft();
  const pendingFloor = surveyGraph.getActiveFloor(pendingDraft);
  const currentWall = pendingFloor.walls.at(-1);
  const currentEnd = surveyGraph.getNode(pendingFloor, currentWall.endNodeId);
  const closurePath = surveyGraph.getClosurePath(pendingFloor, pendingFloor.session);
  const wallCountBeforeClose = pendingFloor.walls.length;

  assert.equal(pendingFloor.session.state, 'mergeClosing');
  assert.deepEqual(closurePath, [
    { xMm: currentEnd.xMm, yMm: currentEnd.yMm },
    { xMm: currentEnd.xMm, yMm: 2200 }
  ]);

  const closedFloor = surveyGraph.getActiveFloor(surveyGraph.confirmClosure(pendingDraft));
  const extendedWall = surveyGraph.getWall(closedFloor, currentWall.id);
  const extendedEnd = surveyGraph.getNode(closedFloor, extendedWall.endNodeId);
  const closedSpace = closedFloor.spaces.at(-1);

  assert.equal(closedFloor.session.state, 'spaceClosed');
  assert.equal(closedFloor.walls.length, wallCountBeforeClose);
  assert.equal(closedSpace.wallIds.includes(currentWall.id), true);
  assert.equal(closedSpace.wallIds.length, 4);
  assert.deepEqual({ xMm: extendedEnd.xMm, yMm: extendedEnd.yMm }, { xMm: 3000, yMm: 2000 });
  assert.equal(extendedWall.lengthMm, 3000);
  assert.equal(extendedWall.measurementEndInsetMm, 200);
  assert.equal(extendedWall.inputSource, 'closure-merge');
});

test('an offset adjacent room closes through the source shared wall without swallowing the first room', () => {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  draft = commitWall(draft, { xMm: 2233, yMm: 0 }, 2233);
  draft = commitWall(draft, { xMm: 2233, yMm: 3182 }, 3182);
  draft = commitWall(draft, { xMm: 0, yMm: 3182 }, 2233);
  draft = commitWall(draft, { xMm: 0, yMm: 0 }, 3182);
  draft = surveyGraph.confirmClosure(draft);

  let floor = surveyGraph.getActiveFloor(draft);
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    { xMm: 0, yMm: 3182 },
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  draft = surveyGraph.snapCursorToWall(
    surveyGraph.startWallSnap(draft),
    target.pointMm,
    target
  );
  draft = commitWall(draft, { xMm: 0, yMm: 7318 }, 4136);
  draft = commitWall(draft, { xMm: 2433, yMm: 7518 }, 2433);
  draft = commitWall(draft, { xMm: 2433, yMm: 5484 }, 2034);

  floor = surveyGraph.getActiveFloor(draft);
  const closeTarget = surveyGraph.getNode(floor, floor.session.closeCandidateNodeId);
  assert.deepEqual(
    { xMm: closeTarget.xMm, yMm: closeTarget.yMm },
    { xMm: 2233, yMm: 3182 }
  );
  assert.deepEqual(
    surveyGraph.getClosurePath(floor, floor.session).map(({ xMm, yMm }) => ({ xMm, yMm })),
    [
      { xMm: 2433, yMm: 5484 },
      { xMm: 2433, yMm: 3182 },
      { xMm: 2233, yMm: 3182 }
    ]
  );

  floor = surveyGraph.getActiveFloor(surveyGraph.confirmClosure(draft));
  const adjacentSpace = floor.spaces.at(-1);
  const adjacentWalls = adjacentSpace.wallIds.map((wallId) => surveyGraph.getWall(floor, wallId));

  assert.equal(floor.spaces.filter((space) => space.closed).length, 2);
  assert.equal(adjacentSpace.wallIds.length, 5);
  assert.deepEqual(adjacentWalls.map((wall) => wall.lengthMm), [4136, 2433, 4136, 0, 2233]);
  assert.deepEqual(
    surveyGraph.buildSpaceBoundaryPoints(floor, adjacentSpace.wallIds).map(({ xMm, yMm }) => ({ xMm, yMm })),
    [
      { xMm: 0, yMm: 3182 },
      { xMm: 0, yMm: 7518 },
      { xMm: 2433, yMm: 7518 },
      { xMm: 2433, yMm: 3182 },
      { xMm: 2233, yMm: 3182 }
    ]
  );
});

test('a stepped straight-wall chain closes with two orthogonal edges instead of a diagonal', () => {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  draft = commitWall(draft, { xMm: 2748, yMm: 0 }, 2748);
  draft = commitWall(draft, { xMm: 2748, yMm: 2036 }, 2036);
  draft = commitWall(draft, { xMm: 5837, yMm: 2036 }, 3089);
  draft = commitWall(draft, { xMm: 5837, yMm: 5219 }, 3183);
  draft = commitWall(draft, { xMm: 3419, yMm: 5219 }, 2418);

  const pendingFloor = surveyGraph.getActiveFloor(draft);
  assert.equal(pendingFloor.session.state, 'mergeClosing');
  assert.deepEqual(
    surveyGraph.getClosurePath(pendingFloor, pendingFloor.session).map(({ xMm, yMm }) => ({ xMm, yMm })),
    [
      { xMm: 3419, yMm: 5219 },
      { xMm: 0, yMm: 5219 },
      { xMm: 0, yMm: 0 }
    ]
  );
  const collinearWallId = pendingFloor.walls.at(-1).id;

  const closedFloor = surveyGraph.getActiveFloor(surveyGraph.confirmClosure(draft));
  const closingWalls = closedFloor.walls.slice(-2);
  assert.equal(closedFloor.session.state, 'spaceClosed');
  assert.equal(closedFloor.walls.length, 6);
  assert.equal(closingWalls[0].id, collinearWallId);
  assert.deepEqual(closingWalls.map((wall) => wall.lengthMm), [5837, 5219]);
  assert.deepEqual(closingWalls.map((wall) => wall.angleDeg), [180, -90]);
  assert.equal(closingWalls.every((wall) => wall.mode === 'straight'), true);
  assert.equal(closingWalls.every((wall) => wall.inputSource === 'closure-merge'), true);
});

test('a reset cursor restores right-angle snapping when its first wall nearly completes a rectangle', () => {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.placeCursor(draft, { xMm: 3000, yMm: 0 });
  draft = commitWall(draft, { xMm: 0, yMm: 0 }, 3000);
  draft = commitWall(draft, { xMm: 0, yMm: 2000 }, 2000);

  const beforeReset = surveyGraph.getActiveFloor(draft);
  const target = surveyGraph.getCursorPlacementTarget(
    beforeReset,
    { xMm: 0, yMm: 2000 },
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  draft = surveyGraph.snapCursorToWall(surveyGraph.startWallSnap(draft), target.pointMm, target);
  draft = surveyGraph.startPreview(draft, { xMm: 2920, yMm: 2000 });

  let floor = surveyGraph.getActiveFloor(draft);
  const closureNode = surveyGraph.getNode(floor, floor.session.closeCandidateNodeId);
  assert.deepEqual(floor.session.previewPoint, { xMm: 3000, yMm: 2000 });
  assert.deepEqual({ xMm: closureNode.xMm, yMm: closureNode.yMm }, { xMm: 3000, yMm: 0 });
  assert.equal(floor.session.closeCandidateType, 'merge');
  assert.equal(floor.session.alignmentSnapGuide.type, 'rectangle-third-wall');

  draft = surveyGraph.confirmClosure(draft);
  floor = surveyGraph.getActiveFloor(draft);
  assert.equal(floor.session.state, 'spaceClosed');
  assert.equal(floor.spaces.filter((space) => space.closed).length, 1);
});

test('a closed-room corner restart aligns the second wall without offering adjacent-room closure', () => {
  let draft = createClosedDraft();
  let floor = surveyGraph.getActiveFloor(draft);
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    { xMm: 3000, yMm: 2000 },
    surveyGraph.CLOSE_TOLERANCE_MM
  );

  assert.equal(target.type, 'vertex');
  draft = surveyGraph.snapCursorToWall(
    surveyGraph.startWallSnap(draft),
    target.pointMm,
    target
  );
  draft = commitWall(draft, { xMm: 3000, yMm: 5000 }, 3000);
  draft = surveyGraph.startPreview(draft, { xMm: 80, yMm: 5200 });
  floor = surveyGraph.getActiveFloor(draft);

  assert.deepEqual(floor.session.previewPoint, { xMm: 0, yMm: 5200 });
  assert.equal(floor.session.previewLengthMm, 3000);
  assert.equal(floor.session.alignmentSnapGuide.type, 'rectangle-third-wall');
  assert.equal(floor.session.alignmentSnapGuide.snapLine, 'inner');
  assert.equal(floor.session.closeCandidateType, '');

  draft = surveyGraph.commitPreviewLength(draft, 3000, 'manual');
  floor = surveyGraph.getActiveFloor(draft);
  assert.equal(floor.session.state, 'wallCommitted');
  assert.equal(floor.session.closeCandidateType, '');
  assert.equal(floor.spaces.filter((space) => space.closed).length, 1);
  assert.equal(floor.walls.at(-2).measurementStartInsetMm, 200);
});

test('confirmed near-axis lengths retain rectangle snapping after BLE/manual confirmation', () => {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  draft = commitWall(draft, { xMm: 3000, yMm: 0 }, 3000);
  draft = commitWall(draft, { xMm: 3000, yMm: 2000 }, 2000);
  draft = surveyGraph.startPreview(draft, { xMm: 80, yMm: 2000 });

  draft = surveyGraph.commitPreviewLength(draft, 2920, 'ble');
  const floor = surveyGraph.getActiveFloor(draft);
  const endNode = surveyGraph.getNode(floor, floor.session.anchorNodeId);

  assert.deepEqual({ xMm: endNode.xMm, yMm: endNode.yMm }, { xMm: 0, yMm: 2000 });
  assert.equal(floor.session.state, 'mergeClosing');
  assert.equal(floor.session.closeCandidateType, 'merge');
});

test('deleting a closed-room wall clears stale cursor snap and keeps the missing-wall closure path', () => {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  draft = commitWall(draft, { xMm: 3000, yMm: 0 }, 3000);
  draft = commitWall(draft, { xMm: 3000, yMm: 2000 }, 2000);
  draft = commitWall(draft, { xMm: 0, yMm: 2000 }, 3000);
  draft = commitWall(draft, { xMm: 0, yMm: 0 }, 2000);
  draft = surveyGraph.confirmClosure(draft);

  let floor = surveyGraph.getActiveFloor(draft);
  const corner = surveyGraph.getCursorPlacementTarget(
    floor,
    { xMm: 3000, yMm: 2000 },
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  draft = surveyGraph.snapCursorToWall(
    surveyGraph.startWallSnap(draft),
    corner.pointMm,
    corner
  );
  draft = commitWall(draft, { xMm: 3000, yMm: 5000 }, 3000);
  draft = surveyGraph.startPreview(draft, { xMm: 80, yMm: 5000 });
  draft = surveyGraph.commitPreviewLength(draft, 2920, 'manual');
  draft = commitWall(draft, { xMm: 0, yMm: 2000 }, 3000);
  draft = surveyGraph.confirmClosure(draft);

  floor = surveyGraph.getActiveFloor(draft);
  const lowerRoom = floor.spaces.at(-1);
  const deletedLeftWall = lowerRoom.wallIds
    .map((id) => surveyGraph.getWall(floor, id))
    .find((wall) => {
      const start = surveyGraph.getNode(floor, wall.startNodeId);
      const end = surveyGraph.getNode(floor, wall.endNodeId);
      return start && end && start.xMm === 0 && end.xMm === 0;
    });
  assert.ok(deletedLeftWall);

  draft = surveyGraph.deleteWall(draft, deletedLeftWall.id);
  draft = surveyGraph.resetCursor(draft);
  floor = surveyGraph.getActiveFloor(draft);
  assert.equal(floor.session.lastWallSnapNodeId, '');
  assert.equal(floor.session.lastWallSnapWallId, '');

  draft = surveyGraph.snapCursorToWall(
    surveyGraph.startWallSnap(draft),
    { xMm: 0, yMm: 5000 }
  );
  draft = surveyGraph.startPreview(draft, { xMm: 80, yMm: 2000 });
  floor = surveyGraph.getActiveFloor(draft);

  assert.deepEqual(floor.session.previewPoint, { xMm: 0, yMm: 2000 });
  assert.equal(floor.session.alignmentSnapGuide.type, 'rectangle-third-wall');
  assert.equal(floor.session.closeCandidateType, 'shared-wall');
  assert.deepEqual(floor.session.closeCandidatePoint, { xMm: 0, yMm: 2000 });

  draft = surveyGraph.commitPreviewLength(draft, 3000, 'manual');
  floor = surveyGraph.getActiveFloor(draft);
  assert.equal(floor.session.state, 'closing');
  draft = surveyGraph.confirmClosure(draft);
  floor = surveyGraph.getActiveFloor(draft);
  assert.equal(floor.session.state, 'spaceClosed');
  assert.equal(floor.spaces.filter((space) => space.closed).length, 2);
});

test('a free-standing wall chain still allows its initial measurement-side choice', () => {
  let draft = createWallDraft();
  draft = surveyGraph.placeNewWallChainCursor(draft, { xMm: 6000, yMm: 0 });
  draft = commitWall(draft, { xMm: 9000, yMm: 0 }, 3000);

  const floor = surveyGraph.getActiveFloor(draft);
  const independentWall = floor.walls[1];

  assert.equal(floor.session.activeSpaceSharedWallId, '');
  assert.equal(surveyGraph.canSetInitialMeasurementSide(floor, floor.session, independentWall.id), true);
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

test('the close action commits and closes a pending diagonal preview', () => {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  draft = commitWall(draft, { xMm: 3600, yMm: 0 }, 3600);
  draft = commitWall(draft, { xMm: 3600, yMm: 3000 }, 3000);
  draft = surveyGraph.setMode(draft, 'diagonal');
  draft = surveyGraph.startPreview(draft, { xMm: 0, yMm: 0 });
  draft = surveyGraph.holdPreviewForInput(draft);

  const pendingSession = surveyGraph.getActiveFloor(draft).session;
  assert.equal(pendingSession.state, 'awaitingLength');
  assert.ok(pendingSession.closeCandidateNodeId);

  const next = surveyGraph.confirmClosure(draft);
  const floor = surveyGraph.getActiveFloor(next);
  const diagonalWall = floor.walls[2];

  assert.equal(floor.walls.length, 3);
  assert.equal(diagonalWall.mode, 'diagonal');
  assert.equal(diagonalWall.inputSource, 'closure-preview');
  assert.equal(floor.spaces.length, 1);
  assert.equal(floor.spaces[0].closed, true);
  assert.equal(floor.session.state, 'spaceClosed');
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
