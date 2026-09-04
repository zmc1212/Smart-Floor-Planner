// Test-only frozen Phase 4D kernel (8fff5dd7). Function bodies must not be refreshed.
const { deleteWall, deleteClosedSpace } = require('../../../packages/surveying/utils/survey/operations/wall-deletion.js');
const { buildSpaceDimensionPlan, calculateSpaceAreaMm2 } = require('../../../packages/surveying/utils/survey/read-model/space-dimensions.js');
const { buildSpaceInnerBoundaryPoints, buildSpaceRenderBoundaryPoints } = require('../../../packages/surveying/utils/survey/read-model/space-boundary.js');
const { resumeOpenChainAtDanglingNode } = require('../../../packages/surveying/utils/survey/operations/open-chain.js');
const {
  isClosedBoundaryCorner,
  hasClosureInteriorIntersection,
  buildOrthogonalClosurePoints,
  normalizeClosurePoints,
  isAxisAlignedWithAnchor,
  isHorizontalSegment,
  getMinimumClosureSuggestionWallCount,
  getMinimumDirectBoundaryCloseWallCount,
  findMergeClosurePlan,
  findMergeClosureCandidate,
  resolveStraightClosurePlan,
  getMinimumActiveCloseWallCount
} = require('../../../packages/surveying/utils/survey/topology/closure-queries.js');
const {
  resolvePreviewStartClosurePlan,
  canResolvePreviewStartClosure,
  planPreviewClosureCandidate,
  planCommittedClosureCandidate
} = require('../../../packages/surveying/utils/survey/topology/closure-candidates.js');
const { applyClosureCandidatePlan } = require('../../../packages/surveying/utils/survey/operations/closure-candidate.js');
const { resolveBoundaryAlignedMeasurementSide, resolveMeasurementEndInsetMm } = require('../../../packages/surveying/utils/survey/topology/wall-alignment.js');

const { pointAlongWall, splitWallAtNodes } = require('../../../packages/surveying/utils/survey/operations/wall-split.js');
const {
  addNode,
  getOrCreateSnapNode,
  syncFloorSpaces,
  getOpening,
  removeUnreferencedNodes,
  canExtendLastWall,
  mergeCollinearDegree2Walls,
  setWallEndpointInset
} = require('../../../packages/surveying/utils/survey/operations/wall-mutation-helpers.js');
const {
  getFirstNode,
  getLastWall,
  getLastEndNode,
  getClosedSpace,
  getNode,
  getWall,
  getNodeWallUseCount,
  getSingleSharedEndpoint
} = require('../../../packages/surveying/utils/survey/core/graph-query.js');
const {
  legacyRemeasureSelectedWall,
  applyExistingWallMeasurement,
  recordCommittedWallMeasurement
} = require('../../../packages/surveying/utils/survey/operations/measurement.js');
const { nowIso, nextId } = require('../../../packages/surveying/utils/survey/core/runtime-id.js');
const {
  buildWallSnapGeometry,
  buildWallRenderGeometry,
  buildWallJoinRenderGeometries,
  buildBaseWallSegment,
  buildResolvedSegment,
  resolveClosedBoundaryInsetMm
} = require('../../../packages/surveying/utils/survey/read-model/wall-geometry.js');
const {
  findClosedSpaceForWall,
  findClosedSpacesForWall,
  buildClosedSpaceWallChain,
  buildSpaceBoundaryPoints
} = require('../../../packages/surveying/utils/survey/topology/closed-boundary.js');
const {
  DEFAULT_THICKNESS_MM,
  DEFAULT_SCALE,
  MIN_THICKNESS_MM,
  CLOSE_TOLERANCE_MM,
  RECTANGLE_ALIGNMENT_TOLERANCE_MM,
  VERTEX_AXIS_SNAP_TOLERANCE_MM,
  DIAGONAL_DIRECTION_SNAP_TOLERANCE_DEG,
  MIN_WALL_LENGTH_MM,
  WALL_OVERLAP_TOLERANCE_MM,
  WALL_EXTENSION_DIRECTION_TOLERANCE_DEG
} = require('../../../packages/surveying/utils/survey/core/constants.js');
const { createSurveyDraft, cloneDraft, getActiveFloor: findActiveFloor, touchDraft } = require('../../../packages/surveying/utils/survey/core/draft.js');
const { SESSION_STATES, ensureSessionSpaceTracking } = require('../../../packages/surveying/utils/survey/core/session.js');
const { SURVEY_DOMAIN_ERROR_CODES: DOMAIN_ERROR_CODES, createSurveyDomainError } = require('../../../packages/surveying/utils/survey/domain/errors.js');
const { adaptLegacySurveyOperation } = require('../../../packages/surveying/utils/survey/compat/legacy-error-messages.js');
const { legacyOpeningOperations } = require('../../../packages/surveying/utils/survey/operations/opening-operations.js');
const { createLegacyConfirmClosure } = require('../../../packages/surveying/utils/survey/operations/closure.js');

const vector2 = require('../../../packages/surveying/utils/survey/geometry/vector2.js');
const segmentGeometry = require('../../../packages/surveying/utils/survey/geometry/segment.js');
const polygonGeometry = require('../../../packages/surveying/utils/survey/geometry/polygon.js');
const openingDomain = require('../../../packages/surveying/utils/survey/domain/opening.js');
const wallDomain = require('../../../packages/surveying/utils/survey/domain/wall.js');
const domainValidation = require('../../../packages/surveying/utils/survey/domain/validation.js');

const getActiveFloor = (draft) => findActiveFloor(draft, { requireFloorList: true });
const distanceMm = vector2.distanceMm;
const angleDeg = vector2.angleDeg;
const dot = vector2.dot;
const cross = vector2.cross;
const pointLineDistanceMm = vector2.pointLineDistanceMm;
const normalizeAngle = vector2.normalizeAngleDeg;
const normalizeSignedAngle = vector2.normalizeSignedAngleDeg;

const projectPointToWallSegment = segmentGeometry.projectPointToSegment;
const perpendicularDistanceToLineMm = segmentGeometry.perpendicularDistanceToLineMm;
const isPointInsidePolygon = polygonGeometry.containsPoint;

const normalizeMeasurementInset = wallDomain.normalizeMeasurementAdjustment;
const normalizeMeasurementExtension = wallDomain.normalizeMeasurementAdjustment;
const getWallCoordinateLength = wallDomain.coordinateLengthMm;
const getWallMeasurementInsets = wallDomain.measurementInsets;
const getMeasuredWallLength = wallDomain.measuredLengthMm;
const normalForMeasurementSide = wallDomain.normalForMeasurementSide;
const calculateMeasuredPreviewLength = wallDomain.measuredPreviewLengthMm;
const pointFromLength = wallDomain.pointFromMeasuredLength;
const syncWallAdjustmentAfterMetricChange = wallDomain.syncAdjustmentAfterMetricChange;
const recordWallRawMeasurement = wallDomain.recordRawMeasurement;
const normalizeOpeningDirection = openingDomain.normalizeOpeningDirection;
const validateInteriorAngle = domainValidation.validateInteriorAngle;
const validateLength = domainValidation.validateLength;
const validateThickness = domainValidation.validateThickness;

function resetPreviewSideLock(session) {
  if (!session) return;
  session.previewBodyNormalSide = '';
  session.measurementSideUserSet = false;
}

function resolvePreviewMeasurementStartInsetMm(floor, session, anchor, previewPoint) {
  if (!floor || !session || !anchor || !previewPoint || !session.activeSpaceSharedWallId) return 0;
  const startWallIndex = Number.isInteger(session.activeSpaceStartWallIndex)
    ? session.activeSpaceStartWallIndex
    : 0;
  const activeWallCount = Math.max(0, (floor.walls || []).length - startWallIndex);
  if (activeWallCount !== 0 || !findClosedSpaceForWall(floor, session.activeSpaceSharedWallId)) return 0;
  return resolveClosedBoundaryInsetMm(floor, anchor, previewPoint, {
    preferredWallId: session.activeSpaceSharedWallId
  });
}

function resolveOuterTContinuationStartAdjustment(floor, session, anchor, previewPoint) {
  if (
    !floor ||
    !session ||
    !anchor ||
    !previewPoint ||
    !session.activeSpaceSharedWallMiddle ||
    session.activeSpaceSharedSnapLine !== 'outer'
  ) {
    return { insetMm: 0, extensionMm: 0 };
  }

  const startWallIndex = Number.isInteger(session.activeSpaceStartWallIndex)
    ? session.activeSpaceStartWallIndex
    : 0;
  const activeWallCount = Math.max(0, (floor.walls || []).length - startWallIndex);
  if (activeWallCount === 0) return { insetMm: 0, extensionMm: 0 };

  const previousWall = (floor.walls || [])[floor.walls.length - 1];
  const previousGeometry = previousWall ? buildWallRenderGeometry(floor, previousWall) : null;
  if (!previousGeometry) return { insetMm: 0, extensionMm: 0 };

  const dx = previewPoint.xMm - anchor.xMm;
  const dy = previewPoint.yMm - anchor.yMm;
  const coordinateLength = Math.sqrt(dx * dx + dy * dy);
  if (coordinateLength <= 0) return { insetMm: 0, extensionMm: 0 };

  const workingStart = previousGeometry.end;

  const signedOffsetMm = Math.round(
    (workingStart.xMm - anchor.xMm) * dx / coordinateLength +
    (workingStart.yMm - anchor.yMm) * dy / coordinateLength
  );
  return signedOffsetMm >= 0
    ? { insetMm: signedOffsetMm, extensionMm: 0 }
    : { insetMm: 0, extensionMm: -signedOffsetMm };
}

function updateWallEndpointInset(floor, wall, nodeId, insetMm) {
  setWallEndpointInset(floor, wall, nodeId, insetMm, true);
}

function applyWallBodyInsetToIncidentWalls(floor, sourceWall, nodeId) {
  if (!floor || !sourceWall || !nodeId) return;
  const session = ensureSessionSpaceTracking(floor);
  const activeStartWallIndex = Number.isInteger(session.activeSpaceStartWallIndex)
    ? session.activeSpaceStartWallIndex
    : floor.walls.length;
  const sourceWallIndex = floor.walls.findIndex((wall) => wall && wall.id === sourceWall.id);
  if (
    session.activeSpaceSharedWallMiddle &&
    sourceWallIndex > activeStartWallIndex
  ) {
    // A wall-middle T chain already records its real measurement origin on
    // the first wall and its final boundary inset on the closing wall. Later
    // turns must not shorten earlier confirmed readings merely to cover the
    // solid corner; the renderer joins those wall bodies from topology.
    return;
  }
  const sourceSegment = buildBaseWallSegment(floor, sourceWall);
  if (!sourceSegment) return;

  (floor.walls || []).forEach((wall) => {
    if (!wall || wall.id === sourceWall.id) return;
    const touchesStart = wall.startNodeId === nodeId;
    const touchesEnd = wall.endNodeId === nodeId;
    if (!touchesStart && !touchesEnd) return;
    const node = getNode(floor, nodeId);
    const oppositeNode = getNode(floor, touchesStart ? wall.endNodeId : wall.startNodeId);
    if (!node || !oppositeNode) return;
    const length = distanceMm(node, oppositeNode);
    if (!length) return;
    const awayDirection = {
      x: (oppositeNode.xMm - node.xMm) / length,
      y: (oppositeNode.yMm - node.yMm) / length
    };
    const coverageRate = dot(awayDirection, sourceSegment.normal);
    if (coverageRate <= 0.25) return;
    updateWallEndpointInset(
      floor,
      wall,
      nodeId,
      Math.ceil(sourceSegment.thicknessMm / coverageRate)
    );
  });
}

function resolveSharedClosureEndInsetMm(floor, session, start, end, sharedWallId) {
  return resolveMeasurementEndInsetMm(floor, start, end, sharedWallId);
}

function segmentOverlapLengthMm(start, end, otherStart, otherEnd) {
  return segmentGeometry.overlapLengthMm(
    start,
    end,
    otherStart,
    otherEnd,
    WALL_OVERLAP_TOLERANCE_MM
  );
}

function findOverlappingWall(floor, start, end, options) {
  const currentLength = distanceMm(start, end);
  if (!floor || !floor.walls || currentLength < MIN_WALL_LENGTH_MM) return null;
  const ignoredWallIds = (options && options.ignoredWallIds) || [];

  return floor.walls.find((wall) => {
    if (ignoredWallIds.indexOf(wall.id) !== -1) return false;
    const wallStart = getNode(floor, wall.startNodeId);
    const wallEnd = getNode(floor, wall.endNodeId);
    if (!wallStart || !wallEnd) return false;

    if (hasClosureInteriorIntersection(start, end, wallStart, wallEnd)) {
      return wall;
    }

    const overlapLength = segmentOverlapLengthMm(start, end, wallStart, wallEnd);
    const wallLength = distanceMm(wallStart, wallEnd);
    const meaningfulOverlap = Math.min(currentLength, wallLength) * 0.25;
    return overlapLength > Math.max(WALL_OVERLAP_TOLERANCE_MM, meaningfulOverlap);
  }) || null;
}

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

function getOrthogonalClosureGuidePoints(floor, session, currentNode, targetNode) {
  if (!currentNode || !targetNode) return [];
  if (!session || session.mode !== 'straight' || isAxisAlignedWithAnchor(currentNode, targetNode, 1)) {
    return [currentNode, targetNode];
  }
  const lastWall = getLastWall(floor);
  const incomingStart = session.previewPoint
    ? getNode(floor, session.anchorNodeId)
    : (lastWall ? getNode(floor, lastWall.startNodeId) : getNode(floor, session.anchorNodeId));
  const pathCandidates = buildOrthogonalClosurePoints(targetNode, currentNode, incomingStart);
  for (let index = 0; index < pathCandidates.length; index += 1) {
    const points = normalizeClosurePoints(pathCandidates[index]);
    if (points.length < 2) continue;
    if (points.some((point, pointIndex) => (
      pointIndex > 0 && !isAxisAlignedWithAnchor(points[pointIndex - 1], point, 1)
    ))) continue;
    return points.map((point) => ({ xMm: point.xMm, yMm: point.yMm }));
  }
  return [currentNode, targetNode];
}

function getClosurePath(floor, session) {
  if (!floor || !session) return [];
  const currentNode = session.previewPoint || getNode(floor, session.anchorNodeId);
  const targetNode = session.closeCandidatePoint || getNode(floor, session.closeCandidateNodeId);
  if (!currentNode || !targetNode) return [];
  if (session.closeCandidateType !== 'merge') {
    return getOrthogonalClosureGuidePoints(floor, session, currentNode, targetNode);
  }

  const plan = findMergeClosurePlan(floor, session, currentNode);
  if (!plan || !plan.targetNode || plan.targetNode.id !== session.closeCandidateNodeId) return [];
  const points = plan.points.map((point) => ({ xMm: point.xMm, yMm: point.yMm }));
  if (points.length >= 2) {
    const previous = points[points.length - 2];
    const target = points[points.length - 1];
    const endInsetMm = resolveMeasurementEndInsetMm(
      floor,
      previous,
      plan.targetNode,
      session.activeSpaceSharedWallId
    );
    const length = distanceMm(previous, target);
    if (endInsetMm > 0 && length > endInsetMm) {
      points[points.length - 1] = {
        xMm: Math.round(target.xMm + (previous.xMm - target.xMm) / length * endInsetMm),
        yMm: Math.round(target.yMm + (previous.yMm - target.yMm) / length * endInsetMm)
      };
    }
  }
  return points;
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

function getIncomingWallAtAnchor(floor, anchorNodeId) {
  if (!floor || !anchorNodeId) return null;
  for (let index = floor.walls.length - 1; index >= 0; index -= 1) {
    const wall = floor.walls[index];
    if (wall.endNodeId === anchorNodeId || wall.startNodeId === anchorNodeId) {
      return wall;
    }
  }
  return null;
}

function getIncomingAngleAtAnchor(floor, wall, anchorNodeId) {
  if (!wall) return null;
  const start = getNode(floor, wall.startNodeId);
  const end = getNode(floor, wall.endNodeId);
  if (!start || !end) return null;
  return wall.endNodeId === anchorNodeId ? angleDeg(start, end) : angleDeg(end, start);
}

function repairCollinearDegree2Walls(draft) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  mergeCollinearDegree2Walls(floor);
  if ((floor.spaces || []).some((space) => space && space.closed)) {
    syncFloorSpaces(floor);
  }
  removeUnreferencedNodes(floor);
  return touchDraft(next);
}

function buildWallProjectionCandidate(wall, start, end, projection, snapLine) {
  if (!projection) return null;
  return {
    wall,
    start,
    end,
    point: projection.point,
    t: projection.t,
    distanceMm: projection.distanceMm,
    snapLine
  };
}

function findNearestWallProjection(floor, point) {
  if (!floor || !point) return null;
  let best = null;
  floor.walls.forEach((wall) => {
    const start = getNode(floor, wall.startNodeId);
    const end = getNode(floor, wall.endNodeId);
    if (!start || !end) return;

    const candidates = [
      buildWallProjectionCandidate(
        wall,
        start,
        end,
        projectPointToWallSegment(point, start, end),
        'inner'
      )
    ];
    const segment = buildResolvedSegment(floor, wall);
    if (segment && segment.outerStart && segment.outerEnd) {
      candidates.push(buildWallProjectionCandidate(
        wall,
        start,
        end,
        projectPointToWallSegment(point, segment.outerStart, segment.outerEnd),
        'outer'
      ));
    }

    candidates.filter(Boolean).forEach((projection) => {
      if (!best || projection.distanceMm < best.distanceMm) {
        best = projection;
      }
    });
  });
  return best;
}

function findNearestOuterVertex(floor, point, maxDistanceMm) {
  if (!floor || !point) return null;
  const limit = typeof maxDistanceMm === 'number' ? maxDistanceMm : CLOSE_TOLERANCE_MM;
  let best = null;

  (floor.walls || []).forEach((wall) => {
    const geometry = buildWallRenderGeometry(floor, wall);
    if (!geometry) return;

    [
      { pointMm: geometry.outerStart, nodeId: wall.startNodeId, t: 0 },
      { pointMm: geometry.outerEnd, nodeId: wall.endNodeId, t: 1 }
    ].forEach((candidate) => {
      const node = getNode(floor, candidate.nodeId);
      if (!candidate.pointMm || !node) return;
      const candidateDistance = distanceMm(point, candidate.pointMm);
      if (candidateDistance > limit) return;
      if (!best || candidateDistance < best.distanceMm) {
        best = {
          type: 'vertex',
          pointMm: {
            xMm: Math.round(candidate.pointMm.xMm),
            yMm: Math.round(candidate.pointMm.yMm)
          },
          topologyPointMm: { xMm: node.xMm, yMm: node.yMm },
          nodeId: node.id,
          wallId: wall.id,
          snapLine: 'outer',
          t: candidate.t,
          distanceMm: candidateDistance
        };
      }
    });
  });

  return best;
}

function collectVertexAxisTargets(floor) {
  if (!floor) return [];
  const targets = [];
  const seen = new Set();
  const closedWallIds = new Set();
  (floor.spaces || []).forEach((space) => {
    if (!space || !space.closed || !Array.isArray(space.wallIds)) return;
    if (!buildClosedSpaceWallChain(floor, space.wallIds).length) return;
    space.wallIds.forEach((wallId) => closedWallIds.add(wallId));
  });

  const addTarget = (pointMm, nodeId, wallId, snapLine) => {
    if (!pointMm || !nodeId || !wallId) return;
    const roundedPoint = {
      xMm: Math.round(pointMm.xMm),
      yMm: Math.round(pointMm.yMm)
    };
    const key = `${roundedPoint.xMm}:${roundedPoint.yMm}:${nodeId}:${snapLine}`;
    if (seen.has(key)) return;
    seen.add(key);
    targets.push({
      pointMm: roundedPoint,
      nodeId,
      wallId,
      snapLine
    });
  };

  (floor.walls || []).forEach((wall) => {
    if (!closedWallIds.has(wall.id)) return;
    const start = getNode(floor, wall.startNodeId);
    const end = getNode(floor, wall.endNodeId);
    if (!start || !end) return;
    addTarget(start, start.id, wall.id, 'inner');
    addTarget(end, end.id, wall.id, 'inner');

    const geometry = buildWallRenderGeometry(floor, wall);
    if (!geometry) return;
    addTarget(geometry.outerStart, start.id, wall.id, 'outer');
    addTarget(geometry.outerEnd, end.id, wall.id, 'outer');
  });

  return targets;
}

function findNearestVertexAxisAlignment(floor, point, maxDistanceMm, preferredAxis) {
  if (!floor || !point) return null;
  const limit = typeof maxDistanceMm === 'number'
    ? maxDistanceMm
    : VERTEX_AXIS_SNAP_TOLERANCE_MM;
  const axes = preferredAxis === 'x' || preferredAxis === 'y'
    ? [preferredAxis]
    : ['x', 'y'];
  let best = null;

  collectVertexAxisTargets(floor).forEach((target) => {
    axes.forEach((axis) => {
      const axisKey = axis === 'x' ? 'xMm' : 'yMm';
      const perpendicularKey = axis === 'x' ? 'yMm' : 'xMm';
      const axisDistanceMm = Math.abs(point[axisKey] - target.pointMm[axisKey]);
      if (axisDistanceMm > limit) return;
      const perpendicularDistanceMm = Math.abs(
        point[perpendicularKey] - target.pointMm[perpendicularKey]
      );
      const candidate = Object.assign({}, target, {
        type: 'alignment',
        axis,
        axisDistanceMm,
        perpendicularDistanceMm,
        referencePoint: {
          xMm: target.pointMm.xMm,
          yMm: target.pointMm.yMm
        },
        pointMm: axis === 'x'
          ? { xMm: target.pointMm.xMm, yMm: Math.round(point.yMm) }
          : { xMm: Math.round(point.xMm), yMm: target.pointMm.yMm }
      });
      if (
        !best ||
        candidate.axisDistanceMm < best.axisDistanceMm ||
        (
          candidate.axisDistanceMm === best.axisDistanceMm &&
          candidate.perpendicularDistanceMm < best.perpendicularDistanceMm
        )
      ) {
        best = candidate;
      }
    });
  });

  return best;
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

function resolveInnerVertexPreferenceRadiusMm(floor, innerVertex, maxDistanceMm) {
  if (!floor || !innerVertex || !innerVertex.nodeId) return 0;
  const incidentThicknesses = (floor.walls || []).filter((wall) => (
    wall &&
    (wall.startNodeId === innerVertex.nodeId || wall.endNodeId === innerVertex.nodeId) &&
    !!findClosedSpaceForWall(floor, wall.id)
  )).map((wall) => Number(wall.thicknessMm) || DEFAULT_THICKNESS_MM);
  const radiusMm = incidentThicknesses.length
    ? Math.max(...incidentThicknesses)
    : DEFAULT_THICKNESS_MM;
  return Math.min(
    typeof maxDistanceMm === 'number' ? maxDistanceMm : CLOSE_TOLERANCE_MM,
    radiusMm
  );
}

function shouldPreferOuterVertex(floor, innerVertex, outerVertex, maxDistanceMm) {
  if (!outerVertex) return false;
  if (!innerVertex) return true;

  // Both visible corners of a normal wall fall inside the broad 350 mm touch
  // tolerance. Keep an inner corner stable throughout one wall-thickness
  // radius; the outer corner only wins in its own terminal band. This prevents
  // a finger or lens marker that still covers the selected inner vertex from
  // silently changing an adjacent-room start to outer-face semantics.
  const innerRadiusMm = resolveInnerVertexPreferenceRadiusMm(
    floor,
    innerVertex,
    maxDistanceMm
  );
  const outerTerminalBandMm = innerRadiusMm * 0.4;
  if (
    innerVertex.distanceMm <= innerRadiusMm &&
    outerVertex.distanceMm > outerTerminalBandMm
  ) {
    return false;
  }
  return outerVertex.distanceMm < innerVertex.distanceMm;
}

function findNearestSharedEndpointProjection(floor, point) {
  if (!floor || !point) return null;
  let best = null;

  (floor.walls || []).forEach((wall) => {
    const start = getNode(floor, wall.startNodeId);
    const end = getNode(floor, wall.endNodeId);
    if (!start || !end) return;

    [
      { node: start, t: 0 },
      { node: end, t: 1 }
    ].forEach((candidate) => {
      if (getNodeWallUseCount(floor, candidate.node.id) < 2) return;
      const candidateDistance = distanceMm(point, candidate.node);
      if (candidateDistance > CLOSE_TOLERANCE_MM) return;
      if (!best || candidateDistance < best.distanceMm) {
        best = {
          wall,
          start,
          end,
          point: { xMm: candidate.node.xMm, yMm: candidate.node.yMm },
          node: candidate.node,
          t: candidate.t,
          distanceMm: candidateDistance
        };
      }
    });
  });

  return best;
}

function findWallSnapProjection(floor, point) {
  return findNearestSharedEndpointProjection(floor, point) || findNearestWallProjection(floor, point);
}

function resolveLastWallReverseEdit(floor, session, anchor, endPoint) {
  if (!anchor || !endPoint) return null;

  const lastWallIndex = floor.walls.length - 1;
  const lastWall = floor.walls[lastWallIndex];
  if (!lastWall || lastWallIndex < session.activeSpaceStartWallIndex || lastWall.endNodeId !== anchor.id) {
    return null;
  }
  if (lastWall.status !== 'confirmed' || lastWall.mode !== session.mode ||
      Number(lastWall.thicknessMm) !== Number(session.thicknessMm) ||
      floor.openings.some((opening) => opening.wallId === lastWall.id)) {
    return null;
  }
  if (floor.spaces.some((space) => (
    space && space.closed && Array.isArray(space.wallIds) && space.wallIds.indexOf(lastWall.id) !== -1
  ))) {
    return null;
  }

  const anchorReferenceCount = floor.walls.reduce((count, wall) => (
    count + (wall.startNodeId === anchor.id ? 1 : 0) + (wall.endNodeId === anchor.id ? 1 : 0)
  ), 0);
  if (anchorReferenceCount !== 1) return null;

  const lastStart = getNode(floor, lastWall.startNodeId);
  const currentLength = lastStart ? distanceMm(lastStart, anchor) : 0;
  if (!lastStart || currentLength < MIN_WALL_LENGTH_MM) return null;

  const direction = {
    x: (anchor.xMm - lastStart.xMm) / currentLength,
    y: (anchor.yMm - lastStart.yMm) / currentLength
  };
  const shortenedLength = dot({
    x: endPoint.xMm - lastStart.xMm,
    y: endPoint.yMm - lastStart.yMm
  }, direction);
  const previousAngle = angleDeg(lastStart, anchor);
  const reverseAngle = angleDeg(anchor, endPoint);
  if (
    pointLineDistanceMm(endPoint, lastStart, direction) > WALL_OVERLAP_TOLERANCE_MM ||
    Math.abs(Math.abs(normalizeSignedAngle(reverseAngle - previousAngle)) - 180) >
      WALL_EXTENSION_DIRECTION_TOLERANCE_DEG
  ) {
    return null;
  }

  return { lastWall, lastWallIndex, lastStart, currentLength, shortenedLength };
}

function canShortenLastWall(reverseEdit) {
  return !!(
    reverseEdit &&
    reverseEdit.shortenedLength >= MIN_WALL_LENGTH_MM &&
    reverseEdit.shortenedLength < reverseEdit.currentLength - 1
  );
}

function canRetractLastWallToStart(reverseEdit, session) {
  return !!(
    reverseEdit &&
    reverseEdit.lastWallIndex > session.activeSpaceStartWallIndex &&
    Math.abs(reverseEdit.shortenedLength) <= WALL_OVERLAP_TOLERANCE_MM
  );
}

function isPreviewReverseEdit(draft) {
  const floor = getActiveFloor(draft);
  const session = floor && floor.session;
  const anchor = session && getNode(floor, session.anchorNodeId);
  if (!floor || !session || !anchor || !session.previewPoint) return false;
  const point = pointFromLength(anchor, session.previewPoint, Number(session.previewLengthMm) || 0,
    session.previewMeasurementStartInsetMm, session.previewMeasurementEndInsetMm,
    session.previewMeasurementStartExtensionMm);
  return !!resolveLastWallReverseEdit(floor, session, anchor, point);
}

function findTargetWallProjection(floor, point, target) {
  if (!floor || !point || !target || !target.wallId || !target.snapLine) return null;
  const wall = getWall(floor, target.wallId);
  if (!wall) return null;
  const start = getNode(floor, wall.startNodeId);
  const end = getNode(floor, wall.endNodeId);
  if (!start || !end) return null;

  if (
    target.snapLine === 'outer' &&
    target.nodeId &&
    (target.nodeId === wall.startNodeId || target.nodeId === wall.endNodeId)
  ) {
    const node = getNode(floor, target.nodeId);
    const geometry = buildWallRenderGeometry(floor, wall);
    const outerVertex = geometry && target.nodeId === wall.startNodeId
      ? geometry.outerStart
      : (geometry && geometry.outerEnd);
    if (!node || !outerVertex) return null;
    return {
      wall,
      start,
      end,
      point: { xMm: Math.round(outerVertex.xMm), yMm: Math.round(outerVertex.yMm) },
      node,
      t: target.nodeId === wall.startNodeId ? 0 : 1,
      distanceMm: distanceMm(point, outerVertex),
      snapLine: 'outer'
    };
  }

  if (target.snapLine === 'outer') {
    const segment = buildResolvedSegment(floor, wall);
    if (!segment || !segment.outerStart || !segment.outerEnd) return null;
    return buildWallProjectionCandidate(
      wall,
      start,
      end,
      projectPointToWallSegment(point, segment.outerStart, segment.outerEnd),
      'outer'
    );
  }

  return buildWallProjectionCandidate(
    wall,
    start,
    end,
    projectPointToWallSegment(point, start, end),
    'inner'
  );
}

function getWallSnapPoint(floor, point, maxDistanceMm) {
  const projection = findWallSnapProjection(floor, point);
  if (
    projection &&
    typeof maxDistanceMm === 'number' &&
    projection.distanceMm > maxDistanceMm
  ) {
    return null;
  }
  return projection ? projection.point : null;
}

/**
 * Resolve a new wall-chain cursor target without changing the graph.
 * Existing vertices intentionally win over a nearby wall segment so users can
 * reliably restart a room from a measured corner.
 */
function getCursorPlacementTarget(floor, point, maxDistanceMm) {
  if (!floor || !point) {
    return { type: 'none', pointMm: null, distanceMm: Infinity };
  }

  const freeTarget = {
    type: 'free',
    pointMm: { xMm: Math.round(point.xMm), yMm: Math.round(point.yMm) },
    distanceMm: 0
  };
  if (!Array.isArray(floor.walls) || !floor.walls.length) return freeTarget;

  const limit = typeof maxDistanceMm === 'number' ? maxDistanceMm : CLOSE_TOLERANCE_MM;
  const wallNodeIds = new Set();
  (floor.walls || []).forEach((wall) => {
    wallNodeIds.add(wall.startNodeId);
    wallNodeIds.add(wall.endNodeId);
  });
  let nearestVertex = null;
  (floor.nodes || []).forEach((node) => {
    if (!wallNodeIds.has(node.id)) return;
    const candidateDistance = distanceMm(point, node);
    if (candidateDistance > limit) return;
    if (!nearestVertex || candidateDistance < nearestVertex.distanceMm) {
      nearestVertex = {
        type: 'vertex',
        pointMm: { xMm: node.xMm, yMm: node.yMm },
        nodeId: node.id,
        distanceMm: candidateDistance
      };
    }
  });

  const nearestOuterVertex = findNearestOuterVertex(floor, point, limit);
  if (shouldPreferOuterVertex(floor, nearestVertex, nearestOuterVertex, limit)) {
    nearestVertex = nearestOuterVertex;
  }

  const projection = findNearestWallProjection(floor, point);
  const innerVertexPreferenceRadiusMm = nearestVertex && !nearestVertex.snapLine
    ? resolveInnerVertexPreferenceRadiusMm(floor, nearestVertex, limit)
    : 0;
  const outerProjectionWins = nearestVertex && projection &&
    projection.snapLine === 'outer' &&
    projection.distanceMm <= limit &&
    nearestVertex.distanceMm > innerVertexPreferenceRadiusMm &&
    projection.distanceMm < nearestVertex.distanceMm;
  if (nearestVertex && !outerProjectionWins) return nearestVertex;

  if (!projection || projection.distanceMm > limit) {
    const alignment = findNearestVertexAxisAlignment(floor, point, limit);
    return alignment || freeTarget;
  }

  return {
    type: 'wall',
    pointMm: projection.point,
    wallId: projection.wall && projection.wall.id,
    snapLine: projection.snapLine || 'inner',
    distanceMm: projection.distanceMm
  };
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

function getCursorDisplayPoint(floor, session) {
  if (!floor || !session || !session.anchorNodeId) return null;

  const anchor = getNode(floor, session.anchorNodeId);
  const startWallIndex = Number.isInteger(session.activeSpaceStartWallIndex)
    ? session.activeSpaceStartWallIndex
    : 0;
  const activeWallCount = Math.max(0, (floor.walls || []).length - startWallIndex);
  const isOuterTChain = session.activeSpaceSharedWallMiddle &&
    session.activeSpaceSharedSnapLine === 'outer';

  // Once a branch is being drawn, the cursor follows its graph-side working
  // face. Inner/outer only chooses the near/far start on the source boundary;
  // applying it again to the branch endpoint would shift the cursor sideways
  // by one wall thickness as soon as the operator drags the next segment.
  if (session.previewPoint) return session.previewPoint;

  if (isOuterTChain && activeWallCount > 0) {
    const lastWall = (floor.walls || [])[floor.walls.length - 1] || null;
    const geometry = lastWall ? buildWallRenderGeometry(floor, lastWall) : null;
    if (geometry) {
      return geometry.end;
    }
  }

  if (
    anchor &&
    activeWallCount === 0 &&
    session.activeSpaceSharedSnapLine === 'outer' &&
    session.activeSpaceSharedWallId &&
    typeof session.activeSpaceSharedStartT === 'number'
  ) {
    const wall = getWall(floor, session.activeSpaceSharedWallId);
    const geometry = wall ? buildWallRenderGeometry(floor, wall) : null;
    if (geometry && geometry.outerStart && geometry.outerEnd) {
      const t = clampNumber(session.activeSpaceSharedStartT, 0, 1);
      return {
        xMm: Math.round(geometry.outerStart.xMm + (geometry.outerEnd.xMm - geometry.outerStart.xMm) * t),
        yMm: Math.round(geometry.outerStart.yMm + (geometry.outerEnd.yMm - geometry.outerStart.yMm) * t)
      };
    }
  }
  return anchor || null;
}

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

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function setMode(draft, mode) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  if (mode !== 'straight' && mode !== 'diagonal') return next;
  floor.session.mode = mode;
  delete floor.session.bleLockedBearingDeg;
  return touchDraft(next);
}

function placeCursor(draft, point) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const session = ensureSessionSpaceTracking(floor);

  if (floor.walls.length) {
    const endNode = getLastEndNode(floor);
    session.anchorNodeId = endNode ? endNode.id : '';
  } else if (session.anchorNodeId) {
    const anchor = getNode(floor, session.anchorNodeId);
    if (anchor) {
      anchor.xMm = Math.round(point.xMm);
      anchor.yMm = Math.round(point.yMm);
    }
  } else {
    const node = addNode(floor, point);
    session.anchorNodeId = node.id;
  }

  session.state = floor.walls.length ? SESSION_STATES.WALL_COMMITTED : SESSION_STATES.CURSOR_PLACED;
  session.previewPoint = null;
  session.previewLengthMm = 0;
  session.previewAngleDeg = 0;
  delete session.bleLockedBearingDeg;
  session.selectedWallId = '';
  session.selectedOpeningId = '';
  session.closeCandidateNodeId = '';
  session.closeCandidatePoint = null;
  session.closeCandidateType = '';
  session.closeCandidateSharedWallId = '';
  session.alignmentSnapGuide = null;
  session.activeSpaceStartNodeId = '';
  session.activeSpaceStartWallIndex = floor.walls.length;
  session.activeSpaceSharedWallId = '';
  session.activeSpaceSharedStartT = null;
  session.activeSpaceSharedSnapLine = '';
  return touchDraft(next);
}

function startPreview(draft, rawPoint) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const session = ensureSessionSpaceTracking(floor);
  let anchor = getNode(floor, session.anchorNodeId);

  if (!anchor) {
    anchor = addNode(floor, rawPoint);
    session.anchorNodeId = anchor.id;
  }

  const orthogonalPoint = snapPreviewPoint(anchor, rawPoint, session.mode);
  const directionSnap = maybeSnapToPreviousDiagonalDirection(floor, session, anchor, orthogonalPoint);
  const rectangleSnap = maybeSnapThirdWallForRectangle(floor, session, anchor, directionSnap.point);
  const resetClosureSnap = maybeSnapResetChainForRectangleClosure(
    floor,
    session,
    anchor,
    rectangleSnap.point
  );
  const vertexAxisSnap = resetClosureSnap.guide || rectangleSnap.guide
    ? { point: resetClosureSnap.point, guide: null }
    : maybeSnapStraightPreviewToVertexAxis(
      floor,
      session,
      anchor,
      resetClosureSnap.point
    );
  const directStartClosureSnap = maybeSnapStraightClosureToStart(
    floor,
    session,
    anchor,
    rawPoint,
    vertexAxisSnap.point
  );
  let previewPoint = directStartClosureSnap.point;
  const rayIntersection = findRayWallIntersection(floor, session, anchor, previewPoint);
  let rawOuterFaceProjection = findOuterFaceClosureProjection(floor, session, rawPoint);
  if (rayIntersection) {
    const distToAnchor = distanceMm(anchor, previewPoint);
    if (distToAnchor > rayIntersection.distanceMm) {
      previewPoint = constrainStraightSnapPoint(
        session,
        anchor,
        rayIntersection.point,
        previewPoint
      );
    }
  }
  if (rayIntersection && rawOuterFaceProjection) {
    const rawProjDist = distanceMm(anchor, rawOuterFaceProjection.point);
    if (rawProjDist > rayIntersection.distanceMm + CLOSE_TOLERANCE_MM) {
      rawOuterFaceProjection = null;
    }
  }
  if (!rawOuterFaceProjection && rayIntersection && rayIntersection.snapLine === 'outer') {
    const distToAnchor = distanceMm(anchor, previewPoint);
    if (distToAnchor >= rayIntersection.distanceMm - CLOSE_TOLERANCE_MM) {
      rawOuterFaceProjection = findOuterFaceClosureProjection(floor, session, rayIntersection.point, rayIntersection.wall.id);
    }
  }

  if (rawOuterFaceProjection && session.mode === 'straight') {
    const outerDx = Math.abs(rawOuterFaceProjection.end.xMm - rawOuterFaceProjection.start.xMm);
    const outerDy = Math.abs(rawOuterFaceProjection.end.yMm - rawOuterFaceProjection.start.yMm);
    const faceAlignedPoint = outerDx >= outerDy
      ? { xMm: previewPoint.xMm, yMm: rawOuterFaceProjection.point.yMm }
      : { xMm: rawOuterFaceProjection.point.xMm, yMm: previewPoint.yMm };
    // Keep the physical outer face as the eventual contact/closure target, but
    // preserve an along-face endpoint snap only while the result remains on the
    // current straight axis. Never copy an off-axis wall-thickness offset onto
    // the orange preview; confirmClosure bridges that remaining gap instead.
    previewPoint = constrainStraightSnapPoint(
      session,
      anchor,
      faceAlignedPoint,
      previewPoint
    );
  } else if (rayIntersection) {
    const distToAnchor = distanceMm(anchor, previewPoint);
    if (distToAnchor > rayIntersection.distanceMm) {
      previewPoint = constrainStraightSnapPoint(
        session,
        anchor,
        rayIntersection.point,
        previewPoint
      );
    }
  }
  session.previewOuterFaceWallId = rawOuterFaceProjection ? rawOuterFaceProjection.wall.id : '';
  const partitionProjection = findPartitionClosureProjection(
    floor,
    session,
    anchor,
    previewPoint
  );
  if (partitionProjection) {
    previewPoint = constrainStraightSnapPoint(
      session,
      anchor,
      partitionProjection.point,
      previewPoint
    );
  }
  let previewMeasurementStartInsetMm = resolvePreviewMeasurementStartInsetMm(
    floor,
    session,
    anchor,
    previewPoint
  );
  const continuationStartAdjustment = resolveOuterTContinuationStartAdjustment(
    floor,
    session,
    anchor,
    previewPoint
  );
  if (continuationStartAdjustment.insetMm || continuationStartAdjustment.extensionMm) {
    previewMeasurementStartInsetMm = continuationStartAdjustment.insetMm;
  }
  let previewMeasurementStartExtensionMm = continuationStartAdjustment.extensionMm;
  let previewMeasurementEndInsetMm = 0;
  let previewLengthMm = calculateMeasuredPreviewLength(
    anchor,
    previewPoint,
    previewMeasurementStartInsetMm,
    previewMeasurementEndInsetMm,
    previewMeasurementStartExtensionMm
  );
  const inferredMeasurementSide = resolveBoundaryAlignedMeasurementSide(
    floor,
    session,
    anchor,
    previewPoint
  );
  const activeWallCount = Math.max(0, floor.walls.length - session.activeSpaceStartWallIndex);
  const lastWall = activeWallCount > 0 ? (floor.walls || [])[floor.walls.length - 1] : null;
  if (
    session.measurementSideUserSet &&
    lastWall &&
    (lastWall.bodyNormalSide === 'left' || lastWall.bodyNormalSide === 'right')
  ) {
    session.previewBodyNormalSide = lastWall.bodyNormalSide;
  }
  let previewMeasurementSide = inferredMeasurementSide;
  if (
    session.measurementSideUserSet &&
    (session.previewMeasurementSide === 'left' || session.previewMeasurementSide === 'right')
  ) {
    previewMeasurementSide = session.previewMeasurementSide;
  } else if (
    session.measurementSideUserSet &&
    (session.measurementSide === 'left' || session.measurementSide === 'right')
  ) {
    previewMeasurementSide = session.measurementSide;
  } else if (activeWallCount === 0 && session.activeSpaceSharedWallId) {
    session.measurementSide = previewMeasurementSide;
  }

  session.state = SESSION_STATES.WALL_PREVIEW;
  session.previewPoint = previewPoint;
  session.previewLengthMm = previewLengthMm;
  session.previewAngleDeg = angleDeg(anchor, previewPoint);
  session.previewAngleSource = '';
  session.previewInteriorAngleDeg = null;
  session.previewMeasurementSide = previewMeasurementSide;
  session.previewMeasurementStartInsetMm = previewMeasurementStartInsetMm;
  session.previewMeasurementStartExtensionMm = previewMeasurementStartExtensionMm;
  session.previewMeasurementEndInsetMm = previewMeasurementEndInsetMm;
  session.pendingWallId = '';
  session.selectedWallId = '';
  session.selectedOpeningId = '';
  session.closeCandidateNodeId = '';
  session.closeCandidatePoint = null;
  session.closeCandidateType = '';
  session.closeCandidateSharedWallId = '';
  session.partitionSourceSpaceId = partitionProjection ? partitionProjection.sourceSpace.id : '';
  session.alignmentSnapGuide = directStartClosureSnap.guide || resetClosureSnap.guide ||
    rectangleSnap.guide || vertexAxisSnap.guide || directionSnap.guide;

  const activeStartNode = getNode(floor, session.activeSpaceStartNodeId) || getFirstNode(floor);
  const directCloseWallCount = getMinimumDirectBoundaryCloseWallCount(floor, session);
  const inferredMergeWallCount = getMinimumClosureSuggestionWallCount(floor, session);
  let outerFaceProjection = null;
  let sharedProjection = null;
  let reversePreviewEdit = null;
  let reverseSharedWallClose = false;
  if (activeStartNode && activeWallCount + 1 >= directCloseWallCount) {
    // A final drag can land on the visible outer face of a perpendicular
    // closed wall. That is not the same topology point as the wall centre:
    // forcing it onto the centre line turns the visible vertical orange edge
    // into a diagonal/shared closure and later adds a wall thickness outward.
    outerFaceProjection = rawOuterFaceProjection || findOuterFaceClosureProjection(floor, session, previewPoint);
    sharedProjection = outerFaceProjection
      ? null
      : findAnySharedWallClosureProjection(floor, session, previewPoint);
    if (outerFaceProjection) {
      reversePreviewEdit = resolveLastWallReverseEdit(floor, session, anchor, previewPoint);
    } else if (sharedProjection) {
      if (
        session.mode === 'straight' &&
        sharedProjection.node &&
        (
          sharedProjection.snapsToTopologyEndpoint ||
          distanceMm(previewPoint, sharedProjection.point) <= CLOSE_TOLERANCE_MM
        )
      ) {
        // Keep the orange preview on-axis. Copying an off-axis topology corner
        // here turns a straight wall into a diagonal; confirmClosure bridges
        // the remaining thickness gap after the orthogonal wall is committed.
        previewPoint = constrainStraightSnapPoint(
          session,
          anchor,
          sharedProjection.point,
          previewPoint
        );
        previewMeasurementStartInsetMm = resolvePreviewMeasurementStartInsetMm(
          floor,
          session,
          anchor,
          previewPoint
        );
        const snappedStartAdjustment = resolveOuterTContinuationStartAdjustment(
          floor,
          session,
          anchor,
          previewPoint
        );
        if (snappedStartAdjustment.insetMm || snappedStartAdjustment.extensionMm) {
          previewMeasurementStartInsetMm = snappedStartAdjustment.insetMm;
          previewMeasurementStartExtensionMm = snappedStartAdjustment.extensionMm;
        }
        if (!session.measurementSideUserSet) {
          previewMeasurementSide = resolveBoundaryAlignedMeasurementSide(
            floor,
            session,
            anchor,
            previewPoint
          );
          session.previewMeasurementSide = previewMeasurementSide;
        }
        session.previewPoint = previewPoint;
        session.previewLengthMm = previewLengthMm;
        session.previewAngleDeg = angleDeg(anchor, previewPoint);
        if (!session.alignmentSnapGuide && distanceMm(previewPoint, rawPoint) > 0) {
          session.alignmentSnapGuide = {
            type: 'rectangle-third-wall',
            direction: isHorizontalSegment(anchor, previewPoint) ? 'vertical' : 'horizontal',
            referencePoint: { xMm: sharedProjection.node.xMm, yMm: sharedProjection.node.yMm },
            snappedPoint: { xMm: previewPoint.xMm, yMm: previewPoint.yMm }
          };
        }
      }
      previewMeasurementEndInsetMm = resolveSharedClosureEndInsetMm(
        floor,
        session,
        anchor,
        previewPoint,
        sharedProjection.wall.id
      );
    } else {
      reverseSharedWallClose = !!(session.activeSpaceSharedWallId &&
        resolveLastWallReverseEdit(floor, session, anchor, previewPoint));
    }
  }
  applyClosureCandidatePlan(session, planPreviewClosureCandidate(floor, session, {
    anchor, previewPoint, activeStartNode, activeWallCount,
    directCloseWallCount, inferredMergeWallCount, outerFaceProjection,
    sharedProjection, reversePreviewEdit, reverseSharedWallClose, partitionProjection
  }));

  session.previewMeasurementStartInsetMm = previewMeasurementStartInsetMm;
  session.previewMeasurementStartExtensionMm = previewMeasurementStartExtensionMm;
  session.previewMeasurementEndInsetMm = previewMeasurementEndInsetMm;
  session.previewLengthMm = calculateMeasuredPreviewLength(
    anchor,
    previewPoint,
    previewMeasurementStartInsetMm,
    previewMeasurementEndInsetMm,
    previewMeasurementStartExtensionMm
  );

  return touchDraft(next);
}

function isOrthogonalBearing(bearingDeg) {
  const normalized = normalizeSignedAngle(Number(bearingDeg));
  const mod90 = Math.abs(normalized % 90);
  return mod90 < 1 || Math.abs(mod90 - 90) < 1;
}

function clearBleDirectionPreview(session) {
  if (!session) return;
  session.previewPoint = null;
  session.previewLengthMm = 0;
  session.previewAngleDeg = 0;
  session.previewAngleSource = '';
  session.previewInteriorAngleDeg = null;
  session.previewMeasurementSide = '';
  session.previewMeasurementStartInsetMm = 0;
  session.previewMeasurementStartExtensionMm = 0;
  session.previewMeasurementEndInsetMm = 0;
  session.previewOuterFaceWallId = '';
  session.previewBodyNormalSide = '';
  session.closeCandidateNodeId = '';
  session.closeCandidatePoint = null;
  session.closeCandidateType = '';
  session.closeCandidateSharedWallId = '';
  session.partitionSourceSpaceId = '';
  session.alignmentSnapGuide = null;
  session.pendingWallId = '';
}

function hasBleLockedBearing(session) {
  if (!session) return false;
  const value = session.bleLockedBearingDeg;
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}

function materializeLockedPreview(draft) {
  const floor = getActiveFloor(draft);
  const session = floor && floor.session;
  if (!hasBleLockedBearing(session) || session.previewPoint) {
    return draft;
  }
  let next = startPreviewFromBearing(draft, Number(session.bleLockedBearingDeg));
  next = holdPreviewForInput(next);
  return next;
}

function lockPreviewBearing(draft, bearingDeg) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const session = ensureSessionSpaceTracking(floor);
  const anchor = getNode(floor, session.anchorNodeId);

  if (!anchor) {
    throw createSurveyDomainError(DOMAIN_ERROR_CODES.CURSOR_REQUIRED_FOR_DIRECTION);
  }
  if (session.mode !== 'straight') {
    throw createSurveyDomainError(DOMAIN_ERROR_CODES.STRAIGHT_MODE_REQUIRED_FOR_DIRECTION);
  }

  const normalizedBearing = normalizeAngle(Number(bearingDeg));
  if (!Number.isFinite(normalizedBearing) || !isOrthogonalBearing(normalizedBearing)) {
    throw createSurveyDomainError(DOMAIN_ERROR_CODES.ORTHOGONAL_DIRECTION_REQUIRED);
  }

  clearBleDirectionPreview(session);
  session.bleLockedBearingDeg = normalizedBearing;
  session.state = SESSION_STATES.AWAITING_LENGTH;
  return touchDraft(next);
}

function clearBleLockedBearing(draft) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const session = floor && floor.session;
  if (!session || !Object.prototype.hasOwnProperty.call(session, 'bleLockedBearingDeg')) {
    return next;
  }
  delete session.bleLockedBearingDeg;
  if (!session.previewPoint && session.state === SESSION_STATES.AWAITING_LENGTH) {
    if (floor.walls.length) {
      session.state = SESSION_STATES.WALL_COMMITTED;
    } else if (session.anchorNodeId) {
      session.state = SESSION_STATES.CURSOR_PLACED;
    } else {
      session.state = SESSION_STATES.IDLE;
    }
  }
  return touchDraft(next);
}

function startPreviewFromBearing(draft, bearingDeg, options) {
  const opts = options || {};
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const session = ensureSessionSpaceTracking(floor);
  const anchor = getNode(floor, session.anchorNodeId);

  if (!anchor) {
    throw createSurveyDomainError(DOMAIN_ERROR_CODES.CURSOR_REQUIRED_FOR_DIRECTION);
  }
  if (session.mode !== 'straight') {
    throw createSurveyDomainError(DOMAIN_ERROR_CODES.STRAIGHT_MODE_REQUIRED_FOR_DIRECTION);
  }

  const normalizedBearing = normalizeAngle(Number(bearingDeg));
  if (!Number.isFinite(normalizedBearing) || !isOrthogonalBearing(normalizedBearing)) {
    throw createSurveyDomainError(DOMAIN_ERROR_CODES.ORTHOGONAL_DIRECTION_REQUIRED);
  }

  const requestedStubLengthMm = Number(opts.stubLengthMm);
  const stubLengthMm = Number.isFinite(requestedStubLengthMm) && requestedStubLengthMm >= MIN_WALL_LENGTH_MM
    ? Math.round(requestedStubLengthMm)
    : (
      session.previewLengthMm >= MIN_WALL_LENGTH_MM
        ? session.previewLengthMm
        : MIN_WALL_LENGTH_MM
    );

  const radians = normalizedBearing * Math.PI / 180;
  const rawPoint = {
    xMm: Math.round(anchor.xMm + Math.cos(radians) * stubLengthMm),
    yMm: Math.round(anchor.yMm + Math.sin(radians) * stubLengthMm)
  };

  return startPreview(next, rawPoint);
}

function holdPreviewForInput(draft) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const session = floor.session;

  if (session.state !== SESSION_STATES.WALL_PREVIEW || !session.previewPoint || session.previewLengthMm < MIN_WALL_LENGTH_MM) {
    return next;
  }

  session.state = SESSION_STATES.AWAITING_LENGTH;
  return touchDraft(next);
}

function applyPreviewInteriorAngle(draft, interiorAngleDeg, source) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const session = ensureSessionSpaceTracking(floor);
  const anchor = getNode(floor, session.anchorNodeId);
  const incomingWall = getIncomingWallAtAnchor(floor, session.anchorNodeId);
  const incomingAngle = getIncomingAngleAtAnchor(floor, incomingWall, session.anchorNodeId);
  const angle = validateInteriorAngle(interiorAngleDeg);

  if (!anchor || !session.previewPoint || !session.previewLengthMm || session.mode !== 'diagonal' || incomingAngle === null) {
    throw createSurveyDomainError(DOMAIN_ERROR_CODES.DIAGONAL_PREVIEW_REQUIRED);
  }

  const currentAngle = angleDeg(anchor, session.previewPoint);
  const turn = normalizeSignedAngle(currentAngle - incomingAngle);
  const turnSign = turn < 0 ? -1 : 1;
  const outgoingAngle = incomingAngle + turnSign * (180 - angle);
  const radians = outgoingAngle * Math.PI / 180;
  const nextPoint = {
    xMm: Math.round(anchor.xMm + Math.cos(radians) * session.previewLengthMm),
    yMm: Math.round(anchor.yMm + Math.sin(radians) * session.previewLengthMm)
  };

  const previewed = startPreview(next, nextPoint);
  const previewSession = getActiveFloor(previewed).session;
  previewSession.state = SESSION_STATES.AWAITING_LENGTH;
  previewSession.previewAngleSource = source || 'manual';
  previewSession.previewInteriorAngleDeg = angle;
  return touchDraft(previewed);
}

function reopenLastDiagonalWallForAngle(draft) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const session = ensureSessionSpaceTracking(floor);
  const lastWall = floor.walls[floor.walls.length - 1];
  const hasAttachedOpening = lastWall && floor.openings.some((opening) => opening.wallId === lastWall.id);

  if (!lastWall || lastWall.mode !== 'diagonal' || floor.walls.length < 2 ||
    session.state !== SESSION_STATES.WALL_COMMITTED || session.previewPoint || hasAttachedOpening) {
    throw createSurveyDomainError(DOMAIN_ERROR_CODES.LATEST_DIAGONAL_NOT_EDITABLE);
  }

  const start = getNode(floor, lastWall.startNodeId);
  const end = getNode(floor, lastWall.endNodeId);
  if (!start || !end) {
    throw createSurveyDomainError(DOMAIN_ERROR_CODES.LATEST_DIAGONAL_INCOMPLETE);
  }

  floor.walls.pop();
  if (!floor.walls.some((wall) => wall.startNodeId === end.id || wall.endNodeId === end.id)) {
    floor.nodes = floor.nodes.filter((node) => node.id !== end.id);
  }
  session.anchorNodeId = start.id;
  session.mode = 'diagonal';
  session.state = SESSION_STATES.AWAITING_LENGTH;
  session.previewPoint = { xMm: end.xMm, yMm: end.yMm };
  session.previewLengthMm = lastWall.lengthMm;
  session.previewAngleDeg = lastWall.angleDeg;
  session.previewAngleSource = lastWall.angleSource || 'manual';
  session.previewInteriorAngleDeg = Number.isFinite(lastWall.angleInteriorDeg)
    ? lastWall.angleInteriorDeg
    : null;
  session.previewMeasurementSide = lastWall.measurementSide || session.measurementSide;
  session.previewMeasurementStartInsetMm = normalizeMeasurementInset(
    lastWall.measurementStartInsetMm
  );
  session.previewMeasurementStartExtensionMm = normalizeMeasurementExtension(
    lastWall.measurementStartExtensionMm
  );
  session.previewMeasurementEndInsetMm = normalizeMeasurementInset(
    lastWall.measurementEndInsetMm
  );
  session.pendingWallId = '';
  session.selectedWallId = '';
  session.selectedOpeningId = '';
  session.closeCandidateNodeId = '';
  session.closeCandidatePoint = null;
  session.closeCandidateType = '';
  session.closeCandidateSharedWallId = '';
  session.alignmentSnapGuide = null;

  return touchDraft(next);
}

function cancelPending(draft) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const session = ensureSessionSpaceTracking(floor);
  const selectedCursorAnchorId = session.state === SESSION_STATES.WALL_SELECTED
    ? session.anchorNodeId
    : '';
  const selectedCursorWasNewChainStart = !!selectedCursorAnchorId &&
    Number.isInteger(session.activeSpaceStartWallIndex) &&
    session.activeSpaceStartWallIndex >= floor.walls.length;

  session.previewPoint = null;
  session.previewLengthMm = 0;
  session.previewAngleDeg = 0;
  session.previewMeasurementSide = '';
  session.previewMeasurementStartInsetMm = 0;
  session.previewMeasurementStartExtensionMm = 0;
  session.previewMeasurementEndInsetMm = 0;
  session.previewAngleSource = '';
  session.previewInteriorAngleDeg = null;
  delete session.bleLockedBearingDeg;
  session.pendingWallId = '';
  session.closeCandidateNodeId = '';
  session.closeCandidatePoint = null;
  session.closeCandidateType = '';
  session.closeCandidateSharedWallId = '';
  session.alignmentSnapGuide = null;
  session.selectedWallId = '';
  session.selectedOpeningId = '';
  session.selectedSpaceId = '';
  session.fixedNodeId = '';

  if (selectedCursorAnchorId && getNode(floor, selectedCursorAnchorId)) {
    session.anchorNodeId = selectedCursorAnchorId;
    session.state = selectedCursorWasNewChainStart ? SESSION_STATES.CURSOR_PLACED : SESSION_STATES.WALL_COMMITTED;
  } else if (floor.spaces.some((space) => space.closed)) {
    session.state = SESSION_STATES.SPACE_CLOSED;
    session.anchorNodeId = '';
  } else if (floor.walls.length) {
    const lastEnd = getLastEndNode(floor);
    session.state = SESSION_STATES.WALL_COMMITTED;
    session.anchorNodeId = lastEnd ? lastEnd.id : '';
  } else if (session.anchorNodeId) {
    session.state = SESSION_STATES.CURSOR_PLACED;
  } else {
    session.state = SESSION_STATES.IDLE;
  }

  return touchDraft(next);
}

function commitPreviewLength(draft, lengthMm, inputSource) {
  const parsedLength = validateLength(lengthMm);
  let sourceDraft = draft;
  const preFloor = getActiveFloor(sourceDraft);
  const preSession = preFloor && preFloor.session;
  if (
    preSession &&
    hasBleLockedBearing(preSession) &&
    !preSession.previewPoint
  ) {
    sourceDraft = materializeLockedPreview(sourceDraft);
  }
  const next = cloneDraft(sourceDraft);
  const floor = getActiveFloor(next);
  const session = ensureSessionSpaceTracking(floor);
  const anchor = getNode(floor, session.anchorNodeId);

  if (!anchor || !session.previewPoint || (session.state !== SESSION_STATES.AWAITING_LENGTH && session.state !== SESSION_STATES.WALL_PREVIEW)) {
    throw createSurveyDomainError(DOMAIN_ERROR_CODES.WALL_PREVIEW_REQUIRED);
  }

  let endPoint = pointFromLength(
    anchor,
    session.previewPoint,
    parsedLength,
    session.previewMeasurementStartInsetMm,
    session.previewMeasurementEndInsetMm,
    session.previewMeasurementStartExtensionMm
  );
  const measuredEndPoint = endPoint;
  // Resolve an in-segment reverse drag against the operator's measured point
  // before rectangle/vertex/closure helpers can redirect it to a nearby wall.
  const reverseEdit = resolveLastWallReverseEdit(floor, session, anchor, measuredEndPoint);
  const shortenLastWall = canShortenLastWall(reverseEdit);
  const retractLastWall = canRetractLastWallToStart(reverseEdit, session);
  if (retractLastWall) {
    return deleteWall(next, reverseEdit.lastWall.id);
  }
  const preservesOuterTWorkingLength = session.activeSpaceSharedWallMiddle &&
    session.activeSpaceSharedSnapLine === 'outer' &&
    (
      normalizeMeasurementInset(session.previewMeasurementStartInsetMm) > 0 ||
      normalizeMeasurementExtension(session.previewMeasurementStartExtensionMm) > 0
    );
  // Length confirmation (manual or BLE) rebuilds the endpoint from the
  // measured value. Reapply rectangle/closure snapping here so confirmation
  // cannot silently discard a snap that was visible during the drag preview.
  const confirmedRectangleSnap = shortenLastWall
    ? { point: measuredEndPoint, guide: null }
    : maybeSnapThirdWallForRectangle(floor, session, anchor, endPoint);
  const confirmedResetClosureSnap = maybeSnapResetChainForRectangleClosure(
    floor,
    session,
    anchor,
    confirmedRectangleSnap.point
  );
  const confirmedVertexAxisSnap = confirmedResetClosureSnap.guide || confirmedRectangleSnap.guide
    ? { point: confirmedResetClosureSnap.point, guide: null }
    : maybeSnapStraightPreviewToVertexAxis(
      floor,
      session,
      anchor,
      confirmedResetClosureSnap.point
    );
  endPoint = (preservesOuterTWorkingLength || shortenLastWall)
    ? measuredEndPoint
    : confirmedVertexAxisSnap.point;
  const activeStartNode = getNode(floor, session.activeSpaceStartNodeId) || getFirstNode(floor);
  const activeWallCountBeforeCommit = Math.max(0, floor.walls.length - session.activeSpaceStartWallIndex);
  const canCloseWithSharedBoundary = activeWallCountBeforeCommit + 1 >=
    getMinimumDirectBoundaryCloseWallCount(floor, session);
  // Pre-clamp endPoint to any intersecting existing wall BEFORE running closure
  // projection search. This prevents an overshoot (e.g. user types a length
  // greater than the actual distance to the shared boundary) from pushing the
  // endpoint outside the close-tolerance window, which would cause
  // findAnySharedWallClosureProjection to miss the target and leave a dangling
  // node ("形成末节"). Store the ray hit so it can serve as a synthetic
  // shared-wall closure when no activeSpaceSharedWallId context exists.
  let earlyRayHit = null;
  if (!shortenLastWall && !preservesOuterTWorkingLength) {
    const candidate = findRayWallIntersection(floor, session, anchor, endPoint);
    if (candidate && distanceMm(anchor, endPoint) > candidate.distanceMm + 1) {
      earlyRayHit = candidate;
      endPoint = constrainStraightSnapPoint(session, anchor, candidate.point, endPoint);
    }
  }
  const outerFaceProjection = canCloseWithSharedBoundary && !shortenLastWall
    ? findOuterFaceClosureProjection(
      floor,
      session,
      endPoint,
      session.previewOuterFaceWallId || ''
    )
    : null;
  const sharedProjection = canCloseWithSharedBoundary && !shortenLastWall && !outerFaceProjection
    ? findAnySharedWallClosureProjection(floor, session, endPoint)
    : null;
  const partitionProjection = shortenLastWall
    ? null
    : findPartitionClosureProjection(floor, session, anchor, endPoint);
  let closureProjection = partitionProjection || sharedProjection;
  // If no closure was found via normal shared-wall search (no activeSpaceSharedWallId
  // context — e.g. drawing from empty space into an existing closed room), but the
  // endpoint was already clamped to a wall intersection, synthesize a shared-wall
  // closure projection from the stored ray hit.
  let rayFallbackProjection = null;
  if (!closureProjection && !outerFaceProjection && earlyRayHit) {
    const hitStart = getNode(floor, earlyRayHit.wall.startNodeId);
    const hitEnd = getNode(floor, earlyRayHit.wall.endNodeId);
    rayFallbackProjection = {
      wall: earlyRayHit.wall,
      start: hitStart,
      end: hitEnd,
      point: earlyRayHit.point,
      t: earlyRayHit.u,
      node: earlyRayHit.u <= 0.0001 ? hitStart : earlyRayHit.u >= 0.9999 ? hitEnd : null,
      snapLine: 'inner',
      distanceMm: 0
    };
    closureProjection = rayFallbackProjection;
  }
  const canCloseAtActiveStart = !!(
    session.mode === 'straight' &&
    activeStartNode &&
    activeWallCountBeforeCommit >= 3 &&
    canResolvePreviewStartClosure(
      floor,
      session,
      anchor,
      endPoint,
      activeStartNode,
      { allowRejectedCandidate: true }
    )
  );
  const isClosingCurrentSpace = activeStartNode &&
    (activeWallCountBeforeCommit >= 2 || !!closureProjection || !!outerFaceProjection) &&
    (closureProjection || outerFaceProjection || canCloseAtActiveStart);
  if (closureProjection) {
    // Straight mode may change at most one axis. Never copy an off-axis
    // topology endpoint onto the confirmed wall; confirmClosure adds a short
    // orthogonal bridge for the remaining thickness gap.
    const constrainedEndPoint = constrainStraightSnapPoint(
      session,
      anchor,
      closureProjection.point,
      endPoint
    );
    if (distanceMm(constrainedEndPoint, closureProjection.point) > 1) {
      closureProjection = Object.assign({}, closureProjection, {
        point: constrainedEndPoint,
        node: null,
        // Force getOrCreateSnapNode to keep the on-axis working point instead of
        // falling back through a stale endpoint parameter (t=0/1).
        t: 0.5,
        snapsToTopologyEndpoint: false
      });
    }
    endPoint = constrainedEndPoint;
  }
  const measurementStartInsetMm = normalizeMeasurementInset(
    session.previewMeasurementStartInsetMm
  );
  const measurementStartExtensionMm = normalizeMeasurementExtension(
    session.previewMeasurementStartExtensionMm
  );
  const measurementEndInsetMm = sharedProjection
    ? resolveSharedClosureEndInsetMm(
      floor,
      session,
      anchor,
      endPoint,
      sharedProjection.wall.id
    )
    : normalizeMeasurementInset(session.previewMeasurementEndInsetMm);
  const ignoredWallIds = isClosingCurrentSpace
    ? floor.walls.slice(0, session.activeSpaceStartWallIndex).map((wall) => wall.id)
    : [];
  // A small endpoint drift on a concave orthogonal traverse can make the
  // final leg cross the first wall before the closure balance moves the
  // intermediate vertices back onto a common axis. Permit only the exact
  // chain shape accepted by the same resolver used by confirmClosure; all
  // unrelated overlaps and diagonal crossings remain hard failures.
  const previewStartClosurePlan = !shortenLastWall &&
    session.mode === 'straight' &&
    activeStartNode &&
    activeWallCountBeforeCommit >= 3 &&
    canCloseAtActiveStart
    ? resolvePreviewStartClosurePlan(floor, session, anchor, endPoint, activeStartNode)
    : null;
  const canBalanceNearStartIntersection = !!(
    previewStartClosurePlan &&
    previewStartClosurePlan.type === 'orthogonal-adjustment'
  );
  if (
    !canBalanceNearStartIntersection &&
    !shortenLastWall &&
    findOverlappingWall(floor, anchor, endPoint, { ignoredWallIds })
  ) {
    throw createSurveyDomainError(DOMAIN_ERROR_CODES.WALL_OVERLAP);
  }

  const measurementSide = session.previewMeasurementSide ||
    resolveBoundaryAlignedMeasurementSide(floor, session, anchor, endPoint);
  if (activeWallCountBeforeCommit === 0 && session.activeSpaceSharedWallId) {
    session.measurementSide = measurementSide;
  }
  const extendLastWall = canExtendLastWall(
    floor,
    session,
    anchor,
    endPoint,
    measurementSide,
    isClosingCurrentSpace
  );
  let endNode;
  let wall;
  if (extendLastWall || shortenLastWall) {
    wall = getLastWall(floor);
    endNode = anchor;
    applyExistingWallMeasurement(
      floor,
      wall,
      anchor,
      endPoint,
      parsedLength,
      inputSource,
      extendLastWall ? 'extend' : 'shorten'
    );
  } else {
    if (activeWallCountBeforeCommit === 0 && session.activeSpaceSharedWallId && session.activeSpaceSharedWallMiddle) {
      const splitSource = getWall(floor, session.activeSpaceSharedWallId);
      const splitClosedSpace = !!(splitSource && (floor.spaces || []).some((space) => (
        space && space.closed && Array.isArray(space.wallIds) && space.wallIds.indexOf(splitSource.id) !== -1
      )));
      const splitResult = splitWallAtNodes(floor, session.activeSpaceSharedWallId, [anchor.id]);
      const snappedSegments = splitResult.segmentIds
        .map((wallId) => getWall(floor, wallId))
        .filter((seg) => seg && (
          seg.startNodeId === anchor.id || seg.endNodeId === anchor.id
        ));
      const snappedWall = snappedSegments[0];
      if (snappedWall) {
        session.activeSpaceSharedWallId = snappedWall.id;
        session.activeSpaceSharedStartT = snappedWall.startNodeId === anchor.id ? 0 : 1;
      }
      session.activeSpaceStartWallIndex = floor.walls.length;
      if (splitClosedSpace) {
        syncFloorSpaces(floor);
        session.fullValidationAfterClosedSplit = true;
      }
    }
    endNode = closureProjection ? getOrCreateSnapNode(floor, closureProjection) : addNode(floor, endPoint);
    wall = {
      id: nextId('wall'),
      startNodeId: anchor.id,
      endNodeId: endNode.id,
      mode: session.mode,
      lengthMm: Math.max(
        0,
        distanceMm(anchor, endNode) - measurementStartInsetMm + measurementStartExtensionMm - measurementEndInsetMm
      ),
      angleDeg: angleDeg(anchor, endNode),
      thicknessMm: session.thicknessMm,
      measurementSide,
      // Preserve the exterior-start case immediately. Shared-boundary first
      // walls also lock the inferred body side so toggling the measuring edge
      // can move the redline without flipping occupancy.
      bodyNormalSide: session.previewBodyNormalSide ||
        (session.activeSpaceSharedSnapLine === 'outer' ? measurementSide : ''),
      measurementStartInsetMm,
      measurementStartExtensionMm,
      measurementEndInsetMm,
      inputSource: inputSource || 'manual',
      angleSource: session.previewAngleSource || '',
      angleInteriorDeg: session.previewInteriorAngleDeg,
      status: 'confirmed',
      measuredAt: nowIso()
    };
    recordCommittedWallMeasurement(wall, parsedLength, inputSource);
    floor.walls.push(wall);
    applyWallBodyInsetToIncidentWalls(floor, wall, wall.startNodeId);
    applyWallBodyInsetToIncidentWalls(floor, wall, wall.endNodeId);
  }
  session.anchorNodeId = endNode.id;
  session.pendingWallId = '';
  session.selectedWallId = '';
  session.selectedOpeningId = '';
  session.previewPoint = null;
  session.previewLengthMm = 0;
  session.previewAngleDeg = 0;
  session.previewAngleSource = '';
  session.previewInteriorAngleDeg = null;
  session.previewMeasurementSide = '';
  session.previewMeasurementStartInsetMm = 0;
  session.previewMeasurementStartExtensionMm = 0;
  session.previewMeasurementEndInsetMm = 0;
  session.previewOuterFaceWallId = '';
  delete session.bleLockedBearingDeg;
  session.closeCandidateNodeId = '';
  session.closeCandidatePoint = null;
  session.closeCandidateType = '';
  session.closeCandidateSharedWallId = '';
  session.alignmentSnapGuide = null;

  const activeWallCount = Math.max(0, floor.walls.length - session.activeSpaceStartWallIndex);
  const resolvedDirectStartClosurePlan = activeStartNode && activeWallCount >= 3
    ? resolveStraightClosurePlan(
      floor,
      session,
      wall,
      activeStartNode,
      { allowRejectedCandidate: true }
    )
    : null;
  const directStartClosurePlan = resolvedDirectStartClosurePlan && (
    distanceMm(endNode, activeStartNode) <= CLOSE_TOLERANCE_MM ||
    resolvedDirectStartClosurePlan.type === 'orthogonal-adjustment'
  )
    ? resolvedDirectStartClosurePlan
    : null;
  applyClosureCandidatePlan(session, planCommittedClosureCandidate(floor, session, {
    activeWallCount, endNode, activeStartNode, partitionProjection, sharedProjection,
    rayFallbackProjection, outerFaceProjection, directStartClosurePlan,
    minimumMergeWallCount: getMinimumClosureSuggestionWallCount(floor, session)
  }));

  return touchDraft(next);
}

function selectWall(draft, wallId) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const wall = getWall(floor, wallId);
  if (!wall) return next;

  floor.session.state = SESSION_STATES.WALL_SELECTED;
  floor.session.selectedWallId = wallId;
  floor.session.selectedOpeningId = '';
  floor.session.selectedSpaceId = '';
  floor.session.previewPoint = null;
  floor.session.previewLengthMm = 0;
  floor.session.previewAngleDeg = 0;
  delete floor.session.bleLockedBearingDeg;
  floor.session.previewMeasurementStartInsetMm = 0;
  floor.session.previewMeasurementStartExtensionMm = 0;
  floor.session.previewMeasurementEndInsetMm = 0;
  floor.session.closeCandidateNodeId = '';
  floor.session.closeCandidatePoint = null;
  floor.session.closeCandidateType = '';
  floor.session.closeCandidateSharedWallId = '';
  floor.session.alignmentSnapGuide = null;
  return touchDraft(next);
}

function selectOpening(draft, openingId) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const opening = getOpening(floor, openingId);
  if (!opening || !getWall(floor, opening.wallId)) return next;

  floor.session.state = SESSION_STATES.WALL_SELECTED;
  floor.session.selectedWallId = opening.wallId;
  floor.session.selectedOpeningId = opening.id;
  floor.session.selectedSpaceId = '';
  floor.session.previewPoint = null;
  floor.session.previewLengthMm = 0;
  floor.session.previewAngleDeg = 0;
  delete floor.session.bleLockedBearingDeg;
  floor.session.previewMeasurementStartInsetMm = 0;
  floor.session.previewMeasurementStartExtensionMm = 0;
  floor.session.previewMeasurementEndInsetMm = 0;
  floor.session.closeCandidateNodeId = '';
  floor.session.closeCandidatePoint = null;
  floor.session.closeCandidateType = '';
  floor.session.closeCandidateSharedWallId = '';
  floor.session.alignmentSnapGuide = null;
  return touchDraft(next);
}

function selectSpace(draft, spaceId) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const space = getClosedSpace(floor, spaceId);
  if (!space) return next;

  floor.session.state = SESSION_STATES.WALL_SELECTED;
  floor.session.selectedWallId = '';
  floor.session.selectedOpeningId = '';
  floor.session.selectedSpaceId = space.id;
  floor.session.previewPoint = null;
  floor.session.previewLengthMm = 0;
  floor.session.previewAngleDeg = 0;
  delete floor.session.bleLockedBearingDeg;
  floor.session.previewMeasurementStartInsetMm = 0;
  floor.session.previewMeasurementStartExtensionMm = 0;
  floor.session.previewMeasurementEndInsetMm = 0;
  floor.session.closeCandidateNodeId = '';
  floor.session.closeCandidatePoint = null;
  floor.session.closeCandidateType = '';
  floor.session.closeCandidateSharedWallId = '';
  floor.session.alignmentSnapGuide = null;
  return touchDraft(next);
}

const MAX_SPACE_NAME_LENGTH = 20;

function renameClosedSpace(draft, spaceId, name) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const space = getClosedSpace(floor, spaceId || (floor.session && floor.session.selectedSpaceId));
  if (!space) {
    throw createSurveyDomainError(DOMAIN_ERROR_CODES.CLOSED_SPACE_REQUIRED);
  }
  const nextName = String(name == null ? '' : name).trim();
  if (!nextName) {
    throw createSurveyDomainError(DOMAIN_ERROR_CODES.ROOM_NAME_REQUIRED);
  }
  if (nextName.length > MAX_SPACE_NAME_LENGTH) {
    throw createSurveyDomainError(DOMAIN_ERROR_CODES.ROOM_NAME_TOO_LONG, {
      maximumCharacters: MAX_SPACE_NAME_LENGTH
    });
  }
  space.name = nextName;
  return touchDraft(next);
}

function orderClosedBoundaryWallIds(floor, wallIds) {
  const uniqueWallIds = (wallIds || []).filter((wallId, index, list) => (
    wallId && list.indexOf(wallId) === index && !!getWall(floor, wallId)
  ));
  if (uniqueWallIds.length < 3) return [];
  const incidentWallIds = new Map();
  uniqueWallIds.forEach((wallId) => {
    const wall = getWall(floor, wallId);
    [wall.startNodeId, wall.endNodeId].forEach((nodeId) => {
      const incident = incidentWallIds.get(nodeId) || [];
      incident.push(wallId);
      incidentWallIds.set(nodeId, incident);
    });
  });
  if ([...incidentWallIds.values()].some((incident) => incident.length !== 2)) return [];
  const firstWall = getWall(floor, uniqueWallIds[0]);
  const trace = (reverseFirstWall) => {
    const initialNodeId = reverseFirstWall ? firstWall.endNodeId : firstWall.startNodeId;
    let currentNodeId = reverseFirstWall ? firstWall.startNodeId : firstWall.endNodeId;
    let currentWallId = firstWall.id;
    const ordered = [firstWall.id];
    const used = new Set(ordered);
    while (ordered.length < uniqueWallIds.length) {
      const nextWallId = (incidentWallIds.get(currentNodeId) || []).find((id) => id !== currentWallId && !used.has(id));
      if (!nextWallId) return [];
      const nextWall = getWall(floor, nextWallId);
      currentNodeId = nextWall.startNodeId === currentNodeId ? nextWall.endNodeId : nextWall.startNodeId;
      currentWallId = nextWallId;
      ordered.push(nextWallId);
      used.add(nextWallId);
    }
    return currentNodeId === initialNodeId ? ordered : [];
  };
  const ordered = trace(false);
  return ordered.length ? ordered : trace(true);
}

function startWallSnap(draft) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const session = ensureSessionSpaceTracking(floor);

  session.state = SESSION_STATES.WALL_SNAP_PENDING;
  session.anchorNodeId = '';
  session.previewPoint = null;
  session.previewLengthMm = 0;
  session.previewAngleDeg = 0;
  delete session.bleLockedBearingDeg;
  session.pendingWallId = '';
  session.selectedWallId = '';
  session.selectedOpeningId = '';
  session.selectedSpaceId = '';
  session.closeCandidateNodeId = '';
  session.closeCandidatePoint = null;
  session.closeCandidateType = '';
  session.closeCandidateSharedWallId = '';
  session.alignmentSnapGuide = null;
  session.activeSpaceStartNodeId = '';
  session.activeSpaceStartWallIndex = floor.walls.length;
  session.activeSpaceSharedWallId = '';
  session.activeSpaceSharedStartT = null;
  session.activeSpaceSharedSnapLine = '';
  resetPreviewSideLock(session);

  return touchDraft(next);
}

function snapCursorToWall(draft, point, target) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const session = ensureSessionSpaceTracking(floor);
  const explicitWall = target && target.wallId
    ? getWall(floor, target.wallId)
    : (target && target.nodeId
      ? (floor.walls || []).find((wall) => (
        wall.startNodeId === target.nodeId || wall.endNodeId === target.nodeId
      ))
      : null);
  const explicitStart = explicitWall ? getNode(floor, explicitWall.startNodeId) : null;
  const explicitEnd = explicitWall ? getNode(floor, explicitWall.endNodeId) : null;
  const explicitTarget = target && target.nodeId && explicitWall
    ? Object.assign({}, target, {
      point: target.pointMm || point,
      t: typeof target.t === 'number' ? target.t : (
        explicitStart && explicitEnd && target.pointMm
          ? projectPointToWallSegment(target.pointMm, explicitStart, explicitEnd).t
          : 0
      ),
      wall: explicitWall,
      start: explicitStart,
      end: explicitEnd,
      node: getNode(floor, target.nodeId)
    })
    : null;
  const projection = explicitTarget && explicitTarget.wall
    ? explicitTarget
    : (findTargetWallProjection(floor, point, target) || findWallSnapProjection(floor, point));
  // Outer-edge hit testing is a presentation/measurement-side choice. The
  // graph itself is centerline-topological, so keep the snapped node on the
  // source wall centerline; otherwise preview closure points use the centerline
  // while the anchor remains one wall thickness away and the chain disconnects.
  const topologyProjection = projection && projection.snapLine === 'outer' && !projection.node
    ? Object.assign({}, projectPointToWallSegment(projection.point, projection.start, projection.end), {
      wall: projection.wall,
      start: projection.start,
      end: projection.end,
      snapLine: 'inner'
    })
    : projection;
  const node = getOrCreateSnapNode(floor, topologyProjection);

  if (!node) return next;

  session.previewPoint = null;
  session.previewLengthMm = 0;
  session.previewAngleDeg = 0;
  session.previewMeasurementSide = '';
  session.previewMeasurementStartInsetMm = 0;
  session.previewMeasurementStartExtensionMm = 0;
  session.previewMeasurementEndInsetMm = 0;
  session.pendingWallId = '';
  session.selectedWallId = '';
  session.selectedOpeningId = '';
  session.alignmentSnapGuide = null;
  resetPreviewSideLock(session);

  if (resumeOpenChainAtDanglingNode(floor, session, node.id)) {
    const incidentWall = (floor.walls || []).find((wall) => (
      wall.endNodeId === node.id || wall.startNodeId === node.id
    ));
    session.lastWallSnapNodeId = node.id;
    session.lastWallSnapWallId = incidentWall ? incidentWall.id : '';
    session.lastWallSnapT = incidentWall && incidentWall.endNodeId === node.id ? 1 : 0;
    session.lastWallSnapWallMiddle = false;
    session.lastWallSnapLine = (projection && projection.snapLine) || 'inner';
    return touchDraft(next);
  }

  let snappedWall = topologyProjection && topologyProjection.wall;
  let snappedT = topologyProjection && topologyProjection.t;
  const snappedAtWallMiddle = !!(snappedWall && snappedT > 0.0001 && snappedT < 0.9999);

  session.state = SESSION_STATES.CURSOR_PLACED;
  session.anchorNodeId = node.id;
  session.previewPoint = null;
  session.previewLengthMm = 0;
  session.previewAngleDeg = 0;
  session.previewMeasurementSide = '';
  session.previewMeasurementStartInsetMm = 0;
  session.previewMeasurementStartExtensionMm = 0;
  session.previewMeasurementEndInsetMm = 0;
  session.previewMeasurementSide = '';
  session.previewMeasurementStartInsetMm = 0;
  session.previewMeasurementStartExtensionMm = 0;
  session.previewMeasurementEndInsetMm = 0;
  session.pendingWallId = '';
  session.selectedWallId = '';
  session.selectedOpeningId = '';
  session.closeCandidateNodeId = '';
  session.closeCandidatePoint = null;
  session.closeCandidateType = '';
  session.closeCandidateSharedWallId = '';
  session.alignmentSnapGuide = null;
  session.activeSpaceStartNodeId = node.id;
  session.activeSpaceStartWallIndex = floor.walls.length;
  session.activeSpaceSharedWallId = snappedWall.id;
  session.activeSpaceSharedStartT = snappedT;
  session.activeSpaceSharedWallMiddle = snappedAtWallMiddle;
  session.activeSpaceSharedSnapLine = projection.snapLine || 'inner';
  session.lastWallSnapNodeId = node.id;
  session.lastWallSnapWallId = snappedWall.id;
  session.lastWallSnapT = snappedT;
  session.lastWallSnapWallMiddle = snappedAtWallMiddle;
  session.lastWallSnapLine = projection.snapLine || 'inner';

  return touchDraft(next);
}

function startRemeasure(draft) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const wall = getWall(floor, floor.session.selectedWallId);
  if (!wall) {
    return next;
  }

  floor.session.state = SESSION_STATES.REMEASURE_AWAITING_INPUT;
  const existingFixed = floor.session.fixedNodeId;
  const isWallEndpoint = existingFixed === wall.startNodeId || existingFixed === wall.endNodeId;
  if (!isWallEndpoint) {
    const sharedEndpoint = getSingleSharedEndpoint(floor, wall);
    floor.session.fixedNodeId = sharedEndpoint ? sharedEndpoint.fixedNodeId : wall.startNodeId;
  }
  return touchDraft(next);
}

function setFixedNode(draft, nodeId) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  floor.session.fixedNodeId = nodeId;
  return touchDraft(next);
}

function setMeasurementSide(draft, side, wallId) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const session = floor.session;
  const targetSide = side === 'left' ? 'left' : 'right';
  const targetWallId = wallId || session.selectedWallId;
  const wall = targetWallId ? getWall(floor, targetWallId) : null;

  // The measuring edge establishes the convention for a free-standing wall
  // chain. A chain snapped to an existing boundary inherits that boundary side.
  if (!canSetInitialMeasurementSide(floor, session, wall && wall.id)) return next;

  const previousSide = wall && (wall.measurementSide === 'left' || wall.measurementSide === 'right')
    ? wall.measurementSide
    : (session.previewMeasurementSide === 'left' || session.previewMeasurementSide === 'right'
      ? session.previewMeasurementSide
      : session.measurementSide);
  session.measurementSideUserSet = true;
  session.measurementSide = targetSide;
  if (session.previewPoint) {
    session.previewMeasurementSide = targetSide;
  }
  if (session.activeSpaceSharedWallId && (previousSide === 'left' || previousSide === 'right')) {
    if (!session.previewBodyNormalSide) {
      session.previewBodyNormalSide = previousSide;
    }
    if (wall && !wall.bodyNormalSide) {
      wall.bodyNormalSide = session.previewBodyNormalSide;
    }
  }
  if (wall) {
    wall.measurementSide = targetSide;
  }

  return touchDraft(next);
}

function canSetInitialMeasurementSide(floor, session, wallId) {
  if (!floor || !session) return false;
  const startWallIndex = Number.isInteger(session.activeSpaceStartWallIndex)
    ? session.activeSpaceStartWallIndex
    : 0;
  const activeWallCount = Math.max(0, floor.walls.length - startWallIndex);
  const firstWall = floor.walls[startWallIndex] || null;

  if (session.activeSpaceSharedWallId) {
    const startsFromClosedBoundary = !!findClosedSpaceForWall(floor, session.activeSpaceSharedWallId);
    const previewStage = startsFromClosedBoundary &&
      activeWallCount === 0 &&
      !!session.previewPoint &&
      (session.state === SESSION_STATES.WALL_PREVIEW || session.state === SESSION_STATES.AWAITING_LENGTH);
    const committedStage = startsFromClosedBoundary &&
      activeWallCount === 1 &&
      !!firstWall &&
      (!wallId || wallId === firstWall.id) &&
      (session.state === SESSION_STATES.WALL_COMMITTED || session.state === SESSION_STATES.MERGE_CLOSING) &&
      !session.previewPoint;
    return previewStage || committedStage;
  }

  return !!(
    firstWall &&
    (!wallId || wallId === firstWall.id) &&
    floor.walls.length === startWallIndex + 1 &&
    session.state === SESSION_STATES.WALL_COMMITTED &&
    !session.previewPoint
  );
}

function placeNewWallChainCursor(draft, point) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const session = ensureSessionSpaceTracking(floor);
  const node = addNode(floor, point);

  session.state = SESSION_STATES.CURSOR_PLACED;
  session.anchorNodeId = node.id;
  session.previewPoint = null;
  session.previewLengthMm = 0;
  session.previewAngleDeg = 0;
  delete session.bleLockedBearingDeg;
  session.previewAngleSource = '';
  session.previewInteriorAngleDeg = null;
  session.previewMeasurementSide = '';
  session.previewMeasurementStartInsetMm = 0;
  session.previewMeasurementStartExtensionMm = 0;
  session.previewMeasurementEndInsetMm = 0;
  session.pendingWallId = '';
  session.selectedWallId = '';
  session.selectedOpeningId = '';
  session.closeCandidateNodeId = '';
  session.closeCandidatePoint = null;
  session.closeCandidateType = '';
  session.closeCandidateSharedWallId = '';
  session.alignmentSnapGuide = null;
  session.activeSpaceStartNodeId = node.id;
  session.activeSpaceStartWallIndex = floor.walls.length;
  session.activeSpaceSharedWallId = '';
  session.activeSpaceSharedStartT = null;
  session.activeSpaceSharedWallMiddle = false;
  session.activeSpaceSharedSnapLine = '';
  session.lastWallSnapNodeId = '';
  session.lastWallSnapWallId = '';
  session.lastWallSnapT = null;
  session.lastWallSnapLine = '';
  resetPreviewSideLock(session);
  return touchDraft(next);
}

function setThickness(draft, thicknessMm, wallId) {
  const parsedThickness = validateThickness(thicknessMm);
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const targetWallId = wallId || floor.session.selectedWallId;
  const wall = targetWallId ? getWall(floor, targetWallId) : null;

  floor.session.thicknessMm = parsedThickness;
  next.settings.defaultThicknessMm = parsedThickness;
  if (wall) {
    wall.thicknessMm = parsedThickness;
  }

  return touchDraft(next);
}

function resetCursor(draft) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const session = ensureSessionSpaceTracking(floor);

  session.previewPoint = null;
  session.previewLengthMm = 0;
  session.previewAngleDeg = 0;
  delete session.bleLockedBearingDeg;
  session.previewMeasurementSide = '';
  session.previewMeasurementStartInsetMm = 0;
  session.previewMeasurementStartExtensionMm = 0;
  session.previewMeasurementEndInsetMm = 0;
  session.pendingWallId = '';
  session.closeCandidateNodeId = '';
  session.closeCandidatePoint = null;
  session.closeCandidateType = '';
  session.closeCandidateSharedWallId = '';
  session.alignmentSnapGuide = null;
  session.selectedWallId = '';
  session.selectedOpeningId = '';
  session.activeSpaceStartNodeId = '';
  session.activeSpaceStartWallIndex = floor.walls.length;
  session.activeSpaceSharedWallId = '';
  session.activeSpaceSharedStartT = null;
  session.activeSpaceSharedSnapLine = '';
  resetPreviewSideLock(session);

  const lastSnapNode = session.lastWallSnapNodeId ? getNode(floor, session.lastWallSnapNodeId) : null;
  const lastSnapWall = session.lastWallSnapWallId ? getWall(floor, session.lastWallSnapWallId) : null;
  if (lastSnapNode && lastSnapWall) {
    session.state = SESSION_STATES.CURSOR_PLACED;
    session.anchorNodeId = lastSnapNode.id;
    session.activeSpaceStartNodeId = lastSnapNode.id;
    session.activeSpaceStartWallIndex = floor.walls.length;
    session.activeSpaceSharedWallId = lastSnapWall.id;
    session.activeSpaceSharedStartT = typeof session.lastWallSnapT === 'number'
      ? session.lastWallSnapT
      : pointAlongWall(floor, lastSnapWall, lastSnapNode.id) /
        Math.max(1, getWallCoordinateLength(floor, lastSnapWall));
    session.activeSpaceSharedWallMiddle = session.lastWallSnapWallMiddle;
    session.activeSpaceSharedSnapLine = session.lastWallSnapLine || 'inner';
    return touchDraft(next);
  }

  if (floor.spaces.some((space) => space.closed)) {
    session.state = SESSION_STATES.SPACE_CLOSED;
    session.anchorNodeId = '';
    return touchDraft(next);
  }

  if (floor.walls.length) {
    const lastEnd = getLastEndNode(floor);
    session.anchorNodeId = lastEnd ? lastEnd.id : '';
    session.state = SESSION_STATES.WALL_COMMITTED;
    return touchDraft(next);
  }

  const anchor = session.anchorNodeId ? getNode(floor, session.anchorNodeId) : null;
  if (anchor) {
    anchor.xMm = 0;
    anchor.yMm = 0;
  } else {
    const node = addNode(floor, { xMm: 0, yMm: 0 });
    session.anchorNodeId = node.id;
  }
  session.state = SESSION_STATES.CURSOR_PLACED;
  return touchDraft(next);
}

function updateViewport(draft, viewportPatch) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const patch = Object.assign({}, viewportPatch || {});
  delete patch.rotationRad;
  floor.viewport = Object.assign({}, floor.viewport, patch);
  if (floor.viewport) delete floor.viewport.rotationRad;
  return touchDraft(next);
}

// Keep the public compatibility facade byte-for-byte compatible with the
// historical errors while domain modules use stable, language-neutral codes.
// Internal calls intentionally keep the structured error until they cross one
// of these exported operation boundaries.
const legacyStartPreviewFromBearing = adaptLegacySurveyOperation(startPreviewFromBearing);
const legacyLockPreviewBearing = adaptLegacySurveyOperation(lockPreviewBearing);
const legacyMaterializeLockedPreview = adaptLegacySurveyOperation(materializeLockedPreview);
const legacyApplyPreviewInteriorAngle = adaptLegacySurveyOperation(applyPreviewInteriorAngle);
const legacyReopenLastDiagonalWallForAngle = adaptLegacySurveyOperation(reopenLastDiagonalWallForAngle);
const legacyCommitPreviewLength = adaptLegacySurveyOperation(commitPreviewLength);
const legacyConfirmClosure = createLegacyConfirmClosure(commitPreviewLength);
const legacyRenameClosedSpace = adaptLegacySurveyOperation(renameClosedSpace);
const legacySnapCursorToWall = adaptLegacySurveyOperation(snapCursorToWall);
const legacySetThickness = adaptLegacySurveyOperation(setThickness);

module.exports = {
  DEFAULT_THICKNESS_MM,
  DEFAULT_SCALE,
  CLOSE_TOLERANCE_MM,
  VERTEX_AXIS_SNAP_TOLERANCE_MM,
  MIN_WALL_LENGTH_MM,
  MIN_THICKNESS_MM,
  createSurveyDraft,
  cloneDraft,
  getActiveFloor,
  getNode,
  getWall,
  getOpening,
  getWallSnapPoint,
  getCursorPlacementTarget,
  getCursorDisplayPoint,
  isDirectClosureHit,
  distanceMm,
  angleDeg,
  buildWallSnapGeometry,
  buildWallRenderGeometry,
  buildWallJoinRenderGeometries,
  buildSpaceBoundaryPoints,
  buildSpaceInnerBoundaryPoints,
  buildSpaceRenderBoundaryPoints,
  buildSpaceDimensionPlan,
  getClosurePath,
  getMinimumClosureSuggestionWallCount,
  getMinimumDirectBoundaryCloseWallCount,
  getMinimumActiveCloseWallCount,
  calculateSpaceAreaMm2,
  setMode,
  placeCursor,
  placeNewWallChainCursor,
  startPreview,
  startPreviewFromBearing: legacyStartPreviewFromBearing,
  lockPreviewBearing: legacyLockPreviewBearing,
  clearBleLockedBearing,
  materializeLockedPreview: legacyMaterializeLockedPreview,
  holdPreviewForInput,
  applyPreviewInteriorAngle: legacyApplyPreviewInteriorAngle,
  reopenLastDiagonalWallForAngle: legacyReopenLastDiagonalWallForAngle,
  cancelPending,
  commitPreviewLength: legacyCommitPreviewLength,
  confirmClosure: legacyConfirmClosure,
  repairCollinearDegree2Walls,
  selectWall,
  selectOpening,
  selectSpace,
  renameClosedSpace: legacyRenameClosedSpace,
  deleteClosedSpace,
  addOpeningToWall: legacyOpeningOperations.addOpeningToWall,
  updateOpening: legacyOpeningOperations.updateOpening,
  deleteOpening: legacyOpeningOperations.deleteOpening,
  deleteWall,
  startWallSnap,
  snapCursorToWall: legacySnapCursorToWall,
  startRemeasure,
  remeasureSelectedWall: legacyRemeasureSelectedWall,
  setFixedNode,
  setMeasurementSide,
  canSetInitialMeasurementSide,
  setThickness: legacySetThickness,
  resetCursor,
  updateViewport
};
