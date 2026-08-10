const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  decorateNavigator,
  decorateSourcePlan,
  buildProjectPickerView,
  chooseDefaultProjectGroup,
  decorateRecentResult,
  buildHeroSlides,
  hasActiveTasks,
  normalizeCredits,
  buildStageRail,
  buildPrimaryAction,
  buildSceneNavigation,
} = require('../pages/ai-design/ai-design-model.js');

const miniRoot = path.resolve(__dirname, '..');
const pageWxml = fs.readFileSync(
  path.join(miniRoot, 'pages', 'ai-design', 'ai-design.wxml'),
  'utf8'
);
const pageWxss = fs.readFileSync(
  path.join(miniRoot, 'pages', 'ai-design', 'ai-design.wxss'),
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

test('scene waypoints create a real focus state and a matching next action', () => {
  const scene = buildSceneNavigation(workflows, 'style_transform');
  assert.equal(scene.mode, 'style_transform');
  assert.equal(scene.focusClass, 'scene-focus-style');
  assert.equal(scene.title, '拍照换风格');
  assert.equal(scene.buttonLabel, '拍照开始');
  assert.equal(scene.credits, 20);
});

test('the next action starts with reference recreation and creates a real whole-plan 3D navigator on demand', () => {
  const standalone = buildPrimaryAction({ workflows, selectedSource: null, selectedWorkflow: null });
  assert.equal(standalone.mode, 'reference_recreate');
  assert.equal(standalone.title, '参考图复刻');

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

test('AI Design home restores the v3 spatial workbench while keeping live map and scene states', () => {
  assert.match(pageWxml, /class="plan-navigator reference-plan-navigator"/);
  assert.match(pageWxml, />AI设计工作台</);
  assert.match(pageWxml, /class="project-hero-context"/);
  assert.match(pageWxml, /bindtap="openSourcePicker"/);
  assert.match(pageWxml, /class="project-group-tabs"/);
  assert.match(pageWxml, /bindinput="onProjectSearch"/);
  assert.match(pageWxml, /bindtap="selectProjectCard"/);
  assert.match(pageWxml, /item\.statusLabel/);
  assert.match(pageWxml, /item\.actionLabel/);
  assert.match(pageWxml, /class="plan-hero-swiper"/);
  assert.match(pageWxml, /bindtap="openHeroSlide"/);
  assert.match(pageWxml, /\/images\/ai-design-hero-v3\.png/);
  assert.match(pageWxml, /class="hero-room-rail"/);
  assert.match(pageWxml, /class="hero-room-row"/);
  assert.doesNotMatch(pageWxml, /hero-room-pin|hero-room-all|hero-room-[0-9]/);
  assert.match(pageWxml, /class="stage-rail reference-stage-rail"/);
  assert.match(pageWxml, /class="stage-status">进行中/);
  assert.match(pageWxml, /class="workflow-cards"/);
  assert.match(pageWxml, /class="next-action-panel reference-next-action/);
  assert.match(pageWxml, /class="next-action-k"/);
  assert.match(pageWxml, /primaryAction\.buttonLabel/);
  assert.match(pageWxml, /primaryAction\.credits/);
  assert.match(pageWxml, /\/images\/mine-icons\/tab-measure-k\.png/);
  assert.doesNotMatch(pageWxml, /\/images\/page-ip-v3\/ai-home\.png/);
  assert.match(pageWxml, /class="scene-navigator/);
  assert.match(pageWxml, /bindtap="focusSceneWaypoint"/);
  assert.match(pageWxml, /sceneNavigation\.focusClass/);
  assert.match(pageWxml, /heroSlides\.length/);
  assert.match(pageWxml, /loading && !hasLoadedOnce/);
  assert.match(pageWxml, /loadError && !hasLoadedOnce/);
  assert.match(pageWxml, /result\.displayImageUrl/);
  assert.match(pageWxml, /historyLoadError/);
  assert.doesNotMatch(pageWxml, /navigationPreview\.task\.progress \|\| 10/);
  assert.match(pageModelSource, /生成 3D 户型导览图/);
  assert.doesNotMatch(pageWxml, /class="workflow-grid"/);
  assert.doesNotMatch(pageWxml, />AI 设计</);
  assert.match(pageWxss, /\.reference-plan-navigator\s*\{[^}]*margin:\s*0 -36rpx/);
  assert.match(pageWxss, /\.reference-plan-stage\s*\{[^}]*height:\s*760rpx/);
  assert.doesNotMatch(pageWxss, /\.reference-plan-stage\.has-default-hero\s*\{[\s\S]*height:/);
  assert.match(pageWxss, /\.with-plan \.page-subtitle-line \.page-subtitle\s*\{[^}]*color:\s*#6f7479;[^}]*text-shadow:\s*none/);
  assert.match(pageWxss, /\.project-hero-context\s*\{[^}]*top:\s*28rpx/);
  assert.match(pageWxml, /\/images\/ai-design-hero-v3\.png/);
  assert.match(pageWxml, /class="scene-source-card"/);
  assert.match(pageWxml, />参考图复刻</);
  assert.match(pageWxml, />拍照换风格</);
  assert.match(pageWxml, />户型生成</);
  assert.match(pageWxml, />软装搭配</);
  assert.match(pageWxml, /sceneNavigation\.buttonLabel/);
  assert.doesNotMatch(pageWxml, /class="scene-index"/);
  assert.doesNotMatch(pageWxml, />0[1-4]</);
  assert.match(pageWxss, /\.scene-waypoint-icon image\s*\{[\s\S]*width:\s*30rpx/);
  assert.match(pageWxml, /class="discovery-handle"/);
  assert.match(pageWxml, /\/images\/mine-icons\/tab-ai-active\.png/);
  assert.match(pageWxml, />最近方案</);
  assert.match(pageWxml, /class="result-progress-track"/);
  assert.match(pageWxss, /\.scene-navigator\s*\{[\s\S]*height:\s*calc\(1024rpx/);
  assert.match(pageWxss, /var\(--ai-navigation-top,\s*24px\)/);
  assert.match(pageWxss, /\.next-button\s*\{[\s\S]*font-size:\s*24rpx/);
  assert.match(pageWxss, /\.stage-label\s*\{[\s\S]*font-size:\s*25rpx/);
  assert.match(pageWxss, /\.stage-dot\s*\{[\s\S]*width:\s*42rpx/);
  assert.match(pageWxss, /\.hero-room-chip\s*\{[\s\S]*min-height:\s*84rpx/);
  assert.match(pageWxss, /\.hero-room-chip-label\s*\{[\s\S]*min-height:\s*54rpx/);
  assert.match(pageWxss, /\.hero-room-chip\.active \.hero-room-chip-label\s*\{[\s\S]*color:\s*#10a948/);
  assert.match(pageWxss, /\.design-workbench\s*\{[\s\S]*margin:\s*-76rpx 0 0/);
  assert.match(pageWxss, /\.reference-next-action\s*\{[\s\S]*min-height:\s*114rpx/);
  assert.match(pageWxss, /\.scene-waypoint\s*\{[\s\S]*min-height:\s*54rpx/);
  assert.match(pageWxss, /\.discovery-panel\s*\{[\s\S]*margin:\s*-30rpx -36rpx 0/);
  assert.match(pageWxss, /\.secondary-action\s*\{[\s\S]*font-size:\s*24rpx/);
  assert.match(pageWxss, /\.project-group-tab\s*\{[^}]*min-height:\s*68rpx/);
  assert.match(pageWxss, /\.project-source-action\s*\{[^}]*min-height:\s*70rpx/);
  assert.match(
    pageWxss,
    /@media \(max-width: 360px\)[\s\S]*\.without-plan \.next-action\.standalone\s*\{[\s\S]*flex-direction:\s*row/
  );
  assert.match(
    pageWxss,
    /@media \(max-width: 360px\)[\s\S]*\.without-plan \.next-action\.standalone \.next-button\s*\{[\s\S]*width:\s*auto/
  );
});
