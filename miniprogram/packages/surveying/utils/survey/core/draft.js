function cloneDraft(draft) {
  return JSON.parse(JSON.stringify(draft));
}

function getActiveFloor(draft) {
  if (!draft || !Array.isArray(draft.floors)) return null;
  return draft.floors.find((floor) => floor.id === draft.activeFloorId) || draft.floors[0] || null;
}

function touchDraft(draft, now) {
  draft.updatedAt = (now || new Date()).toISOString();
  return draft;
}

module.exports = {
  cloneDraft,
  getActiveFloor,
  touchDraft
};
