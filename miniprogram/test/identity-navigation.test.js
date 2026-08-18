const test = require('node:test');
const assert = require('node:assert/strict');

const navigation = require('../utils/identity-navigation.js');

test('role landing keeps referrers out of the generic home shell', () => {
  assert.equal(
    navigation.getRoleLanding({ mode: 'referrer' }),
    '/packages/business/referrer-workbench/referrer-workbench'
  );
  assert.equal(navigation.getRoleLanding({ role: 'staff' }), '/pages/mine/mine');
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
