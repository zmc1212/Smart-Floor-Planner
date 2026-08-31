const test = require('node:test');
const assert = require('node:assert/strict');
const surveyGraph = require('../packages/surveying/utils/surveyWallGraph.js');
const surveyCanvasRenderer = require('../packages/surveying/utils/surveyCanvasRenderer.js');
const surveyLayout = require('../utils/surveyLayout.js');

const RECT = { width: 520, height: 520 };
const ROTATIONS = [0, 1, 2, 3];
const MIRRORS = [false, true];
const THICKNESSES_MM = [100, 200, 400];
const MEASUREMENT_SIDES = ['left', 'right'];
const SNAP_FACES = ['inner', 'outer'];
const CLOSE_ACTIONS = ['direct', 'committed'];
const MATRIX_CASE_COUNTS = Object.freeze({
  closedOutline: 672,
  directReleaseTolerance: 96,
  sameWallAdjacentRoom: 192,
  fourRoomCross: 768,
  concavePartitionClamp: 576,
  unequalDividerThickness: 288,
  continuedDividerClamp: 768,
  openingRemap: 224,
  openingSplitConflict: 384,
  formalSaveRestore: 32,
  selfCrossingRejection: 96
});
const MATRIX_CASE_TOTAL = Object.values(MATRIX_CASE_COUNTS).reduce(
  (total, count) => total + count,
  0
);
assert.equal(MATRIX_CASE_TOTAL, 4096, 'formal closure catalog case-count drift');

const ORTHOGONAL_OUTLINES = {
  rectangle: [
    { xMm: 0, yMm: 0 },
    { xMm: 6000, yMm: 0 },
    { xMm: 6000, yMm: 4000 },
    { xMm: 0, yMm: 4000 }
  ],
  concaveL: [
    { xMm: 0, yMm: 0 },
    { xMm: 6000, yMm: 0 },
    { xMm: 6000, yMm: 2000 },
    { xMm: 3000, yMm: 2000 },
    { xMm: 3000, yMm: 5000 },
    { xMm: 0, yMm: 5000 }
  ],
  concaveU: [
    { xMm: 0, yMm: 0 },
    { xMm: 6000, yMm: 0 },
    { xMm: 6000, yMm: 6000 },
    { xMm: 4000, yMm: 6000 },
    { xMm: 4000, yMm: 2500 },
    { xMm: 2000, yMm: 2500 },
    { xMm: 2000, yMm: 6000 },
    { xMm: 0, yMm: 6000 }
  ],
  stepped: [
    { xMm: 0, yMm: 0 },
    { xMm: 6500, yMm: 0 },
    { xMm: 6500, yMm: 2200 },
    { xMm: 4700, yMm: 2200 },
    { xMm: 4700, yMm: 4200 },
    { xMm: 6500, yMm: 4200 },
    { xMm: 6500, yMm: 6500 },
    { xMm: 0, yMm: 6500 }
  ]
};

const DIAGONAL_OUTLINES = {
  triangle: [
    { xMm: 0, yMm: 0 },
    { xMm: 5000, yMm: 0 },
    { xMm: 2500, yMm: 3500 }
  ],
  trapezoid: [
    { xMm: 0, yMm: 0 },
    { xMm: 6000, yMm: 0 },
    { xMm: 5000, yMm: 4000 },
    { xMm: 1000, yMm: 4000 }
  ],
  skewQuadrilateral: [
    { xMm: 0, yMm: 0 },
    { xMm: 5000, yMm: 1200 },
    { xMm: 4200, yMm: 5200 },
    { xMm: -800, yMm: 3500 }
  ]
};

const CONCAVE_PARTITION_RAYS = [
  {
    name: 'L-deep-leg',
    points: ORTHOGONAL_OUTLINES.concaveL,
    start: { xMm: 1500, yMm: 0 },
    overdrag: { xMm: 1500, yMm: 8000 },
    expectedEnd: { xMm: 1500, yMm: 5000 }
  },
  {
    name: 'L-near-notch',
    points: ORTHOGONAL_OUTLINES.concaveL,
    start: { xMm: 4500, yMm: 0 },
    overdrag: { xMm: 4500, yMm: 8000 },
    expectedEnd: { xMm: 4500, yMm: 2000 }
  },
  {
    name: 'U-side-leg',
    points: ORTHOGONAL_OUTLINES.concaveU,
    start: { xMm: 1000, yMm: 0 },
    overdrag: { xMm: 1000, yMm: 8000 },
    expectedEnd: { xMm: 1000, yMm: 6000 }
  },
  {
    name: 'U-center-notch',
    points: ORTHOGONAL_OUTLINES.concaveU,
    start: { xMm: 3000, yMm: 0 },
    overdrag: { xMm: 3000, yMm: 8000 },
    expectedEnd: { xMm: 3000, yMm: 2500 }
  },
  {
    name: 'step-deep-side',
    points: ORTHOGONAL_OUTLINES.stepped,
    start: { xMm: 3000, yMm: 0 },
    overdrag: { xMm: 3000, yMm: 8000 },
    expectedEnd: { xMm: 3000, yMm: 6500 }
  },
  {
    name: 'step-near-recess',
    points: ORTHOGONAL_OUTLINES.stepped,
    start: { xMm: 5600, yMm: 0 },
    overdrag: { xMm: 5600, yMm: 8000 },
    expectedEnd: { xMm: 5600, yMm: 2200 }
  }
];

function transformPoint(point, rotation, mirrored) {
  let current = {
    xMm: mirrored ? -point.xMm : point.xMm,
    yMm: point.yMm
  };
  for (let index = 0; index < rotation; index += 1) {
    current = { xMm: -current.yMm, yMm: current.xMm };
  }
  return current;
}

function inverseTransformPoint(point, rotation, mirrored) {
  let current = { xMm: point.xMm, yMm: point.yMm };
  for (let index = 0; index < rotation; index += 1) {
    current = { xMm: current.yMm, yMm: -current.xMm };
  }
  if (mirrored) current.xMm = -current.xMm;
  return current;
}

function addPoints(first, second) {
  return { xMm: first.xMm + second.xMm, yMm: first.yMm + second.yMm };
}

function subtractPoints(first, second) {
  return { xMm: first.xMm - second.xMm, yMm: first.yMm - second.yMm };
}

function interpolatePoint(first, second, ratio) {
  return {
    xMm: Math.round(first.xMm + (second.xMm - first.xMm) * ratio),
    yMm: Math.round(first.yMm + (second.yMm - first.yMm) * ratio)
  };
}

function commitPreview(draft, point, inputSource, measuredLengthMm) {
  const preview = surveyGraph.startPreview(draft, point);
  const floor = surveyGraph.getActiveFloor(preview);
  assert.ok(
    floor.session.previewLengthMm >= surveyGraph.MIN_WALL_LENGTH_MM,
    `preview is too short: ${floor.session.previewLengthMm}`
  );
  return surveyGraph.commitPreviewLength(
    preview,
    Number.isFinite(measuredLengthMm) ? measuredLengthMm : floor.session.previewLengthMm,
    inputSource || 'closure-matrix'
  );
}

function finishPendingClosure(draft, closeAction) {
  let next = draft;
  let floor = surveyGraph.getActiveFloor(next);
  assert.ok(floor.session.closeCandidateType, 'closure candidate was not offered');
  if (closeAction === 'committed' && floor.session.state === 'wallPreview') {
    next = surveyGraph.commitPreviewLength(
      next,
      floor.session.previewLengthMm,
      'closure-matrix'
    );
    floor = surveyGraph.getActiveFloor(next);
    assert.ok(
      floor.session.state === 'closing' || floor.session.state === 'mergeClosing',
      `unexpected committed closure state: ${floor.session.state}`
    );
  }
  return surveyGraph.confirmClosure(next);
}

function createPolygonDraft(options) {
  const points = options.points.map((point) => transformPoint(
    point,
    options.rotation,
    options.mirrored
  ));
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.setThickness(draft, options.thicknessMm);
  if (options.mode === 'diagonal') draft = surveyGraph.setMode(draft, 'diagonal');
  draft = surveyGraph.placeCursor(draft, points[0]);
  draft = commitPreview(draft, points[1]);
  let floor = surveyGraph.getActiveFloor(draft);
  draft = surveyGraph.setMeasurementSide(draft, options.measurementSide, floor.walls[0].id);
  for (let index = 2; index < points.length; index += 1) {
    draft = commitPreview(draft, points[index]);
  }
  draft = surveyGraph.startPreview(draft, points[0]);
  floor = surveyGraph.getActiveFloor(draft);
  assert.ok(floor.session.closeCandidateType, 'return to the first point must offer closure');
  if (options.mode !== 'diagonal') {
    assert.equal(
      surveyGraph.isDirectClosureHit(floor, floor.session, points[0]),
      true,
      'an exact straight-wall return must be a direct closure hit'
    );
  }
  return finishPendingClosure(draft, options.closeAction || 'direct');
}

function createClosedRectangle(scenario) {
  return createPolygonDraft({
    points: ORTHOGONAL_OUTLINES.rectangle,
    mode: 'straight',
    rotation: scenario.rotation,
    mirrored: scenario.mirrored,
    thicknessMm: scenario.thicknessMm,
    measurementSide: scenario.measurementSide || 'left',
    closeAction: scenario.initialCloseAction || 'direct'
  });
}

function createThreeWallRectangle(scenario) {
  const points = ORTHOGONAL_OUTLINES.rectangle.map((point) => transformPoint(
    point,
    scenario.rotation,
    scenario.mirrored
  ));
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.setThickness(draft, scenario.thicknessMm);
  draft = surveyGraph.placeCursor(draft, points[0]);
  draft = commitPreview(draft, points[1]);
  let floor = surveyGraph.getActiveFloor(draft);
  draft = surveyGraph.setMeasurementSide(draft, scenario.measurementSide, floor.walls[0].id);
  draft = commitPreview(draft, points[2]);
  draft = commitPreview(draft, points[3]);
  return draft;
}

function createScene(draft) {
  const floor = surveyGraph.getActiveFloor(draft);
  return surveyCanvasRenderer.createSurveyRenderScene({
    floor,
    session: floor.session,
    viewport: floor.viewport,
    rect: RECT
  });
}

function wallUsageCounts(floor) {
  const counts = {};
  floor.spaces.filter((space) => space.closed).forEach((space) => {
    space.wallIds.forEach((wallId) => {
      counts[wallId] = (counts[wallId] || 0) + 1;
    });
  });
  return counts;
}

function renderedBodyNormalSide(floor, wall) {
  const geometry = surveyGraph.buildWallSnapGeometry(floor, wall);
  assert.ok(geometry, `wall ${wall.id} has no snap geometry`);
  const dx = geometry.end.xMm - geometry.start.xMm;
  const dy = geometry.end.yMm - geometry.start.yMm;
  const lengthMm = Math.hypot(dx, dy);
  assert.ok(lengthMm > 0, `wall ${wall.id} has no renderable direction`);
  const leftNormal = { x: dy / lengthMm, y: -dx / lengthMm };
  const outerOffset = {
    x: geometry.outerStart.xMm - geometry.start.xMm,
    y: geometry.outerStart.yMm - geometry.start.yMm
  };
  return outerOffset.x * leftNormal.x + outerOffset.y * leftNormal.y >= 0
    ? 'left'
    : 'right';
}

function assertClosedDraftContracts(draft, expectedSpaceCount) {
  const validation = surveyGraph.validateSurveyDraft(draft, { mode: 'full' });
  assert.equal(
    validation.valid,
    true,
    validation.errors.map((error) => `${error.code}@${error.path}`).join(', ')
  );
  const floor = surveyGraph.getActiveFloor(draft);
  const spaces = floor.spaces.filter((space) => space.closed);
  assert.equal(spaces.length, expectedSpaceCount);
  const usage = wallUsageCounts(floor);
  floor.walls.forEach((wall) => {
    assert.ok(usage[wall.id] === 1 || usage[wall.id] === 2, `wall ${wall.id} has use count ${usage[wall.id] || 0}`);
  });
  spaces.forEach((space) => {
    assert.ok(surveyGraph.buildSpaceBoundaryPoints(floor, space.wallIds).length >= 3);
    assert.ok(surveyGraph.buildSpaceRenderBoundaryPoints(floor, space).length >= 3);
    assert.ok(surveyGraph.calculateSpaceAreaMm2(draft, space.id) > 0);
    assert.ok(surveyGraph.buildSpaceDimensionPlan(floor, space).inner.areaMm2 > 0);
  });
  const scene = createScene(draft);
  assert.equal(scene.closedSpaceFills.length, expectedSpaceCount);
  assert.ok(scene.wallSolidPlan.rings.length > 0);
  return { floor, spaces, usage, scene };
}

function canonicalRing(points) {
  let ring = points.map((point) => ({
    xMm: Math.round(point.xMm),
    yMm: Math.round(point.yMm)
  }));
  let changed = true;
  while (changed && ring.length > 3) {
    changed = false;
    ring = ring.filter((point, index) => {
      const previous = ring[(index - 1 + ring.length) % ring.length];
      const next = ring[(index + 1) % ring.length];
      const cross = (point.xMm - previous.xMm) * (next.yMm - point.yMm) -
        (point.yMm - previous.yMm) * (next.xMm - point.xMm);
      if (cross === 0) {
        changed = true;
        return false;
      }
      return true;
    });
  }
  const variants = [];
  [ring, ring.slice().reverse()].forEach((direction) => {
    direction.forEach((unused, index) => {
      variants.push(direction.slice(index).concat(direction.slice(0, index)));
    });
  });
  return variants.sort((first, second) => (
    JSON.stringify(first).localeCompare(JSON.stringify(second))
  ))[0];
}

function edgeLengthSignature(points) {
  return points.map((point, index) => {
    const next = points[(index + 1) % points.length];
    return Math.round(Math.hypot(next.xMm - point.xMm, next.yMm - point.yMm));
  }).sort((first, second) => first - second);
}

function closedSpaceSignature(draft) {
  const floor = surveyGraph.getActiveFloor(draft);
  return floor.spaces.filter((space) => space.closed).map((space) => {
    const renderBoundary = surveyGraph.buildSpaceRenderBoundaryPoints(floor, space);
    return {
      areaMm2: surveyGraph.calculateSpaceAreaMm2(draft, space.id),
      clearAreaMm2: surveyGraph.buildSpaceDimensionPlan(floor, space).inner.areaMm2,
      edgeLengthsMm: edgeLengthSignature(renderBoundary)
    };
  }).sort((first, second) => (
    first.areaMm2 - second.areaMm2 ||
    first.clearAreaMm2 - second.clearAreaMm2 ||
    JSON.stringify(first.edgeLengthsMm).localeCompare(JSON.stringify(second.edgeLengthsMm))
  ));
}

function runMatrix(cases, label, expectedCount, execute) {
  assert.equal(cases.length, expectedCount, `${label} case-count drift`);
  const failures = [];
  cases.forEach((scenario) => {
    try {
      execute(scenario);
    } catch (error) {
      failures.push(`${scenario.label}: ${error.message}`);
    }
  });
  const preview = failures.slice(0, 12).join('\n');
  const remainder = Math.max(0, failures.length - 12);
  assert.equal(
    failures.length,
    0,
    `${failures.length}/${cases.length} ${label} failed${preview ? `:\n${preview}` : ''}${
      remainder ? `\n... and ${remainder} more` : ''
    }`
  );
}

function placementTargetForFace(floor, topologyPoint, snapFace) {
  const topologyTarget = surveyGraph.getCursorPlacementTarget(
    floor,
    topologyPoint,
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  if (snapFace !== 'outer' || topologyTarget.type !== 'wall') return topologyTarget;
  const wall = surveyGraph.getWall(floor, topologyTarget.wallId);
  const geometry = surveyGraph.buildWallRenderGeometry(floor, wall);
  const outerDx = geometry.outerEnd.xMm - geometry.outerStart.xMm;
  const outerDy = geometry.outerEnd.yMm - geometry.outerStart.yMm;
  const outerLengthSquared = outerDx ** 2 + outerDy ** 2;
  const ratio = outerLengthSquared > 0
    ? ((topologyPoint.xMm - geometry.outerStart.xMm) * outerDx +
      (topologyPoint.yMm - geometry.outerStart.yMm) * outerDy) / outerLengthSquared
    : 0;
  const outerPoint = interpolatePoint(geometry.outerStart, geometry.outerEnd, ratio);
  return surveyGraph.getCursorPlacementTarget(
    floor,
    outerPoint,
    surveyGraph.CLOSE_TOLERANCE_MM
  );
}

function partitionRoom(draft, startPoint, endPoint, snapFace, closeAction) {
  let floor = surveyGraph.getActiveFloor(draft);
  const target = placementTargetForFace(floor, startPoint, snapFace || 'inner');
  assert.ok(target.type === 'wall' || target.type === 'vertex');
  if (target.type === 'wall') assert.equal(target.snapLine, snapFace || 'inner');
  let next = surveyGraph.snapCursorToWall(
    surveyGraph.startWallSnap(draft),
    target.pointMm,
    target
  );
  next = surveyGraph.startPreview(next, endPoint);
  floor = surveyGraph.getActiveFloor(next);
  assert.equal(floor.session.closeCandidateType, 'partition');
  return finishPendingClosure(next, closeAction || 'committed');
}

function buildFourRoomGrid(scenario) {
  const point = (value) => transformPoint(value, scenario.rotation, scenario.mirrored);
  let draft = createClosedRectangle(scenario);
  draft = partitionRoom(
    draft,
    point({ xMm: 3000, yMm: scenario.dividerDirection === 'down' ? 0 : 4000 }),
    point({ xMm: 3000, yMm: scenario.dividerDirection === 'down' ? 4000 : 0 }),
    'inner',
    scenario.closeAction
  );
  let floor = surveyGraph.getActiveFloor(draft);
  const usage = wallUsageCounts(floor);
  const sharedWall = floor.walls.find((wall) => usage[wall.id] === 2);
  assert.ok(sharedWall, 'first divider was not shared by the two rooms');
  const sharedSourceWallId = sharedWall.id;
  const sharedBodyNormalSide = renderedBodyNormalSide(floor, sharedWall);
  const center = point({ xMm: 3000, yMm: 2000 });
  const firstEnd = point({
    xMm: scenario.branchOrder === 'left-first' ? 0 : 6000,
    yMm: 2000
  });
  draft = partitionRoom(
    draft,
    center,
    firstEnd,
    scenario.snapFace,
    scenario.closeAction
  );
  const secondEnd = point({
    xMm: scenario.branchOrder === 'left-first' ? 6000 : 0,
    yMm: 2000
  });
  draft = partitionRoom(draft, center, secondEnd, 'inner', scenario.closeAction);
  return { draft, sharedSourceWallId, sharedBodyNormalSide };
}

function openingWorldCenter(floor, opening) {
  const wall = surveyGraph.getWall(floor, opening.wallId);
  const start = surveyGraph.getNode(floor, wall.startNodeId);
  const end = surveyGraph.getNode(floor, wall.endNodeId);
  const coordinateLength = Math.hypot(end.xMm - start.xMm, end.yMm - start.yMm);
  const alongMm = (wall.measurementStartInsetMm || 0) -
    (wall.measurementStartExtensionMm || 0) +
    (opening.centerOffsetMm || 0);
  const ratio = coordinateLength > 0 ? alongMm / coordinateLength : 0;
  return interpolatePoint(start, end, ratio);
}

function pointAlongWallMm(floor, wall, point) {
  const start = surveyGraph.getNode(floor, wall.startNodeId);
  const end = surveyGraph.getNode(floor, wall.endNodeId);
  const dx = end.xMm - start.xMm;
  const dy = end.yMm - start.yMm;
  const lengthSquared = dx ** 2 + dy ** 2;
  if (!lengthSquared) return 0;
  const ratio = ((point.xMm - start.xMm) * dx + (point.yMm - start.yMm) * dy) /
    lengthSquared;
  return Math.round(Math.max(0, Math.min(1, ratio)) * Math.sqrt(lengthSquared));
}

test('orthogonal and diagonal outlines close across winding, wall thickness, side and close action', () => {
  const outlines = [
    ...Object.entries(ORTHOGONAL_OUTLINES).map(([name, points]) => ({ name, points, mode: 'straight' })),
    ...Object.entries(DIAGONAL_OUTLINES).map(([name, points]) => ({ name, points, mode: 'diagonal' }))
  ];
  const cases = [];
  outlines.forEach((outline) => {
    ROTATIONS.forEach((rotation) => {
      MIRRORS.forEach((mirrored) => {
        THICKNESSES_MM.forEach((thicknessMm) => {
          MEASUREMENT_SIDES.forEach((measurementSide) => {
            CLOSE_ACTIONS.forEach((closeAction) => {
              cases.push({
                ...outline,
                rotation,
                mirrored,
                thicknessMm,
                measurementSide,
                closeAction,
                label: `${outline.name}, rotation=${rotation * 90}, mirror=${mirrored}, thickness=${thicknessMm}, side=${measurementSide}, close=${closeAction}`
              });
            });
          });
        });
      });
    });
  });
  const baselines = new Map();
  runMatrix(cases, 'closed-outline scenarios', MATRIX_CASE_COUNTS.closedOutline, (scenario) => {
    const draft = createPolygonDraft(scenario);
    const { floor } = assertClosedDraftContracts(draft, 1);
    assert.equal(floor.walls.length, scenario.points.length);
    const signature = closedSpaceSignature(draft);
    const key = `${scenario.name}:${scenario.thicknessMm}`;
    if (!baselines.has(key)) baselines.set(key, signature);
    assert.deepEqual(signature, baselines.get(key));
  });
});

test('direct release closes only inside the effective radial closure tolerance', () => {
  const cases = [];
  ROTATIONS.forEach((rotation) => {
    MIRRORS.forEach((mirrored) => {
      THICKNESSES_MM.forEach((thicknessMm) => {
        MEASUREMENT_SIDES.forEach((measurementSide) => {
          ['inside', 'outside'].forEach((distanceCase) => {
            cases.push({
              rotation,
              mirrored,
              thicknessMm,
              measurementSide,
              distanceCase,
              label: `rotation=${rotation * 90}, mirror=${mirrored}, thickness=${thicknessMm}, side=${measurementSide}, distance=${distanceCase}`
            });
          });
        });
      });
    });
  });
  runMatrix(cases, 'direct-release tolerance scenarios', MATRIX_CASE_COUNTS.directReleaseTolerance, (scenario) => {
    let draft = createThreeWallRectangle(scenario);
    const effectiveToleranceMm = Math.max(
      surveyGraph.CLOSE_TOLERANCE_MM,
      scenario.thicknessMm * 1.5
    );
    const radialDistanceMm = scenario.distanceCase === 'inside'
      ? effectiveToleranceMm - 2
      : effectiveToleranceMm + 2;
    const offset = Math.round(radialDistanceMm / Math.sqrt(2));
    const rawPoint = transformPoint(
      { xMm: offset, yMm: offset },
      scenario.rotation,
      scenario.mirrored
    );
    draft = surveyGraph.startPreview(draft, rawPoint);
    const floor = surveyGraph.getActiveFloor(draft);
    const direct = surveyGraph.isDirectClosureHit(floor, floor.session, rawPoint);
    assert.equal(direct, scenario.distanceCase === 'inside');
    if (scenario.distanceCase === 'inside') {
      assert.ok(
        floor.session.closeCandidateType === 'start' ||
        floor.session.closeCandidateType === 'merge'
      );
      assertClosedDraftContracts(surveyGraph.confirmClosure(draft), 1);
    } else {
      assert.equal(floor.spaces.filter((space) => space.closed).length, 0);
      assert.notDeepEqual(floor.session.previewPoint, transformPoint(
        { xMm: 0, yMm: 0 },
        scenario.rotation,
        scenario.mirrored
      ));
    }
  });
});

test('an adjacent room returning to two points on one wall preserves the original room', () => {
  const cases = [];
  ROTATIONS.forEach((rotation) => {
    MIRRORS.forEach((mirrored) => {
      THICKNESSES_MM.forEach((thicknessMm) => {
        MEASUREMENT_SIDES.forEach((measurementSide) => {
          SNAP_FACES.forEach((snapFace) => {
            CLOSE_ACTIONS.forEach((closeAction) => {
              cases.push({
                rotation,
                mirrored,
                thicknessMm,
                measurementSide,
                snapFace,
                closeAction,
                label: `rotation=${rotation * 90}, mirror=${mirrored}, thickness=${thicknessMm}, side=${measurementSide}, snap=${snapFace}, close=${closeAction}`
              });
            });
          });
        });
      });
    });
  });
  runMatrix(cases, 'same-wall adjacent-room scenarios', MATRIX_CASE_COUNTS.sameWallAdjacentRoom, (scenario) => {
    let draft = createClosedRectangle(scenario);
    let floor = surveyGraph.getActiveFloor(draft);
    const sourceWall = floor.walls[0];
    const sourceWallId = sourceWall.id;
    const originalSpace = floor.spaces.find((space) => space.closed);
    const originalSnapshot = {
      id: originalSpace.id,
      name: originalSpace.name,
      areaMm2: surveyGraph.calculateSpaceAreaMm2(draft, originalSpace.id),
      dimensions: surveyGraph.buildSpaceDimensionPlan(floor, originalSpace).inner,
      renderBoundary: canonicalRing(surveyGraph.buildSpaceRenderBoundaryPoints(floor, originalSpace))
    };
    const geometry = surveyGraph.buildWallRenderGeometry(floor, sourceWall);
    const faceStart = scenario.snapFace === 'outer' ? geometry.outerStart : geometry.start;
    const faceEnd = scenario.snapFace === 'outer' ? geometry.outerEnd : geometry.end;
    const firstFacePoint = interpolatePoint(faceStart, faceEnd, 1 / 3);
    const secondFacePoint = interpolatePoint(faceStart, faceEnd, 2 / 3);
    const canonicalFirst = transformPoint(
      { xMm: 2000, yMm: 0 },
      scenario.rotation,
      scenario.mirrored
    );
    const faceOffset = subtractPoints(firstFacePoint, canonicalFirst);
    const firstOutside = addPoints(transformPoint(
      { xMm: 2000, yMm: -3000 },
      scenario.rotation,
      scenario.mirrored
    ), faceOffset);
    const secondOutside = addPoints(transformPoint(
      { xMm: 4000, yMm: -3000 },
      scenario.rotation,
      scenario.mirrored
    ), faceOffset);
    const target = surveyGraph.getCursorPlacementTarget(
      floor,
      firstFacePoint,
      surveyGraph.CLOSE_TOLERANCE_MM
    );
    assert.equal(target.type, 'wall');
    assert.equal(target.snapLine, scenario.snapFace);
    draft = surveyGraph.snapCursorToWall(
      surveyGraph.startWallSnap(draft),
      target.pointMm,
      target
    );
    draft = commitPreview(draft, firstOutside);
    draft = commitPreview(draft, secondOutside);
    draft = surveyGraph.startPreview(draft, secondFacePoint);
    floor = surveyGraph.getActiveFloor(draft);
    assert.ok(floor.session.closeCandidateType === 'shared-wall' || floor.session.closeCandidateType === 'merge');
    assert.equal(
      surveyGraph.isDirectClosureHit(floor, floor.session, secondFacePoint),
      true
    );
    draft = finishPendingClosure(draft, scenario.closeAction);
    const result = assertClosedDraftContracts(draft, 2);
    floor = result.floor;
    const preserved = floor.spaces.find((space) => space.id === originalSnapshot.id);
    assert.ok(preserved, 'original room ID was not preserved');
    assert.equal(preserved.name, originalSnapshot.name);
    assert.equal(surveyGraph.calculateSpaceAreaMm2(draft, preserved.id), originalSnapshot.areaMm2);
    assert.deepEqual(surveyGraph.buildSpaceDimensionPlan(floor, preserved).inner, originalSnapshot.dimensions);
    assert.deepEqual(
      canonicalRing(surveyGraph.buildSpaceRenderBoundaryPoints(floor, preserved)),
      originalSnapshot.renderBoundary
    );
    const sourceSegments = floor.walls.filter((wall) => (
      wall.id === sourceWallId || wall.topologySourceWallId === sourceWallId
    ));
    assert.equal(sourceSegments.length, 3);
    assert.equal(sourceSegments.filter((wall) => result.usage[wall.id] === 2).length, 1);
  });
});

test('sequential dividers form a valid four-room cross from every direction and face', () => {
  const cases = [];
  ROTATIONS.forEach((rotation) => {
    MIRRORS.forEach((mirrored) => {
      THICKNESSES_MM.forEach((thicknessMm) => {
        MEASUREMENT_SIDES.forEach((measurementSide) => {
          ['down', 'up'].forEach((dividerDirection) => {
            ['left-first', 'right-first'].forEach((branchOrder) => {
              SNAP_FACES.forEach((snapFace) => {
                CLOSE_ACTIONS.forEach((closeAction) => {
                  cases.push({
                    rotation,
                    mirrored,
                    thicknessMm,
                    measurementSide,
                    dividerDirection,
                    branchOrder,
                    snapFace,
                    closeAction,
                    label: `rotation=${rotation * 90}, mirror=${mirrored}, thickness=${thicknessMm}, side=${measurementSide}, divider=${dividerDirection}, order=${branchOrder}, snap=${snapFace}, close=${closeAction}`
                  });
                });
              });
            });
          });
        });
      });
    });
  });
  const totalAreaBaselines = new Map();
  runMatrix(cases, 'four-room cross scenarios', MATRIX_CASE_COUNTS.fourRoomCross, (scenario) => {
    const built = buildFourRoomGrid(scenario);
    const result = assertClosedDraftContracts(built.draft, 4);
    assert.equal(result.floor.nodes.length, 9);
    assert.equal(result.floor.walls.length, 12);
    assert.deepEqual(
      Object.values(result.usage).sort((first, second) => first - second),
      [1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2]
    );
    const sharedSourceSegments = result.floor.walls.filter((wall) => (
      wall.id === built.sharedSourceWallId || wall.topologySourceWallId === built.sharedSourceWallId
    ));
    assert.equal(sharedSourceSegments.length, 2);
    assert.equal(new Set(sharedSourceSegments.map((wall) => wall.bodyNormalSide)).size, 1);
    sharedSourceSegments.forEach((wall) => {
      assert.equal(
        wall.bodyNormalSide,
        built.sharedBodyNormalSide,
        'splitting the shared divider flipped its pre-split physical body side'
      );
    });
    const totalArea = result.spaces.reduce((sum, space) => (
      sum + surveyGraph.calculateSpaceAreaMm2(built.draft, space.id)
    ), 0);
    const baselineKey = String(scenario.thicknessMm);
    if (!totalAreaBaselines.has(baselineKey)) totalAreaBaselines.set(baselineKey, totalArea);
    assert.equal(totalArea, totalAreaBaselines.get(baselineKey));
  });
});

test('concave rooms clamp a divider at the nearest boundary instead of crossing a recess', () => {
  const cases = [];
  CONCAVE_PARTITION_RAYS.forEach((partitionRay) => {
    ROTATIONS.forEach((rotation) => {
      MIRRORS.forEach((mirrored) => {
        THICKNESSES_MM.forEach((thicknessMm) => {
          MEASUREMENT_SIDES.forEach((measurementSide) => {
            SNAP_FACES.forEach((snapFace) => {
              cases.push({
                ...partitionRay,
                rotation,
                mirrored,
                thicknessMm,
                measurementSide,
                snapFace,
                label: `${partitionRay.name}, rotation=${rotation * 90}, mirror=${mirrored}, thickness=${thicknessMm}, side=${measurementSide}, snap=${snapFace}`
              });
            });
          });
        });
      });
    });
  });
  runMatrix(cases, 'concave partition clamp scenarios', MATRIX_CASE_COUNTS.concavePartitionClamp, (scenario) => {
    let draft = createPolygonDraft({
      points: scenario.points,
      mode: 'straight',
      rotation: scenario.rotation,
      mirrored: scenario.mirrored,
      thicknessMm: scenario.thicknessMm,
      measurementSide: scenario.measurementSide,
      closeAction: 'direct'
    });
    let floor = surveyGraph.getActiveFloor(draft);
    const start = transformPoint(scenario.start, scenario.rotation, scenario.mirrored);
    const target = placementTargetForFace(floor, start, scenario.snapFace);
    assert.equal(target.type, 'wall');
    assert.equal(target.snapLine, scenario.snapFace);
    draft = surveyGraph.snapCursorToWall(
      surveyGraph.startWallSnap(draft),
      target.pointMm,
      target
    );
    draft = surveyGraph.startPreview(
      draft,
      transformPoint(scenario.overdrag, scenario.rotation, scenario.mirrored)
    );
    floor = surveyGraph.getActiveFloor(draft);
    assert.equal(floor.session.closeCandidateType, 'partition');
    draft = surveyGraph.commitPreviewLength(
      draft,
      floor.session.previewLengthMm,
      'closure-matrix'
    );
    draft = surveyGraph.confirmClosure(draft);
    const result = assertClosedDraftContracts(draft, 2);
    assert.equal(result.floor.nodes.some((node) => {
      const canonical = inverseTransformPoint(node, scenario.rotation, scenario.mirrored);
      return canonical.xMm === scenario.expectedEnd.xMm &&
        canonical.yMm === scenario.expectedEnd.yMm;
    }), true, 'partition endpoint did not stop on the nearest concave boundary');
  });
});

test('divider closure supports every source and divider wall-thickness pair', () => {
  const cases = [];
  ROTATIONS.forEach((rotation) => {
    MIRRORS.forEach((mirrored) => {
      THICKNESSES_MM.forEach((sourceThicknessMm) => {
        THICKNESSES_MM.forEach((dividerThicknessMm) => {
          ['top', 'bottom'].forEach((entrySide) => {
            SNAP_FACES.forEach((snapFace) => {
              cases.push({
                rotation,
                mirrored,
                sourceThicknessMm,
                dividerThicknessMm,
                entrySide,
                snapFace,
                thicknessMm: sourceThicknessMm,
                measurementSide: 'left',
                label: `rotation=${rotation * 90}, mirror=${mirrored}, source=${sourceThicknessMm}, divider=${dividerThicknessMm}, entry=${entrySide}, snap=${snapFace}`
              });
            });
          });
        });
      });
    });
  });
  const areaBaselines = new Map();
  runMatrix(cases, 'unequal divider-thickness closure scenarios', MATRIX_CASE_COUNTS.unequalDividerThickness, (scenario) => {
    const point = (value) => transformPoint(value, scenario.rotation, scenario.mirrored);
    let draft = createClosedRectangle(scenario);
    draft = surveyGraph.setThickness(draft, scenario.dividerThicknessMm);
    const startY = scenario.entrySide === 'top' ? 0 : 4000;
    const direction = scenario.entrySide === 'top' ? 1 : -1;
    draft = partitionRoom(
      draft,
      point({ xMm: 3000, yMm: startY }),
      point({ xMm: 3000, yMm: startY + direction * 8000 }),
      scenario.snapFace,
      'committed'
    );
    const result = assertClosedDraftContracts(draft, 2);
    const sharedWalls = result.floor.walls.filter((wall) => result.usage[wall.id] === 2);
    assert.equal(sharedWalls.length, 1);
    assert.equal(sharedWalls[0].thicknessMm, scenario.dividerThicknessMm);
    result.floor.walls.filter((wall) => result.usage[wall.id] === 1).forEach((wall) => {
      assert.equal(wall.thicknessMm, scenario.sourceThicknessMm);
    });
    result.floor.nodes.forEach((node) => {
      const canonical = inverseTransformPoint(node, scenario.rotation, scenario.mirrored);
      assert.ok(canonical.xMm >= 0 && canonical.xMm <= 6000);
      assert.ok(canonical.yMm >= 0 && canonical.yMm <= 4000);
    });
    const clearAreaTotal = result.spaces.reduce((sum, space) => (
      sum + surveyGraph.buildSpaceDimensionPlan(result.floor, space).inner.areaMm2
    ), 0);
    const baselineKey = `${scenario.sourceThicknessMm}:${scenario.dividerThicknessMm}`;
    if (!areaBaselines.has(baselineKey)) areaBaselines.set(baselineKey, clearAreaTotal);
    assert.equal(clearAreaTotal, areaBaselines.get(baselineKey));
  });
});

test('a short measured divider continuation clamps at the first opposite boundary', () => {
  const cases = [];
  ROTATIONS.forEach((rotation) => {
    MIRRORS.forEach((mirrored) => {
      THICKNESSES_MM.forEach((thicknessMm) => {
        MEASUREMENT_SIDES.forEach((measurementSide) => {
          SNAP_FACES.forEach((snapFace) => {
            ['top', 'bottom'].forEach((entrySide) => {
              [600, 1200].forEach((shortLengthMm) => {
                ['manual', 'ble'].forEach((inputSource) => {
                  cases.push({
                    rotation,
                    mirrored,
                    thicknessMm,
                    measurementSide,
                    snapFace,
                    entrySide,
                    shortLengthMm,
                    inputSource,
                    label: `rotation=${rotation * 90}, mirror=${mirrored}, thickness=${thicknessMm}, side=${measurementSide}, snap=${snapFace}, entry=${entrySide}, short=${shortLengthMm}, source=${inputSource}`
                  });
                });
              });
            });
          });
        });
      });
    });
  });
  runMatrix(cases, 'continued-divider clamp scenarios', MATRIX_CASE_COUNTS.continuedDividerClamp, (scenario) => {
    const point = (value) => transformPoint(value, scenario.rotation, scenario.mirrored);
    let draft = createClosedRectangle(scenario);
    let floor = surveyGraph.getActiveFloor(draft);
    const startY = scenario.entrySide === 'top' ? 0 : 4000;
    const direction = scenario.entrySide === 'top' ? 1 : -1;
    const startPoint = point({ xMm: 3000, yMm: startY });
    const target = placementTargetForFace(floor, startPoint, scenario.snapFace);
    assert.equal(target.type, 'wall');
    assert.equal(target.snapLine, scenario.snapFace);
    draft = surveyGraph.snapCursorToWall(
      surveyGraph.startWallSnap(draft),
      target.pointMm,
      target
    );
    const shortEnd = point({
      xMm: 3000,
      yMm: startY + direction * scenario.shortLengthMm
    });
    draft = commitPreview(
      draft,
      shortEnd,
      scenario.inputSource,
      scenario.shortLengthMm
    );
    floor = surveyGraph.getActiveFloor(draft);
    assert.equal(floor.session.state, 'wallCommitted');
    assert.equal(floor.walls.at(-1).inputSource, scenario.inputSource);
    draft = surveyGraph.startPreview(draft, point({
      xMm: 3000,
      yMm: startY + direction * 8000
    }));
    floor = surveyGraph.getActiveFloor(draft);
    assert.ok(
      floor.session.closeCandidateType === 'shared-wall' ||
      floor.session.closeCandidateType === 'partition'
    );
    draft = surveyGraph.commitPreviewLength(
      draft,
      floor.session.previewLengthMm,
      scenario.inputSource
    );
    draft = surveyGraph.confirmClosure(draft);
    const result = assertClosedDraftContracts(draft, 2);
    result.floor.nodes.forEach((node) => {
      const canonical = inverseTransformPoint(node, scenario.rotation, scenario.mirrored);
      assert.ok(canonical.xMm >= 0 && canonical.xMm <= 6000, `node x escaped room: ${canonical.xMm}`);
      assert.ok(canonical.yMm >= 0 && canonical.yMm <= 4000, `node y escaped room: ${canonical.yMm}`);
    });
  });
});

test('safe door and window positions survive a two-cut adjacent-room closure', () => {
  const cases = [];
  ['door', 'window'].forEach((openingType) => {
    [
      'first-segment-center',
      'before-first-cut',
      'after-first-cut',
      'middle-segment-center',
      'before-second-cut',
      'after-second-cut',
      'last-segment-center'
    ].forEach((openingPlacement) => {
      ROTATIONS.forEach((rotation) => {
        MIRRORS.forEach((mirrored) => {
          SNAP_FACES.forEach((snapFace) => {
            cases.push({
              openingType,
              openingPlacement,
              rotation,
              mirrored,
              snapFace,
              thicknessMm: 200,
              sourceStartExtensionMm: openingType === 'window' ? 150 : 0,
              measurementSide: 'left',
              label: `${openingType}, placement=${openingPlacement}, rotation=${rotation * 90}, mirror=${mirrored}, snap=${snapFace}, extension=${openingType === 'window' ? 150 : 0}`
            });
          });
        });
      });
    });
  });
  runMatrix(cases, 'opening remap through adjacent closure scenarios', MATRIX_CASE_COUNTS.openingRemap, (scenario) => {
    let draft = createClosedRectangle(scenario);
    let floor = surveyGraph.getActiveFloor(draft);
    const sourceWall = floor.walls[0];
    if (scenario.sourceStartExtensionMm) {
      sourceWall.measurementStartExtensionMm = scenario.sourceStartExtensionMm;
      sourceWall.lengthMm += scenario.sourceStartExtensionMm;
    }
    const sourceStartNode = surveyGraph.getNode(floor, sourceWall.startNodeId);
    const sourceEndNode = surveyGraph.getNode(floor, sourceWall.endNodeId);
    const sourceCoordinateLengthMm = Math.round(Math.hypot(
      sourceEndNode.xMm - sourceStartNode.xMm,
      sourceEndNode.yMm - sourceStartNode.yMm
    ));
    const geometry = surveyGraph.buildWallRenderGeometry(floor, sourceWall);
    const faceStart = scenario.snapFace === 'outer' ? geometry.outerStart : geometry.start;
    const faceEnd = scenario.snapFace === 'outer' ? geometry.outerEnd : geometry.end;
    const firstFacePoint = interpolatePoint(faceStart, faceEnd, 1 / 3);
    const secondFacePoint = interpolatePoint(faceStart, faceEnd, 2 / 3);
    const firstTarget = surveyGraph.getCursorPlacementTarget(
      floor,
      firstFacePoint,
      surveyGraph.CLOSE_TOLERANCE_MM
    );
    const secondTarget = surveyGraph.getCursorPlacementTarget(
      floor,
      secondFacePoint,
      surveyGraph.CLOSE_TOLERANCE_MM
    );
    assert.equal(firstTarget.type, 'wall');
    assert.equal(secondTarget.type, 'wall');
    assert.equal(firstTarget.snapLine, scenario.snapFace);
    assert.equal(secondTarget.snapLine, scenario.snapFace);
    const canonicalFirst = transformPoint(
      { xMm: 2000, yMm: 0 },
      scenario.rotation,
      scenario.mirrored
    );
    const offset = subtractPoints(firstFacePoint, canonicalFirst);
    const closeAdjacentRoom = (inputDraft) => {
      let closed = surveyGraph.snapCursorToWall(
        surveyGraph.startWallSnap(inputDraft),
        firstTarget.pointMm,
        firstTarget
      );
      closed = commitPreview(closed, addPoints(transformPoint(
        { xMm: 2000, yMm: -3000 },
        scenario.rotation,
        scenario.mirrored
      ), offset));
      closed = commitPreview(closed, addPoints(transformPoint(
        { xMm: 4000, yMm: -3000 },
        scenario.rotation,
        scenario.mirrored
      ), offset));
      closed = surveyGraph.startPreview(closed, secondFacePoint);
      return surveyGraph.confirmClosure(closed);
    };
    const closureProbe = closeAdjacentRoom(draft);
    const closureProbeFloor = surveyGraph.getActiveFloor(closureProbe);
    const sourceSegments = closureProbeFloor.walls.filter((wall) => (
      wall.id === sourceWall.id || wall.topologySourceWallId === sourceWall.id
    ));
    assert.equal(sourceSegments.length, 3);
    const cutPointsAlongMm = Array.from(new Set(sourceSegments.flatMap((wall) => (
      [wall.startNodeId, wall.endNodeId].map((nodeId) => pointAlongWallMm(
        closureProbeFloor,
        sourceWall,
        surveyGraph.getNode(closureProbeFloor, nodeId)
      ))
    )))).filter((alongMm) => alongMm > 1 && alongMm < sourceCoordinateLengthMm - 1)
      .sort((first, second) => first - second);
    assert.equal(cutPointsAlongMm.length, 2, 'adjacent closure did not create two source-wall cuts');
    const sourceStartInsetMm = sourceWall.measurementStartInsetMm || 0;
    const sourceStartAlongMm = sourceStartInsetMm -
      (sourceWall.measurementStartExtensionMm || 0);
    const sourceEndInsetMm = sourceWall.measurementEndInsetMm || 0;
    draft = surveyGraph.addOpeningToWall(draft, sourceWall.id, scenario.openingType);
    floor = surveyGraph.getActiveFloor(draft);
    const openingId = floor.openings.at(-1).id;
    const openingWidthMm = floor.openings.at(-1).widthMm;
    const halfOpeningWidthMm = openingWidthMm / 2;
    const splitMarginMm = 25;
    const splitClearanceMm = scenario.thicknessMm + halfOpeningWidthMm + splitMarginMm;
    const safeCentersAlongMm = {
      'first-segment-center': (
        sourceStartAlongMm + cutPointsAlongMm[0] - scenario.thicknessMm
      ) / 2,
      'before-first-cut': cutPointsAlongMm[0] - splitClearanceMm,
      'after-first-cut': cutPointsAlongMm[0] + splitClearanceMm,
      'middle-segment-center': (cutPointsAlongMm[0] + cutPointsAlongMm[1]) / 2,
      'before-second-cut': cutPointsAlongMm[1] - splitClearanceMm,
      'after-second-cut': cutPointsAlongMm[1] + splitClearanceMm,
      'last-segment-center': (
        cutPointsAlongMm[1] + scenario.thicknessMm +
        sourceCoordinateLengthMm - sourceEndInsetMm
      ) / 2
    };
    const openingCenterAlongMm = Math.round(safeCentersAlongMm[scenario.openingPlacement]);
    draft = surveyGraph.updateOpening(draft, openingId, {
      centerOffsetMm: openingCenterAlongMm - sourceStartAlongMm
    });
    floor = surveyGraph.getActiveFloor(draft);
    const openingBefore = floor.openings.find((opening) => opening.id === openingId);
    const centerBefore = openingWorldCenter(floor, openingBefore);
    draft = closeAdjacentRoom(draft);
    const result = assertClosedDraftContracts(draft, 2);
    const openingAfter = result.floor.openings.find((opening) => opening.id === openingId);
    assert.ok(openingAfter);
    assert.equal(openingAfter.type, openingBefore.type);
    assert.equal(openingAfter.widthMm, openingBefore.widthMm);
    const openingHostAfter = surveyGraph.getWall(result.floor, openingAfter.wallId);
    assert.deepEqual(
      openingWorldCenter(result.floor, openingAfter),
      centerBefore,
      JSON.stringify({
        cutPointsAlongMm,
        openingCenterAlongMm,
        sourceStartInsetMm,
        sourceEndInsetMm,
        openingAfter: {
          wallId: openingAfter.wallId,
          centerOffsetMm: openingAfter.centerOffsetMm,
          widthMm: openingAfter.widthMm
        },
        hostAfter: openingHostAfter && {
          startNodeId: openingHostAfter.startNodeId,
          endNodeId: openingHostAfter.endNodeId,
          lengthMm: openingHostAfter.lengthMm,
          measurementStartInsetMm: openingHostAfter.measurementStartInsetMm,
          measurementEndInsetMm: openingHostAfter.measurementEndInsetMm
        }
      })
    );
    assert.equal(result.scene.openings.length, 1);
  });
});

test('door and window spans block both adjacent-room split cuts atomically', () => {
  const cases = [];
  ['door', 'window'].forEach((openingType) => {
    ['first', 'second'].forEach((conflictCut) => {
      ['center', 'before-clearance-edge', 'after-clearance-edge'].forEach((openingPlacement) => {
        ROTATIONS.forEach((rotation) => {
          MIRRORS.forEach((mirrored) => {
            SNAP_FACES.forEach((snapFace) => {
              ['preview-direct', 'measured-commit'].forEach((pathMode) => {
                const dividerThicknessMm = THICKNESSES_MM[
                  (rotation + Number(mirrored) + Number(snapFace === 'outer') +
                    Number(pathMode === 'measured-commit')) % THICKNESSES_MM.length
                ];
                cases.push({
                  openingType,
                  conflictCut,
                  openingPlacement,
                  rotation,
                  mirrored,
                  snapFace,
                  pathMode,
                  thicknessMm: 200,
                  dividerThicknessMm,
                  sourceStartExtensionMm: pathMode === 'measured-commit' ? 150 : 0,
                  measurementSide: 'left',
                  label: `${openingType}, cut=${conflictCut}, placement=${openingPlacement}, rotation=${rotation * 90}, mirror=${mirrored}, snap=${snapFace}, path=${pathMode}, divider=${dividerThicknessMm}, extension=${pathMode === 'measured-commit' ? 150 : 0}`
                });
              });
            });
          });
        });
      });
    });
  });
  runMatrix(
    cases,
    'opening split-conflict rejection scenarios',
    MATRIX_CASE_COUNTS.openingSplitConflict,
    (scenario) => {
      let draft = createPolygonDraft({
        points: [
          { xMm: 0, yMm: 0 },
          { xMm: 8000, yMm: 0 },
          { xMm: 8000, yMm: 4000 },
          { xMm: 0, yMm: 4000 }
        ],
        mode: 'straight',
        rotation: scenario.rotation,
        mirrored: scenario.mirrored,
        thicknessMm: scenario.thicknessMm,
        measurementSide: scenario.measurementSide,
        closeAction: 'direct'
      });
      if (scenario.sourceStartExtensionMm) {
        const extendedFloor = surveyGraph.getActiveFloor(draft);
        const extendedSourceWall = extendedFloor.walls[0];
        extendedSourceWall.measurementStartExtensionMm = scenario.sourceStartExtensionMm;
        extendedSourceWall.lengthMm += scenario.sourceStartExtensionMm;
      }
      draft = surveyGraph.setThickness(draft, scenario.dividerThicknessMm);
      let floor = surveyGraph.getActiveFloor(draft);
      const sourceWall = floor.walls[0];
      const sourceStartInsetMm = sourceWall.measurementStartInsetMm || 0;
      const sourceStartAlongMm = sourceStartInsetMm -
        (sourceWall.measurementStartExtensionMm || 0);
      const sourceStartNode = surveyGraph.getNode(floor, sourceWall.startNodeId);
      const sourceEndNode = surveyGraph.getNode(floor, sourceWall.endNodeId);
      const sourceCoordinateLengthMm = Math.round(Math.hypot(
        sourceEndNode.xMm - sourceStartNode.xMm,
        sourceEndNode.yMm - sourceStartNode.yMm
      ));
      const geometry = surveyGraph.buildWallRenderGeometry(floor, sourceWall);
      const faceStart = scenario.snapFace === 'outer' ? geometry.outerStart : geometry.start;
      const faceEnd = scenario.snapFace === 'outer' ? geometry.outerEnd : geometry.end;
      const firstFacePoint = interpolatePoint(faceStart, faceEnd, 3 / 10);
      const secondFacePoint = interpolatePoint(faceStart, faceEnd, 7 / 10);
      const firstTarget = surveyGraph.getCursorPlacementTarget(
        floor,
        firstFacePoint,
        surveyGraph.CLOSE_TOLERANCE_MM
      );
      const secondTarget = surveyGraph.getCursorPlacementTarget(
        floor,
        secondFacePoint,
        surveyGraph.CLOSE_TOLERANCE_MM
      );
      assert.equal(firstTarget.type, 'wall');
      assert.equal(secondTarget.type, 'wall');
      assert.equal(firstTarget.snapLine, scenario.snapFace);
      assert.equal(secondTarget.snapLine, scenario.snapFace);

      const canonicalFirst = transformPoint(
        { xMm: 2400, yMm: 0 },
        scenario.rotation,
        scenario.mirrored
      );
      const offset = subtractPoints(firstFacePoint, canonicalFirst);
      const firstOutside = addPoints(transformPoint(
        { xMm: 2400, yMm: -3000 },
        scenario.rotation,
        scenario.mirrored
      ), offset);
      const secondOutside = addPoints(transformPoint(
        { xMm: 5600, yMm: -3000 },
        scenario.rotation,
        scenario.mirrored
      ), offset);
      const prepareFirstPreview = (inputDraft) => {
        const snapped = surveyGraph.snapCursorToWall(
          surveyGraph.startWallSnap(inputDraft),
          firstTarget.pointMm,
          firstTarget
        );
        return surveyGraph.startPreview(snapped, firstOutside);
      };
      const closeAdjacentRoom = (inputDraft) => {
        let closed = prepareFirstPreview(inputDraft);
        let activeFloor = surveyGraph.getActiveFloor(closed);
        closed = surveyGraph.commitPreviewLength(
          closed,
          activeFloor.session.previewLengthMm,
          'closure-matrix'
        );
        closed = commitPreview(closed, secondOutside);
        closed = surveyGraph.startPreview(closed, secondFacePoint);
        return surveyGraph.confirmClosure(closed);
      };

      const closureProbe = closeAdjacentRoom(draft);
      const closureProbeFloor = surveyGraph.getActiveFloor(closureProbe);
      const sourceSegments = closureProbeFloor.walls.filter((wall) => (
        wall.id === sourceWall.id || wall.topologySourceWallId === sourceWall.id
      ));
      assert.equal(sourceSegments.length, 3);
      const cutPointsAlongMm = Array.from(new Set(sourceSegments.flatMap((wall) => (
        [wall.startNodeId, wall.endNodeId].map((nodeId) => pointAlongWallMm(
          closureProbeFloor,
          sourceWall,
          surveyGraph.getNode(closureProbeFloor, nodeId)
        ))
      )))).filter((alongMm) => alongMm > 1 && alongMm < sourceCoordinateLengthMm - 1)
        .sort((first, second) => first - second);
      assert.equal(cutPointsAlongMm.length, 2, 'adjacent closure did not create two source-wall cuts');

      draft = surveyGraph.addOpeningToWall(draft, sourceWall.id, scenario.openingType);
      floor = surveyGraph.getActiveFloor(draft);
      const openingId = floor.openings.at(-1).id;
      const openingWidthMm = floor.openings.at(-1).widthMm;
      const halfOpeningWidthMm = openingWidthMm / 2;
      const conflictCutAlongMm = scenario.conflictCut === 'first'
        ? cutPointsAlongMm[0]
        : cutPointsAlongMm[1];
      const splitClearanceMm = scenario.dividerThicknessMm;
      const openingCentersAlongMm = {
        center: conflictCutAlongMm,
        'before-clearance-edge': (
          conflictCutAlongMm - splitClearanceMm - halfOpeningWidthMm
        ),
        'after-clearance-edge': (
          conflictCutAlongMm + splitClearanceMm + halfOpeningWidthMm
        )
      };
      const openingCenterAlongMm = Math.round(
        openingCentersAlongMm[scenario.openingPlacement]
      );
      draft = surveyGraph.updateOpening(draft, openingId, {
        centerOffsetMm: openingCenterAlongMm - sourceStartAlongMm
      });
      floor = surveyGraph.getActiveFloor(draft);
      const openingBefore = floor.openings.find((opening) => opening.id === openingId);
      assert.ok(openingBefore);
      assert.equal(
        sourceStartAlongMm + openingBefore.centerOffsetMm,
        openingCenterAlongMm,
        'opening conflict placement was normalized away from the intended split clearance'
      );
      const openingStartAlongMm = openingCenterAlongMm - halfOpeningWidthMm;
      const openingEndAlongMm = openingCenterAlongMm + halfOpeningWidthMm;
      if (scenario.openingPlacement === 'before-clearance-edge') {
        assert.equal(openingEndAlongMm, conflictCutAlongMm - splitClearanceMm);
      } else if (scenario.openingPlacement === 'after-clearance-edge') {
        assert.equal(openingStartAlongMm, conflictCutAlongMm + splitClearanceMm);
      } else {
        assert.ok(
          openingStartAlongMm < conflictCutAlongMm &&
            openingEndAlongMm > conflictCutAlongMm
        );
      }
      const openingCenterBefore = openingWorldCenter(floor, openingBefore);

      let rejectionInput;
      let rejectSplit;
      if (scenario.conflictCut === 'first') {
        rejectionInput = prepareFirstPreview(draft);
        const rejectionFloor = surveyGraph.getActiveFloor(rejectionInput);
        rejectSplit = () => surveyGraph.commitPreviewLength(
          rejectionInput,
          rejectionFloor.session.previewLengthMm,
          scenario.pathMode === 'measured-commit' ? 'ble' : 'closure-matrix'
        );
      } else {
        let pending = prepareFirstPreview(draft);
        let pendingFloor = surveyGraph.getActiveFloor(pending);
        pending = surveyGraph.commitPreviewLength(
          pending,
          pendingFloor.session.previewLengthMm,
          scenario.pathMode === 'measured-commit' ? 'ble' : 'closure-matrix'
        );
        pending = commitPreview(
          pending,
          secondOutside,
          scenario.pathMode === 'measured-commit' ? 'ble' : 'closure-matrix'
        );
        pending = surveyGraph.startPreview(pending, secondFacePoint);
        pendingFloor = surveyGraph.getActiveFloor(pending);
        assert.ok(pendingFloor.session.closeCandidateType, 'final source-wall cut was not offered');
        if (scenario.pathMode === 'measured-commit') {
          pending = surveyGraph.commitPreviewLength(
            pending,
            pendingFloor.session.previewLengthMm,
            'ble'
          );
          pendingFloor = surveyGraph.getActiveFloor(pending);
          assert.ok(
            pendingFloor.session.state === 'closing' ||
              pendingFloor.session.state === 'mergeClosing',
            `unexpected committed closure state: ${pendingFloor.session.state}`
          );
        }
        rejectionInput = pending;
        rejectSplit = () => surveyGraph.confirmClosure(rejectionInput);
      }

      const rejectionSnapshot = JSON.stringify(rejectionInput);
      let rejection;
      try {
        rejectSplit();
      } catch (error) {
        rejection = error;
      }
      assert.ok(rejection, 'opening-overlap closure did not reject the wall split');
      assert.equal(rejection.code, 'OPENING_SPLIT_CONFLICT');
      assert.equal(rejection.message, '分隔线压到门窗，请先调整门窗位置');
      assert.equal(rejection.openingId, openingId);
      assert.equal(rejection.clearanceMm, splitClearanceMm);
      assert.equal(JSON.stringify(rejectionInput), rejectionSnapshot);
      const immutableFloor = surveyGraph.getActiveFloor(rejectionInput);
      const immutableOpening = immutableFloor.openings.find((opening) => opening.id === openingId);
      assert.ok(immutableOpening);
      assert.deepEqual(openingWorldCenter(immutableFloor, immutableOpening), openingCenterBefore);
      assert.equal(immutableFloor.spaces.filter((space) => space.closed).length, 1);
    }
  );
});

test('complex closed grids survive formal save, JSON restore and Canvas reconstruction', () => {
  const cases = [];
  ROTATIONS.forEach((rotation) => {
    MIRRORS.forEach((mirrored) => {
      [100, 400].forEach((thicknessMm) => {
        MEASUREMENT_SIDES.forEach((measurementSide) => {
          cases.push({
            rotation,
            mirrored,
            thicknessMm,
            measurementSide,
            dividerDirection: 'down',
            branchOrder: 'left-first',
            snapFace: 'inner',
            closeAction: 'committed',
            label: `rotation=${rotation * 90}, mirror=${mirrored}, thickness=${thicknessMm}, side=${measurementSide}`
          });
        });
      });
    });
  });
  runMatrix(cases, 'formal save/restore closure scenarios', MATRIX_CASE_COUNTS.formalSaveRestore, (scenario) => {
    let draft = buildFourRoomGrid(scenario).draft;
    let result = assertClosedDraftContracts(draft, 4);
    const uniqueWalls = result.floor.walls.filter((wall) => (
      result.usage[wall.id] === 1 && wall.lengthMm >= 1800
    ));
    assert.ok(uniqueWalls.length >= 2);
    draft = surveyGraph.addOpeningToWall(draft, uniqueWalls[0].id, 'door');
    draft = surveyGraph.addOpeningToWall(draft, uniqueWalls[1].id, 'window');
    result = assertClosedDraftContracts(draft, 4);
    const originalFloor = result.floor;
    const originalSignature = closedSpaceSignature(draft);
    const originalScene = result.scene;
    const layout = surveyLayout.createFormalSurveyLayout(draft, 'completed');
    const restoredLayout = surveyLayout.parseFormalSurveyLayout(JSON.stringify(layout));
    assert.ok(restoredLayout);
    const restoredDraft = restoredLayout.surveyGraph;
    const restoredResult = assertClosedDraftContracts(restoredDraft, 4);
    assert.deepEqual(restoredResult.floor, originalFloor);
    assert.deepEqual(closedSpaceSignature(restoredDraft), originalSignature);
    assert.deepEqual(restoredResult.scene.wallSolidPlan, originalScene.wallSolidPlan);
    assert.deepEqual(restoredResult.floor.openings, originalFloor.openings);
  });
});

test('a self-crossing final closure is rejected without mutating the measured chain', () => {
  const cases = [];
  ROTATIONS.forEach((rotation) => {
    MIRRORS.forEach((mirrored) => {
      THICKNESSES_MM.forEach((thicknessMm) => {
        MEASUREMENT_SIDES.forEach((measurementSide) => {
          CLOSE_ACTIONS.forEach((closeAction) => {
            cases.push({
              rotation,
              mirrored,
              thicknessMm,
              measurementSide,
              closeAction,
              label: `rotation=${rotation * 90}, mirror=${mirrored}, thickness=${thicknessMm}, side=${measurementSide}, close=${closeAction}`
            });
          });
        });
      });
    });
  });
  runMatrix(cases, 'self-crossing rejection scenarios', MATRIX_CASE_COUNTS.selfCrossingRejection, (scenario) => {
    const points = [
      { xMm: 0, yMm: 0 },
      { xMm: 4000, yMm: 0 },
      { xMm: 0, yMm: 4000 },
      { xMm: 4000, yMm: 4000 }
    ].map((point) => transformPoint(point, scenario.rotation, scenario.mirrored));
    let draft = surveyGraph.createSurveyDraft();
    draft = surveyGraph.setMode(draft, 'diagonal');
    draft = surveyGraph.setThickness(draft, scenario.thicknessMm);
    draft = surveyGraph.placeCursor(draft, points[0]);
    draft = commitPreview(draft, points[1]);
    let floor = surveyGraph.getActiveFloor(draft);
    draft = surveyGraph.setMeasurementSide(draft, scenario.measurementSide, floor.walls[0].id);
    draft = commitPreview(draft, points[2]);
    draft = commitPreview(draft, points[3]);
    draft = surveyGraph.startPreview(draft, points[0]);
    floor = surveyGraph.getActiveFloor(draft);
    assert.equal(floor.session.closeCandidateType, 'start');
    const before = JSON.stringify(draft);
    assert.throws(
      () => {
        if (scenario.closeAction === 'committed') {
          surveyGraph.commitPreviewLength(
            draft,
            floor.session.previewLengthMm,
            'closure-matrix'
          );
        } else {
          surveyGraph.confirmClosure(draft);
        }
      },
      /重叠|自交|相交/
    );
    assert.equal(JSON.stringify(draft), before);
    assert.equal(surveyGraph.getActiveFloor(draft).spaces.filter((space) => space.closed).length, 0);
  });
});
