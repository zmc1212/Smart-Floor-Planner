const test = require('node:test');
const assert = require('node:assert/strict');
const surveyGraph = require('../utils/surveyWallGraph.js');
const surveyCanvasRenderer = require('../utils/surveyCanvasRenderer.js');

function commitWall(draft, point, length) {
  return surveyGraph.commitPreviewLength(
    surveyGraph.startPreview(draft, point),
    length,
    'manual'
  );
}

function createOpenDraft() {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  draft = commitWall(draft, { xMm: 3000, yMm: 0 }, 3000);
  return commitWall(draft, { xMm: 3000, yMm: 2000 }, 2000);
}

function createClosedRectangleDraft() {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  draft = commitWall(draft, { xMm: 3000, yMm: 0 }, 3000);
  draft = commitWall(draft, { xMm: 3000, yMm: 2000 }, 2000);
  draft = commitWall(draft, { xMm: 0, yMm: 2000 }, 3000);
  draft = commitWall(draft, { xMm: 0, yMm: 0 }, 2000);
  return surveyGraph.confirmClosure(draft);
}

function createTwoClosedRoomsWithSharedDoorDraft() {
  const draft = surveyGraph.createSurveyDraft();
  const floor = surveyGraph.getActiveFloor(draft);
  floor.nodes = [
    { id: 'a', xMm: 0, yMm: 0 },
    { id: 'b', xMm: 3000, yMm: 0 },
    { id: 'c', xMm: 3000, yMm: 2000 },
    { id: 'd', xMm: 0, yMm: 2000 },
    { id: 'e', xMm: 6000, yMm: 0 },
    { id: 'f', xMm: 6000, yMm: 2000 }
  ];
  floor.walls = [
    ['wall-1', 'a', 'b', 3000, 0],
    ['wall-2', 'b', 'c', 2000, 90],
    ['wall-3', 'c', 'd', 3000, 180],
    ['wall-4', 'd', 'a', 2000, -90],
    ['wall-5', 'b', 'e', 3000, 0],
    ['wall-6', 'e', 'f', 2000, 90],
    ['wall-7', 'f', 'c', 3000, 180]
  ].map(([id, startNodeId, endNodeId, lengthMm, angleDeg]) => ({
    id,
    startNodeId,
    endNodeId,
    mode: 'straight',
    lengthMm,
    angleDeg,
    thicknessMm: 200,
    measurementSide: 'left'
  }));
  floor.spaces = [
    { id: 'space-1', name: '左侧房间', wallIds: ['wall-1', 'wall-2', 'wall-3', 'wall-4'], closed: true },
    { id: 'space-2', name: '右侧房间', wallIds: ['wall-5', 'wall-6', 'wall-7', 'wall-2'], closed: true }
  ];
  floor.openings = [{
    id: 'opening-shared',
    wallId: 'wall-2',
    type: 'door',
    centerOffsetMm: 1000,
    widthMm: 900,
    heightMm: 2100,
    sillHeightMm: 0,
    depthMm: 200
  }];
  floor.session.state = 'spaceClosed';
  floor.session.activeSpaceStartWallIndex = floor.walls.length;
  return draft;
}

function createScene(draft) {
  const floor = surveyGraph.getActiveFloor(draft);
  return surveyCanvasRenderer.createSurveyRenderScene({
    floor,
    session: floor.session,
    viewport: floor.viewport,
    rect: { width: 400, height: 400 }
  });
}

function createRecordingContext() {
  const strokes = [];
  const fills = [];
  const dashes = [];
  const widths = [];
  let path = [];

  const context = {
    save() {},
    restore() {},
    setTransform() {},
    clearRect() {},
    fillRect() {},
    strokeRect() {},
    translate() {},
    scale() {},
    rotate() {},
    arc() { path.push(['arc']); },
    quadraticCurveTo() { path.push(['quadraticCurveTo']); },
    beginPath() { path = []; },
    moveTo(x, y) { path.push(['moveTo', x, y]); },
    lineTo(x, y) { path.push(['lineTo', x, y]); },
    closePath() { path.push(['closePath']); },
    stroke() { strokes.push(path.slice()); },
    fill() { fills.push(path.slice()); },
    setLineDash(value) { dashes.push(value.slice()); },
    measureText(text) { return { width: String(text).length * 7 }; },
    fillText() {}
  };

  Object.defineProperty(context, 'lineWidth', {
    set(value) { widths.push(value); },
    get() { return widths[widths.length - 1]; }
  });
  ['fillStyle', 'strokeStyle', 'lineCap', 'lineJoin', 'font', 'textAlign', 'textBaseline', 'shadowColor', 'shadowBlur', 'shadowOffsetY', 'miterLimit']
    .forEach((property) => Object.defineProperty(context, property, { set() {}, get() { return undefined; } }));

  return { context, strokes, fills, dashes, widths };
}

test('open wall chain renders only inner dimensions and keeps its full chain red', () => {
  const draft = createOpenDraft();
  const floor = surveyGraph.getActiveFloor(draft);
  const scene = createScene(draft);

  assert.equal(scene.dimensions.length, floor.walls.length);
  assert.deepEqual(scene.dimensions.map((dimension) => dimension.kind), ['inner', 'inner']);
  assert.equal(scene.dimensions.every((dimension) => dimension.placement === 'inside'), true);
  assert.deepEqual(scene.activeMeasurementWallIds, floor.walls.map((wall) => wall.id));

  const previewDraft = surveyGraph.startPreview(draft, { xMm: 0, yMm: 2000 });
  const previewScene = createScene(previewDraft);
  assert.equal(previewScene.dimensions.length, floor.walls.length);
  assert.equal(previewScene.dimensions.some((dimension) => dimension.wall.id === 'preview-wall'), false);
});

test('a connected diagonal preview exposes its interior angle for the top measurement action', () => {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  draft = commitWall(draft, { xMm: 3000, yMm: 0 }, 3000);
  draft = surveyGraph.setMode(draft, 'diagonal');
  draft = surveyGraph.startPreview(draft, { xMm: 4000, yMm: 1732 });
  draft = surveyGraph.applyPreviewInteriorAngle(draft, 120, 'manual');

  const scene = createScene(draft);
  assert.equal(scene.activeSegment.preview, true);
  assert.equal(scene.activeSegment.relativeAngle, 60);
  assert.equal(scene.activeSegment.interiorAngleDeg, 120);
});

test('inside/outside measurement edge can change only while a wall chain first wall is confirmed', () => {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  draft = commitWall(draft, { xMm: 3000, yMm: 0 }, 3000);

  const firstWallId = surveyGraph.getActiveFloor(draft).walls[0].id;
  draft = surveyGraph.setMeasurementSide(draft, 'right', firstWallId);
  let floor = surveyGraph.getActiveFloor(draft);
  assert.equal(floor.session.measurementSide, 'right');
  assert.equal(floor.walls[0].measurementSide, 'right');

  draft = commitWall(draft, { xMm: 3000, yMm: 2000 }, 2000);
  const lockedDraft = surveyGraph.setMeasurementSide(draft, 'left', firstWallId);
  floor = surveyGraph.getActiveFloor(lockedDraft);
  assert.equal(floor.session.measurementSide, 'right');
  assert.equal(floor.walls[0].measurementSide, 'right');

  draft = surveyGraph.placeNewWallChainCursor(draft, { xMm: 6000, yMm: 0 });
  draft = commitWall(draft, { xMm: 9000, yMm: 0 }, 3000);
  const newChainFirstWall = surveyGraph.getActiveFloor(draft).walls[2];
  draft = surveyGraph.setMeasurementSide(draft, 'left', newChainFirstWall.id);
  floor = surveyGraph.getActiveFloor(draft);
  assert.equal(floor.session.measurementSide, 'left');
  assert.equal(newChainFirstWall.id, floor.walls[2].id);
  assert.equal(floor.walls[2].measurementSide, 'left');

  draft = commitWall(draft, { xMm: 9000, yMm: 2000 }, 2000);
  const newChainLockedDraft = surveyGraph.setMeasurementSide(draft, 'right', newChainFirstWall.id);
  floor = surveyGraph.getActiveFloor(newChainLockedDraft);
  assert.equal(floor.session.measurementSide, 'left');
  assert.equal(floor.walls[2].measurementSide, 'left');
});

test('closed space adds outer dimensions while a new wall chain remains inner-only', () => {
  const closedDraft = createClosedRectangleDraft();
  const closedFloor = surveyGraph.getActiveFloor(closedDraft);
  const closedScene = createScene(closedDraft);

  assert.equal(closedScene.dimensions.length, closedFloor.walls.length * 2);
  assert.equal(closedScene.dimensions.filter((dimension) => dimension.kind === 'inner').length, closedFloor.walls.length);
  assert.equal(closedScene.dimensions.filter((dimension) => dimension.kind === 'outer').length, closedFloor.walls.length);
  assert.equal(closedScene.dimensions.every((dimension) => dimension.placement === 'outside'), true);
  closedScene.dimensions.forEach((dimension) => {
    assert.ok(dimension.wall.closedOutsideSign === -1 || dimension.wall.closedOutsideSign === 1);
    assert.ok(dimension.offset * dimension.wall.closedOutsideSign > 0);
  });
  assert.deepEqual(closedScene.activeMeasurementWallIds, []);
  assert.equal(closedScene.closedSpaceLabels[0].detailScale, 1);

  const zoomedScene = createScene(surveyGraph.updateViewport(closedDraft, { scale: 0.2 }));
  assert.ok(zoomedScene.closedSpaceLabels[0].detailScale > closedScene.closedSpaceLabels[0].detailScale);
  assert.ok(zoomedScene.closedSpaceLabels[0].detailScale <= 1.45);

  const reversedSideDraft = surveyGraph.cloneDraft(closedDraft);
  surveyGraph.getActiveFloor(reversedSideDraft).walls.forEach((wall) => {
    wall.measurementSide = wall.measurementSide === 'left' ? 'right' : 'left';
  });
  const reversedSideScene = createScene(reversedSideDraft);
  reversedSideScene.dimensions.forEach((dimension) => {
    assert.ok(dimension.offset * dimension.wall.closedOutsideSign > 0);
  });

  const nextDraft = surveyGraph.cloneDraft(closedDraft);
  const nextFloor = surveyGraph.getActiveFloor(nextDraft);
  nextFloor.nodes.push(
    { id: 'next-start', xMm: 4500, yMm: 0 },
    { id: 'next-end', xMm: 6000, yMm: 0 }
  );
  nextFloor.walls.push({
    id: 'next-wall',
    startNodeId: 'next-start',
    endNodeId: 'next-end',
    mode: 'straight',
    lengthMm: 1500,
    angleDeg: 0,
    thicknessMm: 200,
    measurementSide: 'left'
  });
  nextFloor.session.activeSpaceStartWallIndex = closedFloor.walls.length;
  nextFloor.session.state = 'wallCommitted';

  const mixedScene = createScene(nextDraft);
  assert.equal(mixedScene.dimensions.filter((dimension) => dimension.kind === 'outer').length, closedFloor.walls.length);
  assert.equal(mixedScene.dimensions.filter((dimension) => dimension.wall.id === 'next-wall').length, 1);
  assert.equal(mixedScene.dimensions.find((dimension) => dimension.wall.id === 'next-wall').kind, 'inner');
  assert.deepEqual(mixedScene.activeMeasurementWallIds, ['next-wall']);
});

test('closed room shell stays outside the boundary for either initial measurement side', () => {
  const draft = createClosedRectangleDraft();
  const variants = ['left', 'right'];

  variants.forEach((measurementSide) => {
    const variant = surveyGraph.cloneDraft(draft);
    const floor = surveyGraph.getActiveFloor(variant);
    floor.walls.forEach((wall) => { wall.measurementSide = measurementSide; });
    const scene = createScene(variant);
    const boundary = scene.closedSpaceFills[0].points;
    const centroid = boundary.reduce((result, point) => ({
      x: result.x + point.x / boundary.length,
      y: result.y + point.y / boundary.length
    }), { x: 0, y: 0 });

    scene.walls.forEach((wall) => {
      const midpoint = {
        x: (wall.startPoint.x + wall.endPoint.x) / 2,
        y: (wall.startPoint.y + wall.endPoint.y) / 2
      };
      const outerMidpoint = {
        x: (wall.rawOuterStart.x + wall.rawOuterEnd.x) / 2,
        y: (wall.rawOuterStart.y + wall.rawOuterEnd.y) / 2
      };
      const fromRoomCenter = { x: midpoint.x - centroid.x, y: midpoint.y - centroid.y };
      const outerOffset = { x: outerMidpoint.x - midpoint.x, y: outerMidpoint.y - midpoint.y };
      assert.ok(
        fromRoomCenter.x * outerOffset.x + fromRoomCenter.y * outerOffset.y > 0,
        `expected ${measurementSide} measurement side to render outward`
      );
    });

    scene.walls.forEach((wall, index) => {
      const nextWall = scene.walls[(index + 1) % scene.walls.length];
      assert.ok(Math.hypot(wall.outerEnd.x - nextWall.outerStart.x, wall.outerEnd.y - nextWall.outerStart.y) < 0.01);
    });
  });
});

test('shared walls between closed rooms never receive whole-wall or door-chain dimensions', () => {
  const scene = createScene(createTwoClosedRoomsWithSharedDoorDraft());
  const sharedWall = scene.walls.find((wall) => wall.id === 'wall-2');

  assert.equal(sharedWall.closed, true);
  assert.equal(sharedWall.isExteriorBoundary, false);
  assert.equal(scene.dimensions.some((dimension) => dimension.wall.id === 'wall-2'), false);
  assert.equal(scene.dimensions.length, 12);
  assert.equal(scene.dimensions.every((dimension) => dimension.wall.isExteriorBoundary), true);
});

test('closed wall with an opening renders a wall-opening-wall chain dimension', () => {
  let draft = createClosedRectangleDraft();
  const firstWallId = surveyGraph.getActiveFloor(draft).walls[0].id;
  draft = surveyGraph.addOpeningToWall(draft, firstWallId, 'door');
  const scene = createScene(draft);
  const chainDimensions = scene.dimensions.filter((dimension) => (
    dimension.wall.id === firstWallId && dimension.kind === 'opening-segment'
  ));

  assert.equal(chainDimensions.length, 3);
  assert.deepEqual(chainDimensions.map((dimension) => dimension.label), ['1050', '900', '1050']);
  assert.equal(chainDimensions.every((dimension) => dimension.placement === 'outside'), true);
  assert.equal(chainDimensions.every((dimension) => dimension.offset * dimension.wall.closedOutsideSign > 0), true);
  assert.equal(scene.dimensions.filter((dimension) => dimension.wall.id === firstWallId && dimension.kind === 'inner').length, 0);
  assert.equal(scene.dimensions.filter((dimension) => dimension.wall.id === firstWallId && dimension.kind === 'outer').length, 1);
  assert.equal(scene.closedSpaceLabels[0].ceilingHeightMm, 2800);
});

test('window walls retain whole-wall dimensions without a chain dimension', () => {
  let draft = createClosedRectangleDraft();
  const firstWallId = surveyGraph.getActiveFloor(draft).walls[0].id;
  draft = surveyGraph.addOpeningToWall(draft, firstWallId, 'window');
  const scene = createScene(draft);

  assert.equal(scene.dimensions.filter((dimension) => dimension.wall.id === firstWallId && dimension.kind === 'opening-segment').length, 0);
  assert.equal(scene.dimensions.filter((dimension) => dimension.wall.id === firstWallId && dimension.kind === 'inner').length, 1);
  assert.equal(scene.dimensions.filter((dimension) => dimension.wall.id === firstWallId && dimension.kind === 'outer').length, 1);
});

test('dimension arrows and guidance lines use the compact drawing treatment', () => {
  const scene = createScene(createOpenDraft());
  scene.alignmentSnapGuide = {
    startPoint: { x: 60, y: 60 },
    endPoint: { x: 120, y: 60 }
  };
  scene.closureGuide = {
    startPoint: { x: 80, y: 80 },
    endPoint: { x: 120, y: 120 }
  };
  const recorder = createRecordingContext();

  surveyCanvasRenderer.drawSurveyScene(recorder.context, scene, { dpr: 1 });

  const arrowFills = recorder.fills.filter((path) => (
    path.length === 4 &&
    path[0][0] === 'moveTo' &&
    path[1][0] === 'lineTo' &&
    path[2][0] === 'lineTo' &&
    path[3][0] === 'closePath'
  ));
  assert.equal(arrowFills.length, scene.dimensions.length * 2);
  assert.ok(recorder.widths.includes(1));
  assert.ok(recorder.widths.includes(2));
  assert.ok(recorder.widths.includes(1.5));
  assert.deepEqual(recorder.dashes.filter((dash) => dash.length), [[14, 10], [5, 5], [7, 6]]);
  assert.equal(recorder.strokes.some((path) => (
    path.length === 2 &&
    path[0][0] === 'moveTo' &&
    path[1][0] === 'lineTo' &&
    Math.abs(path[1][1] - path[0][1]) === 8 &&
    Math.abs(path[1][2] - path[0][2]) === 8
  )), false);
});

test('drag-only canvas renders one dashed cross guide and one square cursor', () => {
  const recorder = createRecordingContext();
  surveyCanvasRenderer.drawDraggingCursor(
    recorder.context,
    { width: 400, height: 500 },
    { x: 180, y: 220 },
    { dpr: 1 }
  );

  assert.deepEqual(recorder.dashes.filter((dash) => dash.length), [[18, 12]]);
  assert.ok(recorder.widths.includes(1.5));
  assert.equal(recorder.widths.includes(3), false);
  assert.ok(recorder.strokes.some((path) => (
    path.some((command) => command[0] === 'moveTo' && command[1] === 0 && command[2] === 220) &&
    path.some((command) => command[0] === 'lineTo' && command[1] === 400 && command[2] === 220) &&
    path.some((command) => command[0] === 'moveTo' && command[1] === 180 && command[2] === 0) &&
    path.some((command) => command[0] === 'lineTo' && command[1] === 180 && command[2] === 500)
  )));
  assert.equal(recorder.strokes.some((path) => (
    path.some((command) => command[0] === 'arc')
  )), false);
});
