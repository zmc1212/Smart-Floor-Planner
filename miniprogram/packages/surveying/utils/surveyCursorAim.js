// Upper-left aim offset: one more multiple of the previous peek
// (-12, -20) so the reticle sits clear of the fingertip.
const CURSOR_TOUCH_OFFSET = Object.freeze({ x: -24, y: -40 });
const CURSOR_WALL_HIT_OFFSET = Object.freeze({ x: 20, y: 28 });
const CURSOR_WALL_HIT_RADIUS = 52;

function isClientPoint(value) {
  return !!(value && Number.isFinite(value.x) && Number.isFinite(value.y));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toAimClientPoint(touchPoint, canvasRect) {
  if (!isClientPoint(touchPoint)) return null;
  const aimed = {
    x: touchPoint.x + CURSOR_TOUCH_OFFSET.x,
    y: touchPoint.y + CURSOR_TOUCH_OFFSET.y
  };
  if (
    !canvasRect
    || !Number.isFinite(canvasRect.left)
    || !Number.isFinite(canvasRect.top)
    || !Number.isFinite(canvasRect.width)
    || !Number.isFinite(canvasRect.height)
  ) {
    return aimed;
  }
  return {
    x: clamp(aimed.x, canvasRect.left, canvasRect.left + canvasRect.width),
    y: clamp(aimed.y, canvasRect.top, canvasRect.top + canvasRect.height)
  };
}

function wallGrabDelta(cursorClient, fingerClient) {
  if (!isClientPoint(cursorClient) || !isClientPoint(fingerClient)) {
    return { x: 0, y: 0 };
  }
  return {
    x: cursorClient.x - fingerClient.x,
    y: cursorClient.y - fingerClient.y
  };
}

function toWallGrabAimPoint(fingerClient, grabDelta) {
  if (!isClientPoint(fingerClient)) return null;
  const dx = grabDelta && Number.isFinite(grabDelta.x) ? grabDelta.x : 0;
  const dy = grabDelta && Number.isFinite(grabDelta.y) ? grabDelta.y : 0;
  return {
    x: fingerClient.x + dx,
    y: fingerClient.y + dy
  };
}

function isNearCursorHit(localPoint, cursorPoint) {
  if (!isClientPoint(localPoint) || !isClientPoint(cursorPoint)) return false;
  const dx = localPoint.x - (cursorPoint.x + CURSOR_WALL_HIT_OFFSET.x);
  const dy = localPoint.y - (cursorPoint.y + CURSOR_WALL_HIT_OFFSET.y);
  return Math.sqrt(dx * dx + dy * dy) <= CURSOR_WALL_HIT_RADIUS;
}

module.exports = {
  CURSOR_TOUCH_OFFSET,
  CURSOR_WALL_HIT_OFFSET,
  CURSOR_WALL_HIT_RADIUS,
  toAimClientPoint,
  wallGrabDelta,
  toWallGrabAimPoint,
  isNearCursorHit
};
