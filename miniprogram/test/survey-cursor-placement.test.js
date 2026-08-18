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

function createClosedDraft(widthMm = 3000) {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  draft = commitWall(draft, { xMm: widthMm, yMm: 0 }, widthMm);
  draft = commitWall(draft, { xMm: widthMm, yMm: 2000 }, 2000);
  draft = commitWall(draft, { xMm: 0, yMm: 2000 }, widthMm);
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
  assert.equal(
    surveyGraph.isDirectClosureHit(previewFloor, previewFloor.session, { xMm: 140, yMm: 80 }),
    true
  );

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
  assert.equal(
    surveyGraph.isDirectClosureHit(floor, floor.session, { xMm: 400, yMm: 100 }),
    false
  );
  assert.notEqual(
    floor.session.alignmentSnapGuide && floor.session.alignmentSnapGuide.type,
    'start-vertex-closure'
  );
});

test('dragging an adjacent straight room onto a shared-wall closure point closes directly', () => {
  let draft = createClosedDraft();
  let floor = surveyGraph.getActiveFloor(draft);
  const startTarget = surveyGraph.getCursorPlacementTarget(
    floor,
    { xMm: 3000, yMm: 0 },
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  draft = surveyGraph.snapCursorToWall(
    surveyGraph.startWallSnap(draft),
    startTarget.pointMm,
    startTarget
  );
  draft = commitWall(draft, { xMm: 6000, yMm: 0 }, 3000);
  draft = commitWall(draft, { xMm: 6000, yMm: 2000 }, 2000);
  draft = surveyGraph.startPreview(draft, { xMm: 3120, yMm: 2000 });

  floor = surveyGraph.getActiveFloor(draft);
  assert.equal(floor.session.closeCandidateType, 'shared-wall');
  assert.deepEqual(floor.session.closeCandidatePoint, { xMm: 3000, yMm: 2000 });
  assert.deepEqual(floor.session.previewPoint, floor.session.closeCandidatePoint);
  assert.equal(
    surveyGraph.isDirectClosureHit(floor, floor.session, { xMm: 4200, yMm: 3100 }),
    true
  );

  floor = surveyGraph.getActiveFloor(surveyGraph.confirmClosure(draft));
  assert.equal(floor.spaces.filter((space) => space.closed).length, 2);
  assert.equal(floor.session.state, 'spaceClosed');
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

test('cursor placement separates inner and outer corners inside a closed wall body', () => {
  const floor = surveyGraph.getActiveFloor(createClosedDraft());
  const wall = floor.walls[0];
  const node = surveyGraph.getNode(floor, wall.startNodeId);
  const geometry = surveyGraph.buildWallRenderGeometry(floor, wall);
  const nearInnerPoint = {
    xMm: Math.round(node.xMm + (geometry.outerStart.xMm - node.xMm) * 0.25),
    yMm: Math.round(node.yMm + (geometry.outerStart.yMm - node.yMm) * 0.25)
  };
  const innerTarget = surveyGraph.getCursorPlacementTarget(
    floor,
    nearInnerPoint,
    surveyGraph.CLOSE_TOLERANCE_MM
  );

  assert.equal(innerTarget.type, 'vertex');
  assert.equal(innerTarget.snapLine, undefined);
  assert.equal(innerTarget.nodeId, wall.startNodeId);
  assert.deepEqual(innerTarget.pointMm, { xMm: node.xMm, yMm: node.yMm });

  const wallBodyInnerZonePoint = {
    xMm: Math.round(node.xMm + (geometry.outerStart.xMm - node.xMm) * 0.6),
    yMm: Math.round(node.yMm + (geometry.outerStart.yMm - node.yMm) * 0.6)
  };
  const wallBodyInnerZoneTarget = surveyGraph.getCursorPlacementTarget(
    floor,
    wallBodyInnerZonePoint,
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  assert.equal(wallBodyInnerZoneTarget.type, 'vertex');
  assert.equal(wallBodyInnerZoneTarget.snapLine, undefined);
  assert.equal(wallBodyInnerZoneTarget.nodeId, wall.startNodeId);
  assert.deepEqual(wallBodyInnerZoneTarget.pointMm, { xMm: node.xMm, yMm: node.yMm });

  const nearOuterPoint = {
    xMm: Math.round(node.xMm + (geometry.outerStart.xMm - node.xMm) * 0.75),
    yMm: Math.round(node.yMm + (geometry.outerStart.yMm - node.yMm) * 0.75)
  };
  const outerTarget = surveyGraph.getCursorPlacementTarget(
    floor,
    nearOuterPoint,
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  assert.equal(outerTarget.type, 'vertex');
  assert.equal(outerTarget.snapLine, 'outer');
  assert.equal(outerTarget.nodeId, wall.startNodeId);
  assert.deepEqual(outerTarget.pointMm, geometry.outerStart);
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

test('a perpendicular wall pulled from a wall middle immediately materializes a T junction', () => {
  let draft = createClosedDraft();
  let floor = surveyGraph.getActiveFloor(draft);
  const sourceWall = floor.walls[0];
  const sourceSpaceId = floor.spaces[0].id;
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    { xMm: 1500, yMm: 0 },
    surveyGraph.CLOSE_TOLERANCE_MM
  );

  assert.equal(target.type, 'wall');
  draft = surveyGraph.snapCursorToWall(
    surveyGraph.startWallSnap(draft),
    target.pointMm,
    target
  );
  floor = surveyGraph.getActiveFloor(draft);
  const junctionNodeId = floor.session.anchorNodeId;
  assert.equal(floor.walls.length, 4);
  assert.equal(floor.walls.some((w) => w.id === sourceWall.id), true);

  draft = commitWall(draft, { xMm: 1500, yMm: -1692 }, 1692);
  floor = surveyGraph.getActiveFloor(draft);
  const sourceSpace = floor.spaces.find((space) => space.id === sourceSpaceId);
  const sourceSegments = floor.walls.filter((wall) => (
    wall.topologySourceWallId === sourceWall.id
  ));
  assert.deepEqual(
    sourceSegments.map((wall) => [wall.startNodeId, wall.endNodeId]),
    [
      [sourceWall.startNodeId, junctionNodeId],
      [junctionNodeId, sourceWall.endNodeId]
    ]
  );
  assert.deepEqual(
    sourceSegments.map((wall) => sourceSpace.wallIds.includes(wall.id)),
    [true, true]
  );
  floor = surveyGraph.getActiveFloor(draft);
  const committedSourceSegments = floor.walls.filter((wall) => (
    wall.topologySourceWallId === sourceWall.id
  ));
  const incidentWalls = floor.walls.filter((wall) => (
    wall.startNodeId === junctionNodeId || wall.endNodeId === junctionNodeId
  ));
  const branchWall = incidentWalls.find((wall) => (
    wall.topologySourceWallId !== sourceWall.id
  ));
  const firstSourceGeometry = surveyGraph.buildWallRenderGeometry(floor, committedSourceSegments[0]);
  const secondSourceGeometry = surveyGraph.buildWallRenderGeometry(floor, committedSourceSegments[1]);
  const branchGeometry = surveyGraph.buildWallRenderGeometry(floor, branchWall);

  assert.equal(incidentWalls.length, 3);
  assert.ok(branchWall);
  assert.equal(branchWall.startNodeId, junctionNodeId);
  assert.equal(branchWall.measurementStartInsetMm, 200);
  assert.equal(branchWall.lengthMm, 1692);
  assert.equal(surveyGraph.distanceMm(
    surveyGraph.getNode(floor, branchWall.startNodeId),
    surveyGraph.getNode(floor, branchWall.endNodeId)
  ), 1892);
  assert.deepEqual(
    committedSourceSegments.map((wall) => [
      wall.measurementStartInsetMm || 0,
      wall.measurementEndInsetMm || 0,
      wall.lengthMm
    ]),
    [[0, 0, 1500], [200, 0, 1300]]
  );
  assert.deepEqual(firstSourceGeometry.end, { xMm: 1500, yMm: 0 });
  assert.deepEqual(secondSourceGeometry.start, { xMm: 1700, yMm: 0 });
  assert.deepEqual(branchGeometry.start, { xMm: 1500, yMm: -200 });
  assert.equal(floor.spaces.filter((space) => space.closed).length, 1);
});

test('a collinear wall pulled outward from a closed inner corner excludes the corner wall thickness', () => {
  let draft = createClosedDraft();
  let floor = surveyGraph.getActiveFloor(draft);
  const sourceSpaceId = floor.spaces[0].id;
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
  const junctionNodeId = surveyGraph.getActiveFloor(draft).session.anchorNodeId;
  draft = surveyGraph.startPreview(draft, { xMm: -2001, yMm: 2000 });
  floor = surveyGraph.getActiveFloor(draft);
  assert.equal(floor.session.previewMeasurementStartInsetMm, 200);
  assert.equal(floor.session.previewLengthMm, 1801);

  draft = surveyGraph.commitPreviewLength(draft, 1801, 'manual');
  floor = surveyGraph.getActiveFloor(draft);
  const wall = floor.walls.at(-1);
  const geometry = surveyGraph.buildWallRenderGeometry(floor, wall);
  const incidentWalls = floor.walls.filter((candidate) => (
    candidate.startNodeId === junctionNodeId || candidate.endNodeId === junctionNodeId
  ));

  assert.equal(wall.startNodeId, junctionNodeId);
  assert.equal(wall.measurementStartInsetMm, 200);
  assert.equal(wall.lengthMm, 1801);
  assert.equal(surveyGraph.distanceMm(
    surveyGraph.getNode(floor, wall.startNodeId),
    surveyGraph.getNode(floor, wall.endNodeId)
  ), 2001);
  assert.deepEqual(geometry.start, { xMm: -200, yMm: 2000 });
  assert.deepEqual(geometry.end, { xMm: -2001, yMm: 2000 });
  assert.equal(incidentWalls.length, 3);
  assert.equal(floor.spaces.find((space) => space.id === sourceSpaceId).closed, true);
  assert.equal(floor.spaces.filter((space) => space.closed).length, 1);
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

test('inner and outer wall-middle T starts retain one topology path and distinct source boundaries', () => {
  const base = createClosedDraft();
  const floor = surveyGraph.getActiveFloor(base);
  const wall = floor.walls[0];
  const geometry = surveyGraph.buildWallSnapGeometry(floor, wall);
  const innerMidpoint = {
    xMm: Math.round((geometry.start.xMm + geometry.end.xMm) / 2),
    yMm: Math.round((geometry.start.yMm + geometry.end.yMm) / 2)
  };
  const outerMidpoint = {
    xMm: Math.round((geometry.outerStart.xMm + geometry.outerEnd.xMm) / 2),
    yMm: Math.round((geometry.outerStart.yMm + geometry.outerEnd.yMm) / 2)
  };

  const innerTarget = surveyGraph.getCursorPlacementTarget(
    floor,
    innerMidpoint,
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  let innerDraft = surveyGraph.snapCursorToWall(
    surveyGraph.startWallSnap(base),
    innerTarget.pointMm,
    innerTarget
  );
  innerDraft = surveyGraph.startPreview(innerDraft, { xMm: innerMidpoint.xMm, yMm: -2000 });
  const innerSession = surveyGraph.getActiveFloor(innerDraft).session;
  assert.equal(innerSession.activeSpaceSharedSnapLine, 'inner');
  assert.equal(innerSession.activeSpaceSharedWallMiddle, true);
  assert.equal(innerSession.previewMeasurementStartInsetMm, 200);
  assert.equal(innerSession.previewLengthMm, 1800);

  const outerTarget = surveyGraph.getCursorPlacementTarget(
    floor,
    outerMidpoint,
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  let outerDraft = surveyGraph.snapCursorToWall(
    surveyGraph.startWallSnap(base),
    outerTarget.pointMm,
    outerTarget
  );
  outerDraft = surveyGraph.startPreview(outerDraft, { xMm: outerMidpoint.xMm, yMm: -2000 });
  const outerSession = surveyGraph.getActiveFloor(outerDraft).session;
  assert.equal(outerSession.activeSpaceSharedSnapLine, 'outer');
  assert.equal(outerSession.activeSpaceSharedWallMiddle, true);
  assert.equal(outerSession.previewMeasurementStartInsetMm, 200);
  assert.equal(outerSession.previewLengthMm, 1800);
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

test('explicit inner vertex target is preserved when snapping a closed-room cursor', () => {
  const draft = createClosedDraft();
  const floor = surveyGraph.getActiveFloor(draft);
  const wall = floor.walls[0];
  const node = surveyGraph.getNode(floor, wall.startNodeId);
  const innerTarget = surveyGraph.getCursorPlacementTarget(
    floor,
    { xMm: node.xMm, yMm: node.yMm },
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  const next = surveyGraph.snapCursorToWall(
    surveyGraph.startWallSnap(draft),
    innerTarget.pointMm,
    innerTarget
  );
  const nextFloor = surveyGraph.getActiveFloor(next);
  assert.equal(nextFloor.session.activeSpaceSharedSnapLine, 'inner');
  const displayPoint = surveyGraph.getCursorDisplayPoint(nextFloor, nextFloor.session);
  assert.deepEqual(
    { xMm: displayPoint.xMm, yMm: displayPoint.yMm },
    { xMm: node.xMm, yMm: node.yMm }
  );
});

test('a near-inner touch closes the photographed adjacent room on the selected inner corners', () => {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  draft = commitWall(draft, { xMm: 2044, yMm: 0 }, 2044);
  draft = commitWall(draft, { xMm: 2044, yMm: 3799 }, 3799);
  draft = commitWall(draft, { xMm: 0, yMm: 3799 }, 2044);
  draft = commitWall(draft, { xMm: 0, yMm: 0 }, 3799);
  draft = surveyGraph.confirmClosure(draft);

  let floor = surveyGraph.getActiveFloor(draft);
  const roomOneBefore = surveyGraph.buildSpaceBoundaryPoints(
    floor,
    floor.spaces[0].wallIds
  ).map(({ xMm, yMm }) => ({ xMm, yMm }));
  const startNode = surveyGraph.getNode(floor, floor.walls[2].endNodeId);
  const cornerGeometry = surveyGraph.buildWallRenderGeometry(floor, floor.walls[2]);
  const nearInnerPoint = {
    xMm: Math.round(startNode.xMm + (cornerGeometry.outerEnd.xMm - startNode.xMm) * 0.6),
    yMm: Math.round(startNode.yMm + (cornerGeometry.outerEnd.yMm - startNode.yMm) * 0.6)
  };
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    nearInnerPoint,
    surveyGraph.CLOSE_TOLERANCE_MM
  );

  assert.equal(target.type, 'vertex');
  assert.equal(target.snapLine, undefined);
  assert.deepEqual(target.pointMm, { xMm: 0, yMm: 3799 });

  draft = surveyGraph.snapCursorToWall(
    surveyGraph.startWallSnap(draft),
    target.pointMm,
    target
  );
  assert.equal(surveyGraph.getActiveFloor(draft).session.activeSpaceSharedSnapLine, 'inner');
  draft = commitWall(draft, { xMm: -1896, yMm: 3799 }, 1896);
  draft = commitWall(draft, { xMm: -1896, yMm: 0 }, 3799);
  draft = commitWall(draft, { xMm: 0, yMm: 0 }, 1896);

  floor = surveyGraph.getActiveFloor(draft);
  const activeWalls = floor.walls.slice(floor.session.activeSpaceStartWallIndex);
  const closeNode = surveyGraph.getNode(floor, floor.session.closeCandidateNodeId);
  assert.equal(floor.session.state, 'closing');
  assert.deepEqual({ xMm: closeNode.xMm, yMm: closeNode.yMm }, { xMm: 0, yMm: 0 });
  assert.deepEqual(activeWalls.map((wall) => wall.lengthMm), [1896, 3799, 1896]);
  assert.deepEqual(activeWalls.map((wall) => wall.measurementStartInsetMm || 0), [200, 0, 0]);
  assert.deepEqual(activeWalls.map((wall) => wall.measurementEndInsetMm || 0), [0, 0, 200]);

  floor = surveyGraph.getActiveFloor(surveyGraph.confirmClosure(draft));
  const roomOneAfter = surveyGraph.buildSpaceBoundaryPoints(
    floor,
    floor.spaces[0].wallIds
  ).map(({ xMm, yMm }) => ({ xMm, yMm }));
  const roomTwo = floor.spaces[1];
  const roomTwoPlan = surveyGraph.buildSpaceDimensionPlan(floor, roomTwo);
  assert.equal(floor.spaces.filter((space) => space.closed).length, 2);
  assert.deepEqual(roomOneAfter, roomOneBefore);
  assert.deepEqual(roomTwoPlan.inner, {
    widthMm: 1896,
    heightMm: 3799,
    areaMm2: 7202904
  });
  assert.equal(roomTwo.wallFaceOverrides[floor.spaces[0].wallIds[3]], 'offset');
});

test('an outer-corner drop keeps the topology anchor on the centerline and the stationary cursor on the outer corner', () => {
  const draft = createClosedDraft();
  const floor = surveyGraph.getActiveFloor(draft);
  const wall = floor.walls[0];
  const geometry = surveyGraph.buildWallRenderGeometry(floor, wall);
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    geometry.outerStart,
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  const snappedDraft = surveyGraph.snapCursorToWall(
    surveyGraph.startWallSnap(draft),
    target.pointMm,
    target
  );
  const snappedFloor = surveyGraph.getActiveFloor(snappedDraft);
  const topologyAnchor = surveyGraph.getNode(snappedFloor, snappedFloor.session.anchorNodeId);
  const cursorPoint = surveyGraph.getCursorDisplayPoint(snappedFloor, snappedFloor.session);

  assert.notDeepEqual(cursorPoint, topologyAnchor);
  assert.deepEqual(cursorPoint, geometry.outerStart);
  assert.equal(snappedFloor.session.activeSpaceSharedSnapLine, 'outer');
});

test('an outer T continuation keeps the visible cursor on the shared branch working face', () => {
  [
    { direction: 1 },
    { direction: -1 }
  ].forEach(({ direction }) => {
    let draft = createClosedDraft(6000);
    let floor = surveyGraph.getActiveFloor(draft);
    const sourceWall = floor.walls[0];
    const sourceGeometry = surveyGraph.buildWallSnapGeometry(floor, sourceWall);
    const outerMidpoint = {
      xMm: Math.round((sourceGeometry.outerStart.xMm + sourceGeometry.outerEnd.xMm) / 2),
      yMm: Math.round((sourceGeometry.outerStart.yMm + sourceGeometry.outerEnd.yMm) / 2)
    };
    const target = surveyGraph.getCursorPlacementTarget(
      floor,
      outerMidpoint,
      surveyGraph.CLOSE_TOLERANCE_MM
    );

    draft = surveyGraph.snapCursorToWall(
      surveyGraph.startWallSnap(draft),
      target.pointMm,
      target
    );
    draft = commitWall(draft, { xMm: outerMidpoint.xMm, yMm: -2000 }, 1800);
    floor = surveyGraph.getActiveFloor(draft);
    assert.deepEqual(surveyGraph.getCursorDisplayPoint(floor, floor.session), {
      xMm: outerMidpoint.xMm,
      yMm: -2000
    });

    const visibleStart = surveyGraph.getCursorDisplayPoint(floor, floor.session);
    const draggedPoint = { xMm: visibleStart.xMm + direction * 1810, yMm: -2000 };
    draft = surveyGraph.startPreview(draft, draggedPoint);
    floor = surveyGraph.getActiveFloor(draft);

    assert.equal(floor.session.previewPoint.yMm, -2000);
    assert.equal(floor.session.previewLengthMm, 1810);
    assert.equal(floor.session.previewMeasurementStartInsetMm, 0);
    assert.equal(floor.session.previewMeasurementStartExtensionMm, 0);
    assert.deepEqual(
      surveyGraph.getCursorDisplayPoint(floor, floor.session),
      draggedPoint
    );

    draft = surveyGraph.commitPreviewLength(draft, 1810, 'manual');
    floor = surveyGraph.getActiveFloor(draft);
    const wall = floor.walls.at(-1);
    const start = surveyGraph.getNode(floor, wall.startNodeId);
    const end = surveyGraph.getNode(floor, wall.endNodeId);
    const coordinateLengthMm = Math.round(Math.hypot(end.xMm - start.xMm, end.yMm - start.yMm));

    assert.equal(wall.lengthMm, 1810);
    assert.equal(wall.measurementStartInsetMm || 0, 0);
    assert.equal(wall.measurementStartExtensionMm || 0, 0);
    assert.equal(coordinateLengthMm, 1810);
    assert.equal(
      coordinateLengthMm - (wall.measurementStartInsetMm || 0) + (wall.measurementStartExtensionMm || 0),
      1810
    );
  });
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
  draft = surveyGraph.commitPreviewLength(draft, floor.session.previewLengthMm, 'manual');
  floor = surveyGraph.getActiveFloor(draft);
  const closingWall = floor.walls.at(-1);
  const geometryBeforeClosure = surveyGraph.buildWallRenderGeometry(floor, closingWall);

  draft = surveyGraph.confirmClosure(draft);
  floor = surveyGraph.getActiveFloor(draft);
  const closedWall = surveyGraph.getWall(floor, closingWall.id);
  const geometryAfterClosure = surveyGraph.buildWallRenderGeometry(floor, closedWall);

  assert.ok(floor.spaces.filter((space) => space.closed).length >= 2);
  assert.deepEqual(geometryAfterClosure.outerStart, geometryBeforeClosure.outerStart);
  assert.deepEqual(geometryAfterClosure.outerEnd, geometryBeforeClosure.outerEnd);
});

test('an exterior-facing chain that closes on an inner shared face keeps the orange-line body side', () => {
  const commitPreview = (draft, point) => {
    const preview = surveyGraph.startPreview(draft, point);
    const previewFloor = surveyGraph.getActiveFloor(preview);
    return surveyGraph.commitPreviewLength(preview, previewFloor.session.previewLengthMm, 'manual');
  };
  let draft = surveyGraph.setThickness(surveyGraph.createSurveyDraft(), 400);
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  draft = commitWall(draft, { xMm: 2779, yMm: 0 }, 2779);
  draft = commitWall(draft, { xMm: 2779, yMm: 3545 }, 3545);
  draft = commitWall(draft, { xMm: 0, yMm: 3545 }, 2779);
  draft = commitWall(draft, { xMm: 0, yMm: 0 }, 3545);
  draft = surveyGraph.confirmClosure(draft);

  let floor = surveyGraph.getActiveFloor(draft);
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    { xMm: 1139, yMm: 0 },
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  assert.equal(target.snapLine, 'inner');
  draft = surveyGraph.snapCursorToWall(surveyGraph.startWallSnap(draft), target.pointMm, target);
  draft = commitPreview(draft, { xMm: 1139, yMm: -2523 });
  draft = commitPreview(draft, { xMm: 2779, yMm: -2523 });
  draft = commitPreview(draft, { xMm: 2779, yMm: 100 });

  floor = surveyGraph.getActiveFloor(draft);
  const closingWall = floor.walls.at(-1);
  const geometryBeforeClosure = surveyGraph.buildWallRenderGeometry(floor, closingWall);
  assert.equal(floor.session.closeCandidateType, 'shared-wall');
  assert.equal(closingWall.bodyNormalSide, '');
  assert.equal(geometryBeforeClosure.outerStart.xMm, 2379);

  draft = surveyGraph.confirmClosure(draft);
  floor = surveyGraph.getActiveFloor(draft);
  const closedWall = surveyGraph.getWall(floor, closingWall.id);
  const geometryAfterClosure = surveyGraph.buildWallRenderGeometry(floor, closedWall);

  assert.equal(closedWall.bodyNormalSide, 'right');
  assert.deepEqual(geometryAfterClosure.outerStart, geometryBeforeClosure.outerStart);
  assert.deepEqual(geometryAfterClosure.outerEnd, geometryBeforeClosure.outerEnd);
  assert.equal(geometryAfterClosure.outerStart.xMm, 2379);
  assert.equal(floor.spaces.filter((space) => space.closed).length, 2);
});

test('an outer-face closing line keeps its physical x coordinate and bridges to the source corner', () => {
  const commitPreview = (draft, point) => {
    const preview = surveyGraph.startPreview(draft, point);
    const previewFloor = surveyGraph.getActiveFloor(preview);
    return surveyGraph.commitPreviewLength(preview, previewFloor.session.previewLengthMm, 'manual');
  };
  let draft = surveyGraph.setThickness(surveyGraph.createSurveyDraft(), 200);
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  draft = commitWall(draft, { xMm: 6000, yMm: 0 }, 6000);
  draft = commitWall(draft, { xMm: 6000, yMm: 4000 }, 4000);
  draft = commitWall(draft, { xMm: 0, yMm: 4000 }, 6000);
  draft = commitWall(draft, { xMm: 0, yMm: 0 }, 4000);
  draft = surveyGraph.confirmClosure(draft);

  let floor = surveyGraph.getActiveFloor(draft);
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    { xMm: 3000, yMm: -200 },
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  assert.equal(target.snapLine, 'outer');
  draft = surveyGraph.snapCursorToWall(surveyGraph.startWallSnap(draft), target.pointMm, target);
  draft = commitPreview(draft, { xMm: 3000, yMm: -2000 });
  draft = commitPreview(draft, { xMm: 6200, yMm: -2000 });
  draft = surveyGraph.startPreview(draft, { xMm: 6200, yMm: 100 });

  floor = surveyGraph.getActiveFloor(draft);
  assert.deepEqual(floor.session.previewPoint, { xMm: 6200, yMm: 0 });
  assert.equal(floor.session.closeCandidateType, 'merge');
  draft = surveyGraph.confirmClosure(draft);
  floor = surveyGraph.getActiveFloor(draft);
  const closingWall = floor.walls.find((wall) => {
    const start = surveyGraph.getNode(floor, wall.startNodeId);
    const end = surveyGraph.getNode(floor, wall.endNodeId);
    return start.xMm === 6200 && end.xMm === 6200 && start.yMm === -2000 && end.yMm === 0;
  });
  assert.ok(closingWall);
  const geometry = surveyGraph.buildWallRenderGeometry(floor, closingWall);
  const newRoom = floor.spaces.filter((space) => space.closed).at(-1);

  assert.equal(closingWall.bodyNormalSide, 'right');
  assert.equal(geometry.outerStart.xMm, 6000);
  assert.equal(geometry.outerEnd.xMm, 6000);
  assert.deepEqual(surveyGraph.buildSpaceDimensionPlan(floor, newRoom).inner, {
    widthMm: 2800,
    heightMm: 1600,
    areaMm2: 4480000
  });
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

test('cursor placement snaps to a distant closed-room vertex axis without joining its topology', () => {
  const draft = createClosedDraft();
  const floor = surveyGraph.getActiveFloor(draft);
  const sourceWall = floor.walls[0];
  const sourceGeometry = surveyGraph.buildWallRenderGeometry(floor, sourceWall);
  const rawPoint = {
    xMm: sourceGeometry.outerStart.xMm + 80,
    yMm: sourceGeometry.outerStart.yMm + 5402
  };
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    rawPoint,
    surveyGraph.CLOSE_TOLERANCE_MM
  );

  assert.equal(target.type, 'alignment');
  assert.equal(target.axis, 'x');
  assert.equal(target.snapLine, 'outer');
  assert.equal(target.referencePoint.xMm, sourceGeometry.outerStart.xMm);
  assert.ok(target.referencePoint.yMm < rawPoint.yMm);
  assert.deepEqual(target.pointMm, {
    xMm: sourceGeometry.outerStart.xMm,
    yMm: rawPoint.yMm
  });

  const next = surveyGraph.placeNewWallChainCursor(
    surveyGraph.startWallSnap(draft),
    target.pointMm
  );
  const nextFloor = surveyGraph.getActiveFloor(next);
  const placedNode = surveyGraph.getNode(nextFloor, nextFloor.session.anchorNodeId);
  assert.notEqual(placedNode.id, target.nodeId);
  assert.deepEqual(
    { xMm: placedNode.xMm, yMm: placedNode.yMm },
    target.pointMm
  );
});

test('straight-wall preview snaps to a distant vertex axis and keeps it after length confirmation', () => {
  let draft = createClosedDraft();
  const closedFloor = surveyGraph.getActiveFloor(draft);
  const targetWall = closedFloor.walls[0];
  const targetGeometry = surveyGraph.buildWallRenderGeometry(closedFloor, targetWall);
  const targetX = targetGeometry.outerStart.xMm;

  draft = surveyGraph.placeNewWallChainCursor(
    surveyGraph.startWallSnap(draft),
    { xMm: targetX + 1062, yMm: targetGeometry.outerStart.yMm + 5402 }
  );
  draft = surveyGraph.startPreview(draft, {
    xMm: targetX + 70,
    yMm: targetGeometry.outerStart.yMm + 5402
  });

  let floor = surveyGraph.getActiveFloor(draft);
  assert.equal(floor.session.previewPoint.xMm, targetX);
  assert.equal(floor.session.alignmentSnapGuide.type, 'vertex-axis');
  assert.equal(floor.session.alignmentSnapGuide.snapLine, 'outer');
  assert.equal(floor.session.alignmentSnapGuide.referencePoint.xMm, targetGeometry.outerStart.xMm);
  assert.ok(floor.session.alignmentSnapGuide.referencePoint.yMm < floor.session.previewPoint.yMm);

  draft = surveyGraph.commitPreviewLength(
    draft,
    floor.session.previewLengthMm,
    'manual'
  );
  floor = surveyGraph.getActiveFloor(draft);
  const wall = floor.walls[floor.walls.length - 1];
  const end = surveyGraph.getNode(floor, wall.endNodeId);
  assert.equal(end.xMm, targetX);
  assert.equal(end.yMm, targetGeometry.outerStart.yMm + 5402);
});

test('a later wall from a shared-boundary start aligns to another distant closed-room vertex axis', () => {
  let draft = createClosedDraft();
  let floor = surveyGraph.getActiveFloor(draft);
  const bottomWall = floor.walls[2];
  const bottomStart = surveyGraph.getNode(floor, bottomWall.startNodeId);
  const bottomEnd = surveyGraph.getNode(floor, bottomWall.endNodeId);
  const midpoint = {
    xMm: Math.round((bottomStart.xMm + bottomEnd.xMm) / 2),
    yMm: Math.round((bottomStart.yMm + bottomEnd.yMm) / 2)
  };
  const sharedTarget = surveyGraph.getCursorPlacementTarget(
    floor,
    midpoint,
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  draft = surveyGraph.snapCursorToWall(
    surveyGraph.startWallSnap(draft),
    sharedTarget.pointMm,
    sharedTarget
  );
  draft = commitWall(draft, { xMm: midpoint.xMm, yMm: midpoint.yMm + 5402 }, 5402);
  floor = surveyGraph.getActiveFloor(draft);
  const anchor = surveyGraph.getNode(floor, floor.session.anchorNodeId);
  draft = surveyGraph.startPreview(draft, { xMm: 80, yMm: anchor.yMm });

  floor = surveyGraph.getActiveFloor(draft);
  assert.equal(floor.session.previewPoint.xMm, 0);
  assert.equal(floor.session.previewPoint.yMm, anchor.yMm);
  assert.equal(floor.session.alignmentSnapGuide.type, 'vertex-axis');
  assert.equal(floor.session.alignmentSnapGuide.snapLine, 'inner');
  assert.deepEqual(floor.session.alignmentSnapGuide.referencePoint, { xMm: 0, yMm: 2000 });
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

test('closed-room inner and outer lower-left corners align the new wall body with the boundary', () => {
  const closedDraft = createClosedDraft();
  const closedFloor = surveyGraph.getActiveFloor(closedDraft);
  const lowerLeftWall = closedFloor.walls.find((wall) => {
    const start = surveyGraph.getNode(closedFloor, wall.startNodeId);
    const end = surveyGraph.getNode(closedFloor, wall.endNodeId);
    return start && end && start.xMm === 0 && end.xMm === 0;
  });
  const outerCorner = surveyGraph.buildWallRenderGeometry(closedFloor, lowerLeftWall).outerStart;

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
      expectedSide: 'right',
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

test('resetting onto an open chain endpoint preserves uninterrupted corner topology', () => {
  let baseDraft = createClosedDraft();
  let floor = surveyGraph.getActiveFloor(baseDraft);
  const lowerLeftTarget = surveyGraph.getCursorPlacementTarget(
    floor,
    { xMm: 0, yMm: 2000 },
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  baseDraft = surveyGraph.snapCursorToWall(
    surveyGraph.startWallSnap(baseDraft),
    lowerLeftTarget.pointMm,
    lowerLeftTarget
  );
  baseDraft = commitWall(baseDraft, { xMm: -3000, yMm: 2000 }, 2800);
  floor = surveyGraph.getActiveFloor(baseDraft);
  const sourceWall = floor.walls.at(-1);
  const sourceEnd = surveyGraph.getNode(floor, sourceWall.endNodeId);
  const sourceOuterEnd = surveyGraph.buildWallRenderGeometry(floor, sourceWall).outerEnd;

  const uninterruptedDraft = commitWall(baseDraft, { xMm: -3000, yMm: -1000 }, 3000);
  const uninterruptedFloor = surveyGraph.getActiveFloor(uninterruptedDraft);
  const uninterruptedSource = uninterruptedFloor.walls.find((wall) => wall.id === sourceWall.id);
  const uninterruptedBranch = uninterruptedFloor.walls.at(-1);

  [
    { point: sourceEnd, snapLine: 'inner' },
    { point: sourceOuterEnd, snapLine: 'outer' }
  ].forEach(({ point, snapLine }) => {
    const target = surveyGraph.getCursorPlacementTarget(
      floor,
      point,
      surveyGraph.CLOSE_TOLERANCE_MM
    );
    assert.equal(target.type, 'vertex');
    assert.equal(target.snapLine || 'inner', snapLine);

    let resetDraft = surveyGraph.snapCursorToWall(
      surveyGraph.startWallSnap(baseDraft),
      target.pointMm,
      target
    );
    resetDraft = surveyGraph.startPreview(resetDraft, { xMm: -3000, yMm: -1000 });
    assert.equal(
      surveyGraph.getActiveFloor(resetDraft).session.previewMeasurementSide,
      uninterruptedBranch.measurementSide
    );
    resetDraft = surveyGraph.commitPreviewLength(resetDraft, 3000, 'manual');

    const resetFloor = surveyGraph.getActiveFloor(resetDraft);
    const resetSource = resetFloor.walls.find((wall) => wall.id === sourceWall.id);
    const resetBranch = resetFloor.walls.at(-1);
    assert.deepEqual(
      {
        lengthMm: resetSource.lengthMm,
        measurementStartInsetMm: resetSource.measurementStartInsetMm || 0,
        measurementEndInsetMm: resetSource.measurementEndInsetMm || 0
      },
      {
        lengthMm: uninterruptedSource.lengthMm,
        measurementStartInsetMm: uninterruptedSource.measurementStartInsetMm || 0,
        measurementEndInsetMm: uninterruptedSource.measurementEndInsetMm || 0
      }
    );
    assert.deepEqual(
      {
        startNodeId: resetBranch.startNodeId,
        end: (() => {
          const node = surveyGraph.getNode(resetFloor, resetBranch.endNodeId);
          return { xMm: node.xMm, yMm: node.yMm };
        })(),
        lengthMm: resetBranch.lengthMm,
        measurementSide: resetBranch.measurementSide,
        measurementStartInsetMm: resetBranch.measurementStartInsetMm || 0,
        measurementEndInsetMm: resetBranch.measurementEndInsetMm || 0
      },
      {
        startNodeId: uninterruptedBranch.startNodeId,
        end: (() => {
          const node = surveyGraph.getNode(uninterruptedFloor, uninterruptedBranch.endNodeId);
          return { xMm: node.xMm, yMm: node.yMm };
        })(),
        lengthMm: uninterruptedBranch.lengthMm,
        measurementSide: uninterruptedBranch.measurementSide,
        measurementStartInsetMm: uninterruptedBranch.measurementStartInsetMm || 0,
        measurementEndInsetMm: uninterruptedBranch.measurementEndInsetMm || 0
      }
    );
  });
});

test('a wall pulled left from the upper-left outer vertex aligns with the top wall face', () => {
  const closedDraft = createClosedDraft();
  const closedFloor = surveyGraph.getActiveFloor(closedDraft);
  const topWall = closedFloor.walls[0];
  const outerCorner = surveyGraph.buildWallRenderGeometry(closedFloor, topWall).outerStart;
  const target = surveyGraph.getCursorPlacementTarget(
    closedFloor,
    outerCorner,
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  let draft = surveyGraph.snapCursorToWall(
    surveyGraph.startWallSnap(closedDraft),
    target.pointMm,
    target
  );
  draft = surveyGraph.startPreview(draft, { xMm: -2200, yMm: 0 });
  let floor = surveyGraph.getActiveFloor(draft);

  assert.equal(target.snapLine, 'outer');
  assert.equal(floor.session.previewMeasurementSide, 'right');
  assert.equal(floor.session.measurementSide, 'right');
  assert.equal(floor.session.previewMeasurementStartInsetMm, 200);

  draft = surveyGraph.commitPreviewLength(draft, 2000, 'manual');
  floor = surveyGraph.getActiveFloor(draft);
  assert.equal(floor.walls.at(-1).measurementSide, 'right');
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
  assert.equal(surveyGraph.buildSpaceDimensionPlan(floor, adjacentSpace).inner.heightMm, 4136);
});

test('splitting a shared wall preserves a reversed existing room boundary', () => {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  draft = commitWall(draft, { xMm: 3000, yMm: 0 }, 3000);
  draft = commitWall(draft, { xMm: 3000, yMm: 4000 }, 4000);
  draft = commitWall(draft, { xMm: 0, yMm: 4000 }, 3000);
  draft = commitWall(draft, { xMm: 0, yMm: 0 }, 4000);
  draft = surveyGraph.confirmClosure(draft);

  // Closed spaces may legitimately retain the reverse wall order. Splitting
  // their shared wall for a neighbouring room must preserve that continuity.
  let floor = surveyGraph.getActiveFloor(draft);
  floor.spaces[0].wallIds.reverse();
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    { xMm: 0, yMm: 1000 },
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  draft = surveyGraph.snapCursorToWall(
    surveyGraph.startWallSnap(draft),
    target.pointMm,
    target
  );
  draft = commitWall(draft, { xMm: -2000, yMm: 1000 }, 2000);
  draft = commitWall(draft, { xMm: -2000, yMm: 3000 }, 2000);
  draft = commitWall(draft, { xMm: 0, yMm: 3000 }, 2000);
  draft = surveyGraph.confirmClosure(draft);

  floor = surveyGraph.getActiveFloor(draft);
  const firstRoomBoundary = surveyGraph.buildSpaceBoundaryPoints(floor, floor.spaces[0].wallIds);
  assert.equal(floor.spaces.filter((space) => space.closed).length, 2);
  assert.deepEqual(firstRoomBoundary.map(({ xMm, yMm }) => ({ xMm, yMm })), [
    { xMm: 0, yMm: 0 },
    { xMm: 0, yMm: 1000 },
    { xMm: 0, yMm: 3000 },
    { xMm: 0, yMm: 4000 },
    { xMm: 3000, yMm: 4000 },
    { xMm: 3000, yMm: 0 }
  ]);
  assert.ok(surveyGraph.buildSpaceBoundaryPoints(floor, floor.spaces[1].wallIds).length >= 4);
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

test('an internal-wall partition stops at the opposite boundary and closes two rooms', () => {
  let draft = createClosedDraft();
  let floor = surveyGraph.getActiveFloor(draft);
  const leftWall = floor.walls.find((wall) => {
    const start = surveyGraph.getNode(floor, wall.startNodeId);
    const end = surveyGraph.getNode(floor, wall.endNodeId);
    return start && end && start.xMm === 0 && end.xMm === 0;
  });
  const startTarget = surveyGraph.getCursorPlacementTarget(
    floor,
    { xMm: 0, yMm: 1000 },
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  assert.equal(startTarget.wallId, leftWall.id);

  draft = surveyGraph.snapCursorToWall(
    surveyGraph.startWallSnap(draft),
    startTarget.pointMm,
    startTarget
  );
  draft = surveyGraph.startPreview(draft, { xMm: 7000, yMm: 1000 });
  floor = surveyGraph.getActiveFloor(draft);
  assert.deepEqual(floor.session.previewPoint, { xMm: 3000, yMm: 1000 });
  assert.equal(floor.session.closeCandidateType, 'partition');

  draft = surveyGraph.commitPreviewLength(draft, floor.session.previewLengthMm, 'manual');
  floor = surveyGraph.getActiveFloor(draft);
  assert.equal(floor.session.state, 'closing');
  assert.equal(floor.session.closeCandidateType, 'partition');
  assert.equal(floor.walls.at(-1).lengthMm, 3000);

  draft = surveyGraph.confirmClosure(draft);
  floor = surveyGraph.getActiveFloor(draft);
  assert.equal(floor.session.state, 'spaceClosed');
  assert.equal(floor.spaces.filter((space) => space.closed).length, 2);
  assert.equal(floor.walls.some((wall) => {
    const start = surveyGraph.getNode(floor, wall.startNodeId);
    const end = surveyGraph.getNode(floor, wall.endNodeId);
    return start && end && Math.max(start.xMm, end.xMm) > 3000;
  }), false);
  assert.equal(
    floor.spaces.every((space) => surveyGraph.buildSpaceBoundaryPoints(floor, space.wallIds).length >= 4),
    true
  );
});

test('a shared internal-wall partition selects the room entered by the drag', () => {
  let draft = createClosedDraft();
  let floor = surveyGraph.getActiveFloor(draft);
  const rightWall = floor.walls.find((wall) => {
    const start = surveyGraph.getNode(floor, wall.startNodeId);
    const end = surveyGraph.getNode(floor, wall.endNodeId);
    return start && end && start.xMm === 3000 && end.xMm === 3000;
  });
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    { xMm: 3000, yMm: 1000 },
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  draft = surveyGraph.snapCursorToWall(surveyGraph.startWallSnap(draft), target.pointMm, target);
  draft = commitWall(draft, { xMm: 6000, yMm: 1000 }, 3000);
  draft = commitWall(draft, { xMm: 6000, yMm: 2000 }, 1000);
  draft = commitWall(draft, { xMm: 3000, yMm: 2000 }, 3000);
  draft = surveyGraph.confirmClosure(draft);

  floor = surveyGraph.getActiveFloor(draft);
  assert.equal(floor.spaces.filter((space) => space.closed).length, 2);
  const sharedWall = floor.walls.find((wall) => {
    return floor.spaces.filter((space) => space.wallIds.includes(wall.id)).length === 2;
  });
  assert.ok(sharedWall);
  const sharedStart = surveyGraph.getNode(floor, sharedWall.startNodeId);
  const sharedEnd = surveyGraph.getNode(floor, sharedWall.endNodeId);
  const sharedMidpoint = {
    xMm: Math.round((sharedStart.xMm + sharedEnd.xMm) / 2),
    yMm: Math.round((sharedStart.yMm + sharedEnd.yMm) / 2)
  };

  const splitTarget = surveyGraph.getCursorPlacementTarget(
    floor,
    sharedMidpoint,
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  draft = surveyGraph.snapCursorToWall(
    surveyGraph.startWallSnap(draft),
    splitTarget.pointMm,
    splitTarget
  );
  draft = surveyGraph.startPreview(draft, { xMm: 7000, yMm: sharedMidpoint.yMm });
  floor = surveyGraph.getActiveFloor(draft);
  assert.deepEqual(floor.session.previewPoint, { xMm: 6200, yMm: sharedMidpoint.yMm });
  assert.equal(floor.session.closeCandidateType, 'partition');

  draft = surveyGraph.commitPreviewLength(draft, floor.session.previewLengthMm, 'manual');
  draft = surveyGraph.confirmClosure(draft);
  floor = surveyGraph.getActiveFloor(draft);
  assert.equal(floor.spaces.filter((space) => space.closed).length, 3);
  assert.equal(floor.walls.some((wall) => {
    const start = surveyGraph.getNode(floor, wall.startNodeId);
    const end = surveyGraph.getNode(floor, wall.endNodeId);
    return start && end && Math.max(start.xMm, end.xMm) > 6200;
  }), false);
});

test('placing cursor on wall keeps wall un-split until a new branch wall is committed', () => {
  let draft = createClosedDraft(4000);
  let floor = surveyGraph.getActiveFloor(draft);
  assert.equal(floor.walls.length, 4);
  const targetWall = floor.walls[0];

  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    { xMm: 2000, yMm: 0 },
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  assert.equal(target.type, 'wall');

  // Snap cursor to wall
  draft = surveyGraph.snapCursorToWall(
    surveyGraph.startWallSnap(draft),
    target.pointMm,
    target
  );
  floor = surveyGraph.getActiveFloor(draft);
  // The wall should NOT be split yet!
  assert.equal(floor.walls.length, 4);
  assert.equal(floor.walls[0].id, targetWall.id);
  assert.equal(floor.session.state, 'cursorPlaced');
  assert.equal(floor.session.activeSpaceSharedWallMiddle, true);

  // Now drag and commit a new wall from the cursor
  draft = commitWall(draft, { xMm: 2000, yMm: -2000 }, 2000);
  floor = surveyGraph.getActiveFloor(draft);
  // Now the target wall should be split (2 segments) + 1 new wall + 3 remaining walls = 6 walls
  assert.equal(floor.walls.length, 6);
  const segments = floor.walls.filter((w) => w.topologySourceWallId === targetWall.id);
  assert.equal(segments.length, 2);
});

test('dragging closing wall deeply downward along adjacent wall clamps at source corner and closes correctly', () => {
  let draft = createClosedDraft(6000);
  let floor = surveyGraph.getActiveFloor(draft);
  const target = surveyGraph.getCursorPlacementTarget(floor, { xMm: 3000, yMm: 0 }, surveyGraph.CLOSE_TOLERANCE_MM);
  draft = surveyGraph.snapCursorToWall(surveyGraph.startWallSnap(draft), target.pointMm, target);
  draft = commitWall(draft, { xMm: 3000, yMm: -2000 }, 2000);
  draft = commitWall(draft, { xMm: 6200, yMm: -2000 }, 3200);

  // Drag Wall 3 deeply downward past y=0 to (6200, 2000)
  draft = surveyGraph.startPreview(draft, { xMm: 6200, yMm: 2000 });
  floor = surveyGraph.getActiveFloor(draft);
  assert.deepEqual(floor.session.previewPoint, { xMm: 6000, yMm: 0 });
  assert.equal(floor.session.closeCandidateSharedWallId !== '', true);

  draft = surveyGraph.confirmClosure(draft);
  floor = surveyGraph.getActiveFloor(draft);
  assert.equal(floor.spaces.length, 2);
  const room1 = floor.spaces[0];
  const room2 = floor.spaces[1];
  assert.equal(room1.closed, true);
  assert.equal(room2.closed, true);

  // Check no giant 6000mm wall was created along the right side
  assert.equal(floor.walls.some((w) => w.lengthMm > 5000 && w.lengthMm !== 6000), false);
});

test('releasing closing wall at outer corner directly auto-closes without needing extra downward drag', () => {
  let draft = createClosedDraft(6000);
  let floor = surveyGraph.getActiveFloor(draft);
  const target = surveyGraph.getCursorPlacementTarget(floor, { xMm: 3000, yMm: 0 }, surveyGraph.CLOSE_TOLERANCE_MM);
  draft = surveyGraph.snapCursorToWall(surveyGraph.startWallSnap(draft), target.pointMm, target);
  draft = commitWall(draft, { xMm: 3000, yMm: -2000 }, 2000);
  draft = commitWall(draft, { xMm: 6200, yMm: -2000 }, 3200);

  // Drag Wall 3 to (6200, -200) (the outer top edge of Room 1)
  draft = surveyGraph.startPreview(draft, { xMm: 6200, yMm: -200 });
  floor = surveyGraph.getActiveFloor(draft);
  assert.equal(surveyGraph.isDirectClosureHit(floor, floor.session, { xMm: 6200, yMm: -200 }), true);

  // Also verify at (6200, 0)
  draft = surveyGraph.startPreview(draft, { xMm: 6200, yMm: 0 });
  floor = surveyGraph.getActiveFloor(draft);
  assert.equal(surveyGraph.isDirectClosureHit(floor, floor.session, { xMm: 6200, yMm: 0 }), true);
});



