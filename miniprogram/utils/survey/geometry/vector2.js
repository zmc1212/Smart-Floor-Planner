function distance(a, b) {
  if (!a || !b) return 0;
  return Math.hypot(Number(b.xMm) - Number(a.xMm), Number(b.yMm) - Number(a.yMm));
}

function subtract(a, b) {
  return { x: Number(a.xMm) - Number(b.xMm), y: Number(a.yMm) - Number(b.yMm) };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

function cross(a, b) {
  return a.x * b.y - a.y * b.x;
}

function angle(a, b) {
  return Math.atan2(Number(b.yMm) - Number(a.yMm), Number(b.xMm) - Number(a.xMm));
}

function samePoint(a, b, toleranceMm) {
  return distance(a, b) <= (Number.isFinite(toleranceMm) ? toleranceMm : 0.001);
}

module.exports = {
  distance,
  subtract,
  dot,
  cross,
  angle,
  samePoint
};
