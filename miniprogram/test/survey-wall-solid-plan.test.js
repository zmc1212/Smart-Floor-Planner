const test = require('node:test');
const assert = require('node:assert/strict');
const { createWallSolidPlan, signedArea } = require('../packages/surveying/utils/surveyWallSolidPlan.js');

function rectangle(x, y, width, height) {
  return [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height }
  ];
}

function areaOfPlan(plan) {
  return plan.rings.reduce((total, ring) => total + signedArea(ring), 0);
}

function assertArea(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 0.01, `expected ${actual} to equal ${expected}`);
}

test('wall union removes the shared diagonal seam at an L join', () => {
  const plan = createWallSolidPlan({
    walls: [
      { id: 'horizontal', polygon: rectangle(0, 0, 3000, 200) },
      { id: 'vertical', polygon: rectangle(2800, 0, 200, 3000) }
    ]
  });

  assert.equal(plan.rings.length, 1);
  assertArea(areaOfPlan(plan), 3000 * 200 + 200 * 2800);
  assert.equal(plan.rings[0].some((point, index) => {
    const next = plan.rings[0][(index + 1) % plan.rings[0].length];
    return Math.abs(point.x - next.x) > 0 && Math.abs(point.y - next.y) > 0;
  }), false);
});

test('wall union fills the outside corner when one-sided wall rectangles only touch at the inner node', () => {
  const plan = createWallSolidPlan({
    walls: [
      {
        id: 'horizontal',
        start: { x: 0, y: 0 },
        end: { x: 1000, y: 0 },
        outerStart: { x: 0, y: -200 },
        outerEnd: { x: 1000, y: -200 },
        thickness: 200,
        polygon: rectangle(0, -200, 1000, 200)
      },
      {
        id: 'vertical',
        start: { x: 1000, y: 0 },
        end: { x: 1000, y: 1000 },
        outerStart: { x: 1200, y: 0 },
        outerEnd: { x: 1200, y: 1000 },
        thickness: 200,
        polygon: rectangle(1000, 0, 200, 1000)
      }
    ]
  });

  assert.equal(plan.rings.length, 1);
  assert.equal(plan.sourcePolygonCount, 2);
  assert.equal(plan.joinPolygons.length, 1);
  assertArea(areaOfPlan(plan), 440000);
  assert.equal(plan.rings[0].some((point) => point.x === 1200 && point.y === -200), true);
  assert.equal(plan.rings[0].some((point, index) => {
    const next = plan.rings[0][(index + 1) % plan.rings[0].length];
    return Math.abs(point.x - next.x) > 0 && Math.abs(point.y - next.y) > 0;
  }), false);
});

test('wall union removes the branch cap at a T join', () => {
  const plan = createWallSolidPlan({
    walls: [
      { id: 'main', polygon: rectangle(0, 0, 3000, 200) },
      { id: 'branch', polygon: rectangle(1400, 200, 200, 1200) }
    ]
  });

  assert.equal(plan.rings.length, 1);
  assertArea(areaOfPlan(plan), 3000 * 200 + 200 * 1200);
  assert.equal(plan.rings[0].some((point, index) => {
    const next = plan.rings[0][(index + 1) % plan.rings[0].length];
    return point.y === 200 && next.y === 200 &&
      Math.min(point.x, next.x) <= 1400 && Math.max(point.x, next.x) >= 1600;
  }), false);
});

test('overlapping duplicate wall bodies are emitted once', () => {
  const plan = createWallSolidPlan({
    walls: [
      { id: 'one', polygon: rectangle(0, 0, 1000, 200) },
      { id: 'two', polygon: rectangle(0, 0, 1000, 200) }
    ]
  });

  assert.equal(plan.rings.length, 1);
  assertArea(areaOfPlan(plan), 200000);
});
