const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const miniRoot = path.resolve(__dirname, '..');
const {
  applySelectionToView,
  batchTargetLabel,
  buildConversationBatches,
  buildDefaultSendSelection,
  buildStudioView,
  buildWorkflowSwitcherOptions,
  decorateBatchView,
  mergeSendSelection,
  pickPreferredStudioWorkflow,
  resolveSendTitle,
  resolveSendTitlePrefill,
  shouldPollStudioView,
  shouldRenameWorkflowOnSend,
} = require('../packages/ai-workflow/scheme-studio/scheme-studio-model.js');
const {
  applyRenderModeToDraft,
  buildComposerViewState,
  createDefaultDraft,
  estimateCredits,
} = require('../components/ai-scheme-composer/ai-scheme-composer-model.js');

test('buildConversationBatches merges task batches with legacy generations and published flags', () => {
  const detail = {
    generations: [
      {
        id: '101',
        status: 'succeeded',
        published: true,
        createdAt: '2026-08-20T08:00:00.000Z',
        imageUrl: 'https://example.com/legacy.jpg',
        input: { userMessage: '历史客厅方案' },
      },
      {
        id: '202',
        status: 'succeeded',
        published: false,
        createdAt: '2026-08-20T09:00:00.000Z',
        imageUrl: 'https://example.com/new.jpg',
      },
    ],
    workflow: { id: '9', title: '测试方案', publishedCount: 1 },
    lead: { id: '1', name: '张三', communityName: '测试小区' },
    publishedScheme: {
      title: '测试方案',
      publishedAt: '2026-08-20T10:00:00.000Z',
      generationIds: ['101'],
    },
  };
  const task = {
    batches: [{
      id: 'batch-1',
      sequence: 1,
      prompt: '新的卧室方案',
      requestedCount: 1,
      status: 'processing',
      createdAt: '2026-08-20T09:30:00.000Z',
      generations: [{
        id: '202',
        status: 'processing',
        imageUrl: 'https://example.com/new.jpg',
      }],
    }],
  };

  const batches = buildConversationBatches(detail, task);
  assert.equal(batches.length, 2);
  assert.equal(batches[0].id, 'legacy-101');
  assert.equal(batches[0].generations[0].published, true);
  assert.equal(batches[1].generations[0].published, false);
  assert.equal(batches[1].sequence, 2);
});

test('buildStudioView exposes published badges and polling for active batches', () => {
  const view = buildStudioView({
    workflow: {
      id: '9',
      title: '客厅方案',
      generationCount: 2,
      publishedCount: 1,
      floorPlanPreviewUrl: 'https://example.com/floor-plan.jpg',
      sourceFloorPlan: { name: '三室两厅' },
    },
    lead: { id: '1', name: '李四', communityName: '阳光花园' },
    generations: [{
      id: '101',
      status: 'succeeded',
      published: true,
      createdAt: '2026-08-20T08:00:00.000Z',
      imageUrl: 'https://example.com/a.jpg',
      input: { customPrompt: '奶油风客厅' },
    }],
    publishedScheme: {
      title: '客厅方案',
      generationIds: ['101'],
    },
  }, null);

  assert.equal(view.workflow.publishedCount, 1);
  assert.equal(view.leadSummary.projectTitle, '阳光花园');
  assert.equal(view.batches.length, 1);
  assert.equal(view.batches[0].generations[0].showPublishedBadge, true);
  assert.equal(view.shouldPoll, false);
});

test('decorateBatchView marks pending slots and processing poll state', () => {
  const batch = decorateBatchView({
    id: 'batch-2',
    sequence: 2,
    prompt: '继续优化灯光',
    requestedCount: 2,
    status: 'processing',
    createdAt: '2026-08-20T10:00:00.000Z',
    generations: [{
      id: '301',
      status: 'processing',
      imageUrl: '',
      published: false,
    }],
  });

  assert.equal(batch.generations.length, 2);
  assert.equal(batch.generations[0].statusClass, 'processing');
  assert.equal(batch.generations[1].placeholder, true);
  assert.equal(batch.hasProcessing, true);
  assert.equal(shouldPollStudioView(buildStudioView({ workflow: {}, lead: {}, generations: [] }, {
    batches: [{ id: 'batch-2', sequence: 1, prompt: 'x', requestedCount: 1, status: 'processing', createdAt: '2026-08-20T10:00:00.000Z', generations: [] }],
  })), true);
});

test('decorateBatchView surfaces the persisted apply-to label', () => {
  assert.equal(batchTargetLabel({
    parameterSnapshot: { targetScope: 'single_room', targetLabel: '客厅', roomId: 'living' },
  }), '客厅');
  const batch = decorateBatchView({
    id: 'batch-3',
    sequence: 3,
    prompt: '客厅灯光',
    requestedCount: 1,
    status: 'succeeded',
    createdAt: '2026-08-20T10:00:00.000Z',
    parameterSnapshot: { targetScope: 'single_room', targetLabel: '客厅', roomId: 'living' },
    generations: [{ id: '401', status: 'succeeded', imageUrl: 'https://example.com/a.jpg', published: false }],
  });
  assert.equal(batch.targetLabel, '客厅');
});

test('mergeSendSelection auto-selects new unpublished generations without restoring manual unchecks', () => {
  const previous = buildStudioView({
    workflow: { id: '1', title: '方案' },
    lead: { id: '1', name: '客户' },
    generations: [{
      id: '100',
      status: 'succeeded',
      published: false,
      createdAt: '2026-08-20T08:00:00.000Z',
      imageUrl: 'https://example.com/a.jpg',
    }],
  }, null);
  const next = buildStudioView({
    workflow: { id: '1', title: '方案' },
    lead: { id: '1', name: '客户' },
    generations: [
      {
        id: '100',
        status: 'succeeded',
        published: false,
        createdAt: '2026-08-20T08:00:00.000Z',
        imageUrl: 'https://example.com/a.jpg',
      },
      {
        id: '200',
        status: 'succeeded',
        published: false,
        createdAt: '2026-08-20T09:00:00.000Z',
        imageUrl: 'https://example.com/b.jpg',
      },
    ],
  }, null);

  assert.deepEqual(mergeSendSelection(previous, next, []), ['200']);
  assert.deepEqual(mergeSendSelection(previous, next, ['100']), ['100', '200']);
  assert.deepEqual(buildDefaultSendSelection(next).sort(), ['100', '200']);
});

test('applySelectionToView marks sendSelected on unpublished succeeded tiles', () => {
  const baseView = buildStudioView({
    workflow: { id: '1', title: '方案' },
    lead: { id: '1', name: '客户' },
    generations: [
      {
        id: '100',
        status: 'succeeded',
        published: false,
        createdAt: '2026-08-20T08:00:00.000Z',
        imageUrl: 'https://example.com/a.jpg',
      },
      {
        id: '200',
        status: 'succeeded',
        published: true,
        createdAt: '2026-08-20T09:00:00.000Z',
        imageUrl: 'https://example.com/b.jpg',
      },
    ],
  }, null);
  const view = applySelectionToView(baseView, ['100']);
  assert.equal(view.batches[0].generations[0].sendSelected, true);
  assert.equal(view.batches[1].generations[0].sendSelected, false);
});

test('composer model estimates credits and blocks insufficient balance', () => {
  const bootstrap = {
    account: { availableBalance: 5 },
    provider: { actionEnabled: true, supportsEdit: true },
    models: [{
      id: 'model-1',
      name: '测试模型',
      maxReferenceImages: 2,
      defaults: { aspectRatio: '1:1', resolutionTier: '1K' },
      resolutionTiers: ['1K'],
      prices: [{ resolutionTier: '1K', credits: 4 }],
    }],
  };
  const draft = applyRenderModeToDraft({
    ...createDefaultDraft(bootstrap),
    prompt: '测试提示词',
    count: 2,
  }, 'whole_floor_plan');
  assert.equal(estimateCredits(draft, bootstrap), 8);
  const blocked = buildComposerViewState(draft, bootstrap);
  assert.equal(blocked.canSubmit, false);
  assert.match(blocked.blockedReason, /点数不足/);
});

test('pickPreferredStudioWorkflow reuses same-floor-plan schemes with generations before empties', () => {
  const preferred = pickPreferredStudioWorkflow([
    {
      id: 'empty-new',
      sourceFloorPlanId: 'fp-1',
      generationCount: 0,
      updatedAt: '2026-08-20T12:00:00.000Z',
      title: 'AI 设计方案',
    },
    {
      id: 'rich-old',
      sourceFloorPlanId: 'fp-1',
      generationCount: 4,
      updatedAt: '2026-08-19T08:00:00.000Z',
      title: '灯光方案',
    },
    {
      id: 'other-plan',
      sourceFloorPlanId: 'fp-2',
      generationCount: 9,
      updatedAt: '2026-08-20T13:00:00.000Z',
      title: '其他户型',
    },
  ], { floorPlanId: 'fp-1' });

  assert.equal(preferred && preferred.id, 'rich-old');
});

test('pickPreferredStudioWorkflow prefers unbound photo schemes when no floor plan is bound', () => {
  const preferred = pickPreferredStudioWorkflow([
    {
      id: 'plan-bound',
      sourceFloorPlanId: 'fp-1',
      generationCount: 8,
      updatedAt: '2026-08-21T10:00:00.000Z',
    },
    {
      id: 'photo-empty',
      generationCount: 0,
      updatedAt: '2026-08-20T10:00:00.000Z',
    },
    {
      id: 'photo-rich',
      generationCount: 2,
      updatedAt: '2026-08-19T10:00:00.000Z',
    },
  ], {});
  assert.equal(preferred && preferred.id, 'photo-rich');
});

test('studio lead summary labels photo schemes without a floor plan', () => {
  const { buildStudioView } = require('../packages/ai-workflow/scheme-studio/scheme-studio-model.js');
  const view = buildStudioView({
    workflow: { id: 'w1', title: '现场改造', generationCount: 1 },
    lead: { name: '高容海', communityName: '东辰心语' },
    generations: [],
  });
  assert.equal(view.leadSummary.floorPlanName, '拍照方案');
});

test('resolveSendTitlePrefill prefers the customer-visible published title', () => {
  assert.equal(resolveSendTitlePrefill({
    workflow: { title: '方案 3' },
    publishedScheme: { title: '办公区设计' },
  }), '办公区设计');
  assert.equal(resolveSendTitlePrefill({
    workflow: { title: '方案 3' },
  }), '方案 3');
});

test('resolveSendTitle uses the typed send name and flags a workflow rename', () => {
  const view = {
    workflow: { title: '方案 3' },
    publishedScheme: { title: '办公区设计' },
  };
  assert.equal(resolveSendTitle(view, '  灯光设计  '), '灯光设计');
  assert.equal(shouldRenameWorkflowOnSend(view, '灯光设计'), true);
  assert.equal(shouldRenameWorkflowOnSend(view, '方案 3'), false);
  assert.equal(resolveSendTitle(view, '   '), '办公区设计');
});

test('buildWorkflowSwitcherOptions marks the current scheme', () => {
  const options = buildWorkflowSwitcherOptions([
    { id: '1', title: '方案 A', generationCount: 2, publishedCount: 1 },
    { id: '2', title: '方案 B', generationCount: 0, publishedCount: 0 },
  ], '2');
  assert.equal(options.length, 2);
  assert.equal(options[1].current, true);
  assert.match(options[0].label, /方案 A · 2 张 · 已确认 1/);
  assert.match(options[1].label, /当前/);
});

test('scheme-studio route wires composer, send modal, and studio APIs', () => {
  const appConfig = JSON.parse(fs.readFileSync(path.join(miniRoot, 'app.json'), 'utf8'));
  const aiWorkflowPackage = appConfig.subPackages.find((item) => item.root === 'packages/ai-workflow');
  assert.ok(aiWorkflowPackage.pages.includes('scheme-studio/scheme-studio'));

  const wxml = fs.readFileSync(path.join(miniRoot, 'packages/ai-workflow/scheme-studio/scheme-studio.wxml'), 'utf8');
  const less = fs.readFileSync(path.join(miniRoot, 'packages/ai-workflow/scheme-studio/scheme-studio.less'), 'utf8');
  const script = fs.readFileSync(path.join(miniRoot, 'packages/ai-workflow/scheme-studio/scheme-studio.js'), 'utf8');
  const pageJson = fs.readFileSync(path.join(miniRoot, 'packages/ai-workflow/scheme-studio/scheme-studio.json'), 'utf8');
  const composerWxml = fs.readFileSync(path.join(miniRoot, 'components/ai-scheme-composer/ai-scheme-composer.wxml'), 'utf8');
  const composerLess = fs.readFileSync(path.join(miniRoot, 'components/ai-scheme-composer/ai-scheme-composer.less'), 'utf8');
  const service = fs.readFileSync(path.join(miniRoot, 'utils/aiDesignService.js'), 'utf8');
  const navigation = fs.readFileSync(path.join(miniRoot, 'utils/aiDesignNavigation.js'), 'utf8');
  const previewRoute = fs.readFileSync(path.join(
    miniRoot,
    '../admin/src/app/api/miniprogram/ai/studio/workflows/[id]/floor-plan-preview/route.ts',
  ), 'utf8');

  assert.match(wxml, /nav-switch/);
  assert.match(wxml, /currentSchemeLabel/);
  assert.match(wxml, /AI 设计过程/);
  assert.match(wxml, /timelineBatches/);
  assert.match(wxml, /timeline-card/);
  assert.match(wxml, /scheme-finalize-bar/);
  assert.match(wxml, /设为定稿方案/);
  assert.match(wxml, /发送效果图给客户后，可将整套方案设为定稿/);
  assert.match(wxml, /如需冻结版本，请新建方案/);
  assert.doesNotMatch(wxml, /class="final-badge" bindtap="openFinalizeModal"/);
  assert.match(wxml, /timelineStatus === 'processing'/);
  assert.match(wxml, /timelineOutputs/);
  assert.match(wxml, /timelineReferences/);
  assert.match(wxml, /reference-preview-grid/);
  assert.match(wxml, /class="timeline-reference-thumb"[^>]+mode="aspectFit"/);
  assert.match(script, /timelineReferences/);
  assert.match(script, /collapseAfterSubmit\(\)/);
  assert.match(wxml, /重新编辑/);
  assert.match(wxml, /再次生成/);
  assert.match(wxml, /发送客户/);
  assert.match(wxml, /重试本轮/);
  assert.match(wxml, /新一轮/);
  assert.match(wxml, /ai-scheme-composer/);
  assert.match(less, /\.timeline-item\.processing \.timeline-card::before/);
  assert.match(less, /\.timeline-item\.processing \.timeline-card::after/);
  assert.match(less, /border-right-width: 13rpx/);
  assert.match(less, /border-right-width: 11rpx/);
  assert.doesNotMatch(less, /border-bottom-left-radius:\s*26rpx/);
  assert.match(less, /--timeline-rail-offset/);
  assert.match(less, /left: calc\(var\(--timeline-rail-offset\) - var\(--timeline-content-left\) - 14rpx\)/);
  assert.match(composerWxml, /composer-v4-empty/);
  assert.match(composerWxml, /composer-v4-collapsed/);
  assert.match(composerWxml, /composer-v4-expanded/);
  assert.match(composerWxml, /config-sheet/);
  assert.doesNotMatch(less, /\.timeline-card\s*>\s*\*/);
  assert.match(wxml, /timeline-mode="\{\{true\}\}"/);
  assert.match(wxml, /sendModalVisible/);
  assert.match(wxml, /menuMounted/);
  assert.match(wxml, /renameMounted/);
  assert.match(wxml, /sendMounted/);
  assert.match(wxml, /modal-mask \{\{menuVisible \? 'open' : ''\}\}/);
  assert.match(wxml, /menu-panel \{\{menuVisible \? 'open' : ''\}\}/);
  assert.match(less, /\.timeline-content/);
  assert.match(less, /\.timeline-card/);
  assert.match(less, /\.timeline-composer/);
  assert.match(script, /sheetMotion/);
  assert.match(script, /openSheet\(this, MENU_SHEET\)/);
  assert.match(script, /closeSheet\(this, SEND_SHEET\)/);
  assert.match(script, /buildTimelineBatches/);
  assert.match(script, /resolveTimelineBatch/);
  assert.match(script, /resolveSchemeLabel/);
  assert.match(composerWxml, /pickerMounted/);
  assert.match(composerWxml, /templateSheetMounted/);
  assert.match(composerWxml, /settingsMounted/);
  assert.match(composerWxml, /composer-shell dock/);
  assert.match(composerWxml, /dockExpanded/);
  assert.match(composerWxml, /collapsed-generate/);
  assert.match(composerWxml, /expanded-generate/);
  assert.match(composerWxml, /更多设置/);
  assert.match(composerWxml, /composer-cost-strip/);
  assert.match(composerLess, /\.composer-cost-strip\s*\{/);
  assert.match(wxml, /onComposerDockExpandChange/);
  assert.match(composerWxml, /adjust-position=\"\{\{false\}\}\"/);
  assert.match(composerWxml, /hold-keyboard=\"\{\{false\}\}\"/);
  assert.doesNotMatch(composerWxml, /dock-toolbar/);
  assert.match(composerWxml, /quick-config-grid/);
  assert.doesNotMatch(composerWxml, /dock-tools-scroll/);
  assert.match(composerWxml, /keyboard-open/);
  assert.match(wxml, /composerKeyboardHeight/);
  assert.match(wxml, /onComposerKeyboardHeightChange/);
  assert.doesNotMatch(less, /\.composer-dock\s*>\s*\*/);
  assert.match(composerWxml, /sheet-mask \{\{pickerVisible \? 'open' : ''\}\}/);
  assert.match(composerWxml, /sheet-panel picker-panel \{\{pickerVisible \? 'open' : ''\}\}/);
  assert.match(wxml, /retrySelectedBatch/);
  assert.match(composerWxml, /\{\{generating \? '提交中' : '生成'\}\}/);
  assert.match(composerWxml, /template-grid/);
  assert.match(composerWxml, /template-cover/);
  assert.match(composerWxml, /item\.previewUrl/);
  assert.match(pageJson, /ai-scheme-composer/);
  assert.match(less, /\.nav-switch/);
  assert.match(script, /onTemplateImageError/);
  assert.match(script, /maybeOfferPreferredWorkflow/);
  assert.match(script, /pickPreferredStudioWorkflow/);
  assert.match(script, /listStudioWorkflows/);
  assert.match(script, /forceCreate/);
  assert.match(script, /openWorkflowSwitcher/);
  assert.match(wxml, /value=\"\{\{sendTitle\}\}\"/);
  assert.doesNotMatch(wxml, /方案名称与顶部标题一致/);
  assert.match(script, /confirmSendScheme[\s\S]*renameStudioWorkflow/);
  assert.match(script, /resolveSendTitlePrefill/);
  assert.match(composerWxml, /prompt-field/);
  assert.match(composerLess, /\.prompt-field\s*\{[^}]*width:\s*0/);
  assert.match(script, /submitStudioBatch/);
  assert.match(script, /targetScope: scopePayload.targetScope/);
  assert.match(script, /onComposerScopeChange/);
  assert.match(script, /roomsFromWorkflowDetail/);
  assert.match(wxml, /scopes=\"\{\{scopes\}\}\"/);
  assert.match(wxml, /bind:scopechange=\"onComposerScopeChange\"/);
  assert.match(composerWxml, /设计空间/);
  assert.match(composerWxml, /openScopePicker/);
  assert.match(composerWxml, /参考图1/);
  assert.match(composerWxml, /previewFloorPlanReference/);
  assert.match(wxml, /floor-plan-preview-url/);
  assert.match(previewRoute, /searchParams.get\('roomId'\)/);
  assert.match(script, /publishScheme/);
  assert.match(script, /sourceAssetRole: 'rough_sketch'/);
  assert.match(script, /bound\.floorPlanId \? buildScopes/);
  assert.match(
    script,
    /const \{[\s\S]*WHOLE_HOUSE_RENDER_MODE,[\s\S]*\} = require\('\.\.\/\.\.\/\.\.\/components\/ai-scheme-composer\/ai-scheme-composer-model\.js'\)/,
  );
  assert.match(script, /this\.data\.floorPlanId[\s\S]*WHOLE_HOUSE_RENDER_MODE[\s\S]*buildScopeSubmitPayload/);
  assert.match(script, /this\.data\.leadId && !siblingCacheFresh && !this\.siblingWorkflowsPromise/);
  assert.match(script, /finalizeScheme/);
  assert.match(script, /openFinalizeModal/);
  assert.match(script, /请先发送给客户，再设为定稿/);
  assert.match(script, /该方案已定稿/);
  assert.match(wxml, /设为定稿/);
  assert.match(script, /retryStudioBatch/);
  assert.match(script, /withdrawSchemeGeneration/);
  assert.match(script, /deleteStudioGeneration/);
  assert.match(script, /4000/);
  assert.match(service, /\/miniprogram\/ai\/studio\/workflows\//);
  assert.match(service, /\/miniprogram\/ai\/studio\/tasks\?workflowId=/);
  assert.match(navigation, /openSchemeStudio/);
  assert.match(navigation, /openAIDesignEntry/);
  assert.match(navigation, /shouldOpenSchemeStudio/);
  assert.match(navigation, /buildSchemeStudioUrl/);
});

test('scheme-studio confirm dialogs keep native action buttons inside the sheet', () => {
  const wxml = fs.readFileSync(path.join(miniRoot, 'packages/ai-workflow/scheme-studio/scheme-studio.wxml'), 'utf8');
  const less = fs.readFileSync(path.join(miniRoot, 'packages/ai-workflow/scheme-studio/scheme-studio.less'), 'utf8');

  assert.equal((wxml.match(/class="dialog-btn/g) || []).length, 6);
  assert.match(wxml, /class="dialog-actions"[\s\S]*?class="dialog-btn"/);

  const actionsRule = less.match(/\.dialog-actions\s*\{[^}]+\}/)?.[0] || '';
  assert.match(actionsRule, /display:\s*flex/);
  assert.doesNotMatch(actionsRule, /grid-template-columns/);

  const dialogBtnRule = less.match(/\.dialog-btn\s*\{[^}]+\}/)?.[0] || '';
  assert.match(dialogBtnRule, /height:\s*72rpx/);
  assert.match(dialogBtnRule, /width:\s*0/);
  assert.match(dialogBtnRule, /min-width:\s*0/);
  assert.match(dialogBtnRule, /margin:\s*0/);
  assert.match(dialogBtnRule, /box-sizing:\s*border-box/);
  assert.match(dialogBtnRule, /flex:\s*1/);
});
