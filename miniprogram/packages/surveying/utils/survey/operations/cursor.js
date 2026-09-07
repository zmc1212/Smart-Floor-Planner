const { transitionSessionState } = require('../session/state-machine.js');
const { planWallSnap } = require('../interaction/wall-snap.js');
const { resolveProjectionIntent } = require('./projection-intent.js');
const { SESSION_STATES, ensureSessionSpaceTracking } = require('../core/session.js');
const { addNode, getOrCreateSnapNode } = require('./wall-mutation-helpers.js');
const { cloneDraft, getActiveFloor: findActiveFloor, touchDraft } = require('../core/draft.js');

const { getLastEndNode, getNode, getWall } = require('../core/graph-query.js');
const { pointAlongWall } = require('./wall-split.js');
const { resetPreviewSideLock } = require('../core/preview-session.js');
const { resumeOpenChainAtDanglingNode } = require('./open-chain.js');

const wallDomain = require('../domain/wall.js');

const getWallCoordinateLength = wallDomain.coordinateLengthMm;

const getActiveFloor = (draft) => findActiveFloor(draft, { requireFloorList: true });
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

  transitionSessionState(session, 'CURSOR_PLACED', floor.walls.length ? SESSION_STATES.WALL_COMMITTED : SESSION_STATES.CURSOR_PLACED);
  delete session.pendingMeasuredClosure;
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

function placeNewWallChainCursor(draft, point) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const session = ensureSessionSpaceTracking(floor);
  const node = addNode(floor, point);

  transitionSessionState(session, 'CURSOR_PLACED', SESSION_STATES.CURSOR_PLACED);
  session.anchorNodeId = node.id;
  delete session.pendingMeasuredClosure;
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

function snapCursorToWall(draft, point, target) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const session = ensureSessionSpaceTracking(floor);
  const plan = planWallSnap(floor, point, target);
  const projection = resolveProjectionIntent(floor, plan.projection);
  const topologyProjection = resolveProjectionIntent(floor, plan.topologyProjection);
  const node = getOrCreateSnapNode(floor, topologyProjection);

  if (!node) return next;

  delete session.pendingMeasuredClosure;

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

  transitionSessionState(session, 'CURSOR_PLACED', SESSION_STATES.CURSOR_PLACED);
  session.anchorNodeId = node.id;
  delete session.pendingMeasuredClosure;
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

function resetCursor(draft) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const session = ensureSessionSpaceTracking(floor);

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
    transitionSessionState(session, 'CURSOR_RESET', SESSION_STATES.CURSOR_PLACED);
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
    transitionSessionState(session, 'CURSOR_RESET', SESSION_STATES.SPACE_CLOSED);
    session.anchorNodeId = '';
    return touchDraft(next);
  }

  if (floor.walls.length) {
    const lastEnd = getLastEndNode(floor);
    session.anchorNodeId = lastEnd ? lastEnd.id : '';
    transitionSessionState(session, 'CURSOR_RESET', SESSION_STATES.WALL_COMMITTED);
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
  transitionSessionState(session, 'CURSOR_RESET', SESSION_STATES.CURSOR_PLACED);
  return touchDraft(next);
}

module.exports = {
  placeCursor,
  placeNewWallChainCursor,
  snapCursorToWall,
  resetCursor
};
