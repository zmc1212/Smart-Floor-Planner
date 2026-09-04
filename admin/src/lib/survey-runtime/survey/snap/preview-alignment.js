const { CLOSE_TOLERANCE_MM, DIAGONAL_DIRECTION_SNAP_TOLERANCE_DEG, MIN_WALL_LENGTH_MM, RECTANGLE_ALIGNMENT_TOLERANCE_MM, VERTEX_AXIS_SNAP_TOLERANCE_MM } = require('../core/constants.js');
const { buildBaseWallSegment, buildWallRenderGeometry } = require('../read-model/wall-geometry.js');
const { findClosedSpaceForWall } = require('../topology/closed-boundary.js');
const { findMergeClosureCandidate, isAxisAlignedWithAnchor, isClosedBoundaryCorner, isHorizontalSegment } = require('../topology/closure-queries.js');
const { findNearestVertexAxisAlignment } = require('./wall-targets.js');
const { getFirstNode, getNode } = require('../core/graph-query.js');
const { getIncomingAngleAtAnchor, getIncomingWallAtAnchor } = require('../core/incoming-wall.js');
const vector2 = require('../geometry/vector2.js');

const normalizeSignedAngle = vector2.normalizeSignedAngleDeg;
const angleDeg = vector2.angleDeg;
const dot = vector2.dot;
const distanceMm = vector2.distanceMm;
function constrainStraightSnapPoint(session, anchor, point, fallbackPoint) {
  if (!point) return fallbackPoint;
  if (!session || session.mode !== 'straight' || isAxisAlignedWithAnchor(anchor, point)) {
    return point;
  }
  // An off-axis topology corner is still a valid clamp target for one axis.
  // Project it onto the current straight ray instead of copying both axes
  // (which would bend the wall into a diagonal).
  if (fallbackPoint && anchor) {
    const projected = isHorizontalSegment(anchor, fallbackPoint)
      ? { xMm: point.xMm, yMm: anchor.yMm }
      : { xMm: anchor.xMm, yMm: point.yMm };
    if (distanceMm(anchor, projected) >= 1) {
      return projected;
    }
  }
  return fallbackPoint || point;
}

function snapPreviewPoint(anchor, rawPoint, mode) {
  const point = {
    xMm: Math.round(rawPoint.xMm),
    yMm: Math.round(rawPoint.yMm)
  };

  if (mode !== 'straight') {
    return point;
  }

  const dx = point.xMm - anchor.xMm;
  const dy = point.yMm - anchor.yMm;

  if (Math.abs(dx) >= Math.abs(dy)) {
    return { xMm: point.xMm, yMm: anchor.yMm };
  }

  return { xMm: anchor.xMm, yMm: point.yMm };
}

function maybeSnapThirdWallForRectangle(floor, session, anchor, previewPoint) {
  if (!floor || !session || session.mode !== 'straight' || !anchor || !previewPoint) {
    return { point: previewPoint, guide: null };
  }

  const startWallIndex = Number.isInteger(session.activeSpaceStartWallIndex)
    ? session.activeSpaceStartWallIndex
    : 0;
  const activeWallCount = Math.max(0, floor.walls.length - startWallIndex);
  // Keep the rectangle reference while the third wall is being corrected.
  // Once it has been committed, forward extension and reverse shortening both
  // still need to snap its terminal endpoint to the first wall's orthogonal axis.
  if (activeWallCount !== 2 && activeWallCount !== 3) {
    return { point: previewPoint, guide: null };
  }

  const firstWall = floor.walls[startWallIndex];
  const firstStart = firstWall ? getNode(floor, firstWall.startNodeId) : null;
  const firstEnd = firstWall ? getNode(floor, firstWall.endNodeId) : null;
  if (!firstStart || !firstEnd) {
    return { point: previewPoint, guide: null };
  }

  const firstIsHorizontal = isHorizontalSegment(firstStart, firstEnd);
  const previewIsHorizontal = isHorizontalSegment(anchor, previewPoint);
  if (firstIsHorizontal !== previewIsHorizontal) {
    return { point: previewPoint, guide: null };
  }

  const alignedPoint = firstIsHorizontal
    ? { xMm: firstStart.xMm, yMm: previewPoint.yMm }
    : { xMm: previewPoint.xMm, yMm: firstStart.yMm };
  const offset = firstIsHorizontal
    ? Math.abs(previewPoint.xMm - firstStart.xMm)
    : Math.abs(previewPoint.yMm - firstStart.yMm);

  if (offset > RECTANGLE_ALIGNMENT_TOLERANCE_MM || distanceMm(anchor, alignedPoint) < MIN_WALL_LENGTH_MM) {
    return { point: previewPoint, guide: null };
  }

  return {
    point: alignedPoint,
    guide: {
      type: 'rectangle-third-wall',
      direction: firstIsHorizontal ? 'vertical' : 'horizontal',
      referencePoint: { xMm: firstStart.xMm, yMm: firstStart.yMm },
      snappedPoint: { xMm: alignedPoint.xMm, yMm: alignedPoint.yMm }
    }
  };
}

function maybeSnapStraightClosureToStart(floor, session, anchor, rawPoint, previewPoint) {
  if (
    !floor ||
    !session ||
    session.mode !== 'straight' ||
    session.activeSpaceSharedWallId ||
    !anchor ||
    !rawPoint ||
    !previewPoint
  ) {
    return { point: previewPoint, guide: null };
  }

  const startWallIndex = Number.isInteger(session.activeSpaceStartWallIndex)
    ? session.activeSpaceStartWallIndex
    : 0;
  const activeWallCount = Math.max(0, floor.walls.length - startWallIndex);
  const activeStartNode = getNode(floor, session.activeSpaceStartNodeId) || getFirstNode(floor);
  if (
    activeWallCount < 3 ||
    !activeStartNode ||
    activeStartNode.id === anchor.id ||
    distanceMm(rawPoint, activeStartNode) > CLOSE_TOLERANCE_MM ||
    distanceMm(anchor, activeStartNode) < MIN_WALL_LENGTH_MM
  ) {
    return { point: previewPoint, guide: null };
  }

  const sharesVerticalAxis = Math.abs(anchor.xMm - activeStartNode.xMm) <= 1;
  const sharesHorizontalAxis = Math.abs(anchor.yMm - activeStartNode.yMm) <= 1;
  if (!sharesVerticalAxis && !sharesHorizontalAxis) {
    return { point: previewPoint, guide: null };
  }

  const snappedPoint = {
    xMm: activeStartNode.xMm,
    yMm: activeStartNode.yMm
  };
  return {
    point: snappedPoint,
    guide: {
      type: 'start-vertex-closure',
      direction: sharesVerticalAxis ? 'horizontal' : 'vertical',
      referencePoint: snappedPoint,
      snappedPoint
    }
  };
}

function resolveClosedCornerOuterVertex(floor, node, guideDirection) {
  if (!floor || !node) return null;
  const wantsVerticalWall = guideDirection === 'vertical';
  const candidates = [];
  (floor.walls || []).forEach((wall) => {
    if (!findClosedSpaceForWall(floor, wall.id) ||
      (wall.startNodeId !== node.id && wall.endNodeId !== node.id)) return;
    const start = getNode(floor, wall.startNodeId);
    const end = getNode(floor, wall.endNodeId);
    if (!start || !end) return;
    const isVerticalWall = Math.abs(end.xMm - start.xMm) <= 1;
    if (isVerticalWall !== wantsVerticalWall) return;
    const geometry = buildWallRenderGeometry(floor, wall);
    if (!geometry) return;
    const point = wall.startNodeId === node.id ? geometry.outerStart : geometry.outerEnd;
    if (point) candidates.push(point);
  });
  return candidates[0] || null;
}

function resolveSharedBoundaryOppositeNode(floor, session) {
  if (!floor || !session || !session.activeSpaceSharedWallId || !session.activeSpaceStartNodeId) {
    return null;
  }
  const firstWallIndex = Number.isInteger(session.activeSpaceStartWallIndex)
    ? session.activeSpaceStartWallIndex
    : 0;
  const firstWall = floor.walls[firstWallIndex];
  const firstSegment = firstWall ? buildBaseWallSegment(floor, firstWall) : null;
  const candidates = (floor.walls || []).filter((wall) => (
    findClosedSpaceForWall(floor, wall.id) &&
    (wall.startNodeId === session.activeSpaceStartNodeId || wall.endNodeId === session.activeSpaceStartNodeId)
  )).map((wall) => {
    const segment = buildBaseWallSegment(floor, wall);
    return {
      wall,
      parallelScore: firstSegment && segment
        ? Math.abs(dot(firstSegment.direction, segment.direction))
        : (wall.id === session.activeSpaceSharedWallId ? 0 : 1),
      preferred: wall.id === session.activeSpaceSharedWallId
    };
  }).sort((first, second) => (
    first.parallelScore - second.parallelScore || Number(second.preferred) - Number(first.preferred)
  ));
  const wall = candidates.length ? candidates[0].wall : null;
  if (!wall) return null;
  return wall.startNodeId === session.activeSpaceStartNodeId
    ? getNode(floor, wall.endNodeId)
    : getNode(floor, wall.startNodeId);
}

function maybeSnapResetChainForRectangleClosure(floor, session, anchor, previewPoint) {
  if (!floor || !session || session.mode !== 'straight' || !anchor || !previewPoint) {
    return { point: previewPoint, guide: null };
  }

  const startWallIndex = Number.isInteger(session.activeSpaceStartWallIndex)
    ? session.activeSpaceStartWallIndex
    : 0;
  const activeWallCount = Math.max(0, floor.walls.length - startWallIndex);
  // A restarted chain may need the first or second measured wall to align
  // with the far endpoint of an existing shared boundary.
  if (activeWallCount > 1 || !session.activeSpaceSharedWallId) {
    return { point: previewPoint, guide: null };
  }

  const previewSession = Object.assign({}, session, { previewPoint });
  const closureNode = isClosedBoundaryCorner(floor, session)
    ? resolveSharedBoundaryOppositeNode(floor, session)
    : findMergeClosureCandidate(floor, previewSession, previewPoint);
  if (!closureNode) {
    return { point: previewPoint, guide: null };
  }

  const previewIsHorizontal = isHorizontalSegment(anchor, previewPoint);
  const guideDirection = previewIsHorizontal ? 'vertical' : 'horizontal';
  const outerVertex = isClosedBoundaryCorner(floor, session)
    ? resolveClosedCornerOuterVertex(floor, closureNode, guideDirection)
    : null;
  const snapTargets = [
    { point: closureNode, snapLine: 'inner' }
  ];
  if (outerVertex && distanceMm(outerVertex, closureNode) > 1) {
    snapTargets.push({ point: outerVertex, snapLine: 'outer' });
  }
  snapTargets.sort((first, second) => {
    const firstOffset = previewIsHorizontal
      ? Math.abs(previewPoint.xMm - first.point.xMm)
      : Math.abs(previewPoint.yMm - first.point.yMm);
    const secondOffset = previewIsHorizontal
      ? Math.abs(previewPoint.xMm - second.point.xMm)
      : Math.abs(previewPoint.yMm - second.point.yMm);
    return firstOffset - secondOffset;
  });
  const snapTarget = snapTargets[0];
  const alignedPoint = previewIsHorizontal
    ? { xMm: snapTarget.point.xMm, yMm: previewPoint.yMm }
    : { xMm: previewPoint.xMm, yMm: snapTarget.point.yMm };
  const offset = previewIsHorizontal
    ? Math.abs(previewPoint.xMm - snapTarget.point.xMm)
    : Math.abs(previewPoint.yMm - snapTarget.point.yMm);

  if (
    offset > RECTANGLE_ALIGNMENT_TOLERANCE_MM ||
    distanceMm(anchor, alignedPoint) < MIN_WALL_LENGTH_MM ||
    distanceMm(alignedPoint, snapTarget.point) < MIN_WALL_LENGTH_MM
  ) {
    return { point: previewPoint, guide: null };
  }

  return {
    point: alignedPoint,
    guide: {
      type: 'rectangle-third-wall',
      direction: guideDirection,
      snapLine: snapTarget.snapLine,
      referencePoint: { xMm: snapTarget.point.xMm, yMm: snapTarget.point.yMm },
      snappedPoint: { xMm: alignedPoint.xMm, yMm: alignedPoint.yMm }
    }
  };
}

function maybeSnapToPreviousDiagonalDirection(floor, session, anchor, previewPoint) {
  if (!floor || !session || session.mode !== 'diagonal' || !anchor || !previewPoint) {
    return { point: previewPoint, guide: null };
  }

  const previousWall = getIncomingWallAtAnchor(floor, session.anchorNodeId);
  const previousAngle = getIncomingAngleAtAnchor(floor, previousWall, session.anchorNodeId);
  if (!previousWall || previousWall.mode !== 'diagonal' || previousAngle === null) {
    return { point: previewPoint, guide: null };
  }

  const length = distanceMm(anchor, previewPoint);
  if (length < MIN_WALL_LENGTH_MM) {
    return { point: previewPoint, guide: null };
  }

  const rawAngle = angleDeg(anchor, previewPoint);
  if (Math.abs(normalizeSignedAngle(rawAngle - previousAngle)) > DIAGONAL_DIRECTION_SNAP_TOLERANCE_DEG) {
    return { point: previewPoint, guide: null };
  }

  const radians = previousAngle * Math.PI / 180;
  const snappedPoint = {
    xMm: Math.round(anchor.xMm + Math.cos(radians) * length),
    yMm: Math.round(anchor.yMm + Math.sin(radians) * length)
  };
  return {
    point: snappedPoint,
    guide: {
      type: 'previous-diagonal-direction',
      anchorPoint: { xMm: anchor.xMm, yMm: anchor.yMm },
      snappedPoint: { xMm: snappedPoint.xMm, yMm: snappedPoint.yMm }
    }
  };
}

function maybeSnapStraightPreviewToVertexAxis(floor, session, anchor, previewPoint) {
  const activeWallCount = floor && session
    ? Math.max(0, floor.walls.length - session.activeSpaceStartWallIndex)
    : 0;
  if (
    !floor ||
    !session ||
    session.mode !== 'straight' ||
    (session.activeSpaceSharedWallId && activeWallCount === 0) ||
    !anchor ||
    !previewPoint
  ) {
    return { point: previewPoint, guide: null };
  }

  const previewIsHorizontal = isHorizontalSegment(anchor, previewPoint);
  const target = findNearestVertexAxisAlignment(
    floor,
    previewPoint,
    VERTEX_AXIS_SNAP_TOLERANCE_MM,
    previewIsHorizontal ? 'x' : 'y'
  );
  if (!target || distanceMm(anchor, target.pointMm) < MIN_WALL_LENGTH_MM) {
    return { point: previewPoint, guide: null };
  }

  return {
    point: target.pointMm,
    guide: {
      type: 'vertex-axis',
      direction: target.axis === 'x' ? 'vertical' : 'horizontal',
      snapLine: target.snapLine,
      nodeId: target.nodeId,
      wallId: target.wallId,
      referencePoint: target.referencePoint,
      snappedPoint: { xMm: target.pointMm.xMm, yMm: target.pointMm.yMm }
    }
  };
}

module.exports = {
  constrainStraightSnapPoint,
  snapPreviewPoint,
  maybeSnapThirdWallForRectangle,
  maybeSnapStraightClosureToStart,
  resolveClosedCornerOuterVertex,
  resolveSharedBoundaryOppositeNode,
  maybeSnapResetChainForRectangleClosure,
  maybeSnapToPreviousDiagonalDirection,
  maybeSnapStraightPreviewToVertexAxis
};
