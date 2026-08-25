const test = require('node:test');
const assert = require('node:assert/strict');
const surveyCursorAim = require('../packages/surveying/utils/surveyCursorAim.js');

const {
  CURSOR_TOUCH_OFFSET,
  CURSOR_WALL_HIT_OFFSET,
  CURSOR_WALL_HIT_RADIUS,
  toAimClientPoint,
  wallGrabDelta,
  toWallGrabAimPoint,
  isNearCursorHit
} = surveyCursorAim;

const CANVAS_RECT = Object.freeze({
  left: 0,
  top: 88,
  width: 390,
  height: 640
});

test('dock aim offset sits upper-left of the finger and keeps the published constants', () => {
  assert.deepEqual(CURSOR_TOUCH_OFFSET, { x: -48, y: -80 });
  const touch = { x: 200, y: 400 };
  assert.deepEqual(toAimClientPoint(touch, CANVAS_RECT), {
    x: 152,
    y: 320
  });
});

test('dock aim point clamps inside the canvas instead of leaving the viewport', () => {
  assert.deepEqual(
    toAimClientPoint({ x: 10, y: 90 }, CANVAS_RECT),
    { x: 0, y: 88 }
  );
  assert.deepEqual(
    toAimClientPoint({ x: 400, y: 800 }, CANVAS_RECT),
    { x: 352, y: 720 }
  );
});

test('dock aim mapping returns null without a usable touch point', () => {
  assert.equal(toAimClientPoint(null, CANVAS_RECT), null);
  assert.equal(toAimClientPoint({}, CANVAS_RECT), null);
});

test('wall grab first frame keeps the cursor client point so preview length is not invented', () => {
  const cursor = { x: 180, y: 240 };
  const fingerStart = { x: 196, y: 268 };
  const grabDelta = wallGrabDelta(cursor, fingerStart);
  const firstFrameAim = toWallGrabAimPoint(fingerStart, grabDelta);
  assert.deepEqual(firstFrameAim, cursor);

  const dockAim = toAimClientPoint(fingerStart, null);
  assert.notDeepEqual(firstFrameAim, dockAim);
  assert.equal(firstFrameAim.x - fingerStart.x, cursor.x - fingerStart.x);
  assert.equal(firstFrameAim.y - fingerStart.y, cursor.y - fingerStart.y);
});

test('wall grab aim follows finger delta without applying the dock offset', () => {
  const cursor = { x: 180, y: 240 };
  const fingerStart = { x: 200, y: 270 };
  const grabDelta = wallGrabDelta(cursor, fingerStart);
  const moved = { x: 260, y: 310 };
  assert.deepEqual(toWallGrabAimPoint(moved, grabDelta), {
    x: 240,
    y: 280
  });
});

test('wall cursor hit is biased south-east of the reticle', () => {
  assert.deepEqual(CURSOR_WALL_HIT_OFFSET, { x: 20, y: 28 });
  assert.equal(CURSOR_WALL_HIT_RADIUS, 52);
  const cursor = { x: 100, y: 100 };
  assert.equal(isNearCursorHit({ x: 120, y: 128 }, cursor), true);
  assert.equal(isNearCursorHit({ x: 100, y: 100 }, cursor), true);
  assert.equal(isNearCursorHit({ x: 160, y: 148 }, cursor), true);
  assert.equal(isNearCursorHit({ x: 69, y: 69 }, cursor), false);
});
