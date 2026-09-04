const draftCore = require('../core/draft.js');

// The historical entry requires a floor list and preserves undefined for [];
// internal callers can continue using the nullable core query.
const getActiveFloor = (draft) => draftCore.getActiveFloor(draft, { requireFloorList: true });

module.exports = { getActiveFloor };
