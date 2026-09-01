const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  applyModelDefaults,
  applyRenderModeToDraft,
  applyScopeToDraft,
  buildComposerPickerOptions,
  buildComposerPickerTitle,
  buildComposerToolbarItems,
  buildComposerViewState,
  buildDraftFromBatch,
  buildScopePickerOptions,
  buildScopeSubmitPayload,
  buildTemplateCategoryChips,
  buildTemplateListParams,
  COMPOSER_TOOL_ICONS,
  createDefaultDraft,
  flattenPromptCategories,
  maxUserReferenceImages,
  parseTemplateListPayload,
  pickDefaultModel,
  resolveDraftScope,
  resolvePreferredTemplateCategoryId,
  SCOPE_APPLY_NOTE,
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

test('createDefaultDraft prefers the provider defaultRemoteModel over isDefault', () => {
  const mixed = {
    ...bootstrap,
    provider: { ...bootstrap.provider, defaultRemoteModel: 'nano-banana-2' },
    models: [
      { ...bootstrap.models[0], id: 'model-default', isDefault: true, remoteModel: 'gpt-image-2', defaults: { aspectRatio: '1:1', resolutionTier: '1K' } },
      { ...bootstrap.models[0], id: 'model-mapped', isDefault: false, remoteModel: 'nano-banana-2', defaults: { aspectRatio: '16:9', resolutionTier: '2K' } },
    ],
  };
  assert.equal(pickDefaultModel(mixed).id, 'model-mapped');
  const draft = createDefaultDraft(mixed);
  assert.equal(draft.modelProfileId, 'model-mapped');
  assert.equal(draft.aspectRatio, '16:9');
  assert.equal(draft.resolutionTier, '2K');
});

test('createDefaultDraft prefers the isDefault catalog model', () => {
  const mixed = {
    ...bootstrap,
    models: [
      { ...bootstrap.models[0], id: 'model-heavy', isDefault: false, defaults: { aspectRatio: '1:1', resolutionTier: '1K' } },
      { ...bootstrap.models[0], id: 'model-default', isDefault: true, defaults: { aspectRatio: '16:9', resolutionTier: '2K' } },
    ],
  };
  assert.equal(pickDefaultModel(mixed).id, 'model-default');
  const draft = createDefaultDraft(mixed);
  assert.equal(draft.modelProfileId, 'model-default');
  assert.equal(draft.aspectRatio, '16:9');
  assert.equal(draft.resolutionTier, '2K');
});

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
  const draft = applyRenderModeToDraft({
    ...createDefaultDraft(bootstrap),
    prompt: '奶油风客厅，自然光',
    count: 1,
  }, 'whole_floor_plan');
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

  const view = buildComposerViewState(applyRenderModeToDraft({ ...roomDraft, prompt: '奶油风客厅' }, 'whole_floor_plan'), bootstrap, { scopes });
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
    referenceAssetIds: ['control-1', 'site-1', 'baseline-1'],
    parameterSnapshot: {
      aspectRatio: '4:3',
      resolutionTier: '2K',
      targetScope: 'single_room',
      targetLabel: '客厅',
      roomId: 'living',
      floorPlanControlAssetId: 'control-1',
      sitePhotoAssetIds: ['site-1'],
    },
  }, bootstrap);
  assert.equal(draft.targetScope, 'single_room');
  assert.equal(draft.roomId, 'living');
  assert.deepEqual(draft.referenceAssets, [
    { id: 'site-1', previewUrl: '', role: 'site_photo' },
    { id: 'baseline-1', previewUrl: '', role: 'baseline' },
  ]);
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
  const draft = applyRenderModeToDraft(applyScopeToDraft({
    ...createDefaultDraft(bootstrap),
    prompt: '奶油风客厅',
    targetScope: 'single_room',
    roomId: 'living',
  }, scopes[1]), 'whole_floor_plan');
  const view = buildComposerViewState(draft, bootstrap, {
    scopes,
    floorPlanPreviewUrl: signed,
  });
  assert.equal(view.hasControlPreview, true);
  assert.equal(view.controlPreviewUrl, `${signed}&roomId=living`);
  assert.equal(view.controlPreviewLabel, '客厅控制图');
});

test('composer mode selection separates floor-plan control from site-photo modes', () => {
  const scopes = buildScopes(
    [{ roomId: 'living', roomName: '客厅', roomSize: '4.20 m x 3.60 m' }],
    1,
  );
  const base = { ...createDefaultDraft(bootstrap), prompt: '自然原木客厅' };
  const unselected = buildComposerViewState(base, bootstrap, { scopes });
  assert.equal(unselected.canSubmit, false);
  assert.equal(unselected.blockedReason, '请先选择设计方式');
  assert.equal(unselected.wholeHouseAvailable, false);

  const whole = buildComposerViewState(applyRenderModeToDraft(base, 'whole_floor_plan'), bootstrap, {
    scopes,
    floorPlanPreviewUrl: 'https://example.com/floor-plan.png',
  });
  assert.equal(whole.hasControlPreview, true);
  assert.equal(whole.wholeHouseAvailable, true);
  assert.equal(whole.canSubmit, true);

  const roomDraft = applyScopeToDraft(
    applyRenderModeToDraft(base, 'single_room_photo'),
    scopes[1],
  );
  const roomWithoutPhoto = buildComposerViewState(roomDraft, bootstrap, {
    scopes,
    floorPlanPreviewUrl: 'https://example.com/floor-plan.png',
  });
  assert.equal(roomWithoutPhoto.hasControlPreview, false);
  assert.equal(roomWithoutPhoto.blockedReason, '请先添加现场图');

  const roomWithBaselineOnly = buildComposerViewState({
    ...roomDraft,
    referenceAssets: [{ id: 'generation-1', role: 'baseline' }],
  }, bootstrap, { scopes });
  assert.equal(roomWithBaselineOnly.blockedReason, '请先添加现场图');

  const roomWithPhoto = buildComposerViewState({
    ...roomDraft,
    referenceAssets: [{ id: 'photo-1', role: 'site_photo' }],
  }, bootstrap, { scopes });
  assert.equal(roomWithPhoto.canSubmit, true);
  assert.deepEqual(roomWithPhoto.scopePickerOptions.map((item) => item.targetScope), ['single_room']);

  const soft = buildComposerViewState({
    ...applyRenderModeToDraft(roomDraft, 'soft_furnishing'),
    referenceAssets: [{ id: 'photo-1', role: 'site_photo' }],
  }, bootstrap, { scopes, floorPlanPreviewUrl: 'https://example.com/floor-plan.png' });
  assert.equal(soft.hasControlPreview, false);
  assert.equal(soft.softFurnishingActive, true);
  assert.equal(soft.canSubmit, true);
});

test('photo-first single-room mode can submit without a selected floor-plan room', () => {
  const scopes = buildScopes(
    [{ roomId: 'living', roomName: '客厅', roomSize: '4.20 m x 3.60 m' }],
    1,
  );
  const draft = applyRenderModeToDraft({
    ...createDefaultDraft(bootstrap),
    prompt: '按现场照片设计',
    // A stale single-room scope must not make the photo-first mode require a room.
    targetScope: 'single_room',
    roomId: '',
    referenceAssets: [{ id: 'site-1', role: 'site_photo' }],
  }, 'single_room_photo');
  const view = buildComposerViewState(draft, bootstrap, { scopes });
  assert.equal(view.blockedReason, '');
  assert.equal(view.canSubmit, true);
  assert.equal(view.hasControlPreview, false);
});

test('composer toolbar keeps four tools without a reference chip', () => {
  const scopes = buildScopes(
    [{ roomId: 'living', roomName: '客厅', roomSize: '4.20 m x 3.60 m' }],
    2,
  );
  const view = buildComposerViewState({
    ...createDefaultDraft(bootstrap),
    prompt: '奶油风客厅',
  }, bootstrap, { scopes });
  assert.deepEqual(view.toolbarItems.map((item) => item.label), ['户型', '模型', '模板', '设置']);
  assert.equal(view.toolbarItems[0].icon, COMPOSER_TOOL_ICONS.scope);
  assert.deepEqual(buildComposerToolbarItems({ hasScopePicker: false }).map((item) => item.key), [
    'model',
    'template',
    'settings',
  ]);
  const photoView = buildComposerViewState({
    ...createDefaultDraft(bootstrap),
    prompt: '奶油风客厅',
  }, bootstrap, { scopes: [] });
  assert.equal(photoView.hasScopePicker, false);
  assert.deepEqual(photoView.toolbarItems.map((item) => item.key), ['model', 'template', 'settings']);
});

test('composer picker options carry icon, title, and subtitle', () => {
  const scopes = buildScopes(
    [{ roomId: 'living', roomName: '客厅', roomSize: '4.20 m x 3.60 m' }],
    2,
  );
  const draft = createDefaultDraft(bootstrap);
  const view = buildComposerViewState({ ...draft, prompt: '奶油风客厅' }, bootstrap, { scopes });
  const scopeOptions = buildComposerPickerOptions('scope', view);
  assert.equal(buildComposerPickerTitle('scope'), '应用到哪里');
  assert.equal(scopeOptions[0].label, '完整户型');
  assert.equal(scopeOptions[0].subtitle, SCOPE_APPLY_NOTE);
  assert.equal(scopeOptions[0].icon, COMPOSER_TOOL_ICONS.scope);
  assert.equal(scopeOptions[1].label, '客厅');
  assert.equal(scopeOptions[1].subtitle, '4.20 m x 3.60 m');

  const modelOptions = buildComposerPickerOptions('model', view);
  assert.equal(buildComposerPickerTitle('model'), '选择模型');
  assert.equal(modelOptions[0].label, '模型 A');
  assert.equal(modelOptions[0].subtitle, '2K · 4 点/张');
  assert.equal(modelOptions[0].icon, COMPOSER_TOOL_ICONS.model);
  assert.equal(buildScopePickerOptions(scopes, draft)[1].active, false);
});

const composerPath = path.resolve(__dirname, '..', 'components/ai-scheme-composer/ai-scheme-composer.js');

function loadComposerComponent() {
  const originals = { Component: global.Component, wx: global.wx };
  let definition;
  global.Component = (componentDefinition) => {
    definition = componentDefinition;
  };
  global.wx = {
    onKeyboardHeightChange() {},
    offKeyboardHeightChange() {},
    showToast() {},
    previewImage() {},
  };
  delete require.cache[composerPath];
  require(composerPath);
  return {
    definition,
    restore() {
      for (const [key, value] of Object.entries(originals)) {
        if (value === undefined) delete global[key];
        else global[key] = value;
      }
    },
  };
}

function createComposerHost(definition, extraData = {}) {
  const host = {
    data: { ...JSON.parse(JSON.stringify(definition.data)), ...extraData },
    properties: {},
    triggerEvent() {},
    setData(update, callback) {
      this.data = { ...this.data, ...update };
      if (typeof callback === 'function') callback.call(this);
    },
  };
  Object.assign(host, definition.methods);
  return host;
}

function waitForSheetClose() {
  return new Promise((resolve) => setTimeout(resolve, 280));
}

test('composer wxml keeps a bottom toolbar and keyboard-safe sheets', () => {
  const miniRoot = path.resolve(__dirname, '..');
  const wxml = fs.readFileSync(path.join(miniRoot, 'components/ai-scheme-composer/ai-scheme-composer.wxml'), 'utf8');
  const less = fs.readFileSync(path.join(miniRoot, 'components/ai-scheme-composer/ai-scheme-composer.less'), 'utf8');
  const script = fs.readFileSync(path.join(miniRoot, 'components/ai-scheme-composer/ai-scheme-composer.js'), 'utf8');
  const studioWxml = fs.readFileSync(path.join(miniRoot, 'packages/ai-workflow/scheme-studio/scheme-studio.wxml'), 'utf8');

  assert.match(wxml, /dock-toolbar/);
  assert.match(wxml, /dock-tool-label/);
  assert.match(wxml, /onToolbarTap/);
  assert.match(wxml, /sheet-handle/);
  assert.match(wxml, /sheet-option-subtitle/);
  assert.match(wxml, /hold-keyboard=\"\{\{false\}\}\"/);
  assert.match(wxml, /focus=\"\{\{promptFocused\}\}\"/);
  assert.doesNotMatch(wxml, /dock-tools-scroll/);
  assert.doesNotMatch(wxml, />参考</);
  assert.doesNotMatch(less, /overflow-x:\s*auto/);
  assert.match(less, /\.dock-tool-label\s*\{[^}]*font-size:\s*24rpx/);
  assert.match(script, /runAfterKeyboardHidden/);
  assert.match(script, /restorePromptFocus/);
  assert.match(script, /KEYBOARD_HIDE_TIMEOUT_MS/);
  assert.match(wxml, /开始新一轮设计/);
  assert.match(wxml, /设计整屋/);
  assert.match(wxml, /设计单间/);
  assert.match(wxml, /仅软装换搭/);
  assert.match(wxml, /whole-house-material-board\.png/);
  assert.match(wxml, /single-room-camera-board\.png/);
  assert.match(studioWxml, /bind:rendermodechange="onComposerRenderModeChange"/);
});

test('mode-flow artwork is packaged as transparent PNG under the Mini Program limit', () => {
  const miniRoot = path.resolve(__dirname, '..');
  const assets = [
    'packages/ai-workflow/assets/mode-flow-v1/whole-house-material-board.png',
    'packages/ai-workflow/assets/mode-flow-v1/single-room-camera-board.png',
  ];
  for (const relativePath of assets) {
    const contents = fs.readFileSync(path.join(miniRoot, relativePath));
    assert.deepEqual([...contents.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.ok(contents.length <= 300 * 1024, `${relativePath} exceeds 300KB`);
    assert.ok(contents.includes(Buffer.from('tRNS')), `${relativePath} must preserve transparency`);
  }
});

test('mask dismiss on a tool sheet restores prompt focus', async () => {
  const { definition, restore } = loadComposerComponent();
  try {
    const pickerHost = createComposerHost(definition, {
      pickerMounted: true,
      pickerVisible: true,
      pickerType: 'scope',
      settingsOpen: false,
      dockExpanded: true,
      promptFocused: false,
    });
    pickerHost.closePicker();
    await waitForSheetClose();
    assert.equal(pickerHost.data.promptFocused, true);

    const settingsHost = createComposerHost(definition, {
      settingsMounted: true,
      settingsOpen: true,
      dockExpanded: true,
      promptFocused: false,
    });
    settingsHost.closeSettings();
    await waitForSheetClose();
    assert.equal(settingsHost.data.promptFocused, true);

    const templateHost = createComposerHost(definition, {
      settingsOpen: false,
      templateSheetOpen: true,
      promptFocused: false,
    });
    templateHost.closeTemplates();
    assert.equal(templateHost._refocusAfterTemplate, true);
  } finally {
    restore();
  }
});

test('nested picker mask under settings does not restore prompt focus', async () => {
  const { definition, restore } = loadComposerComponent();
  try {
    const host = createComposerHost(definition, {
      pickerMounted: true,
      pickerVisible: true,
      pickerType: 'model',
      settingsOpen: true,
      settingsMounted: true,
      dockExpanded: true,
      promptFocused: false,
    });
    host.closePicker();
    await waitForSheetClose();
    assert.equal(host.data.promptFocused, false);
  } finally {
    restore();
  }
});
