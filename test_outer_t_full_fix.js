/**
 * Full scenario test: H5 "外墙T:外边起步" + U-shape closure
 * Simulates what the user does interactively.
 */

const surveyGraph = require('./miniprogram/utils/surveyWallGraph.js');

function rectangle(widthMm, heightMm, origin, options = {}) {
  const { xMm, yMm } = origin || {};
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

function simulateMeasurement(draft, lengthMm) {
  // Simulates BLE/manual input: takes the current preview direction
  // and commits it at the specified length
  const floor = surveyGraph.getActiveFloor(draft);
  const session = floor.session;
  if (!session.previewPoint) throw new Error('No preview point set');
  return surveyGraph.commitPreviewLength(draft, lengthMm, 'ble');
}

function drag(draft, toPoint) {
  return surveyGraph.startPreview(draft, toPoint);
}

function report(label, draft) {
  const floor = surveyGraph.getActiveFloor(draft);
  const sess = floor.session;
  console.log(`[${label}]: state=${sess.state}, walls=${floor.walls.length}, spaces=${floor.spaces.filter(s => s.closed).length}`);
  if (sess.closeCandidateNodeId || sess.closeCandidatePoint) {
    console.log(`  → closeCandidate: type=${sess.closeCandidateType}, point=${JSON.stringify(sess.closeCandidatePoint)}, nodeId=${sess.closeCandidateNodeId}`);
  }
}

// ============================================================
// BUILD: H5 "外墙T:外边起步" scenario
// ============================================================
let draft = rectangle(6000, 4000, { xMm: 0, yMm: 0 }, { thicknessMm: 200 });
draft = snapCursor(draft, { xMm: 3000, yMm: -200 }); // outer face midpoint

// One wall downward (from scenario.build)
const prev = surveyGraph.startPreview(draft, { xMm: 3000, yMm: -2200 });
const fl = surveyGraph.getActiveFloor(prev);
draft = surveyGraph.commitPreviewLength(prev, fl.session.previewLengthMm, 'h5-scenario');
report('After scenario load', draft);

// ============================================================
// USER INTERACTION: drag preview right, measure, then up
// ============================================================
console.log('\n--- User draws rightward then up ---');

// Drag toward (5000, -2200) and then measure 2000mm
draft = drag(draft, { xMm: 5000, yMm: -2200 });
report('Preview wall2 (rightward)', draft);

// User releases or presses Enter with BLE 2000mm
draft = simulateMeasurement(draft, 2000);
report('After wall2 commit', draft);

// Drag toward (5000, -200) - the outer face of top wall
draft = drag(draft, { xMm: 5000, yMm: -200 });
{
  const floor = surveyGraph.getActiveFloor(draft);
  const sess = floor.session;
  report('Preview wall3 (back to outer face)', draft);
  const directHit = surveyGraph.isDirectClosureHit(floor, sess, { xMm: 5000, yMm: -200 });
  console.log(`  isDirectClosureHit: ${directHit} ← should be TRUE for auto-close on release`);
}

// Simulate touch release: auto-close should trigger
console.log('\n--- Simulating touch release (auto-close) ---');
{
  const floor = surveyGraph.getActiveFloor(draft);
  const sess = floor.session;
  const directHit = surveyGraph.isDirectClosureHit(floor, sess, { xMm: 5000, yMm: -200 });
  if (directHit) {
    try {
      draft = surveyGraph.confirmClosure(draft);
      report('After auto-close on release', draft);
      console.log('✅ AUTO-CLOSE SUCCESS: room created without user pressing 合');
    } catch (e) {
      console.log('❌ confirmClosure FAILED:', e.message);
    }
  } else {
    // Fallback: commit then show "合" button
    draft = simulateMeasurement(draft, 1800);
    report('After wall3 commit (no auto-close)', draft);
    if (surveyGraph.getActiveFloor(draft).session.state === 'closing') {
      console.log('→ state=closing, user must press 合');
      draft = surveyGraph.confirmClosure(draft);
      report('After manual 合', draft);
    }
  }
}

// ============================================================
// Also test: manual measurement input (BLE value) for wall3
// ============================================================
console.log('\n--- Test: BLE measurement input for wall3 ---');
let draft2 = rectangle(6000, 4000, { xMm: 0, yMm: 0 }, { thicknessMm: 200 });
draft2 = snapCursor(draft2, { xMm: 3000, yMm: -200 });
const pv2 = surveyGraph.startPreview(draft2, { xMm: 3000, yMm: -2200 });
const fl2 = surveyGraph.getActiveFloor(pv2);
draft2 = surveyGraph.commitPreviewLength(pv2, fl2.session.previewLengthMm, 'h5-scenario');
draft2 = drag(draft2, { xMm: 5000, yMm: -2200 });
draft2 = simulateMeasurement(draft2, 2000);
// User types "1800" and presses Enter when cursor is near outer face
draft2 = drag(draft2, { xMm: 5000, yMm: -200 });
draft2 = simulateMeasurement(draft2, 1800); // manual BLE input
report('After BLE measurement input for wall3', draft2);
const sess2 = surveyGraph.getActiveFloor(draft2).session;
if (sess2.state === 'closing' || sess2.state === 'mergeClosing') {
  try {
    draft2 = surveyGraph.confirmClosure(draft2);
    report('After confirmClosure (BLE path)', draft2);
    console.log('✅ BLE measurement path WORKS');
  } catch (e) {
    console.log('❌ confirmClosure FAILED:', e.message);
  }
}
