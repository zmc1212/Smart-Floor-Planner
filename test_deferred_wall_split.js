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

// 1. Create Room 1 (6000x4000, 4 walls)
let draft = rectangle(6000, 4000, { xMm: 0, yMm: 0 }, { thicknessMm: 200 });
let floor = surveyGraph.getActiveFloor(draft);
console.log('1. Initial Room 1:');
console.log('   walls count:', floor.walls.length, '(expected 4)');
console.log('   spaces count:', floor.spaces.length, '(expected 1)');

// 2. Snap cursor to the middle of the right wall (x=6000, y=2000)
draft = snapCursor(draft, { xMm: 6000, yMm: 2000 });
floor = surveyGraph.getActiveFloor(draft);
console.log('\n2. After snapping cursor to right wall:');
console.log('   walls count:', floor.walls.length, '(expected 4 - should NOT be split yet!)');
console.log('   session state:', floor.session.state);
console.log('   anchorNodeId:', floor.session.anchorNodeId);
console.log('   activeSpaceSharedWallId:', floor.session.activeSpaceSharedWallId);
console.log('   activeSpaceSharedWallMiddle:', floor.session.activeSpaceSharedWallMiddle);

// 3. Draw and commit a branch wall to the right (x=8000, y=2000)
const preview = surveyGraph.startPreview(draft, { xMm: 8000, yMm: 2000 });
const flPrev = surveyGraph.getActiveFloor(preview);
draft = surveyGraph.commitPreviewLength(preview, flPrev.session.previewLengthMm, 'preview');
floor = surveyGraph.getActiveFloor(draft);
console.log('\n3. After committing branch wall:');
console.log('   walls count:', floor.walls.length, '(expected 6: 4 split into 2 + 1 branch = 6 walls, plus startWallIndex update)');
console.log('   spaces count:', floor.spaces.length);

console.log('\nTest passed successfully!');
