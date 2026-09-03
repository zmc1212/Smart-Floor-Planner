const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  applyModelDefaults,
  applyRenderModeToDraft,
  applyScopeToDraft,
  applyTemplateToDraft,
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
  restoreTemplatePrompt,
  setTemplateFullEditMode,
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

test('template selection rehydrates the editable manual prompt instead of appending an override', () => {
  const draft = applyTemplateToDraft({
    ...createDefaultDraft(bootstrap),
    prompt: '上一轮的手动文字',
    templateId: 'previous-template',
    templateName: '旧模板',
  }, {
    id: 'template-wood',
    name: '现代原木全屋',
    promptContent: '现代原木客厅，保留通透采光与木质地面。',
  });

  assert.equal(draft.prompt, '现代原木客厅，保留通透采光与木质地面。');
  assert.equal(draft.templateId, 'template-wood');
  assert.equal(draft.templateName, '现代原木全屋');
  assert.doesNotMatch(draft.prompt, /上一轮/);
});

test('template selection opens the full editable prompt and can restore the source', () => {
  const selected = applyTemplateToDraft(createDefaultDraft(bootstrap), {
    id: 'template-wood',
    name: '现代原木全屋',
    previewUrl: 'https://example.com/wood.jpg',
    promptContent: '现代原木客厅，保留通透采光与木质地面。',
  });
  assert.equal(selected.templateEditMode, 'full');
  assert.equal('templateAdjustmentPrompt' in selected, false);
  const edited = setTemplateFullEditMode(selected, '完整重写后的提示词');
  assert.equal(edited.templateEditMode, 'full');
  assert.equal(edited.prompt, '完整重写后的提示词');
  const restored = restoreTemplatePrompt(edited);
  assert.equal(restored.prompt, selected.templateBasePrompt);
  assert.equal(restored.templateEditMode, 'full');
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
    referenceAssets: [
      { id: 'control-1', previewUrl: 'https://example.com/control.jpg', role: 'baseline' },
      { id: 'site-1', previewUrl: 'https://example.com/site.jpg', role: 'site_photo' },
      { id: 'baseline-1', previewUrl: 'https://example.com/baseline.jpg', role: 'baseline' },
    ],
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
    { id: 'site-1', previewUrl: 'https://example.com/site.jpg', role: 'site_photo' },
    { id: 'baseline-1', previewUrl: 'https://example.com/baseline.jpg', role: 'baseline' },
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

test('composer exposes only the three high-frequency round configuration entries', () => {
  const scopes = buildScopes(
    [{ roomId: 'living', roomName: '客厅', roomSize: '4.20 m x 3.60 m' }],
    2,
  );
  const view = buildComposerViewState({
    ...createDefaultDraft(bootstrap),
    prompt: '奶油风客厅',
  }, bootstrap, { scopes });
  assert.deepEqual(view.toolbarItems.map((item) => item.key), ['goal', 'template', 'reference']);
  assert.equal(view.toolbarItems[0].icon, COMPOSER_TOOL_ICONS.goal);
  assert.equal(view.toolbarItems[2].icon, COMPOSER_TOOL_ICONS.reference);
  assert.equal(COMPOSER_TOOL_ICONS.settings, '/images/ai-studio-icons-v3/settings.png');
  assert.deepEqual(buildComposerToolbarItems({}).map((item) => item.key), ['goal', 'template', 'reference']);
  const photoView = buildComposerViewState({
    ...createDefaultDraft(bootstrap),
    prompt: '奶油风客厅',
  }, bootstrap, { scopes: [] });
  assert.equal(photoView.hasScopePicker, false);
  assert.deepEqual(photoView.toolbarItems.map((item) => item.key), ['goal', 'template', 'reference']);
});

test('composer picker options carry icon, title, and subtitle', () => {
  const scopes = buildScopes(
    [{ roomId: 'living', roomName: '客厅', roomSize: '4.20 m x 3.60 m' }],
    2,
  );
  const draft = createDefaultDraft(bootstrap);
  const view = buildComposerViewState({ ...draft, prompt: '奶油风客厅' }, bootstrap, { scopes });
  const scopeOptions = buildComposerPickerOptions('scope', view);
  assert.equal(buildComposerPickerTitle('scope'), '选择设计空间');
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
  const previewCalls = [];
  global.Component = (componentDefinition) => {
    definition = componentDefinition;
  };
  global.wx = {
    onKeyboardHeightChange() {},
    offKeyboardHeightChange() {},
    showToast() {},
    previewImage(options) { previewCalls.push(options); },
  };
  delete require.cache[composerPath];
  require(composerPath);
  return {
    definition,
    previewCalls,
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

test('composer wxml restores the approved collapsed, expanded, and configuration states', () => {
  const miniRoot = path.resolve(__dirname, '..');
  const wxml = fs.readFileSync(path.join(miniRoot, 'components/ai-scheme-composer/ai-scheme-composer.wxml'), 'utf8');
  const less = fs.readFileSync(path.join(miniRoot, 'components/ai-scheme-composer/ai-scheme-composer.less'), 'utf8');
  const script = fs.readFileSync(path.join(miniRoot, 'components/ai-scheme-composer/ai-scheme-composer.js'), 'utf8');
  const studioWxml = fs.readFileSync(path.join(miniRoot, 'packages/ai-workflow/scheme-studio/scheme-studio.wxml'), 'utf8');
  const studioScript = fs.readFileSync(path.join(miniRoot, 'packages/ai-workflow/scheme-studio/scheme-studio.js'), 'utf8');

  assert.match(wxml, /composer-v4-collapsed/);
  assert.match(wxml, /composer-v4-expanded/);
  assert.match(wxml, /composer-dock-mask \{\{dockExpanded \? 'open' : ''\}\}/);
  assert.match(wxml, /composer-dock-mask[\s\S]*?catchtap="toggleDock"/);
  assert.match(less, /\.composer-dock-mask\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?background:\s*rgba\(12, 20, 16, 0\.46\);[\s\S]*?pointer-events:\s*none;/);
  assert.match(less, /\.composer-dock-mask\.open\s*\{[\s\S]*?opacity:\s*1;[\s\S]*?pointer-events:\s*auto;/);
  assert.match(wxml, /config-sheet/);
  assert.match(wxml, /scroll-y enhanced show-scrollbar="\{\{false\}\}" class="config-sheet-surface"/);
  assert.match(wxml, />本轮创作</);
  assert.match(wxml, />本轮配置</);
  assert.match(wxml, /quick-config-grid/);
  assert.match(wxml, /设计要求/);
  assert.match(wxml, /AI 优化/);
  assert.match(wxml, /class="expanded-prompt-count"/);
  assert.match(less, /\.expanded-prompt-field\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex-direction:\s*column;/);
  assert.match(less, /\.expanded-prompt-input\s*\{[\s\S]*?height:\s*188rpx;[\s\S]*?padding:\s*20rpx;/);
  assert.match(less, /\.expanded-prompt-count\s*\{[\s\S]*?height:\s*44rpx;[\s\S]*?flex:\s*none;/);
  assert.doesNotMatch(less, /\.expanded-prompt-field\s*>\s*text/);
  assert.match(wxml, /参考图 \{\{view\.referenceDisplayCount\}\}张/);
  assert.match(wxml, /户型图 · 结构参考/);
  assert.match(wxml, /现场图 · 镜头参考/);
  assert.match(wxml, /bindtap="previewReferenceImage"/);
  assert.match(wxml, /更多设置/);
  assert.match(wxml, /保存配置/);
  assert.doesNotMatch(wxml, /dock-toolbar|dock-tool-label|>输入依据</);
  assert.match(wxml, /sheet-handle/);
  assert.match(wxml, /sheet-option-subtitle/);
  assert.match(wxml, /hold-keyboard=\"\{\{false\}\}\"/);
  assert.match(wxml, /focus=\"\{\{promptFocused\}\}\"/);
  assert.doesNotMatch(wxml, /dock-tools-scroll/);
  assert.doesNotMatch(less, /overflow-x:\s*auto/);
  assert.match(less, /18-studio-composer-expanded-mint-arc-v1\.png/);
  assert.match(less, /19-studio-composer-collapsed-mint-arc-v1\.png/);
  assert.match(less, /20-round-config-mint-arc-v2\.png/);
  assert.match(less, /\.composer-shell\.dock\.composer-v4\s*\{[\s\S]*linear-gradient/);
  assert.match(less, /\.sheet-panel\.mode-picker-panel\.config-sheet\s*\{[\s\S]*border-radius:\s*100rpx 100rpx 0 0/);
  assert.match(script, /runAfterKeyboardHidden/);
  assert.match(script, /restorePromptFocus/);
  assert.match(script, /KEYBOARD_HIDE_TIMEOUT_MS/);
  assert.match(wxml, /开始新一轮设计/);
  assert.match(wxml, /设计整屋/);
  assert.match(wxml, /设计单间/);
  assert.match(wxml, /仅软装换搭/);
  assert.match(wxml, /config-section-label/);
  assert.match(wxml, /config-template-row" bindtap="openTemplates"/);
  assert.match(wxml, /config-template-change"(?: catchtap| bindtap)="openTemplates"/);
  assert.match(wxml, /class="template-card \{\{draft\.templateId === item\.id \? 'selected' : ''\}\}" data-id="\{\{item\.id\}\}" bindtap="selectTemplate"/);
  assert.match(wxml, /quick-config-card configured/);
  assert.match(wxml, /quick-config-card \{\{view\.hasTemplate \? 'configured' : ''\}\}/);
  assert.match(wxml, /quick-config-card \{\{view\.referenceDisplayCount > 0 \? 'configured' : ''\}\}/);
  assert.match(less, /\.quick-config-card\.configured\s*\{[\s\S]*?background:\s*#08b969;/);
  assert.match(less, /\.quick-config-card\.configured[^}]*>[\s\S]*?filter:\s*brightness\(0\) invert\(1\)/);
  assert.match(wxml, /config-save" bindtap="confirmRenderMode"/);
  assert.match(less, /\.sheet-panel\.mode-picker-panel\.config-sheet\s*\{[\s\S]*?height:\s*calc\(100vh - 120rpx\);[\s\S]*?display:\s*flex;/);
  assert.match(less, /\.config-sheet-surface\s*\{[\s\S]*?flex:\s*1;/);
  assert.match(less, /\.config-save\s*\{[\s\S]*?flex:\s*none;[\s\S]*?margin:\s*18rpx 52rpx/);
  assert.match(wxml, /round-setup-v3\/whole-floor-plan\.png/);
  assert.match(wxml, /round-setup-v3\/single-room-reference\.png/);
  ['whole-floor-plan.png', 'single-room-reference.png'].forEach((filename) => {
    const assetPath = path.join(miniRoot, 'images/ai-design/round-setup-v3', filename);
    assert.ok(fs.existsSync(assetPath));
    assert.deepEqual(fs.readFileSync(assetPath).subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    assert.ok(fs.statSync(assetPath).size <= 300 * 1024);
  });
  assert.match(wxml, /composer-arc-handle/);
  assert.match(wxml, /collapsed-entry-row/);
  assert.match(wxml, /collapsed-config-entry" bindtap="openModePicker"/);
  assert.match(wxml, /collapsed-generate/);
  assert.doesNotMatch(wxml, /collapsed-prompt-input|collapsed-compose-row/);
  assert.doesNotMatch(wxml, /collapsed-generate[^<]*<image/);
  assert.doesNotMatch(wxml, /class="collapsed-expand"/);
  assert.match(wxml, /选择模板/);
  assert.match(wxml, /恢复模板/);
  assert.match(wxml, /收起/);
  assert.doesNotMatch(wxml, /个性化调整|需要逐字编辑|template-adjustment-panel/);
  assert.doesNotMatch(studioScript, /templateAdjustmentPrompt/);
  assert.match(wxml, /composer-v4-empty/);
  assert.match(script, /toggleDock\(\)/);
  assert.doesNotMatch(wxml, /check-green\.png/);
  assert.match(studioWxml, /composer-collapsed/);
  assert.match(script, /dockExpanded:\s*false/);
  assert.match(studioWxml, /bind:rendermodechange="onComposerRenderModeChange"/);
  assert.match(studioWxml, /bindtap="previewGeneration"[\s\S]*?data-generation-index="\{\{output\.generationIndex\}\}"/);
  assert.match(studioWxml, /bindtap="previewTimelineReference"/);
  assert.match(studioScript, /previewTimelineReference\(event\)/);
  assert.match(studioScript, /items\.push\(\{ \.\.\.generation, generationIndex \}\)/);
});

test('composer previews uploaded references together with the locked floor-plan reference', () => {
  const { definition, previewCalls, restore } = loadComposerComponent();
  try {
    const host = createComposerHost(definition, {
      pendingRenderMode: 'whole_floor_plan',
      view: {
        wholeHouseAvailable: true,
        referenceAssets: [
          { id: 'site-1', previewUrl: 'https://example.com/site-1.jpg' },
          { id: 'site-2', previewUrl: 'https://example.com/site-2.jpg' },
        ],
      },
    });
    host.properties = { floorPlanPreviewUrl: 'https://example.com/floor-plan.jpg' };

    host.previewReferenceImage({ currentTarget: { dataset: { referenceIndex: 1 } } });

    assert.deepEqual(previewCalls, [{
      current: 'https://example.com/site-2.jpg',
      urls: [
        'https://example.com/floor-plan.jpg',
        'https://example.com/site-1.jpg',
        'https://example.com/site-2.jpg',
      ],
    }]);
  } finally {
    restore();
  }
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

test('round setup swaps to the template sheet and returns there after template dismissal', async () => {
  const { definition, restore } = loadComposerComponent();
  try {
    const events = [];
    const host = createComposerHost(definition, {
      modePickerMounted: true,
      modePickerVisible: true,
      dockExpanded: true,
      promptFocused: false,
    });
    host.triggerEvent = (name) => events.push(name);

    host.openTemplates();
    assert.equal(host.data.modePickerVisible, false);
    assert.equal(host._templateReturnTarget, 'mode-picker');
    await waitForSheetClose();
    assert.equal(host.data.modePickerMounted, false);
    assert.deepEqual(events, ['opentemplates']);

    definition.observers.templateSheetVisible.call(host, true);
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(host.data.templateSheetOpen, true);

    host.closeTemplates();
    assert.deepEqual(events, ['opentemplates', 'closetemplates']);
    definition.observers.templateSheetVisible.call(host, false);
    await waitForSheetClose();
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(host.data.modePickerMounted, true);
    assert.equal(host.data.modePickerVisible, true);
    assert.equal(host.data.promptFocused, false);
  } finally {
    restore();
  }
});

test('applying a template from round setup returns to the preserved round sheet', async () => {
  const { definition, restore } = loadComposerComponent();
  try {
    const events = [];
    const host = createComposerHost(definition, {
      templateSheetMounted: true,
      templateSheetOpen: true,
      promptFocused: false,
    });
    host.properties = {
      timelineMode: true,
      templates: [{ id: 'template-a', name: '现代简约' }],
    };
    host._templateReturnTarget = 'mode-picker';
    host.triggerEvent = (name) => events.push(name);

    host.selectTemplate({ currentTarget: { dataset: { id: 'template-a' } } });
    assert.deepEqual(events, ['selecttemplate', 'closetemplates']);
    definition.observers.templateSheetVisible.call(host, false);
    await waitForSheetClose();
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(host.data.modePickerVisible, true);
    assert.equal(host._templateReturnTarget, '');
    assert.equal(host.data.promptFocused, false);
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
