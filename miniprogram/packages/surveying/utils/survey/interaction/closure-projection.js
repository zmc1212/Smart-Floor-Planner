const { CLOSE_TOLERANCE_MM, MIN_WALL_LENGTH_MM } = require('../core/constants.js');
const { buildSpaceBoundaryPoints, findClosedSpacesForWall } = require('../topology/closed-boundary.js');
const { buildWallSnapGeometry } = require('../read-model/wall-geometry.js');
const { getCursorPlacementTarget } = require('../snap/wall-targets.js');
const { getNode, getWall } = require('../core/graph-query.js');
const { isAxisAlignedWithAnchor } = require('../topology/closure-queries.js');
const polygonGeometry = require('../geometry/polygon.js');
const segmentGeometry = require('../geometry/segment.js');
const vector2 = require('../geometry/vector2.js');

const isPointInsidePolygon = polygonGeometry.containsPoint;
const dot = vector2.dot;
const cross = vector2.cross;
const distanceMm = vector2.distanceMm;
const projectPointToWallSegment = segmentGeometry.projectPointToSegment;
function preservesOuterTInteriorProjection(session, projection) {
  return !!(
    session &&
    projection &&
    session.activeSpaceSharedWallMiddle &&
    session.activeSpaceSharedSnapLine === 'outer' &&
    projection.t > 0.0001 &&
    projection.t < 0.9999
  );
}

function maybeMagnetizeProjectionToEndpoint(session, anchor, projection, nearestEndpoint) {
  if (
    !projection ||
    !nearestEndpoint ||
    nearestEndpoint.distanceMm > CLOSE_TOLERANCE_MM ||
    preservesOuterTInteriorProjection(session, projection)
  ) {
    return;
  }
  if (session && session.mode === 'straight' && !isAxisAlignedWithAnchor(anchor, nearestEndpoint.node)) {
    return;
  }
  projection.point = { xMm: nearestEndpoint.node.xMm, yMm: nearestEndpoint.node.yMm };
  projection.node = nearestEndpoint.node;
  projection.t = nearestEndpoint.t;
}

function getSharedWallProjection(floor, session, point) {
  if (!session || !session.activeSpaceSharedWallId || !point) return null;
  const wall = getWall(floor, session.activeSpaceSharedWallId);
  if (!wall) return null;
  const start = getNode(floor, wall.startNodeId);
  const end = getNode(floor, wall.endNodeId);
  const projection = projectPointToWallSegment(point, start, end);
  if (!projection || projection.distanceMm > CLOSE_TOLERANCE_MM) return null;
  const startT = typeof session.activeSpaceSharedStartT === 'number' ? session.activeSpaceSharedStartT : null;
  if (startT !== null && Math.abs(projection.t - startT) * distanceMm(start, end) < MIN_WALL_LENGTH_MM) {
    return null;
  }
  const anchor = getNode(floor, session.anchorNodeId);
  const endpointCandidates = [
    { node: start, t: 0 },
    { node: end, t: 1 }
  ];
  const nearestEndpoint = endpointCandidates
    .map((candidate) => Object.assign(candidate, {
      distanceMm: distanceMm(projection.point, candidate.node)
    }))
    .sort((a, b) => a.distanceMm - b.distanceMm)[0];
  maybeMagnetizeProjectionToEndpoint(session, anchor, projection, nearestEndpoint);
  if (projection.t <= 0.0001) projection.node = start;
  if (projection.t >= 0.9999) projection.node = end;
  projection.wall = wall;
  projection.start = start;
  projection.end = end;
  return projection;
}

function findSharedWallClosureProjection(floor, session, point) {
  if (!floor || !session || !point) return null;
  const activeStartNode = getNode(floor, session.activeSpaceStartNodeId);
  if (!activeStartNode) return null;

  const preferred = getSharedWallProjection(floor, session, point);
  if (preferred) return preferred;

  const startWallIndex = Number.isInteger(session.activeSpaceStartWallIndex)
    ? session.activeSpaceStartWallIndex
    : 0;
  let best = null;

  (floor.walls || []).forEach((wall, index) => {
    if (index >= startWallIndex) return;
    const start = getNode(floor, wall.startNodeId);
    const end = getNode(floor, wall.endNodeId);
    if (!start || !end) return;

    const startProjection = projectPointToWallSegment(activeStartNode, start, end);
    const endProjection = projectPointToWallSegment(point, start, end);
    if (!startProjection || !endProjection) return;
    if (startProjection.distanceMm > CLOSE_TOLERANCE_MM) return;
    if (endProjection.distanceMm > CLOSE_TOLERANCE_MM) return;
    if (Math.abs(endProjection.t - startProjection.t) * distanceMm(start, end) < MIN_WALL_LENGTH_MM) return;

    const endpointCandidates = [
      { node: start, t: 0 },
      { node: end, t: 1 }
    ];
    const nearestEndpoint = endpointCandidates
      .map((candidate) => Object.assign(candidate, {
        distanceMm: distanceMm(endProjection.point, candidate.node)
      }))
      .sort((a, b) => a.distanceMm - b.distanceMm)[0];
    maybeMagnetizeProjectionToEndpoint(
      session,
      getNode(floor, session.anchorNodeId),
      endProjection,
      nearestEndpoint
    );

    if (!best || endProjection.distanceMm < best.distanceMm) {
      best = Object.assign({}, endProjection, { wall, start, end });
    }
  });

  if (!best) return null;
  if (best.t <= 0.0001) best.node = best.start;
  if (best.t >= 0.9999) best.node = best.end;
  return best;
}

function findAnySharedWallClosureProjection(floor, session, point) {
  const sameWallProjection = findSharedWallClosureProjection(floor, session, point);
  if (sameWallProjection) return sameWallProjection;
  if (!floor || !session || !point || !session.activeSpaceSharedWallId) return null;

  const startWallIndex = Number.isInteger(session.activeSpaceStartWallIndex)
    ? session.activeSpaceStartWallIndex
    : 0;
  const anchor = getNode(floor, session.anchorNodeId);
  let best = null;
  (floor.walls || []).forEach((wall, index) => {
    if (index >= startWallIndex || wall.id === session.activeSpaceSharedWallId) return;
    const start = getNode(floor, wall.startNodeId);
    const end = getNode(floor, wall.endNodeId);
    if (!start || !end) return;

    const projection = projectPointToWallSegment(point, start, end);
    if (!projection || projection.distanceMm > CLOSE_TOLERANCE_MM) return;
    if (anchor) {
      const previewLength = distanceMm(anchor, point);
      const wallLength = distanceMm(start, end);
      if (previewLength > 0 && wallLength > 0) {
        const previewDirection = {
          x: (point.xMm - anchor.xMm) / previewLength,
          y: (point.yMm - anchor.yMm) / previewLength
        };
        const wallDirection = {
          x: (end.xMm - start.xMm) / wallLength,
          y: (end.yMm - start.yMm) / wallLength
        };
        const isCollinear = Math.abs(cross(previewDirection, wallDirection)) <= 0.001;
        if (isCollinear) {
          const entryNode = [start, end].map((node) => {
            const relative = {
              x: node.xMm - anchor.xMm,
              y: node.yMm - anchor.yMm
            };
            return {
              node,
              alongMm: dot(relative, previewDirection),
              perpendicularMm: Math.abs(cross(relative, previewDirection))
            };
          }).filter((candidate) => (
            candidate.alongMm >= MIN_WALL_LENGTH_MM &&
            candidate.alongMm <= previewLength + CLOSE_TOLERANCE_MM &&
            candidate.perpendicularMm <= CLOSE_TOLERANCE_MM
          )).sort((first, second) => first.alongMm - second.alongMm)[0];
          if (entryNode) {
            projection.point = { xMm: entryNode.node.xMm, yMm: entryNode.node.yMm };
            projection.node = entryNode.node;
            projection.t = entryNode.node.id === start.id ? 0 : 1;
            projection.distanceMm = distanceMm(point, entryNode.node);
            projection.snapsToTopologyEndpoint = true;
            projection.topologyEntryAlongMm = entryNode.alongMm;
          }
        }
      }
    }
    const endpointCandidates = [
      { node: start, t: 0 },
      { node: end, t: 1 }
    ];
    const nearestEndpoint = endpointCandidates
      .map((candidate) => Object.assign(candidate, {
        distanceMm: distanceMm(projection.point, candidate.node)
      }))
      .sort((a, b) => a.distanceMm - b.distanceMm)[0];
    maybeMagnetizeProjectionToEndpoint(session, anchor, projection, nearestEndpoint);
    const prefersTopologyEndpoint = projection.snapsToTopologyEndpoint &&
      (!best || !best.snapsToTopologyEndpoint ||
        projection.topologyEntryAlongMm < best.topologyEntryAlongMm);
    const prefersNearestProjection = !projection.snapsToTopologyEndpoint &&
      (!best || (!best.snapsToTopologyEndpoint && projection.distanceMm < best.distanceMm));
    if (prefersTopologyEndpoint || prefersNearestProjection) {
      best = Object.assign({}, projection, { wall, start, end });
    }
  });

  if (!best) return null;
  if (best.t <= 0.0001) best.node = best.start;
  if (best.t >= 0.9999) best.node = best.end;
  return best;
}

function findOuterFaceClosureProjection(floor, session, point, forcedWallId) {
  if (!floor || !session || !point || !session.activeSpaceSharedWallId) return null;
  const cursorTarget = forcedWallId ? null : getCursorPlacementTarget(floor, point, CLOSE_TOLERANCE_MM);
  // Do not infer an outer-face close from geometric proximity alone. At a
  // shared corner, an inner endpoint is also close to several outer faces.
  // The cursor hit classification is the authority for the user's intent.
  if (!forcedWallId && (!cursorTarget || cursorTarget.snapLine !== 'outer')) return null;
  const startWallIndex = Number.isInteger(session.activeSpaceStartWallIndex)
    ? session.activeSpaceStartWallIndex
    : 0;
  const anchor = getNode(floor, session.anchorNodeId);
  let best = null;

  (floor.walls || []).forEach((wall, index) => {
    if (index >= startWallIndex) return;
    if (forcedWallId && wall.id !== forcedWallId) return;
    const start = getNode(floor, wall.startNodeId);
    const end = getNode(floor, wall.endNodeId);
    const geometry = start && end ? buildWallSnapGeometry(floor, wall) : null;
    if (!geometry) return;
    const projection = projectPointToWallSegment(point, geometry.outerStart, geometry.outerEnd);
    if (!projection || projection.distanceMm > CLOSE_TOLERANCE_MM) return;
    const topologyProjection = projectPointToWallSegment(point, start, end);
    // A normal shared-wall close can be within the broad close tolerance of a
    // neighbouring outer face. Only treat this as an outer-face close when
    // the pointer is materially displaced from this wall's topology line.
    if (!topologyProjection || topologyProjection.distanceMm < Number(wall.thicknessMm || 0) * 0.75) return;

    const outerLength = distanceMm(geometry.outerStart, geometry.outerEnd);
    const approachLength = anchor ? distanceMm(anchor, point) : 0;
    const approach = approachLength > 0
      ? { x: (point.xMm - anchor.xMm) / approachLength, y: (point.yMm - anchor.yMm) / approachLength }
      : null;
    const outerDirection = outerLength > 0
      ? {
        x: (geometry.outerEnd.xMm - geometry.outerStart.xMm) / outerLength,
        y: (geometry.outerEnd.yMm - geometry.outerStart.yMm) / outerLength
      }
      : null;
    const alignment = approach && outerDirection ? Math.abs(dot(approach, outerDirection)) : 0;
    const endpointCandidates = [
      { node: start, outerPoint: geometry.outerStart, t: 0 },
      { node: end, outerPoint: geometry.outerEnd, t: 1 }
    ];
    const nearestEndpoint = endpointCandidates
      .map((candidate) => Object.assign(candidate, {
        distanceMm: distanceMm(projection.point, candidate.outerPoint)
      }))
      .sort((left, right) => left.distanceMm - right.distanceMm)[0];
    const candidate = {
      wall,
      start,
      end,
      point: projection.point,
      topologyNode: nearestEndpoint && nearestEndpoint.distanceMm <= CLOSE_TOLERANCE_MM
        ? nearestEndpoint.node
        : null,
      alignment,
      distanceMm: projection.distanceMm
    };
    if (!best || candidate.alignment > best.alignment + 0.001 || (
      Math.abs(candidate.alignment - best.alignment) <= 0.001 && candidate.distanceMm < best.distanceMm
    )) {
      best = candidate;
    }
  });

  return best;
}

function isPotentialPartitionDrag(floor, session, anchor, point) {
  if (!floor || !session || !anchor || !point || !session.activeSpaceSharedWallId) return false;
  const startWallIndex = Number.isInteger(session.activeSpaceStartWallIndex)
    ? session.activeSpaceStartWallIndex
    : 0;
  if ((floor.walls || []).length !== startWallIndex) return false;
  const sourceSpaces = findClosedSpacesForWall(floor, session.activeSpaceSharedWallId);
  if (!sourceSpaces.length) return false;

  const directionLength = distanceMm(anchor, point);
  if (directionLength < MIN_WALL_LENGTH_MM) return false;
  const direction = {
    x: (point.xMm - anchor.xMm) / directionLength,
    y: (point.yMm - anchor.yMm) / directionLength
  };
  const probe = {
    xMm: Math.round(anchor.xMm + direction.x * MIN_WALL_LENGTH_MM),
    yMm: Math.round(anchor.yMm + direction.y * MIN_WALL_LENGTH_MM)
  };
  return !!sourceSpaces.find((space) => (
    isPointInsidePolygon(probe, buildSpaceBoundaryPoints(floor, space.wallIds))
  ));
}

function findRayWallIntersection(floor, session, anchor, targetPoint) {
  if (!floor || !session || !anchor || !targetPoint) return null;
  const startWallIndex = Number.isInteger(session.activeSpaceStartWallIndex)
    ? session.activeSpaceStartWallIndex
    : 0;
  const activeWalls = (floor.walls || []).slice(startWallIndex);
  const activeWallCount = activeWalls.length;

  if (activeWallCount === 0 && isPotentialPartitionDrag(floor, session, anchor, targetPoint)) {
    return null;
  }

  const direction = { x: targetPoint.xMm - anchor.xMm, y: targetPoint.yMm - anchor.yMm };
  const len = Math.sqrt(direction.x * direction.x + direction.y * direction.y);
  if (len < MIN_WALL_LENGTH_MM) return null;

  const isOuterChain = session.activeSpaceSharedSnapLine === 'outer';
  let best = null;

  (floor.walls || []).forEach((wall, index) => {
    if (index >= startWallIndex) return;
    if (wall.startNodeId === anchor.id || wall.endNodeId === anchor.id) return;
    if (activeWallCount === 0 && wall.id === session.activeSpaceSharedWallId) return;
    const start = getNode(floor, wall.startNodeId);
    const end = getNode(floor, wall.endNodeId);
    if (!start || !end) return;

    const geom = buildWallSnapGeometry(floor, wall);
    const useOuter = isOuterChain && geom && geom.outerStart && geom.outerEnd;
    const segStart = useOuter ? geom.outerStart : start;
    const segEnd = useOuter ? geom.outerEnd : end;

    const segDirection = { x: segEnd.xMm - segStart.xMm, y: segEnd.yMm - segStart.yMm };
    const denom = cross(direction, segDirection);
    if (Math.abs(denom) < 0.000001) {
      const dirUnit = { x: direction.x / len, y: direction.y / len };
      const offset = { x: segStart.xMm - anchor.xMm, y: segStart.yMm - anchor.yMm };
      const perpDist = Math.abs(cross(offset, dirUnit));
      if (perpDist <= CLOSE_TOLERANCE_MM) {
        const along1 = dot({ x: segStart.xMm - anchor.xMm, y: segStart.yMm - anchor.yMm }, dirUnit);
        const along2 = dot({ x: segEnd.xMm - anchor.xMm, y: segEnd.yMm - anchor.yMm }, dirUnit);
        const minAlong = Math.min(along1 > 10 ? along1 : Infinity, along2 > 10 ? along2 : Infinity);
        if (minAlong !== Infinity) {
          const hitPoint = along1 === minAlong ? segStart : segEnd;
          const dist = minAlong;
          if (!best || dist < best.distanceMm) {
            best = {
              wall,
              point: { xMm: Math.round(hitPoint.xMm), yMm: Math.round(hitPoint.yMm) },
              start: segStart,
              end: segEnd,
              t: dist / len,
              u: along1 === minAlong ? 0 : 1,
              distanceMm: dist,
              snapLine: useOuter ? 'outer' : 'inner'
            };
          }
        }
      }
      return;
    }

    const offset = { x: segStart.xMm - anchor.xMm, y: segStart.yMm - anchor.yMm };
    const t = cross(offset, segDirection) / denom;
    const u = cross(offset, direction) / denom;
    const epsilon = 0.0001;

    if (t > 0.05 && u >= -epsilon && u <= 1 + epsilon) {
      const intersectPoint = {
        xMm: Math.round(anchor.xMm + t * direction.x),
        yMm: Math.round(anchor.yMm + t * direction.y)
      };
      const dist = distanceMm(anchor, intersectPoint);
      if (!best || dist < best.distanceMm) {
        best = {
          wall,
          point: intersectPoint,
          start: segStart,
          end: segEnd,
          t,
          u,
          distanceMm: dist,
          snapLine: useOuter ? 'outer' : 'inner'
        };
      }
    }
  });

  return best;
}

function findPartitionClosureProjection(floor, session, anchor, point) {
  if (!floor || !session || !anchor || !point || session.mode !== 'straight') return null;
  const startWallIndex = Number.isInteger(session.activeSpaceStartWallIndex)
    ? session.activeSpaceStartWallIndex
    : 0;
  if ((floor.walls || []).length !== startWallIndex || !session.activeSpaceSharedWallId) return null;

  const sourceSpaces = findClosedSpacesForWall(floor, session.activeSpaceSharedWallId);
  if (!sourceSpaces.length) return null;

  const directionLength = distanceMm(anchor, point);
  if (directionLength < MIN_WALL_LENGTH_MM) return null;
  const direction = {
    x: (point.xMm - anchor.xMm) / directionLength,
    y: (point.yMm - anchor.yMm) / directionLength
  };
  const probe = {
    xMm: Math.round(anchor.xMm + direction.x * MIN_WALL_LENGTH_MM),
    yMm: Math.round(anchor.yMm + direction.y * MIN_WALL_LENGTH_MM)
  };
  const sourceSpace = sourceSpaces.find((space) => (
    isPointInsidePolygon(probe, buildSpaceBoundaryPoints(floor, space.wallIds))
  ));
  if (!sourceSpace) return null;

  let best = null;
  sourceSpace.wallIds.forEach((wallId) => {
    if (wallId === session.activeSpaceSharedWallId) return;
    const wall = getWall(floor, wallId);
    const start = wall && getNode(floor, wall.startNodeId);
    const end = wall && getNode(floor, wall.endNodeId);
    if (!wall || !start || !end) return;
    const previewDirection = { x: point.xMm - anchor.xMm, y: point.yMm - anchor.yMm };
    const wallDirection = { x: end.xMm - start.xMm, y: end.yMm - start.yMm };
    const denominator = cross(previewDirection, wallDirection);
    if (Math.abs(denominator) < 0.000001) return;
    const offset = { x: start.xMm - anchor.xMm, y: start.yMm - anchor.yMm };
    const previewT = cross(offset, wallDirection) / denominator;
    const wallT = cross(offset, previewDirection) / denominator;
    if (previewT <= 0.0001 || previewT > 1.0001 || wallT < -0.0001 || wallT > 1.0001) return;
    const intersection = {
      xMm: Math.round(anchor.xMm + previewDirection.x * previewT),
      yMm: Math.round(anchor.yMm + previewDirection.y * previewT)
    };
    if (distanceMm(anchor, intersection) < MIN_WALL_LENGTH_MM) return;

    if (!best || previewT < best.previewT) {
      best = {
        wall,
        start,
        end,
        point: intersection,
        t: wallT,
        previewT,
        distanceMm: 0,
        sourceSpace
      };
    }
  });

  return best;
}

function isDirectClosureHit(floor, session, rawPoint) {
  if (!floor || !session || session.mode !== 'straight') return false;
  if (!session.closeCandidateNodeId && !session.closeCandidatePoint) return false;

  const target = session.closeCandidatePoint || getNode(floor, session.closeCandidateNodeId);
  if (!target) return false;

  // The rendered preview is the final snapping result and therefore the most
  // reliable release state on-device. Touch coordinates can lag one move
  // behind even though the preview has already landed on the closure target.
  if (session.previewPoint && distanceMm(session.previewPoint, target) <= 1) {
    return true;
  }

  const effectiveTolerance = Math.max(CLOSE_TOLERANCE_MM, Number(session.thicknessMm || 0) * 1.5);
  if (rawPoint && distanceMm(rawPoint, target) <= effectiveTolerance) {
    return true;
  }

  if (session.closeCandidateNodeId) {
    const node = getNode(floor, session.closeCandidateNodeId);
    if (node && rawPoint && distanceMm(rawPoint, node) <= effectiveTolerance) {
      return true;
    }
  }

  return false;
}

module.exports = {
  preservesOuterTInteriorProjection,
  maybeMagnetizeProjectionToEndpoint,
  getSharedWallProjection,
  findSharedWallClosureProjection,
  findAnySharedWallClosureProjection,
  findOuterFaceClosureProjection,
  isPotentialPartitionDrag,
  findRayWallIntersection,
  findPartitionClosureProjection,
  isDirectClosureHit
};
