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

test('Home keeps customer and community together for every recent-plan title', () => {
  const page = createPage(loadHomePageDefinition(), {
    homeDashboard: {
      bluetooth: {},
      stats: {},
      recentPlans: [{
        id: 'plan-1',
        name: '正式量房-20260805',
        customerName: '王女士',
        communityName: '江南壹号',
        status: 'draft',
        updatedAt: '2026-08-05T07:41:00.000Z',
      }],
    },
  });

  page.syncHomeDashboard();

  assert.equal(page.data.recentPlans[0].displayName, '王女士 · 江南壹号');

  const homeWxml = fs.readFileSync(
    path.join(__dirname, '..', 'pages', 'index', 'index.wxml'),
    'utf8'
  );
  assert.match(homeWxml, /class="plan-title">\{\{recentPlans\[0\]\.displayName\}\}<\/text>/);
  assert.doesNotMatch(homeWxml, /class="plan-community"/);
});
