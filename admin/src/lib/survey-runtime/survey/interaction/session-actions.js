const { transitionSessionState } = require('../session/state-machine.js');
const { MIN_WALL_LENGTH_MM } = require('../core/constants.js');
const { SESSION_STATES, ensureSessionSpaceTracking } = require('../core/session.js');

const { copySession } = require('../core/session-copy.js');
const { getClosedSpace, getLastEndNode, getNode, getSingleSharedEndpoint, getWall } = require('../core/graph-query.js');
const { resetPreviewSideLock } = require('../core/preview-session.js');

function planSetMode(sourceFloor, mode) {
  const floor = Object.assign({}, sourceFloor, { session: copySession(sourceFloor.session) });
  if (mode !== 'straight' && mode !== 'diagonal') return { session: floor.session, changed: false };
  floor.session.mode = mode;
  delete floor.session.bleLockedBearingDeg;
  return { session: floor.session, changed: true };
}

function planHoldPreviewForInput(sourceFloor) {
  const floor = Object.assign({}, sourceFloor, { session: copySession(sourceFloor.session) });
  const session = floor.session;

  if (session.state !== SESSION_STATES.WALL_PREVIEW || !session.previewPoint || session.previewLengthMm < MIN_WALL_LENGTH_MM) {
    return { session: floor.session, changed: false };
  }

  transitionSessionState(session, 'LENGTH_HELD', SESSION_STATES.AWAITING_LENGTH);
  return { session: floor.session, changed: true };
}

function planCancelPending(sourceFloor) {
  const floor = Object.assign({}, sourceFloor, { session: copySession(sourceFloor.session) });
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
    transitionSessionState(session, 'PENDING_CANCELLED', selectedCursorWasNewChainStart ? SESSION_STATES.CURSOR_PLACED : SESSION_STATES.WALL_COMMITTED);
  } else if (floor.spaces.some((space) => space.closed)) {
    transitionSessionState(session, 'PENDING_CANCELLED', SESSION_STATES.SPACE_CLOSED);
    session.anchorNodeId = '';
  } else if (floor.walls.length) {
    const lastEnd = getLastEndNode(floor);
    transitionSessionState(session, 'PENDING_CANCELLED', SESSION_STATES.WALL_COMMITTED);
    session.anchorNodeId = lastEnd ? lastEnd.id : '';
  } else if (session.anchorNodeId) {
    transitionSessionState(session, 'PENDING_CANCELLED', SESSION_STATES.CURSOR_PLACED);
  } else {
    transitionSessionState(session, 'PENDING_CANCELLED', SESSION_STATES.IDLE);
  }

  return { session: floor.session, changed: true };
}

function planSelectWall(sourceFloor, wallId) {
  const floor = Object.assign({}, sourceFloor, { session: copySession(sourceFloor.session) });
  const wall = getWall(floor, wallId);
  if (!wall) return { session: floor.session, changed: false };

  transitionSessionState(floor.session, 'OBJECT_SELECTED', SESSION_STATES.WALL_SELECTED);
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
  return { session: floor.session, changed: true };
}

function planSelectOpening(sourceFloor, openingId) {
  const floor = Object.assign({}, sourceFloor, { session: copySession(sourceFloor.session) });
  const opening = (floor.openings || []).find((opening) => opening.id === openingId);
  if (!opening || !getWall(floor, opening.wallId)) return { session: floor.session, changed: false };

  transitionSessionState(floor.session, 'OBJECT_SELECTED', SESSION_STATES.WALL_SELECTED);
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
  return { session: floor.session, changed: true };
}

function planSelectSpace(sourceFloor, spaceId) {
  const floor = Object.assign({}, sourceFloor, { session: copySession(sourceFloor.session) });
  const space = getClosedSpace(floor, spaceId);
  if (!space) return { session: floor.session, changed: false };

  transitionSessionState(floor.session, 'OBJECT_SELECTED', SESSION_STATES.WALL_SELECTED);
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
  return { session: floor.session, changed: true };
}

function planStartWallSnap(sourceFloor) {
  const floor = Object.assign({}, sourceFloor, { session: copySession(sourceFloor.session) });
  const session = ensureSessionSpaceTracking(floor);

  transitionSessionState(session, 'WALL_SNAP_STARTED', SESSION_STATES.WALL_SNAP_PENDING);
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

  return { session: floor.session, changed: true };
}

function planStartRemeasure(sourceFloor) {
  const floor = Object.assign({}, sourceFloor, { session: copySession(sourceFloor.session) });
  const wall = getWall(floor, floor.session.selectedWallId);
  if (!wall) {
    return { session: floor.session, changed: false };
  }

  transitionSessionState(floor.session, 'REMEASURE_STARTED', SESSION_STATES.REMEASURE_AWAITING_INPUT);
  const existingFixed = floor.session.fixedNodeId;
  const isWallEndpoint = existingFixed === wall.startNodeId || existingFixed === wall.endNodeId;
  if (!isWallEndpoint) {
    const sharedEndpoint = getSingleSharedEndpoint(floor, wall);
    floor.session.fixedNodeId = sharedEndpoint ? sharedEndpoint.fixedNodeId : wall.startNodeId;
  }
  return { session: floor.session, changed: true };
}

function planSetFixedNode(sourceFloor, nodeId) {
  const floor = Object.assign({}, sourceFloor, { session: copySession(sourceFloor.session) });
  floor.session.fixedNodeId = nodeId;
  return { session: floor.session, changed: true };
}

module.exports = {
  planSetMode,
  planHoldPreviewForInput,
  planCancelPending,
  planSelectWall,
  planSelectOpening,
  planSelectSpace,
  planStartWallSnap,
  planStartRemeasure,
  planSetFixedNode
};
