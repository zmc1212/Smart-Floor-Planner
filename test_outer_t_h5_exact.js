/**
 * Exact reproduction of the H5 "外墙T:外边起步" scenario.
 * The scenario builds: rectangle + ONE wall downward from outer face.
 * Then user tries to draw MORE walls to close back to the shared wall.
 */

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
    throw new Error(`吸附失败: (${point.xMm}, ${point.yMm}), target=${JSON.stringify(target)}`);
  }
  console.log(`Snap: type=${target.type}, snapLine=${target.snapLine}, pointMm=(${target.pointMm.xMm},${target.pointMm.yMm})`);
  return surveyGraph.snapCursorToWall(surveyGraph.startWallSnap(draft), target.pointMm, target);
}

const commitWall = (d, pt, label = '') => {
  const prev = surveyGraph.startPreview(d, pt);
  const f = surveyGraph.getActiveFloor(prev);
  const sess = f.session;
  console.log(`  Preview ${label}: point=(${sess.previewPoint?.xMm},${sess.previewPoint?.yMm}), len=${sess.previewLengthMm}`);
  const committed = surveyGraph.commitPreviewLength(prev, sess.previewLengthMm, 'preview');
  const f2 = surveyGraph.getActiveFloor(committed);
  console.log(`  After commit ${label}: state=${f2.session.state}, walls=${f2.walls.length}`);
  return committed;
};

// ---------------------------------------------------------------
// Step 1: Build the H5 scenario (rectangle + one branch from outer face)
// ---------------------------------------------------------------
let draft = rectangle(6000, 4000, { xMm: 0, yMm: 0 }, { thicknessMm: 200 });
{
  const floor = surveyGraph.getActiveFloor(draft);
  console.log(`Step 1: Rectangle done: ${floor.walls.length} walls, ${floor.spaces.length} spaces`);
  floor.walls.forEach((w, i) => {
    const s = surveyGraph.getNode(floor, w.startNodeId);
    const e = surveyGraph.getNode(floor, w.endNodeId);
    console.log(`  wall[${i}]: id=${w.id}, (${s.xMm},${s.yMm}) -> (${e.xMm},${e.yMm})`);
  });
  const geom = surveyGraph.buildWallSnapGeometry(floor, floor.walls[0]);
  console.log(`  wall[0] outer: (${geom.outerStart.xMm},${geom.outerStart.yMm}) -> (${geom.outerEnd.xMm},${geom.outerEnd.yMm})`);
}

// Snap to outer face mid-point of wall[0] (the top wall)
console.log('\nStep 2: Snap to outer face...');
draft = snapCursor(draft, { xMm: 3000, yMm: -200 });
{
  const floor = surveyGraph.getActiveFloor(draft);
  const sess = floor.session;
  const anchor = surveyGraph.getNode(floor, sess.anchorNodeId);
  console.log(`  Snapped: anchor=(${anchor?.xMm},${anchor?.yMm}), snapLine=${sess.activeSpaceSharedSnapLine}`);
  console.log(`  activeSpaceSharedWallId=${sess.activeSpaceSharedWallId}`);
  console.log(`  activeSpaceStartWallIndex=${sess.activeSpaceStartWallIndex}, walls=${floor.walls.length}`);
}

// Commit the scenario's first wall (down to -2200)
console.log('\nStep 3: Commit initial branch wall...');
draft = commitWall(draft, { xMm: 3000, yMm: -2200 }, 'branch-down');
{
  const floor = surveyGraph.getActiveFloor(draft);
  const sess = floor.session;
  const anchor = surveyGraph.getNode(floor, sess.anchorNodeId);
  console.log(`  anchor=(${anchor?.xMm},${anchor?.yMm}), activeSpaceStartWallIndex=${sess.activeSpaceStartWallIndex}`);
}

// ---------------------------------------------------------------
// Step 4: Now the user tries to draw MORE walls to close the room
// H5 scenario ends here, but the user continues interactively.
// ---------------------------------------------------------------
console.log('\n=== User continues drawing to close U-shape ===');

// Wall 2: from (3000,-2200) to (5000,-2200) - horizontal
console.log('\nStep 4: Draw wall 2 (horizontal)...');
draft = commitWall(draft, { xMm: 5000, yMm: -2200 }, 'wall2-horizontal');

// Wall 3: from (5000,-2200) to (5000,-200) - back up to outer face
console.log('\nStep 5: Draw wall 3 (back to outer face)...');
{
  const preview = surveyGraph.startPreview(draft, { xMm: 5000, yMm: -200 });
  const floor = surveyGraph.getActiveFloor(preview);
  const sess = floor.session;
  console.log(`  Preview wall3: previewPoint=(${sess.previewPoint?.xMm},${sess.previewPoint?.yMm})`);
  console.log(`  closeCandidateNodeId=${sess.closeCandidateNodeId}`);
  console.log(`  closeCandidatePoint=${JSON.stringify(sess.closeCandidatePoint)}`);
  console.log(`  closeCandidateType=${sess.closeCandidateType}`);
  console.log(`  closeCandidateSharedWallId=${sess.closeCandidateSharedWallId}`);
  console.log(`  previewOuterFaceWallId=${sess.previewOuterFaceWallId}`);
  
  const hasCloseCandidate = !!(sess.closeCandidateNodeId || sess.closeCandidatePoint);
  console.log(`  isDirectClosureHit: ${surveyGraph.isDirectClosureHit(floor, sess, { xMm: 5000, yMm: -200 })}`);
  console.log(`  Has close candidate: ${hasCloseCandidate}`);
  
  if (hasCloseCandidate) {
    console.log('\n  -> Trying confirmClosure at preview stage...');
    try {
      const closed = surveyGraph.confirmClosure(preview);
      const floor2 = surveyGraph.getActiveFloor(closed);
      console.log(`  -> SUCCESS: walls=${floor2.walls.length}, spaces=${floor2.spaces.length}`);
    } catch (e) {
      console.log(`  -> FAILED: ${e.message}`);
    }
  } else {
    console.log('\n  -> NO close candidate! This is the bug.');
    console.log('\n  -> Trying to commit wall3 anyway and check state...');
    try {
      const committed = surveyGraph.commitPreviewLength(preview, sess.previewLengthMm, 'preview');
      const floor2 = surveyGraph.getActiveFloor(committed);
      const sess2 = floor2.session;
      console.log(`  After commit wall3: state=${sess2.state}, walls=${floor2.walls.length}`);
    } catch (e) {
      console.log(`  Commit wall3 FAILED: ${e.message}`);
    }
  }
}
