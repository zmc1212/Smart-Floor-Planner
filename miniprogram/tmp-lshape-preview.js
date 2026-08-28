const surveyGraph = require('./packages/surveying/utils/surveyWallGraph.js');
function commitWall(draft, point, lengthMm) {
  return surveyGraph.commitPreviewLength(surveyGraph.startPreview(draft, point), lengthMm, 'manual');
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
function createLShapedTwoRoomDraft() {
  let draft = createClosedDraft();
  let floor = surveyGraph.getActiveFloor(draft);
  const startTarget = surveyGraph.getCursorPlacementTarget(floor, { xMm: 3000, yMm: 0 }, surveyGraph.CLOSE_TOLERANCE_MM);
  draft = surveyGraph.snapCursorToWall(surveyGraph.startWallSnap(draft), startTarget.pointMm, startTarget);
  draft = commitWall(draft, { xMm: 7000, yMm: 0 }, 4000);
  draft = commitWall(draft, { xMm: 7000, yMm: 5000 }, 5000);
  draft = commitWall(draft, { xMm: 3000, yMm: 5000 }, 4000);
  floor = surveyGraph.getActiveFloor(draft);
  if (floor.session.state === 'closing' || floor.session.state === 'mergeClosing') {
    return surveyGraph.confirmClosure(draft);
  }
  draft = surveyGraph.startPreview(draft, { xMm: 3000, yMm: 2100 });
  return surveyGraph.confirmClosure(draft);
}
let draft = createLShapedTwoRoomDraft();
let floor = surveyGraph.getActiveFloor(draft);
const startTarget = surveyGraph.getCursorPlacementTarget(floor, { xMm: 0, yMm: 2000 }, surveyGraph.CLOSE_TOLERANCE_MM);
draft = surveyGraph.snapCursorToWall(surveyGraph.startWallSnap(draft), startTarget.pointMm, startTarget);
draft = commitWall(draft, { xMm: 0, yMm: 5000 }, 3000);
draft = surveyGraph.startPreview(draft, { xMm: 2880, yMm: 5000 });
floor = surveyGraph.getActiveFloor(draft);
console.log('preview', floor.session.previewPoint);
console.log('close', floor.session.closeCandidateType, floor.session.closeCandidatePoint);
console.log('guide', floor.session.alignmentSnapGuide);
console.log('anchor', surveyGraph.getNode(floor, floor.session.anchorNodeId));
