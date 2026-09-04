function distance(a, b) {
  if (!a || !b) return 0;
  return Math.hypot(Number(b.xMm) - Number(a.xMm), Number(b.yMm) - Number(a.yMm));
}

function distanceMm(a, b) {
  return Math.round(distance(a, b));
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

// Segment topology historically used an axis-wise epsilon rather than a
// Euclidean radius. Keep that policy explicit so the general vector helper
// retains its original public semantics.
function samePointByCoordinates(a, b, toleranceMm) {
  const tolerance = Number.isFinite(toleranceMm) ? toleranceMm : 0.001;
  return Math.abs(Number(a.xMm) - Number(b.xMm)) <= tolerance &&
    Math.abs(Number(a.yMm) - Number(b.yMm)) <= tolerance;
}

function normalizeSignedAngleDeg(angleDeg) {
  let normalized = angleDeg;
  while (normalized <= -180) normalized += 360;
  while (normalized > 180) normalized -= 360;
  return normalized;
}

function normalizeAngleDeg(angleDeg) {
  return Math.round(normalizeSignedAngleDeg(angleDeg) * 10) / 10;
}

function angleDeg(a, b) {
  if (!a || !b) return 0;
  return normalizeAngleDeg(angle(a, b) * 180 / Math.PI);
}

function pointLineDistanceMm(point, start, direction) {
  return Math.abs(cross({
    x: Number(point.xMm) - Number(start.xMm),
    y: Number(point.yMm) - Number(start.yMm)
  }, direction));
}

function addScaled(point, vector, amount) {
  return {
    xMm: Number(point.xMm) + vector.x * amount,
    yMm: Number(point.yMm) + vector.y * amount
  };
}

// Render joins historically compare rounded millimetres, not raw Euclidean distance.
function pointsNearlyEqual(a, b) {
  return distanceMm(a, b) <= 1;
}

module.exports = {
  pointsNearlyEqual,
  distance,
  distanceMm,
  subtract,
  dot,
  cross,
  angle,
  angleDeg,
  samePoint,
  samePointByCoordinates,
  normalizeSignedAngleDeg,
  normalizeAngleDeg,
  pointLineDistanceMm,
  addScaled
};
