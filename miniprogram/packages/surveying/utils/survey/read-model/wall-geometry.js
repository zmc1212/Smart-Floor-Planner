const { DEFAULT_THICKNESS_MM, MIN_THICKNESS_MM, CLOSE_TOLERANCE_MM } = require('../core/constants.js');
const { getNode } = require('../core/graph-query.js');
const {
  findClosedSpaceForWall,
  calculateBoundaryCentroid,
  buildClosedSpaceWallChain
} = require('../topology/closed-boundary.js');
const {
  distanceMm, angleDeg, dot, addScaled: addVector, pointsNearlyEqual
} = require('../geometry/vector2.js');
const {
  intersectLines, projectAlong, pointTouchesSegment: pointTouchesWallSegment
} = require('../geometry/segment.js');
const {
  measurementInsets: getWallMeasurementInsets,
  normalizeMeasurementAdjustment: normalizeMeasurementExtension
} = require('../domain/wall.js');
const wallFaces = require('./wall-faces.js');

function resolveRenderThicknessMm(wall, options) {
  const opts = options || {};
  const thicknessMap = opts.renderThicknessMmMap || {};
  const mappedThickness = wall && wall.id ? thicknessMap[wall.id] : null;
  const explicitThickness = opts.renderThicknessMm;
  const resolved = mappedThickness || explicitThickness || (wall && wall.thicknessMm) || DEFAULT_THICKNESS_MM;
  return Math.max(MIN_THICKNESS_MM, resolved);
}

function resolveAdjacentWalls(floor, wall, options) {
  const opts = options || {};
  const hasPrevious = Object.prototype.hasOwnProperty.call(opts, 'previousWall');
  const hasNext = Object.prototype.hasOwnProperty.call(opts, 'nextWall');
  const index = floor.walls.findIndex((item) => item.id === wall.id);
  const closedSpace = findClosedSpaceForWall(floor, wall.id);
  let startWall = null;
  let endWall = null;

  if (!hasPrevious && !hasNext && closedSpace) {
    const chain = buildClosedSpaceWallChain(floor, closedSpace.wallIds);
    const closedIndex = chain.findIndex((entry) => entry.wall.id === wall.id);
    if (closedIndex >= 0) {
      const entry = chain[closedIndex];
      const previousWall = chain[(closedIndex - 1 + chain.length) % chain.length].wall;
      const nextWall = chain[(closedIndex + 1) % chain.length].wall;
      return entry.reversed
        ? { startWall: nextWall, endWall: previousWall }
        : { startWall: previousWall, endWall: nextWall };
    }
  }

  if (hasPrevious) {
    startWall = opts.previousWall;
  } else if (index > 0) {
    startWall = floor.walls[index - 1];
  }

  if (hasNext) {
    endWall = opts.nextWall;
  } else if (index >= 0 && index < floor.walls.length - 1) {
    endWall = floor.walls[index + 1];
  }

  return { startWall, endWall };
}

function hasWallConnectionAtPoint(floor, wall, point) {
  return (floor.walls || []).some((candidate) => {
    if (!candidate || candidate.id === wall.id) return false;
    const start = getNode(floor, candidate.startNodeId);
    const end = getNode(floor, candidate.endNodeId);
    return pointTouchesWallSegment(point, start, end);
  });
}

function buildBaseWallSegment(floor, wall, options) {
  const opts = options || {};
  const start = opts.startPoint || getNode(floor, wall.startNodeId);
  const end = opts.endPoint || getNode(floor, wall.endNodeId);
  if (!start || !end) return null;

  const closedSpace = findClosedSpaceForWall(floor, wall.id);
  const centroid = closedSpace ? calculateBoundaryCentroid(floor, closedSpace.wallIds) : null;
  const thicknessMm = resolveRenderThicknessMm(wall, opts);
  const faces = wallFaces.projectWallFaces(wall, start, end, thicknessMm, centroid);
  if (!faces) return null;

  return {
    wall,
    start,
    end,
    direction: faces.direction,
    normal: faces.normal,
    thicknessMm,
    lengthMm: distanceMm(start, end),
    outerStart: faces.outerStart,
    outerEnd: faces.outerEnd
  };
}

function findPerpendicularClosedBoundaryWall(floor, node, towardPoint, excludedWallId, preferredWallId) {
  if (!floor || !node || !towardPoint) return null;
  const dx = towardPoint.xMm - node.xMm;
  const dy = towardPoint.yMm - node.yMm;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (!length) return null;
  const outgoingDirection = { x: dx / length, y: dy / length };
  const candidates = [];

  (floor.walls || []).forEach((candidate) => {
    if (!candidate || candidate.id === excludedWallId || !findClosedSpaceForWall(floor, candidate.id)) return;
    const candidateStart = getNode(floor, candidate.startNodeId);
    const candidateEnd = getNode(floor, candidate.endNodeId);
    const isPreferred = candidate.id === preferredWallId;
    const touchesNode = candidate.startNodeId === node.id || candidate.endNodeId === node.id ||
      (isPreferred && pointTouchesWallSegment(node, candidateStart, candidateEnd));
    if (!touchesNode) return;
    const segment = buildBaseWallSegment(floor, candidate);
    if (!segment) return;
    const parallelScore = Math.abs(dot(outgoingDirection, segment.direction));
    const outwardScore = dot(outgoingDirection, segment.normal);
    if (parallelScore > 0.25 || outwardScore < 0.25) return;
    candidates.push({ wall: candidate, parallelScore, outwardScore, isPreferred });
  });

  candidates.sort((first, second) => (
    first.parallelScore - second.parallelScore ||
    Number(second.isPreferred) - Number(first.isPreferred) ||
    second.outwardScore - first.outwardScore
  ));
  return candidates.length ? candidates[0].wall : null;
}

function resolveClosedBoundaryInsetMm(floor, node, towardPoint, options) {
  const opts = options || {};
  const boundaryWall = findPerpendicularClosedBoundaryWall(
    floor,
    node,
    towardPoint,
    opts.excludedWallId || '',
    opts.preferredWallId || ''
  );
  if (!boundaryWall) return 0;
  return Math.round(resolveRenderThicknessMm(boundaryWall, opts));
}

function buildResolvedSegment(floor, wall, options) {
  const opts = options || {};
  const base = buildBaseWallSegment(floor, wall, opts);
  if (!base) return null;
  const storedInsets = getWallMeasurementInsets(wall);
  const storedStartExtension = normalizeMeasurementExtension(wall.measurementStartExtensionMm);
  const renderStartInset = storedInsets.start > 0
    ? resolveClosedBoundaryInsetMm(floor, base.start, base.end, {
      excludedWallId: wall.id,
      renderThicknessMmMap: opts.renderThicknessMmMap
    }) || storedInsets.start
    : 0;
  const renderEndInset = storedInsets.end > 0
    ? resolveClosedBoundaryInsetMm(floor, base.end, base.start, {
      excludedWallId: wall.id,
      renderThicknessMmMap: opts.renderThicknessMmMap
    }) || storedInsets.end
    : 0;
  const maximumInset = Math.max(0, base.lengthMm - 1);
  const startInset = Math.min(renderStartInset, maximumInset);
  const startExtension = Math.min(storedStartExtension, maximumInset);
  const endInset = Math.min(renderEndInset, Math.max(0, maximumInset - startInset));
  const start = addVector(base.start, base.direction, startInset - startExtension);
  const end = addVector(base.end, base.direction, -endInset);

  return Object.assign({}, base, {
    topologyStart: base.start,
    topologyEnd: base.end,
    start,
    end,
    lengthMm: Number.isFinite(Number(wall.lengthMm))
      ? Math.max(0, Math.round(Number(wall.lengthMm)))
      : Math.max(0, base.lengthMm - storedInsets.start + storedStartExtension - storedInsets.end),
    measurementStartInsetMm: storedInsets.start,
    measurementStartExtensionMm: storedStartExtension,
    measurementEndInsetMm: storedInsets.end,
    outerStart: addVector(start, base.normal, base.thicknessMm),
    outerEnd: addVector(end, base.normal, base.thicknessMm)
  });
}

function isUsableJoinPoint(segment, point) {
  if (!point) return false;
  const along = projectAlong(segment, point);
  const limit = Math.max(segment.thicknessMm * 4, CLOSE_TOLERANCE_MM);
  return along >= -limit && along <= segment.lengthMm + limit;
}

function isInteriorJoinProjection(segment, point) {
  if (!segment || !point) return false;
  const along = projectAlong(segment, point);
  const inset = Math.max(Number(segment.thicknessMm) || 0, CLOSE_TOLERANCE_MM) * 0.5;
  return along > inset && along < segment.lengthMm - inset;
}

function offsetJoinPoint(current, adjacent) {
  if (!current || !adjacent) return null;
  const point = intersectLines(current.outerStart, current.outerEnd, adjacent.outerStart, adjacent.outerEnd);
  // Validate against BOTH segments. Previously only `current` was checked,
  // so at acute angles (< 30°) the intersection could land far outside the
  // adjacent wall's extents, producing a miter point that detaches the outer
  // corner from the wall body.
  if (!isUsableJoinPoint(current, point) || !isUsableJoinPoint(adjacent, point)) return null;
  // A convex outer miter sits at or beyond the shared endpoint. A reflex L
  // corner (270° room interior) intersects one wall-thickness inside both
  // outers; applying that miter stairs the remaining wall into the room.
  if (isInteriorJoinProjection(current, point) && isInteriorJoinProjection(adjacent, point)) {
    return null;
  }
  return point;
}

function buildWallRenderGeometry(floor, wall, options) {
  const opts = options || {};
  const current = buildResolvedSegment(floor, wall, options);
  if (!current) return null;

  const adjacent = resolveAdjacentWalls(floor, wall, options);
  const adjacentOptions = {
    renderThicknessMmMap: opts.renderThicknessMmMap
  };
  const startAdjacent = adjacent.startWall ? buildResolvedSegment(floor, adjacent.startWall, adjacentOptions) : null;
  const endAdjacent = adjacent.endWall ? buildResolvedSegment(floor, adjacent.endWall, adjacentOptions) : null;
  const startJoined = !!(startAdjacent && (
    pointsNearlyEqual(startAdjacent.start, current.start) || pointsNearlyEqual(startAdjacent.end, current.start)
  ));
  const endJoined = !!(endAdjacent && (
    pointsNearlyEqual(endAdjacent.start, current.end) || pointsNearlyEqual(endAdjacent.end, current.end)
  ));
  const startMiter = startJoined ? offsetJoinPoint(current, startAdjacent) : null;
  const endMiter = endJoined ? offsetJoinPoint(current, endAdjacent) : null;
  const outerStart = startMiter || current.outerStart;
  const outerEnd = endMiter || current.outerEnd;

  return {
    start: current.start,
    end: current.end,
    lengthMm: current.lengthMm,
    angleDeg: angleDeg(current.start, current.end),
    startJoined,
    endJoined,
    // Insets shorten only the measured/red segment. Physical wall connectivity
    // is a topology property and must still be evaluated at the graph nodes.
    startOpen: !hasWallConnectionAtPoint(floor, wall, current.topologyStart),
    endOpen: !hasWallConnectionAtPoint(floor, wall, current.topologyEnd),
    outerStart,
    outerEnd,
    outerStartAlongMm: projectAlong(current, outerStart),
    outerEndAlongMm: projectAlong(current, outerEnd),
    thicknessMm: current.thicknessMm
  };
}

function buildWallSnapGeometry(floor, wall) {
  const segment = buildResolvedSegment(floor, wall);
  if (!segment) return null;
  return {
    start: segment.start,
    end: segment.end,
    outerStart: segment.outerStart,
    outerEnd: segment.outerEnd
  };
}

function pointsToJoinFill(previous, next) {
  if (!previous || !next || !pointsNearlyEqual(previous.end, next.start)) {
    return null;
  }
  if (Math.abs(dot(previous.normal, next.normal)) > 0.98) {
    return null;
  }

  const joint = previous.end;
  const miter = intersectLines(previous.outerStart, previous.outerEnd, next.outerStart, next.outerEnd);
  const hasSharedMiter = isUsableJoinPoint(previous, miter) && isUsableJoinPoint(next, miter);

  // Each wall body already reaches the shared miter point. Adding the former
  // four-point patch here created a second, offset corner on diagonal joins.
  if (hasSharedMiter) return null;

  return {
    id: `${previous.wall.id}-${next.wall.id}`,
    wallIds: [previous.wall.id, next.wall.id],
    joint,
    // Only cover the small open gap when an extreme join cannot be mitered.
    points: [joint, previous.outerEnd, next.outerStart]
  };
}

function buildWallJoinRenderGeometries(floor, options) {
  if (!floor || !floor.walls || floor.walls.length < 2) return [];

  const opts = options || {};
  const segmentOptions = {
    renderThicknessMmMap: opts.renderThicknessMmMap
  };
  const joins = [];

  for (let index = 0; index < floor.walls.length - 1; index += 1) {
    const previous = buildResolvedSegment(floor, floor.walls[index], segmentOptions);
    const next = buildResolvedSegment(floor, floor.walls[index + 1], segmentOptions);
    const join = pointsToJoinFill(previous, next);
    if (join) joins.push(join);
  }

  const singleWholePathClosed = floor.spaces &&
    floor.spaces.filter((space) => space.closed && Array.isArray(space.wallIds)).length === 1 &&
    floor.spaces.some((space) => (
      space.closed &&
      Array.isArray(space.wallIds) &&
      space.wallIds.length === floor.walls.length &&
      floor.walls.every((wall, index) => wall.id === space.wallIds[index])
    ));

  if (singleWholePathClosed && floor.walls.length > 2) {
    const previous = buildResolvedSegment(floor, floor.walls[floor.walls.length - 1], segmentOptions);
    const next = buildResolvedSegment(floor, floor.walls[0], segmentOptions);
    const join = pointsToJoinFill(previous, next);
    if (join) joins.push(join);
  }

  return joins;
}

module.exports = {
  buildWallSnapGeometry,
  buildWallRenderGeometry,
  buildWallJoinRenderGeometries,
  buildBaseWallSegment,
  buildResolvedSegment,
  resolveClosedBoundaryInsetMm
};
