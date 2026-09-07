const test = require('node:test');
const assert = require('node:assert/strict');
const graph = require('../packages/surveying/utils/surveyWallGraph.js');
const layout = require('../utils/surveyLayout.js');

// Reproduce the reported right -> down -> left chain. The older room's outer
// top is collinear with the new top; it must not flip that measured wall.
function scene(thickness, turns, mirror, outer) {
  const transform = (x, y) => {
    let point = { xMm: mirror ? -x : x, yMm: y };
    for (let turn = 0; turn < turns; turn += 1) {
      point = { xMm: -point.yMm, yMm: point.xMm };
    }
    return point;
  };
  let draft = graph.setThickness(graph.createSurveyDraft(), thickness);
  draft = graph.placeCursor(draft, transform(-3000, thickness));
  const commit = (x, y, length) => {
    draft = graph.commitPreviewLength(graph.startPreview(draft, transform(x, y)), length, 'manual');
  };
  const snap = (x, y) => {
    const floor = graph.getActiveFloor(draft);
    const target = graph.getCursorPlacementTarget(floor, transform(x, y), 30);
    assert.ok(target);
    draft = graph.snapCursorToWall(graph.startWallSnap(draft), target.pointMm, target);
  };
  commit(0, thickness, 3000);
  commit(0, 6000, 6000 - thickness);
  commit(-3000, 6000, 3000);
  commit(-3000, thickness, 6000 - thickness);
  draft = graph.confirmClosure(draft);
  snap(0, 6000);
  commit(3000, 6000, 3000 - thickness);
  commit(3000, 0, 6000);
  commit(thickness, 0, 3000 - thickness);
  draft = graph.confirmClosure(draft);
  const floor = graph.getActiveFloor(draft);
  const originalRooms = floor.spaces.map(space => ({
    id: space.id, boundary: graph.buildSpaceRenderBoundaryPoints(floor, space)
  }));
  snap(3000, 0);
  commit(6000, 0, 3000 - thickness);
  const topWallId = graph.getActiveFloor(draft).walls.at(-1).id;
  const endY = 6000 + (outer ? thickness : 0);
  commit(6000, endY, endY);
  const rightWallId = graph.getActiveFloor(draft).walls.at(-1).id;
  draft = graph.startPreview(draft, transform(3000 + thickness, endY));
  return { draft, transform, endY, topWallId, rightWallId, originalRooms };
}

for (const thickness of [100, 200, 400]) {
  for (const turns of [0, 1, 2, 3]) {
    for (const mirror of [false, true]) {
      for (const outer of [false, true]) {
        for (const direct of [false, true]) {
          test(`measured closure face ${thickness}mm rotation=${turns} mirror=${mirror} outer=${outer} direct=${direct}`, () => {
            const { draft, transform, endY, topWallId, rightWallId, originalRooms } = scene(thickness, turns, mirror, outer);
            const before = JSON.stringify(draft);
            const previewFloor = graph.getActiveFloor(draft);
            let result = direct ? draft : graph.commitPreviewLength(draft, previewFloor.session.previewLengthMm, 'preview');
            result = graph.confirmClosure(result);
            const check = (value) => {
              const floor = graph.getActiveFloor(value);
              assert.equal(floor.spaces.length, 3);
              assert.deepEqual(graph.validateSurveyDraft(value, { mode: 'full' }).errors, []);
              for (const room of originalRooms) {
                assert.deepEqual(graph.buildSpaceRenderBoundaryPoints(floor, floor.spaces.find(s => s.id === room.id)), room.boundary);
              }
              const top = graph.getWall(floor, topWallId);
              assert.ok(top, 'the measured top wall remains part of the new closure');
              const right = graph.getWall(floor, rightWallId);
              const rightEnd = graph.getNode(floor, right.endNodeId);
              assert.ok(rightEnd);
              assert.ok(Number.isFinite(right.lengthMm));
              const newRoom = floor.spaces.find(space => !originalRooms.some(room => room.id === space.id));
              assert.ok(newRoom && newRoom.closed);
              if (outer) {
                const a = transform(3000 + thickness, endY);
                const b = transform(3000 + thickness, 6000);
                assert.ok(floor.walls.some(wall => {
                  const start = graph.getNode(floor, wall.startNodeId);
                  const end = graph.getNode(floor, wall.endNodeId);
                  return start.xMm === a.xMm && start.yMm === a.yMm && end.xMm === b.xMm && end.yMm === b.yMm;
                }), 'outer alignment retains the one-thickness return segment');
              }
            };
            check(result);
            check(layout.parseFormalSurveyLayout(JSON.stringify(layout.createFormalSurveyLayout(result, 'draft'))).surveyGraph);
            assert.equal(JSON.stringify(draft), before, 'closure must not mutate its input');
          });
        }
      }
    }
  }
}
