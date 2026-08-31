const test = require('node:test');
const assert = require('node:assert/strict');
const surveyGraph = require('../packages/surveying/utils/surveyWallGraph.js');

const OUTLINES = {
  concaveL: [
    [1, 0, 6000],
    [0, 1, 2000],
    [-1, 0, 3000],
    [0, 1, 3000],
    [-1, 0, 3000],
    [0, -1, 5000]
  ],
  concaveU: [
    [1, 0, 7000],
    [0, 1, 5000],
    [-1, 0, 2000],
    [0, -1, 3000],
    [-1, 0, 3000],
    [0, 1, 3000],
    [-1, 0, 2000],
    [0, -1, 5000]
  ],
  stepped: [
    [1, 0, 7000],
    [0, 1, 1500],
    [-1, 0, 1500],
    [0, 1, 1500],
    [-1, 0, 1500],
    [0, 1, 2000],
    [-1, 0, 4000],
    [0, -1, 5000]
  ]
};

function commitMeasuredOutline(vectors, measuredLengths) {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  vectors.forEach(([dx, dy, nominalLength], index) => {
    const floor = surveyGraph.getActiveFloor(draft);
    const anchor = surveyGraph.getNode(floor, floor.session.anchorNodeId);
    draft = surveyGraph.startPreview(draft, {
      xMm: anchor.xMm + dx * nominalLength,
      yMm: anchor.yMm + dy * nominalLength
    });
    draft = surveyGraph.commitPreviewLength(
      draft,
      measuredLengths[index],
      'ble'
    );
  });
  return draft;
}

function createSeededNoise(seed) {
  let state = seed >>> 0;
  return (maximum) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return Math.floor(state / 4294967296 * (maximum * 2 + 1)) - maximum;
  };
}

test('a noisy multi-corner orthogonal traverse closes by adjustment instead of a micro bridge', () => {
  const draft = commitMeasuredOutline(
    OUTLINES.concaveL,
    [6003, 2002, 2996, 3001, 3005, 4998]
  );
  const pendingFloor = surveyGraph.getActiveFloor(draft);
  const pendingEnd = surveyGraph.getNode(pendingFloor, pendingFloor.session.anchorNodeId);

  assert.equal(pendingFloor.session.state, 'closing');
  assert.equal(pendingFloor.session.closeCandidateType, 'start');
  assert.equal(surveyGraph.distanceMm(pendingEnd, { xMm: 0, yMm: 0 }), 5);

  const closed = surveyGraph.confirmClosure(draft);
  const floor = surveyGraph.getActiveFloor(closed);
  assert.equal(floor.session.state, 'spaceClosed');
  assert.equal(floor.walls.length, OUTLINES.concaveL.length);
  assert.equal(floor.walls.some((wall) => wall.inputSource === 'closure-bridge'), false);
  assert.equal(surveyGraph.validateSurveyDraft(closed, { mode: 'full' }).valid, true);
  assert.ok(floor.walls.some((wall) => Number.isFinite(wall.rawMeasuredLengthMm)));
  assert.equal(
    floor.walls.reduce((total, wall) => total + Number(wall.closureAdjustmentMm || 0), 0),
    -7
  );
});

test('independent five-millimetre readings remain closable across concave orthogonal outlines', () => {
  const noise = createSeededNoise(0x5f3759df);
  Object.entries(OUTLINES).forEach(([name, vectors]) => {
    for (let iteration = 0; iteration < 40; iteration += 1) {
      const measuredLengths = vectors.map(([, , length]) => length + noise(5));
      const draft = commitMeasuredOutline(vectors, measuredLengths);
      const floor = surveyGraph.getActiveFloor(draft);
      assert.ok(
        floor.session.state === 'closing' || floor.session.state === 'mergeClosing',
        `${name}:${iteration} did not offer closure`
      );
      const closed = surveyGraph.confirmClosure(draft);
      assert.equal(
        surveyGraph.getActiveFloor(closed).session.state,
        'spaceClosed',
        `${name}:${iteration} did not close`
      );
      assert.equal(
        surveyGraph.validateSurveyDraft(closed, { mode: 'full' }).valid,
        true,
        `${name}:${iteration} produced an invalid graph`
      );
    }
  });
});
