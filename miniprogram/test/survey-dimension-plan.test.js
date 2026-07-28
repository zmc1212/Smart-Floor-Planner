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
    ['2000', '2000', '6000', '6000']
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

test('door positioning and total dimensions start at the exterior wall face', () => {
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

  assert.equal(plan.items.length, 4);
  assert.deepEqual(plan.items.map((item) => item.kind), [
    'opening-segment', 'opening-segment', 'opening-segment', 'chain-total'
  ]);
  plan.items.slice(0, 3).forEach((item) => {
    assert.equal(item.extensionStart.y, -200);
    assert.equal(item.extensionEnd.y, -200);
    assert.equal(item.start.y, -320);
    assert.equal(item.end.y, -320);
  });
  assert.equal(plan.items[3].start.y, -500);
  assert.equal(plan.items[3].end.y, -500);
});

test('continuous exterior walls use a positioning chain below one V8 total', () => {
  const walls = [
    [0, 3000, 'left'],
    [3000, 7200, 'middle'],
    [7200, 9700, 'right']
  ].map(([startX, endX, id]) => ({
    id,
    sourceWallId: id,
    closed: true,
    isExteriorBoundary: true,
    start: { x: startX, y: 0 },
    end: { x: endX, y: 0 },
    outerStart: { x: startX - 100, y: -200 },
    outerEnd: { x: endX + 100, y: -200 },
    coordinateLength: endX - startX,
    measurementLength: endX - startX,
    thickness: 200,
    outsideSign: -1
  }));
  const plan = createExteriorDimensionPlan({
    walls,
    baseGap: 120,
    laneGap: 180,
    groupTolerance: 1
  });

  assert.deepEqual(plan.items.filter((item) => item.kind === 'chain-segment').map((item) => item.label), ['3000', '4200', '2500']);
  const total = plan.items.find((item) => item.kind === 'chain-total');
  assert.equal(total.label, '9700');
  assert.equal(total.lane, 1);
  assert.equal(plan.items.every((item) => item.extensionStart.y === -200 && item.extensionEnd.y === -200), true);
});

test('dimension lines preserve mitered exterior wall corners as their extension origins', () => {
  const wall = {
    id: 'mitered-wall',
    sourceWallId: 'mitered-wall',
    closed: true,
    isExteriorBoundary: true,
    start: { x: 0, y: 0 },
    end: { x: 3000, y: 0 },
    outerStart: { x: -120, y: -200 },
    outerEnd: { x: 3120, y: -200 },
    coordinateLength: 3000,
    measurementLength: 3000,
    thickness: 200,
    outsideSign: -1
  };
  const plan = createExteriorDimensionPlan({
    walls: [wall],
    baseGap: 120,
    laneGap: 180,
    groupTolerance: 1
  });

  assert.equal(plan.items.length, 1);
  assert.deepEqual(plan.items[0].extensionStart, wall.outerStart);
  assert.deepEqual(plan.items[0].extensionEnd, wall.outerEnd);
  assert.deepEqual(plan.items[0].start, { x: -120, y: -320 });
  assert.deepEqual(plan.items[0].end, { x: 3120, y: -320 });
});

test('reentrant exterior edges route their dimensions beyond the whole closed plan', () => {
  const geometry = createGeometryBuilder();
  geometry.addSpace('notched', [
    { x: 0, y: 0 },
    { x: 4000, y: 0 },
    { x: 4000, y: 1000 },
    { x: 2000, y: 1000 },
    { x: 2000, y: 3000 },
    { x: 0, y: 3000 }
  ]);
  const boundary = createExteriorBoundarySegments({
    walls: geometry.walls,
    spaces: geometry.spaces,
    tolerance: 1
  });
  const baseGap = 120;
  const plan = createExteriorDimensionPlan({
    walls: boundary,
    baseGap,
    laneGap: 180,
    groupTolerance: 1
  });

  assert.deepEqual(
    plan.items.filter((item) => item.kind === 'chain-total').map((item) => item.label).sort(),
    ['3000', '3000', '4000', '4000']
  );

  plan.items.forEach((item) => {
    const outerSupport = Math.max(...boundary.flatMap((wall) => [wall.outerStart, wall.outerEnd])
      .map((point) => point.x * item.normal.x + point.y * item.normal.y));
    assert.ok(
      item.start.x * item.normal.x + item.start.y * item.normal.y >= outerSupport + baseGap - 0.001,
      `${item.id} should be placed beyond the full exterior outline`
    );
  });
});
