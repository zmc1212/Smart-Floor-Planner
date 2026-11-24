const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const miniRoot = path.resolve(__dirname, '..');
const appConfig = JSON.parse(fs.readFileSync(path.join(miniRoot, 'app.json'), 'utf8'));
const customTabSource = fs.readFileSync(
  path.join(miniRoot, 'custom-tab-bar', 'index.js'),
  'utf8'
);
const customTabWxml = fs.readFileSync(
  path.join(miniRoot, 'custom-tab-bar', 'index.wxml'),
  'utf8'
);
const customTabWxss = fs.readFileSync(
  path.join(miniRoot, 'custom-tab-bar', 'index.less'),
  'utf8'
);
const aiDesignWxml = fs.readFileSync(
  path.join(miniRoot, 'pages', 'ai-design', 'ai-design.wxml'),
  'utf8'
);
const aiDesignWxss = fs.readFileSync(
  path.join(miniRoot, 'pages', 'ai-design', 'ai-design.less'),
  'utf8'
);
const aiDesignPageSource = fs.readFileSync(
  path.join(miniRoot, 'pages', 'ai-design', 'ai-design.js'),
  'utf8'
);
const aiWorkflowPageSources = ['create', 'history', 'result'].map((page) => fs.readFileSync(
  path.join(miniRoot, 'packages', 'ai-workflow', page, `ai-design-${page}.js`),
  'utf8'
));
const aiDesignPageConfig = JSON.parse(fs.readFileSync(
  path.join(miniRoot, 'pages', 'ai-design', 'ai-design.json'),
  'utf8'
));
const {
  AI_DESIGN_TAB_URL,
  buildSchemeStudioUrl,
  consumeAIDesignContext,
  normalizeAIDesignContext,
  openAIDesignTab,
  openSchemeStudio,
  shouldOpenSchemeStudio,
} = require('../utils/aiDesignNavigation.js');
const { canAccessAIDesign } = require('../utils/aiDesignAccess.js');
const { canAccessRoute } = require('../utils/identity-navigation');

function withNavigation(globalData, verify) {
  const previous = { getApp: global.getApp, Page: global.Page, wx: global.wx };
  const routes = [];
  global.getApp = () => ({ globalData });
  global.wx = {
    switchTab: ({ url }) => routes.push({ method: 'switchTab', url }),
    navigateTo: ({ url }) => routes.push({ method: 'navigateTo', url }),
    showToast() {},
  };
  try {
    verify(routes);
  } finally {
    Object.assign(global, previous);
  }
}

test('an authorized designer can open the registered Design page with a selected room', () => {
  const tab = appConfig.tabBar.list.find((item) => '/' + item.pagePath === AI_DESIGN_TAB_URL);

  assert.ok(tab);
  assert.equal(tab.text, '设计');
  assert.equal(tab.iconPath, 'images/mine-icons/tab-ai.png');
  assert.equal(tab.selectedIconPath, 'images/mine-icons/tab-ai-active.png');
  assert.equal(
    appConfig.tabBar.list.some((item) => item.pagePath === 'pages/inspiration/inspiration'),
    false
  );

  const userInfo = { role: 'staff', staffRole: 'designer', enterpriseId: '42' };
  const bootstrap = { current: { role: 'designer', capabilities: ['construction.projects', 'staff.design', 'account'] } };
  assert.equal(canAccessRoute(AI_DESIGN_TAB_URL, bootstrap), true);
  withNavigation({ userInfo, bootstrap }, routes => {
    assert.equal(openAIDesignTab({ floorPlanId: '123', roomId: '456' }), true);
    assert.deepEqual(routes, [{ method: 'switchTab', url: AI_DESIGN_TAB_URL }]);
    assert.deepEqual(consumeAIDesignContext(), {
      floorPlanId: '123', roomId: '456', targetScope: 'single_room',
    });
    assert.equal(consumeAIDesignContext(), null);
  });

  for (const filename of ['tab-ai.png', 'tab-ai-active.png']) {
    const bytes = fs.readFileSync(path.join(miniRoot, 'images', 'mine-icons', filename));
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.ok(bytes.length <= 10 * 1024, `${filename} exceeds the 10KB icon budget`);
  }
});

test('AI Design uses the shared tab-page scrolling contract', () => {
  assert.equal(aiDesignPageConfig.navigationStyle, 'custom');
  assert.equal(aiDesignPageConfig.navigationBarTitleText, undefined);
  assert.match(aiDesignWxml, /class="ai-page sfp-tab-page"/);
  assert.match(aiDesignWxml, /class="ai-scroll"/);
  assert.match(aiDesignWxml, /padding-top: \{\{navigationTop\}\}px/);
  assert.match(aiDesignWxml, /padding-right: \{\{navigationRight\}\}px/);
  assert.match(aiDesignWxml, /bindrefresherrefresh="onRefresh"/);
  assert.match(aiDesignWxss, /\.recipe-search-overlay[^}]+position:\s*fixed/);
  assert.match(aiDesignWxss, /safe-area-inset-bottom/);
  assert.match(aiDesignWxml, /class="project-hero"/);
  assert.match(aiDesignWxml, /recentProjects\[0\]/);
  assert.match(aiDesignWxml, /bindtap="openRecentProject(StartNew|Continue)"/);
  assert.match(aiDesignWxss, /\.hero-action-icon\s*\{[\s\S]*?width:\s*30rpx;[\s\S]*?height:\s*30rpx;/);
  assert.match(aiDesignWxml, /bindtap="openCreateScheme"/);
  assert.match(aiDesignWxml, /class="recipe-waterfall"/);
  assert.match(aiDesignPageSource, /openSchemeStudio/);
  assert.match(aiDesignPageSource, /shouldOpenSchemeStudioFromContext/);
  assert.doesNotMatch(aiDesignWxml, /class="scene-navigator/);
  assert.doesNotMatch(aiDesignWxml, /提示词|模型/);
});

test('the center Measure action uses the approved background-free Xiao K rangefinder', () => {
  assert.doesNotMatch(customTabSource, /iconPath: '\/images\/mine-icons\/tab-measure-active\.png'/);
  assert.match(customTabWxml, /\/images\/mine-icons\/tab-measure-k\.png/);
  assert.match(customTabWxml, /<text class="tab-text">\{\{item\.text\}\}<\/text>/);
  assert.match(
    customTabWxss,
    /\.center-icon\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?top:\s*-30rpx;[\s\S]*?width:\s*128rpx;[\s\S]*?height:\s*128rpx;[\s\S]*?border-radius:\s*0;[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none;[\s\S]*?overflow:\s*visible;/
  );
  assert.match(
    customTabWxss,
    /\.center-image\s*\{[\s\S]*?width:\s*128rpx;[\s\S]*?height:\s*128rpx;/
  );
  assert.match(customTabWxss, /\.tab-item\.center \.tab-text\s*\{[\s\S]*?top:\s*96rpx;/);
  assert.match(customTabWxss, /\.tab-item\.center \.tab-text\s*\{[\s\S]*?color:\s*currentColor;[\s\S]*?font-weight:\s*400;/);
  assert.doesNotMatch(customTabWxss, /\.tab-item\.center \.tab-text\s*\{[\s\S]*?color:\s*#079b45;/);

  const measureAsset = fs.readFileSync(
    path.join(miniRoot, 'images', 'mine-icons', 'tab-measure-k.png')
  );
  assert.equal(measureAsset.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(measureAsset.readUInt32BE(16), 128);
  assert.equal(measureAsset.readUInt32BE(20), 128);
  assert.ok(measureAsset.length <= 10 * 1024, 'tab-measure-k.png exceeds the 10KB icon budget');
});

test('contextual AI entries preserve plan and room scope across switchTab', () => {
  assert.deepEqual(normalizeAIDesignContext({ floorPlanId: 123 }), {
    floorPlanId: '123',
    targetScope: 'whole_floor_plan',
  });
  assert.deepEqual(normalizeAIDesignContext({ floorPlanId: 'plan-1', roomId: 'room-2' }), {
    floorPlanId: 'plan-1',
    roomId: 'room-2',
    targetScope: 'single_room',
  });
  assert.equal(shouldOpenSchemeStudio({ leadId: '1', floorPlanId: '2' }), true);
  assert.equal(shouldOpenSchemeStudio({ leadId: '1', workflowId: '3' }), true);
  assert.equal(shouldOpenSchemeStudio({ leadId: '1' }), true);
  assert.equal(shouldOpenSchemeStudio({ floorPlanId: '2' }), false);
  assert.equal(
    buildSchemeStudioUrl({ leadId: '1', workflowId: '2', floorPlanId: '3' }),
    '/packages/ai-workflow/scheme-studio/scheme-studio?leadId=1&workflowId=2&floorPlanId=3'
  );
  assert.equal(
    buildSchemeStudioUrl({ leadId: '1', workflowId: '2', startNewRound: '1' }),
    '/packages/ai-workflow/scheme-studio/scheme-studio?leadId=1&workflowId=2&startNewRound=1'
  );

  const leadDetailSource = fs.readFileSync(
    path.join(miniRoot, 'packages', 'enterprise', 'lead-detail', 'lead-detail.js'),
    'utf8'
  );
  assert.match(leadDetailSource, /openAIDesignEntry/);
});

test('Design hero actions keep new-round and continuation routes distinct', () => {
  assert.match(aiDesignWxml, /bindtap="openRecentProjectStartNew"/);
  assert.match(aiDesignWxml, /bindtap="openRecentProjectContinue"/);
  assert.match(aiDesignPageSource, /openRecentProjectStartNew/);
  assert.match(aiDesignPageSource, /openRecentProjectContinue/);
  assert.match(aiDesignPageSource, /startNewRound: options\.startNewRound \? '1' : ''/);
  assert.match(
    fs.readFileSync(path.join(miniRoot, 'packages', 'ai-workflow', 'scheme-studio', 'scheme-studio.wxml'), 'utf8'),
    /auto-open-round="\{\{startNewRound\}\}"/
  );
});

test('standalone channel promoters cannot open or load enterprise AI design', () => {
  const userInfo = { role: 'staff', staffRole: 'salesperson', enterpriseId: '' };
  const bootstrap = { current: { role: 'salesperson', capabilities: ['promotion.records', 'account'] } };
  assert.equal(canAccessAIDesign(userInfo), false);
  assert.equal(canAccessAIDesign({ role: 'staff', staffRole: 'salesperson', enterpriseId: '42' }), true);
  assert.equal(canAccessAIDesign({ role: 'user', enterpriseId: '42' }), false);
  assert.equal(canAccessRoute(AI_DESIGN_TAB_URL, bootstrap), false);

  withNavigation({ userInfo, bootstrap }, routes => {
    assert.equal(openAIDesignTab({ floorPlanId: '123' }), false);
    assert.equal(openSchemeStudio({ leadId: '42' }), false);
    assert.deepEqual(routes, []);
    assert.equal(consumeAIDesignContext(), null);

    let page;
    const filename = require.resolve('../pages/ai-design/ai-design');
    global.Page = definition => { page = definition; };
    try {
      require(filename);
      const instance = {
        ...page,
        data: { ...page.data },
        setData(update) { Object.assign(this.data, update); },
        loadData() { assert.fail('AI Design loaded data for a standalone promoter'); },
      };
      instance.onShow();
      assert.equal(instance.recentPageVisible, false);
      assert.deepEqual(routes, [{ method: 'switchTab', url: '/pages/index/index' }]);
    } finally {
      delete require.cache[filename];
    }
  });
  aiWorkflowPageSources.forEach((source) => assert.match(source, /if \(!canAccessAIDesign\(\)\)/));
});
