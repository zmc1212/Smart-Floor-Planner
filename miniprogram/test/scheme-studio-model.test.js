const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const miniRoot = path.resolve(__dirname, '..');
const {
  applySelectionToView,
  buildConversationBatches,
  buildDefaultSendSelection,
  buildStudioView,
  buildWorkflowSwitcherOptions,
  decorateBatchView,
  mergeSendSelection,
  pickPreferredStudioWorkflow,
  shouldPollStudioView,
} = require('../packages/ai-workflow/scheme-studio/scheme-studio-model.js');
const {
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
  const draft = {
    ...createDefaultDraft(bootstrap),
    prompt: '测试提示词',
    count: 2,
  };
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

  assert.match(wxml, /nav-switch/);
  assert.match(wxml, /scheme-chip/);
  assert.match(wxml, /\+ 新建/);
  assert.match(wxml, /context-card/);
  assert.match(wxml, /send-button/);
  assert.match(wxml, /已确认 \{\{view\.workflow\.publishedCount\}\} 张/);
  assert.match(wxml, /published-badge/);
  assert.match(wxml, /ai-scheme-composer/);
  assert.match(wxml, /sendModalVisible/);
  assert.match(wxml, /menuMounted/);
  assert.match(wxml, /renameMounted/);
  assert.match(wxml, /sendMounted/);
  assert.match(wxml, /modal-mask \{\{menuVisible \? 'open' : ''\}\}/);
  assert.match(wxml, /menu-panel \{\{menuVisible \? 'open' : ''\}\}/);
  assert.match(less, /transition:\s*opacity 240ms ease-out/);
  assert.match(less, /transition:\s*transform 240ms ease-out/);
  assert.match(less, /translateY\(100%\)/);
  assert.match(script, /sheetMotion/);
  assert.match(script, /openSheet\(this, MENU_SHEET\)/);
  assert.match(script, /closeSheet\(this, SEND_SHEET\)/);
  assert.match(composerWxml, /pickerMounted/);
  assert.match(composerWxml, /templateSheetMounted/);
  assert.match(composerWxml, /settingsMounted/);
  assert.match(composerWxml, /composer-shell dock/);
  assert.match(composerWxml, /dockExpanded/);
  assert.match(composerWxml, /generate-fab/);
  assert.match(composerWxml, /出图设置/);
  assert.match(composerWxml, /credit-bar/);
  assert.match(composerLess, /\.credit-bar\s*\{[^}]*background:\s*#00c365/);
  assert.match(composerLess, /\.credit-bar\s*\{[^}]*color:\s*#fff/);
  assert.match(less, /\.empty-rounds\s*\{[^}]*margin-top:\s*24rpx/);
  assert.match(wxml, /dock-expanded/);
  assert.match(wxml, /onComposerDockExpandChange/);
  assert.match(composerWxml, /adjust-position=\"\{\{false\}\}\"/);
  assert.match(composerWxml, /keyboard-open/);
  assert.match(wxml, /composerKeyboardHeight/);
  assert.match(wxml, /onComposerKeyboardHeightChange/);
  assert.match(less, /\.composer-dock-scrim/);
  assert.match(less, /\.studio-shell\.dock-expanded/);
  assert.doesNotMatch(less, /\.composer-dock\s*>\s*\*/);
  assert.match(composerWxml, /sheet-mask \{\{pickerVisible \? 'open' : ''\}\}/);
  assert.match(composerWxml, /sheet-panel \{\{pickerVisible \? 'open' : ''\}\}/);
  assert.match(wxml, /openGenerationActions/);
  assert.match(wxml, /toggleGenerationSelect/);
  assert.match(wxml, /retryBatch/);
  assert.match(composerWxml, /一键出图/);
  assert.match(composerWxml, /template-grid/);
  assert.match(composerWxml, /template-cover/);
  assert.match(composerWxml, /item\.previewUrl/);
  assert.match(pageJson, /ai-scheme-composer/);
  assert.match(less, /\.round-card/);
  assert.match(less, /\.generation-tile/);
  assert.match(less, /\.select-badge/);
  assert.match(less, /\.scheme-chip/);
  assert.match(less, /\.nav-switch/);
  assert.match(script, /selectSchemeChip/);
  assert.match(script, /onTemplateImageError/);
  assert.match(script, /maybeOfferPreferredWorkflow/);
  assert.match(script, /pickPreferredStudioWorkflow/);
  assert.match(script, /listStudioWorkflows/);
  assert.match(script, /forceCreate/);
  assert.match(script, /openWorkflowSwitcher/);
  assert.match(wxml, /切换/);
  assert.match(wxml, /新建/);
  assert.match(script, /submitStudioBatch/);
  assert.match(script, /publishScheme/);
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
