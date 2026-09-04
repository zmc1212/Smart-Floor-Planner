const { buildSpaceDimensionPlan, calculateSpaceAreaMm2 } = require('./read-model/space-dimensions.js');
const { buildSpaceInnerBoundaryPoints, buildSpaceRenderBoundaryPoints } = require('./read-model/space-boundary.js');
const {
  buildWallSnapGeometry,
  buildWallRenderGeometry,
  buildWallJoinRenderGeometries,
  buildBaseWallSegment,
  buildResolvedSegment,
  resolveClosedBoundaryInsetMm
} = require('./read-model/wall-geometry.js');
const {
  findClosedSpaceForWall,
  findClosedSpacesForWall,
  buildClosedSpaceWallChain,
  buildSpaceBoundaryPoints
} = require('./topology/closed-boundary.js');
const { getNode, getWall } = require('./core/graph-query.js');
const {
  DEFAULT_THICKNESS_MM,
  DEFAULT_SCALE,
  CLOSE_TOLERANCE_MM,
  RECTANGLE_ALIGNMENT_TOLERANCE_MM,
  VERTEX_AXIS_SNAP_TOLERANCE_MM,
  DIAGONAL_DIRECTION_SNAP_TOLERANCE_DEG,
  MIN_WALL_LENGTH_MM,
  MIN_THICKNESS_MM,
  WALL_OVERLAP_TOLERANCE_MM,
  WALL_EXTENSION_DIRECTION_TOLERANCE_DEG,
  MIN_CLOSED_SPACE_AREA_MM2,
  MIN_OPENING_SIZE_MM,
  MAX_OPENING_WALL_RATIO
} = require('./core/constants.js');
const {
  createSurveyDraft,
  cloneDraft,
  getActiveFloor: findActiveFloor,
  touchDraft
} = require('./core/draft.js');
const {
  SESSION_STATES,
  ensureSessionSpaceTracking
} = require('./core/session.js');
const vector2 = require('./geometry/vector2.js');
const segmentGeometry = require('./geometry/segment.js');
const polygonGeometry = require('./geometry/polygon.js');
const openingDomain = require('./domain/opening.js');
const wallDomain = require('./domain/wall.js');
const domainValidation = require('./domain/validation.js');
const {
  SURVEY_DOMAIN_ERROR_CODES: DOMAIN_ERROR_CODES,
  createSurveyDomainError
} = require('./domain/errors.js');
const { adaptLegacySurveyOperation } = require('./compat/legacy-error-messages.js');
const { syncClosedSpacesFromFaces } = require('./topology/space-sync.js');
const { legacyOpeningOperations } = require('./operations/opening-operations.js');

const getActiveFloor = (draft) => findActiveFloor(draft, { requireFloorList: true });
const distanceMm = vector2.distanceMm;
const angleDeg = vector2.angleDeg;
const dot = vector2.dot;
const cross = vector2.cross;
const pointLineDistanceMm = vector2.pointLineDistanceMm;
const normalizeAngle = vector2.normalizeAngleDeg;
const normalizeSignedAngle = vector2.normalizeSignedAngleDeg;
const addVector = vector2.addScaled;
const pointTouchesWallSegment = segmentGeometry.pointTouchesSegment;
const projectPointToWallSegment = segmentGeometry.projectPointToSegment;
const perpendicularDistanceToLineMm = segmentGeometry.perpendicularDistanceToLineMm;
const isPointInsidePolygon = polygonGeometry.containsPoint;
const calculatePolygonAreaMm2 = polygonGeometry.area;
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

let idSeed = 1;
// A fixed snap tolerance is too permissive for a short loop and too strict for
// a long multi-corner traverse. Closure balance therefore has a per-wall
// correction budget and a separate hard ceiling. The ordinary 350 mm snap
// tolerance is unchanged; only a fully validated orthogonal adjustment may use
// the additional accumulated budget.
const MAX_ORTHOGONAL_CLOSURE_BALANCE_MM = 1000;
const MIN_WALL_CLOSURE_CORRECTION_MM = 25;
const MAX_WALL_CLOSURE_CORRECTION_MM = 150;
const WALL_CLOSURE_CORRECTION_RATIO = 0.02;

function nowIso() {
  return new Date().toISOString();
}

function nextId(prefix) {
  idSeed += 1;
  return `${prefix}-${Date.now().toString(36)}-${idSeed}`;
}

function syncFloorSpaces(floor, inheritOverrides) {
  return syncClosedSpacesFromFaces(floor, {
    nextId,
    inheritOverrides: inheritOverrides || null
  });
}

function resetPreviewSideLock(session) {
  if (!session) return;
  session.previewBodyNormalSide = '';
  session.measurementSideUserSet = false;
}

function clearLastWallSnap(session) {
  if (!session) return;
  session.lastWallSnapNodeId = '';
  session.lastWallSnapWallId = '';
  session.lastWallSnapT = null;
  session.lastWallSnapWallMiddle = false;
  session.lastWallSnapLine = '';
}

function ensureOpenings(floor) {
  if (!Array.isArray(floor.openings)) {
    floor.openings = [];
  }
  return floor.openings;
}

function getOpening(floor, openingId) {
  return ensureOpenings(floor).find((opening) => opening.id === openingId);
}

function isClosedBoundaryCorner(floor, session) {
  if (!floor || !session || !session.activeSpaceStartNodeId || !session.activeSpaceSharedWallId) return false;
  if (!findClosedSpaceForWall(floor, session.activeSpaceSharedWallId)) return false;
  const incidentClosedWalls = (floor.walls || []).filter((wall) => (
    (wall.startNodeId === session.activeSpaceStartNodeId || wall.endNodeId === session.activeSpaceStartNodeId) &&
    !!findClosedSpaceForWall(floor, wall.id)
  ));
  return incidentClosedWalls.length >= 2;
}

function resolveCollinearClosedOuterBodySide(floor, start, end, sourceSharedWallId) {
  if (!floor || !start || !end) return '';
  const midpoint = {
    xMm: (Number(start.xMm) + Number(end.xMm)) / 2,
    yMm: (Number(start.yMm) + Number(end.yMm)) / 2
  };
  const onFaceToleranceMm = 2;
  const sourceSpace = sourceSharedWallId ? findClosedSpaceForWall(floor, sourceSharedWallId) : null;
  let bestSide = '';
  let bestOuterDist = onFaceToleranceMm;

  (floor.walls || []).forEach((wall) => {
    const wallSpace = findClosedSpaceForWall(floor, wall.id);
    if (!wallSpace) return;
    // Sitting on the source room's own outer is an intentional offset of that
    // room, not a flush continuation of a neighbour facade.
    if (sourceSpace && wallSpace.id === sourceSpace.id) return;
    const segment = buildBaseWallSegment(floor, wall);
    if (!segment) return;
    const topologyDist = Math.max(
      perpendicularDistanceToLineMm(start, segment.start, segment.end),
      perpendicularDistanceToLineMm(end, segment.start, segment.end)
    );
    const outerDist = Math.max(
      perpendicularDistanceToLineMm(start, segment.outerStart, segment.outerEnd),
      perpendicularDistanceToLineMm(end, segment.outerStart, segment.outerEnd)
    );
    const thicknessMm = Number(segment.thicknessMm) || DEFAULT_THICKNESS_MM;
    if (
      outerDist > bestOuterDist ||
      topologyDist < thicknessMm * 0.5 ||
      outerDist >= topologyDist - 1
    ) {
      return;
    }

    const towardCenter = {
      x: (segment.start.xMm + segment.end.xMm) / 2 - midpoint.xMm,
      y: (segment.start.yMm + segment.end.yMm) / 2 - midpoint.yMm
    };
    const leftNormal = normalForMeasurementSide(start, end, 'left');
    const rightNormal = normalForMeasurementSide(start, end, 'right');
    if (!leftNormal || !rightNormal) return;
    const leftScore = leftNormal.x * towardCenter.x + leftNormal.y * towardCenter.y;
    const rightScore = rightNormal.x * towardCenter.x + rightNormal.y * towardCenter.y;
    if (Math.max(Math.abs(leftScore), Math.abs(rightScore)) < 0.25) return;

    bestOuterDist = outerDist;
    bestSide = leftScore >= rightScore ? 'left' : 'right';
  });

  return bestSide;
}

function resolveStableAxisMeasurementSide(start, end) {
  const leftNormal = normalForMeasurementSide(start, end, 'left');
  const rightNormal = normalForMeasurementSide(start, end, 'right');
  if (!leftNormal || !rightNormal) return 'left';

  const dx = Math.abs(end.xMm - start.xMm);
  const dy = Math.abs(end.yMm - start.yMm);
  const preferredNormal = dy >= dx
    ? { x: 1, y: 0 }
    : { x: 0, y: 1 };
  return dot(leftNormal, preferredNormal) >= dot(rightNormal, preferredNormal) ? 'left' : 'right';
}

function resolveBoundaryAlignmentSourceWall(floor, session, start, end) {
  const sourceWall = getWall(floor, session.activeSpaceSharedWallId);
  if (!sourceWall || !start || !end || !start.id) return sourceWall;

  const previewLength = distanceMm(start, end);
  if (!previewLength) return sourceWall;
  const previewDirection = {
    x: (end.xMm - start.xMm) / previewLength,
    y: (end.yMm - start.yMm) / previewLength
  };
  let bestWall = sourceWall;
  const sourceSegment = buildResolvedSegment(floor, sourceWall);
  let bestScore = sourceSegment
    ? Math.abs(dot(previewDirection, sourceSegment.direction))
    : -1;

  // A closed-room corner belongs to two boundary walls. Use the wall aligned
  // with the outgoing preview to preserve the inner/outer corner distinction.
  (floor.walls || []).forEach((wall) => {
    if (
      wall.id === sourceWall.id ||
      (wall.startNodeId !== start.id && wall.endNodeId !== start.id) ||
      !findClosedSpaceForWall(floor, wall.id)
    ) {
      return;
    }
    const segment = buildResolvedSegment(floor, wall);
    if (!segment) return;
    const score = Math.abs(dot(previewDirection, segment.direction));
    if (score > bestScore + 0.001) {
      bestScore = score;
      bestWall = wall;
    }
  });

  return bestWall;
}

function resolveOpenEndpointContinuationMeasurementSide(floor, session, sourceWall) {
  if (
    !floor ||
    !session ||
    !sourceWall ||
    findClosedSpaceForWall(floor, sourceWall.id) ||
    !session.activeSpaceStartNodeId ||
    getNodeWallUseCount(floor, session.activeSpaceStartNodeId) !== 1
  ) {
    return '';
  }

  const sourceSide = sourceWall.measurementSide === 'right' ? 'right' : 'left';
  if (sourceWall.endNodeId === session.activeSpaceStartNodeId) return sourceSide;
  if (sourceWall.startNodeId === session.activeSpaceStartNodeId) {
    return sourceSide === 'left' ? 'right' : 'left';
  }
  return '';
}

function resolveBoundaryAlignedMeasurementSide(floor, session, start, end) {
  if (!floor || !session || !start || !end) return session ? session.measurementSide : 'left';
  const startWallIndex = Number.isInteger(session.activeSpaceStartWallIndex)
    ? session.activeSpaceStartWallIndex
    : 0;
  const activeWallCount = Math.max(0, (floor.walls || []).length - startWallIndex);
  if (activeWallCount !== 0 || !session.activeSpaceSharedWallId || !session.activeSpaceSharedSnapLine) {
    return session.measurementSide;
  }

  const sourceWall = resolveBoundaryAlignmentSourceWall(floor, session, start, end);
  const continuationSide = resolveOpenEndpointContinuationMeasurementSide(
    floor,
    session,
    sourceWall
  );
  if (continuationSide) return continuationSide;
  const sourceSegment = sourceWall ? buildResolvedSegment(floor, sourceWall) : null;
  if (!sourceSegment || !sourceSegment.normal) return session.measurementSide;

  // Inner/outer snapping changes the physical measurement origin, but it must
  // not flip the new wall body to the opposite side. Match the outward normal
  // of the incident closed boundary so a wall pulled from its visible outer
  // vertex continues the neighbouring wall face without a manual side switch.
  const towardWallBody = sourceSegment.normal;
  const leftNormal = normalForMeasurementSide(start, end, 'left');
  const rightNormal = normalForMeasurementSide(start, end, 'right');
  if (!leftNormal || !rightNormal) return session.measurementSide;

  const leftScore = dot(leftNormal, towardWallBody);
  const rightScore = dot(rightNormal, towardWallBody);
  if (Math.max(Math.abs(leftScore), Math.abs(rightScore)) < 0.25) {
    return resolveStableAxisMeasurementSide(start, end);
  }

  return leftScore >= rightScore ? 'left' : 'right';
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

function setWallEndpointInset(floor, wall, nodeId, insetMm, onlyIncrease) {
  if (!floor || !wall || !nodeId) return;
  const coordinateLength = getWallCoordinateLength(floor, wall);
  const currentInsets = getWallMeasurementInsets(wall);
  const absoluteOpeningOffsets = ensureOpenings(floor)
    .filter((opening) => opening.wallId === wall.id)
    .map((opening) => ({
      opening,
      absoluteOffsetMm: (opening.centerOffsetMm || 0) + currentInsets.start
    }));
  const isStart = wall.startNodeId === nodeId;
  const isEnd = wall.endNodeId === nodeId;
  if (!isStart && !isEnd) return;

  const oppositeInset = isStart ? currentInsets.end : currentInsets.start;
  const maximumInset = Math.max(0, coordinateLength - oppositeInset - 1);
  const nextInset = Math.min(
    maximumInset,
    onlyIncrease
      ? Math.max(isStart ? currentInsets.start : currentInsets.end, normalizeMeasurementInset(insetMm))
      : normalizeMeasurementInset(insetMm)
  );
  if (isStart) {
    wall.measurementStartInsetMm = nextInset;
  } else {
    wall.measurementEndInsetMm = nextInset;
  }
  wall.lengthMm = getMeasuredWallLength(floor, wall);
  syncWallAdjustmentAfterMetricChange(wall);

  const nextStartInset = getWallMeasurementInsets(wall).start;
  absoluteOpeningOffsets.forEach(({ opening, absoluteOffsetMm }) => {
    opening.centerOffsetMm = Math.round(absoluteOffsetMm - nextStartInset);
    normalizeOpeningToWall(floor, opening);
  });
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

function recomputeSplitNodeBodyInsets(floor, nodeId) {
  if (!floor || !nodeId) return [];
  const node = getNode(floor, nodeId);
  if (!node) return [];
  const incidentWalls = (floor.walls || []).filter((wall) => (
    wall && (wall.startNodeId === nodeId || wall.endNodeId === nodeId)
  ));
  const sourceGroups = new Map();
  incidentWalls.forEach((wall) => {
    if (!wall.topologySourceWallId) return;
    if (!sourceGroups.has(wall.topologySourceWallId)) {
      sourceGroups.set(wall.topologySourceWallId, []);
    }
    sourceGroups.get(wall.topologySourceWallId).push(wall);
  });

  const repairedWallIds = [];
  sourceGroups.forEach((sourceWalls, topologySourceWallId) => {
    if (sourceWalls.length < 2) return;
    sourceWalls.forEach((wall) => {
      const oppositeNode = getNode(
        floor,
        wall.startNodeId === nodeId ? wall.endNodeId : wall.startNodeId
      );
      if (!oppositeNode) return;
      const length = distanceMm(node, oppositeNode);
      if (!length) return;
      const awayDirection = {
        x: (oppositeNode.xMm - node.xMm) / length,
        y: (oppositeNode.yMm - node.yMm) / length
      };
      let nextInsetMm = 0;
      incidentWalls.forEach((sourceWall) => {
        if (sourceWall.id === wall.id || sourceWall.topologySourceWallId === topologySourceWallId) {
          return;
        }
        const sourceSegment = buildBaseWallSegment(floor, sourceWall);
        if (!sourceSegment) return;
        const coverageRate = dot(awayDirection, sourceSegment.normal);
        if (coverageRate <= 0.25) return;
        nextInsetMm = Math.max(
          nextInsetMm,
          Math.ceil(sourceSegment.thicknessMm / coverageRate)
        );
      });
      const currentInsets = getWallMeasurementInsets(wall);
      const currentInsetMm = wall.startNodeId === nodeId ? currentInsets.start : currentInsets.end;
      if (currentInsetMm === nextInsetMm) return;
      setWallEndpointInset(floor, wall, nodeId, nextInsetMm, false);
      repairedWallIds.push(wall.id);
    });
  });
  return repairedWallIds;
}

function resolveSharedClosureEndInsetMm(floor, session, start, end, sharedWallId) {
  return resolveMeasurementEndInsetMm(floor, start, end, sharedWallId);
}

function resolveMeasurementEndInsetMm(floor, start, end, preferredWallId, excludedWallId) {
  if (!floor || !start || !end) return 0;
  return resolveClosedBoundaryInsetMm(floor, end, start, {
    excludedWallId: excludedWallId || '',
    preferredWallId: preferredWallId || ''
  });
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

function getMinimumActiveCloseWallCount(floor, session) {
  const hasSharedBoundary = !!(
    session &&
    (session.activeSpaceSharedWallId || session.closeCandidateSharedWallId)
  );
  if (session && session.closeCandidateType === 'merge') {
    return getMinimumClosureSuggestionWallCount(floor, session);
  }
  if (hasSharedBoundary) {
    return getMinimumDirectBoundaryCloseWallCount(floor, session);
  }
  return 3;
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

function addNode(floor, point) {
  const node = {
    id: nextId('node'),
    xMm: Math.round(point.xMm),
    yMm: Math.round(point.yMm),
    createdAt: nowIso()
  };
  floor.nodes.push(node);
  return node;
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

function isHorizontalSegment(start, end) {
  return Math.abs((end || {}).xMm - (start || {}).xMm) >= Math.abs((end || {}).yMm - (start || {}).yMm);
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

function getFirstNode(floor) {
  if (!floor.walls.length) return null;
  return getNode(floor, floor.walls[0].startNodeId);
}

function getLastWall(floor) {
  return floor.walls[floor.walls.length - 1] || null;
}

function getLastEndNode(floor) {
  const lastWall = getLastWall(floor);
  return lastWall ? getNode(floor, lastWall.endNodeId) : null;
}

function refreshWallMetrics(floor) {
  floor.walls.forEach((wall) => {
    const start = getNode(floor, wall.startNodeId);
    const end = getNode(floor, wall.endNodeId);
    wall.lengthMm = getMeasuredWallLength(floor, wall);
    wall.angleDeg = angleDeg(start, end);
    syncWallAdjustmentAfterMetricChange(wall);
  });
}

function removeUnreferencedNodes(floor) {
  const used = {};
  floor.walls.forEach((wall) => {
    used[wall.startNodeId] = true;
    used[wall.endNodeId] = true;
  });
  const session = floor.session || {};
  if (session.anchorNodeId) used[session.anchorNodeId] = true;
  floor.nodes = floor.nodes.filter((node) => used[node.id]);
}

function nodeIncidentWallCount(floor, nodeId) {
  return (floor.walls || []).reduce((count, wall) => (
    count + ((wall.startNodeId === nodeId || wall.endNodeId === nodeId) ? 1 : 0)
  ), 0);
}

function wallBelongsToClosedSpace(floor, wallId) {
  return (floor.spaces || []).some((space) => (
    space && space.closed && Array.isArray(space.wallIds) && space.wallIds.indexOf(wallId) !== -1
  ));
}

function isForwardCollinearOpenPair(floor, first, second) {
  if (!first || !second || first.endNodeId !== second.startNodeId) return false;
  if (first.status !== 'confirmed' || second.status !== 'confirmed') return false;
  if (first.mode !== second.mode) return false;
  if (Number(first.thicknessMm) !== Number(second.thicknessMm)) return false;
  if (nodeIncidentWallCount(floor, first.endNodeId) !== 2) return false;
  if (wallBelongsToClosedSpace(floor, first.id) || wallBelongsToClosedSpace(floor, second.id)) return false;
  const firstStart = getNode(floor, first.startNodeId);
  const joint = getNode(floor, first.endNodeId);
  const secondEnd = getNode(floor, second.endNodeId);
  if (!firstStart || !joint || !secondEnd) return false;
  const previousAngle = angleDeg(firstStart, joint);
  const extensionAngle = angleDeg(joint, secondEnd);
  return Math.abs(normalizeSignedAngle(extensionAngle - previousAngle)) <= WALL_EXTENSION_DIRECTION_TOLERANCE_DEG;
}

function absorbForwardCollinearWall(floor, first, second) {
  const originalKeepLength = getWallCoordinateLength(floor, first);
  const firstHasMetadata = Object.prototype.hasOwnProperty.call(first, 'rawMeasuredLengthMm') ||
    Object.prototype.hasOwnProperty.call(first, 'closureAdjustmentMm');
  const secondHasMetadata = Object.prototype.hasOwnProperty.call(second, 'rawMeasuredLengthMm') ||
    Object.prototype.hasOwnProperty.call(second, 'closureAdjustmentMm');
  const preserveAdjustmentMetadata = firstHasMetadata || secondHasMetadata;
  const firstRawMeasuredLengthMm = Number.isFinite(Number(first.rawMeasuredLengthMm))
    ? Math.round(Number(first.rawMeasuredLengthMm))
    : Math.round(getMeasuredWallLength(floor, first));
  const secondRawMeasuredLengthMm = Number.isFinite(Number(second.rawMeasuredLengthMm))
    ? Math.round(Number(second.rawMeasuredLengthMm))
    : Math.round(getMeasuredWallLength(floor, second));
  const adjustmentSources = [first.adjustmentSource, second.adjustmentSource]
    .filter((source) => typeof source === 'string' && source);
  first.endNodeId = second.endNodeId;
  first.measurementEndInsetMm = second.measurementEndInsetMm || 0;
  first.lengthMm = getMeasuredWallLength(floor, first);
  first.angleDeg = angleDeg(getNode(floor, first.startNodeId), getNode(floor, first.endNodeId));
  if (preserveAdjustmentMetadata) {
    first.rawMeasuredLengthMm = firstRawMeasuredLengthMm + secondRawMeasuredLengthMm;
    first.closureAdjustmentMm = Math.round(first.lengthMm - first.rawMeasuredLengthMm);
    if (adjustmentSources.length) {
      first.adjustmentSource = adjustmentSources.includes('closure-balance')
        ? 'closure-balance'
        : (adjustmentSources.includes('remeasure-balance')
          ? 'remeasure-balance'
          : adjustmentSources[0]);
    } else {
      delete first.adjustmentSource;
    }
  } else {
    delete first.rawMeasuredLengthMm;
    delete first.closureAdjustmentMm;
    delete first.adjustmentSource;
  }
  if (
    first.inputSource === 'closure-merge' ||
    first.inputSource === 'closure-preview' ||
    second.inputSource === 'closure-merge' ||
    second.inputSource === 'closure-preview'
  ) {
    first.inputSource = 'closure-merge';
  }
  (floor.openings || []).forEach((opening) => {
    if (opening.wallId !== second.id) return;
    opening.wallId = first.id;
    opening.centerOffsetMm = Math.round((opening.centerOffsetMm || 0) + originalKeepLength);
  });
  (floor.spaces || []).forEach((space) => {
    if (!Array.isArray(space.wallIds)) return;
    space.wallIds = space.wallIds.filter((wallId) => wallId !== second.id);
  });
  floor.walls = floor.walls.filter((wall) => wall.id !== second.id);
}

function oppositeMeasurementSide(side) {
  if (side === 'left') return 'right';
  if (side === 'right') return 'left';
  return side || '';
}

function reverseWallDirection(floor, wall) {
  const startNodeId = wall.startNodeId;
  const coordinateLength = getWallCoordinateLength(floor, wall);
  wall.startNodeId = wall.endNodeId;
  wall.endNodeId = startNodeId;
  const startInset = wall.measurementStartInsetMm || 0;
  wall.measurementStartInsetMm = wall.measurementEndInsetMm || 0;
  wall.measurementEndInsetMm = startInset;
  wall.measurementSide = oppositeMeasurementSide(wall.measurementSide);
  wall.bodyNormalSide = oppositeMeasurementSide(wall.bodyNormalSide);
  wall.angleDeg = angleDeg(getNode(floor, wall.startNodeId), getNode(floor, wall.endNodeId));
  (floor.openings || []).forEach((opening) => {
    if (opening.wallId !== wall.id) return;
    opening.centerOffsetMm = Math.round(coordinateLength - (opening.centerOffsetMm || 0));
  });
}

function orientWallEndToNode(floor, wall, nodeId) {
  if (!wall || !nodeId) return false;
  if (wall.endNodeId === nodeId) return true;
  if (wall.startNodeId !== nodeId) return false;
  reverseWallDirection(floor, wall);
  return wall.endNodeId === nodeId;
}

function orientWallStartToNode(floor, wall, nodeId) {
  if (!wall || !nodeId) return false;
  if (wall.startNodeId === nodeId) return true;
  if (wall.endNodeId !== nodeId) return false;
  reverseWallDirection(floor, wall);
  return wall.startNodeId === nodeId;
}

function isCollinearThroughNode(floor, first, second, nodeId) {
  if (!first || !second || !nodeId) return false;
  if (first.status !== 'confirmed' || second.status !== 'confirmed') return false;
  if (first.mode !== second.mode) return false;
  if (Number(first.thicknessMm) !== Number(second.thicknessMm)) return false;
  const firstOtherId = first.startNodeId === nodeId ? first.endNodeId : (
    first.endNodeId === nodeId ? first.startNodeId : ''
  );
  const secondOtherId = second.startNodeId === nodeId ? second.endNodeId : (
    second.endNodeId === nodeId ? second.startNodeId : ''
  );
  if (!firstOtherId || !secondOtherId || firstOtherId === secondOtherId) return false;
  const firstOther = getNode(floor, firstOtherId);
  const joint = getNode(floor, nodeId);
  const secondOther = getNode(floor, secondOtherId);
  if (!firstOther || !joint || !secondOther) return false;
  const incomingAngle = angleDeg(firstOther, joint);
  const outgoingAngle = angleDeg(joint, secondOther);
  return Math.abs(normalizeSignedAngle(outgoingAngle - incomingAngle)) <= WALL_EXTENSION_DIRECTION_TOLERANCE_DEG;
}

function mergeCollinearOpenChain(floor, fromIndex) {
  let index = Math.max(0, fromIndex || 0);
  while (index < (floor.walls || []).length - 1) {
    const first = floor.walls[index];
    const second = floor.walls[index + 1];
    if (!isForwardCollinearOpenPair(floor, first, second)) {
      index += 1;
      continue;
    }
    absorbForwardCollinearWall(floor, first, second);
  }
}

function mergeCollinearDegree2Walls(floor) {
  let merged = true;
  while (merged) {
    merged = false;
    const nodes = floor.nodes || [];
    for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
      const node = nodes[nodeIndex];
      if (!node || !node.id) continue;
      const incident = (floor.walls || []).filter((wall) => (
        wall.startNodeId === node.id || wall.endNodeId === node.id
      ));
      if (incident.length !== 2) continue;
      const first = incident[0];
      const second = incident[1];
      if (!isCollinearThroughNode(floor, first, second, node.id)) continue;
      if (!orientWallEndToNode(floor, first, node.id)) continue;
      if (!orientWallStartToNode(floor, second, node.id)) continue;
      if (first.endNodeId !== second.startNodeId) continue;
      absorbForwardCollinearWall(floor, first, second);
      merged = true;
      break;
    }
  }
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

function getNodeWallUseCount(floor, nodeId) {
  if (!floor || !nodeId) return 0;
  return (floor.walls || []).filter((wall) => wall.startNodeId === nodeId || wall.endNodeId === nodeId).length;
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

// Unique extend rule: orthogonal and collinear, degree-1 anchor, and the last
// wall is not already in a closed space. Session-side switching does not split
// one physical wall. Any other drag commits a new wall.
function canExtendLastWall(floor, session, anchor, endPoint, measurementSide, isClosingCurrentSpace) {
  if (isClosingCurrentSpace || !anchor || !endPoint) return false;

  const lastWallIndex = floor.walls.length - 1;
  const lastWall = floor.walls[lastWallIndex];
  if (!lastWall || lastWallIndex < session.activeSpaceStartWallIndex || lastWall.endNodeId !== anchor.id) {
    return false;
  }
  if (lastWall.status !== 'confirmed' || lastWall.mode !== session.mode ||
      Number(lastWall.thicknessMm) !== Number(session.thicknessMm)) {
    return false;
  }
  if (floor.spaces.some((space) => (
    space && space.closed && Array.isArray(space.wallIds) && space.wallIds.indexOf(lastWall.id) !== -1
  ))) {
    return false;
  }

  const anchorReferenceCount = floor.walls.reduce((count, wall) => (
    count + (wall.startNodeId === anchor.id ? 1 : 0) + (wall.endNodeId === anchor.id ? 1 : 0)
  ), 0);
  if (anchorReferenceCount !== 1) return false;

  const lastStart = getNode(floor, lastWall.startNodeId);
  if (!lastStart) return false;
  const previousAngle = angleDeg(lastStart, anchor);
  const extensionAngle = angleDeg(anchor, endPoint);
  return Math.abs(normalizeSignedAngle(extensionAngle - previousAngle)) <= WALL_EXTENSION_DIRECTION_TOLERANCE_DEG;
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

function getOrCreateSnapNode(floor, projection) {
  if (!projection) return null;
  if (projection.node) return projection.node;
  const centerline = projection.snapLine === 'outer' && projection.start && projection.end
    ? projectPointToWallSegment(projection.point, projection.start, projection.end)
    : null;
  const point = centerline && centerline.point ? centerline.point : projection.point;
  const t = centerline && typeof centerline.t === 'number' ? centerline.t : projection.t;
  if (t <= 0.0001) return projection.start;
  if (t >= 0.9999) return projection.end;
  if (!point) return null;
  const existing = floor.nodes.find((node) => distanceMm(node, point) <= 1);
  return existing || addNode(floor, point);
}

function getOrCreateWallCenterNode(floor, wallId, point) {
  const wall = getWall(floor, wallId);
  if (!wall || !point) return null;
  const start = getNode(floor, wall.startNodeId);
  const end = getNode(floor, wall.endNodeId);
  const projection = projectPointToWallSegment(point, start, end);
  if (!projection) return null;
  if (projection.t <= 0.0001) return start;
  if (projection.t >= 0.9999) return end;

  const existing = floor.nodes.find((node) => distanceMm(node, projection.point) <= 1);
  return existing || addNode(floor, projection.point);
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

function findActiveChainInteriorSourceSpace(floor, session, wallIds) {
  if (!floor || !session || !session.activeSpaceSharedWallId || !session.activeSpaceStartNodeId) {
    return null;
  }
  const sourceSpaces = findClosedSpacesForWall(floor, session.activeSpaceSharedWallId);
  if (!sourceSpaces.length) return null;

  const firstWall = (wallIds || [])
    .map((wallId) => getWall(floor, wallId))
    .find((wall) => wall && (
      wall.startNodeId === session.activeSpaceStartNodeId ||
      wall.endNodeId === session.activeSpaceStartNodeId
    ));
  if (!firstWall) return null;

  const start = getNode(floor, session.activeSpaceStartNodeId);
  const nextNodeId = firstWall.startNodeId === session.activeSpaceStartNodeId
    ? firstWall.endNodeId
    : firstWall.startNodeId;
  const end = getNode(floor, nextNodeId);
  if (!start || !end) return null;
  const length = distanceMm(start, end);
  if (length < 1) return null;

  const probeDistanceMm = Math.min(MIN_WALL_LENGTH_MM, length / 2);
  const probe = {
    xMm: Math.round(start.xMm + (end.xMm - start.xMm) * probeDistanceMm / length),
    yMm: Math.round(start.yMm + (end.yMm - start.yMm) * probeDistanceMm / length)
  };
  return sourceSpaces.find((space) => (
    isPointInsidePolygon(probe, buildSpaceBoundaryPoints(floor, space.wallIds))
  )) || null;
}

function findWallPathBetweenNodes(floor, fromNodeId, toNodeId, excludedWallIds) {
  if (!floor || !fromNodeId || !toNodeId) return [];
  if (fromNodeId === toNodeId) return [];

  const excluded = excludedWallIds || {};
  const visited = {};
  const queue = [{ nodeId: fromNodeId, wallIds: [] }];
  visited[fromNodeId] = true;

  while (queue.length) {
    const current = queue.shift();
    const walls = floor.walls || [];
    for (let index = 0; index < walls.length; index += 1) {
      const wall = walls[index];
      if (!wall || excluded[wall.id]) continue;
      let nextNodeId = '';
      if (wall.startNodeId === current.nodeId) {
        nextNodeId = wall.endNodeId;
      } else if (wall.endNodeId === current.nodeId) {
        nextNodeId = wall.startNodeId;
      }
      if (!nextNodeId || visited[nextNodeId]) continue;
      const nextWallIds = current.wallIds.concat(wall.id);
      if (nextNodeId === toNodeId) {
        return nextWallIds;
      }
      visited[nextNodeId] = true;
      queue.push({ nodeId: nextNodeId, wallIds: nextWallIds });
    }
  }

  return [];
}

function findClosedBoundaryPathsBetweenNodes(floor, space, fromNodeId, toNodeId) {
  const chain = space && buildClosedSpaceWallChain(floor, space.wallIds);
  if (!chain || !chain.length || !fromNodeId || !toNodeId || fromNodeId === toNodeId) return [];
  const nodes = chain.map((entry) => entry.start.id);
  const fromIndex = nodes.indexOf(fromNodeId);
  const toIndex = nodes.indexOf(toNodeId);
  if (fromIndex < 0 || toIndex < 0) return [];

  const forward = [];
  for (let index = fromIndex; index !== toIndex; index = (index + 1) % chain.length) {
    forward.push(chain[index].wall.id);
  }
  const reverse = [];
  for (let index = fromIndex; index !== toIndex; index = (index - 1 + chain.length) % chain.length) {
    reverse.push(chain[(index - 1 + chain.length) % chain.length].wall.id);
  }
  return [forward, reverse].filter((path) => path.length);
}

function splitClosedSpaceWithPartition(floor, session, partitionWall) {
  const sourceSpace = (floor.spaces || []).find((space) => (
    space && space.id === session.partitionSourceSpaceId && space.closed
  ));
  const startNode = getNode(floor, session.activeSpaceStartNodeId);
  const endNode = partitionWall && getNode(floor, partitionWall.endNodeId);
  if (!sourceSpace || !startNode || !endNode || !partitionWall) return false;

  const closedBefore = (floor.spaces || []).filter((space) => space && space.closed).length;
  splitWallAtNodes(floor, session.activeSpaceSharedWallId, [startNode.id]);
  splitWallAtNodes(floor, session.closeCandidateSharedWallId, [endNode.id]);
  syncFloorSpaces(floor);
  return (floor.spaces || []).filter((space) => space && space.closed).length >= closedBefore + 1;
}

function cloneWallSegment(sourceWall, startNodeId, endNodeId, id) {
  return {
    id: id || nextId('wall'),
    topologySourceWallId: sourceWall.topologySourceWallId || sourceWall.id,
    startNodeId,
    endNodeId,
    mode: sourceWall.mode,
    lengthMm: sourceWall.lengthMm,
    angleDeg: sourceWall.angleDeg,
    thicknessMm: sourceWall.thicknessMm,
    measurementSide: sourceWall.measurementSide,
    bodyNormalSide: sourceWall.bodyNormalSide || '',
    measurementStartInsetMm: 0,
    measurementStartExtensionMm: 0,
    measurementEndInsetMm: 0,
    inputSource: sourceWall.inputSource || 'manual',
    angleSource: sourceWall.angleSource || '',
    angleInteriorDeg: Number.isFinite(sourceWall.angleInteriorDeg) ? sourceWall.angleInteriorDeg : null,
    status: sourceWall.status || 'confirmed',
    measuredAt: sourceWall.measuredAt || nowIso()
  };
}

function preserveSharedWallBodyNormalSide(floor, wall) {
  if (!floor || !wall || wall.bodyNormalSide === 'left' || wall.bodyNormalSide === 'right') {
    return wall;
  }
  if (findClosedSpacesForWall(floor, wall.id).length < 2) return wall;

  const segment = buildBaseWallSegment(floor, wall);
  const leftNormal = segment && normalForMeasurementSide(segment.start, segment.end, 'left');
  const rightNormal = segment && normalForMeasurementSide(segment.start, segment.end, 'right');
  if (!segment || !leftNormal || !rightNormal) return wall;

  // A shared wall with no explicit body side currently derives its physical
  // side from the first closed Space that references it. After a split, each
  // replacement segment can have a different first Space, which flips one
  // half of the same wall by a full thickness. Freeze the pre-split rendered
  // normal once so every clone preserves the already visible wall body.
  wall.bodyNormalSide = dot(segment.normal, leftNormal) >= dot(segment.normal, rightNormal)
    ? 'left'
    : 'right';
  return wall;
}

function pointAlongWall(floor, wall, nodeId) {
  const start = getNode(floor, wall.startNodeId);
  const end = getNode(floor, wall.endNodeId);
  const node = getNode(floor, nodeId);
  const projection = projectPointToWallSegment(node, start, end);
  return projection ? Math.round(projection.t * distanceMm(start, end)) : 0;
}

function uniqueCutNodesByAlong(items) {
  const sorted = items
    .filter((item) => item && item.node)
    .sort((a, b) => a.alongMm - b.alongMm);
  const result = [];
  sorted.forEach((item) => {
    const previous = result[result.length - 1];
    if (previous && Math.abs(previous.alongMm - item.alongMm) <= 1) {
      return;
    }
    result.push(item);
  });
  return result;
}

function orderReplacementWallIdsForSpace(floor, wallIds, wallId, replacementIds) {
  const index = wallIds.indexOf(wallId);
  if (index < 0 || !replacementIds.length) return replacementIds.slice();
  const previousWall = getWall(floor, wallIds[(index - 1 + wallIds.length) % wallIds.length]);
  const nextWall = getWall(floor, wallIds[(index + 1) % wallIds.length]);
  const previousNodeIds = previousWall
    ? [previousWall.startNodeId, previousWall.endNodeId]
    : [];
  const nextNodeIds = nextWall
    ? [nextWall.startNodeId, nextWall.endNodeId]
    : [];
  const first = getWall(floor, replacementIds[0]);
  const last = getWall(floor, replacementIds[replacementIds.length - 1]);
  if (!first || !last) return replacementIds.slice();

  const forwardConnects = previousNodeIds.includes(first.startNodeId) &&
    nextNodeIds.includes(last.endNodeId);
  const reverseConnects = previousNodeIds.includes(last.endNodeId) &&
    nextNodeIds.includes(first.startNodeId);
  return reverseConnects && !forwardConnects
    ? replacementIds.slice().reverse()
    : replacementIds.slice();
}

function replaceWallInSpaces(floor, wallId, replacementIds) {
  floor.spaces = (floor.spaces || []).map((space) => {
    if (!Array.isArray(space.wallIds) || space.wallIds.indexOf(wallId) === -1) return space;
    const wallIds = [];
    const orderedReplacementIds = orderReplacementWallIdsForSpace(
      floor,
      space.wallIds,
      wallId,
      replacementIds
    );
    space.wallIds.forEach((id) => {
      if (id === wallId) {
        orderedReplacementIds.forEach((replacementId) => wallIds.push(replacementId));
      } else {
        wallIds.push(id);
      }
    });
    const wallFaceOverrides = Object.assign({}, space.wallFaceOverrides || {});
    if (wallFaceOverrides[wallId]) {
      const face = wallFaceOverrides[wallId];
      delete wallFaceOverrides[wallId];
      orderedReplacementIds.forEach((replacementId) => {
        wallFaceOverrides[replacementId] = face;
      });
    }
    const nextSpace = Object.assign({}, space, { wallIds });
    if (Object.keys(wallFaceOverrides).length) {
      nextSpace.wallFaceOverrides = wallFaceOverrides;
    } else {
      delete nextSpace.wallFaceOverrides;
    }
    return nextSpace;
  });
}

function remapOpeningsForSplitWall(floor, originalWall, segments) {
  const originalStartAlongMm = getWallMeasurementInsets(originalWall).start -
    normalizeMeasurementExtension(originalWall.measurementStartExtensionMm);
  ensureOpenings(floor).forEach((opening) => {
    if (opening.wallId !== originalWall.id) return;
    const centerOffset = (opening.centerOffsetMm || 0) + originalStartAlongMm;
    const target = segments.find((segment) => (
      centerOffset >= segment.startAlongMm - 1 &&
      centerOffset <= segment.endAlongMm + 1
    )) || segments[segments.length - 1];
    if (!target) return;
    opening.wallId = target.wall.id;
    const targetStartAlongMm = getWallMeasurementInsets(target.wall).start -
      normalizeMeasurementExtension(target.wall.measurementStartExtensionMm);
    opening.centerOffsetMm = Math.round(
      centerOffset -
      target.startAlongMm -
      targetStartAlongMm
    );
    normalizeOpeningToWall(floor, opening);
    normalizeOpeningDirection(opening);
  });
}

function resolveOpeningSplitClearanceMm(floor, originalWall, cutNode) {
  const sourceId = originalWall.topologySourceWallId || originalWall.id;
  const incidentThicknesses = (floor.walls || [])
    .filter((wall) => (
      wall &&
      wall.id !== originalWall.id &&
      (wall.topologySourceWallId || wall.id) !== sourceId &&
      cutNode &&
      (wall.startNodeId === cutNode.id || wall.endNodeId === cutNode.id)
    ))
    .map((wall) => Number(wall.thicknessMm) || 0);
  return Math.max(
    0,
    Number(floor.session && floor.session.thicknessMm) || 0,
    ...incidentThicknesses
  );
}

function assertSplitCutsAvoidOpenings(floor, originalWall, cutItems, wallLength) {
  const openings = ensureOpenings(floor).filter((opening) => (
    opening && opening.wallId === originalWall.id
  ));
  if (!openings.length) return;

  const openingOriginAlongMm = getWallMeasurementInsets(originalWall).start -
    normalizeMeasurementExtension(originalWall.measurementStartExtensionMm);
  const interiorCuts = (cutItems || []).filter((item) => (
    item && item.node && item.alongMm > 1 && item.alongMm < wallLength - 1
  ));
  if (!interiorCuts.length) return;

  for (let openingIndex = 0; openingIndex < openings.length; openingIndex += 1) {
    const opening = openings[openingIndex];
    const range = openingDomain.getOpeningRange(opening);
    const openingStartAlongMm = openingOriginAlongMm + range.startMm;
    const openingEndAlongMm = openingOriginAlongMm + range.endMm;
    for (let cutIndex = 0; cutIndex < interiorCuts.length; cutIndex += 1) {
      const cut = interiorCuts[cutIndex];
      const clearanceMm = resolveOpeningSplitClearanceMm(floor, originalWall, cut.node);
      if (
        openingEndAlongMm < cut.alongMm - clearanceMm ||
        openingStartAlongMm > cut.alongMm + clearanceMm
      ) {
        continue;
      }
      throw createSurveyDomainError(DOMAIN_ERROR_CODES.OPENING_SPLIT_CONFLICT, {
        wallId: originalWall.id,
        openingId: opening.id,
        cutAlongMm: cut.alongMm,
        clearanceMm
      });
    }
  }
}

function splitWallAtNodes(floor, wallId, cutNodeIds) {
  const wallIndex = floor.walls.findIndex((wall) => wall.id === wallId);
  const originalWall = floor.walls[wallIndex];
  if (wallIndex === -1 || !originalWall) return { sharedWallId: wallId, segmentIds: [wallId] };

  const originalAdjustmentMetadata = {
    hasRaw: Object.prototype.hasOwnProperty.call(originalWall, 'rawMeasuredLengthMm'),
    hasAdjustment: Object.prototype.hasOwnProperty.call(originalWall, 'closureAdjustmentMm'),
    rawMeasuredLengthMm: originalWall.rawMeasuredLengthMm,
    closureAdjustmentMm: originalWall.closureAdjustmentMm,
    adjustmentSource: originalWall.adjustmentSource,
    hasComplete: Object.prototype.hasOwnProperty.call(originalWall, 'rawMeasuredLengthMm') &&
      Object.prototype.hasOwnProperty.call(originalWall, 'closureAdjustmentMm') &&
      Number.isFinite(Number(originalWall.rawMeasuredLengthMm)) &&
      Number.isFinite(Number(originalWall.closureAdjustmentMm))
  };

  const wallLength = distanceMm(
    getNode(floor, originalWall.startNodeId),
    getNode(floor, originalWall.endNodeId)
  );
  const cutItems = uniqueCutNodesByAlong([
    { node: getNode(floor, originalWall.startNodeId), alongMm: 0 },
    ...cutNodeIds.map((nodeId) => ({
      node: getNode(floor, nodeId),
      alongMm: pointAlongWall(floor, originalWall, nodeId)
    })),
    { node: getNode(floor, originalWall.endNodeId), alongMm: wallLength }
  ]);
  assertSplitCutsAvoidOpenings(floor, originalWall, cutItems, wallLength);
  if (cutItems.length > 2) {
    preserveSharedWallBodyNormalSide(floor, originalWall);
  }

  const segmentRecords = [];
  for (let index = 0; index < cutItems.length - 1; index += 1) {
    const current = cutItems[index];
    const next = cutItems[index + 1];
    if (!current.node || !next.node || Math.abs(next.alongMm - current.alongMm) <= 1) {
      continue;
    }
    const wall = cloneWallSegment(
      originalWall,
      current.node.id,
      next.node.id,
      segmentRecords.length === 0 ? originalWall.id : undefined
    );
    segmentRecords.push({
      wall,
      startAlongMm: current.alongMm,
      endAlongMm: next.alongMm
    });
  }

  if (!segmentRecords.length) return { sharedWallId: wallId, segmentIds: [wallId] };
  const originalInsets = getWallMeasurementInsets(originalWall);
  const originalStartExtension = normalizeMeasurementExtension(originalWall.measurementStartExtensionMm);
  segmentRecords[0].wall.measurementStartInsetMm = originalInsets.start;
  segmentRecords[0].wall.measurementStartExtensionMm = originalStartExtension;
  segmentRecords[segmentRecords.length - 1].wall.measurementEndInsetMm = originalInsets.end;
  floor.walls.splice(wallIndex, 1, ...segmentRecords.map((record) => record.wall));
  refreshWallMetrics(floor);
  if (originalAdjustmentMetadata.hasComplete) {
    // Preserve the aggregate audit pair across a split without copying the
    // whole reading to every clone. Allocate the raw reading by each segment's
    // effective measured span; the final segment receives the rounding tail so
    // raw readings and adjustments still sum exactly to the original pair.
    const rawTotal = Math.max(0, Math.round(Number(originalAdjustmentMetadata.rawMeasuredLengthMm)));
    const totalMeasuredLength = segmentRecords.reduce(
      (total, record) => total + Math.max(0, Number(record.wall.lengthMm) || 0),
      0
    );
    let allocatedRaw = 0;
    segmentRecords.forEach((record, index) => {
      const rawMeasuredLengthMm = index === segmentRecords.length - 1
        ? rawTotal - allocatedRaw
        : (totalMeasuredLength > 0
          ? Math.floor(rawTotal * Math.max(0, Number(record.wall.lengthMm) || 0) / totalMeasuredLength)
          : 0);
      allocatedRaw += rawMeasuredLengthMm;
      record.wall.rawMeasuredLengthMm = rawMeasuredLengthMm;
      record.wall.closureAdjustmentMm = Math.round(record.wall.lengthMm - rawMeasuredLengthMm);
      if (originalAdjustmentMetadata.adjustmentSource) {
        record.wall.adjustmentSource = originalAdjustmentMetadata.adjustmentSource;
      }
    });
  } else {
    // Incomplete source metadata cannot be allocated safely. Keep the split
    // geometrically valid and require an explicit remeasure for new readings.
    segmentRecords.forEach((record) => {
      delete record.wall.rawMeasuredLengthMm;
      delete record.wall.closureAdjustmentMm;
      delete record.wall.adjustmentSource;
    });
  }
  replaceWallInSpaces(floor, originalWall.id, segmentRecords.map((record) => record.wall.id));
  remapOpeningsForSplitWall(floor, originalWall, segmentRecords);

  return {
    segmentIds: segmentRecords.map((record) => record.wall.id),
    getSegmentBetween(nodeAId, nodeBId) {
      return segmentRecords.find((record) => (
        (record.wall.startNodeId === nodeAId && record.wall.endNodeId === nodeBId) ||
        (record.wall.startNodeId === nodeBId && record.wall.endNodeId === nodeAId)
      ));
    }
  };
}

function normalizeOpeningToWall(floor, opening) {
  const wall = getWall(floor, opening.wallId);
  return openingDomain.normalizeOpeningToWall(opening, wall, {
    minimumSizeMm: MIN_OPENING_SIZE_MM,
    maximumWallRatio: MAX_OPENING_WALL_RATIO
  });
}

function normalizeOpeningsForWall(floor, wallId) {
  ensureOpenings(floor).forEach((opening) => {
    if (opening.wallId === wallId) {
      normalizeOpeningToWall(floor, opening);
      normalizeOpeningDirection(opening);
    }
  });
}

function getSingleSharedEndpoint(floor, wall) {
  if (!floor || !wall) return null;
  const startShared = floor.walls.some((item) => (
    item.id !== wall.id &&
    (item.startNodeId === wall.startNodeId || item.endNodeId === wall.startNodeId)
  ));
  const endShared = floor.walls.some((item) => (
    item.id !== wall.id &&
    (item.startNodeId === wall.endNodeId || item.endNodeId === wall.endNodeId)
  ));

  if (startShared === endShared) return null;
  return startShared
    ? { fixedNodeId: wall.startNodeId, movingNodeId: wall.endNodeId }
    : { fixedNodeId: wall.endNodeId, movingNodeId: wall.startNodeId };
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
  if (activeStartNode && activeWallCount + 1 >= directCloseWallCount) {
    // A final drag can land on the visible outer face of a perpendicular
    // closed wall. That is not the same topology point as the wall centre:
    // forcing it onto the centre line turns the visible vertical orange edge
    // into a diagonal/shared closure and later adds a wall thickness outward.
    const outerFaceProjection = rawOuterFaceProjection || findOuterFaceClosureProjection(floor, session, previewPoint);
    const sharedProjection = outerFaceProjection
      ? null
      : findAnySharedWallClosureProjection(floor, session, previewPoint);
    if (outerFaceProjection) {
      // Only use the merge path when the cursor lands precisely on an existing
      // topology endpoint (topologyNode non-null). A mid-wall outer-face hit
      // has no valid merge target node; forcing findMergeClosureCandidate here
      // picks the nearest existing endpoint which is NOT the actual contact
      // point, causing the new room to shift by up to a full wall thickness.
      // Use shared-wall insertion instead so confirmClosure splits the old wall
      // at the exact projection point and traces back along the boundary.
      const mergeCandidate = outerFaceProjection.topologyNode;
      const reversePreviewEdit = resolveLastWallReverseEdit(
        floor,
        session,
        anchor,
        previewPoint
      );
      if (mergeCandidate && !reversePreviewEdit) {
        session.closeCandidateNodeId = mergeCandidate.id;
        session.closeCandidateType = 'merge';
      } else {
        session.closeCandidateType = 'shared-wall';
      }
      // Always record the outer-face projection point as the close candidate
      // so that isDirectClosureHit fires when the user releases on the outer
      // face, regardless of whether a topology merge node was found.
      session.closeCandidatePoint = outerFaceProjection.point;
      session.closeCandidateSharedWallId = outerFaceProjection.wall.id;
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
      session.closeCandidatePoint = sharedProjection.point;
      session.closeCandidateType = 'shared-wall';
      session.closeCandidateSharedWallId = sharedProjection.wall.id;
      previewMeasurementEndInsetMm = resolveSharedClosureEndInsetMm(
        floor,
        session,
        anchor,
        previewPoint,
        sharedProjection.wall.id
      );
    } else if (session.activeSpaceSharedWallId && resolveLastWallReverseEdit(floor, session, anchor, previewPoint)) {
      session.closeCandidatePoint = previewPoint;
      session.closeCandidateType = 'shared-wall';
      session.closeCandidateSharedWallId = session.activeSpaceSharedWallId;
    } else if (
      activeWallCount + 1 >= inferredMergeWallCount &&
      canResolvePreviewStartClosure(
        floor,
        session,
        anchor,
        previewPoint,
        activeStartNode,
        { allowRejectedCandidate: true }
      )
    ) {
      session.closeCandidateNodeId = activeStartNode.id;
      session.closeCandidateType = 'start';
    } else if (activeWallCount + 1 >= inferredMergeWallCount) {
      const mergeCandidate = findMergeClosureCandidate(floor, session, previewPoint);
      if (mergeCandidate) {
        session.closeCandidateNodeId = mergeCandidate.id;
        session.closeCandidateType = mergeCandidate.id === activeStartNode.id && activeWallCount >= 3
          ? 'start'
          : 'merge';
      }
    }
  }

  if (partitionProjection) {
    session.closeCandidatePoint = partitionProjection.point;
    session.closeCandidateType = 'partition';
    session.closeCandidateSharedWallId = partitionProjection.wall.id;
  }

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
    const previousRawMeasuredLengthMm = Number.isFinite(Number(wall.rawMeasuredLengthMm))
      ? Math.round(Number(wall.rawMeasuredLengthMm))
      : Math.round(Number(wall.lengthMm) || getMeasuredWallLength(floor, wall));
    const combinedRawMeasuredLengthMm = extendLastWall
      ? previousRawMeasuredLengthMm + parsedLength
      : Math.max(0, previousRawMeasuredLengthMm - parsedLength);
    anchor.xMm = Math.round(endPoint.xMm);
    anchor.yMm = Math.round(endPoint.yMm);
    endNode = anchor;
    wall.lengthMm = getMeasuredWallLength(floor, wall);
    recordWallRawMeasurement(wall, combinedRawMeasuredLengthMm, 'coordinate-rounding');
    wall.angleDeg = angleDeg(getNode(floor, wall.startNodeId), endNode);
    wall.inputSource = inputSource || 'manual';
    wall.measuredAt = nowIso();
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
    recordWallRawMeasurement(wall, parsedLength, 'coordinate-rounding');
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
  if (partitionProjection && activeWallCount === 1) {
    session.state = SESSION_STATES.CLOSING;
    session.closeCandidateNodeId = endNode.id;
    session.closeCandidatePoint = partitionProjection.point;
    session.closeCandidateType = 'partition';
    session.closeCandidateSharedWallId = partitionProjection.wall.id;
    session.partitionSourceSpaceId = partitionProjection.sourceSpace.id;
  } else if (sharedProjection && activeWallCount >= 1) {
    session.state = SESSION_STATES.CLOSING;
    if (!session.activeSpaceSharedWallId) {
      session.activeSpaceSharedWallId = sharedProjection.wall.id;
    }
    session.closeCandidateNodeId = endNode.id;
    session.closeCandidatePoint = sharedProjection.point;
    session.closeCandidateType = 'shared-wall';
    session.closeCandidateSharedWallId = sharedProjection.wall.id;
  } else if (rayFallbackProjection && activeWallCount >= 1) {
    // The wall was clamped to a cross-boundary intersection at commit time.
    // Route through shared-wall so confirmClosure splits the target wall and
    // completes the room boundary.
    session.state = SESSION_STATES.CLOSING;
    session.closeCandidateNodeId = endNode.id;
    session.closeCandidatePoint = rayFallbackProjection.point;
    session.closeCandidateType = 'shared-wall';
    session.closeCandidateSharedWallId = rayFallbackProjection.wall.id;
    if (!session.activeSpaceSharedWallId) {
      session.activeSpaceSharedWallId = rayFallbackProjection.wall.id;
    }
  } else if (outerFaceProjection && activeWallCount >= 1) {
    // Only treat the outer-face hit as a merge when the cursor landed exactly
    // on a topology endpoint (topologyNode non-null). A mid-wall projection has
    // no valid existing node to merge to; calling findMergeClosureCandidate
    // would select the nearest existing endpoint, which is displaced from the
    // real contact point and causes the closed room to shift by a wall
    // thickness. Route mid-wall outer-face hits through shared-wall insertion
    // so confirmClosure splits the boundary wall at the exact point and traces
    // the shared boundary back to the chain's start node.
    const mergeCandidate = outerFaceProjection.topologyNode;
    if (mergeCandidate) {
      session.state = SESSION_STATES.MERGE_CLOSING;
      session.closeCandidateNodeId = mergeCandidate.id;
      session.closeCandidateType = 'merge';
    } else {
      // Mid-wall outer-face hit: use shared-wall insertion path.
      session.state = SESSION_STATES.CLOSING;
      session.closeCandidateNodeId = endNode.id;
      session.closeCandidatePoint = outerFaceProjection.point;
      session.closeCandidateType = 'shared-wall';
      session.closeCandidateSharedWallId = outerFaceProjection.wall.id;
    }
  } else if (directStartClosurePlan) {
    session.state = SESSION_STATES.CLOSING;
    session.closeCandidateNodeId = activeStartNode.id;
    session.closeCandidateType = 'start';
  } else {
    const minimumMergeWallCount = getMinimumClosureSuggestionWallCount(floor, session);
    const mergeCandidate = activeWallCount >= minimumMergeWallCount
      ? findMergeClosureCandidate(floor, session, endNode)
      : null;
    if (mergeCandidate) {
      session.state = SESSION_STATES.MERGE_CLOSING;
      session.closeCandidateNodeId = mergeCandidate.id;
      session.closeCandidateType = 'merge';
    } else {
      session.state = SESSION_STATES.WALL_COMMITTED;
    }
  }

  return touchDraft(next);
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

function resolvePreviewStartClosurePlan(floor, session, anchor, previewPoint, targetNode, options) {
  if (!floor || !session || !anchor || !previewPoint || !targetNode) return null;
  if (session.mode !== 'straight') return { type: 'snap' };
  const virtualFloor = JSON.parse(JSON.stringify(floor));
  const virtualSession = Object.assign({}, session);
  const virtualEndNode = {
    id: '__preview-close-end__',
    xMm: Math.round(previewPoint.xMm),
    yMm: Math.round(previewPoint.yMm)
  };
  virtualFloor.nodes.push(virtualEndNode);
  const virtualWall = {
    id: '__preview-close-wall__',
    startNodeId: anchor.id,
    endNodeId: virtualEndNode.id,
    mode: 'straight',
    lengthMm: distanceMm(anchor, virtualEndNode),
    thicknessMm: session.thicknessMm
  };
  virtualFloor.walls.push(virtualWall);
  virtualSession.anchorNodeId = virtualEndNode.id;
  const virtualTarget = getNode(virtualFloor, targetNode.id);
  return resolveStraightClosurePlan(
    virtualFloor,
    virtualSession,
    virtualWall,
    virtualTarget,
    options
  );
}

function canResolvePreviewStartClosure(floor, session, anchor, previewPoint, targetNode, options) {
  const plan = resolvePreviewStartClosurePlan(
    floor,
    session,
    anchor,
    previewPoint,
    targetNode,
    options
  );
  return !!(
    plan &&
    (
      (
        distanceMm(previewPoint, targetNode) <= CLOSE_TOLERANCE_MM &&
        (
          plan.type !== 'orthogonal-adjustment-rejected' ||
          (options && options.allowRejectedCandidate)
        )
      ) ||
      plan.type === 'orthogonal-adjustment'
    )
  );
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

function applyOrthogonalClosureAdjustmentPlan(floor, plan) {
  if (!floor || !plan || plan.type !== 'orthogonal-adjustment') return false;
  let currentPoint = {
    xMm: plan.entries[0].fromNode.xMm,
    yMm: plan.entries[0].fromNode.yMm
  };

  plan.entries.forEach((entry) => {
    const rawMeasuredLengthMm = Number.isFinite(Number(entry.wall.rawMeasuredLengthMm))
      ? Math.round(Number(entry.wall.rawMeasuredLengthMm))
      : Math.round(Number(entry.wall.lengthMm) || getMeasuredWallLength(floor, entry.wall));
    entry.wall.rawMeasuredLengthMm = rawMeasuredLengthMm;
    if (entry.axis === 'x') {
      entry.toNode.xMm = Math.round(currentPoint.xMm + entry.adjustedSignedLengthMm);
      entry.toNode.yMm = Math.round(currentPoint.yMm);
    } else {
      entry.toNode.xMm = Math.round(currentPoint.xMm);
      entry.toNode.yMm = Math.round(currentPoint.yMm + entry.adjustedSignedLengthMm);
    }
    currentPoint = { xMm: entry.toNode.xMm, yMm: entry.toNode.yMm };
  });

  refreshWallMetrics(floor);
  plan.entries.forEach((entry) => {
    const adjustmentMm = Math.round(entry.wall.lengthMm - entry.wall.rawMeasuredLengthMm);
    entry.wall.closureAdjustmentMm = adjustmentMm;
    if (adjustmentMm) {
      entry.wall.adjustmentSource = 'closure-balance';
    } else {
      delete entry.wall.adjustmentSource;
    }
  });
  return true;
}

function attachStraightWallToCloseNode(floor, wall, targetNode, inputSource) {
  if (!wall || !targetNode) return wall;
  const start = getNode(floor, wall.startNodeId);
  const end = getNode(floor, wall.endNodeId);
  if (!start || !end) return wall;
  if (end.id === targetNode.id) return wall;
  const keepAxis = wall.mode !== 'diagonal' && wallKeepsStrictAxis(start, end);
  if (!keepAxis || wallKeepsStrictAxis(start, targetNode)) {
    wall.endNodeId = targetNode.id;
    return wall;
  }
  if (!wallKeepsStrictAxis(end, targetNode) || distanceMm(end, targetNode) <= 0.001) {
    throw createSurveyDomainError(DOMAIN_ERROR_CODES.CLOSURE_OUT_OF_TOLERANCE, {
      toleranceMm: CLOSE_TOLERANCE_MM
    });
  }
  const bridge = {
    id: nextId('wall'),
    startNodeId: end.id,
    endNodeId: targetNode.id,
    mode: 'straight',
    lengthMm: distanceMm(end, targetNode),
    angleDeg: angleDeg(end, targetNode),
    thicknessMm: wall.thicknessMm,
    measurementSide: wall.measurementSide,
    bodyNormalSide: wall.bodyNormalSide || '',
    measurementStartInsetMm: 0,
    measurementStartExtensionMm: 0,
    measurementEndInsetMm: 0,
    inputSource: inputSource || 'closure-bridge',
    status: 'confirmed',
    measuredAt: nowIso()
  };
  floor.walls.push(bridge);
  return bridge;
}

function confirmClosure(draft) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const session = ensureSessionSpaceTracking(floor);
  const hasPreviewCloseCandidate = !!(
    session.previewPoint &&
    session.previewLengthMm >= MIN_WALL_LENGTH_MM &&
    (session.closeCandidateNodeId || session.closeCandidatePoint) &&
    (session.state === SESSION_STATES.WALL_PREVIEW || session.state === SESSION_STATES.AWAITING_LENGTH)
  );

  if (hasPreviewCloseCandidate) {
    const committed = commitPreviewLength(
      next,
      session.previewLengthMm,
      'closure-preview'
    );
    const committedState = getActiveFloor(committed).session.state;
    if (committedState !== SESSION_STATES.CLOSING && committedState !== SESSION_STATES.MERGE_CLOSING) {
      throw createSurveyDomainError(DOMAIN_ERROR_CODES.UNSAFE_CLOSURE);
    }
    return confirmClosure(committed);
  }

  if (session.state === SESSION_STATES.MERGE_CLOSING) {
    const anchor = getNode(floor, session.anchorNodeId);
    const closurePlan = findMergeClosurePlan(floor, session, anchor);
    const closeTargetNode = closurePlan && closurePlan.targetNode;
    if (!anchor || !closeTargetNode || closurePlan.points.length < 2) {
      throw createSurveyDomainError(DOMAIN_ERROR_CODES.UNSAFE_CLOSURE);
    }

    const closurePoints = closurePlan.points;
    const finalConnectorStart = closurePoints.length > 2
      ? closurePoints[closurePoints.length - 2]
      : null;
    const activeSharedWall = getWall(floor, session.activeSpaceSharedWallId);
    const activeSharedStart = activeSharedWall ? getNode(floor, activeSharedWall.startNodeId) : null;
    const activeSharedEnd = activeSharedWall ? getNode(floor, activeSharedWall.endNodeId) : null;
    const finalConnectorFollowsSharedWall = !!(
      finalConnectorStart &&
      activeSharedStart &&
      activeSharedEnd &&
      (
        isHorizontalSegment(finalConnectorStart, closeTargetNode) ===
          isHorizontalSegment(activeSharedStart, activeSharedEnd)
      )
    );

    let closureStartNode = anchor;
    closurePlan.points.slice(1).forEach((point, index, points) => {
      const closureEndNode = index === points.length - 1
        ? closeTargetNode
        : addNode(floor, point);
      let measurementEndInsetMm = index === points.length - 1
        ? resolveMeasurementEndInsetMm(
          floor,
          closureStartNode,
          closureEndNode,
          session.activeSpaceSharedWallId
        )
        : 0;
      if (index === points.length - 2 && finalConnectorFollowsSharedWall) {
        const targetAlignedStart = {
          xMm: closeTargetNode.xMm + closureStartNode.xMm - closureEndNode.xMm,
          yMm: closeTargetNode.yMm + closureStartNode.yMm - closureEndNode.yMm
        };
        measurementEndInsetMm = resolveMeasurementEndInsetMm(
          floor,
          targetAlignedStart,
          closeTargetNode,
          session.activeSpaceSharedWallId
        );
      }
      const measurementSide = resolveBoundaryAlignedMeasurementSide(
        floor,
        session,
        closureStartNode,
        closureEndNode
      );
      const lastWall = index === 0 ? getLastWall(floor) : null;
      // The inferred first closure leg may continue the last confirmed wall
      // after session-side restoration or switching has changed the current
      // measurement side. Geometry still represents one physical wall, so
      // test that continuation with the wall's persisted side.
      const continuationMeasurementSide = lastWall && lastWall.measurementSide
        ? lastWall.measurementSide
        : measurementSide;
      const extendLastWall = index === 0 && canExtendLastWall(
        floor,
        session,
        closureStartNode,
        closureEndNode,
        continuationMeasurementSide,
        false
      );
      if (extendLastWall) {
        lastWall.endNodeId = closureEndNode.id;
        lastWall.measurementEndInsetMm = measurementEndInsetMm;
        lastWall.lengthMm = getMeasuredWallLength(floor, lastWall);
        syncWallAdjustmentAfterMetricChange(lastWall);
        lastWall.angleDeg = angleDeg(getNode(floor, lastWall.startNodeId), closureEndNode);
        lastWall.inputSource = 'closure-merge';
        lastWall.measuredAt = nowIso();
      } else {
        floor.walls.push({
          id: nextId('wall'),
          startNodeId: closureStartNode.id,
          endNodeId: closureEndNode.id,
          mode: session.mode,
          lengthMm: Math.max(
            0,
            distanceMm(closureStartNode, closureEndNode) - measurementEndInsetMm
          ),
          angleDeg: angleDeg(closureStartNode, closureEndNode),
          thicknessMm: session.thicknessMm,
          measurementSide,
          bodyNormalSide: session.previewBodyNormalSide ||
            (session.activeSpaceSharedSnapLine === 'outer' ? measurementSide : ''),
          measurementStartInsetMm: 0,
          measurementEndInsetMm,
          inputSource: 'closure-merge',
          status: 'confirmed',
          measuredAt: nowIso()
        });
      }
      closureStartNode = closureEndNode;
    });
    session.anchorNodeId = closeTargetNode.id;
    session.state = SESSION_STATES.CLOSING;
    session.closeCandidateNodeId = closeTargetNode.id;
    session.closeCandidatePoint = null;
    let correctSharedWallId = session.activeSpaceSharedWallId;
    if (session.activeSpaceSharedWallId) {
      const activeWalls = (floor.walls || []).slice(session.activeSpaceStartWallIndex || 0);
      const activeWallIds = {};
      activeWalls.forEach((wall) => { activeWallIds[wall.id] = true; });
      const targetWall = (floor.walls || []).find((wall) => 
        !activeWallIds[wall.id] && (wall.startNodeId === closeTargetNode.id || wall.endNodeId === closeTargetNode.id)
      );
      if (targetWall) {
        correctSharedWallId = targetWall.id;
      }
    }
    session.closeCandidateType = correctSharedWallId ? 'shared-wall' : 'merge';
    session.closeCandidateSharedWallId = correctSharedWallId || '';
  }

  const startWallIndex = session.activeSpaceStartWallIndex || 0;
  const activeWallCount = Math.max(0, floor.walls.length - startWallIndex);
  const closeCandidateSharedWallId = session.closeCandidateSharedWallId;
  const minimumActiveWallCount = getMinimumActiveCloseWallCount(floor, session);

  if (session.state === SESSION_STATES.CLOSING && session.closeCandidateType === 'partition') {
    const partitionWall = getLastWall(floor);
    if (!partitionWall || !splitClosedSpaceWithPartition(floor, session, partitionWall)) {
      throw createSurveyDomainError(DOMAIN_ERROR_CODES.PARTITION_SPLIT_UNSAFE);
    }
    session.state = SESSION_STATES.SPACE_CLOSED;
    session.anchorNodeId = '';
    session.pendingWallId = '';
    session.selectedWallId = '';
    session.selectedOpeningId = '';
    session.closeCandidateNodeId = '';
    session.closeCandidatePoint = null;
    session.closeCandidateType = '';
    session.closeCandidateSharedWallId = '';
    session.partitionSourceSpaceId = '';
    session.previewPoint = null;
    session.previewLengthMm = 0;
    session.previewAngleDeg = 0;
    session.previewMeasurementSide = '';
    session.previewMeasurementStartInsetMm = 0;
    session.previewMeasurementStartExtensionMm = 0;
    session.previewMeasurementEndInsetMm = 0;
    session.alignmentSnapGuide = null;
    session.activeSpaceStartNodeId = '';
    session.activeSpaceStartWallIndex = floor.walls.length;
    session.activeSpaceSharedWallId = '';
    session.activeSpaceSharedStartT = null;
    session.activeSpaceSharedSnapLine = '';
    clearLastWallSnap(session);
    removeUnreferencedNodes(floor);
    return touchDraft(next);
  }

  if (session.state !== SESSION_STATES.CLOSING || (!session.closeCandidateNodeId && !session.closeCandidatePoint) || activeWallCount < minimumActiveWallCount) {
    return next;
  }

  let lastWall = getLastWall(floor);
  const oldEndNodeId = lastWall.endNodeId;
  const oldEndNode = getNode(floor, oldEndNodeId);
  let closeTargetNode = getNode(floor, session.closeCandidateNodeId);
  if (!closeTargetNode && session.closeCandidatePoint && closeCandidateSharedWallId) {
    const sharedWall = getWall(floor, closeCandidateSharedWallId);
    const sharedStart = sharedWall ? getNode(floor, sharedWall.startNodeId) : null;
    const sharedEnd = sharedWall ? getNode(floor, sharedWall.endNodeId) : null;
    const projection = projectPointToWallSegment(session.closeCandidatePoint, sharedStart, sharedEnd);
    if (projection) {
      projection.wall = sharedWall;
      projection.start = sharedStart;
      projection.end = sharedEnd;
      if (projection.t <= 0.0001) projection.node = sharedStart;
      if (projection.t >= 0.9999) projection.node = sharedEnd;
      closeTargetNode = getOrCreateSnapNode(floor, projection);
      session.closeCandidateNodeId = closeTargetNode ? closeTargetNode.id : '';
    }
  }
  if (!oldEndNode || !closeTargetNode) {
    throw createSurveyDomainError(DOMAIN_ERROR_CODES.CLOSURE_OUT_OF_TOLERANCE, {
      toleranceMm: CLOSE_TOLERANCE_MM
    });
  }

  const straightClosurePlan = resolveStraightClosurePlan(
    floor,
    session,
    lastWall,
    closeTargetNode
  );
  if (
    !straightClosurePlan ||
    (
      distanceMm(oldEndNode, closeTargetNode) > CLOSE_TOLERANCE_MM &&
      straightClosurePlan.type !== 'orthogonal-adjustment'
    )
  ) {
    throw createSurveyDomainError(DOMAIN_ERROR_CODES.CLOSURE_OUT_OF_TOLERANCE, {
      toleranceMm: CLOSE_TOLERANCE_MM
    });
  }
  if (straightClosurePlan.type === 'orthogonal-adjustment') {
    applyOrthogonalClosureAdjustmentPlan(floor, straightClosurePlan);
    lastWall = getLastWall(floor);
  }

  lastWall = attachStraightWallToCloseNode(
    floor,
    lastWall,
    closeTargetNode,
    'closure-bridge'
  );
  refreshWallMetrics(floor);
  mergeCollinearOpenChain(floor, startWallIndex);
  mergeCollinearDegree2Walls(floor);
  lastWall = getLastWall(floor);

  const newWallIds = floor.walls.slice(startWallIndex).map((wall) => wall.id);
  // A chain drawn into an existing closed room is an internal partition, even
  // when it needs two or more new walls before it reaches the old boundary.
  // Keep that source room's boundary faces on the room side. Treating every
  // inner-face restart as an adjacent-room close forces the reused exterior
  // walls to their offset faces and makes the child Space include wall bodies.
  const interiorSourceSpace = findActiveChainInteriorSourceSpace(
    floor,
    session,
    newWallIds
  );
  // The orange closing line is the live body reference. It can terminate on
  // the source room's inner face even when the new chain was measured toward
  // the exterior. A wall aligned to a neighbour's visible outer must keep that
  // outer as the working face; locking to measurementSide here would extrude
  // another thickness. Remaining empty sides still lock to the confirmed
  // measurement side before centroid inference can flip them.
  floor.walls.slice(startWallIndex).forEach((wall) => {
    const wallStart = getNode(floor, wall.startNodeId);
    const wallEnd = getNode(floor, wall.endNodeId);
    const outerBodySide = resolveCollinearClosedOuterBodySide(
      floor,
      wallStart,
      wallEnd,
      session.activeSpaceSharedWallId
    );
    if (outerBodySide) {
      wall.bodyNormalSide = outerBodySide;
      return;
    }
    if (
      session.closeCandidateType === 'shared-wall' &&
      !wall.bodyNormalSide &&
      (wall.measurementSide === 'left' || wall.measurementSide === 'right')
    ) {
      wall.bodyNormalSide = wall.measurementSide;
    }
  });
  const excludedWallIds = {};
  newWallIds.forEach((wallId) => { excludedWallIds[wallId] = true; });

  const sharedBoundaryWallIds = [
    session.activeSpaceSharedWallId,
    closeCandidateSharedWallId
  ].filter((wallId, index, list) => wallId && list.indexOf(wallId) === index);

  let sharedStartNodeId = session.activeSpaceStartNodeId;
  let sharedCloseNodeId = closeTargetNode.id;
  if (session.activeSpaceSharedWallId && session.activeSpaceStartNodeId) {
    const activeStartNode = getNode(floor, session.activeSpaceStartNodeId);
    const sharedStartNode = getOrCreateWallCenterNode(floor, session.activeSpaceSharedWallId, activeStartNode);
    if (sharedStartNode) sharedStartNodeId = sharedStartNode.id;
  }
  if (closeCandidateSharedWallId) {
    const sharedCloseNode = getOrCreateWallCenterNode(floor, closeCandidateSharedWallId, closeTargetNode);
    if (sharedCloseNode) sharedCloseNodeId = sharedCloseNode.id;
  }
  if (session.activeSpaceSharedWallId && sharedStartNodeId !== session.activeSpaceStartNodeId) {
    const firstWall = getWall(floor, newWallIds[0]);
    if (firstWall) {
      firstWall.startNodeId = sharedStartNodeId;
    }
  }

  // Outer-face closure ends one thickness off the topology centre-line. Keep
  // that working coordinate and add a short orthogonal bridge to the shared
  // corner instead of copying the off-axis vertex onto the last straight wall.
  if (closeCandidateSharedWallId && sharedCloseNodeId !== closeTargetNode.id) {
    lastWall = attachStraightWallToCloseNode(
      floor,
      lastWall,
      getNode(floor, sharedCloseNodeId),
      'closure-bridge'
    );
    if (lastWall && newWallIds.indexOf(lastWall.id) === -1) {
      newWallIds.push(lastWall.id);
      excludedWallIds[lastWall.id] = true;
    }
  }
  
  if ((session.activeSpaceSharedWallId && sharedStartNodeId !== session.activeSpaceStartNodeId) || 
      (closeCandidateSharedWallId && sharedCloseNodeId !== closeTargetNode.id)) {
    refreshWallMetrics(floor);
  }


  if (sharedBoundaryWallIds.length && session.activeSpaceStartNodeId) {
    sharedBoundaryWallIds.forEach((wallId) => {
      const sharedWall = getWall(floor, wallId);
      const sharedStart = sharedWall ? getNode(floor, sharedWall.startNodeId) : null;
      const sharedEnd = sharedWall ? getNode(floor, sharedWall.endNodeId) : null;
      const splitNodeIds = [sharedStartNodeId, sharedCloseNodeId].filter((nodeId) => {
        const node = getNode(floor, nodeId);
        const projection = projectPointToWallSegment(node, sharedStart, sharedEnd);
        return projection && projection.distanceMm <= CLOSE_TOLERANCE_MM;
      });
      splitWallAtNodes(floor, wallId, splitNodeIds);
    });
  }

  const sharedWallIds = session.activeSpaceStartNodeId
    ? findWallPathBetweenNodes(floor, sharedCloseNodeId, sharedStartNodeId, excludedWallIds)
    : [];
  if (sharedBoundaryWallIds.length && !sharedWallIds.length && !closeCandidateSharedWallId) {
    throw createSurveyDomainError(DOMAIN_ERROR_CODES.SHARED_BOUNDARY_DISCONNECTED);
  }

  const inheritOverrides = !interiorSourceSpace &&
    session.activeSpaceSharedSnapLine === 'inner' &&
    sharedWallIds.length
    ? {
      wallIds: sharedWallIds,
      face: 'offset',
      preferWallIds: newWallIds
    }
    : null;
  syncFloorSpaces(floor, inheritOverrides);
  const wallCountBeforeRepair = (floor.walls || []).length;
  mergeCollinearDegree2Walls(floor);
  if ((floor.walls || []).length !== wallCountBeforeRepair) {
    syncFloorSpaces(floor, inheritOverrides);
  }

  session.state = SESSION_STATES.SPACE_CLOSED;
  session.anchorNodeId = '';
  session.pendingWallId = '';
  session.selectedWallId = '';
  session.selectedOpeningId = '';
  session.closeCandidateNodeId = '';
  session.closeCandidatePoint = null;
  session.closeCandidateType = '';
  session.closeCandidateSharedWallId = '';
  session.previewPoint = null;
  session.previewLengthMm = 0;
  session.previewAngleDeg = 0;
  session.previewMeasurementSide = '';
  session.previewMeasurementStartInsetMm = 0;
  session.previewMeasurementStartExtensionMm = 0;
  session.previewMeasurementEndInsetMm = 0;
  session.alignmentSnapGuide = null;
  session.closedFromNodeId = oldEndNodeId;
  session.activeSpaceStartNodeId = '';
  session.activeSpaceStartWallIndex = floor.walls.length;
  session.activeSpaceSharedWallId = '';
  session.activeSpaceSharedStartT = null;
  session.activeSpaceSharedSnapLine = '';
  // Closing can fold two collinear walls into one and remove their joint node.
  // Once the chain is a closed Space, the prior cursor-drop memory is no
  // longer a valid restart target and must not fail session validation.
  clearLastWallSnap(session);
  removeUnreferencedNodes(floor);

  return touchDraft(next);
}

function getClosedSpace(floor, spaceId) {
  if (!spaceId) return null;
  return (floor.spaces || []).find((space) => (
    space && space.id === spaceId && space.closed && Array.isArray(space.wallIds)
  )) || null;
}

function clearObjectSelection(session) {
  if (!session) return;
  session.selectedWallId = '';
  session.selectedOpeningId = '';
  session.selectedSpaceId = '';
}

function collectExclusiveClosedSpaceWallIds(floor, space) {
  const closedSpaces = (floor.spaces || []).filter((item) => (
    item && item.closed && Array.isArray(item.wallIds)
  ));
  const wallRefCounts = {};
  closedSpaces.forEach((item) => {
    item.wallIds.forEach((wallId) => {
      wallRefCounts[wallId] = (wallRefCounts[wallId] || 0) + 1;
    });
  });
  return (space.wallIds || []).filter((wallId) => wallRefCounts[wallId] === 1);
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

function deleteClosedSpace(draft, spaceId) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const session = ensureSessionSpaceTracking(floor);
  const space = getClosedSpace(floor, spaceId || session.selectedSpaceId);
  if (!space) return next;

  const exclusiveWallIds = collectExclusiveClosedSpaceWallIds(floor, space);
  if (!exclusiveWallIds.length) {
    // Shared-only loop: removing the space identity is not supported; keep geometry.
    clearObjectSelection(session);
    session.state = SESSION_STATES.SPACE_CLOSED;
    session.anchorNodeId = '';
    return touchDraft(next);
  }

  const removedWallIds = new Set(exclusiveWallIds);
  const deletedWalls = [...removedWallIds].map((id) => getWall(floor, id)).filter(Boolean);
  const deletedNodeIds = [...new Set(deletedWalls.flatMap((item) => [item.startNodeId, item.endNodeId]))];
  const seedNode = deletedWalls[0]
    ? getNode(floor, deletedWalls[0].startNodeId)
    : null;

  floor.walls = floor.walls.filter((item) => !removedWallIds.has(item.id));
  floor.openings = ensureOpenings(floor).filter((opening) => !removedWallIds.has(opening.wallId));
  const repairedBoundaryWallIds = deletedNodeIds.flatMap((nodeId) => recomputeSplitNodeBodyInsets(floor, nodeId));
  syncFloorSpaces(floor);
  refreshWallMetrics(floor);
  if (repairedBoundaryWallIds.length) {
    const repairedWallIdSet = new Set(repairedBoundaryWallIds);
    ensureOpenings(floor).forEach((opening) => {
      if (repairedWallIdSet.has(opening.wallId)) normalizeOpeningToWall(floor, opening);
    });
  }

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
  session.closedFromNodeId = '';
  session.fixedNodeId = '';
  session.lastWallSnapNodeId = '';
  session.lastWallSnapWallId = '';
  session.lastWallSnapT = null;
  session.lastWallSnapLine = '';
  session.activeSpaceStartNodeId = '';
  session.activeSpaceStartWallIndex = floor.walls.length;
  session.activeSpaceSharedWallId = '';
  session.activeSpaceSharedStartT = null;
  session.activeSpaceSharedSnapLine = '';
  clearObjectSelection(session);

  const closedAfter = (floor.spaces || []).filter((item) => item && item.closed).length;
  const restoreEndpoints = deletedWalls[0]
    ? [deletedWalls[0].startNodeId, deletedWalls[0].endNodeId]
    : ['', ''];
  const restoredOpenedChain = !closedAfter &&
    restoreOpenedSpaceChain(floor, session, restoreEndpoints[0], restoreEndpoints[1]);
  if (!restoredOpenedChain) {
    if (closedAfter) {
      session.anchorNodeId = '';
      session.state = SESSION_STATES.SPACE_CLOSED;
    } else if (floor.walls.length) {
      const lastEnd = getLastEndNode(floor);
      session.anchorNodeId = lastEnd ? lastEnd.id : '';
      session.state = SESSION_STATES.WALL_COMMITTED;
    } else if (seedNode) {
      session.anchorNodeId = seedNode.id;
      session.state = SESSION_STATES.CURSOR_PLACED;
    } else {
      session.anchorNodeId = '';
      session.state = SESSION_STATES.IDLE;
    }
  }

  removeUnreferencedNodes(floor);
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

function wallsShareEndpoint(first, second) {
  return !!(first && second && (
    first.startNodeId === second.startNodeId ||
    first.startNodeId === second.endNodeId ||
    first.endNodeId === second.startNodeId ||
    first.endNodeId === second.endNodeId
  ));
}

function wallsAreCollinear(floor, first, second) {
  const firstStart = getNode(floor, first.startNodeId);
  const firstEnd = getNode(floor, first.endNodeId);
  const secondStart = getNode(floor, second.startNodeId);
  const secondEnd = getNode(floor, second.endNodeId);
  if (!firstStart || !firstEnd || !secondStart || !secondEnd) return false;
  const firstDx = firstEnd.xMm - firstStart.xMm;
  const firstDy = firstEnd.yMm - firstStart.yMm;
  const secondDx = secondEnd.xMm - secondStart.xMm;
  const secondDy = secondEnd.yMm - secondStart.yMm;
  return Math.abs(firstDx * secondDy - firstDy * secondDx) <= 1;
}

function collectCollinearSharedWallIds(floor, sharedWallIds, seedWallId) {
  const sharedSet = new Set((sharedWallIds || []).filter(Boolean));
  sharedSet.add(seedWallId);
  const collected = new Set([seedWallId]);
  let expanded = true;
  while (expanded) {
    expanded = false;
    sharedSet.forEach((wallId) => {
      if (collected.has(wallId)) return;
      const candidate = getWall(floor, wallId);
      if (!candidate) return;
      const connected = [...collected].some((existingId) => {
        const existing = getWall(floor, existingId);
        return existing && wallsShareEndpoint(existing, candidate) && wallsAreCollinear(floor, existing, candidate);
      });
      if (!connected) return;
      collected.add(wallId);
      expanded = true;
    });
  }
  return [...collected];
}

function planRemovedWallsForDeletedSharedWall(floor, wallId) {
  // Two room faces separated by one physical wall become one face when that
  // wall is removed. A split shared wall is still one interface: deleting any
  // collinear shared segment punches through the whole run.
  const affectedSpaces = (floor.spaces || []).filter((space) => (
    space && space.closed && Array.isArray(space.wallIds) &&
    space.wallIds.indexOf(wallId) !== -1
  ));
  if (affectedSpaces.length !== 2) return [wallId];
  const secondWallIds = new Set(affectedSpaces[1].wallIds);
  const sharedWallIds = affectedSpaces[0].wallIds.filter((id) => secondWallIds.has(id));
  if (!sharedWallIds.length || sharedWallIds.indexOf(wallId) === -1) return [wallId];
  return collectCollinearSharedWallIds(floor, sharedWallIds, wallId);
}

function clearDeletedSharedWallBoundaryInsets(floor, deletedWalls) {
  const walls = Array.isArray(deletedWalls) ? deletedWalls.filter(Boolean) : [deletedWalls];
  if (!floor || !walls.length) return [];
  const deletedNodeIds = new Set();
  walls.forEach((deletedWall) => {
    if (deletedWall.startNodeId) deletedNodeIds.add(deletedWall.startNodeId);
    if (deletedWall.endNodeId) deletedNodeIds.add(deletedWall.endNodeId);
  });
  const repairedWallIds = [];
  (floor.walls || []).forEach((boundaryWall) => {
    const startInsetMm = normalizeMeasurementInset(boundaryWall.measurementStartInsetMm);
    const clearsStartInset = deletedNodeIds.has(boundaryWall.startNodeId) && startInsetMm > 0;
    const clearsEndInset = deletedNodeIds.has(boundaryWall.endNodeId) &&
      normalizeMeasurementInset(boundaryWall.measurementEndInsetMm) > 0;
    if (clearsStartInset) {
      ensureOpenings(floor).forEach((opening) => {
        if (opening.wallId === boundaryWall.id) {
          opening.centerOffsetMm = Math.round((opening.centerOffsetMm || 0) + startInsetMm);
        }
      });
      boundaryWall.measurementStartInsetMm = 0;
    }
    if (clearsEndInset) {
      boundaryWall.measurementEndInsetMm = 0;
    }
    if (clearsStartInset || clearsEndInset) repairedWallIds.push(boundaryWall.id);
  });
  return repairedWallIds;
}

function refreshStandaloneClosureSuggestion(floor, session) {
  session.closeCandidateNodeId = '';
  session.closeCandidatePoint = null;
  session.closeCandidateType = '';
  session.closeCandidateSharedWallId = '';
  const anchor = getNode(floor, session.anchorNodeId);
  const activeStartNode = getNode(floor, session.activeSpaceStartNodeId);
  const startWallIndex = Number.isInteger(session.activeSpaceStartWallIndex)
    ? session.activeSpaceStartWallIndex
    : 0;
  const activeWallCount = Math.max(0, (floor.walls || []).length - startWallIndex);
  if (!anchor || !activeStartNode || activeWallCount < 2) {
    session.state = SESSION_STATES.WALL_COMMITTED;
    return;
  }
  const lastWall = getLastWall(floor);
  const startClosurePlan = activeWallCount >= 3 && lastWall
    ? resolveStraightClosurePlan(floor, session, lastWall, activeStartNode)
    : null;
  if (startClosurePlan && (
    distanceMm(anchor, activeStartNode) <= CLOSE_TOLERANCE_MM ||
    startClosurePlan.type === 'orthogonal-adjustment'
  )) {
    session.state = SESSION_STATES.CLOSING;
    session.closeCandidateNodeId = activeStartNode.id;
    session.closeCandidateType = 'start';
    return;
  }
  const mergeCandidate = findMergeClosureCandidate(floor, session, anchor);
  if (mergeCandidate) {
    session.state = SESSION_STATES.MERGE_CLOSING;
    session.closeCandidateNodeId = mergeCandidate.id;
    session.closeCandidateType = 'merge';
    return;
  }
  session.state = SESSION_STATES.WALL_COMMITTED;
}

function restoreOpenedSpaceChain(floor, session, fromNodeId, toNodeId) {
  if (!floor || !session || !fromNodeId || !toNodeId || fromNodeId === toNodeId) return false;
  const pathWallIds = findWallPathBetweenNodes(floor, fromNodeId, toNodeId, {});
  if (pathWallIds.length < 2) return false;

  const pathIdSet = {};
  pathWallIds.forEach((wallId) => { pathIdSet[wallId] = true; });
  const otherWalls = (floor.walls || []).filter((wall) => !pathIdSet[wall.id]);
  const pathWalls = pathWallIds.map((wallId) => getWall(floor, wallId)).filter(Boolean);
  if (pathWalls.length !== pathWallIds.length) return false;

  const oriented = [];
  let previousNodeId = fromNodeId;
  for (let index = 0; index < pathWalls.length; index += 1) {
    const wall = pathWalls[index];
    if (wall.startNodeId === previousNodeId) {
      oriented.push({ wall, reverse: false });
      previousNodeId = wall.endNodeId;
    } else if (wall.endNodeId === previousNodeId) {
      oriented.push({ wall, reverse: true });
      previousNodeId = wall.startNodeId;
    } else {
      return false;
    }
  }
  if (previousNodeId !== toNodeId) return false;

  oriented.forEach((entry) => {
    if (entry.reverse) reverseWallDirection(floor, entry.wall);
  });
  floor.walls = otherWalls.concat(oriented.map((entry) => entry.wall));
  refreshWallMetrics(floor);
  session.activeSpaceStartNodeId = fromNodeId;
  session.activeSpaceStartWallIndex = otherWalls.length;
  session.activeSpaceSharedWallId = '';
  session.activeSpaceSharedStartT = null;
  session.activeSpaceSharedWallMiddle = false;
  session.activeSpaceSharedSnapLine = '';
  session.anchorNodeId = toNodeId;
  refreshStandaloneClosureSuggestion(floor, session);
  return true;
}

function findConnectedDanglingPartner(floor, nodeId) {
  if (!floor || !nodeId) return '';
  const degrees = {};
  (floor.walls || []).forEach((wall) => {
    if (!wall) return;
    degrees[wall.startNodeId] = (degrees[wall.startNodeId] || 0) + 1;
    degrees[wall.endNodeId] = (degrees[wall.endNodeId] || 0) + 1;
  });
  if ((degrees[nodeId] || 0) !== 1) return '';
  const connected = Object.keys(degrees).filter((otherId) => (
    otherId !== nodeId &&
    degrees[otherId] === 1 &&
    findWallPathBetweenNodes(floor, otherId, nodeId, {}).length >= 2
  ));
  return connected.length === 1 ? connected[0] : '';
}

function resumeOpenChainAtDanglingNode(floor, session, nodeId) {
  const partnerId = findConnectedDanglingPartner(floor, nodeId);
  return !!(partnerId && restoreOpenedSpaceChain(floor, session, partnerId, nodeId));
}

function deleteWall(draft, wallId) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const session = ensureSessionSpaceTracking(floor);
  const targetId = wallId || session.selectedWallId;
  const wall = getWall(floor, targetId);
  if (!wall) return next;

  const wallIndex = floor.walls.findIndex((item) => item.id === targetId);
  const activeStartWallIndex = session.activeSpaceStartWallIndex;
  const deletesClosedSpaceWall = (floor.spaces || []).some((space) => (
    space && space.closed && Array.isArray(space.wallIds) && space.wallIds.indexOf(targetId) !== -1
  ));
  // Removing only the current chain's tail leaves a valid in-progress path.
  // Preserve its start so the preceding wall can still use rectangle alignment.
  const preserveActiveChain = !deletesClosedSpaceWall &&
    wallIndex === floor.walls.length - 1 &&
    wallIndex >= activeStartWallIndex &&
    wallIndex > activeStartWallIndex;
  const punchThroughSharedWall = (floor.spaces || []).filter((space) => (
    space && space.closed && Array.isArray(space.wallIds) && space.wallIds.indexOf(targetId) !== -1
  )).length === 2;
  const removedWallIds = new Set(planRemovedWallsForDeletedSharedWall(floor, targetId));
  removedWallIds.add(targetId);
  const deletedWalls = [...removedWallIds].map((id) => getWall(floor, id)).filter(Boolean);
  const deletedNodeIds = [...new Set(deletedWalls.flatMap((item) => [item.startNodeId, item.endNodeId]))];
  const deletedStartNode = getNode(floor, wall.startNodeId);
  floor.walls = floor.walls.filter((item) => !removedWallIds.has(item.id));
  floor.openings = ensureOpenings(floor).filter((opening) => !removedWallIds.has(opening.wallId));
  let repairedBoundaryWallIds = deletedNodeIds.flatMap((nodeId) => recomputeSplitNodeBodyInsets(floor, nodeId));
  if (punchThroughSharedWall) {
    repairedBoundaryWallIds = repairedBoundaryWallIds.concat(
      clearDeletedSharedWallBoundaryInsets(floor, deletedWalls)
    );
  }
  syncFloorSpaces(floor);

  refreshWallMetrics(floor);
  if (repairedBoundaryWallIds.length) {
    const repairedWallIdSet = new Set(repairedBoundaryWallIds);
    ensureOpenings(floor).forEach((opening) => {
      if (repairedWallIdSet.has(opening.wallId)) normalizeOpeningToWall(floor, opening);
    });
  }

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
  session.closedFromNodeId = '';
  session.selectedWallId = '';
  session.selectedOpeningId = '';
  session.selectedSpaceId = '';
  // Remeasure may pin either endpoint. After the wall (and its free tip) are
  // gone, a leftover fixedNodeId fails session validation as MISSING_SESSION_NODE.
  session.fixedNodeId = '';
  // A deleted wall invalidates the previous cursor/wall snap. Keeping it lets
  // resetCursor restore a node that no longer belongs to the edited chain.
  session.lastWallSnapNodeId = '';
  session.lastWallSnapWallId = '';
  session.lastWallSnapT = null;
  session.lastWallSnapLine = '';
  if (!preserveActiveChain) {
    session.activeSpaceStartNodeId = '';
    session.activeSpaceStartWallIndex = floor.walls.length;
    session.activeSpaceSharedWallId = '';
    session.activeSpaceSharedStartT = null;
    session.activeSpaceSharedSnapLine = '';
  }

  const closedAfter = (floor.spaces || []).filter((space) => space && space.closed).length;
  const restoredOpenedChain = deletesClosedSpaceWall &&
    !punchThroughSharedWall &&
    !closedAfter &&
    restoreOpenedSpaceChain(floor, session, wall.startNodeId, wall.endNodeId);
  if (!restoredOpenedChain) {
    if (deletesClosedSpaceWall && closedAfter) {
      session.anchorNodeId = '';
      session.state = SESSION_STATES.SPACE_CLOSED;
    } else if (floor.walls.length) {
      const lastEnd = getLastEndNode(floor);
      session.anchorNodeId = lastEnd ? lastEnd.id : '';
      session.state = SESSION_STATES.WALL_COMMITTED;
    } else if (deletedStartNode) {
      session.anchorNodeId = deletedStartNode.id;
      session.state = SESSION_STATES.CURSOR_PLACED;
    } else {
      session.anchorNodeId = '';
      session.state = SESSION_STATES.IDLE;
    }
  }

  removeUnreferencedNodes(floor);
  return touchDraft(next);
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

function assertOpeningsFitMeasuredLength(floor, wall, prospectiveMeasuredLengthMm) {
  const openings = ensureOpenings(floor).filter((opening) => opening.wallId === wall.id);
  for (const opening of openings) {
    const range = openingDomain.getOpeningRange(opening);
    if (range.startMm < -1 || range.endMm > prospectiveMeasuredLengthMm + 1) {
      throw createSurveyDomainError(DOMAIN_ERROR_CODES.OPENING_REMEASURE_CONFLICT, {
        wallId: wall.id,
        openingId: opening.id,
        prospectiveMeasuredLengthMm
      });
    }
  }
}

function buildClosedOrthogonalRemeasurePlan(floor, space, selectedWall, fixedNodeId, measuredLengthMm) {
  if (!floor || !space || !selectedWall || !fixedNodeId) return null;
  const wallIds = Array.isArray(space.wallIds) ? space.wallIds : [];
  const walls = wallIds.map((wallId) => getWall(floor, wallId)).filter(Boolean);
  if (walls.length !== wallIds.length || walls.length < 4) return null;
  const cycleWallIds = new Set(wallIds);
  if (!cycleWallIds.has(selectedWall.id)) return null;

  const adjacency = new Map();
  walls.forEach((wall) => {
    [wall.startNodeId, wall.endNodeId].forEach((nodeId) => {
      const values = adjacency.get(nodeId) || [];
      values.push(wall);
      adjacency.set(nodeId, values);
    });
  });
  if ([...adjacency.values()].some((values) => values.length !== 2)) return null;
  for (const nodeId of adjacency.keys()) {
    const incidentWalls = (floor.walls || []).filter((wall) => (
      wall.startNodeId === nodeId || wall.endNodeId === nodeId
    ));
    if (incidentWalls.length !== 2 || incidentWalls.some((wall) => !cycleWallIds.has(wall.id))) {
      return null;
    }
  }
  if (walls.some((wall) => {
    const owners = findClosedSpacesForWall(floor, wall.id);
    return owners.length !== 1 || owners[0].id !== space.id;
  })) return null;

  const entries = [];
  const usedWallIds = new Set();
  let currentNode = getNode(floor, fixedNodeId);
  let currentWall = selectedWall;
  let selectedAxis = '';
  while (currentNode && currentWall && !usedWallIds.has(currentWall.id)) {
    const nextNodeId = currentWall.startNodeId === currentNode.id
      ? currentWall.endNodeId
      : (currentWall.endNodeId === currentNode.id ? currentWall.startNodeId : '');
    const nextNode = getNode(floor, nextNodeId);
    if (!nextNode || currentWall.mode === 'diagonal' || !wallKeepsStrictAxis(currentNode, nextNode)) {
      return null;
    }
    const dx = nextNode.xMm - currentNode.xMm;
    const dy = nextNode.yMm - currentNode.yMm;
    const axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
    const sign = Math.sign(axis === 'x' ? dx : dy);
    const insets = getWallMeasurementInsets(currentWall);
    const currentCoordinateLengthMm = Math.abs(axis === 'x' ? dx : dy);
    if (currentWall.id === selectedWall.id) selectedAxis = axis;
    const existingRawMeasuredLengthMm = Number.isFinite(Number(currentWall.rawMeasuredLengthMm))
      ? Math.round(Number(currentWall.rawMeasuredLengthMm))
      : Math.round(Number(currentWall.lengthMm) || getMeasuredWallLength(floor, currentWall));
    const rawMeasuredLengthMm = currentWall.id === selectedWall.id
      ? measuredLengthMm
      : existingRawMeasuredLengthMm;
    const coordinateLengthMm = currentWall.id === selectedWall.id
      ? rawMeasuredLengthMm + insets.start + insets.end -
        normalizeMeasurementExtension(currentWall.measurementStartExtensionMm)
      : currentCoordinateLengthMm;
    if (coordinateLengthMm < MIN_WALL_LENGTH_MM || !sign) return null;
    entries.push({
      wall: currentWall,
      fromNode: currentNode,
      toNode: nextNode,
      axis,
      rawMeasuredLengthMm,
      signedLengthMm: sign * coordinateLengthMm,
      adjustedSignedLengthMm: sign * coordinateLengthMm
    });
    usedWallIds.add(currentWall.id);
    currentNode = nextNode;
    currentWall = (adjacency.get(currentNode.id) || []).find((wall) => !usedWallIds.has(wall.id));
  }
  if (usedWallIds.size !== walls.length || !currentNode || currentNode.id !== fixedNodeId) return null;
  if (!selectedAxis) return null;

  for (const axis of ['x', 'y']) {
    const residualMm = entries
      .filter((entry) => entry.axis === axis)
      .reduce((total, entry) => total + entry.adjustedSignedLengthMm, 0);
    if (!residualMm) continue;
    if (axis !== selectedAxis) return null;
    const adjustable = entries.filter((entry) => (
      entry.axis === axis && entry.wall.id !== selectedWall.id
    ));
    if (!adjustable.length) return null;
    const totalLengthMm = adjustable.reduce(
      (total, entry) => total + Math.abs(entry.signedLengthMm),
      0
    );
    let remainingCorrectionMm = -residualMm;
    adjustable.forEach((entry, index) => {
      const correctionMm = index === adjustable.length - 1
        ? remainingCorrectionMm
        : Math.round(-residualMm * Math.abs(entry.signedLengthMm) / totalLengthMm);
      entry.adjustedSignedLengthMm += correctionMm;
      remainingCorrectionMm -= correctionMm;
    });
  }

  if (entries.some((entry) => (
    Math.sign(entry.adjustedSignedLengthMm) !== Math.sign(entry.signedLengthMm) ||
    Math.abs(entry.adjustedSignedLengthMm) < MIN_WALL_LENGTH_MM
  ))) return null;

  // A balanced cycle can move more than the selected wall alone. Check every
  // opening against its prospective measured span before touching any node so
  // a short remeasure cannot silently leave an opening outside its host wall.
  for (const entry of entries) {
    const insets = getWallMeasurementInsets(entry.wall);
    const coordinateLengthMm = Math.abs(entry.adjustedSignedLengthMm);
    const prospectiveMeasuredLengthMm = Math.max(
      0,
      coordinateLengthMm - insets.start +
        normalizeMeasurementExtension(entry.wall.measurementStartExtensionMm) -
        insets.end
    );
    assertOpeningsFitMeasuredLength(floor, entry.wall, prospectiveMeasuredLengthMm);
  }
  return { entries, fixedNode: getNode(floor, fixedNodeId), selectedAxis };
}

function applyClosedOrthogonalRemeasurePlan(floor, plan, selectedWall, inputSource) {
  if (!floor || !plan || !plan.fixedNode || !plan.entries.length) return false;
  let currentPoint = { xMm: plan.fixedNode.xMm, yMm: plan.fixedNode.yMm };
  plan.entries.forEach((entry, index) => {
    const nextPoint = entry.axis === 'x'
      ? { xMm: Math.round(currentPoint.xMm + entry.adjustedSignedLengthMm), yMm: currentPoint.yMm }
      : { xMm: currentPoint.xMm, yMm: Math.round(currentPoint.yMm + entry.adjustedSignedLengthMm) };
    if (index < plan.entries.length - 1) {
      entry.toNode.xMm = nextPoint.xMm;
      entry.toNode.yMm = nextPoint.yMm;
    }
    currentPoint = nextPoint;
  });
  if (currentPoint.xMm !== plan.fixedNode.xMm || currentPoint.yMm !== plan.fixedNode.yMm) {
    return false;
  }

  refreshWallMetrics(floor);
  const adjustedAt = nowIso();
  plan.entries.forEach((entry) => {
    if (entry.axis !== plan.selectedAxis) return;
    const adjustmentMm = Math.round(entry.wall.lengthMm - entry.rawMeasuredLengthMm);
    entry.wall.rawMeasuredLengthMm = entry.rawMeasuredLengthMm;
    entry.wall.closureAdjustmentMm = adjustmentMm;
    if (adjustmentMm) {
      entry.wall.adjustmentSource = 'remeasure-balance';
    } else {
      delete entry.wall.adjustmentSource;
    }
  });
  selectedWall.inputSource = inputSource || 'manual';
  selectedWall.measuredAt = adjustedAt;
  return true;
}

function remeasureSelectedWall(draft, lengthMm, inputSource) {
  const parsedLength = validateLength(lengthMm);
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const session = floor.session;
  const wall = getWall(floor, session.selectedWallId);
  if (!wall || session.state !== SESSION_STATES.REMEASURE_AWAITING_INPUT) {
    throw createSurveyDomainError(DOMAIN_ERROR_CODES.REMEASURE_SELECTION_REQUIRED);
  }

  const sharedEndpoint = getSingleSharedEndpoint(floor, wall);
  const fixedNodeId = session.fixedNodeId || (sharedEndpoint ? sharedEndpoint.fixedNodeId : wall.startNodeId);
  const closedSpaces = findClosedSpacesForWall(floor, wall.id);
  if (closedSpaces.length > 1) {
    throw createSurveyDomainError(DOMAIN_ERROR_CODES.SHARED_WALL_REMEASURE_UNSUPPORTED);
  }
  if (closedSpaces.length === 1) {
    const closedPlan = buildClosedOrthogonalRemeasurePlan(
      floor,
      closedSpaces[0],
      wall,
      fixedNodeId,
      parsedLength
    );
    if (!closedPlan || !applyClosedOrthogonalRemeasurePlan(floor, closedPlan, wall, inputSource)) {
      throw createSurveyDomainError(DOMAIN_ERROR_CODES.CLOSED_REMEASURE_UNSAFE);
    }
    session.state = SESSION_STATES.SPACE_CLOSED;
    session.anchorNodeId = '';
    session.selectedWallId = wall.id;
    session.selectedOpeningId = '';
    session.fixedNodeId = '';
    return touchDraft(next);
  }

  const movingNodeId = fixedNodeId === wall.startNodeId ? wall.endNodeId : wall.startNodeId;
  const fixedNode = getNode(floor, fixedNodeId);
  const movingNode = getNode(floor, movingNodeId);
  if (!fixedNode || !movingNode) {
    throw createSurveyDomainError(DOMAIN_ERROR_CODES.INVALID_REMEASURE_ENDPOINT);
  }
  const movingNodeShared = (floor.walls || []).some((item) => (
    item.id !== wall.id && (item.startNodeId === movingNodeId || item.endNodeId === movingNodeId)
  ));
  if (movingNodeShared) {
    throw createSurveyDomainError(DOMAIN_ERROR_CODES.REMEASURE_CONNECTED_ENDPOINT);
  }
  const rawDx = movingNode.xMm - fixedNode.xMm;
  const rawDy = movingNode.yMm - fixedNode.yMm;
  const safeLength = Math.hypot(rawDx, rawDy) || 1;
  const dx = rawDx / safeLength;
  const dy = rawDy / safeLength;

  const insets = getWallMeasurementInsets(wall);
  const coordinateLength = parsedLength + insets.start + insets.end -
    normalizeMeasurementExtension(wall.measurementStartExtensionMm);
  if (coordinateLength < MIN_WALL_LENGTH_MM) {
    throw createSurveyDomainError(DOMAIN_ERROR_CODES.REMEASURE_LENGTH_TOO_SHORT, {
      minimumMm: MIN_WALL_LENGTH_MM
    });
  }
  assertOpeningsFitMeasuredLength(floor, wall, parsedLength);
  movingNode.xMm = Math.round(fixedNode.xMm + dx * coordinateLength);
  movingNode.yMm = Math.round(fixedNode.yMm + dy * coordinateLength);

  refreshWallMetrics(floor);
  recordWallRawMeasurement(wall, parsedLength, 'coordinate-rounding');
  wall.inputSource = inputSource || 'manual';
  wall.measuredAt = nowIso();
  normalizeOpeningsForWall(floor, wall.id);

  if (floor.spaces.some((space) => space.closed)) {
    session.state = SESSION_STATES.SPACE_CLOSED;
    session.anchorNodeId = '';
    session.selectedWallId = wall.id;
  } else {
    session.state = SESSION_STATES.WALL_COMMITTED;
    session.anchorNodeId = movingNodeId;
    session.selectedWallId = '';
  }

  session.selectedOpeningId = '';
  session.fixedNodeId = '';
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
const legacyConfirmClosure = adaptLegacySurveyOperation(confirmClosure);
const legacyRenameClosedSpace = adaptLegacySurveyOperation(renameClosedSpace);
const legacySnapCursorToWall = adaptLegacySurveyOperation(snapCursorToWall);
const legacyRemeasureSelectedWall = adaptLegacySurveyOperation(remeasureSelectedWall);
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
