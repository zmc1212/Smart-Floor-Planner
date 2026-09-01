const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appSource = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');

test('App initializes the official UpdateManager once and handles its lifecycle', () => {
  assert.match(appSource, /this\.initUpdateManager\(\)/);
  assert.match(appSource, /wx\.getUpdateManager\(\)/);
  assert.match(appSource, /onCheckForUpdate\(/);
  assert.match(appSource, /onUpdateReady\(/);
  assert.match(appSource, /onUpdateFailed\(/);
  assert.match(appSource, /updateManager\.applyUpdate\(\)/);
  assert.match(appSource, /if \(this\._updateManagerInitialized\)/);
});

