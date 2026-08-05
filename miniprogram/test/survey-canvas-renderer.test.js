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

function createResetCursorMergeClosureDraft() {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.placeCursor(draft, { xMm: 3000, yMm: 0 });
  draft = commitWall(draft, { xMm: 0, yMm: 0 }, 3000);
  draft = commitWall(draft, { xMm: 0, yMm: 2000 }, 2000);

  const floor = surveyGraph.getActiveFloor(draft);
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    { xMm: 0, yMm: 2000 },
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  draft = surveyGraph.snapCursorToWall(surveyGraph.startWallSnap(draft), target.pointMm, target);
  return commitWall(draft, { xMm: 3000, yMm: 2000 }, 3000);
}

function createWallSnappedClosureDraft() {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  draft = commitWall(draft, { xMm: 3000, yMm: 0 }, 3000);
  draft = commitWall(draft, { xMm: 3000, yMm: 2000 }, 2000);
  draft = commitWall(draft, { xMm: 0, yMm: 2000 }, 3000);

  const floor = surveyGraph.getActiveFloor(draft);
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    { xMm: 1500, yMm: 0 },
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  draft = surveyGraph.snapCursorToWall(surveyGraph.startWallSnap(draft), target.pointMm, target);
  draft = commitWall(draft, { xMm: 1500, yMm: 2000 }, 2000);
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

function createReverseFirstWallRectangleDraft() {
  const draft = surveyGraph.createSurveyDraft();
  const floor = surveyGraph.getActiveFloor(draft);
  floor.nodes = [
    { id: 'a', xMm: 0, yMm: 0 },
    { id: 'b', xMm: 3000, yMm: 0 },
    { id: 'c', xMm: 3000, yMm: 2000 },
    { id: 'd', xMm: 0, yMm: 2000 }
  ];
  floor.walls = [
    ['wall-1', 'a', 'b', 3000, 0],
    ['wall-2', 'b', 'c', 2000, 90],
    ['wall-3', 'c', 'd', 3000, 180],
    ['wall-4', 'd', 'a', 2000, -90]
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
  floor.spaces = [{
    id: 'space-reversed',
    name: '反向首墙房间',
    wallIds: ['wall-1', 'wall-4', 'wall-3', 'wall-2'],
    closed: true
  }];
  floor.session.state = 'spaceClosed';
  floor.session.activeSpaceStartWallIndex = floor.walls.length;
  return draft;
}

function createTJoinDraft() {
  const draft = surveyGraph.createSurveyDraft();
  const floor = surveyGraph.getActiveFloor(draft);
  floor.nodes = [
    { id: 'left', xMm: 0, yMm: 0 },
    { id: 'right', xMm: 3000, yMm: 0 },
    { id: 'branch-start', xMm: 1500, yMm: 1200 },
    { id: 'branch-end', xMm: 1500, yMm: 0 }
  ];
  floor.walls = [
    {
      id: 'main-wall',
      startNodeId: 'left',
      endNodeId: 'right',
      mode: 'straight',
      lengthMm: 3000,
      angleDeg: 0,
      thicknessMm: 200,
      measurementSide: 'left'
    },
    {
      id: 'branch-wall',
      startNodeId: 'branch-start',
      endNodeId: 'branch-end',
      mode: 'straight',
      lengthMm: 1200,
      angleDeg: -90,
      thicknessMm: 200,
      measurementSide: 'left'
    }
  ];
  floor.session.state = 'wallCommitted';
  floor.session.activeSpaceStartWallIndex = 0;
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
  const texts = [];
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
    clip() {},
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
    fillText(text, x, y) { texts.push({ text, x, y }); }
  };

  Object.defineProperty(context, 'lineWidth', {
    set(value) { widths.push(value); },
    get() { return widths[widths.length - 1]; }
  });
  ['fillStyle', 'strokeStyle', 'lineCap', 'lineJoin', 'font', 'textAlign', 'textBaseline', 'shadowColor', 'shadowBlur', 'shadowOffsetY', 'miterLimit']
    .forEach((property) => Object.defineProperty(context, property, { set() {}, get() { return undefined; } }));

  return { context, strokes, fills, dashes, widths, texts };
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

test('closed space reverses its first wall when that is the only complete boundary chain', () => {
  const draft = createReverseFirstWallRectangleDraft();
  const floor = surveyGraph.getActiveFloor(draft);
  const points = surveyGraph.buildSpaceBoundaryPoints(floor, floor.spaces[0].wallIds);
  const scene = createScene(draft);

  assert.deepEqual(points.map((point) => point.id), ['b', 'a', 'd', 'c']);
  assert.equal(surveyGraph.calculateSpaceAreaMm2(draft), 6000000);
  assert.equal(scene.closedSpaceFills.length, 1);
  assert.equal(scene.closedSpaceFills[0].points.length, 4);
  assert.equal(scene.walls.every((wall) => !wall.startOpen && !wall.endOpen), true);
});

test('a T join suppresses the branch end cap even when it lands inside another wall', () => {
  const scene = createScene(createTJoinDraft());
  const mainWall = scene.walls.find((wall) => wall.id === 'main-wall');
  const branchWall = scene.walls.find((wall) => wall.id === 'branch-wall');

  assert.equal(mainWall.startOpen, true);
  assert.equal(mainWall.endOpen, true);
  assert.equal(branchWall.startOpen, true);
  assert.equal(branchWall.endOpen, false);
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

test('closed space creates one exterior dimension chain while a new wall chain remains inner-only', () => {
  const closedDraft = createClosedRectangleDraft();
  const closedFloor = surveyGraph.getActiveFloor(closedDraft);
  const closedScene = createScene(closedDraft);

  assert.equal(closedScene.dimensions.length, closedFloor.walls.length);
  assert.equal(closedScene.dimensions.every((dimension) => dimension.kind === 'chain-total'), true);
  assert.equal(closedScene.dimensions.every((dimension) => dimension.placement === 'outside'), true);
  assert.equal(closedScene.dimensions.every((dimension) => dimension.startPoint && dimension.endPoint), true);
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
  assert.equal(reversedSideScene.dimensions.length, closedFloor.walls.length);

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
  assert.equal(mixedScene.dimensions.filter((dimension) => dimension.kind === 'chain-total').length, closedFloor.walls.length);
  assert.equal(mixedScene.dimensions.filter((dimension) => dimension.wall.id === 'next-wall').length, 1);
  assert.equal(mixedScene.dimensions.find((dimension) => dimension.wall.id === 'next-wall').kind, 'inner');
  assert.deepEqual(mixedScene.activeMeasurementWallIds, ['next-wall']);
});

test('closed-space dimensions originate at the rendered exterior wall outline', () => {
  ['left', 'right'].forEach((measurementSide) => {
    const draft = surveyGraph.cloneDraft(createClosedRectangleDraft());
    surveyGraph.getActiveFloor(draft).walls.forEach((wall) => { wall.measurementSide = measurementSide; });
    const scene = createScene(draft);
    const exteriorCorners = scene.walls.flatMap((wall) => [wall.outerStart, wall.outerEnd]);

    scene.dimensions.forEach((dimension) => {
      const matchesCorner = (point) => exteriorCorners.some((corner) => (
        Math.hypot(point.x - corner.x, point.y - corner.y) < 0.01
      ));
      const matchesStart = matchesCorner(dimension.extensionStart);
      const matchesEnd = matchesCorner(dimension.extensionEnd);
      assert.equal(matchesStart && matchesEnd, true);
    });
  });
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

test('shared walls never receive V8 exterior positioning or total dimensions', () => {
  const scene = createScene(createTwoClosedRoomsWithSharedDoorDraft());
  const sharedWall = scene.walls.find((wall) => wall.id === 'wall-2');

  assert.equal(sharedWall.closed, true);
  assert.equal(sharedWall.isExteriorBoundary, false);
  assert.equal(scene.dimensions.some((dimension) => dimension.wall && dimension.wall.id === 'wall-2'), false);
  assert.equal(scene.dimensions.length, 8);
  assert.equal(scene.dimensions.filter((dimension) => dimension.kind === 'chain-total').length, 4);
  assert.equal(scene.dimensions.filter((dimension) => dimension.kind === 'chain-segment').length, 4);
  assert.equal(scene.dimensions.every((dimension) => !dimension.wall || dimension.wall.isExteriorBoundary), true);
});

test('closed door wall renders a V8 positioning chain plus its total dimension', () => {
  let draft = createClosedRectangleDraft();
  const firstWallId = surveyGraph.getActiveFloor(draft).walls[0].id;
  draft = surveyGraph.addOpeningToWall(draft, firstWallId, 'door');
  const scene = createScene(draft);
  const wallDimension = scene.dimensions.find((dimension) => (
    dimension.wall.id === firstWallId && dimension.kind === 'chain-total'
  ));
  const positioningDimensions = scene.dimensions.filter((dimension) => (
    dimension.wall.id === firstWallId && dimension.kind === 'opening-segment'
  ));

  assert.equal(wallDimension.kind, 'chain-total');
  assert.equal(wallDimension.label, '3000');
  assert.equal(wallDimension.placement, 'outside');
  assert.ok(wallDimension.startPoint && wallDimension.endPoint);
  assert.deepEqual(positioningDimensions.map((dimension) => dimension.label), ['1050', '900', '1050']);
  assert.equal(positioningDimensions.every((dimension) => dimension.lane < wallDimension.lane), true);
  assert.equal(scene.closedSpaceLabels[0].ceilingHeightMm, 2800);
});

test('reset-cursor merge closure renders its inferred edge and a complete room shell', () => {
  const pendingDraft = createResetCursorMergeClosureDraft();
  const pendingFloor = surveyGraph.getActiveFloor(pendingDraft);
  const pendingScene = createScene(pendingDraft);

  assert.equal(pendingFloor.session.state, 'mergeClosing');
  assert.ok(pendingScene.closureGuide);

  const closedDraft = surveyGraph.confirmClosure(pendingDraft);
  const closedFloor = surveyGraph.getActiveFloor(closedDraft);
  const closedScene = createScene(closedDraft);
  const closedSpace = closedFloor.spaces.find((space) => space.closed);
  const boundary = surveyGraph.buildSpaceBoundaryPoints(closedFloor, closedSpace.wallIds);

  assert.equal(closedSpace.wallIds.length, 4);
  assert.equal(boundary.length, 4);
  assert.equal(closedScene.closedSpaceFills.length, 1);
  assert.equal(closedScene.closedSpaceFills[0].points.length, 4);
  assert.equal(closedScene.walls.every((wall) => !wall.startOpen && !wall.endOpen), true);
  assert.equal(closedFloor.walls.at(-1).inputSource, 'closure-merge');
});

test('window walls retain global exterior totals without a duplicate positioning chain', () => {
  let draft = createClosedRectangleDraft();
  const firstWallId = surveyGraph.getActiveFloor(draft).walls[0].id;
  draft = surveyGraph.addOpeningToWall(draft, firstWallId, 'window');
  const scene = createScene(draft);

  assert.equal(scene.dimensions.filter((dimension) => dimension.kind === 'chain-total').length, 4);
  assert.equal(scene.dimensions.some((dimension) => dimension.kind === 'opening-segment'), false);
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
  assert.deepEqual(recorder.dashes.filter((dash) => dash.length), [[14, 10], [5, 5], [7, 6], [18, 12]]);
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

test('cursor lens reuses the formal wall scene around the drag target', () => {
  const draft = createTwoClosedRoomsWithSharedDoorDraft();
  const floor = surveyGraph.getActiveFloor(draft);
  const scene = surveyCanvasRenderer.createSurveyLensScene({
    floor,
    session: floor.session,
    centerPoint: { xMm: 3000, yMm: 1000 },
    size: 180,
    scale: 0.12
  });

  assert.deepEqual(scene.rect, { width: 180, height: 180 });
  assert.equal(scene.openings.length, 1);
  assert.equal(Math.round(scene.openings[0].center.y), 90);
  const sharedWall = scene.walls.find((wall) => wall.id === 'wall-2');
  assert.equal(Math.round(sharedWall.startPoint.x), 90);
  assert.equal(Math.round(sharedWall.endPoint.x), 90);
  assert.ok(scene.wallSolidPlan.rings.length > 0);
  assert.ok(scene.walls.every((wall) => wall.thicknessPx >= 10));

  const recorder = createRecordingContext();
  surveyCanvasRenderer.drawDraggingCursor(
    recorder.context,
    { width: 390, height: 650 },
    { x: 220, y: 420 },
    {
      dpr: 1,
      lensScene: scene,
      lensRect: { left: 20, top: 98, size: 180 }
    }
  );
  assert.ok(recorder.fills.length > 0);
  assert.ok(recorder.strokes.length > 0);
});

test('viewport interaction transform matches a full scene rebuilt at the target viewport', () => {
  const rect = { width: 390, height: 650 };
  const baseViewport = { scale: 0.03, offsetX: 23, offsetY: -108 };
  const viewport = { scale: 0.045, offsetX: -34, offsetY: 72 };
  const pointMm = { xMm: 2750, yMm: 1600 };
  const basePoint = {
    x: rect.width / 2 + baseViewport.offsetX + pointMm.xMm * baseViewport.scale,
    y: rect.height / 2 + baseViewport.offsetY + pointMm.yMm * baseViewport.scale
  };
  const targetPoint = {
    x: rect.width / 2 + viewport.offsetX + pointMm.xMm * viewport.scale,
    y: rect.height / 2 + viewport.offsetY + pointMm.yMm * viewport.scale
  };
  const transform = surveyCanvasRenderer.resolveViewportInteractionTransform(baseViewport, viewport, rect);
  const transformedPoint = {
    x: basePoint.x * transform.scale + transform.translateX,
    y: basePoint.y * transform.scale + transform.translateY
  };

  assert.ok(Math.abs(transformedPoint.x - targetPoint.x) < 0.0001);
  assert.ok(Math.abs(transformedPoint.y - targetPoint.y) < 0.0001);
});

test('viewport interaction projects closed fills, wall solids, and openings into one target coordinate space', () => {
  const scene = createScene(createTwoClosedRoomsWithSharedDoorDraft());
  const viewport = Object.assign({}, scene.viewport, {
    scale: scene.viewport.scale * 1.2,
    offsetX: scene.viewport.offsetX + 48,
    offsetY: scene.viewport.offsetY - 32
  });
  const interactionScene = surveyCanvasRenderer.createViewportInteractionScene(scene, viewport);
  const transform = surveyCanvasRenderer.resolveViewportInteractionTransform(scene.viewport, viewport, scene.rect);
  const sourceFillPoint = scene.closedSpaceFills[0].points[0];
  const projectedFillPoint = interactionScene.closedSpaceFills[0].points[0];
  const sourceSolidPoint = scene.wallSolidPlans.closed.rings[0][0];
  const projectedSolidPoint = interactionScene.wallSolidPlans.closed.rings[0][0];
  const sourceOpening = scene.openings[0];
  const projectedOpening = interactionScene.openings[0];

  assert.deepEqual(projectedFillPoint, {
    x: sourceFillPoint.x * transform.scale + transform.translateX,
    y: sourceFillPoint.y * transform.scale + transform.translateY
  });
  assert.deepEqual(projectedSolidPoint, {
    x: sourceSolidPoint.x * transform.scale + transform.translateX,
    y: sourceSolidPoint.y * transform.scale + transform.translateY
  });
  assert.deepEqual(projectedOpening.center, {
    x: sourceOpening.center.x * transform.scale + transform.translateX,
    y: sourceOpening.center.y * transform.scale + transform.translateY
  });
  assert.equal(projectedOpening.wall, interactionScene.walls.find((wall) => wall.id === sourceOpening.wall.id));
});

test('snapping a new cursor onto a closed wall preserves the completed room render geometry', () => {
  const closedDraft = createClosedRectangleDraft();
  const closedFloor = surveyGraph.getActiveFloor(closedDraft);
  const before = createScene(closedDraft);
  const target = surveyGraph.getCursorPlacementTarget(
    closedFloor,
    { xMm: 1500, yMm: 0 },
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  const snappedDraft = surveyGraph.snapCursorToWall(
    surveyGraph.startWallSnap(closedDraft),
    target.pointMm,
    target
  );
  const after = createScene(snappedDraft);

  assert.deepEqual(after.closedSpaceFills, before.closedSpaceFills);
  assert.deepEqual(after.wallSolidPlan.rings, before.wallSolidPlan.rings);
  assert.deepEqual(after.wallSolidPlans.closed.rings, before.wallSolidPlans.closed.rings);
});

test('a room closed from a wall-snapped cursor keeps fills and shared-wall solids in the same gesture frame', () => {
  const scene = createScene(createWallSnappedClosureDraft());
  const viewport = Object.assign({}, scene.viewport, { offsetX: scene.viewport.offsetX + 64 });
  const interactionScene = surveyCanvasRenderer.createViewportInteractionScene(scene, viewport);

  assert.equal(scene.closedSpaceFills.length, 1);
  assert.ok(scene.wallSolidPlans.closed.rings.length > 0);
  assert.equal(interactionScene.closedSpaceFills.length, scene.closedSpaceFills.length);
  assert.equal(interactionScene.wallSolidPlans.closed.rings.length, scene.wallSolidPlans.closed.rings.length);
});

test('viewport interaction keeps structural drawing and skips dimensions, labels, and guides', () => {
  const draft = createTwoClosedRoomsWithSharedDoorDraft();
  const scene = createScene(draft);
  const fullRecorder = createRecordingContext();
  const interactionRecorder = createRecordingContext();

  surveyCanvasRenderer.drawSurveyScene(fullRecorder.context, scene, { dpr: 1 });
  surveyCanvasRenderer.drawSurveyInteractionScene(interactionRecorder.context, scene, {
    dpr: 1,
    baseViewport: scene.viewport,
    viewport: Object.assign({}, scene.viewport, { offsetX: scene.viewport.offsetX + 48 })
  });

  assert.ok(fullRecorder.texts.length > 0);
  assert.equal(interactionRecorder.texts.length, 0);
  assert.ok(interactionRecorder.fills.length > 0);
  assert.ok(interactionRecorder.strokes.length > 0);
  assert.equal(
    interactionRecorder.dashes.some((dash) => dash.length && dash[0] === 14 && dash[1] === 10),
    false
  );
});
