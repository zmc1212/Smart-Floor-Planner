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

test('offline survey entry debug switch bypasses loading and recent-plan requests', () => {
  assert.equal(typeof debugConfig.ENABLE_OFFLINE_SURVEY_ENTRY_DEBUG, 'boolean');
  assert.match(customTabSource, /ENABLE_OFFLINE_SURVEY_ENTRY_DEBUG/);
  assert.match(
    customTabSource,
    /this\.isOpeningSurvey = true;\s*if \(ENABLE_OFFLINE_SURVEY_ENTRY_DEBUG\) \{\s*openSurveyingEditor\(\{ startNewSurvey: true \}\);\s*this\.isOpeningSurvey = false;\s*return;\s*\}\s*wx\.showLoading\(\{ title: '加载量房记录' \}\);\s*try \{\s*const res = await api\.request\('\/floorplans\?page=1&limit=1', 'GET'\);/
  );
  assert.match(customTabSource, /title: \(err && err\.error\) \|\| '加载最近量房失败'/);
});
