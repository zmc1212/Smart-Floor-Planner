const { transitionSessionState } = require('../session/state-machine.js');
const { copySession } = require('../core/session-copy.js');
const { SESSION_STATES, ensureSessionSpaceTracking } = require('../core/session.js');
const { copyTrackedSession } = require('../core/session-copy.js');
const { getNode } = require('../core/graph-query.js');
const { MIN_WALL_LENGTH_MM } = require('../core/constants.js');
const { SURVEY_DOMAIN_ERROR_CODES: DOMAIN_ERROR_CODES, createSurveyDomainError } = require('../domain/errors.js');
const vector2 = require('../geometry/vector2.js');
const normalizeAngle = vector2.normalizeAngleDeg;

const normalizeSignedAngle = vector2.normalizeSignedAngleDeg;
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

function planBearingPreview(floor, bearingDeg, options) {
  const opts = options || {};
  const session = copyTrackedSession(floor);
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

  return { rawPoint };
}

function planLockPreviewBearing(sourceFloor, bearingDeg) {
  const floor = Object.assign({}, sourceFloor, { session: copySession(sourceFloor.session) });
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
  transitionSessionState(session, 'DIRECTION_LOCKED', SESSION_STATES.AWAITING_LENGTH);
  return { session: floor.session, changed: true };
}

function planClearBleLockedBearing(sourceFloor) {
  const floor = Object.assign({}, sourceFloor, { session: copySession(sourceFloor.session) });
  const session = floor && floor.session;
  if (!session || !Object.prototype.hasOwnProperty.call(session, 'bleLockedBearingDeg')) {
    return { session: floor.session, changed: false };
  }
  delete session.bleLockedBearingDeg;
  if (!session.previewPoint && session.state === SESSION_STATES.AWAITING_LENGTH) {
    if (floor.walls.length) {
      transitionSessionState(session, 'DIRECTION_CLEARED', SESSION_STATES.WALL_COMMITTED);
    } else if (session.anchorNodeId) {
      transitionSessionState(session, 'DIRECTION_CLEARED', SESSION_STATES.CURSOR_PLACED);
    } else {
      transitionSessionState(session, 'DIRECTION_CLEARED', SESSION_STATES.IDLE);
    }
  }
  return { session: floor.session, changed: true };
}

module.exports = {
  planClearBleLockedBearing,
  planLockPreviewBearing,
  planBearingPreview,
  isOrthogonalBearing,
  clearBleDirectionPreview,
  hasBleLockedBearing
};
