const surveyGraph = require('./utils/surveyWallGraph.js');
function commitWall(draft, point, lengthMm) {
  return surveyGraph.commitPreviewLength(surveyGraph.startPreview(draft, point), lengthMm, 'manual');
}
let draft = surveyGraph.createSurveyDraft();
draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
draft = commitWall(draft, { xMm: 2466, yMm: 0 }, 2466);
draft = commitWall(draft, { xMm: 2466, yMm: 3406 }, 3406);
draft = commitWall(draft, { xMm: 0, yMm: 3406 }, 2466);
draft = commitWall(draft, { xMm: 0, yMm: 0 }, 3406);
draft = surveyGraph.confirmClosure(draft);
let floor = surveyGraph.getActiveFloor(draft);
const startTarget = surveyGraph.getCursorPlacementTarget(floor, { xMm: 2466, yMm: 3406 }, surveyGraph.CLOSE_TOLERANCE_MM);
draft = surveyGraph.snapCursorToWall(surveyGraph.startWallSnap(draft), startTarget.pointMm, startTarget);
draft = commitWall(draft, { xMm: 2466, yMm: 6367 }, 2961);
draft = commitWall(draft, { xMm: -200, yMm: 6367 }, 2666);
draft = surveyGraph.startPreview(draft, { xMm: -200, yMm: 3406 });
floor = surveyGraph.getActiveFloor(draft);
console.log('preview', floor.session.previewPoint);
console.log('closeType', floor.session.closeCandidateType);
console.log('closePoint', floor.session.closeCandidatePoint);
console.log('closeNode', floor.session.closeCandidateNodeId && surveyGraph.getNode(floor, floor.session.closeCandidateNodeId));
console.log('anchor', surveyGraph.getNode(floor, floor.session.anchorNodeId));
