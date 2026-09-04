// Frozen test-only formulas from legacy-kernel.js at 28ec18b6 (Phase 1).
// Do not import production helpers here: this is an independent equivalence
// oracle for the Phase 2 follow-up, not a second runtime implementation.
function distanceMm(a, b) {
  if (!a || !b) return 0;
  return Math.round(Math.hypot(Number(b.xMm) - Number(a.xMm), Number(b.yMm) - Number(a.yMm)));
}

function normalizeMeasurementInset(value) {
  const parsed = Math.round(Number(value) || 0);
  return Math.max(0, parsed);
}

function normalizeMeasurementExtension(value) {
  const parsed = Math.round(Number(value) || 0);
  return Math.max(0, parsed);
}

function normalForMeasurementSide(start, end, side) {
  if (!start || !end) return null;
  const dx = end.xMm - start.xMm;
  const dy = end.yMm - start.yMm;
  const rawLength = Math.sqrt(dx * dx + dy * dy);
  if (!rawLength) return null;

  const direction = { x: dx / rawLength, y: dy / rawLength };
  const leftNormal = { x: direction.y, y: -direction.x };
  const rightNormal = { x: -direction.y, y: direction.x };
  return side === 'left' ? leftNormal : rightNormal;
}

function perpendicularDistanceToLineMm(point, start, end) {
  if (!point || !start || !end) return Infinity;
  const dx = end.xMm - start.xMm;
  const dy = end.yMm - start.yMm;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (!length) return distanceMm(point, start);
  return Math.abs((point.xMm - start.xMm) * dy - (point.yMm - start.yMm) * dx) / length;
}

function calculateMeasuredPreviewLength(anchor, previewPoint, startInsetMm, endInsetMm, startExtensionMm) {
  return Math.max(
    0,
    distanceMm(anchor, previewPoint) -
      normalizeMeasurementInset(startInsetMm) -
      normalizeMeasurementInset(endInsetMm) +
      normalizeMeasurementExtension(startExtensionMm)
  );
}

function pointFromLength(anchor, previewPoint, lengthMm, startInsetMm, endInsetMm, startExtensionMm) {
  const dx = previewPoint.xMm - anchor.xMm;
  const dy = previewPoint.yMm - anchor.yMm;
  const length = Math.sqrt(dx * dx + dy * dy);

  const coordinateLengthMm = lengthMm +
    normalizeMeasurementInset(startInsetMm) +
    normalizeMeasurementInset(endInsetMm) -
    normalizeMeasurementExtension(startExtensionMm);

  if (length === 0) {
    return { xMm: anchor.xMm + coordinateLengthMm, yMm: anchor.yMm };
  }

  return {
    xMm: Math.round(anchor.xMm + dx / length * coordinateLengthMm),
    yMm: Math.round(anchor.yMm + dy / length * coordinateLengthMm)
  };
}

module.exports = {
  normalForMeasurementSide,
  perpendicularDistanceToLineMm,
  calculateMeasuredPreviewLength,
  pointFromLength
};
