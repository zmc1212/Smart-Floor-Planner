const test = require('node:test');
const assert = require('node:assert/strict');
const surveyGraph = require('../packages/surveying/utils/surveyWallGraph.js');
const surveyCanvasRenderer = require('../packages/surveying/utils/surveyCanvasRenderer.js');

function commitWall(draft, point, length) {
  return surveyGraph.commitPreviewLength(
    surveyGraph.startPreview(draft, point),
    length,
    'manual'
  );
}

function commitPreviewTo(draft, point) {
  const preview = surveyGraph.startPreview(draft, point);
  const floor = surveyGraph.getActiveFloor(preview);
  return surveyGraph.commitPreviewLength(preview, floor.session.previewLengthMm, 'manual');
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

function createWideClosedRectangleDraft() {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  draft = commitWall(draft, { xMm: 6000, yMm: 0 }, 6000);
  draft = commitWall(draft, { xMm: 6000, yMm: 4000 }, 4000);
  draft = commitWall(draft, { xMm: 0, yMm: 4000 }, 6000);
  draft = commitWall(draft, { xMm: 0, yMm: 0 }, 4000);
  return surveyGraph.confirmClosure(draft);
}

function createMeasuredTClosureDraft(snapLine) {
  let draft = createWideClosedRectangleDraft();
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
  draft = commitWall(draft, { xMm: 3000, yMm: -2200 }, 2000);
  draft = commitWall(draft, { xMm: 4582, yMm: -2200 }, 1582);
  floor = surveyGraph.getActiveFloor(draft);
  const lengthsBeforeClosingWall = floor.walls
    .slice(floor.session.activeSpaceStartWallIndex)
    .map((wall) => wall.lengthMm);
  draft = commitWall(draft, { xMm: 4582, yMm: 0 }, 2000);

  return { draft, lengthsBeforeClosingWall };
}

function createClosedPolygonDraft(points) {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.placeCursor(draft, points[0]);
  points.slice(1).forEach((point) => {
    const preview = surveyGraph.startPreview(draft, point);
    const floor = surveyGraph.getActiveFloor(preview);
    draft = surveyGraph.commitPreviewLength(
      preview,
      floor.session.previewLengthMm,
      'manual'
    );
  });
  return surveyGraph.confirmClosure(draft);
}

function createPartitionedRectangleDraft() {
  let draft = createClosedRectangleDraft();
  let floor = surveyGraph.getActiveFloor(draft);
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    { xMm: 1500, yMm: 0 },
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  draft = surveyGraph.snapCursorToWall(
    surveyGraph.startWallSnap(draft),
    target.pointMm,
    target
  );
  draft = commitWall(draft, { xMm: 1500, yMm: 2000 }, 2000);
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

function createOuterFaceMidWallClosureDraft() {
  const thicknessMm = 200;
  const roomWidthMm = 3129;
  const roomHeightMm = 3565;
  const armWidthMm = 2454;
  const armJoinYMm = 1569;
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.setThickness(draft, thicknessMm);
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  draft = commitWall(draft, { xMm: roomWidthMm, yMm: 0 }, roomWidthMm);
  draft = commitWall(draft, { xMm: roomWidthMm, yMm: roomHeightMm }, roomHeightMm);
  draft = commitWall(draft, { xMm: 0, yMm: roomHeightMm }, roomWidthMm);
  draft = commitWall(draft, { xMm: 0, yMm: 0 }, roomHeightMm);
  draft = surveyGraph.confirmClosure(draft);

  const outerStart = { xMm: roomWidthMm + thicknessMm, yMm: -thicknessMm };
  const floor = surveyGraph.getActiveFloor(draft);
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    outerStart,
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  draft = surveyGraph.snapCursorToWall(
    surveyGraph.startWallSnap(draft),
    target.pointMm,
    target
  );
  draft = commitPreviewTo(draft, { xMm: outerStart.xMm + armWidthMm, yMm: outerStart.yMm });
  draft = commitPreviewTo(draft, { xMm: outerStart.xMm + armWidthMm, yMm: armJoinYMm });
  draft = surveyGraph.startPreview(draft, { xMm: outerStart.xMm, yMm: armJoinYMm });
  return surveyGraph.confirmClosure(draft);
}

function createInnerFaceAdjacentClosureDraft(snapPoint) {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.setThickness(draft, 200);
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  draft = commitWall(draft, { xMm: 6000, yMm: 0 }, 6000);
  draft = commitWall(draft, { xMm: 6000, yMm: 4000 }, 4000);
  draft = commitWall(draft, { xMm: 0, yMm: 4000 }, 6000);
  draft = commitWall(draft, { xMm: 0, yMm: 0 }, 4000);
  draft = surveyGraph.confirmClosure(draft);

  const floor = surveyGraph.getActiveFloor(draft);
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    snapPoint,
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  draft = surveyGraph.snapCursorToWall(
    surveyGraph.startWallSnap(draft),
    target.pointMm,
    target
  );
  draft = commitPreviewTo(draft, { xMm: 3000, yMm: -2000 });
  draft = commitPreviewTo(draft, { xMm: 6000, yMm: -2000 });
  draft = commitPreviewTo(draft, { xMm: 6000, yMm: 100 });
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

function closedDimensionPose(scene) {
  return (scene.dimensions || [])
    .filter((dimension) => dimension.kind === 'room-clear' || dimension.kind === 'building-overall')
    .map((dimension) => ({
      kind: dimension.kind,
      label: dimension.label,
      lane: dimension.lane,
      start: dimension.startPoint,
      end: dimension.endPoint,
      normal: dimension.normal
    }));
}

function projection(point, normal) {
  return point.x * normal.x + point.y * normal.y;
}

function createProtrudingAdjacentRoomDraft() {
  let draft = createWideClosedRectangleDraft();
  const floor = surveyGraph.getActiveFloor(draft);
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    { xMm: 6000, yMm: 0 },
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  draft = surveyGraph.snapCursorToWall(
    surveyGraph.startWallSnap(draft),
    target.pointMm,
    target
  );
  draft = commitWall(draft, { xMm: 6000, yMm: -1600 }, 1600);
  draft = commitWall(draft, { xMm: 3200, yMm: -1600 }, 2800);
  draft = commitWall(draft, { xMm: 3200, yMm: 0 }, 1600);
  return surveyGraph.confirmClosure(draft);
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

  const drawImages = [];
  const ops = [];
  const clearRects = [];
  const context = {
    save() {},
    restore() {},
    setTransform() {},
    clearRect(x, y, width, height) {
      clearRects.push({ x, y, width, height });
    },
    fillRect(x, y, width, height) {
      fillRectDetails.push({ x, y, width, height, fillStyle });
      ops.push({ type: 'fillRect', fillStyle });
    },
    strokeRect() {},
    translate() {},
    scale() {},
    rotate() {},
    clip() {},
    drawImage(...args) {
      drawImages.push(args);
      ops.push({ type: 'drawImage' });
    },
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
      ops.push({ type: 'stroke', strokeStyle, path: recordedPath, lineWidth });
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

  return { context, strokes, fills, dashes, widths, strokeDetails, fillDetails, fillRectDetails, texts, drawImages, ops, clearRects };
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

test('closed space creates building-overall bands while a new wall chain remains inner-only', () => {
  const closedDraft = createClosedRectangleDraft();
  const closedFloor = surveyGraph.getActiveFloor(closedDraft);
  const closedScene = createScene(closedDraft);

  assert.equal(closedScene.dimensions.filter((dimension) => dimension.kind === 'room-clear').length, 0);
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
  assert.equal(
    reversedSideScene.dimensions.filter((dimension) => dimension.kind === 'building-overall').length,
    4
  );

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

test('closed-space dimensions originate at the exterior wall face', () => {
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

test('closed dimensions ignore an in-flight wallPreview and clear a held or committed chain', () => {
  const closedDraft = createClosedRectangleDraft();
  const closedPose = closedDimensionPose(createScene(closedDraft));
  let floor = surveyGraph.getActiveFloor(closedDraft);
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    { xMm: 0, yMm: 2000 },
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  let draft = surveyGraph.snapCursorToWall(
    surveyGraph.startWallSnap(closedDraft),
    target.pointMm,
    target
  );
  draft = surveyGraph.startPreview(draft, { xMm: 0, yMm: 5000 });
  floor = surveyGraph.getActiveFloor(draft);
  assert.equal(floor.session.state, 'wallPreview');

  const previewScene = createScene(draft);
  assert.ok(previewScene.previewWall);
  assert.deepEqual(closedDimensionPose(previewScene), closedPose);

  const heldDraft = surveyGraph.holdPreviewForInput(draft);
  assert.equal(surveyGraph.getActiveFloor(heldDraft).session.state, 'awaitingLength');
  const heldPose = closedDimensionPose(createScene(heldDraft));
  assert.notDeepEqual(heldPose, closedPose);
  heldPose.filter((item) => item.normal && item.normal.y > 0.5).forEach((item) => {
    const closedItem = closedPose.find((entry) => (
      entry.kind === item.kind && entry.label === item.label && entry.lane === item.lane
    ));
    assert.ok(closedItem, `${item.kind} ${item.label} should still exist after hold`);
    assert.ok(
      projection(item.start, item.normal) > projection(closedItem.start, closedItem.normal) + 8,
      `${item.kind} ${item.label} should move past the held preview`
    );
  });

  const committedDraft = surveyGraph.commitPreviewLength(draft, 2800, 'manual');
  const committedPose = closedDimensionPose(createScene(committedDraft));
  assert.notDeepEqual(committedPose, closedPose);
  committedPose.filter((item) => item.normal && item.normal.y > 0.5).forEach((item) => {
    const closedItem = closedPose.find((entry) => (
      entry.kind === item.kind && entry.label === item.label && entry.lane === item.lane
    ));
    assert.ok(closedItem, `${item.kind} ${item.label} should still exist after commit`);
    assert.ok(
      projection(item.start, item.normal) > projection(closedItem.start, closedItem.normal) + 8,
      `${item.kind} ${item.label} should move past the committed wall`
    );
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

test('shared walls never receive exterior dimensions and adjacent rooms keep building-overall bands', () => {
  const scene = createScene(createTwoClosedRoomsWithSharedDoorDraft());
  const sharedWall = scene.walls.find((wall) => wall.id === 'wall-2');

  assert.equal(sharedWall.closed, true);
  assert.equal(sharedWall.isExteriorBoundary, false);
  assert.equal(scene.dimensions.some((dimension) => dimension.wall && dimension.wall.id === 'wall-2'), false);
  assert.equal(scene.dimensions.filter((dimension) => dimension.kind === 'building-overall').length, 4);
  assert.equal(scene.dimensions.filter((dimension) => dimension.kind === 'room-clear').length, 0);
  assert.equal(scene.dimensions.every((dimension) => !dimension.wall || dimension.wall.isExteriorBoundary), true);
});

test('closed door wall renders opening and building-overall lanes without room-clear', () => {
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
    dimension.kind === 'building-overall' && dimension.label === '3400' && dimension.lane >= 1
  ));

  assert.equal(roomDimension, undefined);
  assert.ok(buildingDimension.startPoint && buildingDimension.endPoint);
  assert.deepEqual(positioningDimensions.map((dimension) => dimension.label), ['1050', '900', '1050']);
  assert.equal(positioningDimensions.every((dimension) => dimension.lane < buildingDimension.lane), true);
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
  assert.equal(scene.dimensions.filter((dimension) => dimension.kind === 'room-clear').length, 0);

  // After the second room raises shared corners to degree 3, closed wall solids
  // must still reach topology nodes so the outer T does not lose a thickness gap.
  const leftWalls = scene.walls.filter((wall) => (
    Math.abs(wall.startPoint.x - wall.endPoint.x) < 0.01 &&
    Math.min(wall.solidOuterStart.x, wall.solidOuterEnd.x) <
      Math.min(wall.startPoint.x, wall.endPoint.x) - 1
  ));
  assert.ok(leftWalls.length >= 2);
  const leftOuterSpans = leftWalls.map((wall) => ({
    minY: Math.min(wall.solidOuterStart.y, wall.solidOuterEnd.y),
    maxY: Math.max(wall.solidOuterStart.y, wall.solidOuterEnd.y),
    x: Math.min(wall.solidOuterStart.x, wall.solidOuterEnd.x)
  })).sort((first, second) => first.minY - second.minY);
  assert.ok(
    leftOuterSpans[0].maxY + 0.05 >= leftOuterSpans[1].minY,
    JSON.stringify(leftOuterSpans)
  );

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

function findSharedWallIds(floor) {
  const wallUseCounts = {};
  (floor.spaces || []).filter((space) => space.closed).forEach((space) => {
    space.wallIds.forEach((wallId) => {
      wallUseCounts[wallId] = (wallUseCounts[wallId] || 0) + 1;
    });
  });
  return Object.keys(wallUseCounts).filter((wallId) => wallUseCounts[wallId] >= 2);
}

test('deleting the wall shared by two closed rooms merges their fill, label, and net area', () => {
  const draft = createAlignedAdjacentRoomDraft();
  const floor = surveyGraph.getActiveFloor(draft);
  const sharedWallId = findSharedWallIds(floor)[0];
  assert.ok(sharedWallId);

  const mergedDraft = surveyGraph.deleteWall(draft, sharedWallId);
  const mergedFloor = surveyGraph.getActiveFloor(mergedDraft);
  const mergedSpaces = mergedFloor.spaces.filter((space) => space.closed);
  const mergedScene = createScene(mergedDraft);

  assert.equal(mergedSpaces.length, 1);
  assert.ok(
    mergedSpaces[0].name === '\u623f\u95f41' || mergedSpaces[0].name === '\u623f\u95f42',
    mergedSpaces[0].name
  );
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

test('deleting one segment of a split shared wall punches through the collinear run and merges both rooms', () => {
  let draft = createAlignedAdjacentRoomDraft();
  let floor = surveyGraph.getActiveFloor(draft);
  const sharedWall = surveyGraph.getWall(floor, findSharedWallIds(floor)[0]);
  const start = surveyGraph.getNode(floor, sharedWall.startNodeId);
  const end = surveyGraph.getNode(floor, sharedWall.endNodeId);
  const mid = {
    xMm: Math.round((start.xMm + end.xMm) / 2),
    yMm: Math.round((start.yMm + end.yMm) / 2)
  };
  const target = surveyGraph.getCursorPlacementTarget(floor, mid, surveyGraph.CLOSE_TOLERANCE_MM);
  draft = surveyGraph.snapCursorToWall(surveyGraph.startWallSnap(draft), target.pointMm, target);
  const outward = {
    xMm: mid.xMm + Math.round(end.yMm - start.yMm) * 800 / sharedWall.lengthMm,
    yMm: mid.yMm - Math.round(end.xMm - start.xMm) * 800 / sharedWall.lengthMm
  };
  draft = commitWall(draft, outward, 800);
  floor = surveyGraph.getActiveFloor(draft);
  draft = surveyGraph.deleteWall(draft, floor.walls[floor.walls.length - 1].id);

  floor = surveyGraph.getActiveFloor(draft);
  const splitSharedIds = findSharedWallIds(floor);
  assert.equal(splitSharedIds.length, 2);
  assert.equal(floor.spaces.filter((space) => space.closed).length, 2);

  const mergedDraft = surveyGraph.deleteWall(draft, splitSharedIds[0]);
  const mergedFloor = surveyGraph.getActiveFloor(mergedDraft);
  const mergedSpaces = mergedFloor.spaces.filter((space) => space.closed);
  const mergedScene = createScene(mergedDraft);

  assert.equal(mergedSpaces.length, 1);
  assert.equal(mergedFloor.session.state, 'spaceClosed');
  assert.equal(mergedScene.closedSpaceFills.length, 1);
  assert.equal(mergedScene.closedSpaceLabels.length, 1);
  splitSharedIds.forEach((wallId) => {
    assert.equal(mergedFloor.walls.some((wall) => wall.id === wallId), false);
    assert.equal(mergedSpaces[0].wallIds.includes(wallId), false);
  });
  assert.equal(mergedFloor.walls.every((wall) => {
    const incident = mergedFloor.walls.filter((item) => (
      item.startNodeId === wall.startNodeId || item.endNodeId === wall.startNodeId
    )).length;
    const otherIncident = mergedFloor.walls.filter((item) => (
      item.startNodeId === wall.endNodeId || item.endNodeId === wall.endNodeId
    )).length;
    return incident === 2 && otherIncident === 2;
  }), true);
});

test('deleting a partial shared wall between staggered rooms merges them into one L-shaped room', () => {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.setThickness(draft, 200);
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  draft = commitWall(draft, { xMm: 4000, yMm: 0 }, 4000);
  draft = commitWall(draft, { xMm: 4000, yMm: 6000 }, 6000);
  draft = commitWall(draft, { xMm: 0, yMm: 6000 }, 4000);
  draft = commitWall(draft, { xMm: 0, yMm: 0 }, 6000);
  draft = surveyGraph.confirmClosure(draft);

  const floor = surveyGraph.getActiveFloor(draft);
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    { xMm: 4000, yMm: 0 },
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  draft = surveyGraph.snapCursorToWall(surveyGraph.startWallSnap(draft), target.pointMm, target);
  draft = commitWall(draft, { xMm: 7000, yMm: 0 }, 3000);
  draft = commitWall(draft, { xMm: 7000, yMm: 2500 }, 2500);
  draft = surveyGraph.startPreview(draft, { xMm: 4000, yMm: 2500 });
  draft = surveyGraph.confirmClosure(draft);

  const sharedWallId = findSharedWallIds(surveyGraph.getActiveFloor(draft))[0];
  const mergedDraft = surveyGraph.deleteWall(draft, sharedWallId);
  const mergedFloor = surveyGraph.getActiveFloor(mergedDraft);
  const mergedSpaces = mergedFloor.spaces.filter((space) => space.closed);
  const mergedScene = createScene(mergedDraft);
  const boundary = surveyGraph.buildSpaceBoundaryPoints(mergedFloor, mergedSpaces[0].wallIds)
    .map((point) => [point.xMm, point.yMm]);
  const uniqueCorners = [...new Set(boundary.map((point) => point.join(',')))];

  assert.equal(mergedSpaces.length, 1);
  assert.equal(mergedFloor.session.state, 'spaceClosed');
  assert.equal(mergedScene.closedSpaceFills.length, 1);
  assert.equal(mergedScene.closedSpaceLabels.length, 1);
  assert.equal(uniqueCorners.length, 7);
  assert.deepEqual(uniqueCorners.sort(), [
    '0,0', '0,6000', '4000,0', '4000,2500', '4000,6000', '7200,0', '7200,2500'
  ]);
  assert.equal(mergedFloor.walls.every((wall) => {
    const startCount = mergedFloor.walls.filter((item) => (
      item.startNodeId === wall.startNodeId || item.endNodeId === wall.startNodeId
    )).length;
    const endCount = mergedFloor.walls.filter((item) => (
      item.startNodeId === wall.endNodeId || item.endNodeId === wall.endNodeId
    )).length;
    return startCount === 2 && endCount === 2;
  }), true);
});

test('punching through an outer-face mid-wall keeps the concave L corner from convex-mitering', () => {
  const thicknessMm = 200;
  const innerCorner = { xMm: 3129, yMm: 1569 };
  const convexMiter = { xMm: innerCorner.xMm + thicknessMm, yMm: innerCorner.yMm + thicknessMm };
  let draft = createOuterFaceMidWallClosureDraft();
  const sharedWallId = findSharedWallIds(surveyGraph.getActiveFloor(draft))[0];
  assert.ok(sharedWallId);

  const mergedDraft = surveyGraph.deleteWall(draft, sharedWallId);
  const mergedFloor = surveyGraph.getActiveFloor(mergedDraft);
  const mergedSpaces = mergedFloor.spaces.filter((space) => space.closed);
  const roundPoint = (point) => ({
    xMm: Math.round(point.xMm),
    yMm: Math.round(point.yMm)
  });
  const nodePoint = (wall, key) => roundPoint(surveyGraph.getNode(mergedFloor, wall[key]));
  const stepWall = mergedFloor.walls.find((wall) => {
    const start = nodePoint(wall, 'startNodeId');
    const end = nodePoint(wall, 'endNodeId');
    return start.yMm === innerCorner.yMm && end.yMm === innerCorner.yMm &&
      Math.min(start.xMm, end.xMm) === innerCorner.xMm;
  });
  const remainingWall = mergedFloor.walls.find((wall) => {
    const start = nodePoint(wall, 'startNodeId');
    const end = nodePoint(wall, 'endNodeId');
    return start.xMm === innerCorner.xMm && end.xMm === innerCorner.xMm &&
      Math.min(start.yMm, end.yMm) === innerCorner.yMm &&
      Math.max(start.yMm, end.yMm) > innerCorner.yMm;
  });
  assert.ok(stepWall);
  assert.ok(remainingWall);

  const stepGeometry = surveyGraph.buildWallRenderGeometry(mergedFloor, stepWall);
  const remainingGeometry = surveyGraph.buildWallRenderGeometry(mergedFloor, remainingWall);
  const stepOuterAtCorner = roundPoint(nodePoint(stepWall, 'endNodeId').xMm === innerCorner.xMm
    ? stepGeometry.outerEnd
    : stepGeometry.outerStart);
  const remainingOuterAtCorner = roundPoint(nodePoint(remainingWall, 'startNodeId').xMm === innerCorner.xMm &&
    nodePoint(remainingWall, 'startNodeId').yMm === innerCorner.yMm
    ? remainingGeometry.outerStart
    : remainingGeometry.outerEnd);

  assert.equal(mergedSpaces.length, 1);
  assert.notDeepEqual(stepOuterAtCorner, convexMiter);
  assert.notDeepEqual(remainingOuterAtCorner, convexMiter);
  assert.deepEqual(stepOuterAtCorner, { xMm: innerCorner.xMm, yMm: innerCorner.yMm + thicknessMm });
  assert.deepEqual(remainingOuterAtCorner, { xMm: innerCorner.xMm + thicknessMm, yMm: innerCorner.yMm });
});

function ringSignedArea(polygon) {
  let area = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

function pointInRings(rings, point) {
  // Match canvas fill(): compound rings use the non-zero winding rule, so a
  // hole ring cancels the outer ring instead of counting as extra wall fill.
  let winding = 0;
  (rings || []).forEach((polygon) => {
    let inside = false;
    for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
      const current = polygon[index];
      const prior = polygon[previous];
      const intersects = ((current.y > point.y) !== (prior.y > point.y)) &&
        point.x < ((prior.x - current.x) * (point.y - current.y)) / (prior.y - current.y) + current.x;
      if (intersects) inside = !inside;
    }
    if (inside) winding += Math.sign(ringSignedArea(polygon)) || 1;
  });
  return winding !== 0;
}

function ringHasDiagonalNear(rings, point, radius) {
  return (rings || []).some((ring) => ring.some((vertex, index) => {
    const next = ring[(index + 1) % ring.length];
    const dx = Math.abs(next.x - vertex.x);
    const dy = Math.abs(next.y - vertex.y);
    if (dx < 1 || dy < 1) return false;
    const mid = { x: (vertex.x + next.x) / 2, y: (vertex.y + next.y) / 2 };
    return Math.hypot(mid.x - point.x, mid.y - point.y) <= radius;
  }));
}

test('deleting the shared inner-face closure wall keeps the inner L join and a stepped right facade', () => {
  [
    { xMm: 3000, yMm: 0 },
    { xMm: 3000, yMm: -200 }
  ].forEach((snapPoint) => {
    const draft = createInnerFaceAdjacentClosureDraft(snapPoint);
    const sharedWallId = findSharedWallIds(surveyGraph.getActiveFloor(draft))[0];
    assert.ok(sharedWallId, JSON.stringify(snapPoint));

    const mergedDraft = surveyGraph.deleteWall(draft, sharedWallId);
    const mergedFloor = surveyGraph.getActiveFloor(mergedDraft);
    const roundPoint = (point) => ({
      xMm: Math.round(point.xMm),
      yMm: Math.round(point.yMm)
    });
    const nodePoint = (wall, key) => roundPoint(surveyGraph.getNode(mergedFloor, wall[key]));
    const leftoverTopWall = mergedFloor.walls.find((wall) => {
      const start = nodePoint(wall, 'startNodeId');
      const end = nodePoint(wall, 'endNodeId');
      return start.yMm === 0 && end.yMm === 0 &&
        Math.min(start.xMm, end.xMm) === 0 && Math.max(start.xMm, end.xMm) === 3000;
    });
    const branchWall = mergedFloor.walls.find((wall) => {
      const start = nodePoint(wall, 'startNodeId');
      const end = nodePoint(wall, 'endNodeId');
      return start.xMm === 3000 && end.xMm === 3000 &&
        Math.min(start.yMm, end.yMm) < 0;
    });
    const closingWall = mergedFloor.walls.find((wall) => {
      const start = nodePoint(wall, 'startNodeId');
      const end = nodePoint(wall, 'endNodeId');
      return start.xMm === 6000 && end.xMm === 6000 &&
        Math.min(start.yMm, end.yMm) < 0;
    });
    const sourceRightWall = mergedFloor.walls.find((wall) => {
      const start = nodePoint(wall, 'startNodeId');
      const end = nodePoint(wall, 'endNodeId');
      return start.xMm === 6000 && end.xMm === 6000 &&
        Math.min(start.yMm, end.yMm) === 0 && Math.max(start.yMm, end.yMm) === 4000;
    });
    assert.ok(leftoverTopWall, JSON.stringify(snapPoint));
    assert.ok(branchWall, JSON.stringify(snapPoint));
    assert.ok(closingWall, JSON.stringify(snapPoint));
    assert.ok(sourceRightWall, JSON.stringify(snapPoint));

    const branchGeometry = surveyGraph.buildWallRenderGeometry(mergedFloor, branchWall);
    const closingGeometry = surveyGraph.buildWallRenderGeometry(mergedFloor, closingWall);
    const sourceRightGeometry = surveyGraph.buildWallRenderGeometry(mergedFloor, sourceRightWall);
    const branchOuterX = Math.round((branchGeometry.outerStart.xMm + branchGeometry.outerEnd.xMm) / 2);

    assert.equal(mergedFloor.spaces.filter((space) => space.closed).length, 1, JSON.stringify(snapPoint));
    assert.equal(branchOuterX, 3200, JSON.stringify(snapPoint));
    assert.equal(Math.round(closingGeometry.outerStart.xMm), 5800, JSON.stringify(snapPoint));
    assert.equal(Math.round(closingGeometry.outerEnd.xMm), 5800, JSON.stringify(snapPoint));
    assert.equal(Math.round(sourceRightGeometry.outerStart.xMm), 6200, JSON.stringify(snapPoint));
    assert.equal(Math.round(sourceRightGeometry.outerEnd.xMm), 6200, JSON.stringify(snapPoint));

    const mergedScene = createScene(mergedDraft);
    const leftoverSceneWall = mergedScene.walls.find((wall) => wall.id === leftoverTopWall.id);
    const branchSceneWall = mergedScene.walls.find((wall) => wall.id === branchWall.id);
    const innerCorner = leftoverSceneWall.endPoint.x > leftoverSceneWall.startPoint.x
      ? leftoverSceneWall.endPoint
      : leftoverSceneWall.startPoint;
    const leftoverOuterAtInner = leftoverSceneWall.endPoint.x > leftoverSceneWall.startPoint.x
      ? leftoverSceneWall.solidOuterEnd
      : leftoverSceneWall.solidOuterStart;
    const branchOuterAtInner = Math.hypot(branchSceneWall.solidOuterStart.x - innerCorner.x, branchSceneWall.solidOuterStart.y - innerCorner.y) <
      Math.hypot(branchSceneWall.solidOuterEnd.x - innerCorner.x, branchSceneWall.solidOuterEnd.y - innerCorner.y)
      ? branchSceneWall.solidOuterStart
      : branchSceneWall.solidOuterEnd;
    const joinFill = {
      x: (innerCorner.x + leftoverOuterAtInner.x + branchOuterAtInner.x) / 3,
      y: (innerCorner.y + leftoverOuterAtInner.y + branchOuterAtInner.y) / 3
    };
    const rings = mergedScene.wallSolidPlans.closed.rings;
    assert.ok(leftoverSceneWall, JSON.stringify(snapPoint));
    assert.ok(branchSceneWall, JSON.stringify(snapPoint));
    const closingSceneWall = mergedScene.walls.find((wall) => wall.id === closingWall.id);
    const sourceRightSceneWall = mergedScene.walls.find((wall) => wall.id === sourceRightWall.id);
    const stepJoint = closingSceneWall.endPoint;
    const innerStepFill = {
      x: (closingSceneWall.solidOuterEnd.x + closingSceneWall.solidEndPoint.x) / 2,
      y: stepJoint.y + Math.sign(sourceRightSceneWall.solidEndPoint.y - stepJoint.y) * closingSceneWall.thicknessPx / 2
    };
    const outerStepGap = {
      x: (sourceRightSceneWall.solidOuterStart.x + sourceRightSceneWall.solidStartPoint.x) / 2,
      y: stepJoint.y - Math.sign(sourceRightSceneWall.solidEndPoint.y - stepJoint.y) * sourceRightSceneWall.thicknessPx / 2
    };
    assert.ok(closingSceneWall, JSON.stringify(snapPoint));
    assert.ok(sourceRightSceneWall, JSON.stringify(snapPoint));
    assert.equal(
      Math.round(stepJoint.y),
      Math.round(innerCorner.y),
      JSON.stringify({ snapPoint, stepJoint, innerCorner })
    );
    assert.equal(pointInRings(rings, innerStepFill), false, JSON.stringify({ snapPoint, innerStepFill, rings }));
    assert.equal(pointInRings(rings, outerStepGap), true, JSON.stringify({ snapPoint, outerStepGap, rings }));
  });
});

test('an outer-face corner merge still renders after punching through a remaining wall', () => {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.setThickness(draft, 200);
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  draft = commitWall(draft, { xMm: 6000, yMm: 0 }, 6000);
  draft = commitWall(draft, { xMm: 6000, yMm: 4000 }, 4000);
  draft = commitWall(draft, { xMm: 0, yMm: 4000 }, 6000);
  draft = commitWall(draft, { xMm: 0, yMm: 0 }, 4000);
  draft = surveyGraph.confirmClosure(draft);

  const sourceFloor = surveyGraph.getActiveFloor(draft);
  const outerTarget = surveyGraph.getCursorPlacementTarget(
    sourceFloor,
    { xMm: 3000, yMm: -200 },
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  draft = surveyGraph.snapCursorToWall(
    surveyGraph.startWallSnap(draft),
    outerTarget.pointMm,
    outerTarget
  );
  draft = commitWall(draft, { xMm: 3000, yMm: -2000 }, 1800);
  draft = commitWall(draft, { xMm: 6200, yMm: -2000 }, 3200);
  draft = surveyGraph.startPreview(draft, { xMm: 6200, yMm: 100 });
  draft = surveyGraph.confirmClosure(draft);

  const closedFloor = surveyGraph.getActiveFloor(draft);
  assert.equal(closedFloor.spaces.filter((space) => space.closed).length, 2);
  const mergedDraft = surveyGraph.deleteWall(draft, closedFloor.walls[1].id);
  const mergedFloor = surveyGraph.getActiveFloor(mergedDraft);
  const mergedSpaces = mergedFloor.spaces.filter((space) => space.closed);
  const plan = surveyGraph.buildSpaceDimensionPlan(mergedFloor, mergedSpaces[0]);
  assert.equal(mergedSpaces.length, 1);
  assert.equal(mergedFloor.session.state, 'spaceClosed');
  assert.ok(plan);
  assert.equal((plan.innerSegments || []).every((segment) => (
    segment &&
    segment.start &&
    segment.end &&
    Number.isFinite(segment.start.xMm) &&
    Number.isFinite(segment.end.xMm)
  )), true);
  const mergedScene = createScene(mergedDraft);
  assert.equal(mergedScene.closedSpaceFills.length, 1);
  assert.equal(mergedScene.closedSpaceLabels.length, 1);
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
  assert.equal(openedFloor.session.state, 'mergeClosing');
  assert.equal(openedFloor.session.closeCandidateType, 'merge');
});

test('deleting a protruding closed wall still clears remaining stubs from closed dimensions', () => {
  const draft = createProtrudingAdjacentRoomDraft();
  let floor = surveyGraph.getActiveFloor(draft);
  assert.equal(floor.spaces.filter((space) => space.closed).length, 2);

  let topWallId = '';
  let topY = Infinity;
  floor.walls.forEach((wall) => {
    const start = surveyGraph.getNode(floor, wall.startNodeId);
    const end = surveyGraph.getNode(floor, wall.endNodeId);
    if (Math.abs(start.yMm - end.yMm) > 1) return;
    const y = (start.yMm + end.yMm) / 2;
    if (y < topY) {
      topY = y;
      topWallId = wall.id;
    }
  });
  assert.ok(topWallId);
  assert.ok(topY < -100);

  const openedDraft = surveyGraph.deleteWall(draft, topWallId);
  floor = surveyGraph.getActiveFloor(openedDraft);
  const scene = createScene(openedDraft);
  const leftoverWalls = scene.walls.filter((wall) => !wall.closed && !wall.lineOnly);
  assert.equal(floor.spaces.filter((space) => space.closed).length, 1);
  assert.ok(leftoverWalls.length >= 2);

  const leftoverPoints = leftoverWalls.flatMap((wall) => [
    wall.startPoint,
    wall.endPoint,
    wall.rawOuterStart,
    wall.rawOuterEnd,
    wall.outerStart,
    wall.outerEnd
  ].filter((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y)));
  const topDimensions = closedDimensionPose(scene).filter((item) => item.normal && item.normal.y < -0.5);
  assert.ok(topDimensions.length >= 1);
  topDimensions.forEach((item) => {
    const leftoverSupport = Math.max(...leftoverPoints.map((point) => projection(point, item.normal)));
    assert.ok(
      projection(item.start, item.normal) >= leftoverSupport + 59.999,
      `${item.kind} ${item.label} should sit outside leftover stubs`
    );
    assert.ok(
      projection(item.end, item.normal) >= leftoverSupport + 59.999,
      `${item.kind} ${item.label} end should sit outside leftover stubs`
    );
  });
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

test('window walls retain building totals without a positioning chain', () => {
  let draft = createClosedRectangleDraft();
  const firstWallId = surveyGraph.getActiveFloor(draft).walls[0].id;
  draft = surveyGraph.addOpeningToWall(draft, firstWallId, 'window');
  const scene = createScene(draft);

  assert.equal(scene.dimensions.filter((dimension) => dimension.kind === 'room-clear').length, 0);
  assert.equal(scene.dimensions.filter((dimension) => dimension.kind === 'building-overall').length, 4);
  assert.equal(scene.dimensions.some((dimension) => dimension.kind === 'opening-segment'), false);
});

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const current = polygon[i];
    const previous = polygon[j];
    const intersects = ((current.y > point.y) !== (previous.y > point.y)) &&
      (point.x < (previous.x - current.x) * (point.y - current.y) / ((previous.y - current.y) || 1) + previous.x);
    if (intersects) inside = !inside;
  }
  return inside;
}

test('a door parked against a T-junction does not punch the adjacent closed wall solid', () => {
  let draft = createAlignedAdjacentRoomDraft();
  const floor = surveyGraph.getActiveFloor(draft);
  const sharedWall = floor.walls.find((wall) => (
    floor.spaces.filter((space) => space.closed && space.wallIds.includes(wall.id)).length === 2
  ));
  draft = surveyGraph.addOpeningToWall(draft, sharedWall.id, 'door');
  const openingId = surveyGraph.getActiveFloor(draft).openings[0].id;
  draft = surveyGraph.updateOpening(draft, openingId, { centerOffsetMm: 450 });

  const scene = createScene(draft);
  const opening = scene.openings[0];
  const host = opening.wall;
  const sampleLocal = { x: 0, y: host.outerOffsetPx / 2 };
  const sample = {
    x: host.startPoint.x + sampleLocal.x * Math.cos(host.angleRad) - sampleLocal.y * Math.sin(host.angleRad),
    y: host.startPoint.y + sampleLocal.x * Math.sin(host.angleRad) + sampleLocal.y * Math.cos(host.angleRad)
  };
  const neighbor = scene.walls.find((wall) => (
    wall.id !== host.id && wall.closed && pointInPolygon(sample, wall.bodyPolygon)
  ));

  assert.ok(neighbor, 'the T-stem should occupy the shared-wall start square');
  assert.equal(pointInPolygon(sample, host.bodyPolygon), false);
  assert.equal(opening.startPx <= 0.5, true, 'the door should start on the T');

  const recorder = createRecordingContext();
  surveyCanvasRenderer.drawSurveyScene(recorder.context, scene, { dpr: 1 });

  const restored = recorder.fillDetails.filter((detail) => detail.fillStyle === '#8e8e8c').some((detail) => {
    const commands = detail.path.filter((command) => command[0] === 'moveTo' || command[0] === 'lineTo');
    if (commands.length < 3) return false;
    const polygon = commands.map((command) => ({ x: command[1], y: command[2] }));
    return pointInPolygon(sampleLocal, polygon);
  });
  assert.equal(restored, true, 'opening mask must refill the adjacent closed wall at the T');
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
  assert.ok(recorder.strokeDetails.some((detail) => detail.strokeStyle === '#c8ccd0'));
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

test('free dock drag dirty-clears only the reticle instead of the full overlay', () => {
  const recorder = createRecordingContext();
  surveyCanvasRenderer.drawDraggingCursor(
    recorder.context,
    { width: 400, height: 500 },
    { x: 180, y: 220 },
    {
      dpr: 1,
      previousPoint: { x: 100, y: 100 },
      paintLens: false
    }
  );

  assert.equal(recorder.clearRects.some((rect) => rect.width === 400 && rect.height === 500), false);
  assert.ok(recorder.clearRects.some((rect) => (
    rect.x === 56 && rect.y === 56 && rect.width === 88 && rect.height === 88
  )));
  assert.ok(recorder.clearRects.some((rect) => (
    rect.x === 136 && rect.y === 176 && rect.width === 88 && rect.height === 88
  )));
  assert.equal(recorder.drawImages.length, 0);
  assert.ok(recorder.strokeDetails.some((detail) => detail.strokeStyle === '#22c55e'));
});

test('a retained wall snap dirty-clears the moving reticle without repainting the full overlay', () => {
  const recorder = createRecordingContext();
  surveyCanvasRenderer.drawDraggingCursor(
    recorder.context,
    { width: 400, height: 500 },
    { x: 220, y: 120 },
    {
      dpr: 1,
      previousPoint: { x: 180, y: 120 },
      paintLens: false,
      snapGuide: {
        startPoint: { x: 80, y: 120 },
        endPoint: { x: 280, y: 120 }
      }
    }
  );

  assert.equal(recorder.clearRects.some((rect) => rect.width === 400 && rect.height === 500), false);
  const orangeGuide = recorder.strokeDetails.find((detail) => detail.strokeStyle === '#f07a21');
  assert.ok(orangeGuide);
  assert.equal(orangeGuide.path[0][2], 120);
  assert.equal(orangeGuide.path[1][2], 120);
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

test('cursor lens stacks snap and coordinate labels so four-digit values do not overlap', () => {
  const draft = createTwoClosedRoomsWithSharedDoorDraft();
  const floor = surveyGraph.getActiveFloor(draft);
  const scene = surveyCanvasRenderer.createSurveyLensScene({
    floor,
    session: floor.session,
    centerPoint: { xMm: 2636, yMm: 3106 },
    size: 120,
    scale: 0.12
  });
  const recorder = createRecordingContext();
  surveyCanvasRenderer.drawDraggingCursor(
    recorder.context,
    { width: 390, height: 650 },
    { x: 220, y: 420 },
    {
      dpr: 1,
      lensScene: scene,
      lensRect: { left: 20, top: 98, size: 120 },
      lensMeta: { snapLabel: '外边顶点延长吸附', coordinateLabel: 'X 2636 / Y 3106' }
    }
  );
  const snap = recorder.texts.find((detail) => detail.text === '外边顶点延长吸附');
  const coords = recorder.texts.find((detail) => detail.text === 'X 2636 / Y 3106');
  assert.ok(snap);
  assert.ok(coords);
  assert.equal(snap.x, coords.x);
  assert.ok(coords.y - snap.y >= 14);
});

test('cursor drag overlay leaves the close action on the formal canvas', () => {
  const recorder = createRecordingContext();
  surveyCanvasRenderer.drawDraggingCursor(
    recorder.context,
    { width: 390, height: 650 },
    { x: 220, y: 420 },
    {
      dpr: 1,
      showCursor: false,
      closeAction: { cx: 80, cy: 140, radius: 14 }
    }
  );
  assert.equal(recorder.texts.some((detail) => detail.text === '合'), false);
  assert.equal(recorder.fills.some((recordedPath) => (
    recordedPath.some((command) => command[0] === 'arc' && command[1] === 80 && command[2] === 140 && command[3] === 14)
  )), false);
  assert.equal(recorder.strokeDetails.some((detail) => detail.strokeStyle === '#22c55e'), false);
});

test('formal scene can omit the Fig.1 cursor so a lens blit does not magnify it', () => {
  const scene = createScene(createOpenDraft());
  const withCursor = createRecordingContext();
  surveyCanvasRenderer.drawSurveyScene(withCursor.context, scene, { dpr: 1 });
  assert.ok(withCursor.fillRectDetails.some((detail) => (
    detail.fillStyle === 'rgba(34, 197, 94, 0.16)'
  )));
  assert.ok(withCursor.strokeDetails.some((detail) => detail.strokeStyle === '#c8ccd0'));

  const withoutCursor = createRecordingContext();
  surveyCanvasRenderer.drawSurveyScene(withoutCursor.context, scene, { dpr: 1, omitCursor: true });
  assert.equal(withoutCursor.fillRectDetails.some((detail) => (
    detail.fillStyle === 'rgba(34, 197, 94, 0.16)'
  )), false);
  assert.equal(withoutCursor.strokeDetails.some((detail) => detail.strokeStyle === '#c8ccd0'), false);
});

test('cursor lens can blit a magnified formal-canvas crop instead of redrawing walls', () => {
  const sample = surveyCanvasRenderer.resolveCursorLensSample(
    { x: 200, y: 300 },
    0.05,
    0.12,
    120
  );
  assert.equal(Math.round(sample.size), 50);
  assert.equal(Math.round(sample.x), 175);
  assert.equal(Math.round(sample.y), 275);

  const recorder = createRecordingContext();
  const sourceCanvas = { id: 'formal' };
  surveyCanvasRenderer.drawDraggingCursor(
    recorder.context,
    { width: 390, height: 650 },
    { x: 220, y: 420 },
    {
      dpr: 1,
      showCursor: false,
      lensRect: { left: 20, top: 98, size: 120 },
      lensMeta: { snapLabel: '自由放置', coordinateLabel: 'X 2000 / Y 1000' },
      lensSource: { canvas: sourceCanvas, dpr: 2 },
      lensSample: sample
    }
  );
  assert.equal(recorder.drawImages.length, 1);
  assert.equal(recorder.drawImages[0][0], sourceCanvas);
  assert.equal(recorder.drawImages[0][1], sample.x * 2);
  assert.equal(recorder.drawImages[0][2], sample.y * 2);
  assert.equal(recorder.drawImages[0][3], sample.size * 2);
  assert.equal(recorder.drawImages[0][4], sample.size * 2);
  assert.equal(recorder.drawImages[0][5], 20);
  assert.equal(recorder.drawImages[0][6], 98);
  assert.equal(recorder.drawImages[0][7], 120);
  assert.equal(recorder.drawImages[0][8], 120);
  assert.ok(recorder.texts.some((detail) => detail.text === '自由放置'));
});

test('cursor lens paints a small green crosshair on top of the crop instead of the canvas reticle', () => {
  const sample = surveyCanvasRenderer.resolveCursorLensSample(
    { x: 200, y: 300 },
    0.05,
    0.12,
    120
  );
  const recorder = createRecordingContext();
  surveyCanvasRenderer.drawDraggingCursor(
    recorder.context,
    { width: 390, height: 650 },
    { x: 220, y: 420 },
    {
      dpr: 1,
      showCursor: false,
      lensRect: { left: 20, top: 98, size: 120 },
      lensMeta: { snapLabel: '自由放置', coordinateLabel: 'X 2000 / Y 1000' },
      lensSource: { canvas: { id: 'formal' }, dpr: 2 },
      lensSample: sample
    }
  );

  const blitAt = recorder.ops.findIndex((op) => op.type === 'drawImage');
  const crosshairAt = recorder.ops.findIndex((op) => (
    op.type === 'stroke' &&
    op.strokeStyle === '#22c55e' &&
    op.path.some((command) => command[0] === 'moveTo' && command[1] === 68 && command[2] === 158) &&
    op.path.some((command) => command[0] === 'lineTo' && command[1] === 92 && command[2] === 158)
  ));
  assert.ok(blitAt >= 0);
  assert.ok(crosshairAt > blitAt);
  assert.equal(recorder.fillRectDetails.some((detail) => (
    detail.fillStyle === 'rgba(34, 197, 94, 0.16)'
  )), false);
  assert.equal(recorder.strokeDetails.some((detail) => detail.strokeStyle === '#c8ccd0'), false);
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

test('straight outer-face snapping renders an axis-aligned orange preview', () => {
  const closedDraft = createClosedRectangleDraft();
  const floor = surveyGraph.getActiveFloor(closedDraft);
  const topWall = floor.walls[0];
  const geometry = surveyGraph.buildWallRenderGeometry(floor, topWall);
  const outerMidpoint = {
    xMm: Math.round((geometry.outerStart.xMm + geometry.outerEnd.xMm) / 2),
    yMm: Math.round((geometry.outerStart.yMm + geometry.outerEnd.yMm) / 2)
  };
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    outerMidpoint,
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  let previewDraft = surveyGraph.snapCursorToWall(
    surveyGraph.startWallSnap(closedDraft),
    target.pointMm,
    target
  );
  previewDraft = surveyGraph.startPreview(previewDraft, {
    xMm: outerMidpoint.xMm + 800,
    yMm: outerMidpoint.yMm
  });
  const scene = createScene(previewDraft);

  assert.equal(target.snapLine, 'outer');
  assert.ok(scene.previewWall);
  assert.equal(scene.previewWall.lineOnly, true);
  assert.equal(
    scene.previewWall.measurementStartPoint.y,
    scene.previewWall.measurementEndPoint.y
  );
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

test('toggling measurement side on a closed-corner preview moves the redline to the opposite face', () => {
  let draft = createClosedRectangleDraft();
  let floor = surveyGraph.getActiveFloor(draft);
  draft = surveyGraph.placeNewWallChainCursor(draft, { xMm: 3000, yMm: 2000 });
  floor = surveyGraph.getActiveFloor(draft);
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    { xMm: 3000, yMm: 2000 },
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  if (target) {
    draft = surveyGraph.snapCursorToWall(surveyGraph.startWallSnap(draft), target.pointMm, target);
  }
  draft = surveyGraph.holdPreviewForInput(surveyGraph.startPreview(draft, { xMm: 3000, yMm: 5000 }));
  const before = createScene(draft);
  const originalSide = before.previewWall.measurementSide;
  const originalOffsetSign = Math.sign(before.previewWall.outerOffsetPx);
  const nextSide = originalSide === 'right' ? 'left' : 'right';

  draft = surveyGraph.setMeasurementSide(draft, nextSide);
  const after = createScene(draft);

  assert.equal(after.previewWall.measurementSide, nextSide);
  assert.equal(Math.sign(after.previewWall.outerOffsetPx), originalOffsetSign);
  assert.equal(after.previewWall.measurementFace, 'outer');
  assert.deepEqual(after.previewWall.measurementStartPoint, after.previewWall.outerStart);
  assert.deepEqual(after.previewWall.measurementEndPoint, after.previewWall.outerEnd);
  assert.deepEqual(after.cursor.point, after.previewWall.measurementEndPoint);
  assert.notDeepEqual(after.previewWall.measurementStartPoint, before.previewWall.measurementStartPoint);
});

test('toggling measurement side on a committed closed-corner wall keeps occupancy and moves the redline', () => {
  let draft = createClosedRectangleDraft();
  let floor = surveyGraph.getActiveFloor(draft);
  draft = surveyGraph.placeNewWallChainCursor(draft, { xMm: 3000, yMm: 2000 });
  floor = surveyGraph.getActiveFloor(draft);
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    { xMm: 3000, yMm: 2000 },
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  if (target) {
    draft = surveyGraph.snapCursorToWall(surveyGraph.startWallSnap(draft), target.pointMm, target);
  }
  draft = commitWall(draft, { xMm: 3000, yMm: 5000 }, 2800);
  const before = createScene(draft);
  const activeBefore = before.walls.find((wall) => wall.isActiveMeasurement);
  const originalOffsetSign = Math.sign(activeBefore.outerOffsetPx);
  const nextSide = activeBefore.measurementSide === 'right' ? 'left' : 'right';

  draft = surveyGraph.setMeasurementSide(draft, nextSide, activeBefore.id);
  const after = createScene(draft);
  const activeAfter = after.walls.find((wall) => wall.isActiveMeasurement);
  const liveDimension = after.dimensions.find((dimension) => dimension.wall === activeAfter);

  assert.equal(activeAfter.measurementSide, nextSide);
  assert.equal(Math.sign(activeAfter.outerOffsetPx), originalOffsetSign);
  assert.equal(activeAfter.measurementFace, 'outer');
  assert.deepEqual(activeAfter.measurementStartPoint, activeAfter.outerStart);
  assert.deepEqual(activeAfter.measurementEndPoint, activeAfter.outerEnd);
  assert.equal(liveDimension.measurementFace, 'outer');
});

test('an inner-corner outward branch starts its body and redline at the exterior face', () => {
  let draft = createClosedRectangleDraft();
  let floor = surveyGraph.getActiveFloor(draft);
  floor.walls.forEach((wall) => {
    draft = surveyGraph.setThickness(draft, 400, wall.id);
  });
  draft = surveyGraph.setThickness(draft, 400);
  floor = surveyGraph.getActiveFloor(draft);

  const innerCorner = surveyGraph.getNode(floor, floor.walls[0].startNodeId);
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    innerCorner,
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  draft = surveyGraph.snapCursorToWall(
    surveyGraph.startWallSnap(draft),
    target.pointMm,
    target
  );
  draft = commitWall(draft, { xMm: 0, yMm: -2083 }, 1683);

  const scene = createScene(draft);
  const activeWall = scene.walls.find((wall) => wall.isActiveMeasurement);
  const recorder = createRecordingContext();
  const anchorPoint = {
    x: scene.rect.width / 2 + scene.viewport.offsetX + innerCorner.xMm * scene.viewport.scale,
    y: scene.rect.height / 2 + scene.viewport.offsetY + innerCorner.yMm * scene.viewport.scale
  };

  surveyCanvasRenderer.drawSurveyScene(recorder.context, scene, { dpr: 1 });

  assert.ok(activeWall);
  assert.equal(activeWall.wall.measurementStartInsetMm, 400);
  assert.equal(activeWall.wall.lengthMm, 1683);
  assert.deepEqual(activeWall.measurementStartPoint, activeWall.startPoint);
  assert.deepEqual(activeWall.solidStartPoint, activeWall.startPoint);
  assert.notDeepEqual(activeWall.measurementStartPoint, anchorPoint);
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

test('formal and viewport wall rendering use one union-ring fill per wall colour group', () => {
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
      const wallFills = recorder.fillDetails.filter((detail) => (
        detail.fillStyle === '#e2e2e0' || detail.fillStyle === '#8e8e8c'
      ));
      const expectedGroups = [
        ['#8e8e8c', scene.wallSolidPlans.closed.rings],
        ['#e2e2e0', scene.wallSolidPlans.open.rings]
      ].filter(([, rings]) => rings.length);
      assert.equal(wallFills.length, expectedGroups.length);
      expectedGroups.forEach(([fillStyle, rings], index) => {
        assert.equal(wallFills[index].fillStyle, fillStyle);
        assert.equal(
          wallFills[index].path.filter((command) => command[0] === 'moveTo').length,
          rings.length
        );
      });
      const wallOutline = recorder.strokeDetails.find((detail) => detail.strokeStyle === '#1f1f1f');
      assert.ok(wallOutline);
      assert.equal(wallOutline.path.some((command) => command[0] === 'closePath'), true);
    });
  });
});

test('a mixed closed/open T junction keeps separate stable union-ring colour ownership', () => {
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
  assert.deepEqual(wallFills.map((detail) => detail.fillStyle), ['#8e8e8c', '#e2e2e0']);
  assert.equal(
    wallFills[0].path.filter((command) => command[0] === 'moveTo').length,
    scene.wallSolidPlans.closed.rings.length
  );
  assert.equal(
    wallFills[1].path.filter((command) => command[0] === 'moveTo').length,
    scene.wallSolidPlans.open.rings.length
  );
  assert.equal(
    recorder.fillRectDetails.some((detail) => (
      detail.fillStyle === '#e2e2e0' || detail.fillStyle === '#8e8e8c'
    )),
    false,
    'wall junctions must not be recoloured by device-pixel repair strips'
  );
});

test('an outer-start T branch body starts at the source wall far face', () => {
  let draft = createClosedRectangleDraft();
  let floor = surveyGraph.getActiveFloor(draft);
  const sourceWall = floor.walls[0];
  const sourceGeometry = surveyGraph.buildWallSnapGeometry(floor, sourceWall);
  const junctionPoint = {
    xMm: Math.round((sourceGeometry.outerStart.xMm + sourceGeometry.outerEnd.xMm) / 2),
    yMm: Math.round((sourceGeometry.outerStart.yMm + sourceGeometry.outerEnd.yMm) / 2)
  };
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    junctionPoint,
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  draft = surveyGraph.snapCursorToWall(surveyGraph.startWallSnap(draft), target.pointMm, target);
  const previewDraft = surveyGraph.startPreview(
    draft,
    { xMm: junctionPoint.xMm, yMm: junctionPoint.yMm - 2000 }
  );
  const previewFloor = surveyGraph.getActiveFloor(previewDraft);
  const previewScene = createScene(previewDraft);
  assert.ok((previewFloor.session.previewMeasurementStartInsetMm || 0) > 0);
  assert.deepEqual(previewScene.previewWall.solidStartPoint, previewScene.previewWall.startPoint);
  assert.deepEqual(previewScene.cursor.point, previewScene.previewWall.measurementEndPoint);
  assert.deepEqual(previewScene.previewWall.measurementEndPoint, previewScene.previewWall.endPoint);
  draft = surveyGraph.commitPreviewLength(
    previewDraft,
    previewFloor.session.previewLengthMm,
    'manual'
  );
  floor = surveyGraph.getActiveFloor(draft);

  const branch = floor.walls.find((wall) => (
    !wall.topologySourceWallId && (wall.measurementStartInsetMm || 0) > 0
  ));
  const sourceSegments = floor.walls.filter((wall) => (
    wall.topologySourceWallId === sourceWall.id
  ));
  assert.ok(branch);
  assert.equal(sourceSegments.length, 2);

  const scene = createScene(draft);
  const branchScene = scene.walls.find((wall) => wall.id === branch.id);
  const sourceScenes = scene.walls.filter((wall) => sourceSegments.some((item) => item.id === wall.id));
  const nodeSourceScene = sourceScenes.find((wall) => wall.wall.endNodeId === branch.startNodeId) ||
    sourceScenes.find((wall) => wall.wall.startNodeId === branch.startNodeId);
  const nodePoint = nodeSourceScene.wall.endNodeId === branch.startNodeId
    ? nodeSourceScene.solidEndPoint
    : nodeSourceScene.solidStartPoint;
  const sourceFarFace = Math.max(...sourceScenes.flatMap((wall) => wall.bodyPolygon.map((point) => (
    (point.x - nodePoint.x) * branchScene.direction.x +
    (point.y - nodePoint.y) * branchScene.direction.y
  ))));
  const branchStart =
    (branchScene.solidStartPoint.x - nodePoint.x) * branchScene.direction.x +
    (branchScene.solidStartPoint.y - nodePoint.y) * branchScene.direction.y;

  assert.equal(branchStart, sourceFarFace);
  assert.deepEqual(branchScene.solidStartPoint, branchScene.startPoint);
  assert.notDeepEqual(branchScene.solidStartPoint, nodePoint);
  assert.equal(branchScene.measurementFace, 'inner');
  assert.deepEqual(branchScene.measurementStartPoint, branchScene.startPoint);
  assert.deepEqual(scene.cursor.point, branchScene.measurementEndPoint);
  const insetSourceScene = sourceScenes.find((wall) => (
    (wall.wall.measurementStartInsetMm || 0) > 0 || (wall.wall.measurementEndInsetMm || 0) > 0
  ));
  assert.ok(insetSourceScene);
  assert.notDeepEqual(insetSourceScene.startPoint, insetSourceScene.solidStartPoint);
});

test('an outer-start T right turn keeps one continuous branch face and body side', () => {
  let draft = createClosedRectangleDraft();
  let floor = surveyGraph.getActiveFloor(draft);
  const sourceWall = floor.walls[0];
  const sourceGeometry = surveyGraph.buildWallSnapGeometry(floor, sourceWall);
  const outerMidpoint = {
    xMm: Math.round((sourceGeometry.outerStart.xMm + sourceGeometry.outerEnd.xMm) / 2),
    yMm: Math.round((sourceGeometry.outerStart.yMm + sourceGeometry.outerEnd.yMm) / 2)
  };
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    outerMidpoint,
    surveyGraph.CLOSE_TOLERANCE_MM
  );

  draft = surveyGraph.snapCursorToWall(surveyGraph.startWallSnap(draft), target.pointMm, target);
  draft = commitWall(draft, { xMm: 1500, yMm: -2000 }, 1800);
  draft = commitWall(draft, { xMm: 3200, yMm: -2000 }, 1700);
  draft = surveyGraph.startPreview(draft, { xMm: 3200, yMm: -900 });
  floor = surveyGraph.getActiveFloor(draft);
  const scene = createScene(draft);
  const activeWalls = scene.walls.filter((wall) => wall.isActiveMeasurement);
  const rightwardWall = activeWalls.at(-1);

  assert.equal(floor.session.activeSpaceSharedSnapLine, 'outer');
  assert.equal(activeWalls.length, 2);
  assert.equal(activeWalls[0].measurementFace, 'inner');
  assert.equal(rightwardWall.measurementFace, 'inner');
  assert.equal(activeWalls[0].outerStart.x > activeWalls[0].startPoint.x, true);
  assert.equal(rightwardWall.outerStart.y > rightwardWall.startPoint.y, true);
  assert.equal(scene.previewWall.measurementFace, 'inner');
  assert.equal(scene.previewWall.outerStart.x < scene.previewWall.startPoint.x, true);
  assert.deepEqual(activeWalls[0].measurementEndPoint, rightwardWall.measurementStartPoint);
  assert.deepEqual(rightwardWall.measurementEndPoint, scene.previewWall.measurementStartPoint);
  assert.deepEqual(scene.previewWall.measurementStartPoint, scene.previewWall.startPoint);
  assert.deepEqual(scene.previewWall.measurementEndPoint, scene.previewWall.endPoint);
  assert.deepEqual(scene.cursor.point, scene.previewWall.endPoint);
});

test('an inner-face T second-wall preview preserves the confirmed first wall body side', () => {
  [3200, -200].forEach((endX) => {
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
    draft = commitWall(draft, { xMm: 1500, yMm: -2000 }, 1800);
    const firstWallBeforePreview = createScene(draft).walls.find((wall) => wall.isActiveMeasurement);

    draft = surveyGraph.startPreview(draft, { xMm: endX, yMm: -2000 });
    const scene = createScene(draft);
    const firstWallDuringPreview = scene.walls.find((wall) => wall.isActiveMeasurement);

    assert.equal(firstWallBeforePreview.outerStart.x > firstWallBeforePreview.startPoint.x, true, `initial endX=${endX}`);
    assert.deepEqual(firstWallDuringPreview.outerStart, firstWallBeforePreview.outerStart, `first outer start endX=${endX}`);
    assert.deepEqual(firstWallDuringPreview.outerEnd, firstWallBeforePreview.outerEnd, `first outer end endX=${endX}`);
    assert.equal(scene.previewWall.measurementFace, 'inner', `measurement face endX=${endX}`);
    assert.deepEqual(scene.previewWall.measurementStartPoint, scene.previewWall.startPoint, `measurement start endX=${endX}`);
    assert.equal(
      scene.previewWall.outerStart.y > scene.previewWall.startPoint.y,
      endX > 1500,
      `second wall body side endX=${endX}`
    );
  });
});

test('an outer-start T second-wall preview stays on the first branch working face', () => {
  [6200, -200].forEach((endX) => {
    let draft = createClosedRectangleDraft();
    let floor = surveyGraph.getActiveFloor(draft);
    const sourceWall = floor.walls[0];
    const sourceGeometry = surveyGraph.buildWallSnapGeometry(floor, sourceWall);
    const target = surveyGraph.getCursorPlacementTarget(floor, {
      xMm: Math.round((sourceGeometry.outerStart.xMm + sourceGeometry.outerEnd.xMm) / 2),
      yMm: Math.round((sourceGeometry.outerStart.yMm + sourceGeometry.outerEnd.yMm) / 2)
    }, surveyGraph.CLOSE_TOLERANCE_MM);

    draft = surveyGraph.snapCursorToWall(surveyGraph.startWallSnap(draft), target.pointMm, target);
    draft = commitWall(draft, { xMm: 3000, yMm: -2000 }, 1800);
    const firstWallBeforePreview = createScene(draft).walls.find((wall) => wall.isActiveMeasurement);

    draft = surveyGraph.startPreview(draft, { xMm: endX, yMm: -2000 });
    const scene = createScene(draft);
    const firstWallDuringPreview = scene.walls.find((wall) => wall.isActiveMeasurement);

    assert.deepEqual(firstWallDuringPreview.outerStart, firstWallBeforePreview.outerStart, `first outer start endX=${endX}`);
    assert.deepEqual(firstWallDuringPreview.outerEnd, firstWallBeforePreview.outerEnd, `first outer end endX=${endX}`);
    assert.equal(firstWallDuringPreview.measurementFace, 'inner', `first measurement face endX=${endX}`);
    assert.equal(scene.previewWall.measurementFace, 'inner', `measurement face endX=${endX}`);
    assert.deepEqual(
      firstWallDuringPreview.measurementEndPoint,
      scene.previewWall.measurementStartPoint,
      `continuous branch corner endX=${endX}`
    );
    assert.deepEqual(scene.previewWall.measurementEndPoint, scene.previewWall.endPoint, `dragged edge endX=${endX}`);
    assert.deepEqual(scene.cursor.point, scene.previewWall.endPoint, `cursor edge endX=${endX}`);
    assert.equal(
      Math.sign(scene.previewWall.outerOffsetPx),
      Math.sign(firstWallDuringPreview.outerOffsetPx),
      `second wall body side endX=${endX}`
    );
  });
});

test('an inner-face T branch keeps its rightward red edge and inherits the first wall body side', () => {
  let draft = createClosedRectangleDraft();
  let floor = surveyGraph.getActiveFloor(draft);
  const sourceWall = floor.walls[0];
  const sourceStart = surveyGraph.getNode(floor, sourceWall.startNodeId);
  const sourceEnd = surveyGraph.getNode(floor, sourceWall.endNodeId);
  const innerMidpoint = {
    xMm: Math.round((sourceStart.xMm + sourceEnd.xMm) / 2),
    yMm: Math.round((sourceStart.yMm + sourceEnd.yMm) / 2)
  };
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    innerMidpoint,
    surveyGraph.CLOSE_TOLERANCE_MM
  );

  draft = surveyGraph.snapCursorToWall(surveyGraph.startWallSnap(draft), target.pointMm, target);
  draft = commitWall(draft, { xMm: 1500, yMm: -2000 }, 1800);
  draft = commitWall(draft, { xMm: 3200, yMm: -2000 }, 1700);
  draft = surveyGraph.startPreview(draft, { xMm: 3200, yMm: -900 });
  floor = surveyGraph.getActiveFloor(draft);
  const scene = createScene(draft);
  const activeWalls = scene.walls.filter((wall) => wall.isActiveMeasurement);
  const rightwardWall = activeWalls.at(-1);

  assert.equal(floor.session.activeSpaceSharedSnapLine, 'inner');
  assert.equal(activeWalls.length, 2);
  assert.equal(activeWalls[0].measurementFace, 'inner');
  assert.equal(rightwardWall.measurementFace, 'inner');
  assert.equal(activeWalls[0].outerStart.x > activeWalls[0].startPoint.x, true);
  assert.deepEqual(rightwardWall.measurementEndPoint, rightwardWall.endPoint);
  assert.equal(rightwardWall.outerStart.y > rightwardWall.startPoint.y, true);
  assert.equal(scene.previewWall.measurementFace, 'inner');
  assert.equal(scene.previewWall.outerStart.x < scene.previewWall.startPoint.x, true);
  assert.deepEqual(scene.previewWall.measurementStartPoint, scene.previewWall.startPoint);
});

test('inner-face T continuations preserve the confirmed wall-local body side in both directions', () => {
  [3200, -200].forEach((endX) => {
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
    draft = commitWall(draft, { xMm: 1500, yMm: -2000 }, 1800);
    draft = commitWall(draft, { xMm: endX, yMm: -2000 }, Math.abs(endX - 1500));
    draft = surveyGraph.startPreview(draft, { xMm: endX, yMm: -900 });
    floor = surveyGraph.getActiveFloor(draft);
    const scene = createScene(draft);
    const activeWalls = scene.walls.filter((wall) => wall.isActiveMeasurement);
    const continuation = activeWalls.at(-1);

    assert.equal(continuation.measurementFace, 'inner', `endX=${endX}`);
    assert.deepEqual(continuation.measurementStartPoint, continuation.startPoint, `endX=${endX}`);
    assert.equal(
      continuation.outerStart.y > continuation.startPoint.y,
      endX > 1500,
      `continuation body side endX=${endX}`
    );
    assert.equal(activeWalls[0].outerStart.x > activeWalls[0].startPoint.x, true, `first wall side endX=${endX}`);
    assert.equal(scene.previewWall.outerStart.x < scene.previewWall.startPoint.x, true, `downward body side endX=${endX}`);
  });
});

test('inner- and outer-face T closures preserve every confirmed measurement through later turns', () => {
  ['inner', 'outer'].forEach((snapLine) => {
    const result = createMeasuredTClosureDraft(snapLine);
    const floor = surveyGraph.getActiveFloor(result.draft);
    const activeWalls = floor.walls.slice(floor.session.activeSpaceStartWallIndex);
    const scene = createScene(result.draft);
    const renderedActiveWalls = scene.walls.filter((wall) => wall.isActiveMeasurement);

    assert.deepEqual(result.lengthsBeforeClosingWall, [2000, 1582], snapLine);
    assert.deepEqual(activeWalls.map((wall) => wall.lengthMm), [2000, 1582, 2000], snapLine);
    assert.deepEqual(
      renderedActiveWalls[0].measurementEndPoint,
      renderedActiveWalls[1].measurementStartPoint,
      `${snapLine}: first turn red edge`
    );
    assert.deepEqual(
      renderedActiveWalls[1].measurementEndPoint,
      renderedActiveWalls[2].measurementStartPoint,
      `${snapLine}: second turn red edge`
    );
  });
});

test('an inner-face T branch redline stays on the branch inner edge', () => {
  let draft = createClosedRectangleDraft();
  let floor = surveyGraph.getActiveFloor(draft);
  const sourceWall = floor.walls[0];
  const sourceStart = surveyGraph.getNode(floor, sourceWall.startNodeId);
  const sourceEnd = surveyGraph.getNode(floor, sourceWall.endNodeId);
  const junctionPoint = {
    xMm: Math.round((sourceStart.xMm + sourceEnd.xMm) / 2),
    yMm: Math.round((sourceStart.yMm + sourceEnd.yMm) / 2)
  };
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    junctionPoint,
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  draft = surveyGraph.snapCursorToWall(surveyGraph.startWallSnap(draft), target.pointMm, target);
  draft = surveyGraph.startPreview(draft, { xMm: junctionPoint.xMm, yMm: junctionPoint.yMm - 2000 });
  floor = surveyGraph.getActiveFloor(draft);
  const scene = createScene(draft);

  assert.equal(floor.session.activeSpaceSharedSnapLine, 'inner');
  assert.equal(floor.session.previewMeasurementStartInsetMm, 200);
  assert.equal(floor.session.previewLengthMm, 1800);
  assert.equal(scene.previewWall.measurementFace, 'inner');
  assert.deepEqual(scene.previewWall.measurementStartPoint, scene.previewWall.startPoint);
  assert.deepEqual(scene.previewWall.solidStartPoint, scene.previewWall.startPoint);
});

test('closed U and stepped outlines keep concave wall solids joined at degree-two nodes', () => {
  const fixtures = [
    [
      { xMm: 0, yMm: 0 }, { xMm: 6000, yMm: 0 }, { xMm: 6000, yMm: 4400 },
      { xMm: 4300, yMm: 4400 }, { xMm: 4300, yMm: 1800 }, { xMm: 1700, yMm: 1800 },
      { xMm: 1700, yMm: 4400 }, { xMm: 0, yMm: 4400 }, { xMm: 0, yMm: 0 }
    ],
    [
      { xMm: 0, yMm: 0 }, { xMm: 5600, yMm: 0 }, { xMm: 5600, yMm: 1600 },
      { xMm: 4300, yMm: 1600 }, { xMm: 4300, yMm: 2900 }, { xMm: 3000, yMm: 2900 },
      { xMm: 3000, yMm: 4200 }, { xMm: 0, yMm: 4200 }, { xMm: 0, yMm: 0 }
    ]
  ];

  fixtures.forEach((points) => {
    const draft = createClosedPolygonDraft(points);
    const floor = surveyGraph.getActiveFloor(draft);
    const scene = createScene(draft);
    const insetEndpoints = [];

    floor.walls.forEach((wall) => {
      const wallScene = scene.walls.find((item) => item.id === wall.id);
      [
        { nodeId: wall.startNodeId, insetMm: wall.measurementStartInsetMm, solid: wallScene.solidStartPoint, measured: wallScene.startPoint },
        { nodeId: wall.endNodeId, insetMm: wall.measurementEndInsetMm, solid: wallScene.solidEndPoint, measured: wallScene.endPoint }
      ].forEach((endpoint) => {
        if (!(endpoint.insetMm > 0)) return;
        const degree = floor.walls.filter((candidate) => (
          candidate.startNodeId === endpoint.nodeId || candidate.endNodeId === endpoint.nodeId
        )).length;
        if (degree !== 2) return;
        const node = surveyGraph.getNode(floor, endpoint.nodeId);
        const expected = {
          x: scene.rect.width / 2 + scene.viewport.offsetX + node.xMm * scene.viewport.scale,
          y: scene.rect.height / 2 + scene.viewport.offsetY + node.yMm * scene.viewport.scale
        };
        insetEndpoints.push(endpoint);
        assert.deepEqual(endpoint.solid, expected);
        assert.notDeepEqual(endpoint.solid, endpoint.measured);
      });
    });

    assert.ok(insetEndpoints.length >= 2);
  });
});

test('a selected T-junction source segment highlights only its physical junction-free span', () => {
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

  const splitSourceWalls = floor.walls.filter((wall) => (
    wall.id === sourceWall.id || wall.topologySourceWallId === sourceWall.id
  ));
  const insetWall = splitSourceWalls.find((wall) => (
    (wall.measurementStartInsetMm || 0) > 0 || (wall.measurementEndInsetMm || 0) > 0
  ));
  assert.ok(insetWall);

  draft = surveyGraph.selectWall(draft, insetWall.id);
  const scene = createScene(draft);
  const selectedWall = scene.walls.find((wall) => wall.id === insetWall.id);
  assert.ok(selectedWall.selected);
  assert.deepEqual(selectedWall.bodyPolygon, [
    selectedWall.solidStartPoint,
    selectedWall.solidEndPoint,
    selectedWall.solidOuterEnd,
    selectedWall.solidOuterStart
  ]);
  assert.deepEqual(selectedWall.selectionPolygon, [
    selectedWall.startPoint,
    selectedWall.endPoint,
    selectedWall.rawOuterEnd,
    selectedWall.rawOuterStart
  ]);
  assert.notDeepEqual(selectedWall.selectionPolygon, selectedWall.bodyPolygon);

  const insetAtStart = (insetWall.measurementStartInsetMm || 0) > 0;
  assert.notDeepEqual(
    insetAtStart ? selectedWall.startPoint : selectedWall.endPoint,
    insetAtStart ? selectedWall.solidStartPoint : selectedWall.solidEndPoint
  );

  const recorder = createRecordingContext();
  surveyCanvasRenderer.drawSurveyScene(recorder.context, scene, { dpr: 1 });
  const selectionFill = recorder.fillDetails.find((detail) => (
    detail.fillStyle === 'rgba(226, 73, 79, 0.92)'
  ));
  assert.ok(selectionFill);
  assert.deepEqual(selectionFill.path[0], [
    'moveTo',
    selectedWall.selectionPolygon[0].x,
    selectedWall.selectionPolygon[0].y
  ]);
});

test('partitioned-room wall selections clip symmetrically to the divider footprint', () => {
  const draft = createPartitionedRectangleDraft();
  const floor = surveyGraph.getActiveFloor(draft);
  const splitNode = floor.nodes.find((node) => node.xMm === 1500 && node.yMm === 0);
  const divider = floor.walls.find((wall) => (
    wall.startNodeId === splitNode.id && !wall.topologySourceWallId
  ));
  const sourceWalls = floor.walls.filter((wall) => (
    wall.topologySourceWallId &&
    (wall.startNodeId === splitNode.id || wall.endNodeId === splitNode.id)
  ));
  assert.ok(divider);
  assert.equal(sourceWalls.length, 2);

  sourceWalls.forEach((sourceWall) => {
    const selectedDraft = surveyGraph.selectWall(draft, sourceWall.id);
    const scene = createScene(selectedDraft);
    const selected = scene.walls.find((wall) => wall.id === sourceWall.id);
    const dividerScene = scene.walls.find((wall) => wall.id === divider.id);
    const atStart = sourceWall.startNodeId === splitNode.id;
    const nodePoint = atStart ? selected.solidStartPoint : selected.solidEndPoint;
    const dividerExtents = dividerScene.bodyPolygon.map((point) => (
      (point.x - nodePoint.x) * selected.direction.x +
      (point.y - nodePoint.y) * selected.direction.y
    ));
    const expectedCap = atStart
      ? Math.max(0, ...dividerExtents)
      : Math.min(0, ...dividerExtents);
    const capPoint = atStart ? selected.selectionPolygon[0] : selected.selectionPolygon[1];
    const actualCap =
      (capPoint.x - nodePoint.x) * selected.direction.x +
      (capPoint.y - nodePoint.y) * selected.direction.y;

    assert.equal(actualCap, expectedCap);
    assert.equal(
      (selected.selectionPolygon[3 - (atStart ? 0 : 1)].x - capPoint.x) * selected.direction.x +
        (selected.selectionPolygon[3 - (atStart ? 0 : 1)].y - capPoint.y) * selected.direction.y,
      0,
      'the clipped selection end must remain square'
    );
  });
});

test('a selected closed wall uses square caps instead of mitered selection ends', () => {
  let draft = createClosedRectangleDraft();
  const selectedWallId = surveyGraph.getActiveFloor(draft).walls[0].id;
  draft = surveyGraph.selectWall(draft, selectedWallId);
  const selectedWall = createScene(draft).walls.find((wall) => wall.id === selectedWallId);

  assert.ok(selectedWall.selected);
  assert.deepEqual(selectedWall.selectionPolygon, [
    selectedWall.startPoint,
    selectedWall.endPoint,
    selectedWall.rawOuterEnd,
    selectedWall.rawOuterStart
  ]);
  assert.notDeepEqual(selectedWall.rawOuterStart, selectedWall.outerStart);
  assert.notDeepEqual(selectedWall.rawOuterEnd, selectedWall.outerEnd);
  assert.equal(
    (selectedWall.selectionPolygon[3].x - selectedWall.selectionPolygon[0].x) * selectedWall.direction.x +
      (selectedWall.selectionPolygon[3].y - selectedWall.selectionPolygon[0].y) * selectedWall.direction.y,
    0
  );
  assert.equal(
    (selectedWall.selectionPolygon[2].x - selectedWall.selectionPolygon[1].x) * selectedWall.direction.x +
      (selectedWall.selectionPolygon[2].y - selectedWall.selectionPolygon[1].y) * selectedWall.direction.y,
    0
  );
});

test('wall outlines stroke the complete classified union as one closed path', () => {
  const scene = createScene(createClosedCornerCollinearClosureDraft());
  const recorder = createRecordingContext();

  surveyCanvasRenderer.drawSurveyScene(recorder.context, scene, { dpr: 1 });

  const wallOutlines = recorder.strokeDetails.filter((detail) => detail.strokeStyle === '#1f1f1f');
  assert.equal(wallOutlines.length, 1);
  assert.equal(
    wallOutlines[0].path.filter((command) => command[0] === 'moveTo').length,
    scene.wallSolidPlan.rings.length
  );
  assert.equal(
    wallOutlines[0].path.filter((command) => command[0] === 'closePath').length,
    scene.wallSolidPlan.rings.length
  );
});

test('closed corners render without source-polygon or scanline repair passes', () => {
  const scene = createScene(createClosedRectangleDraft());
  const recorder = createRecordingContext();

  surveyCanvasRenderer.drawSurveyScene(recorder.context, scene, { dpr: 3 });

  assert.equal(scene.wallSolidPlan.joinPolygons.length, 4);
  assert.equal(recorder.fillRectDetails.some((detail) => (
    detail.fillStyle === '#e2e2e0' || detail.fillStyle === '#8e8e8c'
  )), false);
  assert.equal(
    recorder.fillDetails.filter((detail) => detail.fillStyle === '#8e8e8c').length,
    1
  );
});

test('viewport interaction projects the same union rings used by the formal frame', () => {
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

  const closedFill = recorder.fillDetails.find((detail) => detail.fillStyle === '#8e8e8c');
  assert.ok(closedFill);
  const firstMove = closedFill.path.find((command) => command[0] === 'moveTo');
  assert.ok(firstMove);
  assert.equal(firstMove[1], scene.wallSolidPlans.closed.rings[0][0].x + 41);
  assert.equal(firstMove[2], scene.wallSolidPlans.closed.rings[0][0].y - 23);
});
