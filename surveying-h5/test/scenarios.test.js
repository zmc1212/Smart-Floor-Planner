const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');
const surveyGraph = require(path.join(root, 'miniprogram/packages/surveying/utils/surveyWallGraph.js'));
const surveyCanvasRenderer = require(path.join(root, 'miniprogram/packages/surveying/utils/surveyCanvasRenderer.js'));
const { CATEGORY_ORDER, createScenarioCatalog } = require('../src/scenarios.js');

const catalog = createScenarioCatalog(surveyGraph);

function commitMeasuredWall(draft, point, lengthMm) {
  return surveyGraph.commitPreviewLength(
    surveyGraph.startPreview(draft, point),
    lengthMm,
    'h5-regression'
  );
}

function createMeasuredTClosureDraft(snapLine) {
  const rectangleScenario = catalog.find((entry) => entry.key === 'rectangle');
  let draft = rectangleScenario.build();
  let floor = surveyGraph.getActiveFloor(draft);
  const sourceWall = floor.walls[0];
  const sourceStart = surveyGraph.getNode(floor, sourceWall.startNodeId);
  const sourceEnd = surveyGraph.getNode(floor, sourceWall.endNodeId);
  const sourceGeometry = surveyGraph.buildWallSnapGeometry(floor, sourceWall);
  const targetPoint = snapLine === 'outer'
    ? {
      xMm: Math.round((sourceGeometry.outerStart.xMm + sourceGeometry.outerEnd.xMm) / 2),
      yMm: Math.round((sourceGeometry.outerStart.yMm + sourceGeometry.outerEnd.yMm) / 2)
    }
    : {
      xMm: Math.round((sourceStart.xMm + sourceEnd.xMm) / 2),
      yMm: Math.round((sourceStart.yMm + sourceEnd.yMm) / 2)
    };
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    targetPoint,
    surveyGraph.CLOSE_TOLERANCE_MM
  );

  draft = surveyGraph.snapCursorToWall(surveyGraph.startWallSnap(draft), target.pointMm, target);
  draft = commitMeasuredWall(draft, { xMm: 2000, yMm: -2200 }, 2000);
  draft = commitMeasuredWall(draft, { xMm: 3582, yMm: -2200 }, 1582);
  floor = surveyGraph.getActiveFloor(draft);
  const lengthsBeforeClosingWall = floor.walls
    .slice(floor.session.activeSpaceStartWallIndex)
    .map((wall) => wall.lengthMm);
  draft = commitMeasuredWall(draft, { xMm: 3582, yMm: 0 }, 2000);

  return { draft, lengthsBeforeClosingWall };
}

test('scenario catalog covers the supported measurement topology families', () => {
  assert.equal(catalog.length, 39);
  assert.deepEqual([...new Set(catalog.map((scenario) => scenario.category))], CATEGORY_ORDER);
  assert.equal(new Set(catalog.map((scenario) => scenario.key)).size, catalog.length);
  ['rectangle', 'l-shape', 'open-chain', 'adjacent-rooms', 't-junction', 'partition']
    .forEach((legacyKey) => assert.ok(catalog.some((scenario) => scenario.key === legacyKey)));
});

catalog.forEach((scenario) => {
  test(`scenario ${scenario.key} builds a valid production wall graph`, () => {
    const draft = scenario.build();
    const floor = surveyGraph.getActiveFloor(draft);
    const actual = {
      walls: floor.walls.length,
      spaces: floor.spaces.filter((space) => space.closed).length,
      openings: floor.openings.length
    };
    assert.deepEqual(actual, scenario.expected);
    assert.equal(surveyGraph.validateSurveyDraft(draft, { mode: 'full' }).valid, true);
  });
});

test('the supplied staggered two-room reference preserves its measured room dimensions', () => {
  const scenario = catalog.find((entry) => entry.key === 'staggered-adjacent');
  const draft = scenario.build();
  const floor = surveyGraph.getActiveFloor(draft);
  const dimensions = floor.spaces
    .filter((space) => space.closed)
    .map((space) => surveyGraph.buildSpaceDimensionPlan(floor, space).inner)
    .map(({ widthMm, heightMm }) => ({ widthMm, heightMm }))
    .sort((first, second) => first.widthMm - second.widthMm);

  assert.deepEqual(dimensions, [
    { widthMm: 2761, heightMm: 3223 },
    { widthMm: 3082, heightMm: 4120 }
  ]);
});

test('the T-shaped layout closes adjacent rooms through shared boundaries', () => {
  const scenario = catalog.find((entry) => entry.key === 'three-room-t');
  const floor = surveyGraph.getActiveFloor(scenario.build());
  const junction = floor.nodes.find((node) => node.xMm === 3000 && node.yMm === 2400);
  const junctionWalls = floor.walls.filter((wall) => (
    wall.startNodeId === junction.id || wall.endNodeId === junction.id
  ));
  const endpointKeys = floor.walls.map((wall) => [wall.startNodeId, wall.endNodeId].sort().join(':'));

  assert.equal(junctionWalls.length, 3);
  assert.equal(new Set(endpointKeys).size, floor.walls.length);
  assert.equal(floor.spaces.filter((space) => space.closed).length, 3);
});

test('the H5 inner- and outer-start T replays use one branch-local working face', () => {
  const innerScenario = catalog.find((entry) => entry.key === 't-junction');
  const outerScenario = catalog.find((entry) => entry.key === 'outer-start-t-junction');
  const innerFloor = surveyGraph.getActiveFloor(innerScenario.build());
  const outerFloor = surveyGraph.getActiveFloor(outerScenario.build());
  const innerBranch = innerFloor.walls.at(-1);
  const outerBranch = outerFloor.walls.at(-1);
  const render = (floor) => surveyCanvasRenderer.createSurveyRenderScene({
    floor,
    session: floor.session,
    viewport: floor.viewport,
    rect: { width: 800, height: 800 }
  });
  const innerScene = render(innerFloor);
  const outerScene = render(outerFloor);
  const innerRenderedBranch = innerScene.walls.find((wall) => wall.id === innerBranch.id);
  const outerRenderedBranch = outerScene.walls.find((wall) => wall.id === outerBranch.id);

  assert.equal(innerBranch.measurementStartInsetMm, 200);
  assert.equal(outerBranch.measurementStartInsetMm, 200);
  assert.equal(innerBranch.lengthMm, 2000);
  assert.equal(outerBranch.lengthMm, 2000);
  assert.equal(innerRenderedBranch.measurementFace, 'inner');
  assert.equal(outerRenderedBranch.measurementFace, 'inner');
  assert.deepEqual(innerRenderedBranch.measurementStartPoint, innerRenderedBranch.startPoint);
  assert.deepEqual(outerRenderedBranch.measurementStartPoint, outerRenderedBranch.startPoint);
  assert.equal(innerFloor.session.activeSpaceSharedSnapLine, 'inner');
  assert.equal(outerFloor.session.activeSpaceSharedSnapLine, 'outer');
});

test('the H5 outer-T rightward replay keeps one continuous branch face and body side', () => {
  const scenario = catalog.find((entry) => entry.key === 'outer-t-rightward-continuation');
  const floor = surveyGraph.getActiveFloor(scenario.build());
  const scene = surveyCanvasRenderer.createSurveyRenderScene({
    floor,
    session: floor.session,
    viewport: floor.viewport,
    rect: { width: 800, height: 800 }
  });
  const activeWalls = scene.walls.filter((wall) => wall.isActiveMeasurement);
  const rightwardWall = activeWalls.at(-1);

  assert.equal(floor.session.activeSpaceSharedSnapLine, 'outer');
  assert.equal(activeWalls.length, 2);
  assert.equal(activeWalls[0].measurementFace, 'inner');
  assert.equal(rightwardWall.measurementFace, 'inner');
  assert.equal(rightwardWall.wall.lengthMm, 3200);
  assert.equal(activeWalls[0].outerStart.x > activeWalls[0].startPoint.x, true);
  assert.equal(rightwardWall.outerStart.y > rightwardWall.startPoint.y, true);
  assert.equal(scene.previewWall.measurementFace, 'inner');
  assert.equal(scene.previewWall.outerStart.x < scene.previewWall.startPoint.x, true);
  assert.deepEqual(activeWalls[0].measurementEndPoint, rightwardWall.measurementStartPoint);
  assert.deepEqual(rightwardWall.measurementEndPoint, scene.previewWall.measurementStartPoint);
  assert.deepEqual(scene.previewWall.measurementEndPoint, scene.previewWall.endPoint);
  assert.deepEqual(scene.cursor.point, scene.previewWall.endPoint);
});

test('the H5 outer-T rightward preview does not flip its confirmed first wall', () => {
  const scenario = catalog.find((entry) => entry.key === 'outer-t-rightward-preview');
  const floor = surveyGraph.getActiveFloor(scenario.build());
  const scene = surveyCanvasRenderer.createSurveyRenderScene({
    floor,
    session: floor.session,
    viewport: floor.viewport,
    rect: { width: 800, height: 800 }
  });
  const firstWall = scene.walls.find((wall) => wall.isActiveMeasurement);

  assert.equal(firstWall.measurementFace, 'inner');
  assert.equal(floor.session.previewLengthMm, 1800);
  assert.equal(firstWall.outerStart.x > firstWall.startPoint.x, true);
  assert.equal(scene.previewWall.outerStart.y > scene.previewWall.startPoint.y, true);
  assert.equal(scene.previewWall.measurementFace, 'inner');
  assert.equal(scene.previewWall.measurementStartPoint.y, scene.previewWall.startPoint.y);
  assert.deepEqual(scene.previewWall.measurementStartPoint, firstWall.measurementEndPoint);
  assert.deepEqual(scene.previewWall.measurementEndPoint, scene.previewWall.endPoint);
  assert.deepEqual(scene.cursor.point, scene.previewWall.endPoint);
});

test('the H5 inner-T rightward replay inherits the first wall local body side', () => {
  const scenario = catalog.find((entry) => entry.key === 'inner-t-rightward-continuation');
  const floor = surveyGraph.getActiveFloor(scenario.build());
  const scene = surveyCanvasRenderer.createSurveyRenderScene({
    floor,
    session: floor.session,
    viewport: floor.viewport,
    rect: { width: 800, height: 800 }
  });
  const activeWalls = scene.walls.filter((wall) => wall.isActiveMeasurement);
  const rightwardWall = activeWalls.at(-1);

  assert.equal(floor.session.activeSpaceSharedSnapLine, 'inner');
  assert.equal(activeWalls[0].measurementFace, 'inner');
  assert.equal(rightwardWall.measurementFace, 'inner');
  assert.equal(activeWalls[0].outerStart.x > activeWalls[0].startPoint.x, true);
  assert.deepEqual(rightwardWall.measurementStartPoint, rightwardWall.startPoint);
  assert.equal(rightwardWall.outerStart.y > rightwardWall.startPoint.y, true);
  assert.equal(scene.previewWall.measurementFace, 'inner');
  assert.equal(scene.previewWall.outerStart.x < scene.previewWall.startPoint.x, true);
  assert.deepEqual(scene.previewWall.measurementStartPoint, scene.previewWall.startPoint);
});

test('the H5 inner-T rightward preview does not flip its confirmed first wall', () => {
  const scenario = catalog.find((entry) => entry.key === 'inner-t-rightward-preview');
  const floor = surveyGraph.getActiveFloor(scenario.build());
  const scene = surveyCanvasRenderer.createSurveyRenderScene({
    floor,
    session: floor.session,
    viewport: floor.viewport,
    rect: { width: 800, height: 800 }
  });
  const firstWall = scene.walls.find((wall) => wall.isActiveMeasurement);

  assert.equal(firstWall.outerStart.x > firstWall.startPoint.x, true);
  assert.equal(scene.previewWall.outerStart.y > scene.previewWall.startPoint.y, true);
  assert.deepEqual(scene.previewWall.measurementStartPoint, scene.previewWall.startPoint);
});

test('the H5 leftward T replays retain the same branch-local working face and body side', () => {
  [
    ['outer-t-leftward-continuation', 'inner'],
    ['inner-t-leftward-continuation', 'inner']
  ].forEach(([key, expectedFirstFace]) => {
    const scenario = catalog.find((entry) => entry.key === key);
    const floor = surveyGraph.getActiveFloor(scenario.build());
    const scene = surveyCanvasRenderer.createSurveyRenderScene({
      floor,
      session: floor.session,
      viewport: floor.viewport,
      rect: { width: 800, height: 800 }
    });
    const continuation = scene.walls.filter((wall) => wall.isActiveMeasurement).at(-1);
    const firstWall = scene.walls.filter((wall) => wall.isActiveMeasurement)[0];

    assert.equal(firstWall.measurementFace, expectedFirstFace, key);
    assert.equal(continuation.measurementFace, 'inner', key);
    assert.equal(continuation.measurementStartPoint.y, continuation.startPoint.y, key);
    assert.equal(continuation.outerStart.y > continuation.startPoint.y, false, key);
    assert.equal(firstWall.outerStart.x > firstWall.startPoint.x, true, key);
    assert.equal(scene.previewWall.measurementFace, 'inner', key);
    assert.equal(
      scene.previewWall.outerStart.x < scene.previewWall.startPoint.x,
      true,
      key
    );
    assert.deepEqual(scene.cursor.point, scene.previewWall.endPoint, key);
  });
});

test('the H5 T closure replay keeps confirmed lengths stable for inner and outer starts', () => {
  ['inner', 'outer'].forEach((snapLine) => {
    const result = createMeasuredTClosureDraft(snapLine);
    const floor = surveyGraph.getActiveFloor(result.draft);
    const activeWalls = floor.walls.slice(-3);

    assert.deepEqual(result.lengthsBeforeClosingWall, [2000, 1582], snapLine);
    assert.deepEqual(activeWalls.map((wall) => wall.lengthMm), [2000, 1582, 2000], snapLine);
  });
});

test('the H5 inner- and outer-start closures keep their final wall left of the orange line', () => {
  ['inner-start-inner-face-closure', 'outer-start-inner-face-closure'].forEach((key) => {
    const scenario = catalog.find((entry) => entry.key === key);
    const floor = surveyGraph.getActiveFloor(scenario.build());
    const closingWall = floor.walls.find((wall) => {
      const start = surveyGraph.getNode(floor, wall.startNodeId);
      const end = surveyGraph.getNode(floor, wall.endNodeId);
      return start.xMm === 6000 && end.xMm === 6000 && start.yMm === -2000;
    });

    assert.ok(closingWall, key);
    const geometry = surveyGraph.buildWallRenderGeometry(floor, closingWall);
    assert.equal(closingWall.bodyNormalSide, 'right', key);
    assert.equal(geometry.outerStart.xMm, 5800, key);
    assert.equal(geometry.outerEnd.xMm, 5800, key);
    const newRoom = floor.spaces.filter((space) => space.closed).at(-1);
    assert.deepEqual(surveyGraph.buildSpaceDimensionPlan(floor, newRoom).inner, {
      widthMm: 2600,
      heightMm: 1600,
      areaMm2: 4160000
    }, key);
  });
});

test('the H5 outer-face corner merge keeps the final wall left of the orange line', () => {
  const scenario = catalog.find((entry) => entry.key === 'outer-face-corner-merge-closure');
  const floor = surveyGraph.getActiveFloor(scenario.build());
  const closingWall = floor.walls.find((wall) => {
    const start = surveyGraph.getNode(floor, wall.startNodeId);
    const end = surveyGraph.getNode(floor, wall.endNodeId);
    return start.xMm === 6200 && end.xMm === 6200 && start.yMm === -2000 && end.yMm === 0;
  });

  assert.ok(closingWall);
  const geometry = surveyGraph.buildWallRenderGeometry(floor, closingWall);
  assert.equal(closingWall.bodyNormalSide, 'right');
  assert.equal(geometry.outerStart.xMm, 6000);
  assert.equal(geometry.outerEnd.xMm, 6000);
  const newRoom = floor.spaces.filter((space) => space.closed).at(-1);
  assert.deepEqual(surveyGraph.buildSpaceDimensionPlan(floor, newRoom).inner, {
    widthMm: 2800,
    heightMm: 1600,
    areaMm2: 4480000
  });
});

test('the outer-start T replay keeps the aligned closing wall on its preview coordinates', () => {
  const scenario = catalog.find((entry) => entry.key === 'outer-start-t-junction');
  let draft = scenario.build();
  let floor = surveyGraph.getActiveFloor(draft);

  assert.equal(floor.walls.at(-1).lengthMm, 2000);
  draft = surveyGraph.startPreview(draft, { xMm: 6200, yMm: -2200 });
  floor = surveyGraph.getActiveFloor(draft);
  draft = surveyGraph.commitPreviewLength(draft, floor.session.previewLengthMm, 'h5-regression');
  draft = surveyGraph.startPreview(draft, { xMm: 6200, yMm: 100 });
  floor = surveyGraph.getActiveFloor(draft);

  assert.equal(floor.walls.at(-1).lengthMm, 3200);
  assert.deepEqual(floor.session.previewPoint, { xMm: 6200, yMm: 0 });
  assert.equal(floor.session.closeCandidateType, 'merge');

  const previewScene = surveyCanvasRenderer.createSurveyRenderScene({
    floor,
    session: floor.session,
    viewport: floor.viewport,
    rect: { width: 800, height: 800 }
  });
  const previewWall = previewScene.previewWall;

  draft = surveyGraph.confirmClosure(draft);
  floor = surveyGraph.getActiveFloor(draft);
  const closedScene = surveyCanvasRenderer.createSurveyRenderScene({
    floor,
    session: floor.session,
    viewport: floor.viewport,
    rect: { width: 800, height: 800 }
  });
  const closingWall = floor.walls.find((wall) => {
    const start = surveyGraph.getNode(floor, wall.startNodeId);
    const end = surveyGraph.getNode(floor, wall.endNodeId);
    return start.xMm === 6200 && end.xMm === 6200 && start.yMm === -2200 && end.yMm === 0;
  });

  assert.ok(closingWall);
  const closedWall = closedScene.walls.find((wall) => wall.id === closingWall.id);
  assert.ok(closedWall);
  assert.deepEqual(closedWall.startPoint, previewWall.startPoint);
  assert.deepEqual(closedWall.endPoint, previewWall.endPoint);
  assert.deepEqual(closedWall.outerStart, previewWall.outerStart);
  // Closure may extend the opposite-face endpoint vertically to miter the
  // source wall, but neither edge may move sideways by one wall thickness.
  assert.equal(closedWall.outerEnd.x, previewWall.outerEnd.x);
  assert.equal(closingWall.bodyNormalSide, 'right');
  const newRoom = floor.spaces.filter((space) => space.closed).at(-1);
  assert.deepEqual(surveyGraph.buildSpaceDimensionPlan(floor, newRoom).inner, {
    widthMm: 2800,
    heightMm: 1800,
    areaMm2: 5040000
  });
});
