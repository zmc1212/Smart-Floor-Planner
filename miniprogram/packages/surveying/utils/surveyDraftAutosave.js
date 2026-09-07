const FORMAL_DRAFT_ENVELOPE_KIND = 'survey-draft-envelope';

function unwrapFormalDraftStorage(stored) {
  if (stored && stored.kind === FORMAL_DRAFT_ENVELOPE_KIND && stored.draft) {
    return {
      draft: stored.draft,
      savedAt: Number(stored.savedAt) || 0
    };
  }
  return { draft: stored || null, savedAt: 0 };
}

function wrapFormalDraftStorage(draft, savedAt) {
  return {
    kind: FORMAL_DRAFT_ENVELOPE_KIND,
    savedAt: savedAt || Date.now(),
    draft
  };
}

function getDraftContentStats(draft) {
  if (!draft || !Array.isArray(draft.floors) || !draft.floors.length) {
    return { wallCount: 0, spaceCount: 0, openingCount: 0 };
  }

  return draft.floors.reduce((stats, floor) => {
    const walls = Array.isArray(floor && floor.walls) ? floor.walls : [];
    const spaces = Array.isArray(floor && floor.spaces) ? floor.spaces : [];
    const openings = Array.isArray(floor && floor.openings) ? floor.openings : [];
    stats.wallCount += walls.length;
    stats.spaceCount += spaces.filter((space) => space && space.closed).length;
    stats.openingCount += openings.length;
    return stats;
  }, { wallCount: 0, spaceCount: 0, openingCount: 0 });
}

function hasPersistedSurveyContent(draft) {
  const stats = getDraftContentStats(draft);
  return stats.wallCount > 0 || stats.spaceCount > 0 || stats.openingCount > 0;
}

// Fingerprint all persisted business fields, without view/session noise or clocks.
// Sorted keys also make override-map insertion order immaterial.
function businessValue(value) {
  if (Array.isArray(value)) return value.map(businessValue);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  Object.keys(value).sort().forEach(key => {
    if (['viewport', 'session', 'updatedAt', 'createdAt', 'measuredAt'].includes(key)) return;
    result[key] = businessValue(value[key]);
  });
  return result;
}

function getDraftGeometryFingerprint(draft) {
  if (!draft || !Array.isArray(draft.floors)) return '';
  const content = businessValue(draft);
  delete content.status;
  content.floors.forEach((floor, index) => {
    if (!floor) return;
    const pending = draft.floors[index].session && draft.floors[index].session.pendingMeasuredClosure;
    if (pending) floor.pendingMeasuredClosure = businessValue(pending);
  });
  return JSON.stringify(content);
}

function shouldAutosaveSurveyDraft(draft, options) {
  const opts = options || {};
  if (!draft) return false;
  if (opts.cloudLoadInFlight || opts.cloudSaveInFlight) return false;
  const fingerprint = getDraftGeometryFingerprint(draft);
  if (opts.lastCloudFingerprint && fingerprint === opts.lastCloudFingerprint) return false;
  if (!hasPersistedSurveyContent(draft) && !opts.serverDraftId) return false;
  return true;
}

function shouldKeepLocalSurveyDraft(localDraft, localSavedAt, serverDraft, serverUpdatedAt) {
  if (!localDraft || !serverDraft) return false;
  if (getDraftGeometryFingerprint(localDraft) === getDraftGeometryFingerprint(serverDraft)) {
    return false;
  }

  const localAt = Number(localSavedAt) || 0;
  const serverAt = Number(serverUpdatedAt) || 0;
  if (localAt > 0 && serverAt > 0) return localAt > serverAt;

  const localStats = getDraftContentStats(localDraft);
  const serverStats = getDraftContentStats(serverDraft);
  return localStats.wallCount > serverStats.wallCount
    || localStats.openingCount > serverStats.openingCount
    || localStats.spaceCount > serverStats.spaceCount;
}

module.exports = {
  FORMAL_DRAFT_ENVELOPE_KIND,
  unwrapFormalDraftStorage,
  wrapFormalDraftStorage,
  getDraftContentStats,
  hasPersistedSurveyContent,
  getDraftGeometryFingerprint,
  shouldAutosaveSurveyDraft,
  shouldKeepLocalSurveyDraft
};
