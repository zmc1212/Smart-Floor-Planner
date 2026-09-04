const vector2 = require('../geometry/vector2.js');

function coordinateLength(floor, wall, index) {
  const lookup = index && index.nodesById;
  const start = lookup ? lookup.get(wall.startNodeId) : floor.nodes.find((node) => node.id === wall.startNodeId);
  const end = lookup ? lookup.get(wall.endNodeId) : floor.nodes.find((node) => node.id === wall.endNodeId);
  return vector2.distance(start, end);
}

function coordinateLengthMm(floor, wall, index) {
  if (!floor || !wall) return 0;
  return Math.round(coordinateLength(floor, wall, index));
}

function normalizeMeasurementAdjustment(value) {
  const parsed = Math.round(Number(value) || 0);
  return Math.max(0, parsed);
}

function measurementInsets(wall) {
  return {
    start: normalizeMeasurementAdjustment(wall && wall.measurementStartInsetMm),
    end: normalizeMeasurementAdjustment(wall && wall.measurementEndInsetMm)
  };
}

function normalizeReadingAdjustment(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function measuredReadingMm(topologyLengthMm, wall) {
  const topology = Number(topologyLengthMm);
  if (!Number.isFinite(topology)) return 0;
  return Math.max(
    0,
    topology -
      normalizeReadingAdjustment(wall && wall.measurementStartInsetMm) +
      normalizeReadingAdjustment(wall && wall.measurementStartExtensionMm) -
      normalizeReadingAdjustment(wall && wall.measurementEndInsetMm)
  );
}

function measuredLengthMm(floor, wall, index) {
  return measuredReadingMm(coordinateLengthMm(floor, wall, index), wall);
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

// Preview adjustments are normalized to integer millimetres before arithmetic.
// Stored-wall measuredReadingMm deliberately preserves fractional adjustments.
function measuredPreviewLengthMm(anchor, previewPoint, startInsetMm, endInsetMm, startExtensionMm) {
  return Math.max(
    0,
    vector2.distanceMm(anchor, previewPoint) -
      normalizeMeasurementAdjustment(startInsetMm) -
      normalizeMeasurementAdjustment(endInsetMm) +
      normalizeMeasurementAdjustment(startExtensionMm)
  );
}

function pointFromMeasuredLength(anchor, previewPoint, lengthMm, startInsetMm, endInsetMm, startExtensionMm) {
  const dx = previewPoint.xMm - anchor.xMm;
  const dy = previewPoint.yMm - anchor.yMm;
  const length = Math.sqrt(dx * dx + dy * dy);
  const coordinateLengthMm = lengthMm +
    normalizeMeasurementAdjustment(startInsetMm) +
    normalizeMeasurementAdjustment(endInsetMm) -
    normalizeMeasurementAdjustment(startExtensionMm);

  if (length === 0) {
    return { xMm: anchor.xMm + coordinateLengthMm, yMm: anchor.yMm };
  }
  return {
    xMm: Math.round(anchor.xMm + dx / length * coordinateLengthMm),
    yMm: Math.round(anchor.yMm + dy / length * coordinateLengthMm)
  };
}

// A topology operation can change a wall's derived reading without replacing
// its instrument reading. Keep the raw reading as the audit anchor and update
// only the derived adjustment until the wall is explicitly remeasured.
function syncAdjustmentAfterMetricChange(wall) {
  if (!wall) return;
  const hasRaw = Object.prototype.hasOwnProperty.call(wall, 'rawMeasuredLengthMm');
  const hasAdjustment = Object.prototype.hasOwnProperty.call(wall, 'closureAdjustmentMm');
  if (!hasRaw || !hasAdjustment) return;
  const rawMeasuredLengthMm = Number(wall.rawMeasuredLengthMm);
  const measuredLength = Number(wall.lengthMm);
  if (!Number.isFinite(rawMeasuredLengthMm) || !Number.isFinite(measuredLength)) return;
  wall.rawMeasuredLengthMm = Math.round(rawMeasuredLengthMm);
  wall.closureAdjustmentMm = Math.round(measuredLength - rawMeasuredLengthMm);
}

function recordRawMeasurement(wall, rawMeasuredLengthMm, adjustmentSource) {
  if (!wall || !Number.isFinite(Number(rawMeasuredLengthMm))) return;
  wall.rawMeasuredLengthMm = Math.round(Number(rawMeasuredLengthMm));
  wall.closureAdjustmentMm = Math.round(Number(wall.lengthMm) - wall.rawMeasuredLengthMm);
  if (wall.closureAdjustmentMm && adjustmentSource) {
    wall.adjustmentSource = adjustmentSource;
  } else if (!wall.closureAdjustmentMm) {
    delete wall.adjustmentSource;
  }
}

function undirectedKey(wall) {
  return [wall.startNodeId, wall.endNodeId].sort().join('|');
}

module.exports = {
  coordinateLength,
  coordinateLengthMm,
  normalizeMeasurementAdjustment,
  measurementInsets,
  measuredReadingMm,
  measuredLengthMm,
  normalForMeasurementSide,
  measuredPreviewLengthMm,
  pointFromMeasuredLength,
  syncAdjustmentAfterMetricChange,
  recordRawMeasurement,
  undirectedKey
};
