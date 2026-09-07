const test = require('node:test');
const assert = require('node:assert/strict');
const surveyGraph = require('../packages/surveying/utils/surveyWallGraph.js');
const wallFaces = require('../packages/surveying/utils/survey/read-model/wall-faces.js');
const { inspectDraftFaceShadow } = require('../packages/surveying/utils/survey/topology/face-shadow.js');
const { createScenarioCatalog } = require('../../surveying-h5/src/scenarios.js');

const catalog = createScenarioCatalog(surveyGraph);
const JOIN_TOLERANCE_MM = 1;

function commitPreview(draft, rawPoint) {
  const preview = surveyGraph.startPreview(draft, rawPoint);
  const floor = surveyGraph.getActiveFloor(preview);
  return surveyGraph.commitPreviewLength(preview, floor.session.previewLengthMm, 'manual');
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

function topologyLengthMm(floor, wall) {
  const start = surveyGraph.getNode(floor, wall.startNodeId);
  const end = surveyGraph.getNode(floor, wall.endNodeId);
  return surveyGraph.distanceMm(start, end);
}

function workingLine(floor, wall) {
  const geometry = surveyGraph.buildWallRenderGeometry(floor, wall);
  if (!geometry) return null;
  return wallFaces.projectWorkingFace(wall, geometry.start, geometry.end);
}

function pointDistanceMm(first, second) {
  return Math.hypot(Number(first.xMm) - Number(second.xMm), Number(first.yMm) - Number(second.yMm));
}

function assertMeasuredReadings(floor) {
  (floor.walls || []).forEach((wall) => {
    const expected = wallFaces.measuredReadingMm(topologyLengthMm(floor, wall), wall);
    assert.equal(
      Math.round(Number(wall.lengthMm)),
      Math.round(expected),
      `wall ${wall.id} reading ${wall.lengthMm} !== ${expected}`
    );
  });
}

function workingEndpointNearNode(floor, wall, nodeId) {
  const line = workingLine(floor, wall);
  if (!line) return null;
  return wall.endNodeId === nodeId ? line.end : line.start;
}

function joinBudgetMm(wall) {
  return Math.max(
    Number(wall.thicknessMm) || 0,
    Number(wall.measurementStartInsetMm) || 0,
    Number(wall.measurementEndInsetMm) || 0,
    Number(wall.measurementStartExtensionMm) || 0,
    JOIN_TOLERANCE_MM
  );
}

function sharedNodeId(previousWall, nextWall) {
  if (!previousWall || !nextWall) return '';
  const previousNodes = [previousWall.startNodeId, previousWall.endNodeId];
  const nextNodes = [nextWall.startNodeId, nextWall.endNodeId];
  return previousNodes.find((nodeId) => nextNodes.indexOf(nodeId) !== -1) || '';
}

function assertWorkingLineContinuity(floor) {
  const pairs = [];
  (floor.spaces || []).forEach((space) => {
    if (!space || !space.closed || !Array.isArray(space.wallIds) || space.wallIds.length < 2) return;
    space.wallIds.forEach((wallId, index) => {
      pairs.push([wallId, space.wallIds[(index + 1) % space.wallIds.length]]);
    });
  });
  const closedWallIds = new Set();
  (floor.spaces || []).forEach((space) => {
    if (space && space.closed) (space.wallIds || []).forEach((wallId) => closedWallIds.add(wallId));
  });
  const openWalls = (floor.walls || []).filter((wall) => wall && !closedWallIds.has(wall.id));
  for (let index = 0; index < openWalls.length - 1; index += 1) {
    if (openWalls[index].endNodeId === openWalls[index + 1].startNodeId) {
      pairs.push([openWalls[index].id, openWalls[index + 1].id]);
    }
  }

  pairs.forEach(([previousId, nextId]) => {
    const previousWall = surveyGraph.getWall(floor, previousId);
    const nextWall = surveyGraph.getWall(floor, nextId);
    const nodeId = sharedNodeId(previousWall, nextWall);
    const previousPoint = workingEndpointNearNode(floor, previousWall, nodeId);
    const nextPoint = workingEndpointNearNode(floor, nextWall, nodeId);
    if (!nodeId || !previousPoint || !nextPoint) return;
    const budget = Math.max(joinBudgetMm(previousWall), joinBudgetMm(nextWall)) + JOIN_TOLERANCE_MM;
    if (pointDistanceMm(previousPoint, nextPoint) <= budget) return;
    const intersection = wallFaces.intersectWorkingLines(
      workingLine(floor, previousWall),
      workingLine(floor, nextWall)
    );
    if (!intersection) {
      assert.ok(
        pointDistanceMm(previousPoint, nextPoint) <= budget,
        `collinear working ends drifted for ${previousId}/${nextId}`
      );
      return;
    }
    assert.ok(
      pointDistanceMm(previousPoint, intersection) <= budget,
      `previous red end drifted from join for ${previousId}`
    );
    assert.ok(
      pointDistanceMm(nextPoint, intersection) <= budget,
      `next red start drifted from join for ${nextId}`
    );
  });
}

function assertFaceWrite(draft) {
  const shadow = inspectDraftFaceShadow(draft);
  assert.equal(shadow.ok, true, shadow.mismatches.map((item) => item.code).join(','));
  assert.equal(surveyGraph.validateSurveyDraft(draft, { mode: 'full' }).valid, true);
}

test('confirmed wall readings follow topology minus insets plus start extension', () => {
  const draft = closedRectangle();
  assertMeasuredReadings(surveyGraph.getActiveFloor(draft));
});

test('adjacent working lines meet at their intersection after an L turn', () => {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.setThickness(draft, 200);
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  draft = commitPreview(draft, { xMm: 3000, yMm: 0 });
  draft = commitPreview(draft, { xMm: 3000, yMm: 2000 });
  assertWorkingLineContinuity(surveyGraph.getActiveFloor(draft));
  assertMeasuredReadings(surveyGraph.getActiveFloor(draft));
});

test('outer-face hits keep the topology node on the centerline', () => {
  const draft = closedRectangle();
  const floor = surveyGraph.getActiveFloor(draft);
  const wall = floor.walls[0];
  const start = surveyGraph.getNode(floor, wall.startNodeId);
  const geometry = surveyGraph.buildWallRenderGeometry(floor, wall);
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    geometry.outerStart,
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  assert.equal(target.snapLine, 'outer');
  assert.equal(target.nodeId, wall.startNodeId);
  assert.ok(target.topologyPointMm);
  assert.equal(target.topologyPointMm.xMm, start.xMm);
  assert.equal(target.topologyPointMm.yMm, start.yMm);

  const snapped = surveyGraph.snapCursorToWall(
    surveyGraph.startWallSnap(draft),
    geometry.outerStart,
    target
  );
  const snappedFloor = surveyGraph.getActiveFloor(snapped);
  const anchor = surveyGraph.getNode(snappedFloor, snappedFloor.session.anchorNodeId);
  assert.equal(anchor.xMm, start.xMm);
  assert.equal(anchor.yMm, start.yMm);
  if (
    Math.round(geometry.outerStart.xMm) !== start.xMm ||
    Math.round(geometry.outerStart.yMm) !== start.yMm
  ) {
    assert.notEqual(
      `${anchor.xMm},${anchor.yMm}`,
      `${Math.round(geometry.outerStart.xMm)},${Math.round(geometry.outerStart.yMm)}`
    );
  }
});

test('collinear degree-1 drags extend; a turn commits a new wall', () => {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.setThickness(draft, 200);
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  draft = commitPreview(draft, { xMm: 3000, yMm: 0 });
  assert.equal(surveyGraph.getActiveFloor(draft).walls.length, 1);

  draft = commitPreview(draft, { xMm: 5000, yMm: 0 });
  assert.equal(surveyGraph.getActiveFloor(draft).walls.length, 1);
  assert.equal(Math.round(surveyGraph.getActiveFloor(draft).walls[0].lengthMm), 5000);

  draft = commitPreview(draft, { xMm: 5000, yMm: 2000 });
  assert.equal(surveyGraph.getActiveFloor(draft).walls.length, 2);
});

test('T-splitting a closed wall keeps spaces aligned with extracted faces', () => {
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
  draft = commitPreview(draft, { xMm: 3000, yMm: 2000 });
  assertFaceWrite(draft);
  assert.equal(surveyGraph.getActiveFloor(draft).spaces.filter((space) => space.closed).length, 1);
});

test('H5 catalog keeps face write, readings, and working-line continuity', () => {
  catalog.forEach((scenario) => {
    const draft = scenario.build();
    const floor = surveyGraph.getActiveFloor(draft);
    assertFaceWrite(draft);
    assertMeasuredReadings(floor);
    try {
      assertWorkingLineContinuity(floor);
    } catch (error) {
      error.message = `${scenario.key}: ${error.message}`;
      throw error;
    }
  });
});

test('drawing a wall towards an existing closed room clamps to its boundary without penetrating', () => {
  let draft = closedRectangle(); // (0,0) -> (6000,0) -> (6000,4000) -> (0,4000) -> (0,0)
  // Start a new wall chain at (8000, 2000) pointing left (180 deg) by 5000mm towards the room's right wall (x=6000)
  draft = surveyGraph.placeNewWallChainCursor(draft, { xMm: 8000, yMm: 2000 });
  draft = surveyGraph.startPreview(draft, { xMm: 3000, yMm: 2000 });
  const preview = surveyGraph.getActiveFloor(draft).session.previewPoint;
  assert.equal(preview.xMm, 6000, 'preview must clamp to the existing wall at x=6000');

  draft = surveyGraph.commitPreviewLength(draft, 5000, 'manual');
  const floor1 = surveyGraph.getActiveFloor(draft);
  const lastWall = floor1.walls[floor1.walls.length - 1];
  assert.equal(lastWall.lengthMm, 2000, 'committed length must clamp from 5000mm to 2000mm');
  const endNode = surveyGraph.getNode(floor1, lastWall.endNodeId);
  assert.equal(endNode.xMm, 6000, 'end node must lie on the boundary at x=6000');
});

test('adjacent room closure wall overshooting the target wall clamps and closes successfully', () => {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  draft = surveyGraph.commitPreviewLength(surveyGraph.startPreview(draft, { xMm: 3369, yMm: 0 }), 3369, 'manual');
  draft = surveyGraph.commitPreviewLength(surveyGraph.startPreview(draft, { xMm: 3369, yMm: -5019 }), 5019, 'manual');
  draft = surveyGraph.commitPreviewLength(surveyGraph.startPreview(draft, { xMm: 0, yMm: -5019 }), 3369, 'manual');
  draft = surveyGraph.commitPreviewLength(surveyGraph.startPreview(draft, { xMm: 0, yMm: 0 }), 5019, 'manual');
  draft = surveyGraph.confirmClosure(draft);

  const rightWall = surveyGraph.getActiveFloor(draft).walls.find((w) => {
    const s = surveyGraph.getNode(surveyGraph.getActiveFloor(draft), w.startNodeId);
    const e = surveyGraph.getNode(surveyGraph.getActiveFloor(draft), w.endNodeId);
    return s.xMm === 3369 && e.xMm === 3369;
  });

  // Snap to right wall at y=-3466 (distance to bottom wall y=-5019 is 1553mm)
  draft = surveyGraph.snapCursorToWall(draft, { xMm: 3369, yMm: -3466 }, { wallId: rightWall.id });
  draft = surveyGraph.commitPreviewLength(surveyGraph.startPreview(draft, { xMm: 5857, yMm: -3466 }), 2488, 'manual');
  draft = surveyGraph.commitPreviewLength(surveyGraph.startPreview(draft, { xMm: 5857, yMm: -5019 }), 1553, 'manual');

  // Wall 3 goes left 2488 to x=3369, y=-5019
  draft = surveyGraph.startPreview(draft, { xMm: 3369, yMm: -5019 });
  // Input overshooting length 2283mm when actual distance is 1553mm
  draft = surveyGraph.commitPreviewLength(draft, 2283, 'manual');
  assert.equal(surveyGraph.getActiveFloor(draft).session.state, 'spaceClosed');
  assert.equal(surveyGraph.getActiveFloor(draft).session.closeCandidateType, '');

  draft = surveyGraph.confirmClosure(draft);
  const floor = surveyGraph.getActiveFloor(draft);
  assert.equal(floor.spaces.length, 2);
  assert.equal(floor.spaces.every((s) => s.closed), true);
});

