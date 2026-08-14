const test = require('node:test');
const assert = require('node:assert/strict');
const surveyGraph = require('../utils/surveyWallGraph.js');
const surveyCanvasRenderer = require('../packages/surveying/utils/surveyCanvasRenderer.js');

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

function createSteppedClosureDraft() {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  draft = commitWall(draft, { xMm: 2748, yMm: 0 }, 2748);
  draft = commitWall(draft, { xMm: 2748, yMm: 2036 }, 2036);
  draft = commitWall(draft, { xMm: 5837, yMm: 2036 }, 3089);
  draft = commitWall(draft, { xMm: 5837, yMm: 5219 }, 3183);
  return commitWall(draft, { xMm: 3419, yMm: 5219 }, 2418);
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

function createSharedWallInsetClosureDraft() {
  let draft = createClosedRectangleDraft();
  const floor = surveyGraph.getActiveFloor(draft);
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    { xMm: 0, yMm: 2000 },
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  draft = surveyGraph.snapCursorToWall(
    surveyGraph.startWallSnap(draft),
    target.pointMm,
    target
  );
  draft = commitWall(draft, { xMm: 0, yMm: 5000 }, 3000);
  draft = commitWall(draft, { xMm: 3000, yMm: 5200 }, 3000);
  return surveyGraph.startPreview(draft, { xMm: 3000, yMm: 2200 });
}

function createClosedCornerCollinearClosureDraft() {
  let draft = createClosedRectangleDraft();
  const floor = surveyGraph.getActiveFloor(draft);
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    { xMm: 0, yMm: 2000 },
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  draft = surveyGraph.snapCursorToWall(
    surveyGraph.startWallSnap(draft),
    target.pointMm,
    target
  );
  draft = commitWall(draft, { xMm: 0, yMm: 5000 }, 3000);
  draft = commitWall(draft, { xMm: 3000, yMm: 5200 }, 3000);
  return commitWall(draft, { xMm: 3000, yMm: 4000 }, 1200);
}

function createOffsetAdjacentRoomDraft() {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  draft = commitWall(draft, { xMm: 2233, yMm: 0 }, 2233);
  draft = commitWall(draft, { xMm: 2233, yMm: 3182 }, 3182);
  draft = commitWall(draft, { xMm: 0, yMm: 3182 }, 2233);
  draft = commitWall(draft, { xMm: 0, yMm: 0 }, 3182);
  draft = surveyGraph.confirmClosure(draft);

  const floor = surveyGraph.getActiveFloor(draft);
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    { xMm: 0, yMm: 3182 },
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  draft = surveyGraph.snapCursorToWall(
    surveyGraph.startWallSnap(draft),
    target.pointMm,
    target
  );
  draft = commitWall(draft, { xMm: 0, yMm: 7318 }, 4136);
  draft = commitWall(draft, { xMm: 2433, yMm: 7518 }, 2433);
  draft = commitWall(draft, { xMm: 2433, yMm: 5484 }, 2034);
  return surveyGraph.confirmClosure(draft);
}

function createAlignedAdjacentRoomDraft() {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  draft = commitWall(draft, { xMm: 2230, yMm: 0 }, 2230);
  draft = commitWall(draft, { xMm: 2230, yMm: 3182 }, 3182);
  draft = commitWall(draft, { xMm: 0, yMm: 3182 }, 2230);
  draft = commitWall(draft, { xMm: 0, yMm: 0 }, 3182);
  draft = surveyGraph.confirmClosure(draft);

  const floor = surveyGraph.getActiveFloor(draft);
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    { xMm: 0, yMm: 3182 },
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  draft = surveyGraph.snapCursorToWall(
    surveyGraph.startWallSnap(draft),
    target.pointMm,
    target
  );
  draft = commitWall(draft, { xMm: 0, yMm: 6564 }, 3182);
  draft = commitWall(draft, { xMm: 2230, yMm: 6564 }, 2230);
  draft = commitWall(draft, { xMm: 2230, yMm: 3382 }, 3182);
  return surveyGraph.confirmClosure(draft);
}

function normalizeRingStart(ring) {
  if (!Array.isArray(ring) || !ring.length) return ring || [];
  const startIndex = ring.reduce((bestIndex, point, index) => {
    const best = ring[bestIndex];
    return point.x < best.x || (point.x === best.x && point.y < best.y)
      ? index
      : bestIndex;
  }, 0);
  return ring.slice(startIndex).concat(ring.slice(0, startIndex));
}

function normalizeRingPlan(rings) {
  return (rings || []).map(normalizeRingStart).sort((first, second) => (
    JSON.stringify(first).localeCompare(JSON.stringify(second))
  ));
}

function createProtectedInnerCornerAdjacentRoomDraft() {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  draft = commitWall(draft, { xMm: 2205, yMm: 0 }, 2205);
  draft = commitWall(draft, { xMm: 2205, yMm: 2901 }, 2901);
  draft = commitWall(draft, { xMm: 0, yMm: 2901 }, 2205);
  draft = commitWall(draft, { xMm: 0, yMm: 0 }, 2901);
  draft = surveyGraph.confirmClosure(draft);

  const floor = surveyGraph.getActiveFloor(draft);
  const sharedWall = floor.walls[3];
  const innerCorner = surveyGraph.getNode(floor, sharedWall.startNodeId);
  const outerCorner = surveyGraph.buildWallRenderGeometry(floor, sharedWall).outerStart;
  const pointer = {
    xMm: Math.round(innerCorner.xMm + (outerCorner.xMm - innerCorner.xMm) * 0.6),
    yMm: Math.round(innerCorner.yMm + (outerCorner.yMm - innerCorner.yMm) * 0.6)
  };
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    pointer,
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  assert.equal(target.nodeId, sharedWall.startNodeId);
  assert.equal(target.snapLine, undefined);

  draft = surveyGraph.snapCursorToWall(
    surveyGraph.startWallSnap(draft),
    target.pointMm,
    target
  );
  draft = commitWall(draft, { xMm: -2834, yMm: 2901 }, 2834);
  draft = commitWall(draft, { xMm: -2834, yMm: 0 }, 2901);
  draft = commitWall(draft, { xMm: 0, yMm: 0 }, 2834);
  return surveyGraph.confirmClosure(draft);
}

function createOuterFaceAdjacentRoomDraft() {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  draft = commitWall(draft, { xMm: 1723, yMm: 0 }, 1723);
  draft = commitWall(draft, { xMm: 1723, yMm: 3827 }, 3827);
  draft = commitWall(draft, { xMm: 0, yMm: 3827 }, 1723);
  draft = commitWall(draft, { xMm: 0, yMm: 0 }, 3827);
  draft = surveyGraph.confirmClosure(draft);

  const floor = surveyGraph.getActiveFloor(draft);
  const sharedWall = floor.walls[3];
  const geometry = surveyGraph.buildWallRenderGeometry(floor, sharedWall);
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    geometry.outerStart,
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  draft = surveyGraph.snapCursorToWall(
    surveyGraph.startWallSnap(draft),
    target.pointMm,
    target
  );
  draft = commitWall(draft, { xMm: -2449, yMm: 3827 }, 2249);
  draft = commitWall(draft, { xMm: -2449, yMm: 0 }, 3827);
  draft = commitWall(draft, { xMm: -200, yMm: 0 }, 2249);
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

function createScene(draft, viewport) {
  const floor = surveyGraph.getActiveFloor(draft);
  return surveyCanvasRenderer.createSurveyRenderScene({
    floor,
    session: floor.session,
    viewport: viewport || floor.viewport,
    rect: { width: 400, height: 400 }
  });
}

function createRecordingContext() {
  const strokes = [];
  const fills = [];
  const dashes = [];
  const widths = [];
  const strokeDetails = [];
  const fillDetails = [];
  const fillRectDetails = [];
  const texts = [];
  let path = [];
  let lineWidth;
  let strokeStyle;
  let fillStyle;
  let font;

  const context = {
    save() {},
    restore() {},
    setTransform() {},
    clearRect() {},
    fillRect(x, y, width, height) { fillRectDetails.push({ x, y, width, height, fillStyle }); },
    strokeRect() {},
    translate() {},
    scale() {},
    rotate() {},
    clip() {},
    arc(x, y, radius, startAngle, endAngle, anticlockwise) {
      path.push(['arc', x, y, radius, startAngle, endAngle, anticlockwise]);
    },
    quadraticCurveTo() { path.push(['quadraticCurveTo']); },
    beginPath() { path = []; },
    moveTo(x, y) { path.push(['moveTo', x, y]); },
    lineTo(x, y) { path.push(['lineTo', x, y]); },
    rect(x, y, width, height) { path.push(['rect', x, y, width, height]); },
    closePath() { path.push(['closePath']); },
    stroke() {
      const recordedPath = path.slice();
      strokes.push(recordedPath);
      strokeDetails.push({ path: recordedPath, strokeStyle, lineWidth });
    },
    fill() {
      const recordedPath = path.slice();
      fills.push(recordedPath);
      fillDetails.push({ path: recordedPath, fillStyle });
    },
    setLineDash(value) { dashes.push(value.slice()); },
    measureText(text) { return { width: String(text).length * 7 }; },
    fillText(text, x, y) { texts.push({ text, x, y, fillStyle, font }); }
  };

  Object.defineProperty(context, 'lineWidth', {
    set(value) { lineWidth = value; widths.push(value); },
    get() { return lineWidth; }
  });
  Object.defineProperty(context, 'strokeStyle', {
    set(value) { strokeStyle = value; },
    get() { return strokeStyle; }
  });
  Object.defineProperty(context, 'fillStyle', {
    set(value) { fillStyle = value; },
    get() { return fillStyle; }
  });
  Object.defineProperty(context, 'font', {
    set(value) { font = value; },
    get() { return font; }
  });
  ['lineCap', 'lineJoin', 'textAlign', 'textBaseline', 'shadowColor', 'shadowBlur', 'shadowOffsetY', 'miterLimit']
    .forEach((property) => Object.defineProperty(context, property, { set() {}, get() { return undefined; } }));

  return { context, strokes, fills, dashes, widths, strokeDetails, fillDetails, fillRectDetails, texts };
}

test('default surveying canvas uses the fine low-contrast reference grid', () => {
  const recorder = createRecordingContext();
  const scene = surveyCanvasRenderer.createSurveyRenderScene({
    floor: surveyGraph.getActiveFloor(surveyGraph.createSurveyDraft()),
    rect: { width: 390, height: 700 },
    viewport: { scale: surveyGraph.DEFAULT_SCALE, offsetX: 0, offsetY: 0 }
  });

  surveyCanvasRenderer.drawSurveyScene(recorder.context, scene, { dpr: 1 });

  const minorGridX = recorder.strokes[0]
    .filter((command) => command[0] === 'moveTo' && command[2] === 0)
    .map((command) => command[1]);
  const minorGaps = minorGridX.slice(1).map((x, index) => x - minorGridX[index]);

  assert.ok(minorGaps.every((gap) => gap >= 12 && gap <= 13));
});

test('an initial cursor has no blue guide before the first wall is committed', () => {
  const draft = surveyGraph.placeCursor(
    surveyGraph.createSurveyDraft(),
    { xMm: 600, yMm: 400 }
  );
  const scene = createScene(draft);
  const recorder = createRecordingContext();

  surveyCanvasRenderer.drawSurveyScene(recorder.context, scene, { dpr: 1 });

  assert.ok(scene.cursor);
  assert.equal(scene.cursor.guidePoint, null);
  assert.equal(recorder.strokeDetails.some((detail) => (
    detail.strokeStyle === 'rgba(22, 119, 255, 0.92)'
  )), false);
});

test('the blue guide stays at the last committed point while a preview cursor moves', () => {
  let draft = surveyGraph.placeCursor(
    surveyGraph.createSurveyDraft(),
    { xMm: 0, yMm: 0 }
  );
  draft = commitWall(draft, { xMm: 3000, yMm: 0 }, 3000);
  const committedScene = createScene(draft);
  assert.deepEqual(committedScene.cursor.guidePoint, committedScene.cursor.point);

  const previewDraft = surveyGraph.startPreview(draft, { xMm: 3000, yMm: 2000 });
  const previewScene = createScene(previewDraft);
  const recorder = createRecordingContext();
  surveyCanvasRenderer.drawSurveyScene(recorder.context, previewScene, { dpr: 1 });

  assert.notDeepEqual(previewScene.cursor.point, previewScene.cursor.guidePoint);
  assert.deepEqual(previewScene.cursor.guidePoint, previewScene.previewWall.measurementStartPoint);
  const blueGuide = recorder.strokeDetails.find((detail) => (
    detail.strokeStyle === 'rgba(22, 119, 255, 0.92)'
  ));
  assert.deepEqual(blueGuide.path, [
    ['moveTo', 0, previewScene.cursor.guidePoint.y],
    ['lineTo', previewScene.rect.width, previewScene.cursor.guidePoint.y],
    ['moveTo', previewScene.cursor.guidePoint.x, 0],
    ['lineTo', previewScene.cursor.guidePoint.x, previewScene.rect.height]
  ]);

  const committedNext = surveyGraph.commitPreviewLength(previewDraft, 2000, 'manual');
  const committedNextScene = createScene(committedNext);
  assert.deepEqual(committedNextScene.cursor.guidePoint, committedNextScene.cursor.point);
  assert.deepEqual(committedNextScene.cursor.point, previewScene.cursor.point);
});

test('open wall chain renders only inner dimensions and keeps its full chain red', () => {
  const draft = createOpenDraft();
  const floor = surveyGraph.getActiveFloor(draft);
  const scene = createScene(draft);

  assert.equal(scene.dimensions.length, floor.walls.length);
  assert.deepEqual(scene.dimensions.map((dimension) => dimension.kind), ['inner', 'inner']);
  assert.equal(scene.dimensions.every((dimension) => dimension.placement === 'inside'), true);
  assert.equal(scene.dimensions.every((dimension) => Math.abs(dimension.offset) === 32), true);
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

test('placing a new chain cursor after closure does not reuse the previous room wall as active', () => {
  const closedDraft = createClosedRectangleDraft();
  const nextDraft = surveyGraph.placeNewWallChainCursor(closedDraft, { xMm: -1800, yMm: -1200 });
  const scene = createScene(nextDraft);

  assert.equal(scene.activeSegment, null);
  assert.ok(scene.cursor);
  assert.deepEqual(scene.cursor.point, { x: 110, y: 140 });
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

test('closed space creates clear-room and building-overall bands while a new wall chain remains inner-only', () => {
  const closedDraft = createClosedRectangleDraft();
  const closedFloor = surveyGraph.getActiveFloor(closedDraft);
  const closedScene = createScene(closedDraft);

  assert.equal(closedScene.dimensions.length, closedFloor.walls.length * 2);
  assert.equal(closedScene.dimensions.filter((dimension) => dimension.kind === 'room-clear').length, 4);
  assert.equal(closedScene.dimensions.filter((dimension) => dimension.kind === 'building-overall').length, 4);
  assert.equal(closedScene.dimensions.every((dimension) => dimension.placement === 'outside'), true);
  assert.equal(closedScene.dimensions.every((dimension) => dimension.startPoint && dimension.endPoint), true);
  assert.equal(closedScene.dimensions.every((dimension) => (
    Math.hypot(
      dimension.startPoint.x - dimension.extensionStart.x,
      dimension.startPoint.y - dimension.extensionStart.y
    ) >= 28
  )), true);
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
  assert.equal(reversedSideScene.dimensions.length, closedFloor.walls.length * 2);

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
  assert.equal(mixedScene.dimensions.filter((dimension) => dimension.kind === 'building-overall').length, closedFloor.walls.length);
  assert.equal(mixedScene.dimensions.filter((dimension) => dimension.wall && dimension.wall.id === 'next-wall').length, 1);
  assert.equal(mixedScene.dimensions.find((dimension) => dimension.wall && dimension.wall.id === 'next-wall').kind, 'inner');
  assert.deepEqual(mixedScene.activeMeasurementWallIds, ['next-wall']);
});

test('closed-space dimensions originate at the matching inner or exterior wall face', () => {
  ['left', 'right'].forEach((measurementSide) => {
    const draft = surveyGraph.cloneDraft(createClosedRectangleDraft());
    surveyGraph.getActiveFloor(draft).walls.forEach((wall) => { wall.measurementSide = measurementSide; });
    const scene = createScene(draft);
    const exteriorCorners = scene.walls.flatMap((wall) => [wall.outerStart, wall.outerEnd]);
    const innerCorners = scene.closedSpaceFills.flatMap((fill) => fill.points);

    scene.dimensions.forEach((dimension) => {
      const sourceCorners = dimension.kind === 'room-clear' ? innerCorners : exteriorCorners;
      const matchesCorner = (point) => sourceCorners.some((corner) => (
        Math.hypot(point.x - corner.x, point.y - corner.y) < 0.01
      ));
      const matchesStart = matchesCorner(dimension.extensionStart);
      const matchesEnd = matchesCorner(dimension.extensionEnd);
      assert.equal(matchesStart && matchesEnd, true);
    });
  });
});

test('a shared-corner preview renders the automatically inferred measurement side', () => {
  let draft = createClosedRectangleDraft();
  let floor = surveyGraph.getActiveFloor(draft);
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    { xMm: 0, yMm: 2000 },
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  draft = surveyGraph.snapCursorToWall(surveyGraph.startWallSnap(draft), target.pointMm, target);
  draft = surveyGraph.startPreview(draft, { xMm: 0, yMm: 5000 });
  floor = surveyGraph.getActiveFloor(draft);
  const scene = createScene(draft);

  assert.equal(floor.session.previewMeasurementSide, 'right');
  assert.equal(floor.session.previewMeasurementStartInsetMm, 200);
  assert.equal(floor.session.previewLengthMm, 2800);
  assert.equal(floor.session.closeCandidateType, '');
  assert.equal(scene.previewWall.measurementSide, 'right');
  assert.equal(scene.previewWall.lengthMm, 2800);
  assert.equal(scene.activeSegment.measurementSide, 'right');
  assert.equal(scene.closureGuide, null);
  assert.notEqual(scene.previewWall.start.yMm, scene.previewWall.topologyStart.yMm);
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

test('shared walls never receive exterior dimensions and adjacent rooms keep independent clear chains', () => {
  const scene = createScene(createTwoClosedRoomsWithSharedDoorDraft());
  const sharedWall = scene.walls.find((wall) => wall.id === 'wall-2');

  assert.equal(sharedWall.closed, true);
  assert.equal(sharedWall.isExteriorBoundary, false);
  assert.equal(scene.dimensions.some((dimension) => dimension.wall && dimension.wall.id === 'wall-2'), false);
  assert.equal(scene.dimensions.length, 10);
  assert.equal(scene.dimensions.filter((dimension) => dimension.kind === 'building-overall').length, 4);
  assert.equal(scene.dimensions.filter((dimension) => dimension.kind === 'room-clear').length, 6);
  assert.equal(scene.dimensions.every((dimension) => !dimension.wall || dimension.wall.isExteriorBoundary), true);
});

test('closed door wall renders opening, clear-room, and building-overall lanes', () => {
  let draft = createClosedRectangleDraft();
  const firstWallId = surveyGraph.getActiveFloor(draft).walls[0].id;
  draft = surveyGraph.addOpeningToWall(draft, firstWallId, 'door');
  const scene = createScene(draft);
  const roomDimension = scene.dimensions.find((dimension) => (
    dimension.wall && dimension.wall.id === firstWallId && dimension.kind === 'room-clear'
  ));
  const positioningDimensions = scene.dimensions.filter((dimension) => (
    dimension.wall && dimension.wall.id === firstWallId && dimension.kind === 'opening-segment'
  ));
  const buildingDimension = scene.dimensions.find((dimension) => (
    dimension.kind === 'building-overall' && dimension.label === '3400' && dimension.lane === 2
  ));

  assert.equal(roomDimension.label, '3000');
  assert.equal(roomDimension.placement, 'outside');
  assert.ok(buildingDimension.startPoint && buildingDimension.endPoint);
  assert.deepEqual(positioningDimensions.map((dimension) => dimension.label), ['1050', '900', '1050']);
  assert.equal(positioningDimensions.every((dimension) => dimension.lane < roomDimension.lane), true);
  assert.ok(roomDimension.lane < buildingDimension.lane);
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

test('closed-corner collinear closure guide continues from the current wall edge', () => {
  const draft = createClosedCornerCollinearClosureDraft();
  const floor = surveyGraph.getActiveFloor(draft);
  const scene = createScene(draft);
  const currentWall = scene.walls.find((wall) => wall.id === floor.walls.at(-1).id);

  assert.ok(scene.closureGuide);
  assert.ok(currentWall);
  assert.equal(scene.closureGuide.points.length, 2);
  assert.equal(scene.closureGuide.startPoint.x, currentWall.endPoint.x);
  assert.equal(scene.closureGuide.endPoint.x, currentWall.endPoint.x);
});

test('offset adjacent-room closure renders the stepped second room with its own dimensions and area', () => {
  const draft = createOffsetAdjacentRoomDraft();
  const floor = surveyGraph.getActiveFloor(draft);
  const secondSpace = floor.spaces.find((space) => space.name === '房间2');
  const scene = createScene(draft);
  const secondLabel = scene.closedSpaceLabels.find((label) => label.roomName === '房间2');

  assert.ok(secondSpace);
  const secondFill = scene.closedSpaceFills.find((space) => space.id === secondSpace.id);
  assert.ok(secondLabel);
  assert.ok(secondFill);
  assert.equal(secondLabel.widthMm, 2433);
  assert.equal(secondLabel.heightMm, 4136);
  assert.equal(secondLabel.areaM2, '10.1');
  assert.equal(secondFill.points.length, 4);
});

test('aligned adjacent rooms share one wall body and derive independent net-face plans', () => {
  const draft = createAlignedAdjacentRoomDraft();
  const floor = surveyGraph.getActiveFloor(draft);
  const scene = createScene(draft);
  const closedSpaces = floor.spaces.filter((space) => space.closed);
  const wallUseCounts = {};
  closedSpaces.forEach((space) => {
    space.wallIds.forEach((wallId) => {
      wallUseCounts[wallId] = (wallUseCounts[wallId] || 0) + 1;
    });
  });
  const sharedWallIds = Object.keys(wallUseCounts).filter((wallId) => wallUseCounts[wallId] === 2);

  assert.equal(closedSpaces.length, 2);
  assert.equal(sharedWallIds.length, 1);
  assert.equal(scene.walls.filter((wall) => wall.id === sharedWallIds[0]).length, 1);
  assert.equal(scene.closedSpaceFills.length, 2);
  assert.equal(scene.closedSpaceFills.every((fill) => fill.points.length === 4), true);

  const plans = closedSpaces.map((space) => surveyGraph.buildSpaceDimensionPlan(floor, space));
  plans.forEach((plan, index) => {
    assert.deepEqual(plan.inner, { widthMm: 2230, heightMm: 3182, areaMm2: 7095860 });
    assert.deepEqual(plan.outer, index === 0
      ? { widthMm: 2630, heightMm: 3582, areaMm2: 9420660 }
      : { widthMm: 2630, heightMm: 3582, areaMm2: 9420660 });
    assert.equal(plan.wallThicknessSegments.length, 4);
    assert.equal(plan.wallThicknessSegments.every((item) => (
      item.kind === 'wall-thickness' && item.lengthMm === 200
    )), true);
  });
  assert.equal(surveyGraph.calculateSpaceAreaMm2(draft, closedSpaces[0].id), 7095860);
  assert.equal(surveyGraph.calculateSpaceAreaMm2(draft, closedSpaces[1].id), 7095860);

  const secondRawBoundary = surveyGraph.buildSpaceBoundaryPoints(floor, closedSpaces[1].wallIds);
  const rawWidth = Math.max(...secondRawBoundary.map((point) => point.xMm)) -
    Math.min(...secondRawBoundary.map((point) => point.xMm));
  const rawHeight = Math.max(...secondRawBoundary.map((point) => point.yMm)) -
    Math.min(...secondRawBoundary.map((point) => point.yMm));
  assert.equal(rawWidth * rawHeight, 7541860);
  assert.notEqual(plans[1].inner.areaMm2, rawWidth * rawHeight);

  const verticalExteriorFaces = scene.walls.filter((wall) => (
    Math.abs(wall.topologyStart.xMm - wall.topologyEnd.xMm) <= 1 &&
    wall.id !== sharedWallIds[0]
  )).map((wall) => Math.round((wall.rawOuterStart.x + wall.rawOuterEnd.x) / 2));
  const exteriorFaceCounts = verticalExteriorFaces.reduce((counts, value) => {
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
  assert.equal(Object.keys(exteriorFaceCounts).length, 2);
  assert.deepEqual(Object.values(exteriorFaceCounts).sort((a, b) => a - b), [2, 2]);
  assert.equal(scene.spaceDimensionPlans.length, 2);
});

test('2205/2901/2834 inner-corner closure keeps its visible lower-wall endpoint after closing and deleting', () => {
  const draft = createProtectedInnerCornerAdjacentRoomDraft();
  const floor = surveyGraph.getActiveFloor(draft);
  const firstSpace = floor.spaces[0];
  const secondSpace = floor.spaces[1];
  const newWallIds = secondSpace.wallIds.filter((wallId) => firstSpace.wallIds.indexOf(wallId) === -1);
  const lowerWallId = newWallIds[0];
  const upperWallId = newWallIds[2];
  const scene = createScene(draft);
  const lowerWallBefore = scene.walls.find((wall) => wall.id === lowerWallId);
  const dimensionPlan = surveyGraph.buildSpaceDimensionPlan(floor, secondSpace);

  assert.deepEqual(dimensionPlan.inner, {
    widthMm: 2834,
    heightMm: 2901,
    areaMm2: 8221434
  });
  assert.equal(secondSpace.wallFaceOverrides[firstSpace.wallIds[3]], 'offset');
  assert.deepEqual(newWallIds.map((wallId) => {
    const wall = surveyGraph.getWall(floor, wallId);
    return [wall.measurementStartInsetMm || 0, wall.measurementEndInsetMm || 0];
  }), [[200, 0], [0, 0], [0, 200]]);
  assert.deepEqual(
    scene.dimensions
      .filter((dimension) => dimension.kind === 'building-overall')
      .map((dimension) => dimension.label),
    ['3301', '5639', '3301', '5639']
  );
  assert.equal(scene.wallFaceOverrideBoundaries.length, 1);
  const selectedBoundary = scene.wallFaceOverrideBoundaries[0].points;
  assert.deepEqual(selectedBoundary[0], lowerWallBefore.startPoint);
  assert.deepEqual(selectedBoundary[1], lowerWallBefore.endPoint);

  const recorder = createRecordingContext();
  surveyCanvasRenderer.drawSurveyScene(recorder.context, scene, { dpr: 1 });
  assert.equal(recorder.strokeDetails.some((detail) => (
    detail.strokeStyle === '#1f1f1f' &&
    detail.path.some((command, index, path) => (
      index > 0 && command[0] === 'lineTo' && path[index - 1][0] === 'moveTo' &&
      path[index - 1][1] === lowerWallBefore.startPoint.x &&
      path[index - 1][2] === lowerWallBefore.startPoint.y &&
      command[1] === lowerWallBefore.endPoint.x &&
      command[2] === lowerWallBefore.endPoint.y
    ))
  )), true);

  const openedDraft = surveyGraph.deleteWall(draft, upperWallId);
  const lowerWallAfter = createScene(openedDraft).walls.find((wall) => wall.id === lowerWallId);
  const selectWallGeometry = (wall) => ({
    start: wall.start,
    end: wall.end,
    topologyStart: wall.topologyStart,
    topologyEnd: wall.topologyEnd,
    rawOuterStart: wall.rawOuterStart,
    rawOuterEnd: wall.rawOuterEnd
  });
  assert.deepEqual(selectWallGeometry(lowerWallAfter), selectWallGeometry(lowerWallBefore));
});

test('deleting the wall shared by two closed rooms merges their fill, label, and net area', () => {
  const draft = createAlignedAdjacentRoomDraft();
  const floor = surveyGraph.getActiveFloor(draft);
  const wallUseCounts = {};
  floor.spaces.filter((space) => space.closed).forEach((space) => {
    space.wallIds.forEach((wallId) => {
      wallUseCounts[wallId] = (wallUseCounts[wallId] || 0) + 1;
    });
  });
  const sharedWallId = Object.keys(wallUseCounts).find((wallId) => wallUseCounts[wallId] === 2);
  assert.ok(sharedWallId);

  const mergedDraft = surveyGraph.deleteWall(draft, sharedWallId);
  const mergedFloor = surveyGraph.getActiveFloor(mergedDraft);
  const mergedSpaces = mergedFloor.spaces.filter((space) => space.closed);
  const mergedScene = createScene(mergedDraft);

  assert.equal(mergedSpaces.length, 1);
  assert.equal(mergedSpaces[0].name, '\u623f\u95f43');
  assert.equal(mergedSpaces[0].wallIds.includes(sharedWallId), false);
  assert.equal(mergedFloor.walls.some((wall) => wall.id === sharedWallId), false);
  assert.equal(mergedFloor.session.state, 'spaceClosed');
  assert.equal(mergedScene.closedSpaceFills.length, 1);
  assert.equal(mergedScene.closedSpaceLabels.length, 1);
  assert.equal(mergedScene.closedSpaceFills[0].points.length, 6);
  assert.deepEqual(surveyGraph.buildSpaceDimensionPlan(mergedFloor, mergedSpaces[0]).inner, {
    widthMm: 2230,
    heightMm: 6564,
    areaMm2: 14637720
  });
});

test('deleting an exterior wall still invalidates its single closed room', () => {
  const draft = createClosedRectangleDraft();
  const floor = surveyGraph.getActiveFloor(draft);
  const exteriorWallId = floor.spaces[0].wallIds[0];
  const openedDraft = surveyGraph.deleteWall(draft, exteriorWallId);
  const openedFloor = surveyGraph.getActiveFloor(openedDraft);
  const openedScene = createScene(openedDraft);

  assert.equal(openedFloor.spaces.filter((space) => space.closed).length, 0);
  assert.equal(openedScene.closedSpaceFills.length, 0);
  assert.equal(openedFloor.session.state, 'wallCommitted');
});

test('deleting an outer-face shared wall clears only its obsolete perimeter insets', () => {
  let draft = createOuterFaceAdjacentRoomDraft();
  const floor = surveyGraph.getActiveFloor(draft);
  const wallUseCounts = {};
  floor.spaces.forEach((space) => {
    space.wallIds.forEach((wallId) => {
      wallUseCounts[wallId] = (wallUseCounts[wallId] || 0) + 1;
    });
  });
  const sharedWallId = Object.keys(wallUseCounts).find((wallId) => wallUseCounts[wallId] === 2);
  const sharedWall = surveyGraph.getWall(floor, sharedWallId);
  const sharedNodeIds = new Set([sharedWall.startNodeId, sharedWall.endNodeId]);
  const insetBoundaryWalls = floor.walls.filter((wall) => (
    wall.id !== sharedWallId &&
    (sharedNodeIds.has(wall.startNodeId) || sharedNodeIds.has(wall.endNodeId)) &&
    ((wall.measurementStartInsetMm || 0) > 0 || (wall.measurementEndInsetMm || 0) > 0)
  ));

  assert.deepEqual(insetBoundaryWalls.map((wall) => wall.lengthMm).sort((a, b) => a - b), [2249, 2249]);
  assert.deepEqual(insetBoundaryWalls.map((wall) => (
    (wall.measurementStartInsetMm || 0) + (wall.measurementEndInsetMm || 0)
  )), [200, 200]);

  const openingWall = insetBoundaryWalls.find((wall) => (wall.measurementStartInsetMm || 0) > 0);
  draft = surveyGraph.addOpeningToWall(draft, openingWall.id, 'door');
  const floorWithOpening = surveyGraph.getActiveFloor(draft);
  const openingBefore = floorWithOpening.openings.at(-1);
  const openingWallBefore = surveyGraph.getWall(floorWithOpening, openingWall.id);
  const openingCoordinateBefore = openingBefore.centerOffsetMm +
    (openingWallBefore.measurementStartInsetMm || 0);

  const mergedDraft = surveyGraph.deleteWall(draft, sharedWallId);
  const mergedFloor = surveyGraph.getActiveFloor(mergedDraft);
  const mergedSpace = mergedFloor.spaces.find((space) => space.closed);
  const mergedScene = createScene(mergedDraft);
  const repairedWalls = insetBoundaryWalls.map((wall) => surveyGraph.getWall(mergedFloor, wall.id));
  const openingAfter = mergedFloor.openings.find((opening) => opening.id === openingBefore.id);
  const openingWallAfter = surveyGraph.getWall(mergedFloor, openingAfter.wallId);

  assert.equal(mergedFloor.spaces.filter((space) => space.closed).length, 1);
  assert.deepEqual(repairedWalls.map((wall) => wall.lengthMm).sort((a, b) => a - b), [2449, 2449]);
  assert.equal(repairedWalls.every((wall) => (
    (wall.measurementStartInsetMm || 0) === 0 && (wall.measurementEndInsetMm || 0) === 0
  )), true);
  assert.equal(
    openingAfter.centerOffsetMm + (openingWallAfter.measurementStartInsetMm || 0),
    openingCoordinateBefore
  );
  assert.equal(mergedScene.wallSolidPlans.closed.rings.length, 2);
  assert.equal(mergedScene.wallSolidPlans.closed.rings.every((ring) => ring.length === 4), true);
  repairedWalls.forEach((wall) => {
    const sceneWall = mergedScene.walls.find((item) => item.id === wall.id);
    if (sharedNodeIds.has(wall.startNodeId)) {
      assert.deepEqual(
        { xMm: sceneWall.start.xMm, yMm: sceneWall.start.yMm },
        { xMm: sceneWall.topologyStart.xMm, yMm: sceneWall.topologyStart.yMm }
      );
    }
    if (sharedNodeIds.has(wall.endNodeId)) {
      assert.deepEqual(
        { xMm: sceneWall.end.xMm, yMm: sceneWall.end.yMm },
        { xMm: sceneWall.topologyEnd.xMm, yMm: sceneWall.topologyEnd.yMm }
      );
    }
  });
  assert.deepEqual(surveyGraph.buildSpaceDimensionPlan(mergedFloor, mergedSpace).inner, {
    widthMm: 4172,
    heightMm: 3827,
    areaMm2: 15966244
  });
});

test('stepped straight-wall closure guide renders the inferred right-angle path', () => {
  const draft = createSteppedClosureDraft();
  const scene = createScene(draft);

  assert.ok(scene.closureGuide);
  assert.equal(scene.closureGuide.points.length, 3);
  assert.equal(scene.closureGuide.points[0].y, scene.closureGuide.points[1].y);
  assert.equal(scene.closureGuide.points[1].x, scene.closureGuide.points[2].x);
  assert.notEqual(scene.closureGuide.points[0].x, scene.closureGuide.points[2].x);
  assert.notEqual(scene.closureGuide.points[0].y, scene.closureGuide.points[2].y);
});

test('closed-room second-wall outer snap stays on the rendered exterior edge across zoom levels', () => {
  let draft = createClosedRectangleDraft();
  let floor = surveyGraph.getActiveFloor(draft);
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    { xMm: 0, yMm: 2000 },
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  draft = surveyGraph.snapCursorToWall(
    surveyGraph.startWallSnap(draft),
    target.pointMm,
    target
  );
  draft = commitWall(draft, { xMm: 0, yMm: 5000 }, 3000);
  draft = surveyGraph.startPreview(draft, { xMm: 3170, yMm: 5200 });
  [0.05, 0.12, 0.24].forEach((scale) => {
    const scene = createScene(draft, { scale, offsetX: 0, offsetY: 0 });
    const rightWall = scene.walls.find((wall) => (
      Math.abs(wall.start.xMm - wall.end.xMm) < 0.1 && wall.start.xMm > 0
    ));

    assert.equal(scene.closureGuide, null);
    assert.ok(scene.alignmentSnapGuide);
    assert.ok(scene.cursor);
    assert.ok(scene.previewWall);
    assert.ok(rightWall);
    assert.equal(scene.alignmentSnapGuide.snapLine, 'outer');
    assert.equal(scene.alignmentSnapGuide.startPoint.x, rightWall.outerEnd.x);
    assert.equal(scene.alignmentSnapGuide.endPoint.x, rightWall.outerEnd.x);
    assert.equal(scene.cursor.point.x, rightWall.outerEnd.x);
    assert.equal(scene.previewWall.endPoint.x, rightWall.outerEnd.x);
  });
});

test('distant vertex-axis snapping renders a guide from the closed-room corner to the preview endpoint', () => {
  let draft = createClosedRectangleDraft();
  const closedFloor = surveyGraph.getActiveFloor(draft);
  const sourceGeometry = surveyGraph.buildWallRenderGeometry(closedFloor, closedFloor.walls[0]);
  const targetX = sourceGeometry.outerStart.xMm;
  const targetY = sourceGeometry.outerStart.yMm + 5402;

  draft = surveyGraph.placeNewWallChainCursor(
    surveyGraph.startWallSnap(draft),
    { xMm: targetX + 1062, yMm: targetY }
  );
  draft = surveyGraph.startPreview(draft, { xMm: targetX + 70, yMm: targetY });

  const scene = createScene(draft);
  assert.ok(scene.alignmentSnapGuide);
  assert.equal(scene.alignmentSnapGuide.type, 'vertex-axis');
  assert.equal(scene.alignmentSnapGuide.startPoint.x, scene.alignmentSnapGuide.endPoint.x);
  assert.notEqual(scene.alignmentSnapGuide.startPoint.y, scene.alignmentSnapGuide.endPoint.y);
  assert.equal(scene.previewWall.endPoint.x, scene.alignmentSnapGuide.endPoint.x);
});

test('inner shared-wall preview keeps one cursor on the inset measurement endpoint across zoom levels', () => {
  const draft = createSharedWallInsetClosureDraft();
  const floor = surveyGraph.getActiveFloor(draft);

  assert.equal(floor.session.closeCandidateType, 'shared-wall');
  assert.equal(floor.session.previewMeasurementEndInsetMm, 200);

  [0.05, 0.12, 0.24].forEach((scale) => {
    const scene = createScene(draft, { scale, offsetX: 0, offsetY: 0 });
    const recorder = createRecordingContext();
    surveyCanvasRenderer.drawSurveyScene(recorder.context, scene, { dpr: 1 });

    assert.ok(scene.cursor);
    assert.ok(scene.activeSegment);
    assert.deepEqual(scene.cursor.point, scene.activeSegment.measurementEndPoint);
    assert.deepEqual(scene.cursor.guidePoint, scene.activeSegment.measurementStartPoint);

    const activeAxes = recorder.strokeDetails.filter((detail) => (
      detail.strokeStyle === 'rgba(0, 126, 220, 0.92)'
    ));
    const cursorAxes = recorder.strokeDetails.filter((detail) => (
      detail.strokeStyle === 'rgba(22, 119, 255, 0.92)'
    ));
    assert.equal(activeAxes.length, 0);
    assert.equal(cursorAxes.length, 1);
    assert.deepEqual(cursorAxes[0].path, [
      ['moveTo', 0, scene.cursor.guidePoint.y],
      ['lineTo', scene.rect.width, scene.cursor.guidePoint.y],
      ['moveTo', scene.cursor.guidePoint.x, 0],
      ['lineTo', scene.cursor.guidePoint.x, scene.rect.height]
    ]);
  });
});

test('window walls retain clear-room and building totals without a positioning chain', () => {
  let draft = createClosedRectangleDraft();
  const firstWallId = surveyGraph.getActiveFloor(draft).walls[0].id;
  draft = surveyGraph.addOpeningToWall(draft, firstWallId, 'window');
  const scene = createScene(draft);

  assert.equal(scene.dimensions.filter((dimension) => dimension.kind === 'room-clear').length, 4);
  assert.equal(scene.dimensions.filter((dimension) => dimension.kind === 'building-overall').length, 4);
  assert.equal(scene.dimensions.some((dimension) => dimension.kind === 'opening-segment'), false);
});

test('door leaf and opposite-side frame strip remain closed rectangles on horizontal and vertical walls', () => {
  [0, 1].forEach((wallIndex) => {
    ['inside', 'outside'].forEach((openDirection) => {
      let draft = createClosedRectangleDraft();
      const wallId = surveyGraph.getActiveFloor(draft).walls[wallIndex].id;
      draft = surveyGraph.addOpeningToWall(draft, wallId, 'door');
      const openingId = surveyGraph.getActiveFloor(draft).openings[0].id;
      draft = surveyGraph.updateOpening(draft, openingId, { openDirection });
      const scene = createScene(draft);
      const opening = scene.openings[0];
      const recorder = createRecordingContext();

      surveyCanvasRenderer.drawSurveyScene(recorder.context, scene, { dpr: 1 });

      const doorStrokes = recorder.strokeDetails.filter((detail) => detail.strokeStyle === '#f07a21');
      const frameDepth = Math.min(
        Math.max(3.5, opening.wall.thicknessPx * 0.2),
        Math.max(3.5, opening.widthPx * 0.1)
      );
      const hingeX = opening.startPx + frameDepth;
      const oppositeJambX = opening.endPx - frameDepth;
      const outsideSign = opening.wall.outerOffsetPx < 0 ? -1 : 1;
      const opensOutside = openDirection === 'outside';
      const swingSign = opensOutside ? outsideSign : -outsideSign;
      const frameFaceY = opensOutside ? 0 : opening.wall.outerOffsetPx;
      const frameInset = Math.min(
        Math.max(1.5, Math.abs(opening.wall.outerOffsetPx) * 0.12),
        Math.max(1.5, Math.abs(opening.wall.outerOffsetPx) / 2 - 1)
      );
      const towardOtherFace = frameFaceY === opening.wall.outerOffsetPx ? -outsideSign : outsideSign;
      const leafSeatY = frameFaceY + towardOtherFace * frameInset;
      const leafThickness = Math.abs(frameFaceY - leafSeatY);
      const leafTipY = leafSeatY + swingSign * (oppositeJambX - hingeX);
      const expectedLeafPath = [
        ['moveTo', hingeX, leafSeatY],
        ['lineTo', hingeX, leafTipY],
        ['lineTo', hingeX + leafThickness, leafTipY],
        ['lineTo', hingeX + leafThickness, leafSeatY],
        ['closePath']
      ];
      const leaf = doorStrokes.find((detail) => (
        JSON.stringify(detail.path) === JSON.stringify(expectedLeafPath)
      ));
      const casingRectangles = [
        [opening.startPx, hingeX],
        [oppositeJambX, opening.endPx]
      ].filter(([outerX, innerX]) => doorStrokes.some((detail) => (
        detail.path.some((command) => command[0] === 'moveTo' && command[1] === outerX && command[2] === opening.wall.outerOffsetPx) &&
        detail.path.some((command) => command[0] === 'lineTo' && command[1] === innerX && command[2] === opening.wall.outerOffsetPx) &&
        detail.path.some((command) => command[0] === 'lineTo' && command[1] === innerX && command[2] === 0) &&
        detail.path.some((command) => command[0] === 'lineTo' && command[1] === outerX && command[2] === 0) &&
        detail.path.some((command) => command[0] === 'closePath')
      )));
      const toCanvas = (x, y) => ({
        x: opening.wall.startPoint.x + opening.wall.direction.x * x + opening.wall.localY.x * y,
        y: opening.wall.startPoint.y + opening.wall.direction.y * x + opening.wall.localY.y * y
      });
      const faceStart = toCanvas(hingeX, frameFaceY);
      const faceEnd = toCanvas(oppositeJambX, frameFaceY);
      const seatEnd = toCanvas(oppositeJambX, leafSeatY);
      const seatStart = toCanvas(hingeX, leafSeatY);
      const expectedFrameStripPath = [
        ['moveTo', faceStart.x, faceStart.y],
        ['lineTo', faceEnd.x, faceEnd.y],
        ['lineTo', seatEnd.x, seatEnd.y],
        ['lineTo', seatStart.x, seatStart.y],
        ['closePath']
      ];
      const innerFrameStrip = doorStrokes.find((detail) => (
        JSON.stringify(detail.path) === JSON.stringify(expectedFrameStripPath)
      ));

      assert.ok(leaf, 'the open door leaf should be a two-edge closed rectangle');
      assert.equal(casingRectangles.length, 2, 'each door jamb should be a closed mitered casing rectangle');
      assert.ok(innerFrameStrip, 'the outlined frame strip should connect the two casing rectangles');
      assert.equal(
        frameFaceY,
        opensOutside ? 0 : opening.wall.outerOffsetPx,
        'the frame strip should sit on the wall face opposite the door swing'
      );
    });
  });
});

test('window rails and mullions span the physical wall thickness', () => {
  let draft = createClosedRectangleDraft();
  const wallId = surveyGraph.getActiveFloor(draft).walls[0].id;
  draft = surveyGraph.addOpeningToWall(draft, wallId, 'window');
  const scene = createScene(draft);
  const opening = scene.openings[0];
  const recorder = createRecordingContext();

  surveyCanvasRenderer.drawSurveyScene(recorder.context, scene, { dpr: 1 });

  const windowStrokes = recorder.strokeDetails.filter((detail) => detail.strokeStyle === '#f07a21');
  const jamb = windowStrokes.find((detail) => detail.path.some((command) => (
    command[0] === 'moveTo' && command[1] === opening.startPx && command[2] === opening.wall.outerOffsetPx
  )) && detail.path.some((command) => (
    command[0] === 'lineTo' && command[1] === opening.startPx && command[2] === 0
  )));
  const rails = windowStrokes.filter((detail) => detail.path.some((command) => (
    command[0] === 'moveTo' && command[1] === opening.startPx
  )) && detail.path.some((command) => (
    command[0] === 'lineTo' && command[1] === opening.endPx
  )));
  const railYs = rails.map((detail) => detail.path.find((command) => command[0] === 'moveTo')[2]);

  assert.ok(jamb, 'window frame should bridge the inside and outside wall faces');
  assert.equal(rails.length, 3, 'window should retain its detailed three-rail CAD symbol');
  assert.ok(railYs.includes(opening.wall.outerOffsetPx), 'outer window rail must equal the rendered outer wall face');
  assert.ok(railYs.includes(0), 'inner window rail must equal the rendered inner wall face');
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
  const firstArrow = arrowFills[0];
  const secondArrow = arrowFills[1];
  assert.ok(firstArrow[0][1] < firstArrow[1][1]);
  assert.ok(secondArrow[0][1] > secondArrow[1][1]);
  assert.equal(firstArrow[0][1], 0);
  assert.equal(secondArrow[0][1], scene.dimensions[0].wall.widthPx);
  assert.ok(recorder.widths.includes(1));
  assert.ok(recorder.widths.includes(1.25));
  assert.ok(recorder.widths.includes(1.5));
  assert.deepEqual(recorder.dashes.filter((dash) => dash.length), [[8, 6], [8, 6], [12, 10]]);
  const orangeGuides = recorder.strokeDetails.filter((detail) => detail.strokeStyle === '#f07a21');
  assert.equal(orangeGuides.length, 2);
  const lastGuideStroke = recorder.strokeDetails.findLastIndex((detail) => (
    detail.strokeStyle === 'rgba(22, 119, 255, 0.92)'
  ));
  const lastRedlineStroke = recorder.strokeDetails.findLastIndex((detail) => (
    detail.strokeStyle === '#d71920'
  ));
  assert.ok(lastRedlineStroke > lastGuideStroke);
  assert.equal(recorder.strokes.some((path) => (
    path.length === 2 &&
    path[0][0] === 'moveTo' &&
    path[1][0] === 'lineTo' &&
    Math.abs(path[1][1] - path[0][1]) === 8 &&
    Math.abs(path[1][2] - path[0][2]) === 8
  )), false);
});

test('wall dimensions use blue values on a neutral backing plate', () => {
  const scene = createScene(createOpenDraft());
  const recorder = createRecordingContext();

  surveyCanvasRenderer.drawSurveyScene(recorder.context, scene, { dpr: 1 });

  const dimensionTexts = recorder.texts.filter((detail) => detail.text === '3000' || detail.text === '2000');
  assert.equal(dimensionTexts.length, scene.dimensions.length);
  assert.ok(dimensionTexts.every((detail) => (
    detail.fillStyle === '#0077d7' && detail.font === '600 14px sans-serif'
  )));
  assert.ok(recorder.fillRectDetails.some((detail) => (
    detail.fillStyle === 'rgba(210, 210, 210, 0.96)' && detail.height === 18
  )));
});

test('dimension endpoint ticks float clear of the measured wall', () => {
  const scene = createScene(createOpenDraft());
  const recorder = createRecordingContext();

  surveyCanvasRenderer.drawSurveyScene(recorder.context, scene, { dpr: 1 });

  const dimensionStrokes = recorder.strokeDetails.filter((detail) => detail.strokeStyle === '#333333');
  assert.ok(dimensionStrokes.length > 0);
  assert.equal(dimensionStrokes.some((detail) => detail.path.some((command) => (
    command[0] === 'moveTo' && command[2] === 0
  ))), false);
  assert.equal(dimensionStrokes.some((detail) => detail.path.some((command) => (
    command[0] === 'moveTo' && Math.abs(command[2] - 32) === 8
  ))), true);
});

test('free drag renders only the moving green cursor without a following blue guide', () => {
  const recorder = createRecordingContext();
  surveyCanvasRenderer.drawDraggingCursor(
    recorder.context,
    { width: 400, height: 500 },
    { x: 180, y: 220 },
    { dpr: 1 }
  );

  assert.deepEqual(recorder.dashes.filter((dash) => dash.length), []);
  assert.equal(recorder.widths.includes(3), false);
  assert.ok(recorder.strokeDetails.some((detail) => detail.strokeStyle === '#22c55e'));
  assert.ok(recorder.fillRectDetails.some((detail) => detail.fillStyle === 'rgba(34, 197, 94, 0.16)'));
  assert.equal(recorder.strokeDetails.some((detail) => detail.strokeStyle === '#f07a21'), false);
  assert.equal(recorder.strokes.some((path) => (
    path.some((command) => command[0] === 'moveTo' && command[1] === 0 && command[2] === 220) &&
    path.some((command) => command[0] === 'lineTo' && command[1] === 400 && command[2] === 220)
  )), false);
  assert.equal(recorder.strokes.some((path) => (
    path.some((command) => command[0] === 'arc')
  )), false);
});

test('canvas cursor drag suppresses the transient green cursor and guides', () => {
  const recorder = createRecordingContext();
  surveyCanvasRenderer.drawDraggingCursor(
    recorder.context,
    { width: 400, height: 500 },
    { x: 180, y: 220 },
    { dpr: 1, showCursor: false }
  );

  assert.equal(recorder.strokeDetails.some((detail) => detail.strokeStyle === '#22c55e'), false);
  assert.equal(recorder.fillRectDetails.some((detail) => detail.fillStyle === 'rgba(34, 197, 94, 0.16)'), false);
  assert.deepEqual(recorder.dashes.filter((dash) => dash.length), []);
});

test('drag-only canvas uses an orange dashed axis only for an active snap', () => {
  const recorder = createRecordingContext();
  surveyCanvasRenderer.drawDraggingCursor(
    recorder.context,
    { width: 400, height: 500 },
    { x: 180, y: 220 },
    {
      dpr: 1,
      snapGuide: {
        axis: 'x',
        point: { x: 180, y: 220 }
      }
    }
  );

  assert.deepEqual(recorder.dashes.filter((dash) => dash.length), [[8, 6]]);
  const orangeGuide = recorder.strokeDetails.find((detail) => detail.strokeStyle === '#f07a21');
  assert.deepEqual(orangeGuide.path, [
    ['moveTo', 180, 0],
    ['lineTo', 180, 500]
  ]);
  assert.equal(recorder.strokeDetails.some((detail) => (
    detail.strokeStyle === 'rgba(22, 119, 255, 0.92)'
  )), false);
});

test('drag-only wall snap renders only the orange constrained wall path', () => {
  const recorder = createRecordingContext();
  surveyCanvasRenderer.drawDraggingCursor(
    recorder.context,
    { width: 400, height: 500 },
    { x: 180, y: 220 },
    {
      dpr: 1,
      snapGuide: {
        startPoint: { x: 80, y: 120 },
        endPoint: { x: 280, y: 120 }
      }
    }
  );

  assert.deepEqual(recorder.dashes.filter((dash) => dash.length), [[8, 6]]);
  const orangeGuides = recorder.strokeDetails.filter((detail) => detail.strokeStyle === '#f07a21');
  assert.equal(orangeGuides.length, 1);
  assert.equal(orangeGuides[0].path.length, 2);
  assert.equal(orangeGuides[0].path[0][2], 120);
  assert.equal(orangeGuides[0].path[1][2], 120);
});

test('drag-only vertex snap renders the two orange constrained axes', () => {
  const recorder = createRecordingContext();
  surveyCanvasRenderer.drawDraggingCursor(
    recorder.context,
    { width: 400, height: 500 },
    { x: 180, y: 220 },
    {
      dpr: 1,
      snapGuide: {
        axis: 'both',
        point: { x: 180, y: 220 }
      }
    }
  );

  const orangeGuide = recorder.strokeDetails.find((detail) => detail.strokeStyle === '#f07a21');
  assert.deepEqual(orangeGuide.path, [
    ['moveTo', 180, 0],
    ['lineTo', 180, 500],
    ['moveTo', 0, 220],
    ['lineTo', 400, 220]
  ]);
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
      lensRect: { left: 20, top: 98, size: 180 },
      lensMeta: { snapLabel: '自由放置', coordinateLabel: 'X 3000 / Y 1000' }
    }
  );
  assert.ok(recorder.fills.length > 0);
  assert.ok(recorder.strokes.length > 0);
  assert.ok(recorder.strokeDetails.some((detail) => (
    detail.strokeStyle === '#22c55e' &&
    detail.path.some((command) => command[0] === 'moveTo' && command[1] === 98 && command[2] === 188) &&
    detail.path.some((command) => command[0] === 'lineTo' && command[1] === 122 && command[2] === 188)
  )));
  assert.ok(recorder.texts.some((detail) => detail.text === '自由放置'));
  assert.ok(recorder.texts.some((detail) => detail.text === 'X 3000 / Y 1000'));
  assert.ok(recorder.strokeDetails.some((detail) => (
    detail.strokeStyle === 'rgba(22, 119, 255, 0.92)' &&
    detail.path.some((command) => command[0] === 'moveTo' && command[1] === 0 && command[2] === 90) &&
    detail.path.some((command) => command[0] === 'lineTo' && command[1] === 180 && command[2] === 90) &&
    detail.path.some((command) => command[0] === 'moveTo' && command[1] === 90 && command[2] === 0) &&
    detail.path.some((command) => command[0] === 'lineTo' && command[1] === 90 && command[2] === 180)
  )));
});

test('closed dimensions use quiet permanent labels instead of the live blue treatment', () => {
  const scene = createScene(createClosedRectangleDraft());
  const recorder = createRecordingContext();

  surveyCanvasRenderer.drawSurveyScene(recorder.context, scene, { dpr: 1 });

  assert.equal(scene.dimensions.every((dimension) => dimension.visualRole === 'permanent'), true);
  const dimensionTexts = recorder.texts.filter((detail) => (
    scene.dimensions.some((dimension) => dimension.label === detail.text)
  ));
  assert.equal(dimensionTexts.length, scene.dimensions.length);
  assert.ok(dimensionTexts.every((detail) => (
    detail.fillStyle === '#374151' && /^(500|600) 12px sans-serif$/.test(detail.font)
  )));
  assert.ok(recorder.fillRectDetails.some((detail) => (
    detail.fillStyle === 'rgba(255, 255, 255, 0.92)' && detail.height === 15
  )));
  assert.equal(dimensionTexts.some((detail) => detail.fillStyle === '#0077d7'), false);
});

test('closed dimensions use fixed short extensions and centered 4px 60-degree slashes', () => {
  const scene = createScene(createClosedRectangleDraft());
  const recorder = createRecordingContext();

  surveyCanvasRenderer.drawSurveyScene(recorder.context, scene, { dpr: 1 });

  const permanentStrokes = recorder.strokeDetails.filter((detail) => (
    detail.strokeStyle === 'rgba(75, 85, 99, 0.76)'
  ));
  const permanentPath = permanentStrokes.find((detail) => detail.path.some((command, index, path) => {
    if (command[0] !== 'lineTo' || index === 0 || path[index - 1][0] !== 'moveTo') return false;
    const start = path[index - 1];
    const run = Math.abs(command[1] - start[1]);
    const rise = Math.abs(command[2] - start[2]);
    return run > 0 && Math.abs(rise / run - Math.sqrt(3)) < 0.001;
  }));
  assert.ok(permanentPath);
  const segments = permanentPath.path.flatMap((command, index, path) => {
    if (command[0] !== 'lineTo' || index === 0 || path[index - 1][0] !== 'moveTo') return [];
    return [{ start: path[index - 1], end: command }];
  });
  const slashes = segments.filter((segment) => {
    const run = Math.abs(segment.end[1] - segment.start[1]);
    const rise = Math.abs(segment.end[2] - segment.start[2]);
    return run > 0 && Math.abs(rise / run - Math.sqrt(3)) < 0.001;
  });
  const extensions = segments.filter((segment) => (
    Math.abs(segment.end[1] - segment.start[1]) < 0.001 &&
    Math.abs(segment.end[2] - segment.start[2]) > 8
  ));
  assert.ok(extensions.length >= 2);
  assert.ok(extensions.every((extension) => (
    Math.abs(extension.end[2] - extension.start[2]) <= 18.001
  )));
  assert.ok(slashes.every((slash) => (
    Math.hypot(slash.end[1] - slash.start[1], slash.end[2] - slash.start[2]) <= 4.001
  )));
  assert.ok(slashes.every((slash) => extensions.some((extension) => (
    Math.abs((slash.start[1] + slash.end[1]) / 2 - extension.end[1]) < 0.001 &&
    Math.abs((slash.start[2] + slash.end[2]) / 2 - extension.end[2]) < 0.001
  ))));
  assert.equal(recorder.fills.some((path) => (
    path.filter((command) => command[0] === 'lineTo').length === 2 &&
    path.some((command) => command[0] === 'closePath')
  )), false);
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
  const sourcePolygonPoint = scene.wallSolidPlans.closed.polygons[0][0];
  const projectedPolygonPoint = interactionScene.wallSolidPlans.closed.polygons[0][0];
  const sourceBoundaryStart = scene.wallSolidPlan.segments[0].start;
  const projectedBoundaryStart = interactionScene.wallSolidPlan.segments[0].start;
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
  assert.deepEqual(projectedPolygonPoint, {
    x: sourcePolygonPoint.x * transform.scale + transform.translateX,
    y: sourcePolygonPoint.y * transform.scale + transform.translateY
  });
  assert.deepEqual(projectedBoundaryStart, {
    x: sourceBoundaryStart.x * transform.scale + transform.translateX,
    y: sourceBoundaryStart.y * transform.scale + transform.translateY
  });
  assert.deepEqual(projectedOpening.center, {
    x: sourceOpening.center.x * transform.scale + transform.translateX,
    y: sourceOpening.center.y * transform.scale + transform.translateY
  });
  assert.equal(projectedOpening.wall, interactionScene.walls.find((wall) => wall.id === sourceOpening.wall.id));
});

test('stationary canvas cursor uses the same green placement marker', () => {
  const recorder = createRecordingContext();
  const scene = createScene(createOpenDraft());

  surveyCanvasRenderer.drawSurveyScene(recorder.context, scene, { dpr: 1 });

  assert.ok(scene.cursor);
  assert.ok(recorder.strokeDetails.some((detail) => detail.strokeStyle === '#22c55e'));
  assert.ok(recorder.fillRectDetails.some((detail) => detail.fillStyle === 'rgba(34, 197, 94, 0.16)'));
});

test('stationary canvas cursor stays on the visible outer corner after an outer snap', () => {
  const closedDraft = createClosedRectangleDraft();
  const floor = surveyGraph.getActiveFloor(closedDraft);
  const wall = floor.walls[0];
  const geometry = surveyGraph.buildWallRenderGeometry(floor, wall);
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    geometry.outerStart,
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  const snappedDraft = surveyGraph.snapCursorToWall(
    surveyGraph.startWallSnap(closedDraft),
    target.pointMm,
    target
  );
  const scene = createScene(snappedDraft);
  const snappedFloor = surveyGraph.getActiveFloor(snappedDraft);
  const expectedMm = surveyGraph.getCursorDisplayPoint(snappedFloor, snappedFloor.session);
  const viewport = scene.viewport;

  assert.deepEqual(scene.cursor.point, {
    x: scene.rect.width / 2 + viewport.offsetX + expectedMm.xMm * viewport.scale,
    y: scene.rect.height / 2 + viewport.offsetY + expectedMm.yMm * viewport.scale
  });
  assert.notDeepEqual(expectedMm, surveyGraph.getNode(snappedFloor, snappedFloor.session.anchorNodeId));
  assert.deepEqual(expectedMm, geometry.outerStart);
});

test('an outer-corner continuation preview aligns its wall body with the adjacent wall', () => {
  const closedDraft = createClosedRectangleDraft();
  const floor = surveyGraph.getActiveFloor(closedDraft);
  const topWall = floor.walls[0];
  const outerCorner = surveyGraph.buildWallRenderGeometry(floor, topWall).outerStart;
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    outerCorner,
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  let previewDraft = surveyGraph.snapCursorToWall(
    surveyGraph.startWallSnap(closedDraft),
    target.pointMm,
    target
  );
  previewDraft = surveyGraph.startPreview(previewDraft, { xMm: -2200, yMm: 0 });
  const scene = createScene(previewDraft);
  const renderedTopWall = scene.walls.find((wall) => wall.id === topWall.id);

  assert.equal(scene.previewWall.measurementSide, 'right');
  assert.equal(scene.previewWall.measurementFace, 'inner');
  assert.deepEqual(scene.previewWall.measurementStartPoint, scene.previewWall.startPoint);
  assert.deepEqual(scene.previewWall.measurementEndPoint, scene.previewWall.endPoint);
  assert.deepEqual(scene.cursor.point, scene.previewWall.measurementEndPoint);
  assert.equal(scene.previewWall.rawOuterStart.y, renderedTopWall.rawOuterStart.y);
  assert.equal(scene.previewWall.rawOuterEnd.y, renderedTopWall.rawOuterEnd.y);
});

test('an outer-corner committed wall keeps its redline and live dimension on the dragged working line', () => {
  const closedDraft = createClosedRectangleDraft();
  const floor = surveyGraph.getActiveFloor(closedDraft);
  const topWall = floor.walls[0];
  const outerCorner = surveyGraph.buildWallRenderGeometry(floor, topWall).outerStart;
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    outerCorner,
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  let draft = surveyGraph.snapCursorToWall(
    surveyGraph.startWallSnap(closedDraft),
    target.pointMm,
    target
  );
  draft = commitWall(draft, { xMm: -2200, yMm: 0 }, 2000);
  const scene = createScene(draft);
  const activeWall = scene.walls.find((wall) => wall.isActiveMeasurement);
  const liveDimension = scene.dimensions.find((dimension) => dimension.wall === activeWall);
  const recorder = createRecordingContext();

  surveyCanvasRenderer.drawSurveyScene(recorder.context, scene, { dpr: 1 });

  assert.ok(activeWall);
  assert.equal(activeWall.measurementFace, 'inner');
  assert.deepEqual(activeWall.measurementStartPoint, activeWall.startPoint);
  assert.deepEqual(activeWall.measurementEndPoint, activeWall.endPoint);
  assert.deepEqual(scene.cursor.point, activeWall.measurementEndPoint);
  assert.equal(liveDimension.visualRole, 'live');
  assert.equal(liveDimension.measurementFace, 'inner');
  assert.equal(liveDimension.startY, 0);
  assert.ok(recorder.strokeDetails.some((detail) => (
    detail.strokeStyle === '#d71920' &&
    detail.path.some((command) => (
      command[0] === 'moveTo' &&
      command[1] === activeWall.measurementStartPoint.x &&
      command[2] === activeWall.measurementStartPoint.y
    )) &&
    detail.path.some((command) => (
      command[0] === 'lineTo' &&
      command[1] === activeWall.measurementEndPoint.x &&
      command[2] === activeWall.measurementEndPoint.y
    ))
  )));
});

test('an active wall pulled from a closed room moves permanent dimensions outside the wall body', () => {
  const closedDraft = createClosedRectangleDraft();
  const floor = surveyGraph.getActiveFloor(closedDraft);
  const topWall = floor.walls[0];
  const outerCorner = surveyGraph.buildWallRenderGeometry(floor, topWall).outerStart;
  const target = surveyGraph.getCursorPlacementTarget(floor, outerCorner, surveyGraph.CLOSE_TOLERANCE_MM);
  let draft = surveyGraph.snapCursorToWall(surveyGraph.startWallSnap(closedDraft), target.pointMm, target);
  draft = commitWall(draft, { xMm: -2200, yMm: 0 }, 2000);
  const scene = createScene(draft);
  const activeWall = scene.walls.find((wall) => wall.isActiveMeasurement);
  const leftDimensions = scene.dimensions.filter((dimension) => (
    dimension.visualRole === 'permanent' && dimension.normal.x === -1
  ));

  assert.ok(activeWall);
  assert.ok(leftDimensions.length > 0);
  const activeLeft = Math.min(activeWall.startPoint.x, activeWall.endPoint.x, activeWall.outerStart.x, activeWall.outerEnd.x);
  leftDimensions.forEach((dimension) => {
    assert.ok(dimension.startPoint.x < activeLeft);
    assert.ok(dimension.endPoint.x < activeLeft);
  });
});

test('an outer-corner L chain keeps horizontal and vertical live dimensions on the dragged working line', () => {
  const closedDraft = createClosedRectangleDraft();
  const floor = surveyGraph.getActiveFloor(closedDraft);
  const topWall = floor.walls[0];
  const outerCorner = surveyGraph.buildWallRenderGeometry(floor, topWall).outerStart;
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    outerCorner,
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  let draft = surveyGraph.snapCursorToWall(
    surveyGraph.startWallSnap(closedDraft),
    target.pointMm,
    target
  );
  draft = commitWall(draft, { xMm: -2200, yMm: 0 }, 2000);
  draft = commitWall(draft, { xMm: -2200, yMm: 2000 }, 2000);
  const scene = createScene(draft);
  const activeWalls = scene.walls.filter((wall) => wall.isActiveMeasurement);
  const liveDimensions = scene.dimensions.filter((dimension) => dimension.visualRole === 'live');

  assert.equal(activeWalls.length, 2);
  assert.equal(liveDimensions.length, 2);
  assert.equal(activeWalls.every((wall) => wall.measurementFace === 'inner'), true);
  assert.equal(liveDimensions.every((dimension) => dimension.measurementFace === 'inner'), true);
  liveDimensions.forEach((dimension) => {
    assert.equal(dimension.startY, 0);
  });
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

  assert.equal(after.activeSegment, null);
  assert.ok(after.cursor);
  assert.deepEqual(after.closedSpaceFills, before.closedSpaceFills);
  assert.deepEqual(
    normalizeRingPlan(after.wallSolidPlan.rings),
    normalizeRingPlan(before.wallSolidPlan.rings)
  );
  assert.deepEqual(
    normalizeRingPlan(after.wallSolidPlans.closed.rings),
    normalizeRingPlan(before.wallSolidPlans.closed.rings)
  );
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
    interactionRecorder.dashes.some((dash) => dash.length && dash[0] === 12 && dash[1] === 10),
    false
  );
});

test('formal and viewport wall rendering avoid compound fill paths at closed and T junctions', () => {
  [createClosedRectangleDraft(), createClosedCornerCollinearClosureDraft()].forEach((draft) => {
    const scene = createScene(draft);
    const formalRecorder = createRecordingContext();
    const interactionRecorder = createRecordingContext();

    surveyCanvasRenderer.drawSurveyScene(formalRecorder.context, scene, { dpr: 1 });
    surveyCanvasRenderer.drawSurveyInteractionScene(interactionRecorder.context, scene, {
      dpr: 1,
      baseViewport: scene.viewport,
      viewport: Object.assign({}, scene.viewport, {
        offsetX: scene.viewport.offsetX + 31,
        offsetY: scene.viewport.offsetY - 17
      })
    });

    [formalRecorder, interactionRecorder].forEach((recorder) => {
      assert.ok(recorder.fills.length > 0);
      assert.equal(recorder.fills.every((path) => (
        path.filter((command) => command[0] === 'moveTo').length <= 1
      )), true);
      const wallOutline = recorder.strokeDetails.find((detail) => detail.strokeStyle === '#1f1f1f');
      assert.ok(wallOutline);
      assert.equal(wallOutline.path.some((command) => command[0] === 'closePath'), false);
    });
  });
});

test('a completed source wall paints over its open T branch at the shared intersection', () => {
  let draft = createClosedRectangleDraft();
  let floor = surveyGraph.getActiveFloor(draft);
  const sourceWall = floor.walls[0];
  const sourceStart = surveyGraph.getNode(floor, sourceWall.startNodeId);
  const sourceEnd = surveyGraph.getNode(floor, sourceWall.endNodeId);
  const target = surveyGraph.getCursorPlacementTarget(floor, {
    xMm: Math.round((sourceStart.xMm + sourceEnd.xMm) / 2),
    yMm: Math.round((sourceStart.yMm + sourceEnd.yMm) / 2)
  }, surveyGraph.CLOSE_TOLERANCE_MM);
  draft = surveyGraph.snapCursorToWall(surveyGraph.startWallSnap(draft), target.pointMm, target);
  draft = commitWall(draft, { xMm: 1500, yMm: -2000 }, 2000);
  floor = surveyGraph.getActiveFloor(draft);
  const scene = createScene(draft);
  const recorder = createRecordingContext();

  surveyCanvasRenderer.drawSurveyScene(recorder.context, scene, { dpr: 1 });

  assert.ok(scene.walls.some((wall) => wall.closed));
  assert.ok(scene.walls.some((wall) => !wall.closed));
  const wallFills = recorder.fillDetails.filter((detail) => (
    detail.fillStyle === '#e2e2e0' || detail.fillStyle === '#8e8e8c'
  ));
  assert.ok(wallFills.length > 1);
  assert.equal(wallFills[0].fillStyle, '#e2e2e0');
  assert.equal(wallFills.at(-1).fillStyle, '#8e8e8c');
});

test('mixed T junctions underpaint the complete union before closed walls', () => {
  let draft = createClosedRectangleDraft();
  let floor = surveyGraph.getActiveFloor(draft);
  const sourceWall = floor.walls[0];
  const sourceStart = surveyGraph.getNode(floor, sourceWall.startNodeId);
  const sourceEnd = surveyGraph.getNode(floor, sourceWall.endNodeId);
  const target = surveyGraph.getCursorPlacementTarget(floor, {
    xMm: Math.round((sourceStart.xMm + sourceEnd.xMm) / 2),
    yMm: Math.round((sourceStart.yMm + sourceEnd.yMm) / 2)
  }, surveyGraph.CLOSE_TOLERANCE_MM);
  draft = surveyGraph.snapCursorToWall(surveyGraph.startWallSnap(draft), target.pointMm, target);
  draft = commitWall(draft, { xMm: 1500, yMm: -2000 }, 2000);
  const scene = createScene(draft);
  const recorder = createRecordingContext();

  surveyCanvasRenderer.drawSurveyScene(recorder.context, scene, { dpr: 1 });

  const wallFills = recorder.fillDetails.filter((detail) => (
    detail.fillStyle === '#e2e2e0' || detail.fillStyle === '#8e8e8c'
  ));
  assert.equal(
    wallFills.filter((detail) => detail.fillStyle === '#e2e2e0').length,
    scene.wallSolidPlan.polygons.length
  );
  assert.equal(
    wallFills.filter((detail) => detail.fillStyle === '#8e8e8c').length,
    scene.wallSolidPlans.closed.polygons.length
  );
  assert.ok(
    scene.wallSolidPlan.polygons.length >
      scene.wallSolidPlans.open.polygons.length + scene.wallSolidPlans.closed.polygons.length,
    'the complete union must contribute the cross-group junction patch'
  );
});

test('native wall outlines stroke each union segment independently', () => {
  const scene = createScene(createClosedCornerCollinearClosureDraft());
  const recorder = createRecordingContext();

  surveyCanvasRenderer.drawSurveyScene(recorder.context, scene, { dpr: 1 });

  const wallOutlines = recorder.strokeDetails.filter((detail) => detail.strokeStyle === '#1f1f1f');
  assert.equal(wallOutlines.length, scene.wallSolidPlan.segments.length);
  assert.equal(wallOutlines.every((detail) => (
    detail.path.filter((command) => command[0] === 'moveTo').length === 1 &&
    detail.path.filter((command) => command[0] === 'lineTo').length === 1
  )), true);
});

test('closed corners receive device-pixel scanline repairs after polygon fills', () => {
  const scene = createScene(createClosedRectangleDraft());
  const recorder = createRecordingContext();

  surveyCanvasRenderer.drawSurveyScene(recorder.context, scene, { dpr: 3 });

  assert.equal(scene.wallSolidPlan.joinPolygons.length, 4);
  const repairRects = recorder.fillRectDetails.filter((detail) => (
    detail.fillStyle === '#e2e2e0' || detail.fillStyle === '#8e8e8c'
  ));
  assert.ok(repairRects.length >= scene.wallSolidPlan.joinPolygons.length * 3);
  scene.wallSolidPlan.joinPolygons.forEach((polygon) => {
    const center = polygon.reduce((point, current) => ({
      x: point.x + current.x / polygon.length,
      y: point.y + current.y / polygon.length
    }), { x: 0, y: 0 });
    assert.equal(repairRects.some((rect) => (
      center.x >= rect.x && center.x <= rect.x + rect.width &&
      center.y >= rect.y && center.y <= rect.y + rect.height
    )), true, `missing scanline repair at ${JSON.stringify(center)}`);
  });
});

test('viewport interaction projects and repairs its junction polygons at the moved position', () => {
  const scene = createScene(createClosedRectangleDraft());
  const recorder = createRecordingContext();
  const viewport = Object.assign({}, scene.viewport, {
    offsetX: scene.viewport.offsetX + 41,
    offsetY: scene.viewport.offsetY - 23
  });

  surveyCanvasRenderer.drawSurveyInteractionScene(recorder.context, scene, {
    dpr: 2,
    baseViewport: scene.viewport,
    viewport
  });

  const repairRects = recorder.fillRectDetails.filter((detail) => detail.fillStyle === '#8e8e8c');
  assert.ok(repairRects.length > 0);
  const sourceCenter = scene.wallSolidPlan.joinPolygons[0].reduce((point, current) => ({
    x: point.x + current.x / scene.wallSolidPlan.joinPolygons[0].length,
    y: point.y + current.y / scene.wallSolidPlan.joinPolygons[0].length
  }), { x: 0, y: 0 });
  assert.equal(repairRects.some((rect) => (
    sourceCenter.x + 41 >= rect.x && sourceCenter.x + 41 <= rect.x + rect.width &&
    sourceCenter.y - 23 >= rect.y && sourceCenter.y - 23 <= rect.y + rect.height
  )), true);
});
