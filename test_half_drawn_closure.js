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

// 1. Create Room 1 (3607 x 3742 with 200mm wall, or 3207x3342 inner)
let draft = rectangle(3207, 3342, { xMm: 0, yMm: 0 }, { thicknessMm: 200 });

// 2. Start drawing on the top wall (outer face): x=1582, y=-200
draft = snapCursor(draft, { xMm: 1582, yMm: -200 });

// 3. Wall 1: goes UP 1808mm -> (1582, -2008)
draft = commitWall(draft, { xMm: 1582, yMm: -2008 });

// 4. Wall 2: goes RIGHT 1825mm -> (3407, -2008) (aligned with right outer face of Room 1)
draft = commitWall(draft, { xMm: 3407, yMm: -2008 });

// 5. Wall 3: goes DOWN 813mm -> (3407, -1195) (stopped halfway!)
const preview = surveyGraph.startPreview(draft, { xMm: 3407, yMm: -1195 });
const flPrev = surveyGraph.getActiveFloor(preview);
console.log('Preview state before confirmClosure:');
console.log('  state:', flPrev.session.state);
console.log('  closeCandidateType:', flPrev.session.closeCandidateType);
console.log('  closeCandidateNodeId:', flPrev.session.closeCandidateNodeId);
console.log('  closeCandidatePoint:', flPrev.session.closeCandidatePoint);

// 6. User clicks "合" (confirmClosure) on this preview:
const closed = surveyGraph.confirmClosure(preview);
const flClosed = surveyGraph.getActiveFloor(closed);
console.log('\nAfter confirmClosure:');
console.log('  spaces count:', flClosed.spaces.length);
console.log('  spaces:', flClosed.spaces.map(s => ({ id: s.id, wallIds: s.wallIds })));
console.log('  walls count:', flClosed.walls.length);
flClosed.walls.forEach((w, i) => {
  const s = surveyGraph.getNode(flClosed, w.startNodeId);
  const e = surveyGraph.getNode(flClosed, w.endNodeId);
  console.log(`  wall[${i}]: id=${w.id}, (${s?.xMm},${s?.yMm}) -> (${e?.xMm},${e?.yMm}), thickness=${w.thicknessMm}`);
});
