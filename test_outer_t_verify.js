/**
 * Verify that the overlap check in commitPreviewLength passes for outer face closure.
 * Tests: isClosingCurrentSpace = true + ignoredWallIds includes the shared wall.
 */

const surveyGraph = require('./miniprogram/utils/surveyWallGraph.js');

function rectangle(widthMm, heightMm, origin, options = {}) {
  const { xMm, yMm } = origin || { xMm: 0, yMm: 0 };
  let draft = surveyGraph.resetCursor(surveyGraph.createSurveyDraft());
  if (options.thicknessMm) draft = surveyGraph.setThickness(draft, options.thicknessMm);

  const commitWall = (d, point) => {
    const preview = surveyGraph.startPreview(d, point);
    const floor = surveyGraph.getActiveFloor(preview);
    return surveyGraph.commitPreviewLength(preview, floor.session.previewLengthMm, 'h5-scenario');
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
  return surveyGraph.snapCursorToWall(surveyGraph.startWallSnap(draft), target.pointMm, target);
}

const commitWall = (d, pt) => {
  const prev = surveyGraph.startPreview(d, pt);
  const f = surveyGraph.getActiveFloor(prev);
  return surveyGraph.commitPreviewLength(prev, f.session.previewLengthMm, 'preview');
};

// Build the rectangle and start U-shape from outer face
let draft = rectangle(6000, 4000, { xMm: 0, yMm: 0 }, { thicknessMm: 200 });
draft = snapCursor(draft, { xMm: 3000, yMm: -200 }); // outer face
draft = commitWall(draft, { xMm: 3000, yMm: -2000 }); // wall 1 down
draft = commitWall(draft, { xMm: 5000, yMm: -2000 }); // wall 2 right

// Now check what startPreview computes for the THIRD wall going to outer face
{
  const preview = surveyGraph.startPreview(draft, { xMm: 5000, yMm: -200 });
  const floor = surveyGraph.getActiveFloor(preview);
  const sess = floor.session;
  
  console.log('=== Preview state (3rd wall to outer face) ===');
  console.log(`  previewPoint: (${sess.previewPoint?.xMm}, ${sess.previewPoint?.yMm})`);
  console.log(`  closeCandidateNodeId: ${sess.closeCandidateNodeId}`);
  console.log(`  closeCandidatePoint: ${JSON.stringify(sess.closeCandidatePoint)}`);
  console.log(`  closeCandidateType: ${sess.closeCandidateType}`);
  console.log(`  closeCandidateSharedWallId: ${sess.closeCandidateSharedWallId}`);
  console.log(`  previewOuterFaceWallId: ${sess.previewOuterFaceWallId}`);
  
  // Show wall indices
  console.log(`  floor.walls.length: ${floor.walls.length}`);
  console.log(`  activeSpaceStartWallIndex: ${sess.activeSpaceStartWallIndex}`);
  console.log(`  activeWallCount: ${floor.walls.length - sess.activeSpaceStartWallIndex}`);
  
  const canClose = !!(sess.closeCandidateNodeId || sess.closeCandidatePoint);
  console.log(`  -> Can close (has candidate): ${canClose}`);
}

console.log('\n=== Commit 3rd wall and check state ===');
{
  const preview = surveyGraph.startPreview(draft, { xMm: 5000, yMm: -200 });
  const floor = surveyGraph.getActiveFloor(preview);
  const sess = floor.session;
  
  try {
    const committed = surveyGraph.commitPreviewLength(preview, sess.previewLengthMm, 'preview');
    const floor2 = surveyGraph.getActiveFloor(committed);
    const sess2 = floor2.session;
    console.log(`  state: ${sess2.state}`);
    console.log(`  closeCandidateNodeId: ${sess2.closeCandidateNodeId}`);
    console.log(`  closeCandidateSharedWallId: ${sess2.closeCandidateSharedWallId}`);
    console.log(`  walls: ${floor2.walls.length}, spaces: ${floor2.spaces.length}`);
    
    if (sess2.state === 'closing' || sess2.state === 'mergeClosing') {
      console.log('  -> Trying confirmClosure...');
      try {
        const closed = surveyGraph.confirmClosure(committed);
        const floor3 = surveyGraph.getActiveFloor(closed);
        console.log(`  -> SUCCESS: walls=${floor3.walls.length}, spaces=${floor3.spaces.length}`);
      } catch (e) {
        console.log(`  -> confirmClosure FAILED: ${e.message}`);
      }
    } else {
      console.log('  -> State is not closing/mergeClosing - user cannot close!');
    }
  } catch (e) {
    console.log(`  commitPreviewLength FAILED: ${e.message}`);
  }
}

// Now check a scenario where the user enters a specific mm value (BLE measurement)
// e.g. they measure the 3rd wall as exactly 1800mm and press confirm  
console.log('\n=== Simulate BLE-inputted close (after 2 walls) ===');
{
  const preview = surveyGraph.startPreview(draft, { xMm: 5000, yMm: -200 });
  const floor = surveyGraph.getActiveFloor(preview);
  const sess = floor.session;
  
  // The user inputs 1800mm (the exact distance)
  try {
    const committed = surveyGraph.commitPreviewLength(preview, 1800, 'manual-input');
    const floor2 = surveyGraph.getActiveFloor(committed);
    const sess2 = floor2.session;
    console.log(`  state: ${sess2.state}, walls: ${floor2.walls.length}`);
    
    if (sess2.state === 'closing' || sess2.state === 'mergeClosing') {
      try {
        const closed = surveyGraph.confirmClosure(committed);
        const floor3 = surveyGraph.getActiveFloor(closed);
        console.log(`  -> SUCCESS with manual input: walls=${floor3.walls.length}, spaces=${floor3.spaces.length}`);
      } catch (e) {
        console.log(`  -> confirmClosure FAILED: ${e.message}`);
      }
    } else {
      console.log(`  -> Manual input state is '${sess2.state}' - not closing, user cannot close!`);
    }
  } catch (e) {
    console.log(`  commitPreviewLength with manual input FAILED: ${e.message}`);
  }
}
