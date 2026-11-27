const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function loadHomePageDefinition() {
  let definition = null;
  global.Page = (config) => { definition = config; };
  const pagePath = require.resolve('../pages/index/index.js');
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

function showCustomerChat(page) {
  page.onXiaokEntryReady({ currentTarget: { dataset: { panel: 'customer' } } });
}

test('未登录访问首页时打开小K手账', () => {
  const definition = loadHomePageDefinition();
  const originalWx = global.wx;
  const originalGetApp = global.getApp;
  const switchedTabs = [];
  let tabBarSynced = false;

  global.getApp = () => ({ globalData: { aiEntriesEnabled: true } });
  global.wx = {
    getStorageSync: () => '',
    switchTab: ({ url }) => switchedTabs.push(url),
  };

  try {
    const page = createPage(definition);
    page.getTabBar = () => ({
      syncSelected() {
        tabBarSynced = true;
      },
    });
    definition.onLoad.call(page);

    assert.deepEqual(switchedTabs, []);
    assert.equal(page.data.roleWorkbenchRole, 'customer');
    assert.equal(page.data.customerTab, 'service');
    assert.equal(page.data.activateXiaokPanel, true);
    showCustomerChat(page);
    assert.equal(page.data.customerTab, 'xiaok');
    assert.equal(tabBarSynced, true);
  } finally {
    global.wx = originalWx;
    global.getApp = originalGetApp;
  }
});

test('Customer Site tab reuses the 我的 selected tab treatment', () => {
  const navigationDir = path.join(__dirname, '..', 'packages', 'assistant', 'navigation');
  const navWxml = fs.readFileSync(path.join(navigationDir, 'customer-navigation.wxml'), 'utf8');
  const navLess = fs.readFileSync(path.join(navigationDir, 'customer-navigation.less'), 'utf8');
  const sharedNav = fs.readFileSync(path.join(__dirname, '..', 'styles', 'notebook-tab-bar.less'), 'utf8');
  const homeLess = fs.readFileSync(path.join(__dirname, '..', 'pages', 'index', 'index.less'), 'utf8');

  // No per-tab pill or taller rounded bar for 工地; selected state matches 我的.
  assert.doesNotMatch(navWxml, /site-navigation/);
  assert.doesNotMatch(navLess, /\.site-navigation/);
  assert.match(navLess, /\.customer-navigation\s*\{\s*\.notebook-tab-bar\(\)/);
  assert.match(sharedNav, /\.active\s*\{[^}]*color:\s*#034b36;[^}]*font-weight:\s*600;/);
  assert.doesNotMatch(sharedNav, /\.active\s*\{[^}]*background/);

  // The Site page runs full height under the floating navigation.
  assert.match(homeLess, /\.owner-site-tab\s*\{[\s\S]*?height:\s*100vh;/);

  // Selected 工地 uses a filled active artwork like 小K and 我的.
  assert.match(navWxml, /notebook-tab-home\{\{selected === index \? '-active' : ''\}\}\.png/);
  const activeIcon = path.join(__dirname, '..', 'packages', 'assistant', 'assets', 'notebook-tab-home-active.png');
  assert.ok(fs.statSync(activeIcon).size > 0);
});

test('客户首页在登录态恢复后原地挂载小K', async (t) => {
  const page = createPage(loadHomePageDefinition());
  let finishHydration;
  const globalData = {
    aiEntriesEnabled: true,
    token: 'stored-token',
    sessionHydrationPromise: new Promise(resolve => { finishHydration = resolve; }),
  };
  const { getApp, getCurrentPages, wx } = global;
  t.after(() => Object.assign(global, { getApp, getCurrentPages, wx }));
  global.getApp = () => ({ globalData });
  global.getCurrentPages = () => [page];
  const launches = [];
  global.wx = { reLaunch: ({ url }) => launches.push(url) };

  page.onLoad();
  const shown = page.onShow();
  assert.equal(page.data.roleWorkbenchRole, '');
  const homeWxml = fs.readFileSync(path.join(__dirname, '..', 'pages', 'index', 'index.wxml'), 'utf8');
  assert.doesNotMatch(homeWxml, /airy-hero-card|选户型 · 免费设计整屋/);

  globalData.bootstrap = { current: { role: 'customer' } };
  globalData.sessionHydrationPromise = null;
  finishHydration();
  await shown;

  assert.equal(page.data.roleWorkbenchRole, 'customer');
  showCustomerChat(page);
  assert.equal(page.data.customerTab, 'xiaok');
  assert.deepEqual(launches, []);
});

test('登录态恢复未取得角色时回到小K入口', async (t) => {
  const page = createPage(loadHomePageDefinition());
  const globalData = { token: 'stored-token', aiEntriesEnabled: true };
  globalData.sessionHydrationPromise = Promise.resolve().then(() => {
    globalData.sessionHydrationPromise = null;
    globalData.sessionRecovery = { retryable: true, reason: 'bootstrap_unavailable' };
  });
  const { getApp, getCurrentPages } = global;
  t.after(() => Object.assign(global, { getApp, getCurrentPages }));
  global.getApp = () => ({ globalData });
  global.getCurrentPages = () => [page];

  page.onLoad();
  assert.equal(page.data.roleWorkbenchRole, '');
  await page.onShow();

  assert.equal(page.data.roleWorkbenchRole, 'customer');
  showCustomerChat(page);
  assert.equal(page.data.customerTab, 'xiaok');
});

test('家人链接进入指定工地且推广码进入小K', (t) => {
  const definition = loadHomePageDefinition();
  const globalData = { token: 'customer-token', userInfo: { role: 'user' }, aiEntriesEnabled: true };
  const { getApp } = global;
  t.after(() => { global.getApp = getApp; });
  global.getApp = () => ({ globalData });

  const family = createPage(definition);
  family.onLoad({ familyProject: '19' });
  assert.equal(family.data.roleWorkbenchRole, 'customer');
  assert.equal(family.data.customerTab, 'service');
  assert.equal(family.data.requestedFamilyProjectId, '19');

  const promotion = createPage(definition);
  const promotionCode = 'p'.repeat(32);
  promotion.onLoad({ promotionCode });
  showCustomerChat(promotion);
  assert.equal(promotion.data.roleWorkbenchRole, 'customer');
  assert.equal(promotion.data.customerTab, 'xiaok');
  assert.equal(promotion.data.promotionCode, promotionCode);
});
