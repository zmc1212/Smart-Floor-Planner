const { transitionSessionState } = require('../session/state-machine.js');
const { planInteriorAngle } = require('../interaction/angle-preview.js');
const { planBearingPreview, hasBleLockedBearing } = require('../interaction/direction-lock.js');
const { SESSION_STATES, ensureSessionSpaceTracking } = require('../core/session.js');
const { SURVEY_DOMAIN_ERROR_CODES: DOMAIN_ERROR_CODES, createSurveyDomainError } = require('../domain/errors.js');
const { addNode } = require('./wall-mutation-helpers.js');
const { cloneDraft, getActiveFloor: findActiveFloor, touchDraft } = require('../core/draft.js');

const { getNode } = require('../core/graph-query.js');
const { holdPreviewForInput } = require('./session-actions.js');
const { planPreview } = require('../interaction/preview.js');

const wallDomain = require('../domain/wall.js');

const normalizeMeasurementExtension = wallDomain.normalizeMeasurementAdjustment;
const normalizeMeasurementInset = wallDomain.normalizeMeasurementAdjustment;

const getActiveFloor = (draft) => findActiveFloor(draft, { requireFloorList: true });
function startPreview(draft, rawPoint) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  ensureSessionSpaceTracking(floor);
  delete floor.session.pendingMeasuredClosure;
  let plan = planPreview(floor, rawPoint);
  if (plan.kind === 'place-preview-anchor') {
    const anchor = addNode(floor, plan.point);
    floor.session.anchorNodeId = anchor.id;
    plan = planPreview(floor, rawPoint);
  }
  floor.session = plan.session;
  return touchDraft(next);
}

function startPreviewFromBearing(draft, bearingDeg, options) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  ensureSessionSpaceTracking(floor);
  const { rawPoint } = planBearingPreview(floor, bearingDeg, options);
  return startPreview(next, rawPoint);
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

function applyPreviewInteriorAngle(draft, interiorAngleDeg, source) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  ensureSessionSpaceTracking(floor);
  const plan = planInteriorAngle(floor, interiorAngleDeg, source);
  const previewed = startPreview(next, plan.rawPoint);
  const previewSession = getActiveFloor(previewed).session;
  transitionSessionState(previewSession, 'ANGLE_PREVIEW_UPDATED', SESSION_STATES.AWAITING_LENGTH);
  previewSession.previewAngleSource = plan.source;
  previewSession.previewInteriorAngleDeg = plan.angle;
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
  transitionSessionState(session, 'DIAGONAL_REOPENED', SESSION_STATES.AWAITING_LENGTH);
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

module.exports = {
  startPreview,
  startPreviewFromBearing,
  materializeLockedPreview,
  applyPreviewInteriorAngle,
  reopenLastDiagonalWallForAngle
};
