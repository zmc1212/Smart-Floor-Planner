const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../utils/api.js');

test('API environment selection returns only the explicitly selected base URL', () => {
  assert.deepEqual(api.getBaseUrls('local'), ['http://192.168.10.32:3006/api']);
  assert.deepEqual(api.getBaseUrls('production'), ['https://smartfloor.zlyun168.com/api']);
  assert.deepEqual(api.getBaseUrls(), ['http://192.168.10.32:3006/api']);
});

test('API environment selection rejects unknown environments', () => {
  assert.throws(
    () => api.getBaseUrls('staging'),
    /Unknown Mini Program API environment: staging/
  );
});

test('devtools storage override selects production without changing the committed default', () => {
  const previous = global.wx;
  global.wx = {
    getSystemInfoSync: () => ({ platform: 'devtools' }),
    getStorageSync: (key) => (key === 'sfp:apiEnvironmentOverride' ? 'production' : ''),
  };
  try {
    assert.deepEqual(api.getBaseUrls(), ['https://smartfloor.zlyun168.com/api']);
  } finally {
    global.wx = previous;
  }
});
