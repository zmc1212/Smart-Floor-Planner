/**
 * Reproduces the "外墙T:外边起步" room closure bug.
 *
 * Scenario:
 *  1. A 6000×4000 rectangle is drawn (as in exteriorTJunction scenario)
 *  2. Cursor is snapped to the OUTER face of the top wall (y = -200 for 200mm thick wall)
 *  3. Three walls are drawn forming a U-shape that closes back to the shared top wall
 *  4. The final closure should succeed (not throw overlap error)
 */

const surveyGraph = require('./miniprogram/utils/surveyWallGraph.js');

function rectangle(widthMm, heightMm, origin, options = {}) {
  const { xMm, yMm } = origin || { xMm: 0, yMm: 0 };
  let draft = surveyGraph.resetCursor(surveyGraph.createSurveyDraft());
  if (options.thicknessMm) draft = surveyGraph.setThickness(draft, options.thicknessMm);

  function commitWall(d, point) {
    const preview = surveyGraph.startPreview(d, point);
    const floor = surveyGraph.getActiveFloor(preview);
    return surveyGraph.commitPreviewLength(
      preview,
      floor.session.previewLengthMm,
      'h5-scenario'
    );
  }

  draft = surveyGraph.placeCursor(draft, { xMm, yMm });
  draft = commitWall(draft, { xMm: xMm + widthMm, yMm });
  draft = commitWall(draft, { xMm: xMm + widthMm, yMm: yMm + heightMm });
  draft = commitWall(draft, { xMm, yMm: yMm + heightMm });
  return surveyGraph.confirmClosure(draft);
}

function snapCursor(draft, point) {
  const floor = surveyGraph.getActiveFloor(draft);
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    point,
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  if (!target || !target.pointMm || target.type === 'free') {
    throw new Error(`吸附失败: (${point.xMm}, ${point.yMm}), target=${JSON.stringify(target)}`);
  }
  console.log('Snap target:', JSON.stringify({ type: target.type, snapLine: target.snapLine, pointMm: target.pointMm }));
  return surveyGraph.snapCursorToWall(
    surveyGraph.startWallSnap(draft),
    target.pointMm,
    target
  );
}

function commitWall(draft, point, source = 'h5-scenario') {
  const preview = surveyGraph.startPreview(draft, point);
  const floor = surveyGraph.getActiveFloor(preview);
  return surveyGraph.commitPreviewLength(
    preview,
    floor.session.previewLengthMm,
    source
  );
}

// ---------------------------------------------------------------
// Build a 6000×4000 rectangle (walls at y=0 top, y=4000 bottom, x=0 left, x=6000 right)
// Wall thickness = 200mm; outer face of top wall is at y=-200
// ---------------------------------------------------------------
let draft = rectangle(6000, 4000, { xMm: 0, yMm: 0 }, { thicknessMm: 200 });

{
  const floor = surveyGraph.getActiveFloor(draft);
  console.log(`Rectangle: ${floor.walls.length} walls, ${floor.spaces.length} spaces`);
  console.log('Spaces:', floor.spaces.map(s => ({ id: s.id, closed: s.closed })));
}

// ---------------------------------------------------------------
// Snap cursor to the OUTER face of the top wall (sourceWall[0], y=-200)
// The mid-point of the outer face: xMm=3000, yMm=-200
// ---------------------------------------------------------------
try {
  draft = snapCursor(draft, { xMm: 3000, yMm: -200 });
  const floor = surveyGraph.getActiveFloor(draft);
  const session = floor.session;
  console.log(`After snap: state=${session.state}, anchor=${JSON.stringify({ xMm: surveyGraph.getNode(floor, session.anchorNodeId)?.xMm, yMm: surveyGraph.getNode(floor, session.anchorNodeId)?.yMm })}`);
  console.log(`  activeSpaceSharedWallId=${session.activeSpaceSharedWallId}, snapLine=${session.activeSpaceSharedSnapLine}`);
} catch (e) {
  console.error('Snap failed:', e.message);
  process.exit(1);
}

// Draw wall 1: down
try {
  draft = commitWall(draft, { xMm: 3000, yMm: -2200 });
  const floor = surveyGraph.getActiveFloor(draft);
  const session = floor.session;
  console.log(`Wall 1 committed: state=${session.state}, walls=${floor.walls.length}`);
} catch (e) {
  console.error('Wall 1 failed:', e.message);
  process.exit(1);
}

// Draw wall 2: rightward (or leftward)
try {
  draft = commitWall(draft, { xMm: 5000, yMm: -2200 });
  const floor = surveyGraph.getActiveFloor(draft);
  const session = floor.session;
  console.log(`Wall 2 committed: state=${session.state}, walls=${floor.walls.length}`);
} catch (e) {
  console.error('Wall 2 failed:', e.message);
  process.exit(1);
}

// Draw wall 3: back toward the shared wall (outer face at y=-200)
try {
  draft = commitWall(draft, { xMm: 5000, yMm: -200 });
  const floor = surveyGraph.getActiveFloor(draft);
  const session = floor.session;
  console.log(`Wall 3 committed: state=${session.state}, walls=${floor.walls.length}`);
  console.log(`  closeCandidateType=${session.closeCandidateType}, closeCandidateNodeId=${session.closeCandidateNodeId}`);
  if (session.state === 'closing' || session.state === 'mergeClosing') {
    // Close
    draft = surveyGraph.confirmClosure(draft);
    const floor2 = surveyGraph.getActiveFloor(draft);
    console.log(`Closed: walls=${floor2.walls.length}, spaces=${floor2.spaces.length}`);
    console.log('SUCCESS: Room closed correctly!');
  } else {
    console.log('State after wall 3 is not closing - no auto-close triggered');
  }
} catch (e) {
  console.error('Wall 3 failed:', e.message);
  console.error(e.stack);
}
