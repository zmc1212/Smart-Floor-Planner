const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createExteriorBoundarySegments,
  createExteriorDimensionPlan,
  createClosedDimensionPlan
} = require('../packages/surveying/utils/surveyDimensionPlan.js');

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

function createSpacePlan(id, points) {
  return {
    spaceId: id,
    innerBoundaryPoints: points,
    innerSegments: points.map((start, index) => ({
      wallId: `${id}-wall-${index}`,
      start,
      end: points[(index + 1) % points.length]
    }))
  };
}

function createWallsForPlan(plan, thickness) {
  return plan.innerSegments.map((segment) => ({
    id: segment.wallId,
    start: segment.start,
    end: segment.end,
    coordinateLength: Math.hypot(segment.end.x - segment.start.x, segment.end.y - segment.start.y),
    measurementLength: Math.hypot(segment.end.x - segment.start.x, segment.end.y - segment.start.y),
    thickness: thickness || 200
  }));
}

function createClosedPlanInput(spacePlans, outerRing, options) {
  const plans = Array.isArray(spacePlans) ? spacePlans : [spacePlans];
  const walls = plans.flatMap((plan) => createWallsForPlan(plan, options && options.thickness));
  return Object.assign({
    walls,
    spaces: plans.map((plan) => ({
      id: plan.spaceId,
      wallIds: plan.innerSegments.map((segment) => segment.wallId),
      closed: true
    })),
    spacePlans: plans,
    outerRings: [outerRing],
    baseGap: 100,
    laneGap: 100,
    groupTolerance: 1,
    measurementUnitsPerCoordinate: 1,
    openings: []
  }, options || {});
}

function projection(value, normal) {
  return value.x * normal.x + value.y * normal.y;
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

test('closed single room emits clear dimensions and physical building totals on all four sides', () => {
  const room = createSpacePlan('room', [
    { x: 0, y: 0 }, { x: 2100, y: 0 }, { x: 2100, y: 3160 }, { x: 0, y: 3160 }
  ]);
  const outerRing = [
    { x: -200, y: -200 }, { x: 2300, y: -200 }, { x: 2300, y: 3360 }, { x: -200, y: 3360 }
  ];
  const plan = createClosedDimensionPlan(createClosedPlanInput(room, outerRing));
  const clear = plan.items.filter((item) => item.kind === 'room-clear');
  const overall = plan.items.filter((item) => item.kind === 'building-overall');

  assert.equal(plan.fallback, false);
  assert.deepEqual(clear.map((item) => item.label).sort(), ['2100', '2100', '3160', '3160']);
  assert.deepEqual(overall.map((item) => item.label).sort(), ['2500', '2500', '3560', '3560']);
  assert.equal(clear.every((item) => item.lane === 0), true);
  assert.equal(overall.every((item) => item.lane === 1), true);
  assert.equal(clear.every((item) => room.innerBoundaryPoints.some((point) => (
    Math.hypot(point.x - item.extensionStart.x, point.y - item.extensionStart.y) < 0.001
  ))), true);
  assert.equal(overall.every((item) => outerRing.some((point) => (
    Math.hypot(point.x - item.extensionStart.x, point.y - item.extensionStart.y) < 0.001
  ))), true);

  plan.items.forEach((item) => {
    const outlineSupport = Math.max(...outerRing.map((point) => projection(point, item.normal)));
    assert.ok(projection(item.start, item.normal) >= outlineSupport + 99.999);
    assert.ok(projection(item.end, item.normal) >= outlineSupport + 99.999);
  });
});

test('adjacent rooms create an exterior clear chain without dimensioning the shared wall', () => {
  const left = createSpacePlan('left', [
    { x: 0, y: 0 }, { x: 3370, y: 0 }, { x: 3370, y: 3160 }, { x: 0, y: 3160 }
  ]);
  const right = createSpacePlan('right', [
    { x: 3570, y: 0 }, { x: 5670, y: 0 }, { x: 5670, y: 3160 }, { x: 3570, y: 3160 }
  ]);
  const outerRing = [
    { x: -200, y: -200 }, { x: 5870, y: -200 }, { x: 5870, y: 3360 }, { x: -200, y: 3360 }
  ];
  const plan = createClosedDimensionPlan(createClosedPlanInput([left, right], outerRing));
  const clear = plan.items.filter((item) => item.kind === 'room-clear');
  const overall = plan.items.filter((item) => item.kind === 'building-overall');

  assert.deepEqual(clear.map((item) => item.label).sort(), ['2100', '2100', '3160', '3160', '3370', '3370']);
  assert.deepEqual(overall.map((item) => item.label).sort(), ['3560', '3560', '6070', '6070']);
  assert.equal(clear.filter((item) => item.sourceSpaceId === 'left').length, 3);
  assert.equal(clear.filter((item) => item.sourceSpaceId === 'right').length, 3);
  assert.equal(clear.some((item) => item.sourceWallId === 'left-wall-1'), false);
  assert.equal(clear.some((item) => item.sourceWallId === 'right-wall-3'), false);
});

test('door positioning stays inside the clear and overall dimension lanes', () => {
  const room = createSpacePlan('door-room', [
    { x: 0, y: 0 }, { x: 2100, y: 0 }, { x: 2100, y: 3160 }, { x: 0, y: 3160 }
  ]);
  const outerRing = [
    { x: -200, y: -200 }, { x: 2300, y: -200 }, { x: 2300, y: 3360 }, { x: -200, y: 3360 }
  ];
  const input = createClosedPlanInput(room, outerRing, {
    openings: [{ id: 'door', wallId: 'door-room-wall-0', type: 'door', start: 600, end: 1500 }]
  });
  input.walls[0].outerStart = outerRing[0];
  input.walls[0].outerEnd = outerRing[1];
  const plan = createClosedDimensionPlan(input);
  const opening = plan.items.filter((item) => item.kind === 'opening-segment');
  const clear = plan.items.find((item) => item.kind === 'room-clear' && item.sourceWallId === 'door-room-wall-0');
  const overall = plan.items.find((item) => item.kind === 'building-overall' && item.normal.y === -1);

  assert.deepEqual(opening.map((item) => item.label), ['600', '900', '600']);
  assert.equal(opening.every((item) => item.lane === 0), true);
  assert.equal(clear.lane, 1);
  assert.equal(overall.lane, 2);
});

test('building totals use outer-ring geometry with unequal wall offsets', () => {
  const room = createSpacePlan('unequal', [
    { x: 0, y: 0 }, { x: 2100, y: 0 }, { x: 2100, y: 3160 }, { x: 0, y: 3160 }
  ]);
  const outerRing = [
    { x: -100, y: -250 }, { x: 2500, y: -250 }, { x: 2500, y: 3460 }, { x: -100, y: 3460 }
  ];
  const plan = createClosedDimensionPlan(createClosedPlanInput(room, outerRing, { thickness: 250 }));

  assert.deepEqual(
    plan.items.filter((item) => item.kind === 'building-overall').map((item) => item.label).sort(),
    ['2600', '2600', '3710', '3710']
  );
});

test('L, U, and stepped orthogonal rooms use directed edges and keep dimensions outside', () => {
  const fixtures = [
    {
      id: 'l-room',
      inner: [
        { x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 1000 },
        { x: 2000, y: 1000 }, { x: 2000, y: 3000 }, { x: 0, y: 3000 }
      ],
      outer: [
        { x: -200, y: -200 }, { x: 4200, y: -200 }, { x: 4200, y: 1200 },
        { x: 2200, y: 1200 }, { x: 2200, y: 3200 }, { x: -200, y: 3200 }
      ],
      totals: ['3400', '3400', '4400', '4400']
    },
    {
      id: 'u-room',
      inner: [
        { x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 4000 },
        { x: 3500, y: 4000 }, { x: 3500, y: 1500 }, { x: 1500, y: 1500 },
        { x: 1500, y: 4000 }, { x: 0, y: 4000 }
      ],
      outer: [
        { x: -200, y: -200 }, { x: 5200, y: -200 }, { x: 5200, y: 4200 },
        { x: 3700, y: 4200 }, { x: 3700, y: 1700 }, { x: 1300, y: 1700 },
        { x: 1300, y: 4200 }, { x: -200, y: 4200 }
      ],
      totals: ['4400', '4400', '5400', '5400']
    },
    {
      id: 'step-room',
      inner: [
        { x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 1000 },
        { x: 4000, y: 1000 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }
      ],
      outer: [
        { x: -200, y: -200 }, { x: 2200, y: -200 }, { x: 2200, y: 800 },
        { x: 4200, y: 800 }, { x: 4200, y: 3200 }, { x: -200, y: 3200 }
      ],
      totals: ['3400', '3400', '4400', '4400']
    }
  ];

  fixtures.forEach((fixture) => {
    const room = createSpacePlan(fixture.id, fixture.inner);
    const plan = createClosedDimensionPlan(createClosedPlanInput(room, fixture.outer));
    const overall = plan.items.filter((item) => item.kind === 'building-overall');

    assert.equal(plan.fallback, false, fixture.id);
    assert.deepEqual(overall.map((item) => item.label).sort(), fixture.totals, fixture.id);
    assert.equal(overall.every((item) => (
      fixture.outer.includes(item.extensionStart) && fixture.outer.includes(item.extensionEnd)
    )), true, fixture.id);
    assert.ok(plan.items.filter((item) => item.kind === 'room-clear').length >= 6, fixture.id);
    plan.items.forEach((item) => {
      const outlineSupport = Math.max(...fixture.outer.map((point) => projection(point, item.normal)));
      assert.ok(projection(item.start, item.normal) >= outlineSupport + 99.999, item.id);
      assert.ok(projection(item.end, item.normal) >= outlineSupport + 99.999, item.id);
    });
  });
});

test('diagonal exterior boundaries retain the legacy dimension planner unchanged', () => {
  const geometry = createGeometryBuilder();
  geometry.addSpace('diagonal', [
    { x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 1800, y: 2200 }
  ]);
  const boundary = createExteriorBoundarySegments({ walls: geometry.walls, spaces: geometry.spaces, tolerance: 1 });
  const legacy = createExteriorDimensionPlan({ walls: boundary, openings: [], baseGap: 100, laneGap: 100, groupTolerance: 1 });
  const closed = createClosedDimensionPlan({
    walls: geometry.walls,
    spaces: geometry.spaces,
    openings: [],
    baseGap: 100,
    laneGap: 100,
    groupTolerance: 1
  });

  assert.equal(closed.fallback, true);
  assert.deepEqual(closed.items, legacy.items);
});
