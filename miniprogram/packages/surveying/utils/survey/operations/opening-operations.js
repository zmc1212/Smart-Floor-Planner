const { transitionSessionState } = require('../session/state-machine.js');
const {
  DEFAULT_DOOR_WIDTH_MM,
  DEFAULT_DOOR_HEIGHT_MM,
  DEFAULT_WINDOW_WIDTH_MM,
  DEFAULT_WINDOW_HEIGHT_MM,
  DEFAULT_WINDOW_SILL_HEIGHT_MM,
  DEFAULT_OPENING_DEPTH_MM,
  MIN_OPENING_SIZE_MM,
  MAX_OPENING_WALL_RATIO
} = require('../core/constants.js');
const {
  cloneDraft,
  getActiveFloor: findActiveFloor,
  touchDraft
} = require('../core/draft.js');
const { getWall } = require('../core/graph-query.js');
const { SESSION_STATES } = require('../core/session.js');
const openingDomain = require('../domain/opening.js');
const domainValidation = require('../domain/validation.js');
const {
  SURVEY_DOMAIN_ERROR_CODES: DOMAIN_ERROR_CODES,
  createSurveyDomainError
} = require('../domain/errors.js');
const { adaptLegacySurveyOperation } = require('../compat/legacy-error-messages.js');
const { wrapOperation } = require('./transaction.js');

const getActiveFloor = (draft) => findActiveFloor(draft, { requireFloorList: true });

let openingIdSeed = 1;

function nowIso() {
  return new Date().toISOString();
}

function nextOpeningId() {
  openingIdSeed += 1;
  return `opening-${Date.now().toString(36)}-${openingIdSeed}`;
}

function ensureOpenings(floor) {
  if (!Array.isArray(floor.openings)) floor.openings = [];
  return floor.openings;
}

function listOpenings(floor) {
  return Array.isArray(floor.openings) ? floor.openings : [];
}

function getOpening(floor, openingId) {
  return listOpenings(floor).find((opening) => opening.id === openingId);
}

function normalizeOpeningForHost(floor, opening) {
  const wall = getWall(floor, opening.wallId);
  openingDomain.normalizeOpeningToWall(opening, wall, {
    minimumSizeMm: MIN_OPENING_SIZE_MM,
    maximumWallRatio: MAX_OPENING_WALL_RATIO
  });
  openingDomain.normalizeOpeningDirection(opening);
  return opening;
}

function planAddOpening(draft, wallId, type) {
  const floor = getActiveFloor(draft);
  const wall = getWall(floor, wallId || floor.session.selectedWallId);
  if (!wall) {
    throw createSurveyDomainError(DOMAIN_ERROR_CODES.WALL_REQUIRED_FOR_OPENING);
  }

  const openingType = type === 'window' ? 'window' : 'door';
  const opening = {
    id: nextOpeningId(),
    wallId: wall.id,
    type: openingType,
    centerOffsetMm: Math.round((wall.lengthMm || 0) / 2),
    widthMm: openingType === 'window' ? DEFAULT_WINDOW_WIDTH_MM : DEFAULT_DOOR_WIDTH_MM,
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
  normalizeOpeningForHost(floor, opening);

  return {
    kind: 'add-opening',
    floorId: floor.id,
    wallId: wall.id,
    opening
  };
}

function planUpdateOpening(draft, openingId, patch) {
  const floor = getActiveFloor(draft);
  const opening = getOpening(floor, openingId || floor.session.selectedOpeningId);
  if (!opening) {
    throw createSurveyDomainError(DOMAIN_ERROR_CODES.OPENING_REQUIRED);
  }

  const updates = patch || {};
  const replacement = Object.assign({}, opening);
  if (Object.prototype.hasOwnProperty.call(updates, 'widthMm')) {
    replacement.widthMm = domainValidation.validateOpeningSize(updates.widthMm, 'opening width');
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'heightMm')) {
    replacement.heightMm = domainValidation.validateOpeningSize(updates.heightMm, 'opening height');
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'sillHeightMm')) {
    replacement.sillHeightMm = domainValidation.validateOpeningSillHeight(updates.sillHeightMm);
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'depthMm')) {
    replacement.depthMm = domainValidation.validateOpeningDepth(updates.depthMm);
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'centerOffsetMm')) {
    replacement.centerOffsetMm = domainValidation.validateOpeningOffset(updates.centerOffsetMm);
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'openDirection') && opening.type === 'door') {
    replacement.openDirection = updates.openDirection;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'modelId')) {
    replacement.modelId = String(updates.modelId || '');
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'modelCategory')) {
    replacement.modelCategory = String(updates.modelCategory || '');
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'materialId')) {
    replacement.materialId = String(updates.materialId || '');
  }

  const entryDoorStates = [];
  if (Object.prototype.hasOwnProperty.call(updates, 'entryDoor') && opening.type === 'door') {
    const nextEntryDoor = !!updates.entryDoor;
    listOpenings(floor).forEach((item) => {
      if (item.type === 'door') {
        entryDoorStates.push({
          openingId: item.id,
          entryDoor: nextEntryDoor && item.id === opening.id
        });
      }
    });
  }

  normalizeOpeningForHost(floor, replacement);
  replacement.updatedAt = nowIso();
  return {
    kind: 'update-opening',
    floorId: floor.id,
    wallId: replacement.wallId,
    openingId: replacement.id,
    replacement,
    entryDoorStates
  };
}

function planDeleteOpening(draft, openingId) {
  const floor = getActiveFloor(draft);
  const targetId = openingId || floor.session.selectedOpeningId;
  const opening = getOpening(floor, targetId);
  if (!opening) {
    return {
      kind: 'delete-opening',
      floorId: floor.id,
      openingId: targetId,
      noop: true
    };
  }
  return {
    kind: 'delete-opening',
    floorId: floor.id,
    wallId: opening.wallId,
    openingId: targetId,
    noop: false
  };
}

function applyOpeningPlan(draft, plan) {
  const floor = getActiveFloor(draft);
  if (!plan || plan.floorId !== floor.id) {
    throw new TypeError('门窗变更计划与当前楼层不匹配');
  }

  if (plan.kind === 'add-opening') {
    ensureOpenings(floor).push(plan.opening);
    transitionSessionState(floor.session, 'OBJECT_SELECTED', SESSION_STATES.WALL_SELECTED);
    floor.session.selectedWallId = plan.wallId;
    floor.session.selectedOpeningId = plan.opening.id;
    floor.session.selectedSpaceId = '';
    return {
      changed: true,
      kind: plan.kind,
      wallId: plan.wallId,
      openingId: plan.opening.id
    };
  }

  if (plan.kind === 'update-opening') {
    const opening = getOpening(floor, plan.openingId);
    if (!opening) throw createSurveyDomainError(DOMAIN_ERROR_CODES.OPENING_REQUIRED);
    Object.assign(opening, plan.replacement);
    plan.entryDoorStates.forEach((entry) => {
      const item = getOpening(floor, entry.openingId);
      if (item && item.type === 'door') item.entryDoor = entry.entryDoor;
    });
    transitionSessionState(floor.session, 'OBJECT_SELECTED', SESSION_STATES.WALL_SELECTED);
    floor.session.selectedWallId = opening.wallId;
    floor.session.selectedOpeningId = opening.id;
    return {
      changed: true,
      kind: plan.kind,
      wallId: opening.wallId,
      openingId: opening.id
    };
  }

  if (plan.kind === 'delete-opening') {
    // Keep legacy normalization on the transaction draft, never while planning.
    const openings = ensureOpenings(floor);
    if (plan.noop) {
      return {
        changed: false,
        kind: plan.kind,
        openingId: plan.openingId || ''
      };
    }
    floor.openings = openings.filter((item) => item.id !== plan.openingId);
    transitionSessionState(floor.session, 'OBJECT_SELECTED', SESSION_STATES.WALL_SELECTED);
    floor.session.selectedWallId = plan.wallId;
    floor.session.selectedOpeningId = '';
    return {
      changed: true,
      kind: plan.kind,
      wallId: plan.wallId,
      openingId: plan.openingId
    };
  }

  throw new TypeError(`未知门窗变更计划：${plan.kind || ''}`);
}

function runPlannedOpeningOperation(draft, planFactory, args) {
  const next = cloneDraft(draft);
  const plan = planFactory(next, ...(args || []));
  const result = applyOpeningPlan(next, plan);
  if (!result.changed) return next;
  return touchDraft(next);
}

function addOpeningToWall(draft, wallId, type) {
  return runPlannedOpeningOperation(draft, planAddOpening, [wallId, type]);
}

function updateOpening(draft, openingId, patch) {
  return runPlannedOpeningOperation(draft, planUpdateOpening, [openingId, patch]);
}

function deleteOpening(draft, openingId) {
  return runPlannedOpeningOperation(draft, planDeleteOpening, [openingId]);
}

const legacyOpeningOperations = Object.freeze({
  addOpeningToWall: adaptLegacySurveyOperation(addOpeningToWall),
  updateOpening: adaptLegacySurveyOperation(updateOpening),
  deleteOpening
});

function createOpeningOperations() {
  return {
    addOpeningToWall: wrapOperation(
      'addOpeningToWall',
      legacyOpeningOperations.addOpeningToWall
    ),
    updateOpening: wrapOperation(
      'updateOpening',
      legacyOpeningOperations.updateOpening
    ),
    deleteOpening: wrapOperation(
      'deleteOpening',
      legacyOpeningOperations.deleteOpening
    )
  };
}

module.exports = {
  applyOpeningPlan,
  createOpeningOperations,
  legacyOpeningOperations,
  normalizeOpeningForHost,
  planAddOpening,
  planDeleteOpening,
  planUpdateOpening
};
