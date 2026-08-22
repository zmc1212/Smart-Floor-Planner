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
      ['/miniprogram/referrer-progress', 'GET'],
      ['/miniprogram/referrer-earnings', 'GET'],
    ]);
    assert.deepEqual(context.data.memberships.map((item) => item.id), ['active-1']);
    assert.equal(context.data.selectedMembershipId, 'active-1');
    assert.equal(context.data.totalClients, 1);
    assert.equal(context.data.todayScans, 1);
    assert.equal(context.data.pendingCount, 1);
    assert.equal(context.data.milestones.length, 1);
    assert.equal(context.data.milestones[0].customerLabel, '服务客户 #0001');
    assert.equal(context.data.milestones[0].rewardLabel, '待发放');
    definition.showServiceCode.call(context);
    assert.equal(global.wx.lastNavigation.url, '/packages/business/promotion-service-code/promotion-service-code?membershipId=active-1');
  } finally {
    api.request = originalRequest;
    global.wx = originalWx;
  }
});

test('referrer workbench leaves identity switching and logout on the Mine tab', () => {
  const wxml = source('packages/business/referrer-workbench/referrer-workbench.wxml');
  const js = source('packages/business/referrer-workbench/referrer-workbench.js');
  const mineWxml = source('pages/mine/mine.wxml');
  assert.match(wxml, /退出该企业/);
  assert.doesNotMatch(wxml, /账号操作/);
  assert.doesNotMatch(wxml, /切换身份/);
  assert.doesNotMatch(wxml, /退出当前账号/);
  assert.doesNotMatch(wxml, /onOpenIdentitySwitch/);
  assert.doesNotMatch(wxml, /onLogout/);
  assert.doesNotMatch(js, /onOpenIdentitySwitch/);
  assert.doesNotMatch(js, /confirmLogout/);
  assert.match(mineWxml, /当前身份/);
  assert.match(mineWxml, /在客户、员工和推荐人身份之间切换/);
  assert.match(mineWxml, /bindtap="onOpenIdentitySwitch"/);
  assert.match(mineWxml, /退出当前账号/);
});

test('referrer workbench scans an onboarding code before opening the add-enterprise flow', () => {
  const definition = loadPage();
  const originalWx = global.wx;
  let scanOptions;
  let navigation;
  const toasts = [];
  global.wx = {
    scanCode(options) { scanOptions = options; },
    navigateTo(options) { navigation = options; },
    showToast(options) { toasts.push(options); }
  };

  try {
    definition.onAddEnterprise();
    assert.equal(scanOptions.onlyFromCamera, false);
    assert.deepEqual(scanOptions.scanType, ['qrCode']);

    scanOptions.success({ path: 'packages/business/onboarding/onboarding?scene=ABC' });
    assert.equal(navigation.url, '/packages/business/onboarding/onboarding?scene=ABC');

    navigation = null;
    scanOptions.success({ path: 'pages/index/index' });
    assert.equal(navigation, null);
    assert.match(toasts.at(-1).title, /企业提供的入驻码/);

    scanOptions.success({ path: 'packages/business/onboarding/onboarding?foo=bar' });
    assert.equal(navigation, null);
    assert.match(toasts.at(-1).title, /企业提供的入驻码/);

    scanOptions.fail({ errMsg: 'scanCode:fail unavailable' });
    assert.match(toasts.at(-1).title, /扫码失败/);
  } finally {
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

test('leaving the last promotion enterprise hydrates the remaining identity and opens its workbench', async () => {
  const definition = loadPage();
  const api = require('../utils/api.js');
  const originalRequest = api.request;
  const originalWx = global.wx;
  const originalGetApp = global.getApp;
  const originalPages = global.getCurrentPages;
  const navigations = [];
  let modalOptions;
  const app = {
    globalData: {
      token: 'old-token',
      userInfo: { mode: 'referrer' },
      bootstrap: { current: { role: 'referrer', mode: 'referrer' } },
      sessionHydrated: true,
      sessionRecovery: null
    },
    async hydrateStoredSession() {
      this.globalData.token = 'designer-token';
      this.globalData.userInfo = { mode: 'staff', staffRole: 'designer' };
      this.globalData.bootstrap = {
        current: {
          role: 'designer',
          mode: 'staff',
          staffRole: 'designer',
          landingPath: '/pages/index/index'
        }
      };
      this.globalData.sessionHydrated = true;
      this.hydrated = true;
    }
  };
  api.request = async (...args) => {
    if (String(args[0]).includes('/miniprogram/referrer-memberships/membership-1')) {
      return {
        token: 'designer-token',
        context: { mode: 'staff', staffRole: 'designer', staffId: '17' }
      };
    }
    return { data: [] };
  };
  global.getApp = () => app;
  global.getCurrentPages = () => [{ route: 'packages/business/referrer-workbench/referrer-workbench' }];
  global.wx = {
    setStorageSync() {},
    showToast() {},
    showModal(options) { modalOptions = options; },
    reLaunch(options) { navigations.push(['reLaunch', options.url]); },
    switchTab(options) { navigations.push(['switchTab', options.url]); }
  };
  const context = {
    data: {
      ...definition.data,
      selectedMembershipId: 'membership-1',
      memberships: [{ id: 'membership-1', enterpriseId: 'enterprise-1', enterpriseName: '微云' }]
    },
    setData(next) { Object.assign(this.data, next); },
    loadCalls: 0,
    async load() { this.loadCalls += 1; }
  };

  try {
    definition.leaveSelectedEnterprise.call(context);
    await modalOptions.success({ confirm: true });
    assert.equal(app.hydrated, true);
    assert.equal(app.globalData.token, 'designer-token');
    assert.deepEqual(navigations, [['reLaunch', '/pages/index/index']]);
    assert.equal(context.loadCalls, 0);
  } finally {
    api.request = originalRequest;
    global.wx = originalWx;
    global.getApp = originalGetApp;
    global.getCurrentPages = originalPages;
  }
});

test('leaving one of several promotion enterprises stays on the referrer workbench', async () => {
  const definition = loadPage();
  const api = require('../utils/api.js');
  const originalRequest = api.request;
  const originalWx = global.wx;
  const originalGetApp = global.getApp;
  const originalPages = global.getCurrentPages;
  const navigations = [];
  let modalOptions;
  const app = {
    globalData: {
      token: 'old-token',
      userInfo: { mode: 'referrer' },
      bootstrap: { current: { role: 'referrer', mode: 'referrer' } },
      sessionHydrated: true,
      sessionRecovery: null
    },
    async hydrateStoredSession() {
      this.globalData.token = 'referrer-token';
      this.globalData.userInfo = { mode: 'referrer' };
      this.globalData.bootstrap = {
        current: {
          role: 'referrer',
          mode: 'referrer',
          landingPath: '/packages/business/referrer-workbench/referrer-workbench'
        }
      };
      this.globalData.sessionHydrated = true;
      this.hydrated = true;
    }
  };
  api.request = async () => ({
    token: 'referrer-token',
    context: { mode: 'referrer', referrerMembershipId: 'membership-2' }
  });
  global.getApp = () => app;
  global.getCurrentPages = () => [{ route: 'packages/business/referrer-workbench/referrer-workbench' }];
  global.wx = {
    setStorageSync() {},
    showToast() {},
    showModal(options) { modalOptions = options; },
    reLaunch(options) { navigations.push(['reLaunch', options.url]); },
    switchTab(options) { navigations.push(['switchTab', options.url]); }
  };
  const context = {
    data: {
      ...definition.data,
      selectedMembershipId: 'membership-1',
      memberships: [
        { id: 'membership-1', enterpriseId: 'enterprise-1' },
        { id: 'membership-2', enterpriseId: 'enterprise-2' }
      ]
    },
    setData(next) { Object.assign(this.data, next); },
    loadCalls: 0,
    async load() { this.loadCalls += 1; }
  };

  try {
    definition.leaveSelectedEnterprise.call(context);
    await modalOptions.success({ confirm: true });
    assert.equal(app.hydrated, true);
    assert.deepEqual(navigations, []);
    assert.equal(context.loadCalls, 1);
  } finally {
    api.request = originalRequest;
    global.wx = originalWx;
    global.getApp = originalGetApp;
    global.getCurrentPages = originalPages;
  }
});

test('referrer workbench ships the Antigravity standalone asset and preserves the Airy Minimalist 06 design contract', () => {
  const wxml = source('packages/business/referrer-workbench/referrer-workbench.wxml');
  const less = source('packages/business/referrer-workbench/referrer-workbench.less');
  const js = source('packages/business/referrer-workbench/referrer-workbench.js');
  const asset = fs.readFileSync(path.join(miniRoot, 'packages/business/assets/referrer-workbench-v1/service-code-guide.png'));

  assert.match(wxml, /推广专属服务 · 获客与收益/);
  assert.match(wxml, /家客来 · 推广端/);
  assert.doesNotMatch(wxml, /nav-actions/);
  assert.doesNotMatch(wxml, /nav-scan-icon/);
  assert.doesNotMatch(wxml, /nav-bell-icon/);
  assert.match(wxml, /出示推广服务码/);
  assert.match(wxml, /服务进度/);
  assert.match(wxml, /我的收益/);
  assert.match(wxml, /当前推广企业/);
  assert.match(wxml, /最新推广记录/);
  assert.match(wxml, /退出该企业/);
  assert.doesNotMatch(wxml, /账号操作/);
  assert.doesNotMatch(wxml, /切换身份/);
  assert.doesNotMatch(wxml, /退出当前账号/);
  assert.match(wxml, /bindtap="openProgress"/);
  assert.match(wxml, /bindtap="openEarnings"/);
  assert.match(wxml, /cta-inner/);
  assert.match(less, /\.hero-cta-btn\s*\{[\s\S]*white-space:\s*nowrap/);
  assert.match(less, /\.cta-btn-text\s*\{[\s\S]*white-space:\s*nowrap/);
  assert.doesNotMatch(less, /account-common\.less/);
  assert.match(less, /overflow-y:\s*auto/);
  assert.match(less, /\.quick-nav-grid/);
  assert.match(less, /\.hero-promotion-card/);
  assert.match(less, /\.milestone-list/);
  assert.doesNotMatch(less, /\.enterprise-pill:nth-child/);
  assert.match(less, /\.enterprise-pill\s*\{[^}]*flex-shrink:\s*0/s);
  assert.match(less, /\.enterprise-pill\s*\{[^}]*font-size:\s*24rpx/s);
  assert.match(less, /\.quick-card-title\s*\{[^}]*font-size:\s*28rpx/s);
  assert.match(less, /\.benefit-desc\s*\{[^}]*font-size:\s*22rpx/s);
  assert.match(js, /wx\.scanCode\(/);
  assert.match(js, /企业提供的入驻码/);
  assert.match(wxml, /referrer-workbench-v1\/service-code-guide\.png/);
  assert.match(wxml, /airy-v1\/leads-phone-3d\.png/);
  assert.match(wxml, /thumbs-up-xiao-k\.png/);
  assert.match(wxml, /navigationRight/);
  assert.deepEqual([...asset.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(asset.length <= 300 * 1024);
  assert.ok(asset.includes(Buffer.from('tRNS')) || [4, 6].includes(asset[25]));
});
