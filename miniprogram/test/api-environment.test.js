const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../utils/api.js');

test('API environment selection returns only the explicitly selected base URL', () => {
  assert.deepEqual(api.getBaseUrls('local'), ['http://192.168.10.32:3006/api']);
  assert.deepEqual(api.getBaseUrls('production'), ['https://smartfloor.zlyun168.com/api']);
  assert.deepEqual(api.getBaseUrls(), ['https://smartfloor.zlyun168.com/api']);
});

test('API environment selection rejects unknown environments', () => {
  for (const environment of ['staging', 'constructor', '__proto__']) {
    assert.throws(() => api.getBaseUrls(environment), {
      message: `Unknown Mini Program API environment: ${environment}`,
    });
  }
});

test('DevTools can select the development API while explicit selection takes precedence', () => {
  const previous = global.wx;
  global.wx = {
    getSystemInfoSync: () => ({ platform: 'devtools' }),
    getStorageSync: (key) => (key === 'sfp:apiEnvironmentOverride' ? 'local' : ''),
  };
  try {
    assert.deepEqual(api.getBaseUrls(), ['http://192.168.10.32:3006/api']);
    assert.deepEqual(api.getBaseUrls('production'), ['https://smartfloor.zlyun168.com/api']);
  } finally {
    global.wx = previous;
  }
});

test('the build default applies on devices and for invalid DevTools overrides', () => {
  const previous = global.wx;
  let platform = 'ios', override = 'local';
  global.wx = {
    getSystemInfoSync: () => ({ platform }),
    getStorageSync: () => override,
  };
  try {
    assert.deepEqual(api.getBaseUrls(), ['https://smartfloor.zlyun168.com/api']);
    platform = 'devtools';
    for (const value of ['staging', 'constructor', '__proto__']) {
      override = value;
      assert.deepEqual(api.getBaseUrls(), ['https://smartfloor.zlyun168.com/api']);
    }
  } finally {
    global.wx = previous;
  }
});
