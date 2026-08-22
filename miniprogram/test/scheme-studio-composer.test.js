const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applyModelDefaults,
  applyScopeToDraft,
  buildComposerViewState,
  buildDraftFromBatch,
  buildScopePickerOptions,
  buildScopeSubmitPayload,
  buildTemplateCategoryChips,
  buildTemplateListParams,
  createDefaultDraft,
  flattenPromptCategories,
  maxUserReferenceImages,
  parseTemplateListPayload,
  resolveDraftScope,
  resolvePreferredTemplateCategoryId,
  withFloorPlanPreviewRoom,
} = require('../components/ai-scheme-composer/ai-scheme-composer-model.js');
const { buildScopes } = require('../packages/ai-workflow/recipe-project/recipe-project-model.js');

const bootstrap = {
  account: { availableBalance: 100 },
  provider: { actionEnabled: true, supportsEdit: true },
  models: [{
    id: 'model-a',
    name: '模型 A',
    maxReferenceImages: 4,
    defaults: { aspectRatio: '4:3', resolutionTier: '2K' },
    aspectRatios: ['1:1', '4:3'],
    resolutionTiers: ['1K', '2K'],
    prices: [
      { resolutionTier: '1K', credits: 2 },
      { resolutionTier: '2K', credits: 4 },
    ],
  }],
};

test('maxUserReferenceImages reserves one slot for floor-plan control image', () => {
  assert.equal(maxUserReferenceImages(4), 3);
  assert.equal(maxUserReferenceImages(1), 0);
});

test('applyModelDefaults follows model catalog defaults', () => {
  const draft = applyModelDefaults(createDefaultDraft(bootstrap), bootstrap.models[0]);
  assert.equal(draft.modelProfileId, 'model-a');
  assert.equal(draft.aspectRatio, '4:3');
  assert.equal(draft.resolutionTier, '2K');
});

test('buildComposerViewState enables submit when draft and balance are valid', () => {
  const draft = {
    ...createDefaultDraft(bootstrap),
    prompt: '奶油风客厅，自然光',
    count: 1,
  };
  const view = buildComposerViewState(draft, bootstrap);
  assert.equal(view.canSubmit, true);
  assert.equal(view.estimatedCredits, 4);
  assert.equal(view.canAddReference, true);
});

test('flattenPromptCategories keeps depth-first order for nested categories', () => {
  const flat = flattenPromptCategories([
    { sourceId: 'root-a', name: '空间', level: 1 },
    { sourceId: 'child-a', parentSourceId: 'root-a', name: '客厅', level: 2 },
    { sourceId: 'root-b', name: '热门必备', level: 1 },
  ]);
  assert.deepEqual(flat.map((item) => item.sourceId), ['root-a', 'child-a', 'root-b']);
});

test('resolvePreferredTemplateCategoryId prefers 热门必备', () => {
  assert.equal(resolvePreferredTemplateCategoryId([
    { sourceId: 'space', name: '空间', level: 1 },
    { sourceId: 'hot', name: '热门必备', level: 1 },
  ]), 'hot');
  assert.equal(resolvePreferredTemplateCategoryId([{ sourceId: 'space', name: '空间', level: 1 }]), '');
});

test('buildTemplateCategoryChips prepends 全部 and marks active category', () => {
  const chips = buildTemplateCategoryChips(
    [{ sourceId: 'hot', name: '热门必备', level: 1 }],
    'hot',
  );
  assert.equal(chips[0].id, '__all__');
  assert.equal(chips[0].active, false);
  assert.equal(chips[1].id, 'hot');
  assert.equal(chips[1].active, true);
});

test('buildTemplateListParams sends category only when query is empty', () => {
  assert.deepEqual(buildTemplateListParams({ categoryId: 'hot', query: '', page: 1, limit: 40 }), {
    page: 1,
    limit: 40,
    categorySourceId: 'hot',
  });
  assert.deepEqual(buildTemplateListParams({ categoryId: 'hot', query: ' 奶油 ', page: 2, limit: 40 }), {
    page: 2,
    limit: 40,
    q: '奶油',
  });
});

test('parseTemplateListPayload normalizes items and pagination', () => {
  const parsed = parseTemplateListPayload({
    items: [{ id: 't1', name: '原木奶油客厅' }],
    pagination: { page: 1, total: 12 },
  });
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.total, 12);
  assert.equal(parsed.page, 1);
});

test('composer apply-to scope defaults to the whole floor plan and can select a closed room', () => {
  const scopes = buildScopes(
    [{ roomId: 'living', roomName: '客厅', roomSize: '4.20 m x 3.60 m' }],
    2,
  );
  const draft = createDefaultDraft(bootstrap);
  assert.equal(draft.targetScope, 'whole_floor_plan');
  assert.equal(draft.roomId, '');
  assert.equal(resolveDraftScope(scopes, draft).name, '完整户型');

  const roomDraft = applyScopeToDraft(draft, scopes[1]);
  assert.equal(roomDraft.targetScope, 'single_room');
  assert.equal(roomDraft.roomId, 'living');
  assert.deepEqual(buildScopeSubmitPayload(roomDraft), {
    targetScope: 'single_room',
    roomId: 'living',
  });
  assert.equal(buildScopeSubmitPayload(draft).roomId, undefined);

  const view = buildComposerViewState({ ...roomDraft, prompt: '奶油风客厅' }, bootstrap, { scopes });
  assert.equal(view.hasScopePicker, true);
  assert.equal(view.scopeLabel, '客厅');
  assert.equal(view.canSubmit, true);
  assert.equal(buildScopePickerOptions(scopes, roomDraft)[1].active, true);
});

test('buildDraftFromBatch restores the persisted room scope', () => {
  const draft = buildDraftFromBatch({
    id: 'batch-1',
    prompt: '客厅灯光',
    modelProfileId: 'model-a',
    requestedCount: 2,
    parameterSnapshot: {
      aspectRatio: '4:3',
      resolutionTier: '2K',
      targetScope: 'single_room',
      targetLabel: '客厅',
      roomId: 'living',
    },
  }, bootstrap);
  assert.equal(draft.targetScope, 'single_room');
  assert.equal(draft.roomId, 'living');
  assert.equal(resolveDraftScope(buildScopes([], 0), draft).targetScope, 'whole_floor_plan');
});

test('composer locks the bound floor-plan preview in the first reference slot', () => {
  const signed = 'https://example.com/api/miniprogram/ai/studio/workflows/9/floor-plan-preview?signature=abc';
  assert.equal(withFloorPlanPreviewRoom(signed, 'whole_floor_plan', 'living'), signed);
  assert.equal(
    withFloorPlanPreviewRoom(signed, 'single_room', 'living'),
    `${signed}&roomId=living`,
  );

  const scopes = buildScopes(
    [{ roomId: 'living', roomName: '客厅', roomSize: '4.20 m x 3.60 m' }],
    2,
  );
  const draft = applyScopeToDraft({
    ...createDefaultDraft(bootstrap),
    prompt: '奶油风客厅',
    targetScope: 'single_room',
    roomId: 'living',
  }, scopes[1]);
  const view = buildComposerViewState(draft, bootstrap, {
    scopes,
    floorPlanPreviewUrl: signed,
  });
  assert.equal(view.hasControlPreview, true);
  assert.equal(view.controlPreviewUrl, `${signed}&roomId=living`);
  assert.equal(view.controlPreviewLabel, '客厅控制图');
});
