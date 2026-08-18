const kernel = require('./miniprogram/utils/survey/legacy-kernel.js');

function rectangle(widthMm, heightMm, origin, options = {}) {
  const { xMm, yMm } = origin || { xMm: 0, yMm: 0 };
  let draft = kernel.resetCursor(kernel.createSurveyDraft());
  if (options.thicknessMm) draft = kernel.setThickness(draft, options.thicknessMm);
  const commitWall = (d, point) => {
    const prev = kernel.startPreview(d, point);
    const f = kernel.getActiveFloor(prev);
    return kernel.commitPreviewLength(prev, f.session.previewLengthMm, 'h5-scenario');
  };
  draft = kernel.placeCursor(draft, { xMm, yMm });
  draft = commitWall(draft, { xMm: xMm + widthMm, yMm });
  draft = commitWall(draft, { xMm: xMm + widthMm, yMm: yMm + heightMm });
  draft = commitWall(draft, { xMm, yMm: yMm + heightMm });
  return kernel.confirmClosure(draft);
}

function snapCursor(draft, point) {
  const floor = kernel.getActiveFloor(draft);
  const target = kernel.getCursorPlacementTarget(floor, point, kernel.CLOSE_TOLERANCE_MM);
  return kernel.snapCursorToWall(kernel.startWallSnap(draft), target.pointMm, target);
}

const commitWall = (d, pt) => {
  const prev = kernel.startPreview(d, pt);
  const f = kernel.getActiveFloor(prev);
  return kernel.commitPreviewLength(prev, f.session.previewLengthMm, 'preview');
};

let draft = rectangle(3207, 3342, { xMm: 0, yMm: 0 }, { thicknessMm: 200 });
draft = snapCursor(draft, { xMm: 1582, yMm: -200 });
draft = commitWall(draft, { xMm: 1582, yMm: -2008 });
draft = commitWall(draft, { xMm: 3407, yMm: -2008 });
const preview = kernel.startPreview(draft, { xMm: 3407, yMm: -1195 });

console.log('Running confirmClosure...');
const closed = kernel.confirmClosure(preview);
const flClosed = kernel.getActiveFloor(closed);
console.log('Closure succeeded!');
console.log('Spaces count:', flClosed.spaces.length);
flClosed.spaces.forEach((s, idx) => {
  console.log(`\nSpace[${idx}] id=${s.id} name=${s.name}:`);
  console.log('  wallIds:', s.wallIds);
});
console.log('\nWalls list:');
flClosed.walls.forEach((w, i) => {
  const s = kernel.getNode(flClosed, w.startNodeId);
  const e = kernel.getNode(flClosed, w.endNodeId);
  console.log(`  wall[${i}]: id=${w.id}, (${s?.xMm},${s?.yMm}) -> (${e?.xMm},${e?.yMm}), thickness=${w.thicknessMm}`);
});
