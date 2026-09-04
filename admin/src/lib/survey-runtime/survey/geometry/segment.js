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

function samePoint(first, second) {
  return vector2.samePointByCoordinates(first, second, EPSILON);
}

function pointOnSegmentInterior(point, start, end) {
  return pointOnSegment(point, start, end, EPSILON) &&
    !samePoint(point, start) &&
    !samePoint(point, end);
}

function collinearOverlapLength(a1, a2, b1, b2) {
  const useX = Math.abs(Number(a2.xMm) - Number(a1.xMm)) >=
    Math.abs(Number(a2.yMm) - Number(a1.yMm));
  const coordinate = useX
    ? (point) => Number(point.xMm)
    : (point) => Number(point.yMm);
  const aMin = Math.min(coordinate(a1), coordinate(a2));
  const aMax = Math.max(coordinate(a1), coordinate(a2));
  const bMin = Math.min(coordinate(b1), coordinate(b2));
  const bMax = Math.max(coordinate(b1), coordinate(b2));
  return Math.min(aMax, bMax) - Math.max(aMin, bMin);
}

function intersectLines(a1, a2, b1, b2) {
  const origin = { x: Number(a1.xMm), y: Number(a1.yMm) };
  const direction = {
    x: Number(a2.xMm) - Number(a1.xMm),
    y: Number(a2.yMm) - Number(a1.yMm)
  };
  const otherOrigin = { x: Number(b1.xMm), y: Number(b1.yMm) };
  const otherDirection = {
    x: Number(b2.xMm) - Number(b1.xMm),
    y: Number(b2.yMm) - Number(b1.yMm)
  };
  const denominator = vector2.cross(direction, otherDirection);
  if (Math.abs(denominator) < 0.000001) return null;
  const t = vector2.cross({
    x: otherOrigin.x - origin.x,
    y: otherOrigin.y - origin.y
  }, otherDirection) / denominator;
  return {
    xMm: origin.x + t * direction.x,
    yMm: origin.y + t * direction.y
  };
}

function projectAlong(segment, point) {
  return vector2.dot({
    x: Number(point.xMm) - Number(segment.start.xMm),
    y: Number(point.yMm) - Number(segment.start.yMm)
  }, segment.direction);
}

function perpendicularDistanceToLineMm(point, start, end) {
  if (!point || !start || !end) return Infinity;
  const dx = end.xMm - start.xMm;
  const dy = end.yMm - start.yMm;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (!length) return vector2.distanceMm(point, start);
  return Math.abs((point.xMm - start.xMm) * dy - (point.yMm - start.yMm) * dx) / length;
}

function overlapLengthMm(start, end, otherStart, otherEnd, toleranceMm) {
  const dx = Number(end.xMm) - Number(start.xMm);
  const dy = Number(end.yMm) - Number(start.yMm);
  const length = Math.sqrt(dx * dx + dy * dy);
  if (!length) return 0;
  const tolerance = Number.isFinite(toleranceMm) ? toleranceMm : 0;
  const direction = { x: dx / length, y: dy / length };
  if (
    vector2.pointLineDistanceMm(otherStart, start, direction) > tolerance ||
    vector2.pointLineDistanceMm(otherEnd, start, direction) > tolerance
  ) {
    return 0;
  }
  const otherStartAlong = vector2.dot({
    x: Number(otherStart.xMm) - Number(start.xMm),
    y: Number(otherStart.yMm) - Number(start.yMm)
  }, direction);
  const otherEndAlong = vector2.dot({
    x: Number(otherEnd.xMm) - Number(start.xMm),
    y: Number(otherEnd.yMm) - Number(start.yMm)
  }, direction);
  const overlapStart = Math.max(0, Math.min(otherStartAlong, otherEndAlong));
  const overlapEnd = Math.min(length, Math.max(otherStartAlong, otherEndAlong));
  return Math.max(0, overlapEnd - overlapStart);
}

function hasInteriorIntersection(start, end, otherStart, otherEnd, options) {
  const tolerance = Number(options && options.overlapToleranceMm) || 0;
  const direction = {
    x: Number(end.xMm) - Number(start.xMm),
    y: Number(end.yMm) - Number(start.yMm)
  };
  const otherDirection = {
    x: Number(otherEnd.xMm) - Number(otherStart.xMm),
    y: Number(otherEnd.yMm) - Number(otherStart.yMm)
  };
  const denominator = vector2.cross(direction, otherDirection);
  if (Math.abs(denominator) < 0.000001) {
    return overlapLengthMm(start, end, otherStart, otherEnd, tolerance) > tolerance;
  }
  const otherLength = Math.sqrt(
    otherDirection.x * otherDirection.x + otherDirection.y * otherDirection.y
  );
  if (otherLength > 0) {
    const normalized = {
      x: otherDirection.x / otherLength,
      y: otherDirection.y / otherLength
    };
    const startDistance = vector2.pointLineDistanceMm(start, otherStart, normalized);
    const endDistance = vector2.pointLineDistanceMm(end, otherStart, normalized);
    if (startDistance <= tolerance || endDistance <= tolerance) return false;
  }
  const offset = {
    x: Number(otherStart.xMm) - Number(start.xMm),
    y: Number(otherStart.yMm) - Number(start.yMm)
  };
  const t = vector2.cross(offset, otherDirection) / denominator;
  const u = vector2.cross(offset, direction) / denominator;
  const epsilon = 0.0001;
  return t > epsilon && t < 1 - epsilon && u >= -epsilon && u <= 1 + epsilon;
}

function projectPointToSegment(point, start, end) {
  if (!point || !start || !end) return null;
  const dx = Number(end.xMm) - Number(start.xMm);
  const dy = Number(end.yMm) - Number(start.yMm);
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return null;
  const rawT = (
    (Number(point.xMm) - Number(start.xMm)) * dx +
    (Number(point.yMm) - Number(start.yMm)) * dy
  ) / lengthSquared;
  const t = Math.max(0, Math.min(1, rawT));
  const projected = {
    xMm: Math.round(Number(start.xMm) + dx * t),
    yMm: Math.round(Number(start.yMm) + dy * t)
  };
  return {
    point: projected,
    t,
    distanceMm: vector2.distanceMm(point, projected)
  };
}

function pointTouchesSegment(point, start, end) {
  if (!point || !start || !end) return false;
  const dx = Number(end.xMm) - Number(start.xMm);
  const dy = Number(end.yMm) - Number(start.yMm);
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return vector2.distanceMm(point, start) <= 1;
  const t = (
    (Number(point.xMm) - Number(start.xMm)) * dx +
    (Number(point.yMm) - Number(start.yMm)) * dy
  ) / lengthSquared;
  if (t < -0.0001 || t > 1.0001) return false;
  const projected = {
    xMm: Number(start.xMm) + dx * t,
    yMm: Number(start.yMm) + dy * t
  };
  return vector2.distanceMm(point, projected) <= 1;
}

/**
 * Classifies the geometric relationship between two wall centreline segments.
 * Coordinates are the graph's integer millimetres. This deliberately uses only
 * the geometry epsilon; UI snap/closure tolerances must never legalise topology.
 */
function classifySegmentRelation(a1, a2, b1, b2) {
  if (properIntersection(a1, a2, b1, b2)) {
    return { type: 'proper-intersection' };
  }

  const orientations = [
    orientation(a1, a2, b1),
    orientation(a1, a2, b2),
    orientation(b1, b2, a1),
    orientation(b1, b2, a2)
  ];
  const collinear = orientations.every((value) => Math.abs(value) <= EPSILON);
  if (collinear) {
    const overlapLength = collinearOverlapLength(a1, a2, b1, b2);
    if (overlapLength > EPSILON) {
      return { type: 'collinear-overlap', overlapLengthMm: overlapLength };
    }
    const touchesAtEndpoint = [a1, a2].some((aPoint) =>
      [b1, b2].some((bPoint) => samePoint(aPoint, bPoint))
    );
    return { type: touchesAtEndpoint ? 'endpoint-touch' : 'disjoint' };
  }

  const endpointOnInterior =
    pointOnSegmentInterior(a1, b1, b2) ||
    pointOnSegmentInterior(a2, b1, b2) ||
    pointOnSegmentInterior(b1, a1, a2) ||
    pointOnSegmentInterior(b2, a1, a2);
  if (endpointOnInterior) {
    return { type: 'endpoint-on-interior' };
  }

  const touchesAtEndpoint = [a1, a2].some((aPoint) =>
    [b1, b2].some((bPoint) => samePoint(aPoint, bPoint))
  );
  return { type: touchesAtEndpoint ? 'endpoint-touch' : 'disjoint' };
}

function segmentsIntersect(a1, a2, b1, b2) {
  if (properIntersection(a1, a2, b1, b2)) return true;
  return pointOnSegment(a1, b1, b2) || pointOnSegment(a2, b1, b2) ||
    pointOnSegment(b1, a1, a2) || pointOnSegment(b2, a1, a2);
}

module.exports = {
  EPSILON,
  orientation,
  samePoint,
  pointOnSegment,
  pointOnSegmentInterior,
  properIntersection,
  segmentsIntersect,
  classifySegmentRelation,
  intersectLines,
  projectAlong,
  perpendicularDistanceToLineMm,
  overlapLengthMm,
  hasInteriorIntersection,
  projectPointToSegment,
  pointTouchesSegment
};
