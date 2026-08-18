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
