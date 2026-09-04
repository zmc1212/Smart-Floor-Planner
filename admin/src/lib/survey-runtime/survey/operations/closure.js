const { transitionSessionState } = require('../session/state-machine.js');
const { cloneDraft, getActiveFloor, touchDraft } = require('../core/draft.js');
const { getNode, getWall, getLastWall } = require('../core/graph-query.js');
const { SESSION_STATES, ensureSessionSpaceTracking } = require('../core/session.js');
const { CLOSE_TOLERANCE_MM, MIN_WALL_LENGTH_MM } = require('../core/constants.js');
const { SURVEY_DOMAIN_ERROR_CODES: DOMAIN_ERROR_CODES, createSurveyDomainError } = require('../domain/errors.js');
const { adaptLegacySurveyOperation } = require('../compat/legacy-error-messages.js');
const { wrapOperation } = require('./transaction.js');
const { splitWallAtNodes } = require('./wall-split.js');
const {
  addNode,
  getOrCreateWallCenterNode,
  syncFloorSpaces,
  refreshWallMetrics,
  removeUnreferencedNodes,
  canExtendLastWall,
  mergeCollinearOpenChain,
  mergeCollinearDegree2Walls
} = require('./wall-mutation-helpers.js');
const { isHorizontalSegment } = require('../topology/closure-queries.js');
const { findWallPathBetweenNodes } = require('../topology/wall-path.js');
const {
  findClosedSpacesForWall,
  buildSpaceBoundaryPoints
} = require('../topology/closed-boundary.js');
const {
  resolveCollinearClosedOuterBodySide,
  resolveBoundaryAlignedMeasurementSide,
  resolveMeasurementEndInsetMm
} = require('../topology/wall-alignment.js');
const { planConfirmClosure, planClosureBridge } = require('../topology/closure-plans.js');
const { projectPointToSegment } = require('../geometry/segment.js');
const { containsPoint } = require('../geometry/polygon.js');
const { distanceMm, angleDeg } = require('../geometry/vector2.js');
const wallDomain = require('../domain/wall.js');
const { nextId, nowIso } = require('../core/runtime-id.js');

const getMeasuredWallLength = wallDomain.measuredLengthMm;
const syncWallAdjustmentAfterMetricChange = wallDomain.syncAdjustmentAfterMetricChange;

function clearLastWallSnap(session) {
  if (!session) return;
  session.lastWallSnapNodeId = '';
  session.lastWallSnapWallId = '';
  session.lastWallSnapT = null;
  session.lastWallSnapWallMiddle = false;
  session.lastWallSnapLine = '';
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
    containsPoint(probe, buildSpaceBoundaryPoints(floor, space.wallIds))
  )) || null;
}

function applyOrthogonalClosureAdjustmentPlan(floor, plan) {
  if (!floor || !plan || plan.type !== 'orthogonal-adjustment') return false;
  const entries = plan.entries.map(entry => ({
    ...entry, wall: getWall(floor, entry.wallId),
    fromNode: getNode(floor, entry.fromNodeId), toNode: getNode(floor, entry.toNodeId)
  }));
  let currentPoint = { xMm: entries[0].fromNode.xMm, yMm: entries[0].fromNode.yMm };
  entries.forEach((entry) => {
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
  entries.forEach((entry) => {
    const adjustmentMm = Math.round(entry.wall.lengthMm - entry.wall.rawMeasuredLengthMm);
    entry.wall.closureAdjustmentMm = adjustmentMm;
    if (adjustmentMm) entry.wall.adjustmentSource = 'closure-balance';
    else delete entry.wall.adjustmentSource;
  });
  return true;
}

function attachStraightWallToCloseNode(floor, wall, targetNode, inputSource) {
  const plan = planClosureBridge(floor, wall, targetNode);
  if (plan.kind === 'noop') return wall;
  if (plan.kind === 'snap') {
    wall.endNodeId = plan.targetNodeId;
    return wall;
  }
  const end = getNode(floor, plan.fromNodeId);
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

function completeSessionAfterClosure(floor, session, oldEndNodeId) {
  transitionSessionState(session, 'CLOSURE_COMPLETED', SESSION_STATES.SPACE_CLOSED);
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
  if (oldEndNodeId) session.closedFromNodeId = oldEndNodeId;
  session.activeSpaceStartNodeId = '';
  session.activeSpaceStartWallIndex = floor.walls.length;
  session.activeSpaceSharedWallId = '';
  session.activeSpaceSharedStartT = null;
  session.activeSpaceSharedSnapLine = '';
  clearLastWallSnap(session);
  removeUnreferencedNodes(floor);
}

// Each dependent stage plans against the current transaction draft. No nested
// transaction is opened; all cuts and face synchronization precede the final full validator.
function applyClosurePlan(draft, plan) {
  const floor = getActiveFloor(draft, { requireFloorList: true });
  if (!plan || plan.kind !== 'confirm-closure' || plan.floorId !== floor.id) {
    throw new TypeError('闭合计划与当前楼层不匹配');
  }
  const session = ensureSessionSpaceTracking(floor);
  if (plan.type === 'preview') throw new TypeError('预览意图须先提交墙体');
  if (plan.type === 'noop') return draft;
  if (plan.type === 'merge') {
    const anchor = getNode(floor, plan.anchorNodeId);
    const closeTargetNode = getNode(floor, plan.targetNodeId);
    const closurePlan = plan;
    const closurePoints = closurePlan.points;
    const finalConnectorStart = closurePoints.length > 2
      ? closurePoints[closurePoints.length - 2]
      : null;
    const activeSharedWall = getWall(floor, session.activeSpaceSharedWallId);
    const activeSharedStart = activeSharedWall ? getNode(floor, activeSharedWall.startNodeId) : null;
    const activeSharedEnd = activeSharedWall ? getNode(floor, activeSharedWall.endNodeId) : null;
    const finalConnectorFollowsSharedWall = !!(
      finalConnectorStart && activeSharedStart && activeSharedEnd &&
      isHorizontalSegment(finalConnectorStart, closeTargetNode) ===
        isHorizontalSegment(activeSharedStart, activeSharedEnd)
    );
    let closureStartNode = anchor;
    closurePlan.points.slice(1).forEach((point, index, points) => {
      const closureEndNode = index === points.length - 1 ? closeTargetNode : addNode(floor, point);
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
          lengthMm: Math.max(0, distanceMm(closureStartNode, closureEndNode) - measurementEndInsetMm),
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
    transitionSessionState(session, 'CLOSURE_JOINED', SESSION_STATES.CLOSING);
    session.closeCandidateNodeId = closeTargetNode.id;
    session.closeCandidatePoint = null;
    let correctSharedWallId = session.activeSpaceSharedWallId;
    if (session.activeSpaceSharedWallId) {
      const activeWalls = (floor.walls || []).slice(session.activeSpaceStartWallIndex || 0);
      const activeWallIds = {};
      activeWalls.forEach((wall) => { activeWallIds[wall.id] = true; });
      const targetWall = (floor.walls || []).find((wall) => (
        !activeWallIds[wall.id] &&
        (wall.startNodeId === closeTargetNode.id || wall.endNodeId === closeTargetNode.id)
      ));
      if (targetWall) correctSharedWallId = targetWall.id;
    }
    session.closeCandidateType = correctSharedWallId ? 'shared-wall' : 'merge';
    session.closeCandidateSharedWallId = correctSharedWallId || '';
  }

  if (plan.type === 'merge') return applyClosurePlan(draft, planConfirmClosure(draft));
  if (plan.type === 'partition') {
    plan.splits.forEach(split => splitWallAtNodes(floor, split.wallId, split.nodeIds));
    syncFloorSpaces(floor);
    if ((floor.spaces || []).filter(space => space && space.closed).length < plan.closedBefore + 1) {
      throw createSurveyDomainError(DOMAIN_ERROR_CODES.PARTITION_SPLIT_UNSAFE);
    }
    completeSessionAfterClosure(floor, session, '');
    session.partitionSourceSpaceId = '';
    return touchDraft(draft);
  }
  if (plan.type !== 'direct') throw new TypeError('闭合计划类型无效');
  const startWallIndex = session.activeSpaceStartWallIndex || 0;
  const closeCandidateSharedWallId = session.closeCandidateSharedWallId;
  let lastWall = getLastWall(floor);
  const oldEndNodeId = plan.oldEndNodeId;
  const closeTargetNode = plan.insertTarget ? addNode(floor, plan.target) : getNode(floor, plan.target.id);
  if (plan.projectedTarget) session.closeCandidateNodeId = closeTargetNode.id;
  if (plan.adjustment.type === 'orthogonal-adjustment') {
    applyOrthogonalClosureAdjustmentPlan(floor, plan.adjustment);
    lastWall = getLastWall(floor);
  }

  lastWall = attachStraightWallToCloseNode(floor, lastWall, closeTargetNode, 'closure-bridge');
  refreshWallMetrics(floor);
  mergeCollinearOpenChain(floor, startWallIndex);
  mergeCollinearDegree2Walls(floor);
  lastWall = getLastWall(floor);
  const newWallIds = floor.walls.slice(startWallIndex).map((wall) => wall.id);
  const interiorSourceSpace = findActiveChainInteriorSourceSpace(floor, session, newWallIds);
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
    ) wall.bodyNormalSide = wall.measurementSide;
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
    if (firstWall) firstWall.startNodeId = sharedStartNodeId;
  }
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
  if (
    (session.activeSpaceSharedWallId && sharedStartNodeId !== session.activeSpaceStartNodeId) ||
    (closeCandidateSharedWallId && sharedCloseNodeId !== closeTargetNode.id)
  ) refreshWallMetrics(floor);
  if (sharedBoundaryWallIds.length && session.activeSpaceStartNodeId) {
    sharedBoundaryWallIds.forEach((wallId) => {
      const sharedWall = getWall(floor, wallId);
      const sharedStart = sharedWall ? getNode(floor, sharedWall.startNodeId) : null;
      const sharedEnd = sharedWall ? getNode(floor, sharedWall.endNodeId) : null;
      const splitNodeIds = [sharedStartNodeId, sharedCloseNodeId].filter((nodeId) => {
        const node = getNode(floor, nodeId);
        const projection = projectPointToSegment(node, sharedStart, sharedEnd);
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
    ? { wallIds: sharedWallIds, face: 'offset', preferWallIds: newWallIds }
    : null;
  syncFloorSpaces(floor, inheritOverrides);
  const wallCountBeforeRepair = (floor.walls || []).length;
  mergeCollinearDegree2Walls(floor);
  if ((floor.walls || []).length !== wallCountBeforeRepair) {
    syncFloorSpaces(floor, inheritOverrides);
  }
  completeSessionAfterClosure(floor, session, oldEndNodeId);
  return touchDraft(draft);
}

function createConfirmClosureCore(commitPreviewLength) {
  return function confirmClosure(draft) {
    const plan = planConfirmClosure(draft);
    if (plan.type === 'preview') {
      if (typeof commitPreviewLength !== 'function') throw new TypeError('预览闭合需要墙体提交操作');
      const committed = commitPreviewLength(cloneDraft(draft), plan.lengthMm, 'closure-preview');
      const state = getActiveFloor(committed, { requireFloorList: true }).session.state;
      if (state !== SESSION_STATES.CLOSING && state !== SESSION_STATES.MERGE_CLOSING) {
        throw createSurveyDomainError(DOMAIN_ERROR_CODES.UNSAFE_CLOSURE);
      }
      return applyClosurePlan(committed, planConfirmClosure(committed));
    }
    return applyClosurePlan(cloneDraft(draft), plan);
  };
}

function createLegacyConfirmClosure(commitPreviewLength) {
  return adaptLegacySurveyOperation(createConfirmClosureCore(commitPreviewLength));
}

function createClosureOperations(commitPreviewLength) {
  return {
    confirmClosure: wrapOperation(
      'confirmClosure',
      adaptLegacySurveyOperation(createConfirmClosureCore(commitPreviewLength)),
      { mode: 'full' }
    )
  };
}

module.exports = {
  planConfirmClosure,
  applyClosurePlan,
  createConfirmClosureCore,
  createLegacyConfirmClosure,
  createClosureOperations
};
