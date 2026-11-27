const assert = require('node:assert/strict');
const test = require('node:test');
const api = require('../utils/api');
const { openPromotionChat } = require('../utils/service-entry');

function loadDefinition(relativePath, register) {
  const path = require.resolve(relativePath);
  const original = global[register];
  let definition;
  try {
    global[register] = value => { definition = value; };
    delete require.cache[path];
    require(path);
    return definition;
  } finally {
    global[register] = original;
  }
}

test('foreground validation and component readiness both precede showing XiaoK', async t => {
  const app = loadDefinition('../app', 'App');
  const home = loadDefinition('../pages/index/index', 'Page');
  const tab = loadDefinition('../custom-tab-bar/index', 'Component');
  const page = { ...home, route: 'pages/index/index', getTabBar: () => bar };
  const bar = { ...tab.methods, data: { ...tab.data } };
  page.setData = (patch, callback) => { Object.assign(page.data, patch); callback?.call(page); };
  bar.setData = patch => Object.assign(bar.data, patch);
  const original = { getApp: global.getApp, getCurrentPages: global.getCurrentPages, wx: global.wx };
  t.after(() => Object.assign(global, original));
  global.getApp = () => app;
  global.getCurrentPages = () => [page];
  global.wx = { getStorageSync: () => '' };

  let enable = true;
  let requests = 0;
  let serviceGate = null;
  t.mock.method(api, 'request', async (path, method) => {
    assert.equal(path, '/miniprogram/ai-entries');
    assert.equal(method, 'GET');
    requests++;
    if (serviceGate) await serviceGate;
    if (enable === null) throw new Error('offline');
    return { success: true, data: { enabled: enable } };
  });

  page.onLoad();
  assert.equal(page.data.customerTab, 'service');
  assert.deepEqual(bar.data.list.map(item => item.key), ['service', 'mine']);
  app.onShow({ query: {} });
  const pending = app.globalData.aiEntriesRequest;
  assert.equal(app.refreshAiEntryVisibility(), pending);
  await pending;
  assert.equal(requests, 1);
  assert.equal(page.data.customerTab, 'service');
  assert.equal(page.data.activateXiaokPanel, true);
  assert.deepEqual(bar.data.list.map(item => item.key), ['service', 'mine']);
  page.onXiaokEntryReady({ currentTarget: { dataset: { panel: 'customer' } } });
  assert.equal(page.data.customerTab, 'xiaok');
  assert.deepEqual(bar.data.list.map(item => item.key), ['xiaok', 'service', 'mine']);

  app.onHide();
  assert.equal(page.data.mountXiaokPanel, true);
  assert.equal(page.data.activateXiaokPanel, false);
  assert.deepEqual(bar.data.list.map(item => item.key), ['service', 'mine']);
  let reply;
  serviceGate = new Promise(resolve => { reply = resolve; });
  const resume = app.refreshAiEntryVisibility();
  assert.equal(page.data.customerTab, 'service');
  assert.deepEqual(bar.data.list.map(item => item.key), ['service', 'mine']);
  enable = false;
  reply();
  await resume;
  serviceGate = null;
  assert.equal(page.data.mountXiaokPanel, false);
  assert.deepEqual(bar.data.list.map(item => item.key), ['service', 'mine']);

  for (const role of ['designer', 'enterprise_admin']) {
    app.globalData.token = 'signed-session';
    app.globalData.bootstrap = { current: { role, capabilities: ['construction.projects', 'account'] } };
    app.globalData.sessionHydrated = true;
    app.globalData.siteWorkbenchTab = 'xiaok';
    enable = true;
    await app.refreshAiEntryVisibility();
    page.syncHomeView();
    assert.equal(page.data.siteWorkbenchTab, 'workbench');
    page.onXiaokEntryReady({ currentTarget: { dataset: { panel: 'staff' } } });
    assert.equal(page.data.siteWorkbenchTab, 'xiaok');
    enable = false;
    app.onShow({ query: {} });
    assert.equal(page.data.siteWorkbenchTab, 'workbench');
    assert.deepEqual(bar.data.list.map(item => item.key), ['workbench', 'mine']);
    await app.globalData.aiEntriesRequest;
    assert.equal(page.data.siteWorkbenchTab, 'workbench');
    assert.deepEqual(bar.data.list.map(item => item.key), ['workbench', 'mine']);
  }

  enable = true;
  await app.refreshAiEntryVisibility();
  enable = null;
  await app.refreshAiEntryVisibility();
  assert.equal(app.globalData.aiEntriesEnabled, false);
  assert.equal(app.globalData.token, 'signed-session');
});

test('the embedded chat reports readiness after its first content render', t => {
  const definition = loadDefinition('../packages/assistant/chat/chat-panel', 'Component');
  assert.equal(definition.data.chatEntryVisible, true);
  assert.equal(loadDefinition('../packages/assistant/chat/chat', 'Page').data.chatEntryVisible, false);
  const original = global.wx;
  const ticks = [];
  t.after(() => { global.wx = original; });
  global.wx = { nextTick: callback => ticks.push(callback) };
  const events = [];
  const panel = { ...definition.methods, _attached: true, data: { loading: true, active: true },
    triggerEvent: event => events.push(event) };
  definition.lifetimes.ready.call(panel);
  assert.deepEqual(ticks, []);
  panel.data.loading = false;
  definition.observers.loading.call(panel);
  assert.deepEqual(events, []);
  ticks.shift()();
  assert.deepEqual(events, ['entryready']);
});

test('a distributed XiaoK promotion code retains its exact token when the entry is hidden', async t => {
  const original = { getApp: global.getApp, wx: global.wx };
  t.after(() => Object.assign(global, original));
  const state = { aiEntriesEnabled: false };
  const calls = [];
  global.getApp = () => ({ globalData: state });
  global.wx = {
    redirectTo: ({ url }) => calls.push(url),
    reLaunch: ({ url }) => calls.push(url),
  };
  const code = 'rp_' + 'p'.repeat(32);

  await openPromotionChat(code);
  assert.deepEqual(calls, [`/packages/business/free-design-service/free-design-service?token=${code}`]);

  state.aiEntriesEnabled = true;
  await openPromotionChat(code);
  assert.equal(calls.at(-1), `/pages/index/index?promotionCode=${code}`);
});
