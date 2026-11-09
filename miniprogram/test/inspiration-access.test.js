const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../utils/api');

async function withPage(app, run) {
  const original = { wx: global.wx, getApp: global.getApp, Page: global.Page, request: api.request };
  let definition;
  const routes = [], requests = [];
  global.getApp = () => app;
  global.wx = { showToast() {}, reLaunch: options => routes.push(options.url), switchTab: options => routes.push(options.url) };
  api.request = async url => { requests.push(url); return { success: true, data: [] }; };
  global.Page = value => { definition = value; };
  const file = require.resolve('../packages/business/inspiration/inspiration');
  delete require.cache[file];
  try {
    require(file);
    const page = { ...definition, data: { ...definition.data }, setData: patch => Object.assign(page.data, patch) };
    await run({ page, routes, requests });
  } finally {
    Object.assign(global, { wx: original.wx, getApp: original.getApp, Page: original.Page });
    api.request = original.request;
    delete require.cache[file];
  }
}

test('customer and referrer deep links leave the staff inspiration page without requesting an Admin-only resource', async () => {
  for (const identity of [{ role: 'customer', identityMode: 'customer' }, { role: 'referrer', identityMode: 'referrer', enterpriseId: '1' }]) {
    const app = { globalData: { token: 'signed-test-session', userInfo: identity } };
    await withPage(app, async ({ page, routes, requests }) => {
      await page.onLoad();
      assert.deepEqual(requests, []);
      assert.equal(routes.length, 1);
      assert.equal(app.globalData.token, 'signed-test-session');
    });
  }
});

test('the signed designer capability still reads the tenant inspiration list', async () => {
  await withPage({ globalData: { bootstrap: { current: { role: 'designer', capabilities: ['staff.design'] } } } }, async ({ page, routes, requests }) => {
    await page.onLoad();
    assert.deepEqual(requests, ['/inspirations?page=1']);
    assert.deepEqual(routes, []);
  });
});

test('cold launch waits for signed identity hydration before deciding inspiration access', async () => {
  let finish;
  const app = { globalData: { sessionHydrationPromise: new Promise(resolve => { finish = resolve; }) } };
  await withPage(app, async ({ page, requests }) => {
    const loading = page.onLoad();
    await Promise.resolve();
    assert.deepEqual(requests, []);
    app.globalData.bootstrap = { current: { role: 'designer', capabilities: ['staff.design'] } };
    finish();
    await loading;
    assert.deepEqual(requests, ['/inspirations?page=1']);
  });
});
