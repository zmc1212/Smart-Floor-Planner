const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  decorateNavigator,
  decorateSourcePlan,
  decorateRecentResult,
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

test('AI Design home ships the approved map, journey, and scene states without the old task grid', () => {
  assert.match(pageWxml, /class="plan-navigator"/);
  assert.match(pageWxml, /class="room-selector-handle"/);
  assert.match(pageWxml, /class="stage-rail"/);
  assert.match(pageWxml, /class="stage-status">进行中/);
  assert.match(pageWxml, /class="next-action-panel"/);
  assert.match(pageWxml, /class="scene-navigator/);
  assert.match(pageWxml, /bindtap="focusSceneWaypoint"/);
  assert.match(pageWxml, /sceneNavigation\.focusClass/);
  assert.match(pageWxml, /selectedSource\.navigationPreview\.imageUrl/);
  assert.match(pageWxml, /loading && !hasLoadedOnce/);
  assert.match(pageWxml, /loadError && !hasLoadedOnce/);
  assert.match(pageWxml, /result\.displayImageUrl/);
  assert.match(pageWxml, /historyLoadError/);
  assert.doesNotMatch(pageWxml, /navigationPreview\.task\.progress \|\| 10/);
  assert.match(pageModelSource, /生成 3D 户型导览图/);
  assert.doesNotMatch(pageWxml, /class="workflow-grid"/);
  assert.doesNotMatch(pageWxml, />AI 设计</);
  assert.match(pageWxss, /\.plan-stage\s*\{[\s\S]*height:\s*620rpx/);
  assert.match(pageWxml, /\/images\/ai-design-hero-v3\.jpg/);
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
  assert.match(pageWxss, /\.room-selector\s*\{[\s\S]*border-radius:\s*30rpx 30rpx 0 0/);
  assert.match(pageWxss, /\.room-tab\.active::after/);
  assert.match(pageWxss, /\.scene-waypoint\s*\{[\s\S]*min-height:\s*54rpx/);
  assert.match(pageWxss, /\.discovery-panel\s*\{[\s\S]*margin:\s*-30rpx -36rpx 0/);
  assert.match(pageWxss, /\.secondary-action\s*\{[\s\S]*font-size:\s*24rpx/);
  assert.match(
    pageWxss,
    /@media \(max-width: 360px\)[\s\S]*\.without-plan \.next-action\.standalone\s*\{[\s\S]*flex-direction:\s*row/
  );
  assert.match(
    pageWxss,
    /@media \(max-width: 360px\)[\s\S]*\.without-plan \.next-action\.standalone \.next-button\s*\{[\s\S]*width:\s*auto/
  );
});
