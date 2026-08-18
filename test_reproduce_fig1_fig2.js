const surveyGraph = require('./miniprogram/utils/surveyWallGraph.js');

function rectangle(widthMm, heightMm, origin, options = {}) {
  const { xMm, yMm } = origin || { xMm: 0, yMm: 0 };
  let draft = surveyGraph.resetCursor(surveyGraph.createSurveyDraft());
  if (options.thicknessMm) draft = surveyGraph.setThickness(draft, options.thicknessMm);
  const commitWall = (d, point) => {
    const prev = surveyGraph.startPreview(d, point);
    const f = surveyGraph.getActiveFloor(prev);
    return surveyGraph.commitPreviewLength(prev, f.session.previewLengthMm, 'h5-scenario');
  };
  draft = surveyGraph.placeCursor(draft, { xMm, yMm });
  draft = commitWall(draft, { xMm: xMm + widthMm, yMm });
  draft = commitWall(draft, { xMm: xMm + widthMm, yMm: yMm + heightMm });
  draft = commitWall(draft, { xMm, yMm: yMm + heightMm });
  return surveyGraph.confirmClosure(draft);
}

function snapCursor(draft, point) {
  const floor = surveyGraph.getActiveFloor(draft);
  const target = surveyGraph.getCursorPlacementTarget(floor, point, surveyGraph.CLOSE_TOLERANCE_MM);
  return surveyGraph.snapCursorToWall(surveyGraph.startWallSnap(draft), target.pointMm, target);
}

const commitWall = (d, pt) => {
  const prev = surveyGraph.startPreview(d, pt);
  const f = surveyGraph.getActiveFloor(prev);
  return surveyGraph.commitPreviewLength(prev, f.session.previewLengthMm, 'preview');
};

// Create Room 1 exactly as in Figure 1
let draft = rectangle(3207, 3342, { xMm: 0, yMm: 0 }, { thicknessMm: 200 });

// Snap to outer face of top wall at x=1582, y=-200
draft = snapCursor(draft, { xMm: 1582, yMm: -200 });

// Wall 1: goes UP 1808mm
draft = commitWall(draft, { xMm: 1582, yMm: -2008 });

// Wall 2: goes RIGHT 1825mm (to x=3407)
draft = commitWall(draft, { xMm: 3407, yMm: -2008 });

// Wall 3: goes DOWN 813mm (to x=3407, y=-1195)
const preview = surveyGraph.startPreview(draft, { xMm: 3407, yMm: -1195 });
const flPrev = surveyGraph.getActiveFloor(preview);

console.log('Preview state:');
console.log('  state:', flPrev.session.state);
console.log('  closeCandidateType:', flPrev.session.closeCandidateType);
console.log('  closeCandidateNodeId:', flPrev.session.closeCandidateNodeId);
console.log('  closeCandidatePoint:', flPrev.session.closeCandidatePoint);

const closurePath = surveyGraph.getClosurePath(flPrev, flPrev.session);
console.log('Closure path:');
closurePath.forEach((pt, i) => console.log(`  pt[${i}]: (${pt.xMm}, ${pt.yMm})`));
