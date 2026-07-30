const test = require('node:test');
const assert = require('node:assert/strict');
const aiService = require('../utils/aiDesignService.js');
const { buildPrimaryAction } = require('../pages/ai-design/ai-design-model.js');

const workflows = [
  { key: 'reference_recreate', credits: 20, enabled: true },
  { key: 'style_transform', credits: 20, enabled: true },
  { key: 'floor_plan_render', credits: 30, enabled: true },
  { key: 'soft_furnishing', credits: 20, enabled: true },
];

function loadPageDefinition() {
  let definition = null;
  global.Page = (config) => { definition = config; };
  const pagePath = require.resolve('../pages/ai-design/ai-design.js');
  delete require.cache[pagePath];
  require(pagePath);
  delete global.Page;
  return definition;
}

function createPage(definition, data = {}) {
  return {
    ...definition,
    data: { ...definition.data, ...data },
    setData(update, callback) {
      Object.assign(this.data, update);
      if (callback) callback.call(this);
    },
  };
}

function source(roomId, roomName) {
  return {
    floorPlanId: 'plan-1',
    leadId: 'lead-1',
    floorPlanName: '测试户型',
    closedRoomCount: 2,
    rooms: [
      { roomId: 'living', roomName: '客厅', roomSize: '24㎡', openingCount: 2 },
      { roomId: 'kitchen', roomName: '厨房', roomSize: '8㎡', openingCount: 1 },
    ],
    targetScope: 'single_room',
    roomId,
    roomName,
    targetLabel: roomName,
    navigationPreview: { state: 'missing' },
  };
}

test('opening AI Design without a floor plan never sends a standalone target scope', async () => {
  const originals = {
    loadCapabilities: aiService.loadCapabilities,
    loadHistory: aiService.loadHistory,
    loadSources: aiService.loadSources,
    loadWorkflows: aiService.loadWorkflows,
  };
  let requestedParams;
  aiService.loadCapabilities = async () => ({
    account: { availableBalance: 10, frozenBalance: 0 },
    provider: { available: true, supportsEdit: true, supportsGenerate: true },
    modes: [],
  });
  aiService.loadHistory = async () => ({ data: [] });
  aiService.loadSources = async () => [];
  aiService.loadWorkflows = async (params) => {
    requestedParams = params;
    return [];
  };

  try {
    const page = createPage(loadPageDefinition());
    await page.loadData();

    assert.deepEqual(requestedParams, { workflowId: '', leadId: '' });
    assert.equal(page.data.loadError, '');
    assert.equal(page.data.selectedSource, null);
  } finally {
    Object.assign(aiService, originals);
  }
});

test('kitchen without an exact result starts a kitchen concept render even if whole-plan preview is missing', () => {
  const action = buildPrimaryAction({
    workflows,
    selectedSource: source('kitchen', '厨房'),
    selectedWorkflow: {
      id: 'workflow-1',
      targetContext: { status: 'missing', targetScope: 'single_room', roomId: 'kitchen' },
    },
  });

  assert.equal(action.mode, 'floor_plan_render');
  assert.equal(action.targetScope, 'single_room');
  assert.equal(action.title, '生成厨房概念图');
});

test('kitchen continuation uses only the exact kitchen source result', () => {
  const action = buildPrimaryAction({
    workflows,
    selectedSource: source('kitchen', '厨房'),
    selectedWorkflow: {
      id: 'workflow-1',
      targetContext: {
        status: 'ready',
        targetScope: 'single_room',
        roomId: 'kitchen',
        recommendedMiniMode: 'style_transform',
        sourceTask: { id: 'kitchen-result' },
      },
    },
  });

  assert.equal(action.mode, 'style_transform');
  assert.equal(action.sourceResultTaskId, 'kitchen-result');
  assert.equal(action.title, '为厨房试一种新风格');
});

test('stale and coworker-processing targets never reuse a previous result', () => {
  const stale = buildPrimaryAction({
    workflows,
    selectedSource: source('kitchen', '厨房'),
    selectedWorkflow: { targetContext: { status: 'stale' } },
  });
  assert.equal(stale.mode, 'floor_plan_render');
  assert.equal(stale.title, '重新生成厨房概念图');
  assert.equal(stale.sourceResultTaskId, '');

  const busy = buildPrimaryAction({
    workflows,
    selectedSource: source('kitchen', '厨房'),
    selectedWorkflow: { targetContext: { status: 'processing', busyByOther: true } },
  });
  assert.equal(busy.actionType, 'busy');
  assert.equal(busy.enabled, false);
  assert.equal(busy.taskId, undefined);
});

test('switching from living room to kitchen clears old context before reloading the same plan', async () => {
  const originalLoadWorkflows = aiService.loadWorkflows;
  let finishLoad;
  let requestedParams;
  aiService.loadWorkflows = (params) => {
    requestedParams = params;
    return new Promise((resolve) => { finishLoad = resolve; });
  };

  try {
    const definition = loadPageDefinition();
    const plan = source('living', '客厅');
    const page = createPage(definition, {
      workflows,
      sources: [plan],
      selectedSource: plan,
      floorPlanId: 'plan-1',
      leadId: 'lead-1',
      roomId: 'living',
      targetScope: 'single_room',
      workflowId: 'workflow-1',
      selectedWorkflow: {
        id: 'workflow-1',
        targetContext: {
          status: 'ready',
          sourceTask: { id: 'living-result' },
          recommendedMiniMode: 'style_transform',
        },
      },
      schemeOptions: [],
      recent: [],
    });
    const kitchen = plan.rooms.find((room) => room.roomId === 'kitchen');
    const pending = page.applySource(plan, 'single_room', kitchen);

    assert.equal(page.data.roomId, 'kitchen');
    assert.equal(page.data.selectedWorkflow, null);
    assert.equal(page.data.workflowLoading, true);
    assert.equal(page.data.primaryAction.mode, 'floor_plan_render');
    assert.equal(page.data.primaryAction.sourceResultTaskId, '');
    assert.deepEqual(requestedParams, {
      leadId: 'lead-1',
      floorPlanId: 'plan-1',
      targetScope: 'single_room',
      roomId: 'kitchen',
    });

    finishLoad([{
      id: 'workflow-1',
      targetContext: { status: 'missing', targetScope: 'single_room', roomId: 'kitchen' },
    }]);
    await pending;
    assert.equal(page.data.selectedWorkflow.id, 'workflow-1');
    assert.equal(page.data.primaryAction.title, '生成厨房概念图');
  } finally {
    aiService.loadWorkflows = originalLoadWorkflows;
  }
});

test('primary continuation carries the exact source result task into the create page', () => {
  const originalWx = global.wx;
  let navigatedUrl = '';
  global.wx = {
    navigateTo({ url }) { navigatedUrl = url; },
    showToast() {},
  };

  try {
    const definition = loadPageDefinition();
    const kitchen = source('kitchen', '厨房');
    const page = createPage(definition, {
      workflows,
      provider: { available: true },
      workflowLoading: false,
      workflowLoadError: '',
      schemeOptions: [{ id: 'workflow-1' }],
      workflowId: 'workflow-1',
      floorPlanId: 'plan-1',
      leadId: 'lead-1',
      roomId: 'kitchen',
      targetScope: 'single_room',
      selectedSource: kitchen,
      primaryAction: {
        actionType: 'mode',
        mode: 'style_transform',
        targetScope: 'single_room',
        sourceResultTaskId: 'kitchen-result',
        enabled: true,
      },
    });

    page.openPrimaryAction();
    assert.match(navigatedUrl, /mode=style_transform/);
    assert.match(navigatedUrl, /roomId=kitchen/);
    assert.match(navigatedUrl, /sourceResultTaskId=kitchen-result/);
  } finally {
    global.wx = originalWx;
  }
});
