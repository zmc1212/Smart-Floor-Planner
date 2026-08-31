const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const navigation = require('../utils/identity-navigation.js');

const loginSource = fs.readFileSync(
  path.join(__dirname, '..', 'packages', 'business', 'login', 'login.js'),
  'utf8'
);

test('role landing keeps referrers out of the generic home shell', () => {
  assert.equal(
    navigation.getRoleLanding({ mode: 'referrer' }),
    '/packages/business/referrer-workbench/referrer-workbench'
  );
  assert.equal(navigation.getRoleLanding({ role: 'staff' }), '/pages/index/index');
  assert.equal(navigation.getRoleLanding({ mode: 'customer' }), '/pages/index/index');
});

test('role landing navigation is idempotent and uses relaunch for subpackage routes', () => {
  const originalWx = global.wx;
  const originalPages = global.getCurrentPages;
  const calls = [];
  global.wx = {
    reLaunch(options) { calls.push(['reLaunch', options.url]); },
    switchTab(options) { calls.push(['switchTab', options.url]); }
  };
  global.getCurrentPages = () => [{ route: 'pages/index/index' }];

  try {
    assert.equal(navigation.navigateToRoleLanding({ mode: 'referrer' }), true);
    assert.deepEqual(calls, [['reLaunch', '/packages/business/referrer-workbench/referrer-workbench']]);
    calls.length = 0;
    global.getCurrentPages = () => [{ route: 'packages/business/referrer-workbench/referrer-workbench' }];
    assert.equal(navigation.navigateToRoleLanding({ mode: 'referrer' }), false);
    assert.deepEqual(calls, []);
  } finally {
    global.wx = originalWx;
    global.getCurrentPages = originalPages;
  }
});

test('login completion always enters the signed identity landing', () => {
  assert.match(
    loginSource,
    /finishLogin\(\)\s*\{\s*navigateToRoleLanding\(app\.globalData\.userInfo\);\s*\}/
  );
});

test('login does not bounce back to the enterprise open-account scan landing', () => {
  assert.match(loginSource, /shouldStayOnLoginPage/);
  assert.match(loginSource, /enterprise-register/);
  assert.match(loginSource, /options\.mode === 'password'/);
  assert.match(
    loginSource,
    /function shouldStayOnLoginPage\([\s\S]*mode === 'password'/
  );
  assert.match(
    loginSource,
    /onBack\(\) \{[\s\S]*enterprise-register[\s\S]*pages\/mine\/mine/
  );
});

test('scan landings leave only on sticky recents reopens', () => {
  const register = 'packages/business/enterprise-register/enterprise-register';
  const onboarding = 'packages/business/onboarding/onboarding';
  const claim = 'packages/business/free-design-service/free-design-service';
  const customer = { mode: 'customer' };
  const admin = { mode: 'staff', staffRole: 'enterprise_admin' };
  const designer = { mode: 'staff', staffRole: 'designer' };

  assert.equal(navigation.isScanLandingRoute(register), true);
  assert.equal(navigation.isScanLandingRoute(onboarding), true);
  assert.equal(navigation.isScanLandingRoute(claim), true);
  assert.equal(navigation.isScanLandingRoute('pages/index/index'), false);

  assert.equal(navigation.shouldLeaveScanLanding(register, customer, 1047), false);
  assert.equal(navigation.shouldLeaveScanLanding(register, customer, 1007), false);
  assert.equal(navigation.shouldLeaveScanLanding(register, customer, 1089), true);
  assert.equal(navigation.shouldLeaveScanLanding(register, admin, 1047), false);
  assert.equal(navigation.shouldLeaveScanLanding(register, admin, 1089), true);

  assert.equal(navigation.shouldLeaveScanLanding(onboarding, designer, 1047), false);
  assert.equal(navigation.shouldLeaveScanLanding(onboarding, designer, 1007), false);
  assert.equal(navigation.shouldLeaveScanLanding(onboarding, designer, 1089), true);
  assert.equal(navigation.shouldLeaveScanLanding(onboarding, null, 1089), false);

  assert.equal(navigation.shouldLeaveScanLanding(claim, customer, 1047), false);
  assert.equal(navigation.shouldLeaveScanLanding(claim, customer, 1089), true);
  assert.equal(navigation.shouldLeaveScanLanding(claim, designer, 1104), true);
});

test('currentEnterScene prefers live WeChat enter options over a stale launch scene', () => {
  const originalWx = global.wx;
  global.wx = {
    getEnterOptionsSync() { return { scene: 1047 }; }
  };
  try {
    assert.equal(navigation.currentEnterScene(1089), 1047);
  } finally {
    global.wx = originalWx;
  }
  assert.equal(navigation.currentEnterScene(1089), 1089);
});

test('leaveScanLanding uses role landing and falls back to Mine without clearing storage', () => {
  const originalWx = global.wx;
  const originalPages = global.getCurrentPages;
  const relaunched = [];
  const switched = [];
  const removed = [];
  global.getCurrentPages = () => [{
    route: 'packages/business/onboarding/onboarding'
  }];
  global.wx = {
    removeStorageSync(key) { removed.push(key); },
    reLaunch(options) { relaunched.push(options.url); },
    switchTab(options) { switched.push(options.url); }
  };
  try {
    assert.equal(navigation.leaveScanLanding({ mode: 'referrer' }), true);
    assert.deepEqual(relaunched, ['/packages/business/referrer-workbench/referrer-workbench']);
    assert.deepEqual(switched, []);
    assert.deepEqual(removed, []);

    relaunched.length = 0;
    assert.equal(navigation.leaveScanLanding(null), true);
    assert.deepEqual(relaunched, []);
    assert.deepEqual(switched, ['/pages/mine/mine']);
  } finally {
    global.wx = originalWx;
    global.getCurrentPages = originalPages;
  }
});

test('referrer guide deep links require the signed promotion capability', () => {
  const route = '/packages/guides/referrer-guide/referrer-guide';
  assert.equal(navigation.canAccessRoute(route, { mode: 'referrer' }), true);
  assert.equal(navigation.canAccessRoute(route, { mode: 'customer' }), false);
  assert.equal(navigation.canAccessRoute(route, {
    current: { role: 'referrer', capabilities: ['account'] }
  }), false);
  assert.equal(navigation.canAccessRoute(route, {
    current: { role: 'referrer', capabilities: ['referrer.promotion', 'account'] }
  }), true);
});

test('enterprise owner guide deep links require enterprise operations capability', () => {
  const route = '/packages/guides/enterprise-owner-guide/enterprise-owner-guide';
  assert.equal(navigation.canAccessRoute(route, { role: 'enterprise_admin' }), true);
  assert.equal(navigation.canAccessRoute(route, { mode: 'customer' }), false);
  assert.equal(navigation.canAccessRoute(route, {
    current: { role: 'enterprise_admin', capabilities: ['account'] }
  }), false);
});

test('enterprise owner customer capability can enter the formal surveying editor', () => {
  const route = '/packages/surveying/editor/surveying-editor';
  assert.equal(navigation.canAccessRoute(route, {
    mode: 'staff',
    staffRole: 'enterprise_admin'
  }), true);
  assert.equal(navigation.canAccessRoute(route, {
    current: { role: 'enterprise_admin', capabilities: ['enterprise.customers', 'account'] }
  }), true);
  assert.equal(navigation.canAccessRoute(route, {
    mode: 'staff',
    staffRole: 'designer'
  }), true);
  assert.equal(navigation.canAccessRoute(route, {
    current: { role: 'designer', capabilities: ['staff.leads', 'account'] }
  }), true);
  assert.equal(navigation.canAccessRoute(route, { mode: 'customer' }), false);
});

test('designer and measurer guide deep links require the signed workbench capability', () => {
  assert.equal(navigation.canAccessRoute('/packages/guides/designer-guide/designer-guide', {
    mode: 'staff',
    staffRole: 'designer'
  }), true);
  assert.equal(navigation.canAccessRoute('/packages/guides/designer-guide/designer-guide', {
    mode: 'customer'
  }), false);
  assert.equal(navigation.canAccessRoute('/packages/guides/designer-guide/designer-guide', {
    current: { role: 'designer', capabilities: ['account'] }
  }), false);
  assert.equal(navigation.canAccessRoute('/packages/guides/designer-guide/designer-guide', {
    current: {
      role: 'customer',
      capabilities: ['customer.service', 'customer.projects', 'account']
    },
    roles: [{ role: 'designer', capabilities: ['staff.leads', 'account'] }]
  }), true);
  assert.equal(navigation.canAccessRoute('/packages/guides/designer-guide/designer-guide', {
    current: {
      role: 'customer',
      capabilities: ['customer.service', 'customer.projects', 'account']
    },
    roles: [{ role: 'customer', capabilities: ['customer.service', 'account'] }]
  }), false);
  assert.equal(navigation.canAccessRoute('/packages/business/staff-earnings/staff-earnings', {
    current: {
      role: 'customer',
      capabilities: ['customer.service', 'customer.projects', 'account']
    },
    roles: [{ role: 'designer', capabilities: ['staff.leads', 'staff.earnings', 'account'] }]
  }), false);
  assert.equal(navigation.canAccessRoute('/packages/guides/measurer-guide/measurer-guide', {
    mode: 'staff',
    staffRole: 'measurer'
  }), true);
  assert.equal(navigation.canAccessRoute('/packages/guides/measurer-guide/measurer-guide', {
    current: { role: 'measurer', capabilities: ['account'] }
  }), false);
});
