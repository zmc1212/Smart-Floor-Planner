const test = require('node:test');
const assert = require('node:assert/strict');

const {
  wrapFormalDraftStorage,
  unwrapFormalDraftStorage,
  getDraftGeometryFingerprint,
  hasPersistedSurveyContent,
  shouldAutosaveSurveyDraft,
  shouldKeepLocalSurveyDraft
} = require('../packages/surveying/utils/surveyDraftAutosave');

function makeDraft(overrides) {
  const walls = overrides && overrides.walls ? overrides.walls : [];
  const nodes = overrides && overrides.nodes ? overrides.nodes : [];
  const openings = overrides && overrides.openings ? overrides.openings : [];
  const spaces = overrides && overrides.spaces ? overrides.spaces : [];
  return {
    kind: 'survey-wall-graph',
    source: 'surveying-editor',
    activeFloorId: 'floor-1',
    floors: [
      {
        id: 'floor-1',
        nodes,
        walls,
        openings,
        spaces,
        session: { state: 'idle' },
        viewport: overrides && overrides.viewport ? overrides.viewport : { scale: 1, x: 0, y: 0 }
      }
    ]
  };
}

test('unwraps legacy raw drafts and current envelopes', () => {
  const raw = makeDraft({ walls: [{ id: 'w1' }] });
  assert.deepEqual(unwrapFormalDraftStorage(raw), { draft: raw, savedAt: 0 });
  assert.deepEqual(unwrapFormalDraftStorage(null), { draft: null, savedAt: 0 });

  const wrapped = wrapFormalDraftStorage(raw, 1700000000000);
  assert.equal(wrapped.kind, 'survey-draft-envelope');
  assert.equal(wrapped.savedAt, 1700000000000);
  assert.equal(wrapped.draft, raw);
  assert.deepEqual(unwrapFormalDraftStorage(wrapped), {
    draft: raw,
    savedAt: 1700000000000
  });
});

test('geometry fingerprint ignores viewport and pending session', () => {
  const first = makeDraft({
    walls: [{ id: 'w1', startNodeId: 'n1', endNodeId: 'n2', lengthMm: 3000 }],
    viewport: { scale: 1, x: 0, y: 0 }
  });
  const panned = makeDraft({
    walls: [{ id: 'w1', startNodeId: 'n1', endNodeId: 'n2', lengthMm: 3000 }],
    viewport: { scale: 2, x: 40, y: 80 }
  });
  panned.floors[0].session = { state: 'wallPreview' };
  assert.equal(getDraftGeometryFingerprint(first), getDraftGeometryFingerprint(panned));

  const extraWall = makeDraft({
    walls: [
      { id: 'w1', startNodeId: 'n1', endNodeId: 'n2', lengthMm: 3000 },
      { id: 'w2', startNodeId: 'n2', endNodeId: 'n3', lengthMm: 2400 }
    ]
  });
  assert.notEqual(getDraftGeometryFingerprint(first), getDraftGeometryFingerprint(extraWall));
});

test('autosave skips empty new sessions and unchanged cloud copies', () => {
  const empty = makeDraft({});
  const measured = makeDraft({
    walls: [{ id: 'w1', startNodeId: 'n1', endNodeId: 'n2', lengthMm: 3000 }]
  });

  assert.equal(hasPersistedSurveyContent(empty), false);
  assert.equal(hasPersistedSurveyContent(measured), true);
  assert.equal(shouldAutosaveSurveyDraft(empty, { serverDraftId: '' }), false);
  assert.equal(shouldAutosaveSurveyDraft(empty, { serverDraftId: 'plan-1' }), true);
  assert.equal(shouldAutosaveSurveyDraft(measured, {}), true);
  assert.equal(shouldAutosaveSurveyDraft(measured, { cloudLoadInFlight: true }), false);
  assert.equal(shouldAutosaveSurveyDraft(measured, { cloudSaveInFlight: true }), false);
  assert.equal(
    shouldAutosaveSurveyDraft(measured, {
      lastCloudFingerprint: getDraftGeometryFingerprint(measured)
    }),
    false
  );
});

test('keeps a newer local draft instead of a stale cloud copy', () => {
  const local = makeDraft({
    walls: [
      { id: 'w1', startNodeId: 'n1', endNodeId: 'n2', lengthMm: 3000 },
      { id: 'w2', startNodeId: 'n2', endNodeId: 'n3', lengthMm: 2400 }
    ]
  });
  const server = makeDraft({
    walls: [{ id: 'w1', startNodeId: 'n1', endNodeId: 'n2', lengthMm: 3000 }]
  });

  assert.equal(shouldKeepLocalSurveyDraft(local, 2000, server, 1000), true);
  assert.equal(shouldKeepLocalSurveyDraft(local, 1000, server, 2000), false);
  assert.equal(shouldKeepLocalSurveyDraft(local, 2000, local, 1000), false);
  assert.equal(shouldKeepLocalSurveyDraft(local, 0, server, 1000), true);
  assert.equal(shouldKeepLocalSurveyDraft(server, 0, local, 1000), false);
});
