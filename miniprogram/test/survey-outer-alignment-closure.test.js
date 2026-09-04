const test = require('node:test');
const assert = require('node:assert/strict');
const graph = require('../packages/surveying/utils/surveyWallGraph.js');

const point = (xMm, yMm) => ({ xMm: xMm || 0, yMm: yMm || 0 });
const coordinates = (value) => point(value.xMm, value.yMm);

function adjacentRoomPreview({ thickness = 200, turns = 0, mirror = false, nearBoundary = false } = {}) {
  const transform = (x, y) => {
    let result = point(mirror ? -x : x, y);
    for (let turn = 0; turn < turns; turn += 1) result = point(-result.yMm, result.xMm);
    return result;
  };
  const commit = (draft, x, y, length) => graph.commitPreviewLength(
    graph.startPreview(draft, transform(x, y)), length, 'manual'
  );
  let draft = graph.placeCursor(graph.createSurveyDraft(), transform(0, 0));
  graph.getActiveFloor(draft).session.thicknessMm = thickness;
  draft = commit(draft, 3000, 0, 3000);
  draft = commit(draft, 3000, 4000, 4000);
  draft = commit(draft, 0, 4000, 3000);
  draft = commit(draft, 0, 0, 4000);
  draft = graph.confirmClosure(draft);
  let floor = graph.getActiveFloor(draft);
  const originalSpaceId = floor.spaces[0].id;
  const originalBoundary = graph.buildSpaceRenderBoundaryPoints(floor, floor.spaces[0]);
  const sourceWallGeometry = graph.buildWallRenderGeometry(floor, floor.walls[1]);
  const acrossKey = turns % 2 ? 'yMm' : 'xMm';
  const sourceBodyBounds = [sourceWallGeometry.start[acrossKey], sourceWallGeometry.outerStart[acrossKey]].sort((a, b) => a - b);
  const target = graph.getCursorPlacementTarget(floor, transform(3000, 4000), 350);
  draft = graph.snapCursorToWall(graph.startWallSnap(draft), target.pointMm, target);
  draft = commit(draft, 5000, 4000, 2000 - thickness);
  const rawY = nearBoundary ? 300 : -1000;
  draft = commit(draft, 5000, rawY, 4000 - rawY);
  draft = graph.startPreview(draft, transform(3000 + thickness, rawY));
  floor = graph.getActiveFloor(draft);
  return { draft, transform, originalSpaceId, originalBoundary, acrossKey, sourceBodyBounds };
}

test('release retains the visible outer-face endpoint after the preview overrides rectangle snapping', () => {
  const { draft } = adjacentRoomPreview({ nearBoundary: true });
  const before = graph.getActiveFloor(draft);
  assert.ok(before.session.previewOuterFaceWallId);
  const visiblePoint = coordinates(graph.getCursorDisplayPoint(before, before.session));
  assert.equal(visiblePoint.xMm, 3200);
  const committed = graph.commitPreviewLength(draft, before.session.previewLengthMm, 'preview');
  const after = graph.getActiveFloor(committed);
  assert.deepEqual(coordinates(graph.getCursorDisplayPoint(after, after.session)), visiblePoint);
});

for (const thickness of [100, 200, 400]) {
  for (const turns of [0, 1, 2, 3]) {
    for (const mirror of [false, true]) {
      test(`outer-aligned adjacent closure keeps cursor, wall length and shared body (${thickness}mm, ${turns * 90}deg, mirror=${mirror})`, () => {
        const { draft, transform, originalSpaceId, originalBoundary, acrossKey, sourceBodyBounds } = adjacentRoomPreview({ thickness, turns, mirror });
        const previewFloor = graph.getActiveFloor(draft);
        const endpoint = transform(3000 + thickness, -1000);
        assert.deepEqual(previewFloor.session.previewPoint, endpoint, 'outer alignment wins over the nearby inner rectangle axis');
        const inputSnapshot = JSON.stringify(draft);
        const previewLength = previewFloor.session.previewLengthMm;
        let result = graph.commitPreviewLength(draft, previewLength, 'preview');
        const committedFloor = graph.getActiveFloor(result);
        const wallId = committedFloor.walls.at(-1).id;
        assert.deepEqual(coordinates(graph.getCursorDisplayPoint(committedFloor, committedFloor.session)), endpoint);
        assert.equal(committedFloor.session.state, 'mergeClosing');
        const guide = graph.getClosurePath(committedFloor, committedFloor.session);
        assert.deepEqual(guide[0], endpoint);
        assert.deepEqual(guide[1], transform(3000 + thickness, 0), 'close continues along the aligned outer face before bridging to topology');

        result = graph.confirmClosure(result);
        const floor = graph.getActiveFloor(result);
        assert.equal(floor.spaces.length, 2);
        const measuredWall = graph.getWall(floor, wallId);
        assert.deepEqual(coordinates(graph.getNode(floor, measuredWall.endNodeId)), endpoint);
        assert.equal(measuredWall.lengthMm, previewLength, 'closing must not extend the measured top wall onto the inner axis');
        assert.equal(measuredWall.rawMeasuredLengthMm, previewLength);
        assert.equal(measuredWall.closureAdjustmentMm, 0);
        const closingWall = floor.walls.find(wall => (
          wall.startNodeId === measuredWall.endNodeId && wall.id !== wallId
        ));
        assert.ok(closingWall);
        const closingGeometry = graph.buildWallRenderGeometry(floor, closingWall);
        assert.deepEqual(
          [closingGeometry.start[acrossKey], closingGeometry.outerStart[acrossKey]].sort((a, b) => a - b),
          sourceBodyBounds,
          'the return wall occupies exactly the same thickness band as the shared wall'
        );
        assert.deepEqual(graph.buildSpaceRenderBoundaryPoints(floor, floor.spaces.find(space => space.id === originalSpaceId)), originalBoundary);
        const validation = graph.validateSurveyDraft(result, { mode: 'full' });
        assert.equal(validation.valid, true, JSON.stringify(validation.errors));
        const directFloor = graph.getActiveFloor(graph.confirmClosure(draft));
        const directMeasuredWall = directFloor.walls.find(wall => wall.inputSource === 'closure-preview');
        assert.ok(directMeasuredWall, 'confirming directly from the preview also commits the visible wall');
        assert.deepEqual(coordinates(graph.getNode(directFloor, directMeasuredWall.endNodeId)), endpoint);
        assert.equal(directMeasuredWall.lengthMm, previewLength);
        assert.deepEqual(
          graph.buildSpaceRenderBoundaryPoints(directFloor, directFloor.spaces.find(space => space.id !== originalSpaceId)),
          graph.buildSpaceRenderBoundaryPoints(floor, floor.spaces.find(space => space.id !== originalSpaceId))
        );
        assert.equal(JSON.stringify(draft), inputSnapshot, 'preview input remains immutable');
      });
    }
  }
}
