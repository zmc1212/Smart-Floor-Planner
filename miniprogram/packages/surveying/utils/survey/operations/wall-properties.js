const { cloneDraft, getActiveFloor, touchDraft } = require('../core/draft.js');
const { getWall } = require('../core/graph-query.js');
const { validateThickness } = require('../domain/validation.js');
const { planMeasurementSide } = require('../interaction/measurement-side.js');
const { adaptLegacySurveyOperation } = require('../compat/legacy-error-messages.js');
const { runSurveyTransaction, wrapOperation } = require('./transaction.js');

function planThickness(draft, thicknessMm, wallId) {
  const parsedThickness = validateThickness(thicknessMm);
  const floor = getActiveFloor(draft, { requireFloorList: true });
  const targetWallId = wallId || floor.session.selectedWallId;
  const wall = targetWallId ? getWall(floor, targetWallId) : null;
  return { kind: 'thickness', wallId: wall ? wall.id : null, thicknessMm: parsedThickness };
}

function applyWallPropertyPlan(draft, plan) {
  const next = cloneDraft(draft);
  if (plan.kind === 'noop') return next;
  const floor = getActiveFloor(next, { requireFloorList: true });
  const wall = plan.wallId ? getWall(floor, plan.wallId) : null;
  if (plan.kind === 'thickness') {
    floor.session.thicknessMm = plan.thicknessMm;
    next.settings.defaultThicknessMm = plan.thicknessMm;
    if (wall) wall.thicknessMm = plan.thicknessMm;
  } else {
    Object.assign(floor.session, plan.sessionPatch);
    if (wall) Object.assign(wall, plan.wallPatch);
  }
  return touchDraft(next);
}

function setThickness(draft, thicknessMm, wallId) {
  return applyWallPropertyPlan(draft, planThickness(draft, thicknessMm, wallId));
}

function setMeasurementSide(draft, side, wallId) {
  const floor = getActiveFloor(draft, { requireFloorList: true });
  return applyWallPropertyPlan(draft, planMeasurementSide(floor, side, wallId));
}

function transactionalMeasurementSide(draft, side, wallId) {
  const floor = getActiveFloor(draft, { requireFloorList: true });
  const plan = planMeasurementSide(floor, side, wallId);
  // An ineligible toggle historically returns an untouched clone, timestamp
  // included. Only an actual property write enters the transaction.
  if (plan.kind === 'noop') return cloneDraft(draft);
  return runSurveyTransaction(draft, 'setMeasurementSide', source => applyWallPropertyPlan(source, plan));
}

const legacySetThickness = adaptLegacySurveyOperation(setThickness);

// These edits preserve topology and Space identity; render faces/dimensions
// derive from the wall properties. Do not resync/recreate spaces for metadata.
module.exports = {
  planThickness,
  applyWallPropertyPlan,
  legacySetThickness,
  legacySetMeasurementSide: setMeasurementSide,
  setThickness: wrapOperation('setThickness', legacySetThickness),
  setMeasurementSide: transactionalMeasurementSide
};
