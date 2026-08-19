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
    if (args[0] === '/miniprogram/identity-contexts') {
      return { contexts: [{ mode: 'referrer' }, { mode: 'customer' }] };
    }
    if (args[0] === '/miniprogram/referrer-progress') {
      return {
        data: {
          enterpriseName: '宜家装饰工程有限公司',
          items: [
            {
              id: 'lead-1',
              customerLabel: '服务客户 #0001',
              stage: { key: 'design_published', label: '方案已发布', nextAction: '沟通确认' },
              updatedAt: new Date().toISOString(),
            },
          ],
        },
      };
    }
    if (args[0] === '/miniprogram/referrer-earnings') {
      return {
        data: {
          enterpriseName: '宜家装饰工程有限公司',
          items: [
            {
              id: 'earn-1',
              customerLabel: '服务客户 #0001',
              amount: '200.00',
              status: 'payable',
              createdAt: new Date().toISOString(),
            },
          ],
        },
      };
    }
    return { data: [
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
      ['/miniprogram/identity-contexts', 'GET'],
      ['/miniprogram/referrer-progress', 'GET'],
      ['/miniprogram/referrer-earnings', 'GET'],
    ]);
    assert.equal(context.data.identityCount, 2);
    assert.deepEqual(context.data.memberships.map((item) => item.id), ['active-1']);
    assert.equal(context.data.selectedMembershipId, 'active-1');
    assert.equal(context.data.totalClients, 1);
    assert.equal(context.data.todayScans, 1);
    assert.equal(context.data.pendingEarnings, '200.00');
    assert.equal(context.data.milestones.length, 1);
    assert.equal(context.data.milestones[0].customerLabel, '服务客户 #0001');
    assert.equal(context.data.milestones[0].rewardLabel, '预估 +¥200');
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

test('referrer workbench exchanges the signed membership context before changing enterprises', async () => {
  const definition = loadPage();
  const api = require('../utils/api.js');
  const originalRequest = api.request;
  const originalWx = global.wx;
  const originalGetApp = global.getApp;
  const requests = [];
  const app = {
    globalData: { token: 'old-token', userInfo: { id: 'user-1' }, bootstrap: { current: {} }, sessionHydrated: true },
    async hydrateStoredSession() { this.hydrated = true; }
  };
  api.request = async (...args) => {
    requests.push(args);
    if (args[0] === '/miniprogram/identity-contexts/switch') return { token: 'membership-token' };
    return { token: 'refreshed-token', user: { id: 'user-1' }, openid: 'openid-1' };
  };
  global.getApp = () => app;
  global.wx = { setStorageSync() {}, showToast() {} };
  const context = {
    data: {
      ...definition.data,
      selectedMembershipId: 'membership-1',
      memberships: [
        { id: 'membership-1', enterpriseId: 'enterprise-1' },
        { id: 'membership-2', enterpriseId: 'enterprise-2' }
      ]
    },
    setData(next) { Object.assign(this.data, next); }
  };

  try {
    await definition.selectMembership.call(context, { currentTarget: { dataset: { id: 'membership-2' } } });
    assert.deepEqual(requests[0], [
      '/miniprogram/identity-contexts/switch',
      'POST',
      { mode: 'referrer', enterpriseId: 'enterprise-2', referrerMembershipId: 'membership-2' }
    ]);
    assert.deepEqual(requests[1], ['/auth/miniprogram', 'POST', { type: 'refresh', token: 'membership-token' }]);
    assert.equal(context.data.selectedMembershipId, 'membership-2');
    assert.equal(app.hydrated, true);
  } finally {
    api.request = originalRequest;
    global.wx = originalWx;
    global.getApp = originalGetApp;
  }
});

test('referrer workbench ships the Antigravity standalone asset and preserves the Airy Minimalist 06 design contract', () => {
  const wxml = source('packages/business/referrer-workbench/referrer-workbench.wxml');
  const less = source('packages/business/referrer-workbench/referrer-workbench.less');
  const asset = fs.readFileSync(path.join(miniRoot, 'packages/business/assets/referrer-workbench-v1/service-code-guide.png'));

  assert.match(wxml, /推广专属服务 · 获客与收益/);
  assert.match(wxml, /出示推广服务码/);
  assert.match(wxml, /服务进度/);
  assert.match(wxml, /我的收益/);
  assert.match(wxml, /当前推广企业/);
  assert.match(wxml, /最新推广记录/);
  assert.match(wxml, /退出该企业/);
  assert.match(wxml, /账号操作/);
  assert.match(wxml, /切换身份/);
  assert.match(wxml, /wx:if="\{\{identityCount > 1\}\}"/);
  assert.match(wxml, /退出当前账号/);
  assert.match(wxml, /bindtap="onOpenIdentitySwitch"/);
  assert.match(wxml, /bindtap="onLogout"/);
  assert.match(wxml, /bindtap="openProgress"/);
  assert.match(wxml, /bindtap="openEarnings"/);
  assert.match(less, /account-common\.less/);
  assert.match(less, /overflow-y:\s*auto/);
  assert.match(less, /\.quick-nav-grid/);
  assert.match(less, /\.hero-promotion-card/);
  assert.match(less, /\.milestone-list/);
  assert.match(wxml, /referrer-workbench-v1\/service-code-guide\.png/);
  assert.match(wxml, /airy-v1\/leads-phone-3d\.png/);
  assert.match(wxml, /thumbs-up-xiao-k\.png/);
  assert.match(wxml, /navigationRight/);
  assert.deepEqual([...asset.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(asset.length <= 300 * 1024);
  assert.ok(asset.includes(Buffer.from('tRNS')) || [4, 6].includes(asset[25]));
});
