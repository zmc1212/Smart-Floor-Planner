const test = require('node:test');
const assert = require('node:assert/strict');
const surveyGraph = require('../utils/surveyWallGraph.js');
const surveyLayout = require('../utils/surveyLayout.js');
const surveyCanvasRenderer = require('../packages/surveying/utils/surveyCanvasRenderer.js');

const RECT = { width: 520, height: 520 };
const ROTATIONS = [0, 1, 2, 3];
const THICKNESSES_MM = [100, 200, 400];
const MEASUREMENT_SIDES = ['left', 'right'];
const SNAP_FACES = ['inner', 'outer'];
const BRANCH_DIRECTIONS = ['negative', 'positive'];

function rotatePoint(point, quarterTurns) {
  let current = { xMm: point.xMm, yMm: point.yMm };
  for (let index = 0; index < quarterTurns; index += 1) {
    current = { xMm: -current.yMm, yMm: current.xMm };
  }
  return current;
}

function commitPreview(draft, rawPoint) {
  const preview = surveyGraph.startPreview(draft, rawPoint);
  const floor = surveyGraph.getActiveFloor(preview);
  assert.ok(
    floor.session.previewLengthMm >= surveyGraph.MIN_WALL_LENGTH_MM,
    `preview is too short: ${floor.session.previewLengthMm}`
  );
  return surveyGraph.commitPreviewLength(
    preview,
    floor.session.previewLengthMm,
    'scenario-matrix'
  );
}

function createOpenWallDraft(options) {
  const opts = options || {};
  const rotation = opts.rotation || 0;
  const start = rotatePoint({ xMm: -3000, yMm: 0 }, rotation);
  const end = rotatePoint({ xMm: 3000, yMm: 0 }, rotation);
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.setThickness(draft, opts.thicknessMm || 200);
  draft = surveyGraph.placeCursor(draft, start);
  draft = commitPreview(draft, end);
  const floor = surveyGraph.getActiveFloor(draft);
  draft = surveyGraph.setMeasurementSide(
    draft,
    opts.measurementSide || 'left',
    floor.walls[0].id
  );
  return draft;
}

function createClosedRectangleDraft(options) {
  const opts = options || {};
  const rotation = opts.rotation || 0;
  const widthMm = opts.widthMm || 6000;
  const heightMm = opts.heightMm || 4000;
  const points = [
    { xMm: 0, yMm: 0 },
    { xMm: widthMm, yMm: 0 },
    { xMm: widthMm, yMm: heightMm },
    { xMm: 0, yMm: heightMm }
  ].map((point) => rotatePoint(point, rotation));
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.setThickness(draft, opts.thicknessMm || 200);
  draft = surveyGraph.placeCursor(draft, points[0]);
  draft = commitPreview(draft, points[1]);
  let floor = surveyGraph.getActiveFloor(draft);
  draft = surveyGraph.setMeasurementSide(
    draft,
    opts.measurementSide || 'left',
    floor.walls[0].id
  );
  draft = commitPreview(draft, points[2]);
  draft = commitPreview(draft, points[3]);
  draft = commitPreview(draft, points[0]);
  return surveyGraph.confirmClosure(draft);
}

function createPartitionedTwoRoomDraft(options) {
  const opts = options || {};
  let draft = createClosedRectangleDraft(opts);
  let floor = surveyGraph.getActiveFloor(draft);
  const sourceWall = floor.walls[0];
  const targetPoint = wallTargetPoint(floor, sourceWall, 'inner');
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    targetPoint,
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  draft = surveyGraph.snapCursorToWall(
    surveyGraph.startWallSnap(draft),
    target.pointMm,
    target
  );
  draft = commitPreview(
    draft,
    rotatePoint({ xMm: 3000, yMm: 4000 }, opts.rotation || 0)
  );
  floor = surveyGraph.getActiveFloor(draft);
  assert.equal(floor.session.state, 'closing');
  draft = surveyGraph.confirmClosure(draft);
  assert.equal(surveyGraph.getActiveFloor(draft).spaces.filter((space) => space.closed).length, 2);
  return draft;
}

function createThreeRoomRowDraft() {
  let draft = createClosedRectangleDraft({ widthMm: 9000, heightMm: 4000 });
  [3000, 6000].forEach((xMm) => {
    const floor = surveyGraph.getActiveFloor(draft);
    const target = surveyGraph.getCursorPlacementTarget(
      floor,
      { xMm, yMm: 0 },
      surveyGraph.CLOSE_TOLERANCE_MM
    );
    draft = surveyGraph.snapCursorToWall(
      surveyGraph.startWallSnap(draft),
      target.pointMm,
      target
    );
    draft = commitPreview(draft, { xMm, yMm: 4000 });
    assert.equal(surveyGraph.getActiveFloor(draft).session.state, 'closing');
    draft = surveyGraph.confirmClosure(draft);
  });
  return draft;
}

function createDiagonalOpenWallDraft(options) {
  const opts = options || {};
  const angleRad = opts.angleDeg * Math.PI / 180;
  const direction = { x: Math.cos(angleRad), y: Math.sin(angleRad) };
  const start = {
    xMm: Math.round(-direction.x * 3000),
    yMm: Math.round(-direction.y * 3000)
  };
  const end = {
    xMm: Math.round(direction.x * 3000),
    yMm: Math.round(direction.y * 3000)
  };
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.setMode(draft, 'diagonal');
  draft = surveyGraph.setThickness(draft, opts.thicknessMm || 200);
  draft = surveyGraph.placeCursor(draft, start);
  draft = commitPreview(draft, end);
  const floor = surveyGraph.getActiveFloor(draft);
  draft = surveyGraph.setMeasurementSide(
    draft,
    opts.measurementSide || 'left',
    floor.walls[0].id
  );
  return { draft, direction };
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

function pointInRing(point, ring) {
  let inside = false;
  for (let index = 0, previousIndex = ring.length - 1; index < ring.length; previousIndex = index, index += 1) {
    const current = ring[index];
    const previous = ring[previousIndex];
    const intersects = ((current.y > point.y) !== (previous.y > point.y)) &&
      point.x < (previous.x - current.x) * (point.y - current.y) /
        ((previous.y - current.y) || 1) + current.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInSolid(point, plan) {
  return (plan.rings || []).reduce((inside, ring) => (
    pointInRing(point, ring) ? !inside : inside
  ), false);
}

function interpolate(first, second, ratio) {
  return {
    x: first.x + (second.x - first.x) * ratio,
    y: first.y + (second.y - first.y) * ratio
  };
}

function sourceJunctionSamples(sourceScene, thicknessMm, junctionRatio, coordinateLengthMm) {
  const polygon = sourceScene.bodyPolygon;
  const centerRatio = Number.isFinite(junctionRatio) ? junctionRatio : 0.5;
  const alongDelta = Math.min(0.08, thicknessMm / (coordinateLengthMm || 6000));
  const alongRatios = [-0.75, -0.5, -0.25, 0.25, 0.5, 0.75]
    .map((factor) => centerRatio + alongDelta * factor);
  const acrossRatios = [0.15, 0.35, 0.5, 0.65, 0.85];
  const samples = [];
  alongRatios.forEach((alongRatio) => {
    const inner = interpolate(polygon[0], polygon[1], alongRatio);
    const outer = interpolate(polygon[3], polygon[2], alongRatio);
    acrossRatios.forEach((acrossRatio) => {
      samples.push(interpolate(inner, outer, acrossRatio));
    });
  });
  return samples;
}

function midpoint(first, second) {
  return {
    xMm: Math.round((first.xMm + second.xMm) / 2),
    yMm: Math.round((first.yMm + second.yMm) / 2)
  };
}

function wallTargetPoint(floor, wall, snapFace) {
  const start = surveyGraph.getNode(floor, wall.startNodeId);
  const end = surveyGraph.getNode(floor, wall.endNodeId);
  if (snapFace === 'inner') return midpoint(start, end);
  const geometry = surveyGraph.buildWallRenderGeometry(floor, wall);
  return midpoint(geometry.outerStart, geometry.outerEnd);
}

function splitSourceSegments(floor, sourceWallId) {
  return floor.walls.filter((wall) => (
    wall.id === sourceWallId || wall.topologySourceWallId === sourceWallId
  ));
}

function projectPoint(point, viewport) {
  return {
    x: RECT.width / 2 + viewport.offsetX + point.xMm * viewport.scale,
    y: RECT.height / 2 + viewport.offsetY + point.yMm * viewport.scale
  };
}

function normalizeWallResult(floor, wall) {
  const end = surveyGraph.getNode(floor, wall.endNodeId);
  return {
    end: { xMm: end.xMm, yMm: end.yMm },
    lengthMm: wall.lengthMm,
    measurementSide: wall.measurementSide,
    measurementStartInsetMm: wall.measurementStartInsetMm || 0,
    measurementEndInsetMm: wall.measurementEndInsetMm || 0
  };
}

function collectMatrixFailures(cases, runCase) {
  const failures = [];
  cases.forEach((scenario) => {
    try {
      runCase(scenario);
    } catch (error) {
      failures.push(`${scenario.label}: ${error.message}`);
    }
  });
  return failures;
}

function assertMatrixPassed(failures, cases, label) {
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

function assertFullShadowMatches(draft) {
  const validation = surveyGraph.validateSurveyDraft(draft, { mode: 'full' });
  assert.equal(
    validation.valid,
    true,
    validation.errors.map((error) => `${error.code}@${error.path}`).join(', ')
  );
}

function buildTMatrix(sourceType) {
  const cases = [];
  ROTATIONS.forEach((rotation) => {
    THICKNESSES_MM.forEach((thicknessMm) => {
      MEASUREMENT_SIDES.forEach((measurementSide) => {
        SNAP_FACES.forEach((snapFace) => {
          BRANCH_DIRECTIONS.forEach((branchDirection) => {
            cases.push({
              sourceType,
              rotation,
              thicknessMm,
              measurementSide,
              snapFace,
              branchDirection,
              label: [
                sourceType,
                `rotation=${rotation * 90}`,
                `thickness=${thicknessMm}`,
                `side=${measurementSide}`,
                `snap=${snapFace}`,
                `branch=${branchDirection}`
              ].join(', ')
            });
          });
        });
      });
    });
  });
  return cases;
}

function executeTScenario(scenario) {
  const createDraft = scenario.sourceType === 'closed'
    ? createClosedRectangleDraft
    : createOpenWallDraft;
  let draft = createDraft(scenario);
  let floor = surveyGraph.getActiveFloor(draft);
  const sourceWall = floor.walls[0];
  const sourceWallId = sourceWall.id;
  const sourceSpace = floor.spaces.find((space) => space.closed) || null;
  const dimensionBefore = sourceSpace
    ? surveyGraph.buildSpaceDimensionPlan(floor, sourceSpace).inner
    : null;
  const beforeScene = createScene(draft);
  const beforeSourceScene = beforeScene.walls.find((wall) => wall.id === sourceWallId);
  const targetPoint = wallTargetPoint(floor, sourceWall, scenario.snapFace);
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    targetPoint,
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  assert.equal(target.type, 'wall');
  assert.equal(target.snapLine, scenario.snapFace);

  if (scenario.branchThicknessMm) {
    draft = surveyGraph.setThickness(draft, scenario.branchThicknessMm);
  }

  draft = surveyGraph.snapCursorToWall(
    surveyGraph.startWallSnap(draft),
    target.pointMm,
    target
  );
  floor = surveyGraph.getActiveFloor(draft);
  const junctionNodeId = floor.session.anchorNodeId;
  const canonicalBranchEnd = {
    xMm: 0,
    yMm: scenario.branchDirection === 'negative' ? -1800 : 1800
  };
  const branchEnd = scenario.sourceType === 'closed'
    ? rotatePoint({ xMm: 3000, yMm: canonicalBranchEnd.yMm }, scenario.rotation)
    : rotatePoint(canonicalBranchEnd, scenario.rotation);
  draft = commitPreview(draft, branchEnd);
  floor = surveyGraph.getActiveFloor(draft);

  const sourceSegments = splitSourceSegments(floor, sourceWallId);
  const incidentWalls = floor.walls.filter((wall) => (
    wall.startNodeId === junctionNodeId || wall.endNodeId === junctionNodeId
  ));
  assert.equal(sourceSegments.length, 2);
  assert.equal(incidentWalls.length, 3);
  assert.equal(floor.spaces.filter((space) => space.closed).length, sourceSpace ? 1 : 0);
  if (sourceSpace) {
    assert.deepEqual(
      surveyGraph.buildSpaceDimensionPlan(
        floor,
        floor.spaces.find((space) => space.id === sourceSpace.id)
      ).inner,
      dimensionBefore
    );
  }

  const afterScene = createScene(draft);
  const missingSamples = sourceJunctionSamples(beforeSourceScene, scenario.thicknessMm)
    .filter((sample) => !pointInSolid(sample, afterScene.wallSolidPlan));
  if (!scenario.allowInitialSolidGap) {
    assert.equal(
      missingSamples.length,
      0,
      `source wall solid lost ${missingSamples.length} junction samples`
    );
  }
  assertFullShadowMatches(draft);
  return { draft, sourceWallId, junctionNodeId, beforeSourceScene };
}

test('T-junction scenario matrix keeps the source wall physically solid', () => {
  const cases = buildTMatrix('open').concat(buildTMatrix('closed'));
  const failures = collectMatrixFailures(cases, executeTScenario);
  assertMatrixPassed(failures, cases, 'T-junction scenarios');
});

test('unequal source and branch thicknesses keep a closed-boundary T solid', () => {
  const cases = [];
  ROTATIONS.forEach((rotation) => {
    THICKNESSES_MM.forEach((thicknessMm) => {
      THICKNESSES_MM.forEach((branchThicknessMm) => {
        SNAP_FACES.forEach((snapFace) => {
          cases.push({
            sourceType: 'closed',
            rotation,
            thicknessMm,
            branchThicknessMm,
            measurementSide: 'left',
            snapFace,
            branchDirection: 'negative',
            label: `rotation=${rotation * 90}, source=${thicknessMm}, branch=${branchThicknessMm}, snap=${snapFace}`
          });
        });
      });
    });
  });
  const failures = collectMatrixFailures(cases, executeTScenario);
  assertMatrixPassed(failures, cases, 'unequal-thickness T scenarios');
});

test('the photographed two-room exterior T keeps the split boundary solid', () => {
  const cases = ROTATIONS.flatMap((rotation) => (
    THICKNESSES_MM.flatMap((thicknessMm) => (
      SNAP_FACES.map((snapFace) => ({
        rotation,
        thicknessMm,
        measurementSide: 'left',
        snapFace,
        label: `rotation=${rotation * 90}, thickness=${thicknessMm}, snap=${snapFace}`
      }))
    ))
  ));
  const failures = collectMatrixFailures(cases, (scenario) => {
    let draft = createPartitionedTwoRoomDraft(scenario);
    let floor = surveyGraph.getActiveFloor(draft);
    const expectedStart = rotatePoint({ xMm: 0, yMm: 0 }, scenario.rotation);
    const expectedEnd = rotatePoint({ xMm: 3000, yMm: 0 }, scenario.rotation);
    const sourceWall = floor.walls.find((wall) => {
      const start = surveyGraph.getNode(floor, wall.startNodeId);
      const end = surveyGraph.getNode(floor, wall.endNodeId);
      return start && end && (
        (start.xMm === expectedStart.xMm && start.yMm === expectedStart.yMm &&
          end.xMm === expectedEnd.xMm && end.yMm === expectedEnd.yMm) ||
        (end.xMm === expectedStart.xMm && end.yMm === expectedStart.yMm &&
          start.xMm === expectedEnd.xMm && start.yMm === expectedEnd.yMm)
      );
    });
    assert.ok(sourceWall, 'left room top boundary was not found');
    const sourceWallId = sourceWall.id;
    const beforeScene = createScene(draft);
    const beforeSourceScene = beforeScene.walls.find((wall) => wall.id === sourceWallId);
    const dimensionsBefore = floor.spaces.filter((space) => space.closed).map((space) => ({
      id: space.id,
      inner: surveyGraph.buildSpaceDimensionPlan(floor, space).inner
    }));
    const targetPoint = wallTargetPoint(floor, sourceWall, scenario.snapFace);
    const target = surveyGraph.getCursorPlacementTarget(
      floor,
      targetPoint,
      surveyGraph.CLOSE_TOLERANCE_MM
    );
    draft = surveyGraph.snapCursorToWall(
      surveyGraph.startWallSnap(draft),
      target.pointMm,
      target
    );
    draft = commitPreview(
      draft,
      rotatePoint({ xMm: 1500, yMm: -1800 }, scenario.rotation)
    );
    floor = surveyGraph.getActiveFloor(draft);
    assert.equal(floor.spaces.filter((space) => space.closed).length, 2);
    dimensionsBefore.forEach((entry) => {
      assert.deepEqual(
        surveyGraph.buildSpaceDimensionPlan(
          floor,
          floor.spaces.find((space) => space.id === entry.id)
        ).inner,
        entry.inner
      );
    });
    const scene = createScene(draft);
    const missingSamples = sourceJunctionSamples(beforeSourceScene, scenario.thicknessMm)
      .filter((sample) => !pointInSolid(sample, scene.wallSolidPlan));
    assert.equal(missingSamples.length, 0, `two-room exterior wall lost ${missingSamples.length} samples`);
  });
  assertMatrixPassed(failures, cases, 'photographed T scenarios');
});

test('a T branch from a shared wall keeps both room contracts and the wall solid', () => {
  const cases = [];
  ROTATIONS.forEach((rotation) => {
    THICKNESSES_MM.forEach((thicknessMm) => {
      SNAP_FACES.forEach((snapFace) => {
        BRANCH_DIRECTIONS.forEach((branchDirection) => {
          cases.push({
            rotation,
            thicknessMm,
            measurementSide: 'left',
            snapFace,
            branchDirection,
            label: `rotation=${rotation * 90}, thickness=${thicknessMm}, snap=${snapFace}, branch=${branchDirection}`
          });
        });
      });
    });
  });
  const failures = collectMatrixFailures(cases, (scenario) => {
    let draft = createPartitionedTwoRoomDraft(scenario);
    let floor = surveyGraph.getActiveFloor(draft);
    const useCounts = {};
    floor.spaces.filter((space) => space.closed).forEach((space) => {
      space.wallIds.forEach((wallId) => {
        useCounts[wallId] = (useCounts[wallId] || 0) + 1;
      });
    });
    const sourceWall = floor.walls.find((wall) => useCounts[wall.id] === 2);
    assert.ok(sourceWall, 'shared wall was not found');
    const beforeSourceScene = createScene(draft).walls.find((wall) => wall.id === sourceWall.id);
    const dimensionsBefore = floor.spaces.filter((space) => space.closed).map((space) => ({
      id: space.id,
      inner: surveyGraph.buildSpaceDimensionPlan(floor, space).inner
    }));
    const targetPoint = wallTargetPoint(floor, sourceWall, scenario.snapFace);
    const target = surveyGraph.getCursorPlacementTarget(
      floor,
      targetPoint,
      surveyGraph.CLOSE_TOLERANCE_MM
    );
    draft = surveyGraph.snapCursorToWall(
      surveyGraph.startWallSnap(draft),
      target.pointMm,
      target
    );
    const canonicalEnd = {
      xMm: scenario.branchDirection === 'negative' ? 2000 : 4000,
      yMm: 2000
    };
    draft = commitPreview(draft, rotatePoint(canonicalEnd, scenario.rotation));
    floor = surveyGraph.getActiveFloor(draft);
    assert.equal(floor.spaces.filter((space) => space.closed).length, 2);
    dimensionsBefore.forEach((entry) => {
      assert.deepEqual(
        surveyGraph.buildSpaceDimensionPlan(
          floor,
          floor.spaces.find((space) => space.id === entry.id)
        ).inner,
        entry.inner
      );
    });
    const scene = createScene(draft);
    const missingSamples = sourceJunctionSamples(beforeSourceScene, scenario.thicknessMm)
      .filter((sample) => !pointInSolid(sample, scene.wallSolidPlan));
    assert.equal(missingSamples.length, 0, `shared wall lost ${missingSamples.length} samples`);
  });
  assertMatrixPassed(failures, cases, 'shared-wall T scenarios');
});

test('deleting one shared divider leaves an unrelated third closed space unchanged', () => {
  let draft = createThreeRoomRowDraft();
  let floor = surveyGraph.getActiveFloor(draft);
  assert.equal(floor.spaces.filter((space) => space.closed).length, 3);

  const divider = floor.walls.find((wall) => {
    const start = surveyGraph.getNode(floor, wall.startNodeId);
    const end = surveyGraph.getNode(floor, wall.endNodeId);
    return start && end && start.xMm === 3000 && end.xMm === 3000;
  });
  assert.ok(divider, 'first shared divider was not found');
  const unaffectedSpace = floor.spaces.find((space) => (
    space.closed && space.wallIds.indexOf(divider.id) === -1
  ));
  assert.ok(unaffectedSpace, 'unrelated third space was not found');
  const boundaryBefore = surveyGraph.buildSpaceBoundaryPoints(floor, unaffectedSpace.wallIds);
  const dimensionsBefore = surveyGraph.buildSpaceDimensionPlan(floor, unaffectedSpace).inner;

  draft = surveyGraph.deleteWall(draft, divider.id);
  floor = surveyGraph.getActiveFloor(draft);
  const remainingSpace = floor.spaces.find((space) => space.id === unaffectedSpace.id);
  assert.ok(remainingSpace && remainingSpace.closed, 'unrelated third space was invalidated');
  assert.deepEqual(
    surveyGraph.buildSpaceBoundaryPoints(floor, remainingSpace.wallIds),
    boundaryBefore
  );
  assert.deepEqual(
    surveyGraph.buildSpaceDimensionPlan(floor, remainingSpace).inner,
    dimensionsBefore
  );
});

test('diagonal open-wall T matrix keeps the source wall solid', () => {
  const angles = [15, 35, 55, 75, 105, 125, 145, 165];
  const cases = [];
  angles.forEach((angleDeg) => {
    THICKNESSES_MM.forEach((thicknessMm) => {
      MEASUREMENT_SIDES.forEach((measurementSide) => {
        SNAP_FACES.forEach((snapFace) => {
          BRANCH_DIRECTIONS.forEach((branchDirection) => {
            cases.push({
              angleDeg,
              thicknessMm,
              measurementSide,
              snapFace,
              branchDirection,
              label: `angle=${angleDeg}, thickness=${thicknessMm}, side=${measurementSide}, snap=${snapFace}, branch=${branchDirection}`
            });
          });
        });
      });
    });
  });
  const failures = collectMatrixFailures(cases, (scenario) => {
    const created = createDiagonalOpenWallDraft(scenario);
    let draft = created.draft;
    let floor = surveyGraph.getActiveFloor(draft);
    const sourceWall = floor.walls[0];
    const beforeSourceScene = createScene(draft).walls[0];
    const targetPoint = wallTargetPoint(floor, sourceWall, scenario.snapFace);
    const target = surveyGraph.getCursorPlacementTarget(
      floor,
      targetPoint,
      surveyGraph.CLOSE_TOLERANCE_MM
    );
    draft = surveyGraph.snapCursorToWall(
      surveyGraph.startWallSnap(draft),
      target.pointMm,
      target
    );
    const normalSign = scenario.branchDirection === 'negative' ? -1 : 1;
    const branchEnd = {
      xMm: Math.round(-created.direction.y * 1800 * normalSign),
      yMm: Math.round(created.direction.x * 1800 * normalSign)
    };
    draft = commitPreview(draft, branchEnd);
    floor = surveyGraph.getActiveFloor(draft);
    assert.equal(splitSourceSegments(floor, sourceWall.id).length, 2);
    const scene = createScene(draft);
    const missingSamples = sourceJunctionSamples(beforeSourceScene, scenario.thicknessMm)
      .filter((sample) => !pointInSolid(sample, scene.wallSolidPlan));
    assert.equal(missingSamples.length, 0, `diagonal source lost ${missingSamples.length} samples`);
  });
  assertMatrixPassed(failures, cases, 'diagonal T scenarios');
});

test('deleting a T branch restores the original source wall solid', () => {
  const cases = ROTATIONS.flatMap((rotation) => THICKNESSES_MM.map((thicknessMm) => ({
    sourceType: 'closed',
    rotation,
    thicknessMm,
    measurementSide: 'left',
    snapFace: 'inner',
    branchDirection: 'negative',
    allowInitialSolidGap: true,
    label: `rotation=${rotation * 90}, thickness=${thicknessMm}`
  })));
  const failures = collectMatrixFailures(cases, (scenario) => {
    const result = executeTScenario(scenario);
    let draft = result.draft;
    let floor = surveyGraph.getActiveFloor(draft);
    const insetSourceWall = splitSourceSegments(floor, result.sourceWallId).find((wall) => (
      (wall.measurementStartInsetMm || 0) > 0 || (wall.measurementEndInsetMm || 0) > 0
    ));
    assert.ok(insetSourceWall);
    draft = surveyGraph.addOpeningToWall(draft, insetSourceWall.id, 'door');
    floor = surveyGraph.getActiveFloor(draft);
    const openingBefore = floor.openings.at(-1);
    const openingWallBefore = surveyGraph.getWall(floor, openingBefore.wallId);
    const openingAbsoluteBefore = openingBefore.centerOffsetMm +
      (openingWallBefore.measurementStartInsetMm || 0);
    const sourceIds = new Set(splitSourceSegments(floor, result.sourceWallId).map((wall) => wall.id));
    const branch = floor.walls.find((wall) => (
      !sourceIds.has(wall.id) &&
      (wall.startNodeId === result.junctionNodeId || wall.endNodeId === result.junctionNodeId)
    ));
    assert.ok(branch);
    const deletedDraft = surveyGraph.deleteWall(draft, branch.id);
    floor = surveyGraph.getActiveFloor(deletedDraft);
    const deletedScene = createScene(deletedDraft);
    const missingSamples = sourceJunctionSamples(result.beforeSourceScene, scenario.thicknessMm)
      .filter((sample) => !pointInSolid(sample, deletedScene.wallSolidPlan));
    assert.equal(missingSamples.length, 0, `deleted branch left ${missingSamples.length} holes`);
    assert.equal(
      splitSourceSegments(floor, result.sourceWallId).every((wall) => (
        (wall.measurementStartInsetMm || 0) === 0 &&
        (wall.measurementEndInsetMm || 0) === 0
      )),
      true,
      'deleted branch left a stale source-wall measurement inset'
    );
    const openingAfter = floor.openings.find((opening) => opening.id === openingBefore.id);
    const openingWallAfter = surveyGraph.getWall(floor, openingAfter.wallId);
    assert.equal(
      openingAfter.centerOffsetMm + (openingWallAfter.measurementStartInsetMm || 0),
      openingAbsoluteBefore,
      'deleted branch moved an existing opening along its source wall'
    );
  });
  assertMatrixPassed(failures, cases, 'T-delete scenarios');
});

test('splitting a wall with a door or window keeps the opening at its absolute coordinate', () => {
  const cases = ['door', 'window'].flatMap((openingType) => (
    ROTATIONS.flatMap((rotation) => SNAP_FACES.map((snapFace) => ({
      openingType,
      rotation,
      thicknessMm: 200,
      measurementSide: 'left',
      snapFace,
      label: `${openingType}, rotation=${rotation * 90}, snap=${snapFace}`
    })))
  ));
  const failures = collectMatrixFailures(cases, (scenario) => {
    let draft = createClosedRectangleDraft(scenario);
    let floor = surveyGraph.getActiveFloor(draft);
    const sourceWall = floor.walls[0];
    draft = surveyGraph.addOpeningToWall(draft, sourceWall.id, scenario.openingType);
    floor = surveyGraph.getActiveFloor(draft);
    const openingId = floor.openings.at(-1).id;
    draft = surveyGraph.updateOpening(draft, openingId, { centerOffsetMm: 1200 });
    floor = surveyGraph.getActiveFloor(draft);
    const openingBefore = floor.openings.find((opening) => opening.id === openingId);
    const wallBefore = surveyGraph.getWall(floor, openingBefore.wallId);
    const absoluteBefore = openingBefore.centerOffsetMm + (wallBefore.measurementStartInsetMm || 0);
    const targetPoint = wallTargetPoint(floor, sourceWall, scenario.snapFace);
    const target = surveyGraph.getCursorPlacementTarget(
      floor,
      targetPoint,
      surveyGraph.CLOSE_TOLERANCE_MM
    );
    draft = surveyGraph.snapCursorToWall(
      surveyGraph.startWallSnap(draft),
      target.pointMm,
      target
    );
    draft = commitPreview(draft, rotatePoint({ xMm: 3000, yMm: -1800 }, scenario.rotation));
    floor = surveyGraph.getActiveFloor(draft);
    const openingAfter = floor.openings.find((opening) => opening.id === openingId);
    const wallAfter = surveyGraph.getWall(floor, openingAfter.wallId);
    const sourceSegments = splitSourceSegments(floor, sourceWall.id);
    const segmentStartAlongMm = sourceSegments
      .filter((wall) => wall.id !== sourceWall.id && wall.id === wallAfter.id)
      .length ? 3000 : 0;
    assert.equal(
      segmentStartAlongMm + openingAfter.centerOffsetMm + (wallAfter.measurementStartInsetMm || 0),
      absoluteBefore
    );
    assert.equal(createScene(draft).openings.length, 1);
  });
  assertMatrixPassed(failures, cases, 'opening-remap T scenarios');
});

test('formal save and restore preserves T topology and its rendered solid', () => {
  const cases = ROTATIONS.flatMap((rotation) => SNAP_FACES.map((snapFace) => ({
    sourceType: 'closed',
    rotation,
    thicknessMm: 200,
    measurementSide: 'left',
    snapFace,
    branchDirection: 'negative',
    allowInitialSolidGap: true,
    label: `rotation=${rotation * 90}, snap=${snapFace}`
  })));
  const failures = collectMatrixFailures(cases, (scenario) => {
    const result = executeTScenario(scenario);
    const layout = surveyLayout.createFormalSurveyLayout(result.draft, 'draft');
    const restoredGraph = JSON.parse(JSON.stringify(layout)).surveyGraph;
    const originalFloor = surveyGraph.getActiveFloor(result.draft);
    const restoredFloor = surveyGraph.getActiveFloor(restoredGraph);
    assert.deepEqual(restoredFloor.nodes, originalFloor.nodes);
    assert.deepEqual(restoredFloor.walls, originalFloor.walls);
    assert.deepEqual(restoredFloor.spaces, originalFloor.spaces);
    assert.deepEqual(restoredFloor.openings, originalFloor.openings);
    assert.deepEqual(createScene(restoredGraph).wallSolidPlan, createScene(result.draft).wallSolidPlan);
  });
  assertMatrixPassed(failures, cases, 'formal T save/restore scenarios');
});

test('fixed-seed exterior T replay keeps varied rectangular boundaries solid', () => {
  let seed = 0x51f15e;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const cases = Array.from({ length: 120 }, (_, index) => {
    const widthMm = 2600 + Math.round(random() * 7400);
    const heightMm = 2200 + Math.round(random() * 5800);
    const junctionRatio = 0.2 + random() * 0.6;
    return {
      index,
      widthMm,
      heightMm,
      junctionRatio,
      rotation: Math.floor(random() * 4),
      thicknessMm: THICKNESSES_MM[Math.floor(random() * THICKNESSES_MM.length)],
      branchThicknessMm: THICKNESSES_MM[Math.floor(random() * THICKNESSES_MM.length)],
      measurementSide: MEASUREMENT_SIDES[Math.floor(random() * MEASUREMENT_SIDES.length)],
      snapFace: SNAP_FACES[Math.floor(random() * SNAP_FACES.length)],
      branchDirection: random() < 0.5 ? 'negative' : 'positive',
      label: `seed-case=${index}, width=${widthMm}, height=${heightMm}, ratio=${junctionRatio.toFixed(3)}`
    };
  });
  const failures = collectMatrixFailures(cases, (scenario) => {
    let draft = createClosedRectangleDraft(scenario);
    let floor = surveyGraph.getActiveFloor(draft);
    const sourceWall = floor.walls[0];
    const beforeSourceScene = createScene(draft).walls.find((wall) => wall.id === sourceWall.id);
    const innerStart = surveyGraph.getNode(floor, sourceWall.startNodeId);
    const innerEnd = surveyGraph.getNode(floor, sourceWall.endNodeId);
    const geometry = surveyGraph.buildWallRenderGeometry(floor, sourceWall);
    const start = scenario.snapFace === 'outer' ? geometry.outerStart : innerStart;
    const end = scenario.snapFace === 'outer' ? geometry.outerEnd : innerEnd;
    const targetPoint = {
      xMm: Math.round(start.xMm + (end.xMm - start.xMm) * scenario.junctionRatio),
      yMm: Math.round(start.yMm + (end.yMm - start.yMm) * scenario.junctionRatio)
    };
    const target = surveyGraph.getCursorPlacementTarget(
      floor,
      targetPoint,
      surveyGraph.CLOSE_TOLERANCE_MM
    );
    draft = surveyGraph.setThickness(draft, scenario.branchThicknessMm);
    draft = surveyGraph.snapCursorToWall(
      surveyGraph.startWallSnap(draft),
      target.pointMm,
      target
    );
    const canonicalEnd = {
      xMm: Math.round(scenario.widthMm * scenario.junctionRatio),
      yMm: scenario.branchDirection === 'negative' ? -1800 : 1800
    };
    draft = commitPreview(draft, rotatePoint(canonicalEnd, scenario.rotation));
    floor = surveyGraph.getActiveFloor(draft);
    assert.equal(splitSourceSegments(floor, sourceWall.id).length, 2);
    const scene = createScene(draft);
    const missingSamples = sourceJunctionSamples(
      beforeSourceScene,
      scenario.thicknessMm,
      scenario.junctionRatio,
      scenario.widthMm
    ).filter((sample) => !pointInSolid(sample, scene.wallSolidPlan));
    assert.equal(missingSamples.length, 0, `varied boundary lost ${missingSamples.length} samples`);
  });
  assertMatrixPassed(failures, cases, 'fixed-seed T replay scenarios');
});

test('reset endpoint matrix matches uninterrupted L-corner continuation', () => {
  const cases = [];
  ROTATIONS.forEach((rotation) => {
    THICKNESSES_MM.forEach((thicknessMm) => {
      SNAP_FACES.forEach((snapFace) => {
        BRANCH_DIRECTIONS.forEach((turnDirection) => {
          cases.push({
            rotation,
            thicknessMm,
            measurementSide: 'left',
            snapFace,
            turnDirection,
            label: `rotation=${rotation * 90}, thickness=${thicknessMm}, snap=${snapFace}, turn=${turnDirection}`
          });
        });
      });
    });
  });
  const failures = collectMatrixFailures(cases, (scenario) => {
    let draft = createClosedRectangleDraft(scenario);
    let floor = surveyGraph.getActiveFloor(draft);
    const corner = rotatePoint({ xMm: 0, yMm: 4000 }, scenario.rotation);
    const cornerTarget = surveyGraph.getCursorPlacementTarget(
      floor,
      corner,
      surveyGraph.CLOSE_TOLERANCE_MM
    );
    draft = surveyGraph.snapCursorToWall(
      surveyGraph.startWallSnap(draft),
      cornerTarget.pointMm,
      cornerTarget
    );
    const extensionEnd = rotatePoint({ xMm: -2200, yMm: 4000 }, scenario.rotation);
    draft = commitPreview(draft, extensionEnd);
    floor = surveyGraph.getActiveFloor(draft);
    const sourceWall = floor.walls.at(-1);
    const sourceEnd = surveyGraph.getNode(floor, sourceWall.endNodeId);
    const sourceOuterEnd = surveyGraph.buildWallRenderGeometry(floor, sourceWall).outerEnd;
    const turnEnd = rotatePoint({
      xMm: -2200,
      yMm: scenario.turnDirection === 'negative' ? 1800 : 6200
    }, scenario.rotation);

    const uninterruptedDraft = commitPreview(draft, turnEnd);
    const uninterruptedFloor = surveyGraph.getActiveFloor(uninterruptedDraft);
    const uninterruptedSource = surveyGraph.getWall(uninterruptedFloor, sourceWall.id);
    const uninterruptedBranch = uninterruptedFloor.walls.at(-1);

    const targetPoint = scenario.snapFace === 'outer' ? sourceOuterEnd : sourceEnd;
    const target = surveyGraph.getCursorPlacementTarget(
      floor,
      targetPoint,
      surveyGraph.CLOSE_TOLERANCE_MM
    );
    assert.equal(target.type, 'vertex');
    assert.equal(target.snapLine || 'inner', scenario.snapFace);
    let resetDraft = surveyGraph.snapCursorToWall(
      surveyGraph.startWallSnap(draft),
      target.pointMm,
      target
    );
    resetDraft = commitPreview(resetDraft, turnEnd);
    const resetFloor = surveyGraph.getActiveFloor(resetDraft);
    const resetSource = surveyGraph.getWall(resetFloor, sourceWall.id);
    const resetBranch = resetFloor.walls.at(-1);

    assert.deepEqual(
      {
        lengthMm: resetSource.lengthMm,
        startInset: resetSource.measurementStartInsetMm || 0,
        endInset: resetSource.measurementEndInsetMm || 0
      },
      {
        lengthMm: uninterruptedSource.lengthMm,
        startInset: uninterruptedSource.measurementStartInsetMm || 0,
        endInset: uninterruptedSource.measurementEndInsetMm || 0
      }
    );
    assert.deepEqual(
      normalizeWallResult(resetFloor, resetBranch),
      normalizeWallResult(uninterruptedFloor, uninterruptedBranch)
    );
  });
  assertMatrixPassed(failures, cases, 'reset-continuation scenarios');
});

test('cross-junction matrix keeps both traversing wall bodies continuous', () => {
  const cases = ROTATIONS.flatMap((rotation) => (
    THICKNESSES_MM.flatMap((thicknessMm) => (
      MEASUREMENT_SIDES.map((measurementSide) => ({
        rotation,
        thicknessMm,
        measurementSide,
        label: `rotation=${rotation * 90}, thickness=${thicknessMm}, side=${measurementSide}`
      }))
    ))
  ));
  const failures = collectMatrixFailures(cases, (scenario) => {
    let draft = createOpenWallDraft(scenario);
    let floor = surveyGraph.getActiveFloor(draft);
    const sourceWall = floor.walls[0];
    const beforeSourceScene = createScene(draft).walls[0];
    const midpointTarget = wallTargetPoint(floor, sourceWall, 'inner');
    const target = surveyGraph.getCursorPlacementTarget(
      floor,
      midpointTarget,
      surveyGraph.CLOSE_TOLERANCE_MM
    );
    draft = surveyGraph.snapCursorToWall(
      surveyGraph.startWallSnap(draft),
      target.pointMm,
      target
    );
    floor = surveyGraph.getActiveFloor(draft);
    const junctionNodeId = floor.session.anchorNodeId;
    draft = commitPreview(draft, rotatePoint({ xMm: 0, yMm: -1800 }, scenario.rotation));
    floor = surveyGraph.getActiveFloor(draft);
    const junction = surveyGraph.getNode(floor, junctionNodeId);
    const junctionTarget = surveyGraph.getCursorPlacementTarget(
      floor,
      junction,
      surveyGraph.CLOSE_TOLERANCE_MM
    );
    draft = surveyGraph.snapCursorToWall(
      surveyGraph.startWallSnap(draft),
      junctionTarget.pointMm,
      junctionTarget
    );
    draft = commitPreview(draft, rotatePoint({ xMm: 0, yMm: 1800 }, scenario.rotation));
    floor = surveyGraph.getActiveFloor(draft);
    const degree = floor.walls.filter((wall) => (
      wall.startNodeId === junctionNodeId || wall.endNodeId === junctionNodeId
    )).length;
    assert.equal(degree, 4);
    const scene = createScene(draft);
    const junctionPoint = projectPoint(junction, scene.viewport);
    assert.equal(pointInSolid(junctionPoint, scene.wallSolidPlan), true, 'cross center is empty');
    const missingSourceSamples = sourceJunctionSamples(beforeSourceScene, scenario.thicknessMm)
      .filter((sample) => !pointInSolid(sample, scene.wallSolidPlan));
    assert.equal(missingSourceSamples.length, 0, `cross source lost ${missingSourceSamples.length} samples`);
  });
  assertMatrixPassed(failures, cases, 'cross-junction scenarios');
});

test('deleting one cross branch recomputes the remaining T measurement inset', () => {
  const cases = ROTATIONS.flatMap((rotation) => (
    THICKNESSES_MM.flatMap((thicknessMm) => (
      MEASUREMENT_SIDES.map((measurementSide) => ({
        sourceType: 'open',
        rotation,
        thicknessMm,
        measurementSide,
        snapFace: 'inner',
        branchDirection: 'negative',
        label: `rotation=${rotation * 90}, thickness=${thicknessMm}, side=${measurementSide}`
      }))
    ))
  ));
  const failures = collectMatrixFailures(cases, (scenario) => {
    const baseline = executeTScenario(scenario);
    const baselineFloor = surveyGraph.getActiveFloor(baseline.draft);
    const expectedInsets = splitSourceSegments(baselineFloor, baseline.sourceWallId)
      .map((wall) => (
        wall.startNodeId === baseline.junctionNodeId
          ? wall.measurementStartInsetMm || 0
          : wall.measurementEndInsetMm || 0
      ))
      .sort((first, second) => first - second);

    let draft = baseline.draft;
    let floor = surveyGraph.getActiveFloor(draft);
    const junction = surveyGraph.getNode(floor, baseline.junctionNodeId);
    const target = surveyGraph.getCursorPlacementTarget(
      floor,
      junction,
      surveyGraph.CLOSE_TOLERANCE_MM
    );
    draft = surveyGraph.snapCursorToWall(
      surveyGraph.startWallSnap(draft),
      target.pointMm,
      target
    );
    draft = commitPreview(draft, rotatePoint({ xMm: 0, yMm: 1800 }, scenario.rotation));
    floor = surveyGraph.getActiveFloor(draft);
    const addedBranch = floor.walls.at(-1);
    draft = surveyGraph.deleteWall(draft, addedBranch.id);
    floor = surveyGraph.getActiveFloor(draft);
    const actualInsets = splitSourceSegments(floor, baseline.sourceWallId)
      .map((wall) => (
        wall.startNodeId === baseline.junctionNodeId
          ? wall.measurementStartInsetMm || 0
          : wall.measurementEndInsetMm || 0
      ))
      .sort((first, second) => first - second);
    assert.deepEqual(actualInsets, expectedInsets);
    assert.equal(
      floor.walls.filter((wall) => (
        wall.startNodeId === baseline.junctionNodeId || wall.endNodeId === baseline.junctionNodeId
      )).length,
      3
    );
    const missingSamples = sourceJunctionSamples(
      baseline.beforeSourceScene,
      scenario.thicknessMm
    ).filter((sample) => !pointInSolid(sample, createScene(draft).wallSolidPlan));
    assert.equal(missingSamples.length, 0);
  });
  assertMatrixPassed(failures, cases, 'cross-delete scenarios');
});
