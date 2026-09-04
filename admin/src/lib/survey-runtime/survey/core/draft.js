const {
  DEFAULT_THICKNESS_MM,
  DEFAULT_SCALE
} = require('./constants.js');
const { createSession } = require('./session.js');

const TRANSACTION_DRAFT_SYMBOL = Symbol.for('smart-floor-planner.survey-transaction-draft');

function createSurveyDraft() {
  const timestamp = new Date().toISOString();
  return {
    schemaVersion: 1,
    kind: 'survey-wall-graph',
    status: 'draft',
    activeFloorId: 'floor-1',
    floors: [
      {
        id: 'floor-1',
        name: '1F',
        elevationMm: 0,
        nodes: [],
        walls: [],
        openings: [],
        spaces: [],
        session: createSession(),
        viewport: { scale: DEFAULT_SCALE, offsetX: 0, offsetY: 0 }
      }
    ],
    settings: {
      defaultThicknessMm: DEFAULT_THICKNESS_MM,
      orientationDeg: 0
    },
    source: 'surveying-editor',
    updatedAt: timestamp
  };
}

function cloneDraft(draft, options) {
  if (draft && draft[TRANSACTION_DRAFT_SYMBOL] && !(options && options.force)) return draft;
  return JSON.parse(JSON.stringify(draft));
}

function getActiveFloor(draft, options) {
  // The guarded core helper predates the extraction. The public legacy entry
  // requires a floor list and returns undefined for an empty one, not null.
  const requireFloorList = !!(options && options.requireFloorList);
  if (!requireFloorList && (!draft || !Array.isArray(draft.floors))) return null;
  const floor = draft.floors.find((entry) => entry.id === draft.activeFloorId) || draft.floors[0];
  return requireFloorList ? floor : floor || null;
}

function touchDraft(draft, now) {
  const timestamp = now || new Date();
  draft.updatedAt = typeof timestamp === 'string' ? timestamp : timestamp.toISOString();
  return draft;
}

module.exports = {
  TRANSACTION_DRAFT_SYMBOL,
  createSurveyDraft,
  cloneDraft,
  getActiveFloor,
  touchDraft
};
