const { cloneDraft, getActiveFloor, touchDraft } = require('../core/draft.js');
const { planViewport } = require('../interaction/viewport.js');

function updateViewport(draft, viewportPatch) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next, { requireFloorList: true });
  floor.viewport = planViewport(floor, viewportPatch).viewport;
  return touchDraft(next);
}

module.exports = { updateViewport };
