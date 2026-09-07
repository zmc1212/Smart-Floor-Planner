const { transitionSessionState } = require('../session/state-machine.js');
const { cloneDraft, getActiveFloor: findActiveFloor, touchDraft } = require('../core/draft.js');
const { ensureSessionSpaceTracking, SESSION_STATES } = require('../core/session.js');
const { getClosedSpace, getWall, getNode, getLastEndNode } = require('../core/graph-query.js');
const {
  ensureOpenings,
  recomputeSplitNodeBodyInsets,
  syncFloorSpaces,
  refreshWallMetrics,
  normalizeOpeningToWall,
  removeUnreferencedNodes
} = require('./wall-mutation-helpers.js');
const { restoreOpenedSpaceChain } = require('./open-chain.js');
const { wrapOperation } = require('./transaction.js');

const getActiveFloor = (draft) => findActiveFloor(draft, { requireFloorList: true });

const wallDomain = require('../domain/wall.js');
const normalizeMeasurementInset = wallDomain.normalizeMeasurementAdjustment;

// Normalize only a detached session while planning. Legacy no-op normalization
// still happens on the transaction draft when the plan is applied.
function planningSession(floor) {
  return ensureSessionSpaceTracking({ ...floor, session: floor.session ? { ...floor.session } : undefined });
}

function planDeleteClosedSpace(draft, spaceId) {
  const floor = getActiveFloor(draft);
  const session = planningSession(floor);
  const space = getClosedSpace(floor, spaceId || session.selectedSpaceId);
  const wallIds = space ? collectExclusiveClosedSpaceWallIds(floor, space) : [];
  return {
    kind: 'delete-closed-space', floorId: floor.id,
    spaceId: space ? space.id : (spaceId || session.selectedSpaceId),
    noop: !space, sharedOnly: !!space && !wallIds.length, wallIds
  };
}

function planDeleteWall(draft, wallId) {
  const floor = getActiveFloor(draft);
  const session = planningSession(floor);
  const targetId = wallId || session.selectedWallId;
  const wall = getWall(floor, targetId);
  if (!wall) return { kind: 'delete-wall', floorId: floor.id, wallId: targetId, noop: true, wallIds: [] };
  const wallIndex = floor.walls.findIndex(item => item.id === targetId);
  const closedOwners = (floor.spaces || []).filter(space => (
    space && space.closed && Array.isArray(space.wallIds) && space.wallIds.includes(targetId)
  ));
  return {
    kind: 'delete-wall', floorId: floor.id, wallId: targetId, noop: false,
    wallIds: [...new Set([...planRemovedWallsForDeletedSharedWall(floor, targetId), targetId])],
    deletesClosedSpaceWall: closedOwners.length > 0,
    punchThroughSharedWall: closedOwners.length === 2,
    preserveActiveChain: !closedOwners.length && wallIndex === floor.walls.length - 1 &&
      wallIndex >= session.activeSpaceStartWallIndex && wallIndex > session.activeSpaceStartWallIndex
  };
}

function assertPlanFloor(floor, plan, kind) {
  if (!plan || plan.kind !== kind || plan.floorId !== floor.id) {
    throw new TypeError('墙体删除计划与当前楼层不匹配');
  }
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

function applyDeleteClosedSpacePlan(draft, plan) {
  const floor = getActiveFloor(draft);
  assertPlanFloor(floor, plan, 'delete-closed-space');
  const session = ensureSessionSpaceTracking(floor);
  if (plan.noop) return { changed: false, kind: plan.kind, spaceId: plan.spaceId, wallIds: [] };

  if (plan.sharedOnly) {
    // Shared-only loop: removing the space identity is not supported; keep geometry.
    clearObjectSelection(session);
    transitionSessionState(session, 'WALL_DELETED', SESSION_STATES.SPACE_CLOSED);
    session.anchorNodeId = '';
    return { changed: true, kind: plan.kind, spaceId: plan.spaceId, wallIds: [] };
  }

  const removedWallIds = new Set(plan.wallIds);
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

  delete session.pendingMeasuredClosure;
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
      transitionSessionState(session, 'WALL_DELETED', SESSION_STATES.SPACE_CLOSED);
    } else if (floor.walls.length) {
      const lastEnd = getLastEndNode(floor);
      session.anchorNodeId = lastEnd ? lastEnd.id : '';
      transitionSessionState(session, 'WALL_DELETED', SESSION_STATES.WALL_COMMITTED);
    } else if (seedNode) {
      session.anchorNodeId = seedNode.id;
      transitionSessionState(session, 'WALL_DELETED', SESSION_STATES.CURSOR_PLACED);
    } else {
      session.anchorNodeId = '';
      transitionSessionState(session, 'WALL_DELETED', SESSION_STATES.IDLE);
    }
  }

  removeUnreferencedNodes(floor);
  return { changed: true, kind: plan.kind, spaceId: plan.spaceId, wallIds: [...removedWallIds] };
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

function applyDeleteWallPlan(draft, plan) {
  const floor = getActiveFloor(draft);
  assertPlanFloor(floor, plan, 'delete-wall');
  const session = ensureSessionSpaceTracking(floor);
  if (plan.noop) return { changed: false, kind: plan.kind, wallId: plan.wallId, wallIds: [] };
  const wall = getWall(floor, plan.wallId);
  const { deletesClosedSpaceWall, preserveActiveChain, punchThroughSharedWall } = plan;
  const removedWallIds = new Set(plan.wallIds);
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

  delete session.pendingMeasuredClosure;
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
      transitionSessionState(session, 'WALL_DELETED', SESSION_STATES.SPACE_CLOSED);
    } else if (floor.walls.length) {
      const lastEnd = getLastEndNode(floor);
      session.anchorNodeId = lastEnd ? lastEnd.id : '';
      transitionSessionState(session, 'WALL_DELETED', SESSION_STATES.WALL_COMMITTED);
    } else if (deletedStartNode) {
      session.anchorNodeId = deletedStartNode.id;
      transitionSessionState(session, 'WALL_DELETED', SESSION_STATES.CURSOR_PLACED);
    } else {
      session.anchorNodeId = '';
      transitionSessionState(session, 'WALL_DELETED', SESSION_STATES.IDLE);
    }
  }

  removeUnreferencedNodes(floor);
  return { changed: true, kind: plan.kind, wallId: plan.wallId, wallIds: [...removedWallIds] };
}

function runDeletion(draft, planner, apply, targetId) {
  const next = cloneDraft(draft);
  const plan = planner(next, targetId);
  const result = apply(next, plan);
  return result.changed ? touchDraft(next) : next;
}

function deleteWall(draft, wallId) {
  return runDeletion(draft, planDeleteWall, applyDeleteWallPlan, wallId);
}

function deleteClosedSpace(draft, spaceId) {
  return runDeletion(draft, planDeleteClosedSpace, applyDeleteClosedSpacePlan, spaceId);
}

function createWallDeletionOperations() {
  return {
    deleteWall: wrapOperation('deleteWall', deleteWall, { mode: 'full' }),
    deleteClosedSpace: wrapOperation('deleteClosedSpace', deleteClosedSpace, { mode: 'full' })
  };
}

module.exports = {
  collectExclusiveClosedSpaceWallIds,
  clearObjectSelection,
  deleteClosedSpace,
  wallsShareEndpoint,
  wallsAreCollinear,
  collectCollinearSharedWallIds,
  planRemovedWallsForDeletedSharedWall,
  clearDeletedSharedWallBoundaryInsets,
  deleteWall,
  planDeleteWall,
  planDeleteClosedSpace,
  applyDeleteWallPlan,
  applyDeleteClosedSpacePlan,
  createWallDeletionOperations
};
