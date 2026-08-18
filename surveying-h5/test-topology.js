const surveyGraph = require('../miniprogram/utils/surveyWallGraph.js');
const { createSurveyDraft, placeCursor, startPreview, confirmClosure, commitWall, deleteWall } = surveyGraph;

function test() {
  function rectangle(width, height, offset, options = {}) {
    const { thicknessMm = 200 } = options;
    let draft = createSurveyDraft();
    draft = placeCursor(draft, { xMm: offset.xMm, yMm: offset.yMm, type: 'coordinate' });
    draft = commitWall(draft, { xMm: offset.xMm + width, yMm: offset.yMm });
    draft = commitWall(draft, { xMm: offset.xMm + width, yMm: offset.yMm + height });
    draft = commitWall(draft, { xMm: offset.xMm, yMm: offset.yMm + height });
    draft = startPreview(draft, { xMm: offset.xMm, yMm: offset.yMm });
    return confirmClosure(draft);
  }

  const thk = 200;
  const room1W = 3129;
  const room1H = 3565;
  let draft = rectangle(room1W, room1H, { xMm: 0, yMm: -room1H }, { thicknessMm: thk });
  
  draft = placeCursor(draft, surveyGraph.getCursorPlacementTarget(draft, { xMm: room1W + thk, yMm: -room1H }));
  draft = commitWall(draft, { xMm: room1W + thk + 2454, yMm: -room1H });
  draft = commitWall(draft, { xMm: room1W + thk + 2454, yMm: -room1H + 1569 });
  draft = startPreview(draft, surveyGraph.getCursorPlacementTarget(draft, { xMm: room1W + thk, yMm: -room1H + 1569 }));
  draft = confirmClosure(draft);

  const floor = draft.floors[0];
  console.log('Before delete:');
  console.log('Spaces:', floor.spaces.length);
  floor.spaces.forEach((s, i) => console.log(`Space ${i} closed:`, s.closed));

  let sharedWallId = null;
  for (const w of floor.spaces[0].wallIds) {
    if (floor.spaces[1].wallIds.includes(w)) {
      sharedWallId = w;
      break;
    }
  }
  console.log('Shared wall:', sharedWallId);

  draft = deleteWall(draft, sharedWallId);
  const floor2 = draft.floors[0];
  console.log('After delete:');
  console.log('Spaces:', floor2.spaces.length);
  floor2.spaces.forEach((s, i) => console.log(`Space ${i} closed:`, s.closed));
}
test();
