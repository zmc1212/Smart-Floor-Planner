const { cloneDraft, getActiveFloor, touchDraft } = require('../core/draft.js');
const { getClosedSpace } = require('../core/graph-query.js');
const { SURVEY_DOMAIN_ERROR_CODES: CODES, createSurveyDomainError } = require('../domain/errors.js');
const { adaptLegacySurveyOperation } = require('../compat/legacy-error-messages.js');
const { wrapOperation } = require('./transaction.js');

const MAX_SPACE_NAME_LENGTH = 20;

function planRenameClosedSpace(draft, spaceId, name) {
  const floor = getActiveFloor(draft, { requireFloorList: true });
  const space = getClosedSpace(floor, spaceId || (floor.session && floor.session.selectedSpaceId));
  if (!space) throw createSurveyDomainError(CODES.CLOSED_SPACE_REQUIRED);
  const nextName = String(name == null ? '' : name).trim();
  if (!nextName) throw createSurveyDomainError(CODES.ROOM_NAME_REQUIRED);
  if (nextName.length > MAX_SPACE_NAME_LENGTH) {
    throw createSurveyDomainError(CODES.ROOM_NAME_TOO_LONG, { maximumCharacters: MAX_SPACE_NAME_LENGTH });
  }
  return { spaceId: space.id, name: nextName };
}

function applySpaceNamePlan(draft, plan) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next, { requireFloorList: true });
  getClosedSpace(floor, plan.spaceId).name = plan.name;
  return touchDraft(next);
}

function renameClosedSpace(draft, spaceId, name) {
  return applySpaceNamePlan(draft, planRenameClosedSpace(draft, spaceId, name));
}

const legacyRenameClosedSpace = adaptLegacySurveyOperation(renameClosedSpace);

module.exports = {
  planRenameClosedSpace,
  applySpaceNamePlan,
  legacyRenameClosedSpace,
  renameClosedSpace: wrapOperation('renameClosedSpace', legacyRenameClosedSpace)
};
