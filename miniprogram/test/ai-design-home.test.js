const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  decorateNavigator,
  decorateSourcePlan,
  buildProjectPickerView,
  chooseDefaultProjectGroup,
  chooseDefaultProject,
  decorateRecentResult,
  buildHeroSlides,
  hasActiveTasks,
  normalizeCredits,
  buildStageRail,
  buildPrimaryAction,
  buildExperienceState,
} = require('../pages/ai-design/ai-design-model.js');

const miniRoot = path.resolve(__dirname, '..');
const pageWxml = fs.readFileSync(
  path.join(miniRoot, 'pages', 'ai-design', 'ai-design.wxml'),
  'utf8'
);
const pageWxss = fs.readFileSync(
  path.join(miniRoot, 'pages', 'ai-design', 'ai-design.less'),
  'utf8'
);
const pageModelSource = fs.readFileSync(
  path.join(miniRoot, 'pages', 'ai-design', 'ai-design-model.js'),
  'utf8'
);
const pageSource = fs.readFileSync(
  path.join(miniRoot, 'pages', 'ai-design', 'ai-design.js'),
  'utf8'
);
const aiServiceSource = fs.readFileSync(
  path.join(miniRoot, 'utils', 'aiDesignService.js'),
  'utf8'
);

function loadHomePageConfig() {
  const modulePath = path.join(miniRoot, 'pages', 'ai-design', 'ai-design.js');
  const previousPage = global.Page;
  let pageConfig;
  global.Page = (config) => { pageConfig = config; };
  delete require.cache[require.resolve(modulePath)];
  require(modulePath);
  global.Page = previousPage;
  return pageConfig;
}

const workflows = [
  { key: 'reference_recreate', credits: 20, enabled: true },
  { key: 'style_transform', credits: 20, enabled: true },
  { key: 'floor_plan_render', credits: 30, enabled: true },
  { key: 'soft_furnishing', credits: 20, enabled: true },
];

test('formal navigator geometry becomes renderable Mini Program styles', () => {
  const navigator = decorateNavigator({
    aspectRatio: 1.25,
    walls: [{ id: 'w1', left: 5, top: 10, width: 80, angle: 12.5 }],
    rooms: [{
      id: 'living',
      name: '客厅',
      left: 5,
      top: 10,
      width: 40,
      height: 35,
      centerX: 25,
      centerY: 27.5,
      polygon: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }],
    }],
  });

  assert.equal(navigator.aspectRatio, 1.25);
  assert.match(navigator.walls[0].style, /left:5%/);
  assert.match(navigator.walls[0].style, /rotate\(12\.5deg\)/);
  assert.match(navigator.rooms[0].fillStyle, /clip-path:polygon/);
  assert.equal(navigator.rooms[0].labelStyle, 'left:25%;top:27.5%');
});

test('preview and recent-task states keep real progress and all non-terminal jobs active', () => {
  const source = decorateSourcePlan({
    navigationPreview: {
      state: 'processing',
      task: { id: 'preview-1', status: 'pending', progress: 0 },
    },
  });
  assert.equal(source.navigationPreview.task.progress, 0);

  const pending = decorateRecentResult({ id: 'pending-1', status: 'pending', progress: 0 });
  const cancelled = decorateRecentResult({ id: 'cancelled-1', status: 'cancelled', progress: 90 });
  assert.equal(pending.statusLabel, '生成中 0%');
  assert.equal(pending.isProcessing, true);
  assert.equal(cancelled.statusLabel, '已取消');
  assert.equal(cancelled.isProcessing, false);
  assert.equal(hasActiveTasks([pending, cancelled]), true);
  assert.equal(normalizeCredits(0), 0);
  assert.equal(normalizeCredits(null), 10);
  assert.equal(normalizeCredits(undefined), 10);
});

test('project picker groups backend-derived states and searches customer identity', () => {
  const projects = [
    decorateSourcePlan({ floorPlanId: '1', projectTitle: '年总 · 火凤凰', projectSubtitle: '主户型', projectGroup: 'in_progress', uiState: 'generating' }),
    decorateSourcePlan({ floorPlanId: '2', projectTitle: '陈女士 · 云栖花园', projectSubtitle: '正式量房', projectGroup: 'ready', uiState: 'ready' }),
    decorateSourcePlan({ floorPlanId: '3', projectTitle: '王先生 · 碧桂园', projectSubtitle: '草稿', projectGroup: 'needs_survey', uiState: 'needs_survey', eligibility: { eligible: false, reasonLabel: '量房未完成' } }),
  ];
  assert.equal(chooseDefaultProjectGroup(projects, ''), 'in_progress');
  assert.equal(chooseDefaultProjectGroup(projects, '2'), 'ready');
  assert.deepEqual(
    buildProjectPickerView(projects, 'ready', '云栖').filteredProjects.map((item) => item.floorPlanId),
    ['2']
  );
  assert.deepEqual(
    buildProjectPickerView(projects, 'in_progress').projectGroups.map((item) => item.count),
    [1, 1, 1]
  );
  assert.equal(chooseDefaultProject(projects).floorPlanId, '1');
  assert.equal(chooseDefaultProject(projects, '2').floorPlanId, '2');
  assert.equal(chooseDefaultProject(projects, '3'), null);
});

test('hero carousel is scoped to the explicitly selected full floor plan', () => {
  const selectedSource = {
    floorPlanId: 'plan-a',
    targetLabel: '完整户型',
    updatedAt: '2026-08-07T10:00:00.000Z',
    navigationPreview: { state: 'missing' },
  };
  const recent = [
    { id: 'current', mode: 'floor_plan_render', status: 'succeeded', floorPlanId: 'plan-a', targetScope: 'whole_floor_plan', resultImageUrl: 'https://example.com/current.png', createdAt: '2026-08-07T11:00:00.000Z' },
    { id: 'other-lead', mode: 'floor_plan_render', status: 'succeeded', floorPlanId: 'plan-b', targetScope: 'whole_floor_plan', resultImageUrl: 'https://example.com/other.png' },
    { id: 'room-only', mode: 'floor_plan_render', status: 'succeeded', floorPlanId: 'plan-a', targetScope: 'single_room', resultImageUrl: 'https://example.com/room.png' },
    { id: 'style', mode: 'style_transform', status: 'succeeded', floorPlanId: 'plan-a', targetScope: 'whole_floor_plan', resultImageUrl: 'https://example.com/style.png' },
    { id: 'stale', mode: 'floor_plan_render', status: 'succeeded', floorPlanId: 'plan-a', targetScope: 'whole_floor_plan', resultImageUrl: 'https://example.com/stale.png', createdAt: '2026-08-07T09:00:00.000Z' },
  ];

  assert.deepEqual(buildHeroSlides(recent, selectedSource).map((item) => item.id), ['current']);
  assert.deepEqual(buildHeroSlides(recent, null), []);
});

test('hero lookup is server-scoped instead of relying on the paginated recent list', () => {
  assert.match(aiServiceSource, /heroFloorPlanId=\$\{encodeURIComponent\(floorPlanId\)\}/);
  assert.match(pageSource, /loadHeroFloorPlanResults\(selectedSource\.floorPlanId\)/);
  assert.match(pageSource, /loadHeroFloorPlanResults\(requestedSource\.floorPlanId\)/);
  assert.doesNotMatch(pageSource, /loadHistory\(1, 30\)/);
});

test('tapping a hero slide opens that exact generation result', () => {
  const page = loadHomePageConfig();
  let opened;
  page.openHeroSlide.call({
    openResult(event) { opened = event.currentTarget.dataset.id; },
  }, { currentTarget: { dataset: { id: 'hero-task-42' } } });
  assert.equal(opened, 'hero-task-42');
});

test('scheme stages map server workflow state to the four approved journey stations', () => {
  assert.deepEqual(
    buildStageRail(null).map((item) => item.label),
    ['空间基准', '风格方案', '软装完善', '提案深化']
  );
  assert.deepEqual(
    buildStageRail({ currentStageKey: 'soft_furnishing' }).map((item) => item.status),
    ['done', 'done', 'current', 'upcoming']
  );
  assert.deepEqual(
    buildStageRail({ currentStageKey: 'lighting' }).map((item) => item.status),
    ['done', 'done', 'done', 'current']
  );
});

test('the hero progress names the current design stage instead of repeating the project status', () => {
  assert.equal(buildExperienceState({
    workflows,
    selectedSource: null,
    selectedWorkflow: null,
  }).progressLabel, '空间基准');
  assert.equal(buildExperienceState({
    workflows,
    selectedSource: null,
    selectedWorkflow: { currentStageKey: 'soft_furnishing' },
  }).progressLabel, '软装完善');
});

test('the project next action creates a real whole-plan 3D navigator on demand', () => {
  const planAction = buildPrimaryAction({
    workflows,
    selectedSource: { targetLabel: '客厅', navigationPreview: { state: 'missing' } },
    selectedWorkflow: null,
  });
  assert.equal(planAction.mode, 'floor_plan_render');
  assert.equal(planAction.targetScope, 'whole_floor_plan');
  assert.equal(planAction.credits, 30);

  const unfinishedNavigatorAction = buildPrimaryAction({
    workflows,
    selectedSource: { targetLabel: '客厅', navigationPreview: { state: 'missing' } },
    selectedWorkflow: { recommendedMiniMode: 'style_transform' },
  });
  assert.equal(unfinishedNavigatorAction.mode, 'floor_plan_render');

  const readyAction = buildPrimaryAction({
    workflows,
    selectedSource: {
      navigationPreview: {
        state: 'ready',
        task: { id: 'task-1' },
      },
    },
    selectedWorkflow: null,
  });
  assert.equal(readyAction.actionType, 'result');
  assert.equal(readyAction.taskId, 'task-1');
});

test('project index task states drive truthful progress, recovery, stale, and continuation actions', () => {
  const base = { targetLabel: '完整户型', navigationPreview: { state: 'missing' } };
  assert.equal(buildPrimaryAction({
    workflows,
    selectedSource: { ...base, uiState: 'generating', latestGeneration: { id: 'task-1', status: 'processing', progress: 65 } },
    selectedWorkflow: null,
  }).taskId, 'task-1');
  assert.equal(buildPrimaryAction({
    workflows,
    selectedSource: { ...base, uiState: 'retry', latestGeneration: { id: 'task-2', status: 'failed' } },
    selectedWorkflow: null,
  }).buttonLabel, '进入处理');
  assert.equal(buildPrimaryAction({
    workflows,
    selectedSource: { ...base, uiState: 'stale', targetScope: 'whole_floor_plan' },
    selectedWorkflow: null,
  }).buttonLabel, '重建基准');
  const continuation = buildPrimaryAction({
    workflows,
    selectedSource: { ...base, uiState: 'continue', latestGeneration: { id: 'task-3', status: 'succeeded', nextStageKey: 'soft_furnishing' } },
    selectedWorkflow: null,
  });
  assert.equal(continuation.mode, 'soft_furnishing');
  assert.equal(continuation.sourceResultTaskId, 'task-3');
});

test('AI Design home exposes the approved unified-entry hierarchy', () => {
  assert.match(pageWxml, />AI 方案创作</);
  assert.match(pageWxml, /class="project-hero"/);
  assert.match(pageWxml, /开始新一轮/);
  assert.match(pageWxml, /继续上次创作/);
  assert.match(pageWxml, /热门空间风格配方/);
  assert.match(pageWxml, /看看配方效果/);
  assert.match(pageWxml, /recentProjects\[0\]/);
  assert.match(pageWxml, /bindtap="openRecentProject(StartNew|Continue)"/);
  assert.match(pageWxml, /bindtap="openCreateScheme"/);
  assert.doesNotMatch(pageWxml, /bindtap="openHistory"/);
  assert.doesNotMatch(pageWxml, />设计记录</);
  assert.match(pageSource, /openHistory\(\)/);
  assert.match(aiServiceSource, /\/miniprogram\/ai\/history/);
  assert.doesNotMatch(pageWxml, /class="create-credit-pill"/);
  assert.doesNotMatch(pageWxml, /bindtap="switchRecipeInputMode"/);
  assert.match(pageWxml, /bindtap="openRecipeSearch"/);
  assert.match(pageWxml, /class="featured-recipe-strip"/);
  assert.match(pageWxml, /class="recipe-waterfall"/);
  assert.match(pageWxml, /wx:for="\{\{column\.items\}\}"/);
  assert.match(pageWxss, /\.project-hero\{height:480rpx\}/);
  assert.match(pageWxss, /\.project-hero-actions\{grid-template-columns:1\.32fr 1fr\}/);
  assert.match(pageWxss, /\.project-avatar\{width:88rpx;height:88rpx\}/);
  assert.match(pageWxss, /\.project-identity-copy text:first-child\{font-size:34rpx;line-height:40rpx\}/);
  assert.match(pageWxml, /<text class="sheet-title">选择客户项目<\/text>/);
  assert.match(pageWxml, /unified-entry-v2\/01-design-tab-v2\.png/);
  assert.match(pageSource, /loadRecipes/);
  assert.match(pageSource, /openRecipeBinding/);
  assert.match(pageSource, /\/recipe-project\/recipe-project\?recipeId=/);
  assert.match(pageSource, /buildRecentProjects/);
  assert.match(pageSource, /openSchemeStudio/);
  assert.match(pageSource, /shouldOpenSchemeStudioFromContext/);
  assert.match(pageModelSource, /function buildRecentProjects/);
  assert.match(pageModelSource, /查看方案/);
  assert.match(pageModelSource, /去出图/);
  assert.doesNotMatch(pageWxml, /提示词|模型|四阶段/);
  assert.doesNotMatch(pageWxml, /class="plan-default-scene"|class="project-hero-stage-rail"/);
  const designerMascot = fs.readFileSync(path.join(miniRoot, 'images', 'airy-v1', 'xiao-k-designer-3d.png'));
  assert.equal(designerMascot.subarray(1, 4).toString(), 'PNG');
  assert.ok(designerMascot.length <= 300 * 1024, 'designer mascot exceeds the generated-artwork budget');
});

test('recent project cards prefer in-progress schemes and map D01 action labels', () => {
  const {
    buildRecentProjects,
    shouldOpenSchemeStudioFromContext,
  } = require('../pages/ai-design/ai-design-model.js');
  const projects = buildRecentProjects([
    decorateSourcePlan({
      floorPlanId: 'ready-1',
      projectDisplayTitle: '保利·天汇 804室',
      projectGroup: 'ready',
      uiState: 'ready',
      statusLabel: '正式量房已就绪',
      updatedAt: '2026-08-19T10:00:00.000Z',
    }),
    decorateSourcePlan({
      floorPlanId: 'active-1',
      projectDisplayTitle: '万科·未来之光 1202室',
      projectGroup: 'in_progress',
      uiState: 'continue',
      statusLabel: '继续设计 · 风格方案',
      activeWorkflow: { id: 'wf-1', currentStageLabel: '风格方案' },
      updatedAt: '2026-08-20T10:00:00.000Z',
    }),
  ]);
  assert.deepEqual(projects.map((item) => item.floorPlanId), ['active-1', 'ready-1']);
  assert.equal(projects[0].schemeActionLabel, '查看方案');
  assert.equal(projects[0].schemeActionTone, 'outline');
  assert.equal(projects[1].schemeActionLabel, '去出图');
  assert.equal(projects[1].schemeActionTone, 'solid');
  assert.equal(shouldOpenSchemeStudioFromContext({ leadId: '1', workflowId: '2' }), true);
  assert.equal(shouldOpenSchemeStudioFromContext({ leadId: '1', floorPlanId: '3' }), true);
  assert.equal(shouldOpenSchemeStudioFromContext({ leadId: '1' }), false);
  assert.equal(shouldOpenSchemeStudioFromContext({}), false);
});
