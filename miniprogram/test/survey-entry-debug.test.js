const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const miniRoot = path.resolve(__dirname, '..');
const debugConfig = require('../utils/debugConfig.js');
const customTabSource = fs.readFileSync(
  path.join(miniRoot, 'custom-tab-bar', 'index.js'),
  'utf8'
);

test('offline survey entry debug switch is disabled by default', () => {
  assert.equal(debugConfig.ENABLE_OFFLINE_SURVEY_ENTRY_DEBUG, false);
  assert.match(customTabSource, /ENABLE_OFFLINE_SURVEY_ENTRY_DEBUG/);
});

test('offline survey entry only bypasses the failed recent-plan request when enabled', () => {
  assert.match(
    customTabSource,
    /catch \(err\) \{\s*if \(ENABLE_OFFLINE_SURVEY_ENTRY_DEBUG\) \{\s*openSurveyingEditor\(\{ startNewSurvey: true \}\);\s*return;\s*\}/
  );
  assert.match(customTabSource, /title: \(err && err\.error\) \|\| '加载最近量房失败'/);
});
