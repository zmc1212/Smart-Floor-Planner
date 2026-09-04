const { DEFAULT_THICKNESS_MM, CLOSE_TOLERANCE_MM } = require('../core/constants.js');
const {
  buildClosedSpaceWallChain,
  calculateBoundaryCentroid,
  buildSpaceBoundaryPoints
} = require('../topology/closed-boundary.js');
const { buildBaseWallSegment } = require('./wall-geometry.js');
const { distanceMm, dot, cross, pointsNearlyEqual } = require('../geometry/vector2.js');
const { intersectLines } = require('../geometry/segment.js');
const { area: calculatePolygonAreaMm2 } = require('../geometry/polygon.js');
const { measuredLengthMm: getMeasuredWallLength } = require('../domain/wall.js');

function buildSpaceWallFaceSegments(floor, wallIds, wallFaceOverrides) {
  const chain = buildClosedSpaceWallChain(floor, wallIds);
  const centroid = calculateBoundaryCentroid(floor, wallIds);
  if (!chain.length || !centroid) return [];

  return chain.map((entry) => {
    // Closure may persist a short topology bridge whose entire coordinate
    // length is consumed by a measurement inset. It represents the thickness
    // connection to a shared wall, not an additional clear-room boundary.
    if (getMeasuredWallLength(floor, entry.wall) <= 0) return null;
    const base = buildBaseWallSegment(floor, entry.wall);
    if (!base) return null;
    const midpoint = {
      xMm: (base.start.xMm + base.end.xMm) / 2,
      yMm: (base.start.yMm + base.end.yMm) / 2
    };
    const centroidOffset = dot({
      x: centroid.xMm - midpoint.xMm,
      y: centroid.yMm - midpoint.yMm
    }, base.normal);
    // A physical wall is emitted once between its topology face and offset
    // face.  For a shared wall, the two spaces sit on opposite sides and must
    // therefore select opposite inner faces from the same wall object.
    const faceOverride = wallFaceOverrides && wallFaceOverrides[entry.wall.id];
    const usesOffsetFace = faceOverride === 'offset'
      ? true
      : (faceOverride === 'topology' ? false : centroidOffset > 0);
    let innerStart = usesOffsetFace ? base.outerStart : base.start;
    let innerEnd = usesOffsetFace ? base.outerEnd : base.end;
    let oppositeStart = usesOffsetFace ? base.start : base.outerStart;
    let oppositeEnd = usesOffsetFace ? base.end : base.outerEnd;
    if (entry.reversed) {
      [innerStart, innerEnd] = [innerEnd, innerStart];
      [oppositeStart, oppositeEnd] = [oppositeEnd, oppositeStart];
    }
    return {
      wallId: entry.wall.id,
      wall: entry.wall,
      thicknessMm: base.thicknessMm,
      face: usesOffsetFace ? 'offset' : 'topology',
      innerStart,
      innerEnd,
      oppositeStart,
      oppositeEnd
    };
  }).filter(Boolean);
}

function buildFaceBoundaryPlan(segments, startKey, endKey) {
  if (!Array.isArray(segments) || segments.length < 3) {
    return { points: [], edgeFaceIndexes: [] };
  }
  const vertices = [];
  const pushVertex = (point, edgeFaceIndex) => {
    const previous = vertices[vertices.length - 1];
    if (previous && pointsNearlyEqual(previous.point, point)) {
      previous.edgeFaceIndex = edgeFaceIndex;
      return;
    }
    vertices.push({ point, edgeFaceIndex });
  };

  segments.forEach((segment, index) => {
    const previous = segments[(index - 1 + segments.length) % segments.length];
    const previousStart = previous[startKey];
    const previousEnd = previous[endKey];
    const currentStart = segment[startKey];
    const currentEnd = segment[endKey];
    const intersection = intersectLines(previousStart, previousEnd, currentStart, currentEnd);
    if (!intersection) {
      // Adjacent collinear walls can deliberately use opposite physical faces,
      // for example where a shared wall meets the exterior continuation of a
      // wider neighbouring room. Their clear-room faces are parallel and one
      // wall thickness apart, so they need a short perpendicular step. Keeping
      // only currentStart would connect the prior corner to it diagonally.
      if (!pointsNearlyEqual(previousEnd, currentStart)) {
        pushVertex(previousEnd, null);
      }
      pushVertex(currentStart, index);
      return;
    }

    const cornerLimit = Math.max(
      Number(previous.thicknessMm) || DEFAULT_THICKNESS_MM,
      Number(segment.thicknessMm) || DEFAULT_THICKNESS_MM,
      CLOSE_TOLERANCE_MM
    ) * 4;
    pushVertex(distanceMm(intersection, currentStart) <= cornerLimit
      ? intersection
      : currentStart, index);
  });

  if (
    vertices.length > 1 &&
    pointsNearlyEqual(vertices[0].point, vertices[vertices.length - 1].point)
  ) {
    vertices[0].edgeFaceIndex = vertices[vertices.length - 1].edgeFaceIndex;
    vertices.pop();
  }
  return {
    points: vertices.map((vertex) => vertex.point),
    edgeFaceIndexes: vertices.map((vertex) => vertex.edgeFaceIndex)
  };
}

function buildFaceBoundaryPoints(segments, startKey, endKey) {
  return buildFaceBoundaryPlan(segments, startKey, endKey).points;
}

function buildSpaceInnerBoundaryPoints(floor, spaceOrWallIds) {
  const wallIds = Array.isArray(spaceOrWallIds)
    ? spaceOrWallIds
    : (spaceOrWallIds && spaceOrWallIds.wallIds);
  const wallFaceOverrides = !Array.isArray(spaceOrWallIds) && spaceOrWallIds
    ? spaceOrWallIds.wallFaceOverrides
    : null;
  const segments = buildSpaceWallFaceSegments(floor, wallIds, wallFaceOverrides);
  const points = buildFaceBoundaryPoints(segments, 'innerStart', 'innerEnd');
  return points.length >= 3 && calculatePolygonAreaMm2(points) > 0
    ? points
    : buildSpaceBoundaryPoints(floor, wallIds);
}

function buildSpaceRenderBoundaryPoints(floor, spaceOrWallIds) {
  const wallIds = Array.isArray(spaceOrWallIds)
    ? spaceOrWallIds
    : (spaceOrWallIds && spaceOrWallIds.wallIds);
  const wallFaceOverrides = !Array.isArray(spaceOrWallIds) && spaceOrWallIds
    ? spaceOrWallIds.wallFaceOverrides
    : null;
  const segments = buildSpaceWallFaceSegments(floor, wallIds, wallFaceOverrides);
  const points = buildFaceBoundaryPoints(segments, 'innerStart', 'innerEnd');
  if (points.length < 3) return buildSpaceBoundaryPoints(floor, wallIds);
  if (points.length !== segments.length) return points;

  const renderPoints = points.filter((point, index) => {
    const previousSegment = segments[(index - 1 + segments.length) % segments.length];
    const currentSegment = segments[index];
    const previousSourceId = previousSegment.wall.topologySourceWallId;
    const currentSourceId = currentSegment.wall.topologySourceWallId;
    if (!previousSourceId || previousSourceId !== currentSourceId) return true;
    const previousDirection = {
      x: previousSegment.innerEnd.xMm - previousSegment.innerStart.xMm,
      y: previousSegment.innerEnd.yMm - previousSegment.innerStart.yMm
    };
    const currentDirection = {
      x: currentSegment.innerEnd.xMm - currentSegment.innerStart.xMm,
      y: currentSegment.innerEnd.yMm - currentSegment.innerStart.yMm
    };
    return Math.abs(cross(previousDirection, currentDirection)) > 0.001 ||
      dot(previousDirection, currentDirection) < 0;
  });
  return renderPoints.length >= 3 && calculatePolygonAreaMm2(renderPoints) > 0
    ? renderPoints
    : points;
}

module.exports = {
  buildSpaceBoundaryPoints,
  buildSpaceWallFaceSegments,
  buildFaceBoundaryPlan,
  buildFaceBoundaryPoints,
  buildSpaceInnerBoundaryPoints,
  buildSpaceRenderBoundaryPoints
};
