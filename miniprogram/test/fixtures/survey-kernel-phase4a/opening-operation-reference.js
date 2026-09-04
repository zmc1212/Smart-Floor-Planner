// Frozen Phase 3 opening mutations, captured before the Phase 4A extraction.
// Test-only reference: production operations must not depend on this module.
const {
  DEFAULT_DOOR_WIDTH_MM,
  DEFAULT_DOOR_HEIGHT_MM,
  DEFAULT_WINDOW_WIDTH_MM,
  DEFAULT_WINDOW_HEIGHT_MM,
  DEFAULT_WINDOW_SILL_HEIGHT_MM,
  DEFAULT_OPENING_DEPTH_MM,
  MIN_OPENING_SIZE_MM,
  MAX_OPENING_WALL_RATIO
} = require('../../../packages/surveying/utils/survey/core/constants.js');
const {
  cloneDraft,
  getActiveFloor: findActiveFloor,
  touchDraft
} = require('../../../packages/surveying/utils/survey/core/draft.js');
const { getWall } = require('../../../packages/surveying/utils/survey/core/graph-query.js');
const { SESSION_STATES } = require('../../../packages/surveying/utils/survey/core/session.js');
const openingDomain = require('../../../packages/surveying/utils/survey/domain/opening.js');
const domainValidation = require('../../../packages/surveying/utils/survey/domain/validation.js');
const {
  SURVEY_DOMAIN_ERROR_CODES: DOMAIN_ERROR_CODES,
  createSurveyDomainError
} = require('../../../packages/surveying/utils/survey/domain/errors.js');
const {
  adaptLegacySurveyOperation
} = require('../../../packages/surveying/utils/survey/compat/legacy-error-messages.js');

const getActiveFloor = (draft) => findActiveFloor(draft, { requireFloorList: true });

let idSeed = 1;

function nowIso() {
  return new Date().toISOString();
}

function nextId(prefix) {
  idSeed += 1;
  return `${prefix}-${Date.now().toString(36)}-${idSeed}`;
}

function ensureOpenings(floor) {
  if (!Array.isArray(floor.openings)) floor.openings = [];
  return floor.openings;
}

function getOpening(floor, openingId) {
  return ensureOpenings(floor).find((opening) => opening.id === openingId);
}

function normalizeOpeningToWall(floor, opening) {
  const wall = getWall(floor, opening.wallId);
  return openingDomain.normalizeOpeningToWall(opening, wall, {
    minimumSizeMm: MIN_OPENING_SIZE_MM,
    maximumWallRatio: MAX_OPENING_WALL_RATIO
  });
}

function addOpeningToWall(draft, wallId, type) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const wall = getWall(floor, wallId || floor.session.selectedWallId);
  if (!wall) {
    throw createSurveyDomainError(DOMAIN_ERROR_CODES.WALL_REQUIRED_FOR_OPENING);
  }

  const openingType = type === 'window' ? 'window' : 'door';
  const widthMm = openingType === 'window' ? DEFAULT_WINDOW_WIDTH_MM : DEFAULT_DOOR_WIDTH_MM;
  const opening = {
    id: nextId('opening'),
    wallId: wall.id,
    type: openingType,
    centerOffsetMm: Math.round((wall.lengthMm || 0) / 2),
    widthMm,
    heightMm: openingType === 'window' ? DEFAULT_WINDOW_HEIGHT_MM : DEFAULT_DOOR_HEIGHT_MM,
    sillHeightMm: openingType === 'window' ? DEFAULT_WINDOW_SILL_HEIGHT_MM : 0,
    openDirection: openingType === 'door' ? 'inside' : '',
    modelId: openingType === 'window' ? 'window-flat-basic' : 'door-single-basic',
    modelCategory: openingType === 'window' ? 'flat-window' : 'single-door',
    materialId: openingType === 'window' ? 'dark-gray' : 'warm-white',
    depthMm: wall.thicknessMm || DEFAULT_OPENING_DEPTH_MM,
    entryDoor: false,
    source: 'manual',
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  normalizeOpeningToWall(floor, opening);
  openingDomain.normalizeOpeningDirection(opening);
  ensureOpenings(floor).push(opening);
  floor.session.state = SESSION_STATES.WALL_SELECTED;
  floor.session.selectedWallId = wall.id;
  floor.session.selectedOpeningId = opening.id;
  floor.session.selectedSpaceId = '';
  return touchDraft(next);
}

function updateOpening(draft, openingId, patch) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const opening = getOpening(floor, openingId || floor.session.selectedOpeningId);
  if (!opening) {
    throw createSurveyDomainError(DOMAIN_ERROR_CODES.OPENING_REQUIRED);
  }

  const updates = patch || {};
  if (Object.prototype.hasOwnProperty.call(updates, 'widthMm')) {
    opening.widthMm = domainValidation.validateOpeningSize(updates.widthMm, 'opening width');
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'heightMm')) {
    opening.heightMm = domainValidation.validateOpeningSize(updates.heightMm, 'opening height');
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'sillHeightMm')) {
    opening.sillHeightMm = domainValidation.validateOpeningSillHeight(updates.sillHeightMm);
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'depthMm')) {
    opening.depthMm = domainValidation.validateOpeningDepth(updates.depthMm);
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'centerOffsetMm')) {
    opening.centerOffsetMm = domainValidation.validateOpeningOffset(updates.centerOffsetMm);
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'openDirection') && opening.type === 'door') {
    opening.openDirection = updates.openDirection;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'modelId')) {
    opening.modelId = String(updates.modelId || '');
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'modelCategory')) {
    opening.modelCategory = String(updates.modelCategory || '');
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'materialId')) {
    opening.materialId = String(updates.materialId || '');
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'entryDoor') && opening.type === 'door') {
    const nextEntryDoor = !!updates.entryDoor;
    ensureOpenings(floor).forEach((item) => {
      if (item.type === 'door') {
        item.entryDoor = nextEntryDoor && item.id === opening.id;
      }
    });
  }

  normalizeOpeningToWall(floor, opening);
  openingDomain.normalizeOpeningDirection(opening);
  opening.updatedAt = nowIso();
  floor.session.state = SESSION_STATES.WALL_SELECTED;
  floor.session.selectedWallId = opening.wallId;
  floor.session.selectedOpeningId = opening.id;
  return touchDraft(next);
}

function deleteOpening(draft, openingId) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const targetId = openingId || floor.session.selectedOpeningId;
  const opening = getOpening(floor, targetId);
  if (!opening) return next;

  floor.openings = ensureOpenings(floor).filter((item) => item.id !== targetId);
  floor.session.state = SESSION_STATES.WALL_SELECTED;
  floor.session.selectedWallId = opening.wallId;
  floor.session.selectedOpeningId = '';
  return touchDraft(next);
}

module.exports = {
  addOpeningToWall: adaptLegacySurveyOperation(addOpeningToWall),
  updateOpening: adaptLegacySurveyOperation(updateOpening),
  deleteOpening
};
