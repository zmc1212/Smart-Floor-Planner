const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createExteriorBoundarySegments,
  createExteriorDimensionPlan
} = require('../utils/surveyDimensionPlan.js');

function createGeometryBuilder() {
  const walls = [];
  const spaces = [];

  function addSpace(id, points, options) {
    const opts = options || {};
    const wallIds = [];
    points.forEach((startPoint, index) => {
      const endPoint = points[(index + 1) % points.length];
      const reverse = index === 0 && opts.reverseFirst;
      const start = reverse ? endPoint : startPoint;
      const end = reverse ? startPoint : endPoint;
      const wallId = `${id}-wall-${index}`;
      const length = Math.hypot(end.x - start.x, end.y - start.y);
      walls.push({
        id: wallId,
        start,
        end,
        coordinateLength: length,
        measurementLength: length,
        thickness: 200
      });
      wallIds.push(wallId);
    });
    spaces.push({ id, wallIds, closed: true });
  }

  return { walls, spaces, addSpace };
}

function midpoint(segment) {
  return {
    x: (segment.start.x + segment.end.x) / 2,
    y: (segment.start.y + segment.end.y) / 2
  };
}

test('geometric boundary merging cancels differently identified and split shared walls', () => {
  const geometry = createGeometryBuilder();
  geometry.addSpace('left', [
    { x: 0, y: 0 },
    { x: 3000, y: 0 },
    { x: 3000, y: 2000 },
    { x: 0, y: 2000 }
  ]);
  geometry.addSpace('right', [
    { x: 3000, y: 0 },
    { x: 6000, y: 0 },
    { x: 6000, y: 2000 },
    { x: 3000, y: 2000 },
    { x: 3000, y: 1000 }
  ], { reverseFirst: true });

  const boundary = createExteriorBoundarySegments({
    walls: geometry.walls,
    spaces: geometry.spaces,
    tolerance: 1
  });
  const sharedWallIds = new Set(['left-wall-1', 'right-wall-3', 'right-wall-4']);

  assert.equal(boundary.some((segment) => sharedWallIds.has(segment.sourceWallId)), false);
  assert.equal(boundary.every((segment) => {
    const center = midpoint(segment);
    return center.x === 0 || center.x === 6000 || center.y === 0 || center.y === 2000;
  }), true);

  const plan = createExteriorDimensionPlan({
    walls: boundary,
    openings: [],
    baseGap: 10,
    laneGap: 15,
    groupTolerance: 1
  });
  assert.deepEqual(
    plan.items.filter((item) => item.kind === 'chain-total').map((item) => item.label).sort(),
    ['6000', '6000']
  );
});

test('geometric boundary merging excludes enclosed holes from dimensions', () => {
  const geometry = createGeometryBuilder();
  geometry.addSpace('top', [
    { x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 1000 }, { x: 0, y: 1000 }
  ]);
  geometry.addSpace('left', [
    { x: 0, y: 1000 }, { x: 1000, y: 1000 }, { x: 1000, y: 3000 }, { x: 0, y: 3000 }
  ]);
  geometry.addSpace('right', [
    { x: 3000, y: 1000 }, { x: 4000, y: 1000 }, { x: 4000, y: 3000 }, { x: 3000, y: 3000 }
  ]);
  geometry.addSpace('bottom', [
    { x: 0, y: 3000 }, { x: 4000, y: 3000 }, { x: 4000, y: 4000 }, { x: 0, y: 4000 }
  ]);

  const boundary = createExteriorBoundarySegments({
    walls: geometry.walls,
    spaces: geometry.spaces,
    tolerance: 1
  });
  const totalLength = boundary.reduce((sum, segment) => sum + segment.measurementLength, 0);

  assert.equal(Math.round(totalLength), 16000);
  assert.equal(boundary.every((segment) => {
    const center = midpoint(segment);
    return center.x === 0 || center.x === 4000 || center.y === 0 || center.y === 4000;
  }), true);
});

test('dimension extension lines start at the exterior wall face instead of the measured centerline', () => {
  const wall = {
    id: 'exterior-wall',
    sourceWallId: 'exterior-wall',
    closed: true,
    isExteriorBoundary: true,
    start: { x: 0, y: 0 },
    end: { x: 3000, y: 0 },
    coordinateLength: 3000,
    measurementLength: 3000,
    thickness: 200,
    outsideSign: -1
  };
  const plan = createExteriorDimensionPlan({
    walls: [wall],
    openings: [{
      id: 'door',
      wallId: wall.id,
      type: 'door',
      start: 1000,
      end: 1900
    }],
    baseGap: 120,
    laneGap: 180,
    groupTolerance: 1
  });

  assert.equal(plan.items.length, 3);
  plan.items.forEach((item) => {
    assert.equal(item.extensionStart.y, -200);
    assert.equal(item.extensionEnd.y, -200);
    assert.equal(item.start.y, -320);
    assert.equal(item.end.y, -320);
  });
});
