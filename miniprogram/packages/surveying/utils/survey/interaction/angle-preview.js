const { copyTrackedSession } = require('../core/session-copy.js');
const { getNode } = require('../core/graph-query.js');
const { getIncomingWallAtAnchor, getIncomingAngleAtAnchor } = require('../core/incoming-wall.js');
const { validateInteriorAngle } = require('../domain/validation.js');
const { angleDeg, normalizeSignedAngleDeg: normalizeSignedAngle } = require('../geometry/vector2.js');
const { SURVEY_DOMAIN_ERROR_CODES: DOMAIN_ERROR_CODES, createSurveyDomainError } = require('../domain/errors.js');

function planInteriorAngle(floor, interiorAngleDeg, source) {
  const session = copyTrackedSession(floor);
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


  return { rawPoint: nextPoint, angle, source: source || 'manual' };
}

module.exports = { planInteriorAngle };
