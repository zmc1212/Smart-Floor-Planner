const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const api = require('../utils/api.js');

const miniRoot = path.resolve(__dirname, '..');

function source(relativePath) {
  return fs.readFileSync(path.join(miniRoot, relativePath), 'utf8');
}

function loadPage() {
  const pagePath = require.resolve('../packages/business/onboarding/onboarding.js');
  const originalPage = global.Page;
  let definition;
  global.Page = (next) => { definition = next; };
  delete require.cache[pagePath];
  require(pagePath);
  global.Page = originalPage;
  return definition;
}

test('onboarding page resolves an enterprise code before collecting a phone authorization', () => {
  const appConfig = JSON.parse(source('app.json'));
  const businessPackage = appConfig.subPackages.find((item) => item.root === 'packages/business');
  const wxml = source('packages/business/onboarding/onboarding.wxml');
  const js = source('packages/business/onboarding/onboarding.js');
  const less = source('packages/business/onboarding/onboarding.less');

  assert.ok(businessPackage.pages.includes('onboarding/onboarding'));
  assert.ok(businessPackage.pages.includes('onboarding-debug/onboarding-debug'));
  assert.match(wxml, /open-type="getPhoneNumber"/);
  assert.match(wxml, /欢迎加入服务团队/);
  assert.match(wxml, /选择你的服务身份/);
  assert.match(wxml, /xiao-k-onboarding-welcome\.png/);
  assert.match(wxml, /xiao-k-onboarding-recovery\.png/);
  assert.match(wxml, /home-ip-v1\/brand-logo\.png/);
  assert.match(wxml, /当前邀请暂不可用/);
  assert.match(wxml, /扫描新邀请/);
  assert.match(wxml, /切换可用身份/);
  assert.match(wxml, /mine-icons\/scan\.png/);
  assert.match(wxml, /mine-icons\/users\.png/);
  assert.match(js, /\/miniprogram\/codes\/resolve/);
  assert.match(js, /\/miniprogram\/onboarding\/staff/);
  assert.match(js, /\/miniprogram\/onboarding\/referrer/);
  assert.doesNotMatch(js, /offerNotificationAuthorization/);
  assert.doesNotMatch(js, /resolveOnboardingSubscribeRole/);
  assert.match(js, /`ej_\$\{decoded\}`/);
  assert.match(js, /enterpriseName/);
  assert.match(wxml, /将加入：/);
  assert.match(wxml, /\{\{enterpriseName\}\}/);
  assert.match(wxml, /设置推荐人姓名/);
  assert.match(js, /displayName/);
  assert.match(js, /onConfirmReferrerName/);
  assert.doesNotMatch(js, /debugOnboarding/);
  assert.match(js, /code_rotated/);
  assert.match(js, /pageState:\s*'recovery'/);
  assert.match(js, /onScanNewInvite/);
  assert.match(js, /onOpenIdentitySwitch/);
  assert.match(js, /leaveScanLanding/);
  assert.match(wxml, /bindtap="onBack"/);
  assert.match(wxml, /class="nav-back"/);
  assert.match(wxml, /class="back-chevron"/);
  assert.match(less, /\.nav-back/);
  assert.match(less, /\.back-chevron/);
  assert.match(wxml, /navigationRight/);
  assert.match(wxml, /join-inner/);
  assert.match(less, /\.join-inner\s*\{[\s\S]*white-space:\s*nowrap/);
  assert.match(less, /\.join-action,\s*\.state-action\s*\{[\s\S]*width:\s*auto/);
  assert.match(less, /\.join-action,\s*\.state-action\s*\{[\s\S]*min-width:\s*100%/);
  assert.match(less, /\.join-action,\s*\.state-action\s*\{[\s\S]*white-space:\s*nowrap/);
  assert.match(less, /safe-area-inset-bottom/);
  assert.doesNotMatch(less, /font-size:\s*(?:1[0-9]|[0-9])rpx/);
  assert.doesNotMatch(less, /transform:\s*scale\(/);
});

test('onboarding code resolution records the resolved enterprise name before phone authorization', async () => {
  const definition = loadPage();
  const originalRequest = api.request;
  api.request = async () => ({
    data: { kind: 'onboarding', codeType: 'referrer', enterpriseName: '嘉客来装饰' }
  });
  try {
    const context = {
      data: { ...definition.data, onboardingToken: 'ej_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456' },
      setData(next) { Object.assign(this.data, next); }
    };
    await definition.resolveOnboardingCode.call(context);
    assert.equal(context.data.pageState, 'ready');
    assert.equal(context.data.enterpriseName, '嘉客来装饰');
  } finally {
    api.request = originalRequest;
  }
});

test('onboarding role selection is limited to supported staff roles', () => {
  const definition = loadPage();
  const context = {
    data: { ...definition.data },
    setData(next) { Object.assign(this.data, next); }
  };

  definition.onChooseStaffRole.call(context, { currentTarget: { dataset: { role: 'measurer' } } });
  assert.equal(context.data.selectedStaffRole, 'measurer');
  definition.onChooseStaffRole.call(context, { currentTarget: { dataset: { role: 'enterprise_admin' } } });
  assert.equal(context.data.selectedStaffRole, 'measurer');
});

test('staff success CTA relaunches the designer workbench without subscribe prompts', () => {
  const definition = loadPage();
  const originalGetApp = global.getApp;
  const originalWx = global.wx;
  const launches = [];
  const toasts = [];
  const modals = [];
  global.getApp = () => ({ globalData: { userInfo: null, bootstrap: null } });
  global.wx = {
    ...(originalWx || {}),
    showToast: (options) => { toasts.push(options); },
    showModal: (options) => { modals.push(options); options.success({ confirm: false }); },
    reLaunch: (options) => { launches.push(options); }
  };
  try {
    const context = {
      data: { codeType: 'staff', selectedStaffRole: 'designer' },
      enterWorkbench: definition.enterWorkbench
    };
    definition.onContinue.call(context);
    assert.equal(modals.length, 0);
    assert.equal(launches[0].url, '/pages/index/index');
    assert.equal(toasts.length, 0);

    const invalid = {
      data: { codeType: 'staff', selectedStaffRole: 'salesperson' },
      enterWorkbench: definition.enterWorkbench
    };
    definition.onContinue.call(invalid);
    assert.equal(launches.length, 1);
    assert.match(toasts[0].title, /暂时无法进入工作台/);
  } finally {
    global.getApp = originalGetApp;
    global.wx = originalWx;
  }
});

test('referrer success CTA enters the workbench without subscribe prompts', async () => {
  const definition = loadPage();
  const originalGetApp = global.getApp;
  const originalWx = global.wx;
  const launches = [];
  let modalCalled = false;
  global.getApp = () => ({
    globalData: {
      userInfo: { mode: 'referrer' },
      bootstrap: { current: { mode: 'referrer', landingPath: '/packages/business/referrer-workbench/referrer-workbench' } }
    }
  });
  global.wx = {
    ...(originalWx || {}),
    showToast() {},
    showModal(options) {
      modalCalled = true;
      options.success({ confirm: false });
    },
    requestSubscribeMessage(options) {
      options.success({});
    },
    reLaunch: (options) => { launches.push(options); }
  };
  try {
    const context = {
      data: { codeType: 'referrer' },
      enterWorkbench: definition.enterWorkbench
    };
    await definition.onContinue.call(context);
    assert.equal(modalCalled, false);
    assert.match(launches[0].url, /referrer-workbench/);
  } finally {
    global.getApp = originalGetApp;
    global.wx = originalWx;
  }
});

test('staff success CTA prefers hydrated bootstrap landingPath', () => {
  const definition = loadPage();
  const originalGetApp = global.getApp;
  const originalWx = global.wx;
  const launches = [];
  global.getApp = () => ({
    globalData: {
      userInfo: { mode: 'staff', staffRole: 'designer' },
      bootstrap: { current: { mode: 'staff', staffRole: 'designer', landingPath: '/pages/index/index' } }
    }
  });
  global.wx = {
    ...(originalWx || {}),
    showToast() {},
    showModal: (options) => { options.success({ confirm: false }); },
    reLaunch: (options) => { launches.push(options); }
  };
  try {
    const context = {
      data: { codeType: 'staff', selectedStaffRole: 'measurer' },
      enterWorkbench: definition.enterWorkbench
    };
    definition.onContinue.call(context);
    assert.equal(launches[0].url, '/pages/index/index');
  } finally {
    global.getApp = originalGetApp;
    global.wx = originalWx;
  }
});

test('referrer onboarding opens a name sheet after phone authorization and submits displayName', async () => {
  const definition = loadPage();
  const originalRequest = api.request;
  const originalPhoneLogin = api.phoneLogin;
  const originalGetApp = global.getApp;
  const originalWx = global.wx;
  const calls = [];
  const toasts = [];
  global.wx = {
    ...(originalWx || {}),
    showToast: (options) => { toasts.push(options); },
    setStorageSync() {},
    getWindowInfo: () => ({ windowWidth: 390, statusBarHeight: 24 }),
    getMenuButtonBoundingClientRect: () => ({ left: 296, top: 24, height: 32 })
  };
  global.getApp = () => ({
    globalData: { sessionRecovery: null },
    hydrateStoredSession: async () => {}
  });
  api.phoneLogin = async () => ({ success: true, token: 'phone', user: { nickname: '微信用户' } });
  api.request = async (path, _method, body) => {
    calls.push({ path, body });
    if (path === '/miniprogram/onboarding/referrer') return { token: 'onboard-jwt' };
    if (path === '/auth/miniprogram') return { user: { nickname: '王推荐' }, openid: 'o1' };
    throw new Error(path);
  };
  try {
    const context = {
      data: {
        ...definition.data,
        pageState: 'ready',
        codeType: 'referrer',
        onboardingToken: 'ej_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456'
      },
      setData(next) { Object.assign(this.data, next); },
      submitOnboarding: definition.submitOnboarding,
      persistOnboardingSession: definition.persistOnboardingSession
    };

    await definition.onGetPhoneNumber.call(context, {
      detail: { errMsg: 'getPhoneNumber:ok', code: 'phone-code' }
    });
    assert.equal(context.data.pageState, 'name');
    assert.equal(context.data.nameSheetVisible, true);
    assert.equal(context.data.displayName, '');
    assert.equal(calls.length, 0);

    await definition.onConfirmReferrerName.call(context);
    assert.equal(toasts[0].title, '请填写真实姓名');
    assert.equal(calls.length, 0);

    context.data.displayName = '王推荐';
    await definition.onConfirmReferrerName.call(context);
    assert.equal(calls[0].path, '/miniprogram/onboarding/referrer');
    assert.equal(calls[0].body.displayName, '王推荐');
    assert.equal(context.data.pageState, 'success');
    assert.equal(context.data.nameSheetVisible, false);
  } finally {
    api.request = originalRequest;
    api.phoneLogin = originalPhoneLogin;
    global.getApp = originalGetApp;
    global.wx = originalWx;
  }
});
