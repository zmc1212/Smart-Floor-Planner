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
  path.join(miniRoot, 'custom-tab-bar', 'index.wxss'),
  'utf8'
);
const aiDesignWxml = fs.readFileSync(
  path.join(miniRoot, 'pages', 'ai-design', 'ai-design.wxml'),
  'utf8'
);
const aiDesignWxss = fs.readFileSync(
  path.join(miniRoot, 'pages', 'ai-design', 'ai-design.wxss'),
  'utf8'
);
const aiDesignPageSource = fs.readFileSync(
  path.join(miniRoot, 'pages', 'ai-design', 'ai-design.js'),
  'utf8'
);
const aiDesignPageConfig = JSON.parse(fs.readFileSync(
  path.join(miniRoot, 'pages', 'ai-design', 'ai-design.json'),
  'utf8'
));
const { normalizeAIDesignContext } = require('../utils/aiDesignNavigation.js');

test('Design replaces Inspiration as the primary immersive design tab', () => {
  const tab = appConfig.tabBar.list.find((item) => item.pagePath === 'pages/ai-design/ai-design');

  assert.ok(tab);
  assert.equal(tab.text, '设计');
  assert.equal(tab.iconPath, 'images/mine-icons/tab-ai.png');
  assert.equal(tab.selectedIconPath, 'images/mine-icons/tab-ai-active.png');
  assert.equal(
    appConfig.tabBar.list.some((item) => item.pagePath === 'pages/inspiration/inspiration'),
    false
  );

  assert.match(customTabSource, /key: 'ai-design'/);
  assert.match(customTabSource, /pagePath: '\/pages\/ai-design\/ai-design'/);
  assert.match(customTabSource, /text: '设计'/);
  assert.match(customTabSource, /this\.setData\(\{ selected: index \}\)/);
  assert.match(customTabSource, /fail: \(\) => this\.syncSelected\(\)/);
  assert.doesNotMatch(customTabSource, /key: 'inspiration'/);

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
  assert.match(aiDesignWxml, /--ai-navigation-top: \{\{navigationTop\}\}px/);
  assert.match(aiDesignWxml, /padding-right: \{\{navigationRight\}\}px/);
  assert.match(aiDesignWxml, /bindrefresherrefresh="onRefresh"/);
  assert.match(aiDesignWxss, /\.source-sheet[^}]+bottom: var\(--sfp-custom-tabbar-safe-height\)/);
  assert.match(
    aiDesignWxss,
    /\.without-plan \.scene-navigator\s*\{[\s\S]*margin:\s*calc\(-214rpx - var\(--ai-navigation-top/
  );
  assert.match(aiDesignPageSource, /syncTabBar\(\) \{[\s\S]*selected: 3/);
  assert.match(aiDesignPageSource, /syncImmersiveNavigationMetrics\(\)/);
});

test('the center Measure action preserves the established floating circular tab style', () => {
  assert.doesNotMatch(customTabSource, /iconPath: '\/images\/mine-icons\/tab-measure-active\.png'/);
  assert.match(customTabWxml, /\/images\/mine-icons\/tab-measure-k\.png/);
  assert.match(customTabWxml, /<text class="tab-text">\{\{item\.text\}\}<\/text>/);
  assert.match(
    customTabWxss,
    /\.center-icon\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?top:\s*-22rpx;[\s\S]*?width:\s*112rpx;[\s\S]*?height:\s*112rpx;[\s\S]*?border-radius:\s*50%;/
  );
  assert.match(
    customTabWxss,
    /\.center-image\s*\{[\s\S]*?width:\s*104rpx;[\s\S]*?height:\s*104rpx;/
  );
  assert.match(customTabWxss, /\.tab-item\.center \.tab-text\s*\{[\s\S]*?top:\s*96rpx;/);
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
});
