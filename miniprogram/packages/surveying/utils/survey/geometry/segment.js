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
  return Math.abs(Number(first.xMm) - Number(second.xMm)) <= EPSILON &&
    Math.abs(Number(first.yMm) - Number(second.yMm)) <= EPSILON;
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
  classifySegmentRelation
};
