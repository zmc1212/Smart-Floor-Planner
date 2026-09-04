const { cloneDraft, getActiveFloor, touchDraft } = require('../core/draft.js');
const { mergeCollinearDegree2Walls, removeUnreferencedNodes, syncFloorSpaces } = require('./wall-mutation-helpers.js');
const { wrapOperation } = require('./transaction.js');

// Repair is also used on saved graphs. Validate the result after repairing the
// old collinear seams, never require an already-valid graph before repair.
function repairCollinearDegree2Walls(draft) {
  const next = cloneDraft(draft);
  const floor = getActiveFloor(next, { requireFloorList: true });
  mergeCollinearDegree2Walls(floor);
  if ((floor.spaces || []).some((space) => space && space.closed)) syncFloorSpaces(floor);
  removeUnreferencedNodes(floor);
  return touchDraft(next);
}

module.exports = {
  legacyRepairCollinearDegree2Walls: repairCollinearDegree2Walls,
  repairCollinearDegree2Walls: wrapOperation('repairCollinearDegree2Walls', repairCollinearDegree2Walls, { mode: 'full' })
};
