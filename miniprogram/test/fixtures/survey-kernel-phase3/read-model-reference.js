// Frozen read-model formulas from the completed Phase 2 working tree, 2026-09-04.
// Normalized source SHA-256: 57121cbb6c6088813e243ccf2dcbbd8e5eb46c311089888fa950f29dcd6b049f
// Test-only reference: foundation primitives are shared; read-model formulas are frozen.
const { DEFAULT_THICKNESS_MM, MIN_THICKNESS_MM, CLOSE_TOLERANCE_MM } = require('../../../packages/surveying/utils/survey/core/constants.js');
const { getActiveFloor: findActiveFloor } = require('../../../packages/surveying/utils/survey/core/draft.js');
const getActiveFloor = (draft) => findActiveFloor(draft, { requireFloorList: true });
const { distanceMm, angleDeg, dot, cross, addScaled: addVector } = require('../../../packages/surveying/utils/survey/geometry/vector2.js');
const { intersectLines, projectAlong, pointTouchesSegment: pointTouchesWallSegment } = require('../../../packages/surveying/utils/survey/geometry/segment.js');
const polygonGeometry = require('../../../packages/surveying/utils/survey/geometry/polygon.js');
const calculatePolygonAreaMm2 = polygonGeometry.area;
const { measurementInsets: getWallMeasurementInsets, normalizeMeasurementAdjustment: normalizeMeasurementExtension, measuredLengthMm: getMeasuredWallLength } = require('../../../packages/surveying/utils/survey/domain/wall.js');
const wallFaces = require('./wall-faces-reference.js');

function getNode(floor, nodeId) {
  return floor.nodes.find((node) => node.id === nodeId);
}

function getWall(floor, wallId) {
  return floor.walls.find((wall) => wall.id === wallId);
}

function findClosedSpaceForWall(floor, wallId) {
  if (!floor || !wallId || !Array.isArray(floor.spaces)) return null;
  return floor.spaces.find((space) => (
    space &&
    space.closed &&
    Array.isArray(space.wallIds) &&
    space.wallIds.indexOf(wallId) !== -1
  )) || null;
}

function findClosedSpacesForWall(floor, wallId) {
  if (!floor || !wallId || !Array.isArray(floor.spaces)) return [];
  return floor.spaces.filter((space) => (
    space &&
    space.closed &&
    Array.isArray(space.wallIds) &&
    space.wallIds.indexOf(wallId) !== -1
  ));
}

function calculateBoundaryCentroid(floor, wallIds) {
  const points = buildSpaceBoundaryPoints(floor, wallIds);
  return polygonGeometry.centroid(points);
}

function traceClosedSpaceWallChain(floor, wallIds, reverseFirstWall) {
  if (!floor || !Array.isArray(wallIds) || wallIds.length < 3) return [];
  const firstWall = getWall(floor, wallIds[0]);
  if (!firstWall) return [];

  const initialNodeId = reverseFirstWall ? firstWall.endNodeId : firstWall.startNodeId;
  let currentNodeId = initialNodeId;
  const chain = [];

  for (let index = 0; index < wallIds.length; index += 1) {
    const wall = getWall(floor, wallIds[index]);
    if (!wall) return [];
    let nextNodeId = '';
    if (wall.startNodeId === currentNodeId) {
      nextNodeId = wall.endNodeId;
    } else if (wall.endNodeId === currentNodeId) {
      nextNodeId = wall.startNodeId;
    } else {
      return [];
    }
    const start = getNode(floor, currentNodeId);
    const end = getNode(floor, nextNodeId);
    if (!start || !end) return [];
    chain.push({ wall, start, end, reversed: wall.endNodeId === currentNodeId });
    currentNodeId = nextNodeId;
  }

  return currentNodeId === initialNodeId ? chain : [];
}

function buildClosedSpaceWallChain(floor, wallIds) {
  const forward = traceClosedSpaceWallChain(floor, wallIds, false);
  return forward.length ? forward : traceClosedSpaceWallChain(floor, wallIds, true);
}

function buildSpaceBoundaryPoints(floor, wallIds) {
  const forward = traceClosedSpaceWallChain(floor, wallIds, false);
  const chain = forward.length ? forward : traceClosedSpaceWallChain(floor, wallIds, true);
  if (!chain.length) return [];
  return chain.map((entry) => entry.start);
}

function pointsNearlyEqual(a, b) {
  return distanceMm(a, b) <= 1;
}

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

function buildPlanEdgeSegments(faces, boundaryPoints, edgeFaceIndexes) {
  const points = (boundaryPoints || []).filter((point) => (
    point && Number.isFinite(Number(point.xMm)) && Number.isFinite(Number(point.yMm))
  ));
  if (points.length < 2) return [];
  return points.map((start, index) => {
    const faceIndex = Array.isArray(edgeFaceIndexes)
      ? edgeFaceIndexes[index]
      : index;
    const face = Number.isInteger(faceIndex)
      ? (faces || [])[faceIndex]
      : null;
    return {
      wallId: (face && face.wallId) || '',
      start,
      end: points[(index + 1) % points.length]
    };
  });
}

function calculateBoundaryBounds(points) {
  if (!Array.isArray(points) || !points.length) {
    return { widthMm: 0, heightMm: 0 };
  }
  const xs = points.map((point) => Number(point.xMm));
  const ys = points.map((point) => Number(point.yMm));
  return {
    widthMm: Math.round(Math.max(...xs) - Math.min(...xs)),
    heightMm: Math.round(Math.max(...ys) - Math.min(...ys))
  };
}

function buildSpaceDimensionPlan(floor, spaceOrWallIds) {
  const wallIds = Array.isArray(spaceOrWallIds)
    ? spaceOrWallIds
    : (spaceOrWallIds && spaceOrWallIds.wallIds);
  const wallFaceOverrides = !Array.isArray(spaceOrWallIds) && spaceOrWallIds
    ? spaceOrWallIds.wallFaceOverrides
    : null;
  if (!floor || !Array.isArray(wallIds)) return null;
  const faces = buildSpaceWallFaceSegments(floor, wallIds, wallFaceOverrides);
  if (faces.length < 3) return null;
  const innerBoundary = buildFaceBoundaryPlan(faces, 'innerStart', 'innerEnd');
  const outerBoundary = buildFaceBoundaryPlan(faces, 'oppositeStart', 'oppositeEnd');
  const innerBoundaryPoints = innerBoundary.points;
  const outerBoundaryPoints = outerBoundary.points;
  if (innerBoundaryPoints.length < 3 || outerBoundaryPoints.length < 3) return null;
  const innerBounds = calculateBoundaryBounds(innerBoundaryPoints);
  const outerBounds = calculateBoundaryBounds(outerBoundaryPoints);
  return {
    innerBoundaryPoints,
    outerBoundaryPoints,
    innerSegments: buildPlanEdgeSegments(faces, innerBoundaryPoints, innerBoundary.edgeFaceIndexes),
    inner: Object.assign({}, innerBounds, {
      areaMm2: Math.round(calculatePolygonAreaMm2(innerBoundaryPoints))
    }),
    outer: Object.assign({}, outerBounds, {
      areaMm2: Math.round(calculatePolygonAreaMm2(outerBoundaryPoints))
    }),
    wallThicknessSegments: faces.map((face) => {
      const start = {
        xMm: (face.innerStart.xMm + face.innerEnd.xMm) / 2,
        yMm: (face.innerStart.yMm + face.innerEnd.yMm) / 2
      };
      const end = {
        xMm: (face.oppositeStart.xMm + face.oppositeEnd.xMm) / 2,
        yMm: (face.oppositeStart.yMm + face.oppositeEnd.yMm) / 2
      };
      return {
        wallId: face.wallId,
        kind: 'wall-thickness',
        start,
        end,
        lengthMm: Math.round(distanceMm(start, end))
      };
    })
  };
}

function calculateSpaceAreaMm2(draft, spaceId) {
  const floor = getActiveFloor(draft);
  const closedSpace = floor.spaces.find((space) => (
    space.closed && (!spaceId || space.id === spaceId)
  ));
  if (!closedSpace) return 0;
  const plan = buildSpaceDimensionPlan(floor, closedSpace);
  return plan ? plan.inner.areaMm2 : 0;
}

module.exports = {
  getNode,
  getWall,
  findClosedSpaceForWall,
  findClosedSpacesForWall,
  calculateBoundaryCentroid,
  traceClosedSpaceWallChain,
  buildClosedSpaceWallChain,
  buildSpaceBoundaryPoints,
  pointsNearlyEqual,
  resolveRenderThicknessMm,
  resolveAdjacentWalls,
  hasWallConnectionAtPoint,
  buildBaseWallSegment,
  findPerpendicularClosedBoundaryWall,
  resolveClosedBoundaryInsetMm,
  buildResolvedSegment,
  isUsableJoinPoint,
  isInteriorJoinProjection,
  offsetJoinPoint,
  buildWallRenderGeometry,
  buildWallSnapGeometry,
  pointsToJoinFill,
  buildWallJoinRenderGeometries,
  buildSpaceWallFaceSegments,
  buildFaceBoundaryPlan,
  buildFaceBoundaryPoints,
  buildSpaceInnerBoundaryPoints,
  buildSpaceRenderBoundaryPoints,
  buildPlanEdgeSegments,
  calculateBoundaryBounds,
  buildSpaceDimensionPlan,
  calculateSpaceAreaMm2
};
