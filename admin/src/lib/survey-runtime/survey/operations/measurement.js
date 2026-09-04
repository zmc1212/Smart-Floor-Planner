const { transitionSessionState } = require('../session/state-machine.js');
const { cloneDraft, getActiveFloor: findActiveFloor, touchDraft } = require('../core/draft.js');
const { SESSION_STATES } = require('../core/session.js');
const {
  getNode,
  getWall,
  getSingleSharedEndpoint
} = require('../core/graph-query.js');
const { findClosedSpacesForWall } = require('../topology/closed-boundary.js');
const { wallKeepsStrictAxis } = require('../topology/closure-queries.js');
const {
  ensureOpenings,
  normalizeOpeningToWall,
  refreshWallMetrics
} = require('./wall-mutation-helpers.js');
const {
  MIN_WALL_LENGTH_MM
} = require('../core/constants.js');
const {
  validateLength
} = require('../domain/validation.js');
const {
  SURVEY_DOMAIN_ERROR_CODES: DOMAIN_ERROR_CODES,
  createSurveyDomainError
} = require('../domain/errors.js');
const openingDomain = require('../domain/opening.js');
const wallDomain = require('../domain/wall.js');
const vector2 = require('../geometry/vector2.js');
const { nowIso } = require('../core/runtime-id.js');
const { adaptLegacySurveyOperation } = require('../compat/legacy-error-messages.js');
const { wrapOperation } = require('./transaction.js');

const getActiveFloor = (draft) => findActiveFloor(draft, { requireFloorList: true });
const getMeasuredWallLength = wallDomain.measuredLengthMm;
const getWallMeasurementInsets = wallDomain.measurementInsets;
const normalizeMeasurementExtension = wallDomain.normalizeMeasurementAdjustment;
const recordWallRawMeasurement = wallDomain.recordRawMeasurement;
const angleDeg = vector2.angleDeg;

function normalizeOpeningsForWall(floor, wallId) {
  ensureOpenings(floor).forEach((opening) => {
    if (opening.wallId !== wallId) return;
    normalizeOpeningToWall(floor, opening);
    openingDomain.normalizeOpeningDirection(opening);
  });
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

function serializeClosedRemeasurePlan(plan, spaceId, fixedNodeId, selectedWallId, selectedAxis) {
  return {
    kind: 'remeasure-wall',
    mode: 'closed-orthogonal',
    spaceId,
    floorId: plan.floorId,
    wallId: selectedWallId,
    fixedNodeId,
    selectedAxis,
    entries: plan.entries.map((entry) => ({
      wallId: entry.wall.id,
      fromNodeId: entry.fromNode.id,
      toNodeId: entry.toNode.id,
      axis: entry.axis,
      rawMeasuredLengthMm: entry.rawMeasuredLengthMm,
      signedLengthMm: entry.signedLengthMm,
      adjustedSignedLengthMm: entry.adjustedSignedLengthMm
    }))
  };
}

function buildClosedOrthogonalRemeasurePlanInternal(
  floor,
  space,
  selectedWall,
  fixedNodeId,
  measuredLengthMm
) {
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

  // Check every opening against the balanced measured span before any node is
  // moved. This is what makes a failed remeasure atomic for both open and
  // closed walls.
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

  return {
    floorId: floor.id,
    entries,
    fixedNode: getNode(floor, fixedNodeId),
    fixedNodeId,
    selectedAxis,
    selectedWallId: selectedWall.id,
    spaceId: space.id
  };
}

// Public plan helper intentionally returns only stable IDs and scalar values.
// The internal builder above may retain graph references while calculating the
// balance, but those references never cross the plan/apply boundary.
function buildClosedOrthogonalRemeasurePlan(
  floor,
  space,
  selectedWall,
  fixedNodeId,
  measuredLengthMm,
  inputSource
) {
  const parsedLength = validateLength(measuredLengthMm);
  const internalPlan = buildClosedOrthogonalRemeasurePlanInternal(
    floor,
    space,
    selectedWall,
    fixedNodeId,
    parsedLength
  );
  if (!internalPlan) return null;
  return Object.assign(
    serializeClosedRemeasurePlan(
      internalPlan,
      space.id,
      fixedNodeId,
      selectedWall.id,
      internalPlan.selectedAxis
    ),
    {
      parsedLengthMm: parsedLength,
      inputSource: inputSource || 'manual'
    }
  );
}

function planRemeasureSelectedWall(draft, lengthMm, inputSource) {
  const parsedLength = validateLength(lengthMm);
  const floor = getActiveFloor(draft);
  const session = floor.session || {};
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
    const closedPlan = buildClosedOrthogonalRemeasurePlanInternal(
      floor,
      closedSpaces[0],
      wall,
      fixedNodeId,
      parsedLength
    );
    if (!closedPlan) throw createSurveyDomainError(DOMAIN_ERROR_CODES.CLOSED_REMEASURE_UNSAFE);
    return Object.assign(
      serializeClosedRemeasurePlan(
        closedPlan,
        closedSpaces[0].id,
        fixedNodeId,
        wall.id,
        closedPlan.selectedAxis
      ),
      {
        parsedLengthMm: parsedLength,
        inputSource: inputSource || 'manual'
      }
    );
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
  const insets = getWallMeasurementInsets(wall);
  const coordinateLengthMm = parsedLength + insets.start + insets.end -
    normalizeMeasurementExtension(wall.measurementStartExtensionMm);
  if (coordinateLengthMm < MIN_WALL_LENGTH_MM) {
    throw createSurveyDomainError(DOMAIN_ERROR_CODES.REMEASURE_LENGTH_TOO_SHORT, {
      minimumMm: MIN_WALL_LENGTH_MM
    });
  }
  assertOpeningsFitMeasuredLength(floor, wall, parsedLength);
  return {
    kind: 'remeasure-wall',
    mode: 'open',
    floorId: floor.id,
    wallId: wall.id,
    fixedNodeId,
    movingNodeId,
    direction: { x: rawDx / safeLength, y: rawDy / safeLength },
    coordinateLengthMm,
    parsedLengthMm: parsedLength,
    inputSource: inputSource || 'manual'
  };
}

function assertPlanFloor(floor, plan) {
  if (!plan || plan.kind !== 'remeasure-wall' || plan.floorId !== floor.id) {
    throw new TypeError('墙体复尺计划与当前楼层不匹配');
  }
}

function applyClosedRemeasurePlan(floor, plan) {
  const fixedNode = getNode(floor, plan.fixedNodeId);
  if (!fixedNode || !Array.isArray(plan.entries) || !plan.entries.length ||
      (plan.selectedAxis !== 'x' && plan.selectedAxis !== 'y')) {
    throw createSurveyDomainError(DOMAIN_ERROR_CODES.CLOSED_REMEASURE_UNSAFE);
  }
  // Validate every reference and the complete ordered cycle before moving any
  // node so a malformed or stale plan cannot partially mutate the transaction
  // draft. The plan is deliberately replayed by IDs, never by graph refs.
  let expectedFromNodeId = plan.fixedNodeId;
  let projectedPoint = { xMm: fixedNode.xMm, yMm: fixedNode.yMm };
  const seenWallIds = new Set();
  plan.entries.forEach((entry, index) => {
    const wall = entry && getWall(floor, entry.wallId);
    const fromNode = entry && getNode(floor, entry.fromNodeId);
    const toNode = entry && getNode(floor, entry.toNodeId);
    const validAxis = entry && (entry.axis === 'x' || entry.axis === 'y');
    const wallEndpointsMatch = wall && fromNode && toNode && (
      (wall.startNodeId === fromNode.id && wall.endNodeId === toNode.id) ||
      (wall.startNodeId === toNode.id && wall.endNodeId === fromNode.id)
    );
    const deltaX = fromNode && toNode ? toNode.xMm - fromNode.xMm : 0;
    const deltaY = fromNode && toNode ? toNode.yMm - fromNode.yMm : 0;
    const axisMatches = validAxis && (
      entry.axis === 'x' ? Math.abs(deltaY) <= 1 : Math.abs(deltaX) <= 1
    );
    if (!wall || !fromNode || !toNode || !validAxis || !wallEndpointsMatch ||
        entry.fromNodeId !== expectedFromNodeId || seenWallIds.has(entry.wallId) ||
        !axisMatches || !Number.isFinite(Number(entry.rawMeasuredLengthMm)) ||
        !Number.isFinite(Number(entry.signedLengthMm)) ||
        !Number.isFinite(Number(entry.adjustedSignedLengthMm)) ||
        Math.sign(Number(entry.adjustedSignedLengthMm)) !== Math.sign(Number(entry.signedLengthMm)) ||
        Math.abs(Number(entry.adjustedSignedLengthMm)) < MIN_WALL_LENGTH_MM) {
      throw createSurveyDomainError(DOMAIN_ERROR_CODES.CLOSED_REMEASURE_UNSAFE);
    }
    seenWallIds.add(entry.wallId);
    projectedPoint = entry.axis === 'x'
      ? { xMm: Math.round(projectedPoint.xMm + Number(entry.adjustedSignedLengthMm)), yMm: projectedPoint.yMm }
      : { xMm: projectedPoint.xMm, yMm: Math.round(projectedPoint.yMm + Number(entry.adjustedSignedLengthMm)) };
    expectedFromNodeId = entry.toNodeId;
    if (index === plan.entries.length - 1 && expectedFromNodeId !== plan.fixedNodeId) {
      throw createSurveyDomainError(DOMAIN_ERROR_CODES.CLOSED_REMEASURE_UNSAFE);
    }
  });
  if (projectedPoint.xMm !== fixedNode.xMm || projectedPoint.yMm !== fixedNode.yMm) {
    throw createSurveyDomainError(DOMAIN_ERROR_CODES.CLOSED_REMEASURE_UNSAFE);
  }

  let currentPoint = { xMm: fixedNode.xMm, yMm: fixedNode.yMm };
  plan.entries.forEach((entry, index) => {
    const nextNode = getNode(floor, entry.toNodeId);
    const nextPoint = entry.axis === 'x'
      ? { xMm: Math.round(currentPoint.xMm + Number(entry.adjustedSignedLengthMm)), yMm: currentPoint.yMm }
      : { xMm: currentPoint.xMm, yMm: Math.round(currentPoint.yMm + Number(entry.adjustedSignedLengthMm)) };
    if (index < plan.entries.length - 1) {
      nextNode.xMm = nextPoint.xMm;
      nextNode.yMm = nextPoint.yMm;
    }
    currentPoint = nextPoint;
  });
  if (currentPoint.xMm !== fixedNode.xMm || currentPoint.yMm !== fixedNode.yMm) {
    throw createSurveyDomainError(DOMAIN_ERROR_CODES.CLOSED_REMEASURE_UNSAFE);
  }

  refreshWallMetrics(floor);
  plan.entries.forEach((entry) => {
    if (entry.axis !== plan.selectedAxis) return;
    const wall = getWall(floor, entry.wallId);
    if (!wall) throw createSurveyDomainError(DOMAIN_ERROR_CODES.CLOSED_REMEASURE_UNSAFE);
    const adjustmentMm = Math.round(wall.lengthMm - entry.rawMeasuredLengthMm);
    wall.rawMeasuredLengthMm = entry.rawMeasuredLengthMm;
    wall.closureAdjustmentMm = adjustmentMm;
    if (adjustmentMm) wall.adjustmentSource = 'remeasure-balance';
    else delete wall.adjustmentSource;
  });
  const selectedWall = getWall(floor, plan.wallId);
  if (!selectedWall) throw createSurveyDomainError(DOMAIN_ERROR_CODES.CLOSED_REMEASURE_UNSAFE);
  selectedWall.inputSource = plan.inputSource || 'manual';
  selectedWall.measuredAt = nowIso();
  return selectedWall;
}

function applyRemeasurePlan(draft, plan) {
  const floor = getActiveFloor(draft);
  assertPlanFloor(floor, plan);
  const session = floor.session || {};
  const wall = getWall(floor, plan.wallId);
  if (!wall) throw createSurveyDomainError(DOMAIN_ERROR_CODES.REMEASURE_SELECTION_REQUIRED);

  if (plan.mode === 'closed-orthogonal') {
    if (plan.selectedAxis !== 'x' && plan.selectedAxis !== 'y') {
      throw createSurveyDomainError(DOMAIN_ERROR_CODES.CLOSED_REMEASURE_UNSAFE);
    }
    applyClosedRemeasurePlan(floor, plan);
    transitionSessionState(session, 'REMEASURE_COMPLETED', SESSION_STATES.SPACE_CLOSED);
    session.anchorNodeId = '';
    session.selectedWallId = wall.id;
    session.selectedOpeningId = '';
    session.fixedNodeId = '';
    return { changed: true, kind: plan.kind, mode: plan.mode, wallId: wall.id, spaceId: plan.spaceId };
  }

  const fixedNode = getNode(floor, plan.fixedNodeId);
  const movingNode = getNode(floor, plan.movingNodeId);
  if (!fixedNode || !movingNode || !plan.direction) {
    throw createSurveyDomainError(DOMAIN_ERROR_CODES.INVALID_REMEASURE_ENDPOINT);
  }
  movingNode.xMm = Math.round(fixedNode.xMm + plan.direction.x * plan.coordinateLengthMm);
  movingNode.yMm = Math.round(fixedNode.yMm + plan.direction.y * plan.coordinateLengthMm);
  refreshWallMetrics(floor);
  recordCommittedWallMeasurement(wall, plan.parsedLengthMm, plan.inputSource);
  normalizeOpeningsForWall(floor, wall.id);

  if (floor.spaces.some((space) => space.closed)) {
    transitionSessionState(session, 'REMEASURE_COMPLETED', SESSION_STATES.SPACE_CLOSED);
    session.anchorNodeId = '';
    session.selectedWallId = wall.id;
  } else {
    transitionSessionState(session, 'REMEASURE_COMPLETED', SESSION_STATES.WALL_COMMITTED);
    session.anchorNodeId = plan.movingNodeId;
    session.selectedWallId = '';
  }
  session.selectedOpeningId = '';
  session.fixedNodeId = '';
  return { changed: true, kind: plan.kind, mode: plan.mode, wallId: wall.id };
}

function remeasureSelectedWall(draft, lengthMm, inputSource) {
  const next = cloneDraft(draft);
  const plan = planRemeasureSelectedWall(next, lengthMm, inputSource);
  const result = applyRemeasurePlan(next, plan);
  return result.changed ? touchDraft(next) : next;
}

// The existing-wall branch of commitPreviewLength is intentionally small and
// independent from closure/snap planning. Keeping it here makes the audit
// pair (raw reading + derived correction) shared by all measurement writes.
function applyExistingWallMeasurement(
  floor,
  wall,
  anchor,
  endPoint,
  parsedLengthMm,
  inputSource,
  mode
) {
  if (!floor || !wall || !anchor || !endPoint) return null;
  const previousRawMeasuredLengthMm = Number.isFinite(Number(wall.rawMeasuredLengthMm))
    ? Math.round(Number(wall.rawMeasuredLengthMm))
    : Math.round(Number(wall.lengthMm) || getMeasuredWallLength(floor, wall));
  const combinedRawMeasuredLengthMm = mode === 'extend'
    ? previousRawMeasuredLengthMm + parsedLengthMm
    : Math.max(0, previousRawMeasuredLengthMm - parsedLengthMm);
  anchor.xMm = Math.round(endPoint.xMm);
  anchor.yMm = Math.round(endPoint.yMm);
  wall.lengthMm = getMeasuredWallLength(floor, wall);
  recordWallRawMeasurement(wall, combinedRawMeasuredLengthMm, 'coordinate-rounding');
  wall.angleDeg = angleDeg(getNode(floor, wall.startNodeId), anchor);
  wall.inputSource = inputSource || 'manual';
  wall.measuredAt = nowIso();
  return { endNode: anchor, combinedRawMeasuredLengthMm };
}

function recordCommittedWallMeasurement(wall, parsedLengthMm, inputSource) {
  if (!wall) return wall;
  recordWallRawMeasurement(wall, parsedLengthMm, 'coordinate-rounding');
  wall.inputSource = inputSource || 'manual';
  // `commitPreviewLength` stamps a new wall while constructing it. Preserve
  // that timestamp so extracting the audit write does not change the legacy
  // ordering; callers that provide an un-stamped wall still receive one.
  if (!wall.measuredAt) wall.measuredAt = nowIso();
  return wall;
}

const legacyRemeasureSelectedWall = adaptLegacySurveyOperation(remeasureSelectedWall);

function createMeasurementOperations() {
  return {
    remeasureSelectedWall: wrapOperation(
      'remeasureSelectedWall',
      legacyRemeasureSelectedWall,
      { mode: 'full' }
    )
  };
}

module.exports = {
  assertOpeningsFitMeasuredLength,
  buildClosedOrthogonalRemeasurePlan,
  planRemeasureSelectedWall,
  applyClosedRemeasurePlan,
  applyRemeasurePlan,
  remeasureSelectedWall,
  legacyRemeasureSelectedWall,
  applyExistingWallMeasurement,
  recordCommittedWallMeasurement,
  createMeasurementOperations
};
