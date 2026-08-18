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
  if (!target || !target.pointMm || target.type === 'free') {
    throw new Error(`吸附失败: (${point.xMm}, ${point.yMm})`);
  }
  return surveyGraph.snapCursorToWall(surveyGraph.startWallSnap(draft), target.pointMm, target);
}

const commitWall = (d, pt) => {
  const prev = surveyGraph.startPreview(d, pt);
  const f = surveyGraph.getActiveFloor(prev);
  return surveyGraph.commitPreviewLength(prev, f.session.previewLengthMm, 'preview');
};

// 1. Create Room 1 (6000x4000)
let draft = rectangle(6000, 4000, { xMm: 0, yMm: 0 }, { thicknessMm: 200 });

// 2. Start drawing from outer face of top wall (x=1000, y=-200)
draft = snapCursor(draft, { xMm: 1000, yMm: -200 });

// 3. Wall 1: goes UP to (1000, -2200)
draft = commitWall(draft, { xMm: 1000, yMm: -2200 });

// 4. Wall 2: goes RIGHT to (3243, -2200)
draft = commitWall(draft, { xMm: 3243, yMm: -2200 });

// 5. Wall 3: goes DOWN towards the top wall of Room 1
// Suppose user drags down to y=-200 (outer face) or even drags deep into Room 1 (e.g. y=1000)
const previewDeep = surveyGraph.startPreview(draft, { xMm: 3243, yMm: 1000 });
const flDeep = surveyGraph.getActiveFloor(previewDeep);
console.log('Preview dragged deep into Room 1:');
console.log('  previewPoint:', flDeep.session.previewPoint);
console.log('  previewLengthMm:', flDeep.session.previewLengthMm);
console.log('  closeCandidatePoint:', flDeep.session.closeCandidatePoint);
console.log('  closeCandidateNodeId:', flDeep.session.closeCandidateNodeId);
console.log('  closeCandidateType:', flDeep.session.closeCandidateType);
console.log('  isDirectClosureHit:', surveyGraph.isDirectClosureHit(flDeep, flDeep.session, { xMm: 3243, yMm: -200 }));

// If user stops at the outer face y=-200:
const previewOuter = surveyGraph.startPreview(draft, { xMm: 3243, yMm: -200 });
const flOuter = surveyGraph.getActiveFloor(previewOuter);
console.log('\nPreview at outer face (y=-200):');
console.log('  previewPoint:', flOuter.session.previewPoint);
console.log('  previewLengthMm:', flOuter.session.previewLengthMm);
console.log('  closeCandidatePoint:', flOuter.session.closeCandidatePoint);
console.log('  closeCandidateNodeId:', flOuter.session.closeCandidateNodeId);
console.log('  closeCandidateType:', flOuter.session.closeCandidateType);
console.log('  isDirectClosureHit:', surveyGraph.isDirectClosureHit(flOuter, flOuter.session, { xMm: 3243, yMm: -200 }));

// Try confirmClosure on previewOuter:
try {
  const closed = surveyGraph.confirmClosure(previewOuter);
  const flClosed = surveyGraph.getActiveFloor(closed);
  console.log('\nClosure result:');
  console.log('  spaces:', flClosed.spaces.length);
  console.log('  walls:', flClosed.walls.length);
  console.log('  state:', flClosed.session.state);
} catch (e) {
  console.log('Closure error:', e.message);
}
