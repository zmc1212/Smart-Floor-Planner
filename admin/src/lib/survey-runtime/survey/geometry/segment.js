const vector2 = require('./vector2.js');

const EPSILON = 1e-7;

function orientation(a, b, c) {
  return vector2.cross(vector2.subtract(b, a), vector2.subtract(c, a));
}

function pointOnSegment(point, start, end, toleranceMm) {
  const tolerance = Number.isFinite(toleranceMm) ? toleranceMm : 0.001;
  if (Math.abs(orientation(start, end, point)) > tolerance) return false;
  return Number(point.xMm) >= Math.min(Number(start.xMm), Number(end.xMm)) - tolerance &&
    Number(point.xMm) <= Math.max(Number(start.xMm), Number(end.xMm)) + tolerance &&
    Number(point.yMm) >= Math.min(Number(start.yMm), Number(end.yMm)) - tolerance &&
    Number(point.yMm) <= Math.max(Number(start.yMm), Number(end.yMm)) + tolerance;
}

function properIntersection(a1, a2, b1, b2) {
  const first = orientation(a1, a2, b1);
  const second = orientation(a1, a2, b2);
  const third = orientation(b1, b2, a1);
  const fourth = orientation(b1, b2, a2);
  return first * second < -EPSILON && third * fourth < -EPSILON;
}

function segmentsIntersect(a1, a2, b1, b2) {
  if (properIntersection(a1, a2, b1, b2)) return true;
  return pointOnSegment(a1, b1, b2) || pointOnSegment(a2, b1, b2) ||
    pointOnSegment(b1, a1, a2) || pointOnSegment(b2, a1, a2);
}

module.exports = {
  EPSILON,
  orientation,
  pointOnSegment,
  properIntersection,
  segmentsIntersect
};
