/**
 * Targeted test for outer T-junction closure bug.
 * Specifically: starting from outer face, drawing U-shape,
 * and the THIRD wall's preview landing on the outer face at a point
 * where mergeCandidate cannot be found.
 */

const surveyGraph = require('./miniprogram/utils/surveyWallGraph.js');

function rectangle(widthMm, heightMm, origin, options = {}) {
  const { xMm, yMm } = origin || { xMm: 0, yMm: 0 };
  let draft = surveyGraph.resetCursor(surveyGraph.createSurveyDraft());
  if (options.thicknessMm) draft = surveyGraph.setThickness(draft, options.thicknessMm);

  function commitWall(d, point) {
    const preview = surveyGraph.startPreview(d, point);
    const floor = surveyGraph.getActiveFloor(preview);
    return surveyGraph.commitPreviewLength(preview, floor.session.previewLengthMm, 'h5-scenario');
  }

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
    throw new Error(`吸附失败: (${point.xMm}, ${point.yMm}), target=${JSON.stringify(target)}`);
  }
  return surveyGraph.snapCursorToWall(surveyGraph.startWallSnap(draft), target.pointMm, target);
}

// ---------------------------------------------------------------
// Scenario: 6000×4000 rectangle, outer face start at mid of top wall
// The "outer" face (top wall) is at y = -200 (wall thickness = 200mm, grows downward)
// Wait - actually the rectangle is drawn from (0,0) going right then down. Let's check.
// ---------------------------------------------------------------
let draft = rectangle(6000, 4000, { xMm: 0, yMm: 0 }, { thicknessMm: 200 });
{
  const floor = surveyGraph.getActiveFloor(draft);
  console.log(`Rectangle walls: ${floor.walls.length}`);
  floor.walls.forEach((w, i) => {
    const s = surveyGraph.getNode(floor, w.startNodeId);
    const e = surveyGraph.getNode(floor, w.endNodeId);
    console.log(`  wall[${i}]: (${s.xMm},${s.yMm}) -> (${e.xMm},${e.yMm}), thickness=${w.thicknessMm}`);
  });
  const geom = surveyGraph.buildWallSnapGeometry(floor, floor.walls[0]);
  console.log(`  wall[0] outer face: (${geom.outerStart.xMm},${geom.outerStart.yMm}) -> (${geom.outerEnd.xMm},${geom.outerEnd.yMm})`);
}

// Snap to outer face mid-point
draft = snapCursor(draft, { xMm: 3000, yMm: -200 });
{
  const floor = surveyGraph.getActiveFloor(draft);
  const sess = floor.session;
  const anchor = surveyGraph.getNode(floor, sess.anchorNodeId);
  console.log(`\nSnapped: anchor=(${anchor?.xMm},${anchor?.yMm}), snapLine=${sess.activeSpaceSharedSnapLine}`);
}

// Draw wall 1 down
{
  let preview = surveyGraph.startPreview(draft, { xMm: 3000, yMm: -2000 });
  const floor = surveyGraph.getActiveFloor(preview);
  const sess = floor.session;
  console.log(`\nPreview wall1: previewPoint=(${sess.previewPoint?.xMm},${sess.previewPoint?.yMm}), len=${sess.previewLengthMm}`);
  draft = surveyGraph.commitPreviewLength(preview, sess.previewLengthMm, 'preview');
  const floor2 = surveyGraph.getActiveFloor(draft);
  console.log(`  After commit wall1: state=${floor2.session.state}, walls=${floor2.walls.length}`);
}

// Draw wall 2 right
{
  let preview = surveyGraph.startPreview(draft, { xMm: 5000, yMm: -2000 });
  const floor = surveyGraph.getActiveFloor(preview);
  const sess = floor.session;
  console.log(`\nPreview wall2: previewPoint=(${sess.previewPoint?.xMm},${sess.previewPoint?.yMm}), len=${sess.previewLengthMm}`);
  draft = surveyGraph.commitPreviewLength(preview, sess.previewLengthMm, 'preview');
  const floor2 = surveyGraph.getActiveFloor(draft);
  console.log(`  After commit wall2: state=${floor2.session.state}, walls=${floor2.walls.length}`);
}

// Preview wall 3 BACK toward the outer face (at xMm=5000, yMm=-200)
// The outer face is at y=-200 (top wall, outer face going upward/negative y)
{
  let preview = surveyGraph.startPreview(draft, { xMm: 5000, yMm: -200 });
  const floor = surveyGraph.getActiveFloor(preview);
  const sess = floor.session;
  console.log(`\nPreview wall3 toward outer face: previewPoint=(${sess.previewPoint?.xMm},${sess.previewPoint?.yMm}), len=${sess.previewLengthMm}`);
  console.log(`  closeCandidateNodeId=${sess.closeCandidateNodeId}, closeCandidateType=${sess.closeCandidateType}`);
  console.log(`  closeCandidatePoint=${JSON.stringify(sess.closeCandidatePoint)}`);
  
  // Check if isDirectClosureHit would be true
  const directHit = surveyGraph.isDirectClosureHit(floor, sess, { xMm: 5000, yMm: -200 });
  console.log(`  isDirectClosureHit: ${directHit}`);
  
  // Check if confirmClosure would work at this point (preview stage)
  if (sess.closeCandidateNodeId || sess.closeCandidatePoint) {
    console.log('  -> Has close candidate, try confirmClosure...');
    try {
      const closed = surveyGraph.confirmClosure(preview);
      const floor2 = surveyGraph.getActiveFloor(closed);
      console.log(`  -> SUCCESS: walls=${floor2.walls.length}, spaces=${floor2.spaces.length}`);
    } catch (e) {
      console.log(`  -> FAILED: ${e.message}`);
    }
  } else {
    console.log('  -> No close candidate at this preview point!');
    console.log('  -> USER SEES: cursor on outer face but no "合" button and no auto-close');
    
    // Try to commit the wall and see what happens
    try {
      draft = surveyGraph.commitPreviewLength(preview, sess.previewLengthMm, 'preview');
      const floor2 = surveyGraph.getActiveFloor(draft);
      console.log(`  After commit wall3: state=${floor2.session.state}, walls=${floor2.walls.length}`);
      console.log(`  closeCandidateNodeId=${floor2.session.closeCandidateNodeId}, closeCandidateType=${floor2.session.closeCandidateType}`);
    } catch (e) {
      console.log(`  Commit wall3 failed: ${e.message}`);
    }
  }
}

// Try the actual close scenario:
// When user releases the drag on the outer face (after having 2 walls drawn)
// The preview is at outer face, and we need the system to auto-close.
// Let's replicate the full commitPreviewLength flow to see the overlap error:
console.log('\n--- Testing commitPreviewLength directly ---');
{
  // Rebuild: after 2 walls
  let draft2 = rectangle(6000, 4000, { xMm: 0, yMm: 0 }, { thicknessMm: 200 });
  draft2 = snapCursor(draft2, { xMm: 3000, yMm: -200 });
  
  // Commit walls 1 and 2
  const commitWall = (d, pt) => {
    const prev = surveyGraph.startPreview(d, pt);
    const f = surveyGraph.getActiveFloor(prev);
    return surveyGraph.commitPreviewLength(prev, f.session.previewLengthMm, 'preview');
  };
  draft2 = commitWall(draft2, { xMm: 3000, yMm: -2000 });
  draft2 = commitWall(draft2, { xMm: 5000, yMm: -2000 });
  
  // Preview toward the outer face at (5000, -200)
  const preview = surveyGraph.startPreview(draft2, { xMm: 5000, yMm: -200 });
  const floor = surveyGraph.getActiveFloor(preview);
  const sess = floor.session;
  console.log(`Preview point: (${sess.previewPoint?.xMm},${sess.previewPoint?.yMm}), len=${sess.previewLengthMm}`);
  
  // Directly call commitPreviewLength
  try {
    const committed = surveyGraph.commitPreviewLength(preview, sess.previewLengthMm, 'preview');
    const floor2 = surveyGraph.getActiveFloor(committed);
    console.log(`commitPreviewLength SUCCESS: state=${floor2.session.state}, walls=${floor2.walls.length}`);
  } catch (e) {
    console.log(`commitPreviewLength FAILED: ${e.message}`);
  }
}
