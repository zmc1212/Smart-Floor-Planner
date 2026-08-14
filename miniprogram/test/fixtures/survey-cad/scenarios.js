const surveyGraph = require('../../../utils/surveyWallGraph.js');

function commitWall(draft, pointMm, lengthMm) {
  return surveyGraph.commitPreviewLength(
    surveyGraph.startPreview(draft, pointMm),
    lengthMm,
    'manual'
  );
}

function closePolygon(points) {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.placeCursor(draft, points[0]);
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    draft = commitWall(draft, to, surveyGraph.distanceMm(from, to));
  }
  return surveyGraph.confirmClosure(draft);
}

function rectangle() {
  return closePolygon([
    { xMm: 0, yMm: 0 },
    { xMm: 3000, yMm: 0 },
    { xMm: 3000, yMm: 2000 },
    { xMm: 0, yMm: 2000 },
    { xMm: 0, yMm: 0 }
  ]);
}

function concave() {
  return closePolygon([
    { xMm: 0, yMm: 0 },
    { xMm: 3000, yMm: 0 },
    { xMm: 3000, yMm: 1000 },
    { xMm: 1500, yMm: 1000 },
    { xMm: 1500, yMm: 2000 },
    { xMm: 0, yMm: 2000 },
    { xMm: 0, yMm: 0 }
  ]);
}

function wallSplitWithOpening() {
  let draft = rectangle();
  let floor = surveyGraph.getActiveFloor(draft);
  const hostWall = floor.walls[0];
  draft = surveyGraph.addOpeningToWall(draft, hostWall.id, 'door');
  floor = surveyGraph.getActiveFloor(draft);
  const start = surveyGraph.getNode(floor, hostWall.startNodeId);
  const end = surveyGraph.getNode(floor, hostWall.endNodeId);
  const midpoint = {
    xMm: Math.round((start.xMm + end.xMm) / 2),
    yMm: Math.round((start.yMm + end.yMm) / 2)
  };
  const target = surveyGraph.getCursorPlacementTarget(floor, midpoint, surveyGraph.CLOSE_TOLERANCE_MM);
  draft = surveyGraph.snapCursorToWall(surveyGraph.startWallSnap(draft), target.pointMm, target);
  return commitWall(draft, { xMm: midpoint.xMm, yMm: midpoint.yMm - 1000 }, 1000);
}

module.exports = { rectangle, concave, wallSplitWithOpening };
