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

test('未登录访问首页会进入家客来登录入口，而非停留在旧访客首页', () => {
  const definition = loadHomePageDefinition();
  const originalWx = global.wx;
  const originalGetApp = global.getApp;
  const switchedTabs = [];

  global.getApp = () => ({ globalData: {} });
  global.wx = {
    getStorageSync: () => '',
    switchTab: ({ url }) => switchedTabs.push(url),
  };

  try {
    const page = createPage(definition);
    definition.onLoad.call(page);

    assert.deepEqual(switchedTabs, ['/pages/mine/mine']);
    assert.equal(page.data.redirectingToVisitorGateway, true);
  } finally {
    global.wx = originalWx;
    global.getApp = originalGetApp;
  }
});

test('Home uses the shared community-first identity for every recent-plan title', () => {
  const page = createPage(loadHomePageDefinition(), {
    homeDashboard: {
      bluetooth: {},
      stats: {},
      recentPlans: [{
        id: 'plan-1',
        name: '正式量房-20260805',
        customerName: '王女士',
        communityName: '江南壹号',
        display: {
          projectTitle: '江南壹号',
          projectSubtitle: '王女士 · 第 1 次量房',
        },
        status: 'draft',
        updatedAt: '2026-08-05T07:41:00.000Z',
      }],
    },
  });

  page.syncHomeDashboard();

  assert.equal(page.data.recentPlans[0].displayName, '江南壹号');
  assert.equal(page.data.recentPlans[0].measureSubtitle, '王女士 · 第 1 次量房');

  const homeWxml = fs.readFileSync(
    path.join(__dirname, '..', 'pages', 'index', 'index.wxml'),
    'utf8'
  );
  assert.match(homeWxml, /class="plan-title">\{\{recentPlans\[0\]\.displayName\}\}<\/text>/);
  assert.doesNotMatch(homeWxml, /class="plan-community"/);
});
