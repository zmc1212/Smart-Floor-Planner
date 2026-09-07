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
  ],
  longNotched: [
    [1, 0, 10000],
    [0, 1, 1000],
    [-1, 0, 2000],
    [0, 1, 1000],
    [1, 0, 2000],
    [0, 1, 1000],
    [-1, 0, 2000],
    [0, 1, 1000],
    [1, 0, 2000],
    [0, 1, 1000],
    [-1, 0, 10000],
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
  const pendingEnd = pendingFloor.session.previewPoint;

  assert.equal(pendingFloor.session.state, 'wallPreview');
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
    floor.walls.reduce((total, wall) => total + Math.abs(Number(wall.closureAdjustmentMm || 0)), 0),
    207
  );
  floor.walls.forEach((wall) => {
    assert.equal(
      wall.closureAdjustmentMm,
      Math.round(wall.lengthMm - wall.rawMeasuredLengthMm)
    );
  });
});

test('a long multi-corner traverse can use accumulated correction budget beyond snap tolerance', () => {
  const measuredLengths = OUTLINES.longNotched.map((entry) => entry[2]);
  measuredLengths[0] += 150;
  measuredLengths[2] -= 25;
  measuredLengths[4] += 25;
  measuredLengths[6] -= 25;
  measuredLengths[8] += 25;
  measuredLengths[10] -= 150;

  const draft = commitMeasuredOutline(OUTLINES.longNotched, measuredLengths);
  const pendingFloor = surveyGraph.getActiveFloor(draft);
  const pendingEnd = pendingFloor.session.previewPoint;
  assert.equal(surveyGraph.distanceMm(pendingEnd, { xMm: 0, yMm: 0 }), 400);
  assert.equal(pendingFloor.session.state, 'wallPreview');
  assert.equal(pendingFloor.session.closeCandidateType, 'start');

  const closed = surveyGraph.confirmClosure(draft);
  const floor = surveyGraph.getActiveFloor(closed);
  assert.equal(floor.session.state, 'spaceClosed');
  assert.equal(floor.walls.length, OUTLINES.longNotched.length);
  assert.equal(floor.walls.some((wall) => wall.inputSource === 'closure-bridge'), false);
  assert.equal(surveyGraph.validateSurveyDraft(closed, { mode: 'full' }).valid, true);
});

test('a short loop cannot spend the full snap tolerance on one wall pair', () => {
  const draft = surveyGraph.createSurveyDraft();
  const floor = surveyGraph.getActiveFloor(draft);
  floor.nodes = [
    { id: 'a', xMm: 0, yMm: 0 },
    { id: 'b', xMm: 500, yMm: 0 },
    { id: 'c', xMm: 500, yMm: 1000 },
    { id: 'd', xMm: -350, yMm: 1000 },
    { id: 'e', xMm: -350, yMm: 0 }
  ];
  floor.walls = [
    { id: 'ab', startNodeId: 'a', endNodeId: 'b', mode: 'straight', lengthMm: 500, angleDeg: 0, thicknessMm: 200 },
    { id: 'bc', startNodeId: 'b', endNodeId: 'c', mode: 'straight', lengthMm: 1000, angleDeg: 90, thicknessMm: 200 },
    { id: 'cd', startNodeId: 'c', endNodeId: 'd', mode: 'straight', lengthMm: 850, angleDeg: 180, thicknessMm: 200 },
    { id: 'de', startNodeId: 'd', endNodeId: 'e', mode: 'straight', lengthMm: 1000, angleDeg: -90, thicknessMm: 200 }
  ];
  floor.spaces = [];
  floor.openings = [];
  floor.session.state = 'closing';
  floor.session.anchorNodeId = 'e';
  floor.session.activeSpaceStartNodeId = 'a';
  floor.session.activeSpaceStartWallIndex = 0;
  floor.session.closeCandidateNodeId = 'a';
  floor.session.closeCandidateType = 'start';
  const before = JSON.stringify(draft);

  assert.throws(
    () => surveyGraph.confirmClosure(draft),
    /闭合误差超过/
  );
  assert.equal(JSON.stringify(draft), before);
});

test('a small concave endpoint drift that crosses the first wall is balanced before overlap rejection', () => {
  // The final vertical leg is 17 mm to the right of the first wall's start
  // axis. Geometrically it crosses the first wall interior, but the complete
  // six-wall chain is still within the closure tolerance and can be balanced.
  const draft = commitMeasuredOutline(
    OUTLINES.concaveL,
    [6002, 1987, 3027, 2983, 2958, 5046]
  );
  const floor = surveyGraph.getActiveFloor(draft);
  assert.equal(floor.session.state, 'wallPreview');
  assert.equal(floor.session.closeCandidateType, 'start');

  const closed = surveyGraph.confirmClosure(draft);
  const closedFloor = surveyGraph.getActiveFloor(closed);
  assert.equal(closedFloor.session.state, 'spaceClosed');
  assert.equal(closedFloor.walls.length, OUTLINES.concaveL.length);
  assert.equal(surveyGraph.validateSurveyDraft(closed, { mode: 'full' }).valid, true);
});

test('closure adjustment does not bypass a second non-adjacent intersection', () => {
  const vectors = [
    [1, 0, 5000],
    [0, 1, 1000],
    [-1, 0, 6000],
    [0, 1, 2000],
    [1, 0, 900]
  ];
  const previewBase = commitMeasuredOutline(vectors, vectors.map((entry) => entry[2]));
  const floor = surveyGraph.getActiveFloor(previewBase);
  const anchor = surveyGraph.getNode(floor, floor.session.anchorNodeId);
  const preview = surveyGraph.startPreview(previewBase, {
    xMm: anchor.xMm,
    yMm: anchor.yMm - 2900
  });
  const before = JSON.stringify(preview);

  assert.throws(
    () => surveyGraph.commitPreviewLength(preview, 2900, 'ble'),
    /重叠/
  );
  assert.equal(JSON.stringify(preview), before);
});

test('endpoint inset repair keeps an existing raw reading and recomputes its adjustment', () => {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  draft = surveyGraph.commitPreviewLength(
    surveyGraph.startPreview(draft, { xMm: 4000, yMm: 0 }),
    4000,
    'manual'
  );
  const firstFloor = surveyGraph.getActiveFloor(draft);
  const firstWall = firstFloor.walls[0];
  assert.equal(firstWall.rawMeasuredLengthMm, 4000);
  assert.equal(firstWall.closureAdjustmentMm, 0);

  const anchor = surveyGraph.getNode(firstFloor, firstFloor.session.anchorNodeId);
  draft = surveyGraph.commitPreviewLength(
    surveyGraph.startPreview(draft, { xMm: anchor.xMm, yMm: anchor.yMm - 3000 }),
    3000,
    'manual'
  );
  const floor = surveyGraph.getActiveFloor(draft);
  const repairedWall = floor.walls[0];
  assert.equal(repairedWall.measurementEndInsetMm, 200);
  assert.equal(repairedWall.lengthMm, 3800);
  assert.equal(repairedWall.rawMeasuredLengthMm, 4000);
  assert.equal(repairedWall.closureAdjustmentMm, -200);
  assert.equal(surveyGraph.validateSurveyDraft(draft, { mode: 'full' }).valid, true);
});

test('collinear wall merge aggregates adjustment metadata instead of retaining stale fields', () => {
  const draft = surveyGraph.createSurveyDraft();
  const floor = surveyGraph.getActiveFloor(draft);
  floor.nodes = [
    { id: 'a', xMm: 0, yMm: 0 },
    { id: 'b', xMm: 2000, yMm: 0 },
    { id: 'c', xMm: 4000, yMm: 0 }
  ];
  floor.walls = [
    {
      id: 'w1', startNodeId: 'a', endNodeId: 'b', mode: 'straight', status: 'confirmed',
      thicknessMm: 200, lengthMm: 1900, angleDeg: 0,
      rawMeasuredLengthMm: 2000, closureAdjustmentMm: -100,
      adjustmentSource: 'closure-balance'
    },
    {
      id: 'w2', startNodeId: 'b', endNodeId: 'c', mode: 'straight', status: 'confirmed',
      thicknessMm: 200, lengthMm: 2100, angleDeg: 0,
      rawMeasuredLengthMm: 2050, closureAdjustmentMm: 50,
      adjustmentSource: 'coordinate-rounding'
    }
  ];
  floor.session.state = 'wallCommitted';
  floor.session.anchorNodeId = 'c';
  floor.session.activeSpaceStartNodeId = 'a';
  floor.session.activeSpaceStartWallIndex = 0;

  const repaired = surveyGraph.repairCollinearDegree2Walls(draft);
  const repairedFloor = surveyGraph.getActiveFloor(repaired);
  assert.equal(repairedFloor.walls.length, 1);
  const mergedWall = repairedFloor.walls[0];
  assert.equal(mergedWall.lengthMm, 4000);
  assert.equal(mergedWall.rawMeasuredLengthMm, 4050);
  assert.equal(mergedWall.closureAdjustmentMm, -50);
  assert.equal(mergedWall.adjustmentSource, 'closure-balance');
  assert.equal(surveyGraph.validateSurveyDraft(repaired, { mode: 'full' }).valid, true);
});

test('independent five-millimetre readings remain closable across concave orthogonal outlines', () => {
  const noise = createSeededNoise(0x5f3759df);
  Object.entries(OUTLINES).forEach(([name, vectors]) => {
    for (let iteration = 0; iteration < 40; iteration += 1) {
      const measuredLengths = vectors.map(([, , length]) => length + noise(5));
      const draft = commitMeasuredOutline(vectors, measuredLengths);
      const floor = surveyGraph.getActiveFloor(draft);
      assert.ok(
        floor.session.pendingMeasuredClosure || floor.session.state === 'spaceClosed' || floor.session.state === 'closing' || floor.session.state === 'mergeClosing',
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

function createRemeasureDraft(nodes, walls, spaces) {
  const draft = surveyGraph.createSurveyDraft();
  const floor = surveyGraph.getActiveFloor(draft);
  floor.nodes = nodes;
  floor.walls = walls;
  floor.spaces = spaces || [];
  floor.openings = [];
  floor.session.state = 'remeasureAwaitingInput';
  floor.session.selectedWallId = walls[0].id;
  floor.session.fixedNodeId = walls[0].startNodeId;
  return draft;
}

test('remeasure inverts start extension and uses the unrounded diagonal direction', () => {
  const extended = createRemeasureDraft(
    [{ id: 'a', xMm: 0, yMm: 0 }, { id: 'b', xMm: 3000, yMm: 0 }],
    [{
      id: 'ab', startNodeId: 'a', endNodeId: 'b', mode: 'straight',
      lengthMm: 3200, angleDeg: 0, thicknessMm: 200,
      measurementStartInsetMm: 0, measurementStartExtensionMm: 200,
      measurementEndInsetMm: 0, inputSource: 'manual'
    }]
  );
  const extendedResult = surveyGraph.remeasureSelectedWall(extended, 2800, 'manual');
  const extendedFloor = surveyGraph.getActiveFloor(extendedResult);
  assert.equal(surveyGraph.distanceMm(extendedFloor.nodes[0], extendedFloor.nodes[1]), 2600);
  assert.equal(extendedFloor.walls[0].lengthMm, 2800);

  const diagonal = createRemeasureDraft(
    [{ id: 'a', xMm: 0, yMm: 0 }, { id: 'b', xMm: 1000, yMm: 1000 }],
    [{
      id: 'ab', startNodeId: 'a', endNodeId: 'b', mode: 'diagonal',
      lengthMm: 1414, angleDeg: 45, thicknessMm: 200, inputSource: 'manual'
    }]
  );
  const diagonalResult = surveyGraph.remeasureSelectedWall(diagonal, 8000, 'manual');
  const diagonalFloor = surveyGraph.getActiveFloor(diagonalResult);
  assert.deepEqual(diagonalFloor.nodes[1], { id: 'b', xMm: 5657, yMm: 5657 });
  assert.equal(diagonalFloor.walls[0].lengthMm, 8000);
});

test('closed orthogonal remeasurement balances the opposite axis wall without skewing neighbours', () => {
  const draft = createRemeasureDraft(
    [
      { id: 'a', xMm: 0, yMm: 0 },
      { id: 'b', xMm: 4000, yMm: 0 },
      { id: 'c', xMm: 4000, yMm: 3000 },
      { id: 'd', xMm: 0, yMm: 3000 }
    ],
    [
      { id: 'ab', startNodeId: 'a', endNodeId: 'b', mode: 'straight', lengthMm: 4000, angleDeg: 0, thicknessMm: 200, inputSource: 'manual' },
      { id: 'bc', startNodeId: 'b', endNodeId: 'c', mode: 'straight', lengthMm: 3000, angleDeg: 90, thicknessMm: 200, inputSource: 'manual' },
      { id: 'cd', startNodeId: 'c', endNodeId: 'd', mode: 'straight', lengthMm: 4000, angleDeg: 180, thicknessMm: 200, inputSource: 'manual' },
      { id: 'da', startNodeId: 'd', endNodeId: 'a', mode: 'straight', lengthMm: 3000, angleDeg: -90, thicknessMm: 200, inputSource: 'manual' }
    ],
    [{ id: 'room', name: '房间', wallIds: ['ab', 'bc', 'cd', 'da'], closed: true }]
  );
  const result = surveyGraph.remeasureSelectedWall(draft, 3500, 'manual');
  const floor = surveyGraph.getActiveFloor(result);

  assert.deepEqual(floor.nodes, [
    { id: 'a', xMm: 0, yMm: 0 },
    { id: 'b', xMm: 3500, yMm: 0 },
    { id: 'c', xMm: 3500, yMm: 3000 },
    { id: 'd', xMm: 0, yMm: 3000 }
  ]);
  assert.equal(surveyGraph.getWall(floor, 'bc').lengthMm, 3000);
  assert.equal(surveyGraph.getWall(floor, 'bc').angleDeg, 90);
  assert.equal(surveyGraph.getWall(floor, 'cd').lengthMm, 3500);
  assert.equal(surveyGraph.getWall(floor, 'cd').rawMeasuredLengthMm, 4000);
  assert.equal(surveyGraph.getWall(floor, 'cd').closureAdjustmentMm, -500);
  assert.equal(surveyGraph.validateSurveyDraft(result, { mode: 'full' }).valid, true);
});

test('closed remeasurement rejects an opening that would fall outside the balanced host wall atomically', () => {
  const draft = createRemeasureDraft(
    [
      { id: 'a', xMm: 0, yMm: 0 },
      { id: 'b', xMm: 4000, yMm: 0 },
      { id: 'c', xMm: 4000, yMm: 3000 },
      { id: 'd', xMm: 0, yMm: 3000 }
    ],
    [
      { id: 'ab', startNodeId: 'a', endNodeId: 'b', mode: 'straight', lengthMm: 4000, angleDeg: 0, thicknessMm: 200 },
      { id: 'bc', startNodeId: 'b', endNodeId: 'c', mode: 'straight', lengthMm: 3000, angleDeg: 90, thicknessMm: 200 },
      { id: 'cd', startNodeId: 'c', endNodeId: 'd', mode: 'straight', lengthMm: 4000, angleDeg: 180, thicknessMm: 200 },
      { id: 'da', startNodeId: 'd', endNodeId: 'a', mode: 'straight', lengthMm: 3000, angleDeg: -90, thicknessMm: 200 }
    ],
    [{ id: 'room', name: '房间', wallIds: ['ab', 'bc', 'cd', 'da'], closed: true }]
  );
  const floor = surveyGraph.getActiveFloor(draft);
  floor.openings.push({
    id: 'window-1',
    type: 'window',
    wallId: 'cd',
    widthMm: 800,
    centerOffsetMm: 3500,
    heightMm: 1500,
    sillHeightMm: 900
  });
  const before = JSON.stringify({ nodes: floor.nodes, walls: floor.walls, openings: floor.openings });

  assert.throws(
    () => surveyGraph.remeasureSelectedWall(draft, 1000, 'manual'),
    (error) => error && error.code === 'OPENING_REMEASURE_CONFLICT'
  );
  const afterFloor = surveyGraph.getActiveFloor(draft);
  assert.equal(JSON.stringify({ nodes: afterFloor.nodes, walls: afterFloor.walls, openings: afterFloor.openings }), before);
});

test('open-wall remeasurement rejects an opening that would be silently shifted', () => {
  const draft = createRemeasureDraft(
    [{ id: 'a', xMm: 0, yMm: 0 }, { id: 'b', xMm: 4000, yMm: 0 }],
    [{
      id: 'ab', startNodeId: 'a', endNodeId: 'b', mode: 'straight',
      lengthMm: 4000, angleDeg: 0, thicknessMm: 200, inputSource: 'manual'
    }]
  );
  const floor = surveyGraph.getActiveFloor(draft);
  floor.openings.push({
    id: 'window-1', type: 'window', wallId: 'ab', widthMm: 1000,
    centerOffsetMm: 3500, heightMm: 1500, sillHeightMm: 900
  });
  const before = JSON.stringify(draft);

  assert.throws(
    () => surveyGraph.remeasureSelectedWall(draft, 2000, 'manual'),
    (error) => error && error.code === 'OPENING_REMEASURE_CONFLICT'
  );
  assert.equal(JSON.stringify(draft), before);
});

test('consecutive closed-room remeasurements preserve the previously balanced axis', () => {
  let draft = createRemeasureDraft(
    [
      { id: 'a', xMm: 0, yMm: 0 },
      { id: 'b', xMm: 4000, yMm: 0 },
      { id: 'c', xMm: 4000, yMm: 3000 },
      { id: 'd', xMm: 0, yMm: 3000 }
    ],
    [
      { id: 'ab', startNodeId: 'a', endNodeId: 'b', mode: 'straight', lengthMm: 4000, angleDeg: 0, thicknessMm: 200 },
      { id: 'bc', startNodeId: 'b', endNodeId: 'c', mode: 'straight', lengthMm: 3000, angleDeg: 90, thicknessMm: 200 },
      { id: 'cd', startNodeId: 'c', endNodeId: 'd', mode: 'straight', lengthMm: 4000, angleDeg: 180, thicknessMm: 200 },
      { id: 'da', startNodeId: 'd', endNodeId: 'a', mode: 'straight', lengthMm: 3000, angleDeg: -90, thicknessMm: 200 }
    ],
    [{ id: 'room', name: '房间', wallIds: ['ab', 'bc', 'cd', 'da'], closed: true }]
  );
  draft = surveyGraph.remeasureSelectedWall(draft, 3500, 'manual');
  let floor = surveyGraph.getActiveFloor(draft);
  floor.session.state = 'remeasureAwaitingInput';
  floor.session.selectedWallId = 'bc';
  floor.session.fixedNodeId = 'b';
  draft = surveyGraph.remeasureSelectedWall(draft, 2500, 'manual');
  floor = surveyGraph.getActiveFloor(draft);

  assert.deepEqual(floor.nodes, [
    { id: 'a', xMm: 0, yMm: 0 },
    { id: 'b', xMm: 3500, yMm: 0 },
    { id: 'c', xMm: 3500, yMm: 2500 },
    { id: 'd', xMm: 0, yMm: 2500 }
  ]);
  assert.equal(surveyGraph.getWall(floor, 'cd').rawMeasuredLengthMm, 4000);
  assert.equal(surveyGraph.getWall(floor, 'cd').closureAdjustmentMm, -500);
  assert.equal(surveyGraph.getWall(floor, 'da').rawMeasuredLengthMm, 3000);
  assert.equal(surveyGraph.getWall(floor, 'da').closureAdjustmentMm, -500);
  assert.equal(surveyGraph.validateSurveyDraft(draft, { mode: 'full' }).valid, true);
});

test('full validation rejects stale metric fields, off-axis straight walls and fractional millimetres', () => {
  const cases = [
    {
      name: 'fractional coordinate',
      mutate(floor) { floor.nodes[0].xMm = 0.25; },
      code: 'NON_INTEGER_NODE_COORDINATE'
    },
    {
      name: 'stale measured length',
      mutate(floor) { floor.walls[0].lengthMm = 999999; },
      code: 'WALL_LENGTH_MISMATCH'
    },
    {
      name: 'stale angle',
      mutate(floor) { floor.walls[0].angleDeg = 37; },
      code: 'WALL_ANGLE_MISMATCH'
    },
    {
      name: 'off-axis straight wall',
      mutate(floor) { floor.nodes[1].yMm = 200; },
      code: 'STRAIGHT_WALL_OFF_AXIS'
    },
    {
      name: 'inconsistent closure adjustment',
      mutate(floor) {
        floor.walls[0].rawMeasuredLengthMm = 3990;
        floor.walls[0].closureAdjustmentMm = 5;
      },
      code: 'WALL_ADJUSTMENT_MISMATCH'
    },
    {
      name: 'missing stored length',
      mutate(floor) { delete floor.walls[0].lengthMm; },
      code: 'MISSING_WALL_LENGTH'
    },
    {
      name: 'missing stored angle',
      mutate(floor) { delete floor.walls[0].angleDeg; },
      code: 'MISSING_WALL_ANGLE'
    },
    {
      name: 'negative measurement inset',
      mutate(floor) { floor.walls[0].measurementStartInsetMm = -1; },
      code: 'INVALID_WALL_MEASUREMENT_ADJUSTMENT'
    },
    {
      name: 'measurement adjustments consume the wall',
      mutate(floor) {
        floor.walls[0].measurementStartInsetMm = 4000;
        floor.walls[0].lengthMm = 0;
      },
      code: 'INVALID_WALL_MEASUREMENT_ADJUSTMENT'
    }
  ];

  cases.forEach(({ name, mutate, code }) => {
    const draft = createRemeasureDraft(
      [{ id: 'a', xMm: 0, yMm: 0 }, { id: 'b', xMm: 4000, yMm: 0 }],
      [{
        id: 'ab', startNodeId: 'a', endNodeId: 'b', mode: 'straight',
        lengthMm: 4000, angleDeg: 0, thicknessMm: 200, inputSource: 'manual'
      }]
    );
    mutate(surveyGraph.getActiveFloor(draft));
    const validation = surveyGraph.validateSurveyDraft(draft, { mode: 'full' });
    assert.equal(validation.valid, false, name);
    assert.ok(validation.errors.some((error) => error.code === code), name);
  });
});
