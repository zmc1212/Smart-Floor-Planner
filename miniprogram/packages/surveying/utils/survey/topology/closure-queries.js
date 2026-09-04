const { findClosedSpaceForWall } = require('./closed-boundary.js');
const { WALL_OVERLAP_TOLERANCE_MM, MIN_WALL_LENGTH_MM, MIN_CLOSED_SPACE_AREA_MM2 } = require('../core/constants.js');
const { getNode, getFirstNode, getWall } = require('../core/graph-query.js');
const { findWallPathBetweenNodes } = require('./wall-path.js');

const segmentGeometry = require('../geometry/segment.js');

const vector2 = require('../geometry/vector2.js');
const distanceMm = vector2.distanceMm;

const wallDomain = require('../domain/wall.js');
const getWallCoordinateLength = wallDomain.coordinateLengthMm;
const polygonGeometry = require('../geometry/polygon.js');
const calculatePolygonAreaMm2 = polygonGeometry.area;

// Existing read-only topology queries shared by preview and deleted-room recovery.
// Phase 4D still owns migration of closure writes; all thresholds stay frozen.
const MAX_WALL_CLOSURE_CORRECTION_MM = 150;
const MIN_WALL_CLOSURE_CORRECTION_MM = 25;
const WALL_CLOSURE_CORRECTION_RATIO = 0.02;
const MAX_ORTHOGONAL_CLOSURE_BALANCE_MM = 1000;

function isClosedBoundaryCorner(floor, session) {
  if (!floor || !session || !session.activeSpaceStartNodeId || !session.activeSpaceSharedWallId) return false;
  if (!findClosedSpaceForWall(floor, session.activeSpaceSharedWallId)) return false;
  const incidentClosedWalls = (floor.walls || []).filter((wall) => (
    (wall.startNodeId === session.activeSpaceStartNodeId || wall.endNodeId === session.activeSpaceStartNodeId) &&
    !!findClosedSpaceForWall(floor, wall.id)
  ));
  return incidentClosedWalls.length >= 2;
}

function hasClosureInteriorIntersection(start, end, otherStart, otherEnd) {
  return segmentGeometry.hasInteriorIntersection(start, end, otherStart, otherEnd, {
    overlapToleranceMm: WALL_OVERLAP_TOLERANCE_MM
  });
}

function buildOrthogonalClosurePoints(startPoint, endPoint, incomingStart) {
  const horizontalFirst = [
    endPoint,
    { xMm: startPoint.xMm, yMm: endPoint.yMm },
    startPoint
  ];
  const verticalFirst = [
    endPoint,
    { xMm: endPoint.xMm, yMm: startPoint.yMm },
    startPoint
  ];
  const incomingIsHorizontal = incomingStart
    ? isHorizontalSegment(incomingStart, endPoint)
    : true;
  return incomingIsHorizontal
    ? [horizontalFirst, verticalFirst]
    : [verticalFirst, horizontalFirst];
}

function normalizeClosurePoints(points) {
  return points.filter((point, index) => (
    index === 0 || distanceMm(point, points[index - 1]) > 0.001
  ));
}

function isSafeClosurePath(points, occupiedSegments) {
  if (!Array.isArray(points) || points.length < 2) return false;
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (distanceMm(start, end) < MIN_WALL_LENGTH_MM) return false;
    const intersects = occupiedSegments.some((segment) => (
      segment.start && segment.end &&
      hasClosureInteriorIntersection(start, end, segment.start, segment.end)
    ));
    if (intersects) return false;
  }
  return true;
}

function isSafeOrthogonalClosurePath(points, occupiedSegments) {
  if (!Array.isArray(points) || points.length < 2) return false;
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const length = distanceMm(start, end);
    // A short first or final leg can be the wall-thickness alignment bridge
    // between an adjacent room's outside corner and the shared-wall topology.
    // Interior inferred legs are real walls and keep the normal minimum.
    if (index > 0 && index < points.length - 2 && length < MIN_WALL_LENGTH_MM) return false;
    if (length <= 0) continue;
    const intersects = occupiedSegments.some((segment) => (
      segment.start && segment.end && hasClosureInteriorIntersection(
        start,
        end,
        segment.start,
        segment.end
      )
    ));
    if (intersects) return false;
  }
  return true;
}

function isAxisAlignedWithAnchor(anchor, point, toleranceMm) {
  const limit = typeof toleranceMm === 'number' ? toleranceMm : 1;
  if (!anchor || !point) return false;
  return Math.abs(anchor.xMm - point.xMm) <= limit ||
    Math.abs(anchor.yMm - point.yMm) <= limit;
}

function isHorizontalSegment(start, end) {
  return Math.abs((end || {}).xMm - (start || {}).xMm) >= Math.abs((end || {}).yMm - (start || {}).yMm);
}

function getMinimumClosureSuggestionWallCount(floor, session) {
  if (!session || !session.activeSpaceSharedWallId) return 2;
  if (!isClosedBoundaryCorner(floor, session)) return 1;
  return 3;
}

function getMinimumDirectBoundaryCloseWallCount(floor, session) {
  if (!session || !session.activeSpaceSharedWallId) return 2;
  if (!isClosedBoundaryCorner(floor, session)) return 1;
  return 2;
}

function findMergeClosurePlan(floor, session, endPoint) {
  if (!floor || !session || !endPoint) return null;

  const startWallIndex = Number.isInteger(session.activeSpaceStartWallIndex)
    ? session.activeSpaceStartWallIndex
    : 0;
  const activeStartNode = getNode(floor, session.activeSpaceStartNodeId) || getFirstNode(floor);
  const activeWalls = (floor.walls || []).slice(startWallIndex);
  const anchor = getNode(floor, session.anchorNodeId);
  const includesPreview = !!session.previewPoint;
  const requiredWallCount = activeWalls.length + (includesPreview ? 1 : 0);

  // A reset cursor can begin a new wall chain from an existing boundary. In
  // that case, one measured wall plus a new closing edge can form a room by
  // following the existing boundary back to the snapped start point.
  // Closed-corner continuations may use the opposite corner as an axis snap
  // on their second wall. That alignment must not become an inferred extra-wall
  // merge. If the second wall itself lands on an existing boundary that already
  // completes a face with the start edge, treat it as a direct shared-wall close.
  const minimumSharedWallCount = isClosedBoundaryCorner(floor, session) && session.mode === 'straight'
    ? getMinimumDirectBoundaryCloseWallCount(floor, session)
    : getMinimumClosureSuggestionWallCount(floor, session);
  if (
    session.activeSpaceSharedWallId &&
    activeStartNode &&
    anchor &&
    requiredWallCount >= minimumSharedWallCount
  ) {
    const closureStart = includesPreview ? endPoint : anchor;
    const activeWallIds = {};
    activeWalls.forEach((wall) => { activeWallIds[wall.id] = true; });
    const segments = (floor.walls || []).map((wall) => ({
      start: getNode(floor, wall.startNodeId),
      end: getNode(floor, wall.endNodeId)
    }));
    if (includesPreview) {
      segments.push({ start: anchor, end: endPoint });
    }

    const activeSharedWall = getWall(floor, session.activeSpaceSharedWallId);
    const activeSharedEndpointIds = activeSharedWall
      ? [activeSharedWall.startNodeId, activeSharedWall.endNodeId]
      : [];
    const candidatePlans = (floor.nodes || []).map((candidate) => {
      if (!candidate || candidate.id === activeStartNode.id || candidate.id === anchor.id) return null;
      if (distanceMm(closureStart, candidate) < MIN_WALL_LENGTH_MM) return null;

      const candidateConnections = (floor.walls || []).filter((wall) => (
        !activeWallIds[wall.id] && (wall.startNodeId === candidate.id || wall.endNodeId === candidate.id)
      ));
      if (candidateConnections.length < 1) return null;

      const boundaryPath = findWallPathBetweenNodes(
        floor,
        candidate.id,
        activeStartNode.id,
        activeWallIds
      );
      if (boundaryPath.length < 1) return null;

      return {
        candidate,
        boundaryPath,
        // A room restarted from an existing wall should close against the
        // opposite end of that same wall before considering a longer route
        // around the old room. Node insertion order is unrelated to geometry;
        // using it here can make the new room swallow the previous room.
        sharedEndpointRank: activeSharedEndpointIds.indexOf(candidate.id) === -1 ? 1 : 0,
        boundaryLengthMm: boundaryPath.reduce((total, wallId) => {
          const wall = getWall(floor, wallId);
          return total + (wall ? getWallCoordinateLength(floor, wall) : 0);
        }, 0),
        closureDistanceMm: distanceMm(closureStart, candidate)
      };
    }).filter(Boolean).sort((left, right) => (
      left.sharedEndpointRank - right.sharedEndpointRank ||
      left.boundaryPath.length - right.boundaryPath.length ||
      left.boundaryLengthMm - right.boundaryLengthMm ||
      left.closureDistanceMm - right.closureDistanceMm
    ));

    for (let index = 0; index < candidatePlans.length; index += 1) {
      const candidatePlan = candidatePlans[index];
      const candidate = candidatePlan.candidate;
      if (!candidate || candidate.id === activeStartNode.id || candidate.id === anchor.id) continue;
      // Corners of an already closed room have two boundary connections. They
      // remain valid merge targets when the new chain can return through an
      // existing boundary path; restricting this to dangling nodes prevents
      // adjacent rooms from closing when started at a closed-room corner.
      const boundaryPath = candidatePlan.boundaryPath;
      // findWallPathBetweenNodes returns wall ids, so a single existing shared
      // wall is a valid boundary path (and is the normal corner-to-corner
      // adjacent-room case).
      if (boundaryPath.length < 1) continue;

      // A restarted chain from a closed-room corner usually reaches the
      // opposite corner through an L-shaped orthogonal route. The old logic
      // only accepted a direct axis-aligned segment, so two valid walls never
      // exposed the merge candidate until the cursor happened to be diagonal.
      const lastActiveWall = activeWalls[activeWalls.length - 1] || null;
      const incomingStart = includesPreview
        ? anchor
        : (lastActiveWall ? getNode(floor, lastActiveWall.startNodeId) : anchor);
      // Straight mode must never accept a 350 mm-slop “axis-aligned” diagonal
      // to an inner topology corner. Prefer the L-shaped orthogonal route and
      // only keep a direct connector when it is strictly on one axis.
      const useOrthogonalSharedPath = session.mode === 'straight';
      const pathCandidates = useOrthogonalSharedPath
        ? buildOrthogonalClosurePoints(candidate, closureStart, incomingStart).concat(
          isAxisAlignedWithAnchor(closureStart, candidate, 1)
            ? [[closureStart, candidate]]
            : []
        )
        : [[closureStart, candidate]];
      for (let pathIndex = 0; pathIndex < pathCandidates.length; pathIndex += 1) {
        const points = normalizeClosurePoints(pathCandidates[pathIndex]);
        if (session.mode === 'straight' && points.some((point, pointIndex) => (
          pointIndex > 0 && !isAxisAlignedWithAnchor(points[pointIndex - 1], point, 1)
        ))) continue;
        const safePath = useOrthogonalSharedPath
          ? isSafeOrthogonalClosurePath(points, segments)
          : isSafeClosurePath(points, segments);
        if (!safePath) continue;
        return {
          targetNode: candidate,
          points
        };
      }
    }
  }

  // In straight mode, two confirmed orthogonal walls already determine the
  // remaining rectangle. Surface that two-segment closure as a suggestion;
  // the missing walls are still only persisted after the user confirms it.
  const minimumWallCount = session.mode === 'straight' ? 2 : 3;
  if (!activeStartNode || !anchor || requiredWallCount < minimumWallCount || distanceMm(endPoint, activeStartNode) < MIN_WALL_LENGTH_MM) {
    return null;
  }

  const outlinePoints = [activeStartNode];
  let previousNodeId = activeStartNode.id;
  for (let index = 0; index < activeWalls.length; index += 1) {
    const wall = activeWalls[index];
    if (!wall || wall.startNodeId !== previousNodeId) return null;
    const wallEnd = getNode(floor, wall.endNodeId);
    if (!wallEnd) return null;
    outlinePoints.push(wallEnd);
    previousNodeId = wallEnd.id;
  }

  if (previousNodeId !== anchor.id) return null;
  if (includesPreview) outlinePoints.push(endPoint);
  const segments = (floor.walls || []).map((wall) => ({
    start: getNode(floor, wall.startNodeId),
    end: getNode(floor, wall.endNodeId)
  }));
  if (includesPreview) {
    segments.push({ start: anchor, end: endPoint });
  }

  const lastWall = activeWalls[activeWalls.length - 1] || null;
  const incomingStart = includesPreview
    ? anchor
    : (lastWall ? getNode(floor, lastWall.startNodeId) : null);
  const pathCandidates = session.mode === 'straight'
    ? buildOrthogonalClosurePoints(activeStartNode, endPoint, incomingStart)
    : [[endPoint, activeStartNode]];

  for (let index = 0; index < pathCandidates.length; index += 1) {
    const points = normalizeClosurePoints(pathCandidates[index]);
    const polygonPoints = outlinePoints.concat(points.slice(1, -1));
    if (calculatePolygonAreaMm2(polygonPoints) < MIN_CLOSED_SPACE_AREA_MM2) continue;
    if (!isSafeClosurePath(points, segments)) continue;
    return {
      targetNode: activeStartNode,
      points
    };
  }

  return null;
}

function findMergeClosureCandidate(floor, session, endPoint) {
  const plan = findMergeClosurePlan(floor, session, endPoint);
  return plan ? plan.targetNode : null;
}

function wallKeepsStrictAxis(start, end) {
  return isAxisAlignedWithAnchor(start, end, 1);
}

function isOrthogonalClosureAdjustmentGeometrySafe(floor, entries, targetNode) {
  if (!floor || !Array.isArray(entries) || entries.length < 3 || !targetNode) return false;
  let currentPoint = {
    xMm: Math.round(entries[0].fromNode.xMm),
    yMm: Math.round(entries[0].fromNode.yMm)
  };
  const projectedSegments = entries.map((entry) => {
    const start = currentPoint;
    const end = entry.axis === 'x'
      ? {
        xMm: Math.round(start.xMm + entry.adjustedSignedLengthMm),
        yMm: start.yMm
      }
      : {
        xMm: start.xMm,
        yMm: Math.round(start.yMm + entry.adjustedSignedLengthMm)
      };
    currentPoint = end;
    return { wallId: entry.wall.id, start, end };
  });
  if (currentPoint.xMm !== Math.round(targetNode.xMm) ||
      currentPoint.yMm !== Math.round(targetNode.yMm)) {
    return false;
  }

  for (let firstIndex = 0; firstIndex < projectedSegments.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < projectedSegments.length; secondIndex += 1) {
      const first = projectedSegments[firstIndex];
      const second = projectedSegments[secondIndex];
      const relation = segmentGeometry.classifySegmentRelation(
        first.start,
        first.end,
        second.start,
        second.end
      );
      const adjacent = secondIndex === firstIndex + 1 ||
        (firstIndex === 0 && secondIndex === projectedSegments.length - 1);
      if ((adjacent && relation.type !== 'endpoint-touch') ||
          (!adjacent && relation.type !== 'disjoint')) {
        return false;
      }
    }
  }

  const activeWallIds = new Set(projectedSegments.map((segment) => segment.wallId));
  const externalSegments = (floor.walls || [])
    .filter((wall) => !activeWallIds.has(wall.id))
    .map((wall) => ({
      start: getNode(floor, wall.startNodeId),
      end: getNode(floor, wall.endNodeId)
    }))
    .filter((segment) => segment.start && segment.end);
  return projectedSegments.every((projected) => externalSegments.every((external) => (
    segmentGeometry.classifySegmentRelation(
      projected.start,
      projected.end,
      external.start,
      external.end
    ).type === 'disjoint'
  )));
}

function getWallClosureCorrectionBudgetMm(entry) {
  const coordinateLengthMm = Math.abs(Number(entry && entry.signedLengthMm) || 0);
  return Math.min(
    MAX_WALL_CLOSURE_CORRECTION_MM,
    Math.max(
      MIN_WALL_CLOSURE_CORRECTION_MM,
      Math.round(coordinateLengthMm * WALL_CLOSURE_CORRECTION_RATIO)
    )
  );
}

function buildOrthogonalClosureAdjustmentPlan(floor, session, targetNode) {
  if (!floor || !session || !targetNode || session.mode !== 'straight') return null;
  if (session.activeSpaceSharedWallId || session.closeCandidateSharedWallId) return null;

  const startWallIndex = Number.isInteger(session.activeSpaceStartWallIndex)
    ? session.activeSpaceStartWallIndex
    : 0;
  const startNode = getNode(floor, session.activeSpaceStartNodeId) || getFirstNode(floor);
  const activeWalls = (floor.walls || []).slice(startWallIndex);
  if (!startNode || targetNode.id !== startNode.id || activeWalls.length < 3) return null;
  const activeWallIds = new Set(activeWalls.map((wall) => wall.id));
  if ((floor.openings || []).some((opening) => activeWallIds.has(opening.wallId))) return null;
  if ((floor.spaces || []).some((space) => (
    (space.wallIds || []).some((wallId) => activeWallIds.has(wallId))
  ))) return null;

  const entries = [];
  let currentNode = startNode;
  for (let index = 0; index < activeWalls.length; index += 1) {
    const wall = activeWalls[index];
    let nextNode = null;
    if (wall.startNodeId === currentNode.id) {
      nextNode = getNode(floor, wall.endNodeId);
    } else if (wall.endNodeId === currentNode.id) {
      nextNode = getNode(floor, wall.startNodeId);
    }
    if (!nextNode || wall.mode === 'diagonal' || !wallKeepsStrictAxis(currentNode, nextNode)) {
      return null;
    }

    const dx = nextNode.xMm - currentNode.xMm;
    const dy = nextNode.yMm - currentNode.yMm;
    const axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
    const signedLengthMm = axis === 'x' ? dx : dy;
    if (Math.abs(signedLengthMm) < MIN_WALL_LENGTH_MM) return null;
    entries.push({
      wall,
      fromNode: currentNode,
      toNode: nextNode,
      axis,
      signedLengthMm,
      adjustedSignedLengthMm: signedLengthMm
    });
    currentNode = nextNode;
  }

  const chainNodeIds = new Set([startNode.id, currentNode.id]);
  entries.forEach((entry) => {
    chainNodeIds.add(entry.fromNode.id);
    chainNodeIds.add(entry.toNode.id);
  });
  for (const nodeId of chainNodeIds) {
    const incidentWalls = (floor.walls || []).filter((wall) => (
      wall.startNodeId === nodeId || wall.endNodeId === nodeId
    ));
    if (incidentWalls.some((wall) => !activeWallIds.has(wall.id))) return null;
    const expectedDegree = nodeId === startNode.id || nodeId === currentNode.id ? 1 : 2;
    if (incidentWalls.length !== expectedDegree) return null;
  }

  // Straight walls tolerate a 1 mm perpendicular coordinate drift. Derive the
  // residual from the strict-axis projection used by the adjustment itself;
  // using the raw final node would lose that perpendicular millimetre and make
  // an otherwise valid chain fail the final geometry check.
  const projectedEnd = entries.reduce((point, entry) => (
    entry.axis === 'x'
      ? { xMm: point.xMm + entry.signedLengthMm, yMm: point.yMm }
      : { xMm: point.xMm, yMm: point.yMm + entry.signedLengthMm }
  ), { xMm: startNode.xMm, yMm: startNode.yMm });
  const residual = {
    xMm: Math.round(projectedEnd.xMm - targetNode.xMm),
    yMm: Math.round(projectedEnd.yMm - targetNode.yMm)
  };
  if (
    Math.hypot(residual.xMm, residual.yMm) > MAX_ORTHOGONAL_CLOSURE_BALANCE_MM ||
    (!residual.xMm && !residual.yMm)
  ) {
    return null;
  }

  for (const axis of ['x', 'y']) {
    const axisEntries = entries.filter((entry) => entry.axis === axis);
    const correctionMm = -(axis === 'x' ? residual.xMm : residual.yMm);
    if (!correctionMm) continue;
    if (!axisEntries.length) return null;
    const totalLengthMm = axisEntries.reduce(
      (total, entry) => total + Math.abs(entry.signedLengthMm),
      0
    );
    let remainingCorrectionMm = correctionMm;
    axisEntries.forEach((entry, index) => {
      const isLast = index === axisEntries.length - 1;
      const shareMm = isLast
        ? remainingCorrectionMm
        : Math.round(correctionMm * Math.abs(entry.signedLengthMm) / totalLengthMm);
      if (Math.abs(shareMm) > getWallClosureCorrectionBudgetMm(entry)) {
        entry.exceedsCorrectionBudget = true;
      }
      entry.adjustedSignedLengthMm += shareMm;
      remainingCorrectionMm -= shareMm;
    });
  }

  if (entries.some((entry) => entry.exceedsCorrectionBudget)) {
    return {
      type: 'orthogonal-adjustment-rejected',
      reason: 'correction-budget',
      residual
    };
  }
  if (entries.some((entry) => (
    Math.sign(entry.adjustedSignedLengthMm) !== Math.sign(entry.signedLengthMm) ||
    Math.abs(entry.adjustedSignedLengthMm) < MIN_WALL_LENGTH_MM
  ))) {
    return {
      type: 'orthogonal-adjustment-rejected',
      reason: 'minimum-wall-length',
      residual
    };
  }
  if (!isOrthogonalClosureAdjustmentGeometrySafe(floor, entries, targetNode)) {
    return {
      type: 'orthogonal-adjustment-rejected',
      reason: 'unsafe-geometry',
      residual
    };
  }

  return {
    type: 'orthogonal-adjustment',
    residual,
    entries
  };
}

function resolveStraightClosurePlan(floor, session, wall, targetNode, options) {
  if (!wall || !targetNode) return null;
  const start = getNode(floor, wall.startNodeId);
  const end = getNode(floor, wall.endNodeId);
  if (!start || !end) return null;
  if (wall.mode === 'diagonal' || !wallKeepsStrictAxis(start, end)) {
    return { type: 'snap' };
  }
  const adjustmentPlan = buildOrthogonalClosureAdjustmentPlan(floor, session, targetNode);
  if (adjustmentPlan && adjustmentPlan.type === 'orthogonal-adjustment') return adjustmentPlan;
  if (adjustmentPlan && adjustmentPlan.type === 'orthogonal-adjustment-rejected') {
    return options && options.allowRejectedCandidate ? adjustmentPlan : null;
  }
  if (wallKeepsStrictAxis(start, targetNode)) return { type: 'snap' };
  if (wallKeepsStrictAxis(end, targetNode) && distanceMm(end, targetNode) > 0.001) {
    return { type: 'bridge' };
  }
  return null;
}

module.exports = {
  isClosedBoundaryCorner,
  hasClosureInteriorIntersection,
  buildOrthogonalClosurePoints,
  normalizeClosurePoints,
  isSafeClosurePath,
  isSafeOrthogonalClosurePath,
  isAxisAlignedWithAnchor,
  isHorizontalSegment,
  getMinimumClosureSuggestionWallCount,
  getMinimumDirectBoundaryCloseWallCount,
  findMergeClosurePlan,
  findMergeClosureCandidate,
  wallKeepsStrictAxis,
  isOrthogonalClosureAdjustmentGeometrySafe,
  getWallClosureCorrectionBudgetMm,
  buildOrthogonalClosureAdjustmentPlan,
  resolveStraightClosurePlan
};
