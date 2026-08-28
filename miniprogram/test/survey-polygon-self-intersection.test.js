const test = require('node:test');
const assert = require('node:assert/strict');
const polygon = require('../packages/surveying/utils/survey/geometry/polygon.js');

test('bow-tie quads are self-intersecting', () => {
  assert.equal(polygon.hasSelfIntersection([
    { xMm: 0, yMm: 0 },
    { xMm: 1000, yMm: 1000 },
    { xMm: 1000, yMm: 0 },
    { xMm: 0, yMm: 1000 }
  ]), true);
});

test('simple rectangles and collinear wall-split rings are not self-intersecting', () => {
  assert.equal(polygon.hasSelfIntersection([
    { xMm: 0, yMm: 0 },
    { xMm: 2000, yMm: 0 },
    { xMm: 2000, yMm: 1000 },
    { xMm: 0, yMm: 1000 }
  ]), false);

  assert.equal(polygon.hasSelfIntersection([
    { xMm: 0, yMm: 0 },
    { xMm: 1000, yMm: 0 },
    { xMm: 2000, yMm: 0 },
    { xMm: 2000, yMm: 1000 },
    { xMm: 0, yMm: 1000 }
  ]), false);
});

test('degenerate consecutive points do not false-positive as self-intersection', () => {
  assert.equal(polygon.hasSelfIntersection([
    { xMm: 0, yMm: 0 },
    { xMm: 0, yMm: 0 },
    { xMm: 1000, yMm: 0 },
    { xMm: 1000, yMm: 1000 },
    { xMm: 0, yMm: 1000 }
  ]), false);

  assert.equal(polygon.hasSelfIntersection([
    { xMm: 0, yMm: 0 },
    { xMm: 1000, yMm: 0 },
    { xMm: 1000, yMm: 1000 },
    { xMm: 0, yMm: 1000 },
    { xMm: 0, yMm: 0 }
  ]), false);
});

test('adjacent-room style rings with shared-wall split stubs stay simple', () => {
  assert.equal(polygon.hasSelfIntersection([
    { xMm: 0, yMm: 0 },
    { xMm: 2526, yMm: 0 },
    { xMm: 2526, yMm: 3080 },
    { xMm: 200, yMm: 3080 },
    { xMm: 0, yMm: 3080 }
  ]), false);

  assert.equal(polygon.hasSelfIntersection([
    { xMm: 200, yMm: 3080 },
    { xMm: 200, yMm: 7211 },
    { xMm: 2526, yMm: 7211 },
    { xMm: 2526, yMm: 3080 }
  ]), false);
});
