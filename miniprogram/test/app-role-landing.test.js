const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function loadAppDefinition() {
  const appPath = path.join(__dirname, '..', 'app.js');
  const previousApp = global.App;
  let definition = null;
  global.App = (value) => { definition = value; };
  delete require.cache[require.resolve(appPath)];
  require(appPath);
  global.App = previousApp;
  return definition;
}

test('role landing retries until the root page is available after session hydration', () => {
  const definition = loadAppDefinition();
  const previousWx = global.wx;
  const previousPages = global.getCurrentPages;
  const previousSetTimeout = global.setTimeout;
  const calls = [];
  let pageReads = 0;
  global.wx = {
    reLaunch(options) { calls.push(options.url); },
    switchTab() {},
  };
  global.getCurrentPages = () => {
    pageReads += 1;
    return pageReads === 1 ? [] : [{ route: 'pages/index/index' }];
  };
  global.setTimeout = (callback) => {
    callback();
    return 1;
  };
  const app = {
    globalData: {
      userInfo: { mode: 'referrer' },
      roleLandingRedirected: false,
      roleLandingRestoreRetries: 0,
    },
    restoreRoleLanding: definition.restoreRoleLanding,
  };

  try {
    definition.restoreRoleLanding.call(app);
    assert.deepEqual(calls, ['/packages/business/referrer-workbench/referrer-workbench']);
    assert.equal(app.globalData.roleLandingRedirected, true);
    assert.equal(app.globalData.roleLandingRestoreRetries, 0);
  } finally {
    global.wx = previousWx;
    global.getCurrentPages = previousPages;
    global.setTimeout = previousSetTimeout;
  }
});

test('role landing leaves the enterprise open-account scan page for workbench identities only', () => {
  const definition = loadAppDefinition();
  const previousWx = global.wx;
  const previousPages = global.getCurrentPages;
  const relaunched = [];
  global.wx = {
    reLaunch(options) { relaunched.push(options.url); },
    switchTab() {},
  };

  try {
    global.getCurrentPages = () => [{
      route: 'packages/business/enterprise-register/enterprise-register'
    }];
    const adminApp = {
      globalData: {
        userInfo: { mode: 'staff', staffRole: 'enterprise_admin' },
        bootstrap: { current: { mode: 'staff', staffRole: 'enterprise_admin', role: 'enterprise_admin' } },
        launchOptions: { scene: 1047 },
        roleLandingRedirected: false,
        roleLandingRestoreRetries: 0,
      },
      restoreRoleLanding: definition.restoreRoleLanding,
    };
    definition.restoreRoleLanding.call(adminApp);
    assert.deepEqual(relaunched, ['/pages/index/index']);
    assert.equal(adminApp.globalData.roleLandingRedirected, true);

    relaunched.length = 0;
    const customerQrApp = {
      globalData: {
        userInfo: { mode: 'customer' },
        bootstrap: { current: { mode: 'customer', role: 'customer' } },
        launchOptions: { scene: 1047 },
        roleLandingRedirected: false,
        roleLandingRestoreRetries: 0,
      },
      restoreRoleLanding: definition.restoreRoleLanding,
    };
    definition.restoreRoleLanding.call(customerQrApp);
    assert.deepEqual(relaunched, []);
    assert.equal(customerQrApp.globalData.roleLandingRedirected, false);
  } finally {
    global.wx = previousWx;
    global.getCurrentPages = previousPages;
  }
});

test('a later recents reopen does not keep a signed customer on the enterprise open-account scan page', () => {
  const definition = loadAppDefinition();
  const previousWx = global.wx;
  const previousPages = global.getCurrentPages;
  const relaunched = [];
  global.wx = {
    reLaunch(options) { relaunched.push(options.url); },
    switchTab() {},
  };

  try {
    global.getCurrentPages = () => [{
      route: 'packages/business/enterprise-register/enterprise-register'
    }];
    const customerRecentsApp = {
      globalData: {
        userInfo: { mode: 'customer' },
        bootstrap: { current: { mode: 'customer', role: 'customer' } },
        launchOptions: { scene: 1089 },
        roleLandingRedirected: false,
        roleLandingRestoreRetries: 0,
      },
      restoreRoleLanding: definition.restoreRoleLanding,
    };
    definition.restoreRoleLanding.call(customerRecentsApp);
    assert.deepEqual(relaunched, ['/pages/index/index']);
    assert.equal(customerRecentsApp.globalData.roleLandingRedirected, true);
  } finally {
    global.wx = previousWx;
    global.getCurrentPages = previousPages;
  }
});

test('join-code and service-code scan landings leave on recents but stay on a fresh scan or share', () => {
  const definition = loadAppDefinition();
  const previousWx = global.wx;
  const previousPages = global.getCurrentPages;
  const relaunched = [];
  global.wx = {
    reLaunch(options) { relaunched.push(options.url); },
    switchTab() {},
  };

  function restore(route, identity, scene) {
    relaunched.length = 0;
    global.getCurrentPages = () => [{ route }];
    const app = {
      globalData: {
        userInfo: identity,
        bootstrap: { current: identity },
        launchOptions: { scene },
        roleLandingRedirected: false,
        roleLandingRestoreRetries: 0,
      },
      restoreRoleLanding: definition.restoreRoleLanding,
    };
    definition.restoreRoleLanding.call(app);
    return { urls: [...relaunched], redirected: app.globalData.roleLandingRedirected };
  }

  try {
    const designer = { mode: 'staff', staffRole: 'designer', role: 'designer' };
    const customer = { mode: 'customer', role: 'customer' };

    assert.deepEqual(
      restore('packages/business/onboarding/onboarding', designer, 1047),
      { urls: [], redirected: false }
    );
    assert.deepEqual(
      restore('packages/business/onboarding/onboarding', designer, 1007),
      { urls: [], redirected: false }
    );
    assert.deepEqual(
      restore('packages/business/onboarding/onboarding', designer, 1089),
      { urls: ['/pages/index/index'], redirected: true }
    );

    assert.deepEqual(
      restore('packages/business/free-design-service/free-design-service', customer, 1047),
      { urls: [], redirected: false }
    );
    assert.deepEqual(
      restore('packages/business/free-design-service/free-design-service', customer, 1089),
      { urls: ['/pages/index/index'], redirected: true }
    );
  } finally {
    global.wx = previousWx;
    global.getCurrentPages = previousPages;
  }
});

test('an invalid signed context clears the session and enters explicit recovery', async () => {
  const definition = loadAppDefinition();
  const api = require('../utils/api.js');
  const originalRequest = api.request;
  const originalWx = global.wx;
  const removed = [];
  const relaunched = [];
  global.wx = {
    removeStorageSync(key) { removed.push(key); },
    getStorageSync() { return null; },
    reLaunch(options) { relaunched.push(options.url); }
  };
  api.request = async () => { throw { error: 'Unauthorized', statusCode: 401, code: 'identity_context_invalid' }; };
  const app = {
    globalData: {
      token: 'expired-token',
      userInfo: { mode: 'referrer' },
      openid: 'openid',
      sessionHydrating: false,
      sessionHydrated: false,
      bootstrap: { current: { role: 'referrer' } },
      lastValidIdentityContext: { mode: 'referrer' }
    }
  };

  try {
    await definition.hydrateStoredSession.call(app);
    assert.equal(app.globalData.token, null);
    assert.equal(app.globalData.sessionRecovery.reason, 'identity_context_invalid');
    assert.deepEqual(relaunched, ['/packages/business/identity-recovery/identity-recovery?reason=identity_context_invalid']);
    assert.deepEqual(removed.sort(), ['openid', 'token', 'userInfo']);
  } finally {
    api.request = originalRequest;
    global.wx = originalWx;
  }
});

test('a stale cold-start refresh cannot invalidate a newer phone-login session', async () => {
  const definition = loadAppDefinition();
  const api = require('../utils/api.js');
  const originalRequest = api.request;
  const originalWx = global.wx;
  const removed = [];
  const relaunched = [];
  let rejectOldRefresh;
  global.wx = {
    getStorageSync() { return null; },
    setStorageSync() {},
    removeStorageSync(key) { removed.push(key); },
    reLaunch(options) { relaunched.push(options.url); }
  };
  api.request = async (url, method, data) => {
    if (url === '/auth/miniprogram' && data.token === 'old-token') {
      return new Promise((resolve, reject) => { rejectOldRefresh = reject; });
    }
    if (url === '/auth/miniprogram' && data.token === 'new-token') {
      return { token: 'new-refreshed-token', user: { mode: 'staff', openid: 'new-openid' }, openid: 'new-openid' };
    }
    if (url === '/miniprogram/bootstrap') {
      return { current: { context: { mode: 'staff' } } };
    }
    throw new Error(`Unexpected request: ${url} ${method}`);
  };
  const app = {
    globalData: {
      token: 'old-token',
      userInfo: { mode: 'customer' },
      openid: 'old-openid',
      sessionHydrating: false,
      sessionHydrated: false,
      sessionHydrationToken: null,
      sessionHydrationPromise: null,
      bootstrap: null,
      sessionRecovery: null,
      lastValidIdentityContext: null
    },
    syncProfessionalContext() {},
    restoreRoleLanding() {},
    guardCurrentRoute() {},
    refreshCustomTabBar() {},
    hydrateStoredSession: definition.hydrateStoredSession
  };

  try {
    const oldHydration = definition.hydrateStoredSession.call(app);
    await Promise.resolve();
    app.globalData.token = 'new-token';
    app.globalData.userInfo = { mode: 'staff' };
    const newHydration = definition.hydrateStoredSession.call(app);
    rejectOldRefresh({ error: 'Unauthorized', statusCode: 401, code: 'identity_context_invalid' });
    await Promise.all([oldHydration, newHydration]);

    assert.equal(app.globalData.token, 'new-refreshed-token');
    assert.equal(app.globalData.sessionRecovery, null);
    assert.deepEqual(removed, []);
    assert.deepEqual(relaunched, []);
  } finally {
    api.request = originalRequest;
    global.wx = originalWx;
  }
});

test('branding sync tolerates a wrapped API request export', async () => {
  const apiPath = require.resolve('../utils/api.js');
  const apiModule = require(apiPath);
  const originalExports = apiModule;
  const originalWx = global.wx;
  const originalPages = global.getCurrentPages;
  const calls = [];

  require.cache[apiPath].exports = {
    default: {
      request: async (url, method) => {
        calls.push([url, method]);
        return { success: true, data: { name: '测试企业' } };
      }
    }
  };
  const definition = loadAppDefinition();
  global.wx = {};
  global.getCurrentPages = () => [];
  const app = { globalData: {} };

  try {
    await definition.syncBranding.call(app, '123');
    assert.deepEqual(calls, [['/branding/123', 'GET']]);
    assert.deepEqual(app.globalData.branding, { name: '测试企业' });
  } finally {
    require.cache[apiPath].exports = originalExports;
    global.wx = originalWx;
    global.getCurrentPages = originalPages;
  }
});
