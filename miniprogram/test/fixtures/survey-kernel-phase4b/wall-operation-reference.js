// Test-only frozen Phase 4A wall mutations and their local helper closure.
// Captured before Phase 4B; never regenerate to accept a candidate difference.
const { buildSpaceDimensionPlan, calculateSpaceAreaMm2 } = require('../../../packages/surveying/utils/survey/read-model/space-dimensions.js');
const { buildSpaceInnerBoundaryPoints, buildSpaceRenderBoundaryPoints } = require('../../../packages/surveying/utils/survey/read-model/space-boundary.js');
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
const { getNode, getWall } = require('../../../packages/surveying/utils/survey/core/graph-query.js');
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
} = require('../../../packages/surveying/utils/survey/core/constants.js');
const {
  createSurveyDraft,
  cloneDraft,
  getActiveFloor: findActiveFloor,
  touchDraft
} = require('../../../packages/surveying/utils/survey/core/draft.js');
const {
  SESSION_STATES,
  ensureSessionSpaceTracking
} = require('../../../packages/surveying/utils/survey/core/session.js');
const vector2 = require('../../../packages/surveying/utils/survey/geometry/vector2.js');
const segmentGeometry = require('../../../packages/surveying/utils/survey/geometry/segment.js');
const polygonGeometry = require('../../../packages/surveying/utils/survey/geometry/polygon.js');
const openingDomain = require('../../../packages/surveying/utils/survey/domain/opening.js');
const wallDomain = require('../../../packages/surveying/utils/survey/domain/wall.js');
const domainValidation = require('../../../packages/surveying/utils/survey/domain/validation.js');
const {
  SURVEY_DOMAIN_ERROR_CODES: DOMAIN_ERROR_CODES,
  createSurveyDomainError
} = require('../../../packages/surveying/utils/survey/domain/errors.js');
const { adaptLegacySurveyOperation } = require('../../../packages/surveying/utils/survey/compat/legacy-error-messages.js');
const { syncClosedSpacesFromFaces } = require('../../../packages/surveying/utils/survey/topology/space-sync.js');

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

function pointAlongWall(floor, wall, nodeId) {
  const start = getNode(floor, wall.startNodeId);
  const end = getNode(floor, wall.endNodeId);
  const node = getNode(floor, nodeId);
  const projection = projectPointToWallSegment(node, start, end);
  return projection ? Math.round(projection.t * distanceMm(start, end)) : 0;
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

function ensureOpenings(floor) {
  if (!Array.isArray(floor.openings)) {
    floor.openings = [];
  }
  return floor.openings;
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

function nextId(prefix) {
  idSeed += 1;
  return `${prefix}-${Date.now().toString(36)}-${idSeed}`;
}

function nowIso() {
  return new Date().toISOString();
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

function normalizeOpeningToWall(floor, opening) {
  const wall = getWall(floor, opening.wallId);
  return openingDomain.normalizeOpeningToWall(opening, wall, {
    minimumSizeMm: MIN_OPENING_SIZE_MM,
    maximumWallRatio: MAX_OPENING_WALL_RATIO
  });
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

function syncFloorSpaces(floor, inheritOverrides) {
  return syncClosedSpacesFromFaces(floor, {
    nextId,
    inheritOverrides: inheritOverrides || null
  });
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

function oppositeMeasurementSide(side) {
  if (side === 'left') return 'right';
  if (side === 'right') return 'left';
  return side || '';
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

function getLastWall(floor) {
  return floor.walls[floor.walls.length - 1] || null;
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

function wallKeepsStrictAxis(start, end) {
  return isAxisAlignedWithAnchor(start, end, 1);
}

function isAxisAlignedWithAnchor(anchor, point, toleranceMm) {
  const limit = typeof toleranceMm === 'number' ? toleranceMm : 1;
  if (!anchor || !point) return false;
  return Math.abs(anchor.xMm - point.xMm) <= limit ||
    Math.abs(anchor.yMm - point.yMm) <= limit;
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

function getFirstNode(floor) {
  if (!floor.walls.length) return null;
  return getNode(floor, floor.walls[0].startNodeId);
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

function findMergeClosureCandidate(floor, session, endPoint) {
  const plan = findMergeClosurePlan(floor, session, endPoint);
  return plan ? plan.targetNode : null;
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

function isClosedBoundaryCorner(floor, session) {
  if (!floor || !session || !session.activeSpaceStartNodeId || !session.activeSpaceSharedWallId) return false;
  if (!findClosedSpaceForWall(floor, session.activeSpaceSharedWallId)) return false;
  const incidentClosedWalls = (floor.walls || []).filter((wall) => (
    (wall.startNodeId === session.activeSpaceStartNodeId || wall.endNodeId === session.activeSpaceStartNodeId) &&
    !!findClosedSpaceForWall(floor, wall.id)
  ));
  return incidentClosedWalls.length >= 2;
}

function getMinimumDirectBoundaryCloseWallCount(floor, session) {
  if (!session || !session.activeSpaceSharedWallId) return 2;
  if (!isClosedBoundaryCorner(floor, session)) return 1;
  return 2;
}

function getMinimumClosureSuggestionWallCount(floor, session) {
  if (!session || !session.activeSpaceSharedWallId) return 2;
  if (!isClosedBoundaryCorner(floor, session)) return 1;
  return 3;
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

function isHorizontalSegment(start, end) {
  return Math.abs((end || {}).xMm - (start || {}).xMm) >= Math.abs((end || {}).yMm - (start || {}).yMm);
}

function normalizeClosurePoints(points) {
  return points.filter((point, index) => (
    index === 0 || distanceMm(point, points[index - 1]) > 0.001
  ));
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

function hasClosureInteriorIntersection(start, end, otherStart, otherEnd) {
  return segmentGeometry.hasInteriorIntersection(start, end, otherStart, otherEnd, {
    overlapToleranceMm: WALL_OVERLAP_TOLERANCE_MM
  });
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

function getLastEndNode(floor) {
  const lastWall = getLastWall(floor);
  return lastWall ? getNode(floor, lastWall.endNodeId) : null;
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

function getClosedSpace(floor, spaceId) {
  if (!spaceId) return null;
  return (floor.spaces || []).find((space) => (
    space && space.id === spaceId && space.closed && Array.isArray(space.wallIds)
  )) || null;
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

function clearObjectSelection(session) {
  if (!session) return;
  session.selectedWallId = '';
  session.selectedOpeningId = '';
  session.selectedSpaceId = '';
}

module.exports = { splitWallAtNodes, deleteWall, deleteClosedSpace };
