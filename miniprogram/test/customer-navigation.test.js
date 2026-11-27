const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function loadNavigationDefinition() {
  let definition = null;
  global.Component = (config) => { definition = config; };
  const modulePath = require.resolve('../packages/assistant/navigation/customer-navigation.js');
  delete require.cache[modulePath];
  require(modulePath);
  delete global.Component;
  return definition;
}

function createInstance(definition, list) {
  return {
    ...definition.methods,
    data: { ...definition.data, items: list },
    setData(update) {
      Object.assign(this.data, update);
    },
  };
}

const CUSTOMER_ITEMS = [
  { key: 'xiaok', pagePath: '/pages/index/index', customerView: 'xiaok', text: '小K' },
  { key: 'service', pagePath: '/pages/index/index', customerView: 'service', text: '工地' },
  { key: 'mine', pagePath: '/pages/mine/mine', text: '我的' },
];

function syncWith({ route, view }) {
  const definition = loadNavigationDefinition();
  const instance = createInstance(definition, CUSTOMER_ITEMS);
  const previousGetApp = global.getApp;
  const previousGetPages = global.getCurrentPages;
  const previousWx = global.wx;
  global.getApp = () => ({ globalData: { customerTab: view, token: '', aiEntriesEnabled: true } });
  global.getCurrentPages = () => [{ route, getTabBar: () => ({ data: { list: CUSTOMER_ITEMS } }) }];
  global.wx = { getStorageSync: () => '' };
  try {
    instance.syncSelected();
    return instance.data;
  } finally {
    global.getApp = previousGetApp;
    global.getCurrentPages = previousGetPages;
    global.wx = previousWx;
  }
}

test('工地 and 我的 share the floating customer navigation; 小K stays docked', () => {
  const service = syncWith({ route: 'pages/index/index', view: 'service' });
  assert.equal(service.selected, 1);
  assert.equal(service.floating, true);
  assert.equal(syncWith({ route: 'pages/mine/mine', view: 'mine' }).floating, true);
  assert.equal(syncWith({ route: 'pages/index/index', view: 'xiaok' }).floating, false);
});

test('the Site page runs full height and clears the floating navigation', () => {
  const homeLess = fs.readFileSync(path.join(__dirname, '..', 'pages', 'index', 'index.less'), 'utf8');
  const siteLess = fs.readFileSync(path.join(__dirname, '..', 'packages', 'construction', 'owner-home', 'owner-home.less'), 'utf8');

  assert.match(homeLess, /\.owner-site-tab\s*\{[\s\S]*?height:\s*100vh;/);
  assert.match(siteLess, /\.site-content\s*\{[^}]*padding:[^;]*calc\(128rpx \+ env\(safe-area-inset-bottom\) \+ 18px\)/);
});
