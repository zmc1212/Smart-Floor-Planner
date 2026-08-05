const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../utils/api.js');

test('API environment selection returns only the explicitly selected base URL', () => {
  assert.deepEqual(api.getBaseUrls('local'), ['http://192.168.10.111:3005/api']);
  assert.deepEqual(api.getBaseUrls('production'), ['https://smartfloor.zlyun168.com/api']);
});

test('API environment selection rejects unknown environments', () => {
  assert.throws(
    () => api.getBaseUrls('staging'),
    /Unknown Mini Program API environment: staging/
  );
});
