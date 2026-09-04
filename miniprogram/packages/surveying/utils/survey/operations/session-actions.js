const { planLockPreviewBearing, planClearBleLockedBearing } = require('../interaction/direction-lock.js');
const { cloneDraft, getActiveFloor: findActiveFloor, touchDraft } = require('../core/draft.js');
const { planCancelPending, planHoldPreviewForInput, planSelectOpening, planSelectSpace, planSelectWall, planSetFixedNode, planSetMode, planStartRemeasure, planStartWallSnap } = require('../interaction/session-actions.js');
const getActiveFloor = (draft) => findActiveFloor(draft, { requireFloorList: true });
function setMode(draft, mode) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const plan = planSetMode(floor, mode);
  floor.session = plan.session;
  return plan.changed ? touchDraft(next) : next;
}

function lockPreviewBearing(draft, bearingDeg) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const plan = planLockPreviewBearing(floor, bearingDeg);
  floor.session = plan.session;
  return plan.changed ? touchDraft(next) : next;
}

function clearBleLockedBearing(draft) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const plan = planClearBleLockedBearing(floor);
  floor.session = plan.session;
  return plan.changed ? touchDraft(next) : next;
}

function holdPreviewForInput(draft) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const plan = planHoldPreviewForInput(floor);
  floor.session = plan.session;
  return plan.changed ? touchDraft(next) : next;
}

function cancelPending(draft) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const plan = planCancelPending(floor);
  floor.session = plan.session;
  return plan.changed ? touchDraft(next) : next;
}

function selectWall(draft, wallId) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const plan = planSelectWall(floor, wallId);
  floor.session = plan.session;
  return plan.changed ? touchDraft(next) : next;
}

function selectOpening(draft, openingId) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const plan = planSelectOpening(floor, openingId);
  floor.session = plan.session;
  return plan.changed ? touchDraft(next) : next;
}

function selectSpace(draft, spaceId) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const plan = planSelectSpace(floor, spaceId);
  floor.session = plan.session;
  return plan.changed ? touchDraft(next) : next;
}

function startWallSnap(draft) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const plan = planStartWallSnap(floor);
  floor.session = plan.session;
  return plan.changed ? touchDraft(next) : next;
}

function startRemeasure(draft) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const plan = planStartRemeasure(floor);
  floor.session = plan.session;
  return plan.changed ? touchDraft(next) : next;
}

function setFixedNode(draft, nodeId) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next);
  const plan = planSetFixedNode(floor, nodeId);
  floor.session = plan.session;
  return plan.changed ? touchDraft(next) : next;
}

module.exports = {
  setMode,
  lockPreviewBearing,
  clearBleLockedBearing,
  holdPreviewForInput,
  cancelPending,
  selectWall,
  selectOpening,
  selectSpace,
  startWallSnap,
  startRemeasure,
  setFixedNode
};
