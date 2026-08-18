const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const miniRoot = path.resolve(__dirname, '..');

function source(relativePath) {
  return fs.readFileSync(path.join(miniRoot, relativePath), 'utf8');
}

function loadPage() {
  const pagePath = require.resolve('../packages/business/referrer-workbench/referrer-workbench.js');
  const originalPage = global.Page;
  let definition;
  global.Page = (next) => { definition = next; };
  delete require.cache[pagePath];
  require(pagePath);
  global.Page = originalPage;
  return definition;
}

test('referrer workbench lists active memberships and opens the selected service-code screen', async () => {
  const definition = loadPage();
  const api = require('../utils/api.js');
  const originalRequest = api.request;
  const originalWx = global.wx;
  const requests = [];
  api.request = async (...args) => {
    requests.push(args);
    return args[0] === '/miniprogram/identity-contexts'
      ? { contexts: [{ mode: 'referrer' }, { mode: 'customer' }] }
      : { data: [
        { id: 'active-1', status: 'active', enterpriseName: '宜家装饰工程有限公司' },
        { id: 'left-1', status: 'exited', enterpriseName: '历史企业' },
      ] };
  };
  global.wx = { navigateTo(options) { this.lastNavigation = options; } };
  const context = { data: { ...definition.data }, setData(next) { Object.assign(this.data, next); } };

  try {
    await definition.load.call(context);
    assert.deepEqual(requests, [
      ['/miniprogram/referrer-memberships', 'GET'],
      ['/miniprogram/identity-contexts', 'GET']
    ]);
    assert.equal(context.data.identityCount, 2);
    assert.deepEqual(context.data.memberships.map((item) => item.id), ['active-1']);
    assert.equal(context.data.selectedMembershipId, 'active-1');
    definition.showServiceCode.call(context);
    assert.equal(global.wx.lastNavigation.url, '/packages/business/promotion-service-code/promotion-service-code?membershipId=active-1');
  } finally {
    api.request = originalRequest;
    global.wx = originalWx;
  }
});

test('referrer workbench keeps identity switching and logout reachable from the role landing', () => {
  const definition = loadPage();
  const session = require('../utils/session.js');
  const originalConfirmLogout = session.confirmLogout;
  const originalWx = global.wx;
  const calls = [];
  global.wx = {
    navigateTo(options) { calls.push(['navigateTo', options.url]); }
  };
  session.confirmLogout = () => { calls.push(['logout']); };
  try {
    definition.onOpenIdentitySwitch();
    definition.onLogout();
    assert.deepEqual(calls, [
      ['navigateTo', '/packages/business/identity-switch/identity-switch'],
      ['logout']
    ]);
  } finally {
    session.confirmLogout = originalConfirmLogout;
    global.wx = originalWx;
  }
});

test('referrer workbench ships the Antigravity standalone asset and preserves the selected design contract', () => {
  const wxml = source('packages/business/referrer-workbench/referrer-workbench.wxml');
  const wxss = source('packages/business/referrer-workbench/referrer-workbench.wxss');
  const asset = fs.readFileSync(path.join(miniRoot, 'packages/business/assets/referrer-workbench-v1/service-code-guide.png'));

  assert.match(wxml, /推广服务/);
  assert.match(wxml, /展示服务码/);
  assert.match(wxml, /退出该企业/);
  assert.match(wxml, /账号操作/);
  assert.match(wxml, /切换身份/);
  assert.match(wxml, /wx:if="\{\{identityCount > 1\}\}"/);
  assert.match(wxml, /退出当前账号/);
  assert.match(wxml, /bindtap="onOpenIdentitySwitch"/);
  assert.match(wxml, /bindtap="onLogout"/);
  assert.match(wxss, /account-common\.wxss/);
  assert.match(wxss, /overflow-y:\s*auto/);
  assert.match(wxml, /referrer-workbench-v1\/service-code-guide\.png/);
  assert.match(wxml, /navigationRight/);
  assert.deepEqual([...asset.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(asset.length <= 300 * 1024);
  assert.ok(asset.includes(Buffer.from('tRNS')) || [4, 6].includes(asset[25]));
});
