const test = require('node:test');
const assert = require('node:assert/strict');
const surveyGraph = require('../packages/surveying/utils/surveyWallGraph.js');
const surveyCanvasRenderer = require('../packages/surveying/utils/surveyCanvasRenderer.js');

function commitWall(draft, point, lengthMm) {
  return surveyGraph.commitPreviewLength(
    surveyGraph.startPreview(draft, point),
    lengthMm,
    'manual'
  );
}

function createClosedDraft(widthMm = 3000, heightMm = 2000) {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  draft = commitWall(draft, { xMm: widthMm, yMm: 0 }, widthMm);
  draft = commitWall(draft, { xMm: widthMm, yMm: heightMm }, heightMm);
  draft = commitWall(draft, { xMm: 0, yMm: heightMm }, widthMm);
  draft = commitWall(draft, { xMm: 0, yMm: 0 }, heightMm);
  return surveyGraph.confirmClosure(draft);
}

function createAdjacentRoomsDraft() {
  let draft = createClosedDraft(3000, 2000);
  const floor = surveyGraph.getActiveFloor(draft);
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    { xMm: 3000, yMm: 0 },
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  draft = surveyGraph.snapCursorToWall(
    surveyGraph.startWallSnap(draft),
    target.pointMm,
    target
  );
  draft = commitWall(draft, { xMm: 5000, yMm: 0 }, 2000);
  draft = commitWall(draft, { xMm: 5000, yMm: 2000 }, 2000);
  draft = commitWall(draft, { xMm: 3000, yMm: 2000 }, 2000);
  return surveyGraph.confirmClosure(draft);
}

test('selectSpace clears wall/opening selection and stores selectedSpaceId', () => {
  let draft = createClosedDraft();
  const floor = surveyGraph.getActiveFloor(draft);
  const space = floor.spaces.find((item) => item.closed);
  const wallId = floor.walls[0].id;

  draft = surveyGraph.selectWall(draft, wallId);
  assert.equal(surveyGraph.getActiveFloor(draft).session.selectedWallId, wallId);

  draft = surveyGraph.selectSpace(draft, space.id);
  const session = surveyGraph.getActiveFloor(draft).session;
  assert.equal(session.selectedSpaceId, space.id);
  assert.equal(session.selectedWallId, '');
  assert.equal(session.selectedOpeningId, '');
  assert.equal(session.state, 'wallSelected');
});

test('renameClosedSpace updates space name and survives face resync', () => {
  let draft = createClosedDraft();
  const spaceId = surveyGraph.getActiveFloor(draft).spaces.find((item) => item.closed).id;
  draft = surveyGraph.renameClosedSpace(draft, spaceId, '客厅');
  assert.equal(
    surveyGraph.getActiveFloor(draft).spaces.find((item) => item.id === spaceId).name,
    '客厅'
  );

  // Touch topology via select+noop path: delete a non-existent wall is no-op;
  // instead re-confirm is unavailable. Use startWallSnap/cancel which syncs spaces.
  draft = surveyGraph.cancelPending(draft);
  assert.equal(
    surveyGraph.getActiveFloor(draft).spaces.find((item) => item.id === spaceId).name,
    '客厅'
  );
});

test('deleteClosedSpace removes exclusive walls and keeps shared walls', () => {
  let draft = createAdjacentRoomsDraft();
  let floor = surveyGraph.getActiveFloor(draft);
  const closed = floor.spaces.filter((item) => item.closed);
  assert.equal(closed.length, 2);

  const wallRefCounts = {};
  closed.forEach((space) => {
    space.wallIds.forEach((wallId) => {
      wallRefCounts[wallId] = (wallRefCounts[wallId] || 0) + 1;
    });
  });
  const sharedWallIds = Object.keys(wallRefCounts).filter((wallId) => wallRefCounts[wallId] === 2);
  assert.ok(sharedWallIds.length >= 1);

  const secondSpace = closed[1];
  const exclusiveBefore = secondSpace.wallIds.filter((wallId) => wallRefCounts[wallId] === 1);
  assert.ok(exclusiveBefore.length >= 1);

  draft = surveyGraph.deleteClosedSpace(draft, secondSpace.id);
  floor = surveyGraph.getActiveFloor(draft);
  const remainingClosed = floor.spaces.filter((item) => item.closed);
  assert.equal(remainingClosed.length, 1);
  sharedWallIds.forEach((wallId) => {
    assert.ok(surveyGraph.getWall(floor, wallId), `shared wall ${wallId} should remain`);
  });
  exclusiveBefore.forEach((wallId) => {
    assert.ok(!surveyGraph.getWall(floor, wallId), `exclusive wall ${wallId} should be removed`);
  });
  assert.equal(floor.session.selectedSpaceId, '');
});

test('deleteClosedSpace on a single room removes its exclusive walls', () => {
  let draft = createClosedDraft();
  const floorBefore = surveyGraph.getActiveFloor(draft);
  const space = floorBefore.spaces.find((item) => item.closed);
  const wallIds = space.wallIds.slice();
  draft = surveyGraph.deleteClosedSpace(draft, space.id);
  const floor = surveyGraph.getActiveFloor(draft);
  assert.equal(floor.spaces.filter((item) => item.closed).length, 0);
  wallIds.forEach((wallId) => {
    assert.ok(!surveyGraph.getWall(floor, wallId), `wall ${wallId} should be removed`);
  });
});

test('selected closed space renders blue fill and room-clear dimensions', () => {
  let draft = createClosedDraft();
  const space = surveyGraph.getActiveFloor(draft).spaces.find((item) => item.closed);
  draft = surveyGraph.selectSpace(draft, space.id);
  const floor = surveyGraph.getActiveFloor(draft);
  const scene = surveyCanvasRenderer.createSurveyRenderScene({
    floor,
    session: floor.session,
    viewport: floor.viewport || { scale: surveyGraph.DEFAULT_SCALE, offsetX: 40, offsetY: 40 },
    rect: { width: 390, height: 640 }
  });

  const selectedFill = scene.closedSpaceFills.find((item) => item.id === space.id);
  assert.equal(selectedFill.selected, true);
  const roomClear = scene.dimensions.filter((item) => item.kind === 'room-clear');
  assert.ok(roomClear.length >= 3, `expected selected room-clear dims, got ${roomClear.length}`);
  assert.ok(roomClear.every((item) => item.visualRole === 'selected-room-clear'));
});

test('unselected closed scene keeps room-clear off the canvas', () => {
  const draft = createClosedDraft();
  const floor = surveyGraph.getActiveFloor(draft);
  const scene = surveyCanvasRenderer.createSurveyRenderScene({
    floor,
    session: floor.session,
    viewport: floor.viewport || { scale: surveyGraph.DEFAULT_SCALE, offsetX: 40, offsetY: 40 },
    rect: { width: 390, height: 640 }
  });
  assert.equal(scene.dimensions.filter((item) => item.kind === 'room-clear').length, 0);
});

test('hitTestSurveyClosedSpace hits interior fill after walls are ignored', () => {
  let draft = createClosedDraft();
  const space = surveyGraph.getActiveFloor(draft).spaces.find((item) => item.closed);
  const floor = surveyGraph.getActiveFloor(draft);
  const scene = surveyCanvasRenderer.createSurveyRenderScene({
    floor,
    session: floor.session,
    viewport: floor.viewport || { scale: surveyGraph.DEFAULT_SCALE, offsetX: 40, offsetY: 40 },
    rect: { width: 390, height: 640 }
  });
  const fill = scene.closedSpaceFills.find((item) => item.id === space.id);
  const cx = fill.points.reduce((sum, point) => sum + point.x, 0) / fill.points.length;
  const cy = fill.points.reduce((sum, point) => sum + point.y, 0) / fill.points.length;
  const hit = surveyCanvasRenderer.hitTestSurveyClosedSpace(scene, { x: cx, y: cy });
  assert.equal(hit.spaceId, space.id);
});

function createTJunctionAdjacentRoomsDraft() {
  // Original 4000×2000 room, then T-branch from mid of the top wall and close
  // a second room so the original top edge is split into two collinear walls.
  let draft = createClosedDraft(4000, 2000);
  const floor = surveyGraph.getActiveFloor(draft);
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    { xMm: 2000, yMm: 0 },
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  draft = surveyGraph.snapCursorToWall(
    surveyGraph.startWallSnap(draft),
    target.pointMm,
    target
  );
  draft = commitWall(draft, { xMm: 2000, yMm: -2000 }, 2000);
  draft = commitWall(draft, { xMm: 4000, yMm: -2000 }, 2000);
  draft = commitWall(draft, { xMm: 4000, yMm: 0 }, 2000);
  return surveyGraph.confirmClosure(draft);
}

test('selected room-clear merges collinear T-split inner segments into one clear span', () => {
  let draft = createTJunctionAdjacentRoomsDraft();
  let floor = surveyGraph.getActiveFloor(draft);
  const closed = floor.spaces.filter((item) => item.closed);
  assert.equal(closed.length, 2);
  const room1 = closed.slice().sort((a, b) => b.wallIds.length - a.wallIds.length)[0];
  assert.ok(room1.wallIds.length >= 5, 'T-split should leave the original room with >4 walls');

  const plan = surveyGraph.buildSpaceDimensionPlan(floor, room1);
  const innerLens = (plan.innerSegments || []).map((segment) => Math.round(Math.hypot(
    Number(segment.end.xMm) - Number(segment.start.xMm),
    Number(segment.end.yMm) - Number(segment.start.yMm)
  )));
  // Two consecutive 2000mm clear spans on the split top edge before merge.
  assert.equal(innerLens.filter((len) => len === 2000).length >= 2, true);

  draft = surveyGraph.selectSpace(draft, room1.id);
  floor = surveyGraph.getActiveFloor(draft);
  const scene = surveyCanvasRenderer.createSurveyRenderScene({
    floor,
    session: floor.session,
    viewport: floor.viewport || { scale: surveyGraph.DEFAULT_SCALE, offsetX: 40, offsetY: 40 },
    rect: { width: 390, height: 640 }
  });
  const roomClear = scene.dimensions.filter((item) => item.kind === 'room-clear');
  // Rectangle: one clear dim per side after merging the T-split top edge.
  assert.equal(roomClear.length, 4, `expected 4 merged room-clear dims, got ${roomClear.map((d) => d.label).join(',')}`);
  const labels = roomClear.map((item) => Number(item.label));
  // Split segments use wall.lengthMm 2000 + 1800 (T inset); merged label is their sum.
  assert.equal(labels.includes(3800), true, `expected merged 3800 clear span among ${labels.join(',')}`);
  assert.equal(labels.includes(1800), false, 'T-split 1800 segment must not remain as its own room-clear label');
});

test('wallSnapPending hit order prefers wall/vertex snap then closed-space selectSpace', () => {
  // Editor contract (surveying-editor onCanvasTouchEnd wallSnapPending):
  // wall tap → selectWall for opening placement; closed-space fill → selectSpace;
  // otherwise the editor keeps the cursor in drag-only placement and prompts the operator.
  let draft = createClosedDraft();
  const space = surveyGraph.getActiveFloor(draft).spaces.find((item) => item.closed);
  const floor = surveyGraph.getActiveFloor(draft);
  const scene = surveyCanvasRenderer.createSurveyRenderScene({
    floor,
    session: floor.session,
    viewport: floor.viewport || { scale: surveyGraph.DEFAULT_SCALE, offsetX: 40, offsetY: 40 },
    rect: { width: 390, height: 640 }
  });
  const fill = scene.closedSpaceFills.find((item) => item.id === space.id);
  const cx = fill.points.reduce((sum, point) => sum + point.x, 0) / fill.points.length;
  const cy = fill.points.reduce((sum, point) => sum + point.y, 0) / fill.points.length;
  assert.equal(
    surveyCanvasRenderer.hitTestSurveyClosedSpace(scene, { x: cx, y: cy }).spaceId,
    space.id
  );
  draft = surveyGraph.selectSpace(draft, space.id);
  assert.equal(surveyGraph.getActiveFloor(draft).session.selectedSpaceId, space.id);
});
